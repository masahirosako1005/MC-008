/**
 * @file スポットを訪問するユースケース（application 層・書込み系）
 * 流れ: 入力検証（parseOperationId・parseSpotId＝DI-01）→ スポット取得 → 旅人（セッションから解決＝SEC-01）→ 現在地 → 距離
 *       → Traveler.visit（精度・40m・1日1回＝DI-08, DI-14）→ 保存は最後に1回（DI-12、expectedVersion で楽観ロック＝DI-10）→ SpotVisited を発行。
 * 加点・地区の成長/復活・地区の主はこのユースケースでは行わない。container が SpotVisited の購読としてハンドラを登録し、結果整合で進める（DI-11）。
 * 同じ operationId の再実行は保存も発行もせず duplicate=true を返す（DI-07）。並行した二重送信で保存が競合したら読み直して判定し直す。
 * 位置が取れなければ失敗を返し、デモ位置に切り替えない（SEC-27）。座標はログに出さない（LG-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseOperationId, parseSpotId } from '@/Common/types/Id';
import type { OperationId, SpotId } from '@/Common/types/Id';
import { localDateOf } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import type { UseCase } from '@/application/AppServices';
import type { VisitInput, VisitOutput } from '@/application/dto/Dto';
import type { EventBus } from '@/application/events/EventBus';
import type { EventFactory } from '@/application/events/EventFactory';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import { Distance } from '@/domain/exploration/Distance';
import type { Traveler, VisitInput as TravelerVisitInput } from '@/domain/exploration/Traveler';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import type { Clock } from '@/domain/ports/Clock';
import type { GeoProvider } from '@/domain/ports/GeoProvider';
import type { Spot } from '@/domain/spot/Spot';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/exploration/VisitSpotUseCase');

/** VisitSpotUseCase の依存 */
export interface VisitSpotDeps {
  readonly session: SessionRepository;
  readonly travelers: TravelerRepository;
  readonly spots: SpotRepository;
  readonly geo: GeoProvider;
  /** 訪問日時と JST 暦日の時計（デモでは日付進行が効く DemoClock） */
  readonly clock: Clock;
  /** SpotVisited の発行先（購読ハンドラの連鎖は container が登録する＝DI-11） */
  readonly events: Pick<EventBus, 'publish'>;
  /** イベントにメタ情報を付ける工場（container で1つを共有） */
  readonly eventFactory: EventFactory;
}

/** 検証済みの入力 */
interface ParsedVisitInput {
  readonly operationId: OperationId;
  readonly spotId: SpotId;
}

/**
 * 入力を境界で検証する（presentation からの値を信用しない＝DI-01, SEC-16）。
 * @param input 訪問の入力
 * @returns 成功: 検証済みの operationId と spotId。失敗: INVALID_INPUT
 */
function parseVisitInput(input: VisitInput): Result<ParsedVisitInput> {
  const log = logger.fn('parseVisitInput');
  const record: Readonly<Record<string, unknown>> = isRecord(input) ? input : {};
  const operationId = parseOperationId(record['operationId']);
  if (!operationId.ok) return log.fail(operationId, 'operationId が不正');
  const spotId = parseSpotId(record['spotId']);
  if (!spotId.ok) return log.fail(spotId, 'spotId が不正');
  return log.exit(ok(Object.freeze({ operationId: operationId.value, spotId: spotId.value })));
}

/**
 * 訪問記録から出力 DTO を作る。
 * @param record 訪問記録（今回の記録、または処理済みの操作の記録）
 * @param duplicate 処理済みの操作の再実行だったか
 * @returns VisitOutput（凍結済み）
 */
function outputOf(record: VisitRecord, duplicate: boolean): VisitOutput {
  return Object.freeze({ spotId: record.spotId, districtId: record.districtId, localDate: record.localDate, duplicate });
}

