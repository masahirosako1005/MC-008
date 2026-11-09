/**
 * @file 現在地から近いスポットを距離順に返すユースケース（application 層・読取系）
 * 下シート（つまみ＝いちばん近いスポット、半分＝近隣リスト）で使う。発見済み・訪問済みのスポットを距離順に limit 件（既定 8）。
 * 未発見スポットは NEARBY_UNKNOWN_RADIUS_M（120m）以内のものだけを「？」として名前なしで混ぜる（B: 未知への興味。名前は出さない＝D12）。
 * canVisit は VISIT_RADIUS_M 以内・今日未訪問・精度 OK のとき true（表示用。最終判定は VisitSpotUseCase＝SEC-21）。
 * 位置が取れなければ GEO_UNAVAILABLE / GEO_DENIED を返す（デモ位置に切り替えない＝SEC-27）。座標はログに出さない（LG-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { LocalDate } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import type { UseCase } from '@/application/AppServices';
import type { NearbyInput, NearbySpotDto } from '@/application/dto/Dto';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import { NEARBY_DEFAULT_LIMIT, NEARBY_MAX_LIMIT, NEARBY_UNKNOWN_RADIUS_M } from '@/application/usecases/exploration/constants';
import { districtNameOf, hasActiveShopEventOn, spotStatusOf } from '@/application/usecases/exploration/SpotStatus';
import { visitAvailabilityOf } from '@/application/usecases/exploration/VisitAvailability';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import { nearestSpots } from '@/domain/exploration/DiscoveryRule';
import type { SpotWithDistance } from '@/domain/exploration/DiscoveryRule';
import type { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import { visitCountOfSpot } from '@/domain/exploration/VisitStats';
import type { Clock } from '@/domain/ports/Clock';
import type { GeoFix, GeoProvider } from '@/domain/ports/GeoProvider';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/exploration/GetNearbySpotsUseCase');

/** GetNearbySpotsUseCase の依存 */
export interface GetNearbySpotsDeps {
  readonly session: SessionRepository;
  readonly travelers: TravelerRepository;
  readonly spots: SpotRepository;
  readonly geo: GeoProvider;
  readonly clock: Clock;
}

/** DTO 組み立ての材料 */
interface NearbyContext {
  readonly traveler: Traveler;
  readonly spots: SpotRepository;
  readonly today: LocalDate;
  readonly accuracyM: number;
}

/**
 * 件数の入力を検証する（省略時は NEARBY_DEFAULT_LIMIT）。
 * @param input 近隣スポットの入力（省略可）
 * @returns 成功: 1〜NEARBY_MAX_LIMIT の整数。失敗: INVALID_INPUT
 */
function parseLimit(input: NearbyInput | undefined): Result<number> {
  const log = logger.fn('parseLimit');
  const raw = isRecord(input) ? input['limit'] : undefined;
  if (raw === undefined) return log.exit(ok(NEARBY_DEFAULT_LIMIT));
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > NEARBY_MAX_LIMIT) {
    return log.fail(fail(AppError.of('INVALID_INPUT', '件数の指定が正しくありません', { max: NEARBY_MAX_LIMIT })));
  }
  return log.exit(ok(raw));
}

/**
 * 近隣リストに出してよいか判定する（発見済み・訪問済みは距離を問わず、未発見は 120m 以内だけ）。
 * @param entry 距離つきスポット
 * @param traveler 旅人
 * @returns 出してよいなら true
 */
function isListable(entry: SpotWithDistance, traveler: Traveler): boolean {
  return traveler.hasDiscovered(entry.spot.id) || entry.meters <= NEARBY_UNKNOWN_RADIUS_M;
}

/**
 * 距離つきスポットを近隣スポットの DTO にする。未発見なら name を含めない（キー自体を持たない）。
 * @param entry 距離つきスポット
 * @param context 旅人・マスタ参照・今日・測位精度
 * @returns NearbySpotDto（凍結済み）
 */
function toNearbySpotDto(entry: SpotWithDistance, context: NearbyContext): NearbySpotDto {
  const log = logger.fn('toNearbySpotDto', { spotId: entry.spot.id, meters: entry.meters });
  const { spot, meters } = entry;
  const status = spotStatusOf(context.traveler, spot.id);
  const availability = visitAvailabilityOf({ traveler: context.traveler, spotId: spot.id, today: context.today, meters, accuracyM: context.accuracyM });
  const dto: NearbySpotDto = Object.freeze({
    id: spot.id,
    ...(status === 'unknown' ? {} : { name: spot.name }),
    kind: spot.kind,
    districtId: spot.districtId,
    districtName: districtNameOf(context.spots, spot.districtId),
    meters,
    status,
    visitCount: visitCountOfSpot(context.traveler.visits, spot.id),
    canVisit: availability.canVisit,
    hasActiveShopEvent: hasActiveShopEventOn(context.spots, spot.id, context.today),
  });
  return log.exit(dto, status);
}

/** 現在地から近いスポットを返す */
export class GetNearbySpotsUseCase implements UseCase<NearbyInput, readonly NearbySpotDto[]> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人リポジトリ・マスタ・位置・時計
   */
  constructor(private readonly deps: GetNearbySpotsDeps) {}

  /**
   * 現在地から近いスポットを距離順（同距離は ID 順）に返す。
   * @param input limit（1〜NEARBY_MAX_LIMIT、既定 NEARBY_DEFAULT_LIMIT）
   * @returns 成功: 近隣スポット（距離昇順、最大 limit 件）。失敗: INVALID_INPUT／TRAVELER_NOT_FOUND／GEO_UNAVAILABLE／GEO_DENIED／STORAGE_FAILED
   * @sideEffect セッション・旅人リポジトリの読込、GeoProvider.current を呼ぶ（書込みはしない）
   */
  async execute(input: NearbyInput): Promise<Result<readonly NearbySpotDto[]>> {
    const log = logger.fn('execute');
    const limit = parseLimit(input);
    if (!limit.ok) return log.fail(limit);
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    const fix = await this.deps.geo.current();
    if (!fix.ok) return log.fail(fix, '位置を取得できない');
    const list = this.nearbyOf(traveler.value, fix.value, limit.value);
    return log.exit(ok(list), `${list.length}件`);
  }

  /**
   * 現在地から近い順に、出してよいスポットを limit 件まで DTO にする。
   * @param traveler 旅人
   * @param fix 現在地と精度（座標はログに出さない）
   * @param limit 最大件数
   * @returns 近隣スポット（凍結済みの配列）
   */
  private nearbyOf(traveler: Traveler, fix: GeoFix, limit: number): readonly NearbySpotDto[] {
    const log = logger.fn('nearbyOf', { limit, accuracyM: fix.accuracyM });
    const allSpots = this.deps.spots.allSpots();
    const context: NearbyContext = { traveler, spots: this.deps.spots, today: this.deps.clock.today(), accuracyM: fix.accuracyM };
    const listable = nearestSpots(fix.point, allSpots, allSpots.length).filter((entry) => isListable(entry, traveler));
    return log.exit(Object.freeze(listable.slice(0, limit).map((entry) => toNearbySpotDto(entry, context))));
  }
}
