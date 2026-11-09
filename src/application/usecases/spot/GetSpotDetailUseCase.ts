/**
 * @file スポット詳細（情報・距離・訪問できるか・クーポン/イベント・自分の訪問履歴・次のカード）を返すユースケース（application 層・読取系）
 * 未発見のスポットは NOT_DISCOVERED で拒否し、名前・説明を出さない（URL 直打ちでも漏らさない＝B・D12・SEC-16）。
 * 位置が取れなくても詳細は返す（meters 無し・訪問不可・「現在地を取得できません」）。デモ位置に切り替えない（SEC-27）。
 * 訪問ボタンの可否は表示用で、最終判定は VisitSpotUseCase が改めて行う（SEC-21）。書込みはしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseSpotId } from '@/Common/types/Id';
import { formatJpDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import type { UseCase } from '@/application/AppServices';
import type { ShopEventDto, SpotDetailDto, SpotDetailInput } from '@/application/dto/Dto';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import { SPOT_HISTORY_MAX } from '@/application/usecases/exploration/constants';
import { districtNameOf, spotStatusOf } from '@/application/usecases/exploration/SpotStatus';
import { visitAvailabilityOf } from '@/application/usecases/exploration/VisitAvailability';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import { Distance } from '@/domain/exploration/Distance';
import type { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import { visitCountOfSpot, visitsInDistrict, visitsOfSpot } from '@/domain/exploration/VisitStats';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import type { Clock } from '@/domain/ports/Clock';
import type { GeoFix, GeoProvider } from '@/domain/ports/GeoProvider';
import { isActive } from '@/domain/revisit/ShopEvent';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import { nextCardGoal } from '@/domain/reward/CardPolicy';
import { sortVisitsChronologically } from '@/domain/reward/VisitChronology';
import type { Spot } from '@/domain/spot/Spot';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/spot/GetSpotDetailUseCase');

/** 未発見のスポットを開こうとしたときの失敗コード */
export const NOT_DISCOVERED = 'NOT_DISCOVERED';

/** 未発見のスポットを開こうとしたときの文言 */
const NOT_DISCOVERED_MESSAGE = 'まだ見つけていないスポットです';

/** GetSpotDetailUseCase の依存 */
export interface GetSpotDetailDeps {
  readonly session: SessionRepository;
  readonly travelers: TravelerRepository;
  readonly spots: SpotRepository;
  readonly geo: GeoProvider;
  readonly clock: Clock;
}

/** 詳細を組み立てる材料 */
interface SpotDetailContext {
  readonly spot: Spot;
  readonly traveler: Traveler;
  readonly spots: SpotRepository;
  readonly today: LocalDate;
  /** 現在地（取れなければ無し） */
  readonly fix?: GeoFix;
}

/**
 * クーポン・イベントを DTO にする。daysLeft は期間内のときだけ（当日終了=0）。
 * @param event クーポン・イベント
 * @param today 今日
 * @returns ShopEventDto（凍結済み）
 */
function toShopEventDto(event: ShopEvent, today: LocalDate): ShopEventDto {
  const log = logger.fn('toShopEventDto', { shopEventId: event.id, today });
  const active = isActive(event, today);
  const dto: ShopEventDto = Object.freeze({
    id: event.id,
    kind: event.kind,
    title: event.title,
    description: event.description,
    ...(active ? { daysLeft: event.period.daysUntilEnd(today) } : {}),
    active,
    start: event.period.start,
    end: event.period.end,
  });
  return log.exit(dto);
}

/**
 * スポットのクーポン・イベントのうち、終了日が今日以降のもの（開催中・開始前）を終了日の近い順に DTO にする。
 * @param spots マスタ参照
 * @param spot スポット
 * @param today 今日
 * @returns ShopEventDto の配列（凍結済み）
 */