/**
 * 処理済みの操作なら、その時の訪問記録から duplicate=true の出力を返す（現在地を取り直さずに同じ結果を返す＝DI-07）。
 * @param traveler 旅人
 * @param operationId 操作ID
 * @returns 処理済みの訪問なら出力。未処理（または訪問以外で使われた ID）なら undefined
 */
function replayOf(traveler: Traveler, operationId: OperationId): VisitOutput | undefined {
  const log = logger.fn('replayOf', { operationId });
  if (!traveler.hasProcessed(operationId)) return log.exit(undefined);
  const record = traveler.visits.find((visit) => visit.operationId === operationId);
  return log.exit(record === undefined ? undefined : outputOf(record, true));
}

/** スポットを訪問する */
export class VisitSpotUseCase implements UseCase<VisitInput, VisitOutput> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人リポジトリ・マスタ・位置・時計・イベントバス・イベント工場
   */
  constructor(private readonly deps: VisitSpotDeps) {}

  /**
   * スポットを訪問し、訪問記録を保存して SpotVisited を発行する。
   * @param input operationId（UUID・必須＝DI-07）と spotId
   * @returns 成功: 訪問したスポット・地区・暦日と duplicate（同じ operationId の再実行なら true で何も変えない）。
   *          失敗: INVALID_INPUT／SPOT_NOT_FOUND／TRAVELER_NOT_FOUND／GEO_UNAVAILABLE／GEO_DENIED／LOW_ACCURACY／OUT_OF_RANGE／
   *          ALREADY_VISITED_TODAY／CONFLICT（読み直しても競合）／STORAGE_FAILED
   * @sideEffect GeoProvider.current、TravelerRepository.save を1回（競合時は読み直して最大2回）、保存できたら SpotVisited を発行（購読ハンドラが続けて走る）
   * @see docs/06_data_integrity_checklist.md DI-07, DI-08, DI-10, DI-11, DI-12
   */
  async execute(input: VisitInput): Promise<Result<VisitOutput>> {
    const log = logger.fn('execute');
    const parsed = parseVisitInput(input);
    if (!parsed.ok) return log.fail(parsed);
    const { operationId, spotId } = parsed.value;
    const spot = this.deps.spots.findSpot(spotId);
    if (spot === undefined) return log.fail(fail(AppError.of('SPOT_NOT_FOUND', 'スポットが見つかりません', { spotId })));
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    const replay = replayOf(traveler.value, operationId);
    if (replay !== undefined) return log.exit(ok(replay), '処理済みの操作');
    const visitInput = await this.visitInputAt(spot, operationId);
    if (!visitInput.ok) return log.fail(visitInput);
    const result = await this.commitWithRetry(traveler.value, visitInput.value);
    if (!result.ok) return log.fail(result);
    log.info('訪問を受け付けた', { spotId, districtId: result.value.districtId, localDate: result.value.localDate, duplicate: result.value.duplicate });
    return log.exit(result);
  }

  /**
   * 現在地を取り、Traveler.visit に渡す入力（距離・精度・日時・暦日）を作る。日時と暦日は Clock.now() 1回から作る（DI-04）。
   * @param spot 訪問するスポット
   * @param operationId 操作ID
   * @returns 成功: Traveler.visit の入力。失敗: GEO_UNAVAILABLE / GEO_DENIED（そのまま返す＝SEC-27）
   * @sideEffect GeoProvider.current・Clock.now を呼ぶ
   */
  private async visitInputAt(spot: Spot, operationId: OperationId): Promise<Result<TravelerVisitInput>> {
    const log = logger.fn('visitInputAt', { spotId: spot.id });
    const fix = await this.deps.geo.current();
    if (!fix.ok) return log.fail(fix, '位置を取得できない');
    const meters = Distance.between(fix.value.point, spot.point).meters;
    const at = this.deps.clock.now();
    log.debug('距離判定の材料', { meters, accuracyM: fix.value.accuracyM });
    return log.exit(ok(Object.freeze({ spot, meters, accuracyM: fix.value.accuracyM, at, localDate: localDateOf(at), operationId })));
  }

  /**
   * 訪問を記録して保存する。保存が競合（CONFLICT）したら旅人を読み直して1回だけやり直す。
   * 並行した二重送信なら、読み直した旅人では処理済みになっているので duplicate=true になる（DI-07）。
   * @param traveler 読み込んだ旅人
   * @param visit Traveler.visit の入力
   * @returns 成功: 出力。失敗: LOW_ACCURACY／OUT_OF_RANGE／ALREADY_VISITED_TODAY／CONFLICT／STORAGE_FAILED
   * @sideEffect TravelerRepository.save・findById、SpotVisited の発行
   */
  private async commitWithRetry(traveler: Traveler, visit: TravelerVisitInput): Promise<Result<VisitOutput>> {
    const log = logger.fn('commitWithRetry', { travelerId: traveler.id, version: traveler.version });
    const first = await this.commit(traveler, visit);
    if (first.ok || first.error.code !== 'CONFLICT') return first.ok ? log.exit(first) : log.fail(first);
    log.warn('保存が競合したので読み直して1回だけやり直す', { travelerId: traveler.id, operationId: visit.operationId });
    const reloaded = await this.deps.travelers.findById(traveler.id);
    if (!reloaded.ok) return log.fail(reloaded);
    if (reloaded.value === undefined) return log.fail(first, '読み直したら旅人が無い');
    const second = await this.commit(reloaded.value, visit);
    return second.ok ? log.exit(second) : log.fail(second);
  }

  /**
   * Traveler.visit で判定・記録し、新しい訪問なら保存してから SpotVisited を発行する（検証→計算→保存→発行の順＝DI-12）。
   * @param traveler 旅人（この版数で楽観ロック＝DI-10）
   * @param visit Traveler.visit の入力
   * @returns 成功: 出力（処理済みなら duplicate=true で保存・発行しない）。失敗: LOW_ACCURACY／OUT_OF_RANGE／ALREADY_VISITED_TODAY／CONFLICT／STORAGE_FAILED
   * @sideEffect 新しい訪問なら TravelerRepository.save を1回呼び、保存できたら SpotVisited を発行する
   */
  private async commit(traveler: Traveler, visit: TravelerVisitInput): Promise<Result<VisitOutput>> {
    const log = logger.fn('commit', { travelerId: traveler.id, version: traveler.version, spotId: visit.spot.id });
    const outcome = traveler.visit(visit);
    if (!outcome.ok) return log.fail(outcome);
    if (outcome.value.duplicate) return log.exit(ok(outputOf(outcome.value.record, true)), '処理済みの操作');
    const saved = await this.deps.travelers.save(outcome.value.traveler, traveler.version);
    if (!saved.ok) return log.fail(saved);
    await this.publishVisited(saved.value, outcome.value.record);
    return log.exit(ok(outputOf(outcome.value.record, false)));
  }

  /**
   * SpotVisited を発行する（訪問記録の保存の後に呼ぶ。購読ハンドラ＝加点・地区更新・主の再判定が続けて走る＝DI-11）。
   * @param traveler 保存後の旅人（イベントの持ち主）
   * @param record 今回の訪問記録
   * @sideEffect EventFactory でイベントを作り EventBus.publish を呼ぶ
   */
  private async publishVisited(traveler: Traveler, record: VisitRecord): Promise<void> {
    const log = logger.fn('publishVisited', { travelerId: traveler.id, spotId: record.spotId, operationId: record.operationId });
    const event = this.deps.eventFactory.create(traveler.id, {
      type: 'SpotVisited',
      spotId: record.spotId,
      districtId: record.districtId,
      localDate: record.localDate,
      operationId: record.operationId,
    });
    await this.deps.events.publish([event]);
    log.info('SpotVisited を発行', { eventId: event.eventId, spotId: record.spotId, localDate: record.localDate });
    log.exit(undefined);
  }
}
