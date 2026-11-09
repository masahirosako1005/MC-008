/**
 * @file 現在地から 80m（DISCOVERY_RADIUS_M）以内の未発見スポットを発見するユースケース（application 層・書込み系）
 * 流れ: 入力検証 → 旅人（セッションから解決＝SEC-01）→ 現在地 → findSpotsToDiscover → Traveler.discover
 *       → 新規があれば save(expectedVersion) を最後に1回（DI-10, DI-12）→ SpotDiscovered を発行。新規が無ければ保存も発行もしない。
 * 発見済みは無視されるので、同じ要求を何度送っても結果は変わらない（DI-07）。保存が競合したら読み直して1回だけやり直す。
 * 位置が取れないときは失敗をそのまま返す（デモ位置に切り替えない＝SEC-27）。座標はログに出さない（LG-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseOperationId } from '@/Common/types/Id';
import { isRecord } from '@/Common/utils/guards';
import type { UseCase } from '@/application/AppServices';
import type { DiscoveredSpotDto, DiscoverInput, DiscoverOutput } from '@/application/dto/Dto';
import type { EventBus } from '@/application/events/EventBus';
import type { EventFactory } from '@/application/events/EventFactory';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import { findSpotsToDiscover } from '@/domain/exploration/DiscoveryRule';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import type { Clock } from '@/domain/ports/Clock';
import type { GeoProvider } from '@/domain/ports/GeoProvider';
import type { Spot } from '@/domain/spot/Spot';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/exploration/DiscoverNearbySpotsUseCase');

/** DiscoverNearbySpotsUseCase の依存 */
export interface DiscoverNearbySpotsDeps {
  readonly session: SessionRepository;
  readonly travelers: TravelerRepository;
  readonly spots: SpotRepository;
  readonly geo: GeoProvider;
  /** 発見日時（discoveredAt）の時計（デモでは日付進行が効く DemoClock） */
  readonly clock: Clock;
  /** SpotDiscovered の発行先 */
  readonly events: Pick<EventBus, 'publish'>;
  /** イベントにメタ情報を付ける工場（container で1つを共有） */
  readonly eventFactory: EventFactory;
}

/**
 * スポットを「発見した」DTO にする（発見済みになったので名前を出してよい）。
 * @param spot スポット
 * @returns DiscoveredSpotDto（凍結済み）
 */
function toDiscoveredSpotDto(spot: Spot): DiscoveredSpotDto {
  return Object.freeze({ id: spot.id, name: spot.name, kind: spot.kind, districtId: spot.districtId });
}

