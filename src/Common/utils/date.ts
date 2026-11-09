/**
 * @file 日時の値型と純粋な日付計算（Common 層。new Date を使ってよい2か所のうちの1つ＝DI-03）
 * - Instant: UTC の ISO 8601（'YYYY-MM-DDTHH:mm:ss.sssZ'）。保存・比較はこれで行う（DI-04）
 * - LocalDate: Asia/Tokyo の暦日 'YYYY-MM-DD'。JST=UTC+9 固定（DST なし）で計算し、Intl に依存しない
 * 暦日の変換は Howard Hinnant の days_from_civil / civil_from_days（グレゴリオ暦・負の日数も可）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { Brand } from '@/Common/types/Brand';
import { invariant } from '@/Common/utils/assert';
import { positiveMod } from '@/Common/utils/number';

const logger = createLogger('Common/utils/date');

/** UTC の瞬間（ISO 8601、ミリ秒3桁、末尾 Z） */
export type Instant = Brand<string, 'Instant'>;
/** Asia/Tokyo の暦日（'YYYY-MM-DD'） */
export type LocalDate = Brand<string, 'LocalDate'>;
/** 季節（3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬） */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** 季節の一覧（四季カード判定などで使う） */
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** 1日・1時間・1分のミリ秒 */
export const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
/** JST の UTC からのずれ（+9時間固定） */
export const JST_OFFSET_MS = 9 * MS_PER_HOUR;

/** 扱える範囲（西暦 0000-01-01T00:00:00.000Z 〜 9999-12-31T23:59:59.999Z） */
const MIN_EPOCH_MS = -62_167_219_200_000;
const MAX_EPOCH_MS = 253_402_300_799_999;

/** 書式（範囲チェックの一部も正規表現で行う） */
const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)\.(\d{3})Z$/;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 月ごとの季節（1月→winter …） */
const SEASON_BY_MONTH: readonly Season[] = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];
/** 平年の月ごとの日数 */
const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** 曜日（日曜始まり） */
const WEEKDAYS_JA = '日月火水木金土';

/** 年月日の組 */
interface Ymd {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

/**
 * 2桁ゼロ埋めする。
 * @param n 0以上の整数
 * @returns 2桁以上の文字列
 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 閏年か判定する（グレゴリオ暦）。
 * @param year 西暦
 * @returns 閏年なら true
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * その月の日数を返す。
 * @param year 西暦
 * @param month 月（1〜12）
 * @returns 28〜31
 */
export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 31);
}

/**
 * 'YYYY-MM-DD…' 形式の先頭10文字から年月日を取り出す（Instant / LocalDate 共通。書式は検証済みが前提）。
 * @param text LocalDate または Instant
 * @returns 年月日
 */
function ymdOf(text: string): Ymd {
  return { y: Number(text.slice(0, 4)), m: Number(text.slice(5, 7)), d: Number(text.slice(8, 10)) };
}

/**
 * 年月日として正しいか（月 1〜12、日がその月の範囲内）判定する。
 * @param ymd 年月日
 * @returns 正しければ true
 */
function isValidYmd(ymd: Ymd): boolean {
  return ymd.m >= 1 && ymd.m <= 12 && ymd.d >= 1 && ymd.d <= daysInMonth(ymd.y, ymd.m);
}

/**
 * 年月日を 1970-01-01 からの日数にする（Hinnant days_from_civil）。
 * @param ymd 年月日
 * @returns 1970-01-01 を 0 とする日数（負もあり）
 */
function daysFromCivil(ymd: Ymd): number { // audit-ignore: fnlog-missing 日付計算の中核となる純粋な算術ヘルパー（ループで多数回呼ばれる）
  const y = ymd.m <= 2 ? ymd.y - 1 : ymd.y;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * ((ymd.m + 9) % 12) + 2) / 5) + ymd.d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/**
 * 1970-01-01 からの日数を年月日にする（Hinnant civil_from_days）。
 * @param epochDay 1970-01-01 を 0 とする日数（整数）
 * @returns 年月日
 */
function civilFromDays(epochDay: number): Ymd { // audit-ignore: fnlog-missing 日付計算の中核となる純粋な算術ヘルパー（ループで多数回呼ばれる）
  const z = epochDay + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d: doy - Math.floor((153 * mp + 2) / 5) + 1 };
}

/**
 * 1970-01-01 からの日数を LocalDate にする。
 * @param epochDay 日数（整数）
 * @returns LocalDate
 */
