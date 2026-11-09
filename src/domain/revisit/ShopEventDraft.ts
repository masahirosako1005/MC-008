/**
 * @file 店舗CMS で登録するクーポン・イベントの規則（domain/revisit 層）
 * docs/09 §2.3 の規則を純粋関数にしたもの。
 * - 登録できるのは協力店（partner=true の店舗）だけ（CMS-E01）
 * - 題名 1〜30字・説明 1〜80字（NFC 正規化・前後の空白除去・制御文字なし＝DI-17）
 * - 期間は 開始 ≦ 終了（DI-02）、開始は今日以降、最長 90日（仮）（CMS-E04）
 * - 1店で同時に掲載中・掲載予定にできるのは 3件（仮）（CMS-E06）
 * 取り下げたクーポン・イベントは「期間を前日までに短縮」して配る。開始前に取り下げたものは配らない
 * （利用者が期間中に訪問して得た提灯アイテム＝D16 を消さないため。CMS-E08）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { codePointLength, hasControlChars } from '@/Common/utils/guards';
import { addDays, compareLocalDate, daysBetween, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import {
  SHOP_EVENT_DESCRIPTION_MAX,
  SHOP_EVENT_MAX_DAYS,
  SHOP_EVENT_MAX_OPEN_PER_SPOT,
  SHOP_EVENT_TITLE_MAX,
} from '@/domain/revisit/constants';
import { Period } from '@/domain/revisit/Period';
import { isShopEventKind } from '@/domain/revisit/ShopEvent';
import type { ShopEventKind } from '@/domain/revisit/ShopEvent';
import type { Spot } from '@/domain/spot/Spot';

const logger = createLogger('domain/revisit/ShopEventDraft');

/** 登録の失敗コード */
export type ShopEventDraftErrorCode = 'INVALID_INPUT' | 'NOT_PARTNER' | 'LIMIT_REACHED';

/** 期間を持つもの（掲載数の判定に使う） */
export interface HasPeriod {
  readonly period: Period;
}

/** 登録の入力（画面からの値は未検証） */
export interface ShopEventDraftInput {
  readonly spot: Spot;
  readonly kind: unknown;
  readonly title: unknown;
  readonly description: unknown;
  readonly start: unknown;
  readonly end: unknown;
  /** 今日（JST 暦日。Clock から） */
  readonly today: LocalDate;
  /** このスポットの、取り下げていないクーポン・イベント（マスタ＋CMS） */
  readonly existing: readonly HasPeriod[];
}

/** 検証済みの登録内容 */
export interface ValidShopEventDraft {
  readonly kind: ShopEventKind;
  readonly title: string;
  readonly description: string;
  readonly period: Period;
}

/**
 * 登録失敗の Result を作る。
 * @param code 失敗コード
 * @param message 画面に出せる説明
 * @param field 不正な項目（任意）
 * @returns 失敗
 */
function rejected(code: ShopEventDraftErrorCode, message: string, field?: string): Result<never, AppError<ShopEventDraftErrorCode>> {
  return fail(AppError.of(code, message, field === undefined ? undefined : { field }));
}

/**
 * CMS に入力された文字列を正規化する（NFC・前後の空白除去・制御文字なし・1〜max 文字）。
 * @param raw 入力値
 * @param max 最大文字数（コードポイント）
 * @returns 正規化した文字列（不正なら undefined）
 */
export function normalizeCmsText(raw: unknown, max: number): string | undefined {
  const log = logger.fn('normalizeCmsText', { max });
  if (typeof raw !== 'string') return log.exit(undefined, 'type');
  const text = raw.normalize('NFC').trim();
  if (text.length === 0 || hasControlChars(text) || codePointLength(text) > max) return log.exit(undefined, 'rule');
  return log.exit(text);
}

/**
 * まだ終わっていない（掲載中・掲載予定の）ものの数を返す。
 * @param events 期間を持つもの
 * @param today 今日
 * @returns 終了日が今日以降のものの数
 */
export function countOpenEvents(events: readonly HasPeriod[], today: LocalDate): number {
  const log = logger.fn('countOpenEvents', { count: events.length, today });
  return log.exit(events.filter((e) => compareLocalDate(e.period.end, today) >= 0).length);
}

