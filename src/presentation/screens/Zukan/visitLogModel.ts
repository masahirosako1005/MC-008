/**
 * @file 記録（訪問の年表）の表示を決める純粋関数（presentation/screens/Zukan 層）
 * 月ごとのまとめ・読み上げ名・「n回目」・写真の縮小後の大きさを DOM と切り離して決め、テストできるようにする。
 * 達成率（％や「全n件中m件」）は作らない（CLAUDE.md 6.5）。
 */
import type { VisitLogEntryDto } from '@/application/dto/VisitLogDto';
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/screens/Zukan/visitLogModel');

/** 図鑑画面の表示の切替（図鑑＝カードの格子、記録＝訪問の年表） */
export type ZukanMode = 'zukan' | 'log';

/** 切替の選択肢（左から） */
export const ZUKAN_MODES: readonly { readonly value: ZukanMode; readonly label: string }[] = [
  { value: 'zukan', label: '図鑑' },
  { value: 'log', label: '記録' },
];

/** 記録が1件も無いときの文言 */
export const EMPTY_LOG_TEXT = 'なし';

/** 月ごとのまとまり */
export interface VisitLogMonth {
  readonly monthKey: string;
  readonly monthLabel: string;
  readonly entries: readonly VisitLogEntryDto[];
}

/**
 * 記録を月ごとにまとめる（順番は保つ＝新しい月が先）。
 * @param entries 記録（新しい順）
 * @returns 月ごとのまとまり
 */
export function groupByMonth(entries: readonly VisitLogEntryDto[]): VisitLogMonth[] {
  const log = logger.fn('groupByMonth', { count: entries.length });
  const months: { monthKey: string; monthLabel: string; entries: VisitLogEntryDto[] }[] = [];
  for (const entry of entries) {
    const last = months[months.length - 1];
    if (last !== undefined && last.monthKey === entry.monthKey) last.entries.push(entry);
    else months.push({ monthKey: entry.monthKey, monthLabel: entry.monthLabel, entries: [entry] });
  }
  return log.exit(months);
}

/**
 * 「このスポットで何回目」の文言。
 * @param nth 回数（1 から）
 * @returns '3回目'
 */
export function nthLabel(nth: number): string {
  const log = logger.fn('nthLabel', { nth });
  return log.exit(nth <= 1 ? 'はじめて' : `${nth}回目`);
}

/**
 * 記録1件の読み上げ名（写真・メモの有無も言葉で伝える）。メモの中身は読み上げ名に入れない（開いてから読む）。
 * @param entry 記録
 * @returns '11/2（月）N西城跡、城下、3回目、写真あり、メモあり' など
 */
export function entryAriaLabel(entry: VisitLogEntryDto): string {
  const log = logger.fn('entryAriaLabel', { spotId: entry.spotId, nth: entry.nth });
  const parts = [`${entry.dateLabel}${entry.spotName}`, entry.districtName, nthLabel(entry.nth)];
  if (entry.photo !== undefined) parts.push('写真あり');
  if (entry.note !== undefined) parts.push('メモあり');
  return log.exit(parts.filter((p) => p.length > 0).join('、'));
}

/**
 * 写真を長辺 maxSide に収める縮小後の大きさを返す（拡大はしない）。
 * @param width 元の幅
 * @param height 元の高さ
 * @param maxSide 長辺の上限
 * @returns 縮小後の幅と高さ（整数・1以上）
 */
export function fitWithin(width: number, height: number, maxSide: number): { readonly width: number; readonly height: number } {
  const log = logger.fn('fitWithin', { width, height, maxSide });
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return log.exit({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) });
}
