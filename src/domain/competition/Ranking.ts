/**
 * @file 月間ランキング（domain/competition 層の値オブジェクト）
 * 順位は「通った回数」で決める（ポイントではない＝docs/08 D10）。同数は同順位（1, 2, 2, 4）。
 * 一時点のスナップショット（参加者と回数の一覧＋基準日 asOf）から作り、作成後は変わらない（DI-24）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { LocalDate } from '@/Common/utils/date';
import { isNonNegativeInteger } from '@/Common/utils/number';

const logger = createLogger('domain/competition/Ranking');

/** ランキングの参加者（旅人またはライバル） */
export interface RankingParticipant {
  /** 一意なキー（例: holderKey の 'traveler' / 'rival:r_taro'） */
  readonly key: string;
  /** 表示名 */
  readonly name: string;
  /** 旅人（自分）か */
  readonly isMe: boolean;
  /** 集計期間の訪問回数（0以上の整数） */
  readonly count: number;
}

/** ランキングの1行 */
export interface RankingEntry extends RankingParticipant {
  /** 順位（1始まり。同数は同順位で、次の順位は人数分飛ぶ） */
  readonly rank: number;
}

/** Ranking.from の入力（一時点のスナップショット） */
export interface RankingSnapshot {
  readonly participants: readonly RankingParticipant[];
  /** 集計の基準日（JST 暦日） */
  readonly asOf: LocalDate;
}

/** ランキング（不変） */
export interface Ranking {
  readonly asOf: LocalDate;
  /** 順位の昇順（同順位内は 自分 → 名前昇順 → キー昇順） */
  readonly entries: readonly RankingEntry[];
}

/**
 * 表示順で2人を比べる（回数の降順 → 自分を先 → 名前の昇順 → キーの昇順）。
 * 名前とキーはコード単位で比べ、実行環境のロケールに左右されないようにする（DI-05）。
 * @param a 参加者1
 * @param b 参加者2
 * @returns a が先なら負、b が先なら正
 */
function compareParticipants(a: RankingParticipant, b: RankingParticipant): number { // audit-ignore: fnlog-missing ソートの比較関数で多数回呼ばれる（呼び出し側 rankingFrom でまとめてログ）
  if (a.count !== b.count) return b.count - a.count;
  if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * 参加者を整える（キーの重複は最初の1件だけ残し、不正な回数は0として扱う）。
 * @param participants 参加者
 * @returns 整えた参加者の新しい配列（入力順）
 */
function normalizeParticipants(participants: readonly RankingParticipant[]): RankingParticipant[] {
  const log = logger.fn('normalizeParticipants', { participants: participants.length });
  const seen = new Set<string>();
  const result: RankingParticipant[] = [];
  for (const p of participants) {
    if (seen.has(p.key)) {
      log.warn('同じキーの参加者を無視', { key: p.key });
      continue;
    }
    seen.add(p.key);
    if (!isNonNegativeInteger(p.count)) log.warn('不正な回数を0として扱う', { key: p.key });
    result.push({ key: p.key, name: p.name, isMe: p.isMe, count: isNonNegativeInteger(p.count) ? p.count : 0 });
  }
  return log.exit(result);
}

/**
 * スナップショットからランキングを作る（回数の降順。同数は同順位 1, 2, 2, 4）。
 * @param snapshot 参加者と回数の一覧・基準日
 * @returns 凍結済みのランキング
 * @see docs/08 D10, docs/06 DI-24
 */
function rankingFrom(snapshot: RankingSnapshot): Ranking {
  const log = logger.fn('Ranking.from', { participants: snapshot.participants.length, asOf: snapshot.asOf });
  const sorted = normalizeParticipants(snapshot.participants).sort(compareParticipants);
  const entries: RankingEntry[] = [];
  for (const [index, p] of sorted.entries()) {
    const previous = entries[index - 1];
    const rank = previous !== undefined && previous.count === p.count ? previous.rank : index + 1;
    entries.push(Object.freeze({ ...p, rank }));
  }
  return log.exit(Object.freeze({ asOf: snapshot.asOf, entries: Object.freeze(entries) }));
}

/** ランキングのファクトリ（interface と同名の値。`Ranking.from(...)` と書ける） */
export const Ranking = Object.freeze({ from: rankingFrom });
