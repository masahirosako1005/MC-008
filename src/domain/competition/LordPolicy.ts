/**
 * @file 地区の主の決め方（domain/competition 層の純粋関数）
 * 直近30日（LORD_WINDOW_DAYS、今日を含む30暦日）の訪問回数で比べる（docs/08 D7）。
 * - 挑戦者は現職を「上回った」ときだけ交代（同数なら現職維持）
 * - 現職なしなら回数1以上の最多。同数は 旅人 → ライバルID昇順
 * 取り返しに必要な回数（D8）と、主を決めるための回数の集計もここに置く。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId } from '@/Common/types/Id';
import { addDays } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { isNonNegativeInteger } from '@/Common/utils/number';
import { LORD_WINDOW_DAYS } from '@/domain/competition/constants';
import { holderKey, rivalHolder, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';
import type { LordHolder } from '@/domain/competition/LordHolder';
import type { Rival, RivalActionVisit } from '@/domain/competition/Rival';
import { countRivalVisits } from '@/domain/competition/RivalActivity';
import { countVisitsInRange } from '@/domain/exploration/VisitStats';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';

const logger = createLogger('domain/competition/LordPolicy');

/** 主の候補とその回数 */
export interface LordCount {
  readonly holder: LordHolder;
  /** 集計期間内の訪問回数（0以上の整数） */
  readonly count: number;
}

/** decide の入力 */
export interface LordDecisionInput {
  /** 現職（主なしなら undefined） */
  readonly incumbent?: LordHolder;
  /** 候補ごとの回数（同じ候補が複数あれば最初の1件を使う） */
  readonly counts: readonly LordCount[];
}