function shopEventDtosOf(spots: SpotRepository, spot: Spot, today: LocalDate): readonly ShopEventDto[] {
  const log = logger.fn('shopEventDtosOf', { spotId: spot.id, today });
  const upcoming = spots
    .shopEventsForSpot(spot.id)
    .filter((event) => event.period.daysUntilEnd(today) >= 0)
    .sort((a, b) => a.period.daysUntilEnd(today) - b.period.daysUntilEnd(today) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return log.exit(Object.freeze(upcoming.map((event) => toShopEventDto(event, today))));
}

/**
 * スポットの訪問履歴を新しい順に最大 SPOT_HISTORY_MAX 件、表示用の日付にする。
 * @param visits 旅人の全訪問記録
 * @param spot スポット
 * @returns '2026/11/02（月）' 形式の日付（新しい順・凍結済み）
 */
function historyOf(visits: readonly VisitRecord[], spot: Spot): readonly string[] {
  const log = logger.fn('historyOf', { spotId: spot.id });
  const newestFirst = sortVisitsChronologically(visitsOfSpot(visits, spot.id)).reverse();
  return log.exit(Object.freeze(newestFirst.slice(0, SPOT_HISTORY_MAX).map((visit) => formatJpDate(visit.localDate))));
}

/**
 * 材料からスポット詳細の DTO を組み立てる。
 * @param context スポット・旅人・マスタ参照・今日・現在地（任意）
 * @returns SpotDetailDto（凍結済み）
 */
function toSpotDetailDto(context: SpotDetailContext): SpotDetailDto {
  const { spot, traveler, today, fix } = context;
  const log = logger.fn('toSpotDetailDto', { spotId: spot.id, today, hasPosition: fix !== undefined });
  const position = fix === undefined ? undefined : { meters: Distance.between(fix.point, spot.point).meters, accuracyM: fix.accuracyM };
  const availability = visitAvailabilityOf({ traveler, spotId: spot.id, today, ...position });
  const nextCard = nextCardGoal(traveler.visits, spot.districtId);
  const dto: SpotDetailDto = Object.freeze({
    id: spot.id, name: spot.name, kind: spot.kind, category: spot.category,
    districtId: spot.districtId, districtName: districtNameOf(context.spots, spot.districtId),
    description: spot.description, amenities: Object.freeze([...spot.amenities]), hours: spot.hours, partner: spot.partner,
    status: spotStatusOf(traveler, spot.id),
    ...(position === undefined ? {} : { meters: position.meters }),
    canVisit: availability.canVisit,
    ...(availability.reason === undefined ? {} : { visitBlockedReason: availability.reason }),
    ...(availability.metersToVisit === undefined ? {} : { metersToVisit: availability.metersToVisit }),
    visitedToday: traveler.hasVisitedOn(spot.id, today),
    visitCount: visitCountOfSpot(traveler.visits, spot.id),
    districtVisitCount: visitsInDistrict(traveler.visits, spot.districtId).length,
    ...(nextCard === undefined ? {} : { nextCard: Object.freeze({ rank: nextCard.rank, remainingVisits: nextCard.remainingVisits }) }),
    history: historyOf(traveler.visits, spot),
    shopEvents: shopEventDtosOf(context.spots, spot, today),
  });
  return log.exit(dto, availability.block ?? 'canVisit');
}

/** スポット詳細を返す */
export class GetSpotDetailUseCase implements UseCase<SpotDetailInput, SpotDetailDto> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人リポジトリ・マスタ・位置・時計
   */
  constructor(private readonly deps: GetSpotDetailDeps) {}

  /**
   * 発見済み（訪問済みを含む）スポットの詳細を返す。
   * @param input spotId（URL 由来の値でもよい。境界で検証する＝SEC-16）
   * @returns 成功: SpotDetailDto（位置が取れなければ meters 無し・canVisit=false・「現在地を取得できません」）。
   *          失敗: INVALID_INPUT（spotId 不正）／SPOT_NOT_FOUND／NOT_DISCOVERED（「まだ見つけていないスポットです」）／TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect セッション・旅人リポジトリの読込、GeoProvider.current を呼ぶ（書込みはしない）
   */
  async execute(input: SpotDetailInput): Promise<Result<SpotDetailDto>> {
    const log = logger.fn('execute');
    const spotId = parseSpotId(isRecord(input) ? input['spotId'] : undefined);
    if (!spotId.ok) return log.fail(spotId, 'spotId が不正');
    const spot = this.deps.spots.findSpot(spotId.value);
    if (spot === undefined) return log.fail(fail(AppError.of('SPOT_NOT_FOUND', 'スポットが見つかりません', { spotId: spotId.value })));
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    if (!traveler.value.hasDiscovered(spot.id)) {
      return log.fail(fail(AppError.of(NOT_DISCOVERED, NOT_DISCOVERED_MESSAGE, { spotId: spot.id })), '未発見');
    }
    const fix = await this.deps.geo.current();
    if (!fix.ok) log.warn('位置を取得できないので距離なしで返す', { geoError: fix.error.code });
    const today = this.deps.clock.today();
    const context: SpotDetailContext = { spot, traveler: traveler.value, spots: this.deps.spots, today, ...(fix.ok ? { fix: fix.value } : {}) };
    return log.exit(ok(toSpotDetailDto(context)));
  }
}
