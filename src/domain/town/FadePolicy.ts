/**
 * @file 地区の色あせルール（domain/town 層の純粋関数）
 * 最終訪問日からの JST 暦日差 d で決める（docs/08 D5）。d<23 fresh、23≦d<30 soon（そろそろ）、
 * d≧30 fading（progress = min(1, (d−30)/60)）、訪問なし never。数値はすべて constants.ts の（仮）定数。
 * 色あせは見た目だけの導出値で保存しない。成長段階・カード・図鑑・ポイントには影響しない（CLAUDE.md 4.3・DI-05）。
 */
import { createLogger } from '@/Common/logging/logger';
import { addDays, daysBetween } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { clamp } from '@/Common/utils/number';
import { FADE_MAX_DAYS, FADE_SOON_NOTICE_DAYS, FADE_START_DAYS } from '@/domain/town/constants';

const logger = createLogger('domain/town/FadePolicy');

/** 色あせ状態の種類 */
export const FADE_KINDS = ['never', 'fresh', 'soon', 'fading'] as const;

/** 色あせ状態の種類 */
export type FadeKind = (typeof FADE_KINDS)[number];

/** 一度も訪問していない（色あせの対象外） */
export interface FadeNever {
  readonly kind: 'never';
}

/** 色あせまで余裕がある */
export interface FadeFresh {
  readonly kind: 'fresh';
  /** 最終訪問からの日数（0以上） */
  readonly daysSinceVisit: number;
}

/** 色あせ間近（「そろそろ」カード・カレンダー追加の対象） */
export interface FadeSoon {
  readonly kind: 'soon';
  readonly daysSinceVisit: number;
  /** 色あせ開始まであと何日か（1〜FADE_SOON_NOTICE_DAYS） */
  readonly daysUntilFade: number;
  /** 色あせが始まる日（最終訪問日 + FADE_START_DAYS） */
  readonly fadeStartDate: LocalDate;
}

/** 色あせ中（再訪で復活する） */
export interface FadeFading {
  readonly kind: 'fading';
  readonly daysSinceVisit: number;
  /** 薄さ 0..1（色あせ開始日に 0、FADE_MAX_DAYS 日目以降は 1）。表示専用 */
  readonly progress: number;
  /** 色あせが始まった日（最終訪問日 + FADE_START_DAYS） */
  readonly fadeStartDate: LocalDate;
}

/** 色あせ状態（kind で判別するユニオン） */
export type FadeState = FadeNever | FadeFresh | FadeSoon | FadeFading;

/** 「そろそろ」になる最終訪問からの日数（FADE_START_DAYS − FADE_SOON_NOTICE_DAYS ＝ 23（仮）） */
const SOON_FROM_DAYS = FADE_START_DAYS - FADE_SOON_NOTICE_DAYS;

/** 色あせ開始から最も薄くなるまでの日数（FADE_MAX_DAYS − FADE_START_DAYS ＝ 60（仮）） */
const FADE_SPAN_DAYS = FADE_MAX_DAYS - FADE_START_DAYS;

/** 訪問なしの状態（共有の不変値） */
const NEVER: FadeNever = Object.freeze({ kind: 'never' });

/**
 * 色あせが始まる日を返す（最終訪問日 + FADE_START_DAYS）。カレンダー追加（ICS）の日付にも使う。
 * @param lastVisit 地区の最終訪問日（JST 暦日）
 * @returns 色あせ開始日
 */
export function fadeStartDate(lastVisit: LocalDate): LocalDate {
  return addDays(lastVisit, FADE_START_DAYS);
}

/**
 * 色あせの薄さ（0..1）を返す。色あせ開始日に 0、FADE_MAX_DAYS 日目で 1、以降は 1 のまま。
 * @param daysSinceVisit 最終訪問からの日数（FADE_START_DAYS 以上）
 * @returns 0..1 の薄さ
 */
function fadeProgress(daysSinceVisit: number): number {
  return clamp((daysSinceVisit - FADE_START_DAYS) / FADE_SPAN_DAYS, 0, 1);
}

/**
 * 最終訪問日と今日から色あせ状態を決める（D5）。同じ入力には常に同じ結果を返す（DI-05）。
 * 最終訪問日が今日より後（デモの日付巻き戻しなど）なら、0 日経過（fresh）として扱う。
 * @param lastVisit 地区の最終訪問日（JST 暦日）。訪問が無ければ undefined
 * @param today 今日（Clock.today()）
 * @returns 色あせ状態（never / fresh / soon / fading）
 */
export function stateFor(lastVisit: LocalDate | undefined, today: LocalDate): FadeState {
  const log = logger.fn('stateFor', { lastVisit, today });
  if (lastVisit === undefined) return log.exit(NEVER);
  const rawDays = daysBetween(lastVisit, today);
  if (rawDays < 0) log.warn('最終訪問日が今日より後のため 0 日経過として扱う', { daysSinceVisit: rawDays });
  const daysSinceVisit = Math.max(0, rawDays);
  if (daysSinceVisit < SOON_FROM_DAYS) {
    const fresh: FadeFresh = Object.freeze({ kind: 'fresh', daysSinceVisit });
    return log.exit(fresh);
  }
  const startDate = fadeStartDate(lastVisit);
  if (daysSinceVisit < FADE_START_DAYS) {
    const soon: FadeSoon = Object.freeze({ kind: 'soon', daysSinceVisit, daysUntilFade: FADE_START_DAYS - daysSinceVisit, fadeStartDate: startDate });
    return log.exit(soon);
  }
  const fading: FadeFading = Object.freeze({ kind: 'fading', daysSinceVisit, progress: fadeProgress(daysSinceVisit), fadeStartDate: startDate });
  return log.exit(fading);
}

/**
 * 色あせルールをまとめた名前空間（docs/08 の `FadePolicy.stateFor(...)` 表記で呼べるようにする）。
 * 名前付き import（stateFor・fadeStartDate）と同じ関数を指す。
 */
export const FadePolicy = Object.freeze({ stateFor, fadeStartDate });