/** 集計期間（両端を含む） */
export interface LordWindow {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

/** collectLordCounts の入力 */
export interface LordCountsInput {
  readonly districtId: DistrictId;
  /** 旅人の訪問記録 */
  readonly visits: readonly VisitRecord[];
  /** すべてのライバル */
  readonly rivals: readonly Rival[];
  /** 旅人の世界のライバル行動 */
  readonly actions: readonly RivalActionVisit[];
  /** 集計期間（通常は lordWindow(today)） */
  readonly window: LordWindow;
}

/**
 * 地区の主を決める集計期間を返す（今日を含む直近 LORD_WINDOW_DAYS=30 暦日）。
 * @param today 今日（JST 暦日）
 * @returns { from: today − 29日, to: today }
 */
export function lordWindow(today: LocalDate): LordWindow {
  return { from: addDays(today, -(LORD_WINDOW_DAYS - 1)), to: today };
}

/**
 * 同数のときの優先順で2候補を比べる（旅人が先、ライバルは ID 昇順）。
 * @param a 候補1
 * @param b 候補2
 * @returns a が先なら負、同じなら 0、b が先なら正
 */
function compareTieBreak(a: LordHolder, b: LordHolder): number {
  const log = logger.fn('compareTieBreak', { a: holderKey(a), b: holderKey(b) });
  if (a.type === 'traveler' || b.type === 'traveler') return log.exit(a.type === b.type ? 0 : a.type === 'traveler' ? -1 : 1);
  return log.exit(a.rivalId < b.rivalId ? -1 : a.rivalId > b.rivalId ? 1 : 0);
}

/**
 * 候補ごとの回数を、重複を除き不正な回数を0として整える。
 * @param counts 候補ごとの回数
 * @returns 候補キー → { holder, count }（入力順）
 */
function normalizeCounts(counts: readonly LordCount[]): Map<string, LordCount> {
  const log = logger.fn('normalizeCounts', { counts: counts.length });
  const byKey = new Map<string, LordCount>();
  for (const entry of counts) {
    const key = holderKey(entry.holder);
    if (byKey.has(key)) {
      log.warn('同じ候補が重複しているため後の値を無視', { key });
      continue;
    }
    if (!isNonNegativeInteger(entry.count)) log.warn('不正な回数を0として扱う', { key });
    byKey.set(key, { holder: entry.holder, count: isNonNegativeInteger(entry.count) ? entry.count : 0 });
  }
  return log.exit(byKey);
}

/**
 * 候補の中から最多の1人を選ぶ（同数は 旅人 → ライバルID昇順）。
 * @param candidates 候補（空でもよい）
 * @returns 最多の候補。空なら undefined
 */
function pickTop(candidates: readonly LordCount[]): LordCount | undefined {
  const log = logger.fn('pickTop', { candidates: candidates.length });
  let best: LordCount | undefined;
  for (const c of candidates) {
    if (best === undefined || c.count > best.count || (c.count === best.count && compareTieBreak(c.holder, best.holder) < 0)) best = c;
  }
  return log.exit(best);
}

/**
 * 地区の主を決める（D7）。
 * - 現職あり: 現職より回数が「多い」挑戦者のうち最多が交代。いなければ現職維持（同数・全員0回でも維持）
 * - 現職なし: 回数1以上の最多。誰も1回以上でなければ undefined
 * 現職の回数は counts から引く（無ければ0）。同数の優先は 旅人 → ライバルID昇順。
 * @param input 現職（任意）と候補ごとの回数
 * @returns 新しい主（主なしなら undefined）
 * @see docs/08 D7
 */
export function decide(input: LordDecisionInput): LordHolder | undefined {
  const log = logger.fn('decide', { incumbent: input.incumbent === undefined ? undefined : holderKey(input.incumbent), counts: input.counts.length });
  const byKey = normalizeCounts(input.counts);
  const incumbentKey = input.incumbent === undefined ? undefined : holderKey(input.incumbent);
  const threshold = incumbentKey === undefined ? 0 : (byKey.get(incumbentKey)?.count ?? 0);
  const challengers = [...byKey.entries()].filter(([key, c]) => key !== incumbentKey && c.count > threshold).map(([, c]) => c);
  const top = pickTop(challengers);
  log.debug('判定', { threshold, challengers: challengers.length, top: top === undefined ? undefined : holderKey(top.holder) });
  return log.exit(top === undefined ? input.incumbent : top.holder);
}

/**
 * 主を取り返すために必要な訪問回数を返す（D8: 主の回数 − 自分の回数 + 1。最低1回）。
 * 自分の回数が主を上回っていても、主の再判定は次の訪問で行われるため1回と返す。
 * @param lordCount 主の集計期間内の回数
 * @param myCount 旅人の集計期間内の回数
 * @returns 必要回数（1以上の整数）
 * @see docs/08 D8
 */
export function visitsNeededToReclaim(lordCount: number, myCount: number): number {
  const log = logger.fn('visitsNeededToReclaim', { lordCount, myCount });
  const lord = isNonNegativeInteger(lordCount) ? lordCount : 0;
  const mine = isNonNegativeInteger(myCount) ? myCount : 0;
  return log.exit(Math.max(1, lord - mine + 1));
}

/**
 * 地区の主を決めるための候補ごとの回数を集計する（旅人＋すべてのライバル。0回の候補も含む）。
 * 旅人は訪問記録の件数（D2）、ライバルは背景活動＋ライバル行動（D9）で数える。
 * @param input 地区・旅人の訪問記録・ライバル・ライバル行動・集計期間
 * @returns 候補ごとの回数（旅人が先頭、以降はライバルの入力順）
 */
export function collectLordCounts(input: LordCountsInput): LordCount[] {
  const log = logger.fn('collectLordCounts', { districtId: input.districtId, rivals: input.rivals.length, from: input.window.from, to: input.window.to });
  const { districtId, window } = input;
  const travelerCount = countVisitsInRange(input.visits, { districtId, from: window.from, to: window.to });
  const rivalCounts = input.rivals.map((rival): LordCount => ({
    holder: rivalHolder(rival.id),
    count: countRivalVisits({ rival, actions: input.actions, districtId, from: window.from, to: window.to }),
  }));
  return log.exit([{ holder: TRAVELER_HOLDER, count: travelerCount }, ...rivalCounts]);
}

/** 地区の主の決め方（`LordPolicy.decide(...)` と書ける名前空間） */
export const LordPolicy = Object.freeze({ decide, lordWindow, visitsNeededToReclaim, collectLordCounts });
