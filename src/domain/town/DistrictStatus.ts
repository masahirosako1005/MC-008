/**
 * @file 地区の状態サマリ（domain/town 層の純粋関数）
 * 訪問記録と今日の日付から、成長段階・建物数・通った回数・色あせ・次の目標をまとめて導出する（地区カード・マイ街・地図）。
 * 保存値に頼らず毎回計算する（DI-05）。成長は訪問記録の件数から導出するため、今日の日付が進んでも下がらない（D4）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { distinctSpotCount, lastVisitDate, visitsInDistrict } from '@/domain/exploration/VisitStats';
import type { District } from '@/domain/town/District';
import { stateFor } from '@/domain/town/FadePolicy';
import type { FadeState } from '@/domain/town/FadePolicy';
import { buildingsFor, growthScore, levelFor, nextGoal } from '@/domain/town/GrowthPolicy';
import type { GrowthGoal, GrowthLevel } from '@/domain/town/GrowthPolicy';

const logger = createLogger('domain/town/DistrictStatus');

/** 地区の状態サマリ */
export interface DistrictStatus {
  readonly districtId: DistrictId;
  /** 成長段階 0〜3（下がらない） */
  readonly level: GrowthLevel;
  /** 成長スコア（種類数 + 訪問回数） */
  readonly score: number;
  /** 描く建物の数（min(score, MAX_BUILDINGS)） */
  readonly buildings: number;
  /** 通った回数（訪問記録の件数＝D2） */
  readonly visitCount: number;
  /** 訪問したスポットの種類数 */
  readonly distinctSpots: number;
  /** 最終訪問日（訪問なしなら無し） */
  readonly lastVisit?: LocalDate;
  /** 色あせ状態（見た目だけ） */
  readonly fade: FadeState;
  /** 次の成長目標（Lv3 なら無し） */
  readonly nextGoal?: GrowthGoal;
}

/** districtStatusOf の入力 */
export interface DistrictStatusInput {
  /** 対象の地区 */
  readonly district: District;
  /** 旅人の全訪問記録（他地区の記録が混ざっていてよい。対象地区の分だけ数える） */
  readonly visits: readonly VisitRecord[];
  /** 今日（Clock.today()）。色あせの判定だけに使う */
  readonly today: LocalDate;
}

/**
 * 地区の状態サマリを導出する。
 * 成長（level・score・buildings・visitCount・distinctSpots）は訪問記録だけから決まり today に依存しない。
 * today は色あせ（FadePolicy.stateFor）の判定にだけ使う。訪問記録の並び順は結果に影響しない。
 * @param input 地区・訪問記録・今日
 * @returns 地区の状態サマリ（凍結済み）
 */
export function districtStatusOf(input: DistrictStatusInput): DistrictStatus {
  const log = logger.fn('districtStatusOf', { districtId: input.district.id, visits: input.visits.length, today: input.today });
  const { district, visits, today } = input;
  const visitCount = visitsInDistrict(visits, district.id).length;
  const distinctSpots = distinctSpotCount(visits, district.id);
  const score = growthScore(distinctSpots, visitCount);
  const lastVisit = lastVisitDate(visits, district.id);
  const goal = nextGoal(score);
  const status: DistrictStatus = Object.freeze({
    districtId: district.id,
    level: levelFor(score),
    score,
    buildings: buildingsFor(score),
    visitCount,
    distinctSpots,
    ...(lastVisit === undefined ? {} : { lastVisit }),
    fade: stateFor(lastVisit, today),
    ...(goal === undefined ? {} : { nextGoal: goal }),
  });
  return log.exit(status);
}