/**
 * 期間を検証する（開始 ≦ 終了、開始は今日以降、最長 SHOP_EVENT_MAX_DAYS 日）。
 * @param start 開始日（未検証）
 * @param end 終了日（未検証）
 * @param today 今日
 * @returns 成功: 期間。失敗: INVALID_INPUT（field: start / end）
 */
function validatePeriod(start: unknown, end: unknown, today: LocalDate): Result<Period, AppError<ShopEventDraftErrorCode>> {
  const log = logger.fn('validatePeriod', { start, end, today });
  const startDate = parseLocalDate(start);
  if (!startDate.ok) return log.fail(rejected('INVALID_INPUT', '開始日を選んでください', 'start'));
  const endDate = parseLocalDate(end);
  if (!endDate.ok) return log.fail(rejected('INVALID_INPUT', '終了日を選んでください', 'end'));
  if (compareLocalDate(startDate.value, today) < 0) return log.fail(rejected('INVALID_INPUT', '開始日は今日以降にしてください', 'start'));
  const period = Period.of(startDate.value, endDate.value);
  if (!period.ok) return log.fail(rejected('INVALID_INPUT', '終了日は開始日以降にしてください', 'end'));
  if (daysBetween(period.value.start, period.value.end) + 1 > SHOP_EVENT_MAX_DAYS) {
    return log.fail(rejected('INVALID_INPUT', `期間は${SHOP_EVENT_MAX_DAYS}日以内にしてください`, 'end'));
  }
  return log.exit(ok(period.value));
}

/**
 * 店舗CMS のクーポン・イベント登録を検証する（docs/09 CMS-E01・E03・E04・E06）。
 * @param input スポット・入力値・今日・既存のクーポン・イベント
 * @returns 成功: 検証済みの内容。失敗: NOT_PARTNER（協力店でない）/ INVALID_INPUT（details.field）/ LIMIT_REACHED（同時掲載の上限）
 */
export function validateShopEventDraft(input: ShopEventDraftInput): Result<ValidShopEventDraft, AppError<ShopEventDraftErrorCode>> {
  const log = logger.fn('validateShopEventDraft', { spotId: input.spot.id, kind: input.kind, today: input.today });
  if (input.spot.kind !== 'shop' || !input.spot.partner) return log.fail(rejected('NOT_PARTNER', 'クーポン・イベントは協力店だけが登録できます'));
  if (!isShopEventKind(input.kind)) return log.fail(rejected('INVALID_INPUT', '種別を選んでください', 'kind'));
  const title = normalizeCmsText(input.title, SHOP_EVENT_TITLE_MAX);
  if (title === undefined) return log.fail(rejected('INVALID_INPUT', `題名は1〜${SHOP_EVENT_TITLE_MAX}字で入力してください`, 'title'));
  const description = normalizeCmsText(input.description, SHOP_EVENT_DESCRIPTION_MAX);
  if (description === undefined) return log.fail(rejected('INVALID_INPUT', `説明は1〜${SHOP_EVENT_DESCRIPTION_MAX}字で入力してください`, 'description'));
  const period = validatePeriod(input.start, input.end, input.today);
  if (!period.ok) return log.fail(period);
  if (countOpenEvents(input.existing, input.today) >= SHOP_EVENT_MAX_OPEN_PER_SPOT) {
    return log.fail(rejected('LIMIT_REACHED', `同時に掲載できるのは${SHOP_EVENT_MAX_OPEN_PER_SPOT}件までです。終わったものか取り下げたものの枠が空いてから登録してください`));
  }
  return log.exit(ok(Object.freeze({ kind: input.kind, title, description, period: period.value })));
}

/**
 * 取り下げたクーポン・イベントの、配る期間を返す（前日までに短縮。開始前に取り下げたものは配らない）。
 * @param period 登録時の期間
 * @param withdrawnOn 取り下げた日
 * @returns 配る期間（配らないなら undefined）
 */
export function periodAfterWithdrawal(period: Period, withdrawnOn: LocalDate): Period | undefined {
  const log = logger.fn('periodAfterWithdrawal', { start: period.start, end: period.end, withdrawnOn });
  if (compareLocalDate(withdrawnOn, period.start) <= 0) return log.exit(undefined, 'beforeStart');
  const lastDay = addDays(withdrawnOn, -1);
  const end = compareLocalDate(lastDay, period.end) < 0 ? lastDay : period.end;
  const shortened = Period.of(period.start, end);
  return log.exit(shortened.ok ? shortened.value : undefined);
}
