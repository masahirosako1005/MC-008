/**
 * @file クーポン・イベントの入力の確かめと、見え方の中身（presentation/cms/screens/Events）
 * 画面の上での確かめ（押したときに欄の下へ誤りを出す）。最終的な判定はユースケース（domain/revisit/ShopEventDraft）が行う。
 * 地図のお知らせが出る日はアプリと同じ計算（終わりの DEADLINE_NOTICE_DAYS 日前か、開始日の遅いほう）。
 */
import type { CmsShopInfoDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { addDays, compareLocalDate, daysBetween, parseLocalDate } from '@/Common/utils/date';
import { DEADLINE_NOTICE_DAYS, SHOP_EVENT_DESCRIPTION_MAX, SHOP_EVENT_MAX_DAYS, SHOP_EVENT_TITLE_MAX } from '@/domain/revisit/constants';
import { normalizeCmsText } from '@/domain/revisit/ShopEventDraft';
import type { PreviewContent, PreviewEvent, PreviewMode } from '@/presentation/cms/cmsPhonePreview';
import type { PeriodPresetId } from '@/presentation/cms/cmsTemplates';
import { mdDate } from '@/presentation/cms/cmsUi';

const logger = createLogger('presentation/cms/screens/Events/eventForm');

/** 種別の表示名（アプリの表示と同じ） */
export const KIND_LABELS = { coupon: 'クーポン', event: 'イベント' } as const;

/** 題名・説明が空のときに見え方に出す例 */
export const PLACEHOLDERS = { title: '例：メロンパン1個おまけ', description: '例：お会計のときにこの画面を見せてください' } as const;

/** 入力中の値 */
export interface EventDraft {
  kind: 'coupon' | 'event';
  title: string;
  description: string;
  start: string;
  end: string;
  /** 選んだよく使う期間（日付を手で変えたら undefined） */
  preset: PeriodPresetId | undefined;
}

/** 入力の誤り（欄ごと） */
export interface DraftProblems {
  readonly title?: string;
  readonly description?: string;
  readonly period?: string;
}

/**
 * 入力中の値を確かめる。
 * @param draft 入力中の値
 * @param today 今日
 * @returns 欄ごとの誤り（そろっていれば空）
 */
export function problemsOf(draft: EventDraft, today: string): DraftProblems {
  const log = logger.fn('problemsOf', { start: draft.start, end: draft.end });
  const title = normalizeCmsText(draft.title, SHOP_EVENT_TITLE_MAX) === undefined ? (draft.title.trim() === '' ? '題名を入れてください' : `題名は${SHOP_EVENT_TITLE_MAX}字までです`) : undefined;
  const description = normalizeCmsText(draft.description, SHOP_EVENT_DESCRIPTION_MAX) === undefined ? (draft.description.trim() === '' ? '説明を入れてください' : `説明は${SHOP_EVENT_DESCRIPTION_MAX}字までです`) : undefined;
  return log.exit({ ...(title ? { title } : {}), ...(description ? { description } : {}), ...periodProblem(draft, today) });
}

/**
 * 期間の誤りを返す。
 * @param draft 入力中の値
 * @param today 今日
 * @returns 誤り（無ければ空）
 */
function periodProblem(draft: EventDraft, today: string): Pick<DraftProblems, 'period'> {
  const log = logger.fn('periodProblem');
  const start = parseLocalDate(draft.start);
  const end = parseLocalDate(draft.end);
  const now = parseLocalDate(today);
  if (!start.ok || !now.ok || compareLocalDate(start.value, now.value) < 0) return log.exit({ period: '開始日は今日以降にしてください' });
  if (!end.ok || compareLocalDate(end.value, start.value) < 0) return log.exit({ period: '終了日は開始日以降にしてください' });
  if (daysBetween(start.value, end.value) + 1 > SHOP_EVENT_MAX_DAYS) return log.exit({ period: `期間は${SHOP_EVENT_MAX_DAYS}日までです` });
  return log.exit({});
}

/**
 * 期間の日数（「2日間」）。
 * @param period 開始日・終了日
 * @returns 文字（日付が不正なら空）
 */
export function periodDays(period: { readonly start: string; readonly end: string }): string {
  const log = logger.fn('periodDays');
  const start = parseLocalDate(period.start);
  const end = parseLocalDate(period.end);
  if (!start.ok || !end.ok || compareLocalDate(end.value, start.value) < 0) return log.exit('');
  return log.exit(`${daysBetween(start.value, end.value) + 1}日間`);
}

/**
 * 地図のお知らせが出始める日（終わりの DEADLINE_NOTICE_DAYS 日前か、開始日の遅いほう）。
 * @param period 開始日・終了日
 * @returns 日付（不正なら undefined）
 */
export function mapFromOf(period: { readonly start: string; readonly end: string }): string | undefined {
  const log = logger.fn('mapFromOf');
  const start = parseLocalDate(period.start);
  const end = parseLocalDate(period.end);
  if (!start.ok || !end.ok || compareLocalDate(end.value, start.value) < 0) return log.exit(undefined);
  const notice = addDays(end.value, -DEADLINE_NOTICE_DAYS);
  return log.exit(compareLocalDate(notice, start.value) > 0 ? notice : start.value);
}

/**
 * 地図のお知らせの中身（アプリの期限カードと同じ言い方。出始める日の見え方）。
 * @param info 店の情報
 * @param event クーポン・イベント
 * @returns 中身（日付が不正なら undefined）
 */
export function noticeOf(info: CmsShopInfoDto, event: Pick<PreviewEvent, 'kind' | 'title' | 'start' | 'end'>): PreviewContent['notice'] {
  const log = logger.fn('noticeOf', { start: event.start, end: event.end });
  const from = mapFromOf(event);
  const today = parseLocalDate(info.today);
  const fromDate = from === undefined ? undefined : parseLocalDate(from);
  const end = parseLocalDate(event.end);
  if (fromDate === undefined || !fromDate.ok || !end.ok || !today.ok) return log.exit(undefined);
  const day = compareLocalDate(fromDate.value, today.value) > 0 ? fromDate.value : today.value;
  const left = daysBetween(day, end.value);
  return log.exit({ title: `${info.name}の${KIND_LABELS[event.kind]}、${left <= 0 ? '今日まで' : `あと${left}日`}`, subtitle: event.title });
}

/**
 * 見え方の枠の下に出す1行（地図：表示が始まる日／お店のページ：開始前なら掲載が始まる日）。
 * @param info 店の情報
 * @param mode 見え方の種類
 * @param event 対象のクーポン・イベント（無ければ空）
 * @returns 16字以内
 */
export function captionOf(info: CmsShopInfoDto, mode: PreviewMode, event: Pick<PreviewEvent, 'start' | 'end'> | undefined): string {
  const log = logger.fn('captionOf', { mode });
  if (event === undefined) return log.exit('');
  if (mode === 'map') {
    const from = mapFromOf(event);
    return log.exit(from === undefined ? '' : `${mdDate(from)}から表示`);
  }
  return log.exit(event.start > info.today ? `${mdDate(event.start)}から掲載` : '');
}