export function localDateFromEpochDay(epochDay: number): LocalDate { // audit-ignore: fnlog-missing 日付計算の中核となる純粋な算術ヘルパー（ループで多数回呼ばれる）
  const ymd = civilFromDays(Math.trunc(epochDay));
  return `${String(ymd.y).padStart(4, '0')}-${pad2(ymd.m)}-${pad2(ymd.d)}` as LocalDate;
}

/**
 * LocalDate を 1970-01-01 からの日数にする（ライバル背景活動の位相計算・日数差に使う）。
 * @param date LocalDate
 * @returns 日数（1970-01-01 = 0）
 */
export function epochDayOf(date: LocalDate): number {
  return daysFromCivil(ymdOf(date));
}

/**
 * Instant の時刻部分（その UTC 日の 0 時からのミリ秒）を返す。
 * @param instant Instant
 * @returns 0 以上 MS_PER_DAY 未満のミリ秒
 */
function timeOfDayMs(instant: Instant): number {
  return Number(instant.slice(11, 13)) * MS_PER_HOUR + Number(instant.slice(14, 16)) * MS_PER_MINUTE + Number(instant.slice(17, 19)) * 1000 + Number(instant.slice(20, 23));
}

/**
 * Unix エポックミリ秒を Instant にする。
 * @param ms エポックミリ秒（有限数。小数は切り捨て。西暦 0〜9999 の範囲）
 * @returns Instant
 * @throws Error 範囲外・非有限（呼び出し側のバグ）
 */
export function instantFromEpochMs(ms: number): Instant {
  const log = logger.fn('instantFromEpochMs');
  invariant(Number.isFinite(ms) && ms >= MIN_EPOCH_MS && ms <= MAX_EPOCH_MS, 'instantFromEpochMs: 範囲外の時刻');
  return log.exit(new Date(Math.floor(ms)).toISOString() as Instant);
}

/**
 * Instant を Unix エポックミリ秒にする。
 * @param instant Instant（検証済み）
 * @returns エポックミリ秒
 */
export function epochMsOf(instant: Instant): number {
  return daysFromCivil(ymdOf(instant)) * MS_PER_DAY + timeOfDayMs(instant);
}

/**
 * 未検証の値を Instant として検証する（保存データ・外部入力の境界で使う＝DI-01）。
 * 受け付けるのは 'YYYY-MM-DDTHH:mm:ss.sssZ' のみ（オフセット表記・ミリ秒なしは不可）。
 * @param raw 未検証の値
 * @returns 成功: Instant。失敗: INVALID_INPUT
 */
export function parseInstant(raw: unknown): Result<Instant> {
  const log = logger.fn('parseInstant');
  if (typeof raw !== 'string' || !INSTANT_PATTERN.test(raw) || !isValidYmd(ymdOf(raw))) {
    return log.fail(fail(AppError.of('INVALID_INPUT', '日時の形式が正しくありません', { kind: 'Instant' })));
  }
  return log.exit(ok(raw as Instant));
}

/**
 * 未検証の値を LocalDate として検証する（'YYYY-MM-DD'、実在する日付のみ）。
 * @param raw 未検証の値
 * @returns 成功: LocalDate。失敗: INVALID_INPUT
 */
export function parseLocalDate(raw: unknown): Result<LocalDate> {
  const log = logger.fn('parseLocalDate');
  if (typeof raw !== 'string' || !LOCAL_DATE_PATTERN.test(raw) || !isValidYmd(ymdOf(raw))) {
    return log.fail(fail(AppError.of('INVALID_INPUT', '日付の形式が正しくありません', { kind: 'LocalDate' })));
  }
  return log.exit(ok(raw as LocalDate));
}

/**
 * Instant が JST で何日か（暦日）を返す。1日1回・色あせの日付境界はこれで判定する（DI-04）。
 * 例: '2026-11-08T14:59:59.999Z'（JST 23:59:59）→ '2026-11-08'、'2026-11-08T15:00:00.000Z' → '2026-11-09'。
 * @param instant Instant
 * @returns JST の LocalDate
 */
export function localDateOf(instant: Instant): LocalDate {
  return localDateFromEpochDay(Math.floor((epochMsOf(instant) + JST_OFFSET_MS) / MS_PER_DAY));
}

/**
 * LocalDate に日数を足す（負なら引く）。月末・年末・閏年をまたいでも正しく進む。
 * @param date 起点
 * @param days 足す日数（整数。小数は 0 方向に切り捨て）
 * @returns 新しい LocalDate
 */
