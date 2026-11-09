/**
 * @file 営業時間（domain/spot 層の値オブジェクト）
 * 店舗CMS（docs/09 CMS-S02）で入力する「開店・閉店・定休日」と、表示用の文字列（例: '9:30–19:00（木休）'）の相互変換。
 * 表示用の文字列はマスタの hours と同じ書式にする（例「9:30–19:00（木休）」）。定休日なしは「（無休）」。
 * フェーズ1は全曜日共通の時間＋定休日だけを扱う（曜日ごとに違う時間はフェーズ2）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';

const logger = createLogger('domain/spot/BusinessHours');

/** 曜日の表示（0=月 … 6=日。マスタの「（月火休）」の並び） */
export const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const;

/** 時刻の書式（0:00〜24:00、分は2桁） */
const TIME_PATTERN = /^(\d|1\d|2[0-4]):([0-5]\d)$/;

/** 表示用の文字列の書式（例: '9:30–19:00（木休）'、'15:00–23:00（無休）'） */
const HOURS_TEXT_PATTERN = /^(\d{1,2}:\d{2})–(\d{1,2}:\d{2})（(無|[月火水木金土日]+)休）$/;

/** 営業時間（全曜日共通の時間と定休日） */
export interface BusinessHours {
  /** 開店（'H:MM'） */
  readonly open: string;
  /** 閉店（'H:MM'。24:00 まで） */
  readonly close: string;
  /** 定休日（0=月 … 6=日、昇順・重複なし） */
  readonly closedDays: readonly number[];
}

/**
 * 'H:MM' を 0時からの分に変換する。
 * @param time 時刻の文字列
 * @returns 分（書式が不正・24:00 超なら undefined）
 */
export function minutesOf(time: string): number | undefined {
  const log = logger.fn('minutesOf', { time });
  const match = TIME_PATTERN.exec(time);
  if (!match) return log.exit(undefined, 'format');
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return log.exit(minutes <= 24 * 60 ? minutes : undefined);
}

/**
 * 入力不正の失敗を作る。
 * @param field 不正な項目（open / close / closedDays）
 * @param message 画面に出せる説明
 * @returns INVALID_INPUT の失敗
 */
function invalid(field: string, message: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', message, { field }));
}

/**
 * 営業時間を作る（開店 < 閉店、定休日は 0〜6 で、全曜日休みにはできない）。
 * @param input 開店・閉店（'H:MM'）と定休日
 * @returns 成功: 凍結済みの営業時間（定休日は昇順）。失敗: INVALID_INPUT（details.field）
 */
export function createBusinessHours(input: { readonly open: string; readonly close: string; readonly closedDays: readonly number[] }): Result<BusinessHours> {
  const log = logger.fn('createBusinessHours', { open: input.open, close: input.close, closedDays: input.closedDays });
  const open = minutesOf(input.open);
  const close = minutesOf(input.close);
  if (open === undefined) return log.fail(invalid('open', '開店の時刻を選んでください'));
  if (close === undefined) return log.fail(invalid('close', '閉店の時刻を選んでください'));
  if (open >= close) return log.fail(invalid('close', '閉店は開店より後の時刻にしてください'));
  const days = [...new Set(input.closedDays)].sort((a, b) => a - b);
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d >= WEEKDAY_LABELS.length)) return log.fail(invalid('closedDays', '定休日が正しくありません'));
  if (days.length >= WEEKDAY_LABELS.length) return log.fail(invalid('closedDays', '全部の曜日を定休日にはできません'));
  return log.exit(ok(Object.freeze({ open: input.open, close: input.close, closedDays: Object.freeze(days) })));
}

/**
 * 営業時間を表示用の文字列にする（マスタの hours と同じ書式）。
 * @param hours 営業時間
 * @returns 例: '9:30–19:00（木休）'、定休日なしは '15:00–23:00（無休）'
 */
export function formatBusinessHours(hours: BusinessHours): string {
  const log = logger.fn('formatBusinessHours', { open: hours.open, close: hours.close });
  const days = hours.closedDays.map((d) => WEEKDAY_LABELS[d] ?? '').join('');
  return log.exit(`${hours.open}–${hours.close}（${days === '' ? '無' : days}休）`);
}

/**
 * 表示用の文字列を営業時間に戻す（CMS の入力欄の初期値用）。書式が違う文字列（'境内自由' など）は戻せない。
 * @param text マスタの hours
 * @returns 営業時間（戻せなければ undefined）
 */
export function parseBusinessHoursText(text: string): BusinessHours | undefined {
  const log = logger.fn('parseBusinessHoursText', { text });
  const match = HOURS_TEXT_PATTERN.exec(text);
  if (!match) return log.exit(undefined, 'format');
  const [, open = '', close = '', dayText = ''] = match;
  const closedDays = dayText === '無' ? [] : [...dayText].map((c) => WEEKDAY_LABELS.indexOf(c as (typeof WEEKDAY_LABELS)[number]));
  const hours = createBusinessHours({ open, close, closedDays });
  return log.exit(hours.ok ? hours.value : undefined);
}