/** 現在地から 80m 以内の未発見スポットを発見する */
export class DiscoverNearbySpotsUseCase implements UseCase<DiscoverInput, DiscoverOutput> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人リポジトリ・マスタ・位置・時計・イベントバス・イベント工場
   */
  constructor(private readonly deps: DiscoverNearbySpotsDeps) {}

  /**
   * 現在地の周り 80m（DISCOVERY_RADIUS_M）以内の未発見スポットを発見済みにする。
   * @param input operationId（UUID。二重送信の追跡用。発見は発見済みを無視するので再実行しても結果は同じ＝DI-07）
   * @returns 成功: 今回初めて発見したスポット（近い順。無ければ空配列）。
   *          失敗: INVALID_INPUT（operationId 不正）／TRAVELER_NOT_FOUND／GEO_UNAVAILABLE／GEO_DENIED／CONFLICT（やり直しても競合）／STORAGE_FAILED
   * @sideEffect 新規があれば TravelerRepository.save を1回（競合時は読み直して最大2回）呼び、SpotDiscovered を発行する
   */
  async execute(input: DiscoverInput): Promise<Result<DiscoverOutput>> {
    const log = logger.fn('execute');
    const operationId = parseOperationId(isRecord(input) ? input.operationId : undefined);
    if (!operationId.ok) return log.fail(operationId, 'operationId が不正');
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    const fix = await this.deps.geo.current();
    if (!fix.ok) return log.fail(fix, '位置を取得できない');
    const discovered = await this.discoverWithRetry(traveler.value, fix.value.point);
    if (!discovered.ok) return log.fail(discovered);
    log.info('発見判定を完了', { operationId: operationId.value, newly: discovered.value.map((spot) => spot.id) });
    return log.exit(ok(Object.freeze({ newlyDiscovered: Object.freeze(discovered.value.map(toDiscoveredSpotDto)) })));
  }

  /**
   * 発見して保存する。保存が競合（CONFLICT）したら旅人を読み直して1回だけやり直す（並行して訪問が保存された場合など）。
   * @param traveler 読み込んだ旅人
   * @param point 現在地（ログに出さない）
   * @returns 成功: 今回初めて発見したスポット。失敗: CONFLICT／STORAGE_FAILED／TRAVELER_NOT_FOUND（読み直したら消えていた）
   * @sideEffect TravelerRepository.save・findById、SpotDiscovered の発行
   */
  private async discoverWithRetry(traveler: Traveler, point: GeoPoint): Promise<Result<readonly Spot[]>> {
    const log = logger.fn('discoverWithRetry', { travelerId: traveler.id, version: traveler.version });
    const first = await this.discoverAndSave(traveler, point);
    if (first.ok || first.error.code !== 'CONFLICT') return first.ok ? log.exit(first) : log.fail(first);
    log.warn('保存が競合したので読み直して1回だけやり直す', { travelerId: traveler.id });
    const reloaded = await this.deps.travelers.findById(traveler.id);
    if (!reloaded.ok) return log.fail(reloaded);
    if (reloaded.value === undefined) return log.fail(first, '読み直したら旅人が無い');
    const second = await this.discoverAndSave(reloaded.value, point);
    return second.ok ? log.exit(second) : log.fail(second);
  }

  /**
   * 80m 以内の未発見スポットを発見済みにし、新規があれば保存して SpotDiscovered を発行する（保存は最後に1回＝DI-12）。
   * @param traveler 旅人（この版数で楽観ロック＝DI-10）
   * @param point 現在地（ログに出さない）
   * @returns 成功: 今回初めて発見したスポット（無ければ空配列で、保存も発行もしない）。失敗: CONFLICT／STORAGE_FAILED
   * @sideEffect 新規があれば TravelerRepository.save を1回呼び、保存できたら SpotDiscovered を発行する
   */
  private async discoverAndSave(traveler: Traveler, point: GeoPoint): Promise<Result<readonly Spot[]>> {
    const log = logger.fn('discoverAndSave', { travelerId: traveler.id, version: traveler.version });
    const candidates = findSpotsToDiscover(point, this.deps.spots.allSpots(), (id) => traveler.hasDiscovered(id));
    if (candidates.length === 0) return log.exit(ok([]), '新規なし');
    const outcome = traveler.discover(candidates, this.deps.clock.now());
    if (outcome.newlyDiscovered.length === 0) return log.exit(ok([]), '新規なし');
    const saved = await this.deps.travelers.save(outcome.traveler, traveler.version);
    if (!saved.ok) return log.fail(saved);
    await this.publishDiscovered(saved.value, outcome.newlyDiscovered);
    return log.exit(ok(outcome.newlyDiscovered));
  }

  /**
   * 発見したスポットごとに SpotDiscovered を発行する（保存の後に呼ぶ）。
   * @param traveler 保存後の旅人（イベントの持ち主）
   * @param spots 今回初めて発見したスポット
   * @sideEffect EventFactory でイベントを作り EventBus.publish を呼ぶ
   */
  private async publishDiscovered(traveler: Traveler, spots: readonly Spot[]): Promise<void> {
    const log = logger.fn('publishDiscovered', { travelerId: traveler.id, count: spots.length });
    const events = spots.map((spot) => this.deps.eventFactory.create(traveler.id, { type: 'SpotDiscovered', spotId: spot.id, districtId: spot.districtId }));
    await this.deps.events.publish(events);
    log.info('SpotDiscovered を発行', { spotIds: spots.map((spot) => spot.id) });
    log.exit(undefined);
  }
}
