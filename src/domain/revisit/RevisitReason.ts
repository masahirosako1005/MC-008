/**
 * @file 再訪理由（トリガー）の型と優先順位（domain/revisit 層）
 * 下シート・通知で共通に使う「次に訪れる理由」。種別の優先順位は CLAUDE.md 4.5 の表の順（期限＞取り返し＞色あせ＞未訪問＞新着）。
 * 表現（アイコン・色）は Common/ui/cards/RevisitReasonCard、種別と並び順はここに集約する（docs/01 §3-11）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId, ShopEventId, SpotId } from '@/Common/types/Id';
import { assertNever } from '@/Common/utils/assert';
import type { LocalDate } from '@/Common/utils/date';

const logger = createLogger('domain/revisit/RevisitReason');

/** 再訪理由の種別（先頭ほど優先。CLAUDE.md 4.5 の表の順） */
export const REVISIT_REASON_PRIORITY = ['deadline', 'reclaim', 'fade', 'unvisited', 'new'] as const;

/** 再訪理由の種別 */
export type RevisitReasonKind = (typeof REVISIT_REASON_PRIORITY)[number];

/** 期限: 発見済みスポットのクーポン・イベントの終了が近い（D12） */
export interface DeadlineReason {
  readonly kind: 'deadline';
  readonly shopEventId: ShopEventId;
  readonly spotId: SpotId;
  readonly districtId: DistrictId;
  /** クーポン・イベントの題名（マスタの値） */
  readonly title: string;
  /** 終了日まであと何日か（当日終了なら 0） */
  readonly daysLeft: number;
}

/** 取り返し: 地区の主の座をライバルに奪われた（D8） */
export interface ReclaimReason {
  readonly kind: 'reclaim';
  readonly districtId: DistrictId;
  /** いまの地区の主の表示名 */
  readonly lordName: string;
  /** 地区の主の直近30日の訪問回数 */
  readonly lordCount: number;
  /** 旅人の直近30日の訪問回数 */
  readonly myCount: number;
  /** 取り返すのに必要な訪問回数（lordCount − myCount + 1、最小 1） */
  readonly needed: number;
}

/** 色あせ: 地区が色あせ間近（soon）または色あせ中（fading）（D5） */
export interface FadeReason {
  readonly kind: 'fade';
  readonly districtId: DistrictId;
  readonly state: 'soon' | 'fading';
  readonly daysSinceVisit: number;
  /** soon のとき、色あせ開始まであと何日か */
  readonly daysUntilFade?: number;
  /** 色あせ開始日（カレンダー追加用） */
  readonly fadeStartDate: LocalDate;
}

/** 未訪問: 発見済みでまだ行っていないスポットがある（地区ごとに1件） */
export interface UnvisitedReason {
  readonly kind: 'unvisited';
  readonly districtId: DistrictId;
  /** 発見済み・未訪問のスポット（id 昇順） */
  readonly spotIds: readonly SpotId[];
}

/** 新着: 新しく追加されたスポット（将来。v0.1 では生成しない） */
export interface NewReason {
  readonly kind: 'new';
  readonly spotId: SpotId;
  readonly districtId: DistrictId;
}

/** 再訪理由（kind で判別するユニオン） */
export type RevisitReason = DeadlineReason | ReclaimReason | FadeReason | UnvisitedReason | NewReason;

/**
 * 未検証の値が再訪理由の種別か判定する型ガード。
 * @param value 判定する値
 * @returns REVISIT_REASON_PRIORITY のいずれかなら true
 */
export function isRevisitReasonKind(value: unknown): value is RevisitReasonKind {
  return REVISIT_REASON_PRIORITY.some((kind) => kind === value);
}

/**
 * 種別の優先順位を返す（0 が最優先）。
 * @param kind 再訪理由の種別
 * @returns REVISIT_REASON_PRIORITY での位置
 */
export function priorityOf(kind: RevisitReasonKind): number {
  return REVISIT_REASON_PRIORITY.indexOf(kind);
}

/**
 * 同じ種別の中での緊急度キーを返す（辞書順に小さいほど先）。
 * 期限は残り日数の少ない順、取り返しは必要回数の少ない順、色あせは fading＞soon で経過日数の多い順、未訪問は件数の多い順。
 * @param reason 再訪理由
 * @returns 比較用の数値の並び
 */
function urgencyKeyOf(reason: RevisitReason): readonly number[] { // audit-ignore: fnlog-missing sort の比較で多数回呼ばれる純粋ヘルパー（呼び出し側 sortRevisitReasons でまとめてログ）
  switch (reason.kind) {
    case 'deadline':
      return [reason.daysLeft];
    case 'reclaim':
      return [reason.needed];
    case 'fade':
      return [reason.state === 'fading' ? 0 : 1, -reason.daysSinceVisit];
    case 'unvisited':
      return [-reason.spotIds.length];
    case 'new':
      return [];
    default:
      return assertNever(reason);
  }
}

/**
 * 同じ種別・同じ緊急度のときに並びを決める ID を返す（入力順に左右されない並びにする＝DI-05）。
 * @param reason 再訪理由
 * @returns 期限はクーポン・イベント ID、新着はスポット ID、それ以外は地区 ID
 */
function tieBreakIdOf(reason: RevisitReason): string {
  return reason.kind === 'deadline' ? reason.shopEventId : reason.kind === 'new' ? reason.spotId : reason.districtId;
}

/**
 * 数値の並びを辞書順に比べる（NaN は等しいとみなす）。
 * @param a 左辺
 * @param b 右辺
 * @returns a が先なら負、同じなら 0、後なら正
 */
function compareKeys(a: readonly number[], b: readonly number[]): number { // audit-ignore: fnlog-missing sort の比較で多数回呼ばれる純粋な算術ヘルパー
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
}

/**
 * 2つの再訪理由の表示順を比べる。種別の優先順位 → 同種内の緊急度 → ID 昇順 の順に決める。
 * @param a 左辺
 * @param b 右辺
 * @returns a が先なら負、同じなら 0、後なら正
 */
export function compareRevisitReasons(a: RevisitReason, b: RevisitReason): number { // audit-ignore: fnlog-missing sort の比較で多数回呼ばれる純粋ヘルパー（呼び出し側 sortRevisitReasons でまとめてログ）
  const byKind = priorityOf(a.kind) - priorityOf(b.kind);
  if (byKind !== 0) return byKind;
  const byUrgency = compareKeys(urgencyKeyOf(a), urgencyKeyOf(b));
  if (byUrgency !== 0) return byUrgency;
  const idA = tieBreakIdOf(a);
  const idB = tieBreakIdOf(b);
  return idA < idB ? -1 : idA > idB ? 1 : 0;
}

/**
 * 再訪理由を表示順に並べた新しい配列を返す（入力は変更しない）。
 * 種別優先（期限＞取り返し＞色あせ＞未訪問＞新着）→ 同種内は緊急度（残り日数・必要回数・fading＞soon・件数）→ ID 昇順。
 * @param reasons 再訪理由
 * @returns 並べ替えた新しい配列
 */
export function sortRevisitReasons(reasons: readonly RevisitReason[]): RevisitReason[] {
  const log = logger.fn('sortRevisitReasons', { count: reasons.length });
  const sorted = [...reasons].sort(compareRevisitReasons);
  log.debug('並べ替えた種別', { kinds: sorted.map((reason) => reason.kind) });
  return log.exit(sorted);
}