export function addDays(date: LocalDate, days: number): LocalDate {
  return localDateFromEpochDay(epochDayOf(date) + Math.trunc(days));
}

/**
 * 2つの暦日の差（to − from）を整数日で返す。同日なら 0、to が前なら負。
 * @param from 起点
 * @param to 終点
 * @returns 日数差
 */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return epochDayOf(to) - epochDayOf(from);
}

/**
 * 2つの LocalDate を比較する（書式が固定幅なので文字列比較で暦順になる）。
 * @param a 左辺
 * @param b 右辺
 * @returns a が前なら負、同じなら 0、後なら正
 */
export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 2つの Instant を比較する（書式が固定幅なので文字列比較で時刻順になる）。
 * @param a 左辺
 * @param b 右辺
 * @returns a が前なら負、同じなら 0、後なら正
 */
export function compareInstant(a: Instant, b: Instant): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 月キー（'YYYY-MM'）を返す。月間ランキングの集計単位（D10）。
 * @param date LocalDate
 * @returns 'YYYY-MM'
 */
export function monthKeyOf(date: LocalDate): string {
  return date.slice(0, 7);
}

/**
 * その月の1日を返す。
 * @param date LocalDate
 * @returns 同じ月の1日
 */
export function startOfMonth(date: LocalDate): LocalDate {
  return `${monthKeyOf(date)}-01` as LocalDate;
}

/**
 * その月の末日を返す（閏年の2月は29日）。
 * @param date LocalDate
 * @returns 同じ月の末日
 */
export function endOfMonth(date: LocalDate): LocalDate {
  const log = logger.fn('endOfMonth', { date });
  const ymd = ymdOf(date);
  return log.exit(`${monthKeyOf(date)}-${pad2(daysInMonth(ymd.y, ymd.m))}` as LocalDate);
}

/**
 * 季節を返す（3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬）。四季カードの判定に使う。
 * @param date LocalDate
 * @returns 季節
 */
export function seasonOf(date: LocalDate): Season {
  return SEASON_BY_MONTH[Number(date.slice(5, 7)) - 1] ?? 'winter';
}

/**
 * 曜日番号を返す（0=日曜 … 6=土曜）。1970-01-01 は木曜（4）。
 * @param date LocalDate
 * @returns 0〜6
 */
export function dayOfWeekOf(date: LocalDate): number {
  return positiveMod(epochDayOf(date) + 4, 7);
}

/**
 * JST の暦日と時刻から Instant を作る（デモシード・テスト・ICS 用）。
 * @param date JST の暦日
 * @param hour JST の時（0〜23、既定 12）
 * @param minute 分（0〜59、既定 0）
 * @returns Instant
 * @throws Error 時・分が範囲外（呼び出し側のバグ）
 */
export function jstInstantOf(date: LocalDate, hour = 12, minute = 0): Instant {
  const log = logger.fn('jstInstantOf', { date, hour, minute });
  invariant(Number.isInteger(hour) && hour >= 0 && hour <= 23, 'jstInstantOf: 時が範囲外');
  invariant(Number.isInteger(minute) && minute >= 0 && minute <= 59, 'jstInstantOf: 分が範囲外');
  return log.exit(instantFromEpochMs(epochDayOf(date) * MS_PER_DAY - JST_OFFSET_MS + hour * MS_PER_HOUR + minute * MS_PER_MINUTE));
}

/**
 * 画面表示用の日付（例: '2026/11/09（月）'）。
 * @param date LocalDate
 * @returns 'YYYY/MM/DD（曜）'
 */
export function formatJpDate(date: LocalDate): string {
  const log = logger.fn('formatJpDate', { date });
  const ymd = ymdOf(date);
  const weekday = WEEKDAYS_JA.charAt(dayOfWeekOf(date));
  return log.exit(`${String(ymd.y).padStart(4, '0')}/${pad2(ymd.m)}/${pad2(ymd.d)}（${weekday}）`);
}

/**
 * 画面表示用の JST 時刻（例: '9:41'。時はゼロ埋めしない）。
 * @param instant Instant
 * @returns 'H:mm'
 */
export function formatJpTime(instant: Instant): string {
  const log = logger.fn('formatJpTime');
  const msOfDay = positiveMod(epochMsOf(instant) + JST_OFFSET_MS, MS_PER_DAY);
  const hour = Math.floor(msOfDay / MS_PER_HOUR);
  const minute = Math.floor((msOfDay % MS_PER_HOUR) / MS_PER_MINUTE);
  return log.exit(`${hour}:${pad2(minute)}`);
}
