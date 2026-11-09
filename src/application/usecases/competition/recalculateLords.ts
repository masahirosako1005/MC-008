/**
 * @file 地区の主の再判定（application 層の共通部品・純粋関数）
 * 指定した地区ごとに直近30日（LordPolicy.lordWindow）の回数を集め（旅人＋ライバルの背景活動＋ライバル行動）、
 * LordPolicy.decide（D7）の結果を LordshipBoard.apply で盤に反映する。保存はしない（呼び出し側が1回だけ保存する＝DI-12）。
 * UpdateDistrictLordUseCase（訪問・日付進行・ライバル行動の後）と、旅人を作ったときの主の初期状態（現職なし）で同じ計算を使う。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import { holderKey, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';
import type { LordHolder } from '@/domain/competition/LordHolder';
import { collectLordCounts, decide, lordWindow } from '@/domain/competition/LordPolicy';
import type { LordCount } from '@/domain/competition/LordPolicy';
import type { LordshipBoard } from '@/domain/competition/LordshipBoard';
import type { Rival, RivalActionVisit } from '@/domain/competition/Rival';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';

const logger = createLogger('application/usecases/competition/recalculateLords');

/** recalculateLords の入力 */
export interface LordRecalcInput {
  /** いまの盤（現職はここから読む） */
  readonly board: LordshipBoard;
  /** 再判定する地区（重複は1回にまとめる） */
  readonly districtIds: readonly DistrictId[];
  /** 今日（集計期間の終端） */
  readonly today: LocalDate;
  /** 旅人の訪問記録 */
  readonly visits: readonly VisitRecord[];
  /** すべてのライバル（マスタ） */
  readonly rivals: readonly Rival[];
  /** 旅人の世界のライバル行動 */
  readonly actions: readonly RivalActionVisit[];
}

/** 1地区分の主の交代 */
export interface LordChange {
  readonly districtId: DistrictId;
  /** 交代前の主（初めて主が決まったときは無し） */
  readonly from?: LordHolder;
  /** 新しい主 */
  readonly to: LordHolder;
  /** 旅人の直近30日の訪問回数 */
  readonly travelerCount: number;
  /** 新しい主の直近30日の訪問回数 */
  readonly lordCount: number;
}

/** recalculateLords の結果 */
export interface LordRecalcResult {
  /** 反映後の盤（交代が無ければ入力と同じインスタンス） */
  readonly board: LordshipBoard;
  /** 交代した地区（入力の地区順） */
  readonly changes: readonly LordChange[];
}

/**
 * 候補ごとの回数から、指定した人の回数を取り出す。
 * @param counts 候補ごとの回数
 * @param holder 取り出す人
 * @returns 回数（候補に無ければ 0）
 */
function countOf(counts: readonly LordCount[], holder: LordHolder): number {
  return counts.find((entry) => holderKey(entry.holder) === holderKey(holder))?.count ?? 0;
}

/**
 * 指定した地区の主を再判定し、盤に反映する（保存はしない）。
 * @param input 盤・地区・今日・訪問記録・ライバル・ライバル行動
 * @returns 反映後の盤と交代の一覧
 * @see docs/08 D7, D8, D9
 */
export function recalculateLords(input: LordRecalcInput): LordRecalcResult {
  const log = logger.fn('recalculateLords', { districts: input.districtIds.length, today: input.today, actions: input.actions.length });
  const window = lordWindow(input.today);
  let board = input.board;
  const changes: LordChange[] = [];
  for (const districtId of new Set(input.districtIds)) {
    const counts = collectLordCounts({ districtId, visits: input.visits, rivals: input.rivals, actions: input.actions, window });
    const next = decide({ incumbent: board.holderOf(districtId), counts });
    const outcome = board.apply(districtId, next);
    if (!outcome.changed) continue;
    board = outcome.board;
    if (next === undefined) continue;
    const base = { districtId, to: next, travelerCount: countOf(counts, TRAVELER_HOLDER), lordCount: countOf(counts, next) };
    changes.push(Object.freeze(outcome.from === undefined ? base : { ...base, from: outcome.from }));
  }
  log.debug('再判定', { changed: changes.map((c) => c.districtId) });
  return log.exit(Object.freeze({ board, changes: Object.freeze(changes) }));
}
