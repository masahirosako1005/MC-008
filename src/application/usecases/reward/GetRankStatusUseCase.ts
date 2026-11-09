/**
 * @file 旅人ランクの状況を返すユースケース（application 層・読取系。下部タブ「ランク」）
 * 累計ポイント（台帳の残高）からいまの段・次の段まで・すべての段を返し、最近のポイント・通いの実績・旅の日数を添える。
 * ランク・カード・地区の主は訪問記録と台帳から毎回導出し、保存しない（docs/08 D4, D11）。ランクは下がらない（CLAUDE.md 5）。
 * 網羅率（％・全n件中m件）は返さない（CLAUDE.md 6.5）。書込みはしない。基準 C（再訪動機）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { compareInstant, compareLocalDate, daysBetween } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { UseCase } from '@/application/AppServices';
import type { RankPointHistoryDto, RankStatusDto, RankStepDto } from '@/application/dto/Dto';
import { districtViewsOf } from '@/application/usecases/shared/DistrictView';
import type { DistrictView } from '@/application/usecases/shared/DistrictView';
import { loadWorld } from '@/application/usecases/shared/World';
import type { WorldDeps } from '@/application/usecases/shared/World';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { cardsOf } from '@/domain/reward/CardPolicy';
import { RANK_THRESHOLDS, VISIT_POINTS_LANDMARK, VISIT_POINTS_SHOP, WELCOME_BACK_MULTIPLIER } from '@/domain/reward/constants';
import type { LedgerEntry } from '@/domain/reward/LedgerEntry';
import { rankOf } from '@/domain/reward/TravelerRank';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/reward/GetRankStatusUseCase');

/** 最近のポイントとして返す行数（表示の都合。ゲームの数値ルールではない） */
export const RANK_HISTORY_LIMIT = 5;

/** マスタから消えたスポットの表示名 */
const UNKNOWN_SPOT_NAME = 'スポット';

/**
 * すべての段を、いまの段の添字から「到達済み／いまの段／まだ」に分けて返す。
 * @param currentIndex いまの段の添字
 * @returns 段（下から順・凍結済み）
 */
export function rankStepsOf(currentIndex: number): RankStepDto[] {
  const log = logger.fn('rankStepsOf', { currentIndex });
  const steps = RANK_THRESHOLDS.map((threshold, i) =>
    Object.freeze({ name: threshold.name, min: threshold.min, state: i < currentIndex ? 'reached' : i === currentIndex ? 'current' : 'locked' } as const),
  );
  return log.exit(steps);
}

/**
 * 最近のポイントを新しい順に最大 RANK_HISTORY_LIMIT 件、表示用にして返す。
 * 同じ時刻（同じ訪問の基本点とボーナス）は台帳の後ろ（ボーナス）を先に出す。
 * @param entries 台帳の行（古い順）
 * @param spots マスタ参照（スポット名・種別・地区名）
 * @returns 最近のポイント
 */
export function recentPointsOf(entries: readonly LedgerEntry[], spots: SpotRepository): RankPointHistoryDto[] {
  const log = logger.fn('recentPointsOf', { entries: entries.length });
  const indexed = entries.map((entry, order) => ({ entry, order }));
  indexed.sort((a, b) => compareInstant(b.entry.at, a.entry.at) || b.order - a.order);
  const recent = indexed.slice(0, RANK_HISTORY_LIMIT).map(({ entry }) => {
    const spot = spots.findSpot(entry.spotId);
    return Object.freeze({
      date: entry.localDate,
      spotName: spot?.name ?? UNKNOWN_SPOT_NAME,
      spotKind: spot?.kind,
      districtName: spots.findDistrict(entry.districtId)?.shortName ?? '',
      kind: entry.kind,
      points: Number(entry.points),
    });
  });
  return log.exit(recent);
}

/**
 * 獲得済みの銀・金カードの枚数を数える。
 * @param visits 訪問記録
 * @param views 地区の表示用ビュー
 * @returns 銀・金の枚数
 */
function cardCountsOf(visits: readonly VisitRecord[], views: readonly DistrictView[]): { silverCards: number; goldCards: number } {
  const log = logger.fn('cardCountsOf', { visits: visits.length, districts: views.length });
  const cards = views.flatMap((view) => cardsOf(visits, view.district.id));
  return log.exit({ silverCards: cards.filter((c) => c.rank === 'silver').length, goldCards: cards.filter((c) => c.rank === 'gold').length });
}

/**
 * 旅の日数（はじめて訪れた日を1日目として、今日が何日目か）を返す。
 * @param visits 訪問記録
 * @param today 今日
 * @returns 日数（未訪問なら undefined。デモで日付を戻しても 1 未満にはしない）
 */
export function travelDaysOf(visits: readonly VisitRecord[], today: LocalDate): number | undefined {
  const log = logger.fn('travelDaysOf', { visits: visits.length, today });
  let first: LocalDate | undefined;
  for (const visit of visits) {
    if (first === undefined || compareLocalDate(visit.localDate, first) < 0) first = visit.localDate;
  }
  if (first === undefined) return log.exit(undefined);
  return log.exit(Math.max(1, daysBetween(first, today) + 1));
}

/** 旅人ランクの状況を返す */
export class GetRankStatusUseCase implements UseCase<void, RankStatusDto> {
  /**
   * 依存を受け取る。
   * @param deps 旅人の世界を読む一式（台帳を含む）
   */
  constructor(private readonly deps: WorldDeps) {}

  /**
   * ランク画面の中身を返す。
   * @returns 成功: RankStatusDto（凍結済み）。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect セッション・旅人・台帳・地区の主・ライバル行動のリポジトリを読む（書込みはしない）
   */
  async execute(): Promise<Result<RankStatusDto>> {
    const log = logger.fn('execute');
    const world = await loadWorld(this.deps);
    if (!world.ok) return log.fail(world);
    const ledger = await this.deps.ledgers.find(world.value.traveler.id);
    if (!ledger.ok) return log.fail(ledger);
    const visits = world.value.traveler.visits;
    const views = districtViewsOf(world.value).sort((a, b) => a.district.order - b.district.order);
    const points = Number(ledger.value.balance());
    const rank = rankOf(points);
    const dto: RankStatusDto = Object.freeze({
      nickname: world.value.traveler.nickname,
      rank: Object.freeze({ name: rank.name, index: rank.index, nextName: RANK_THRESHOLDS[rank.index + 1]?.name, nextAt: rank.nextAt, remaining: rank.remaining }),
      steps: Object.freeze(rankStepsOf(rank.index)),
      points,
      totalVisits: visits.length,
      visitedSpots: new Set(visits.map((v) => v.spotId)).size,
      ...cardCountsOf(visits, views),
      lordDistricts: Object.freeze(views.filter((v) => v.standing.isMe).map((v) => v.district.shortName)),
      travelDays: travelDaysOf(visits, world.value.today),
      recent: Object.freeze(recentPointsOf(ledger.value.entries, this.deps.spots)),
      rules: Object.freeze({ landmarkPoints: VISIT_POINTS_LANDMARK, shopPoints: VISIT_POINTS_SHOP, welcomeBackMultiplier: WELCOME_BACK_MULTIPLIER }),
    });
    log.debug('ランク', { points, rank: rank.name, visits: dto.totalVisits, lords: dto.lordDistricts.length });
    return log.exit(ok(dto));
  }
}
