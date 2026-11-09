/**
 * @file クーポン・イベントの入力の検証と見え方（presentation/cms/screens/Events）
 * 画面の上での確かめ（入力中に「あと何が足りないか」を見せる）。最終的な判定はユースケース（domain/revisit/ShopEventDraft）が行う。
 */
import type { CmsShopInfoDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { compareLocalDate, daysBetween, parseLocalDate } from '@/Common/utils/date';
import { h } from '@/Common/ui/dom';
import { DEADLINE_NOTICE_DAYS, SHOP_EVENT_DESCRIPTION_MAX, SHOP_EVENT_MAX_DAYS, SHOP_EVENT_TITLE_MAX } from '@/domain/revisit/constants';
import { normalizeCmsText } from '@/domain/revisit/ShopEventDraft';
import type { PeriodPresetId } from '@/presentation/cms/cmsTemplates';
import { shortDate } from '@/presentation/cms/cmsUi';

const logger = createLogger('presentation/cms/screens/Events/eventForm');

/** 種別の表示名 */
export const KIND_LABELS = { coupon: 'クーポン', event: 'イベント' } as const;

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
 * 入力中の値を確かめる（掲載に必要なものがそろっているか）。
 * @param draft 入力中の値
 * @param today 今日
 * @returns 欄ごとの誤り（そろっていれば空）
 */
export function problemsOf(draft: EventDraft, today: string): DraftProblems {
  const log = logger.fn('problemsOf', { start: draft.start, end: draft.end });
  const title = normalizeCmsText(draft.title, SHOP_EVENT_TITLE_MAX) === undefined
    ? (draft.title.trim() === '' ? '題名を入れてください' : `題名は${SHOP_EVENT_TITLE_MAX}字までです`) : undefined;
  const description = normalizeCmsText(draft.description, SHOP_EVENT_DESCRIPTION_MAX) === undefined
    ? (draft.description.trim() === '' ? '説明を入れてください（使い方を一言書くと親切です）' : `説明は${SHOP_EVENT_DESCRIPTION_MAX}字までです`) : undefined;
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
  if (!start.ok || !end.ok || !now.ok) return log.exit({ period: '開始日と終了日を選んでください' });
  if (compareLocalDate(start.value, now.value) < 0) return log.exit({ period: '開始日は今日か、それより後にしてください' });
  if (compareLocalDate(end.value, start.value) < 0) return log.exit({ period: '終了日は開始日と同じか、それより後にしてください' });
  if (daysBetween(start.value, end.value) + 1 > SHOP_EVENT_MAX_DAYS) return log.exit({ period: `期間は${SHOP_EVENT_MAX_DAYS}日までです` });
  return log.exit({});
}

/**
 * 期間のまとめ（例「11月9日（月）〜11月15日（日）・7日間」）。
 * @param draft 入力中の値
 * @returns 文（日付が不正なら空）
 */
export function periodSummary(draft: EventDraft): string {
  const log = logger.fn('periodSummary');
  const start = parseLocalDate(draft.start);
  const end = parseLocalDate(draft.end);
  if (!start.ok || !end.ok || compareLocalDate(end.value, start.value) < 0) return log.exit('');
  const days = daysBetween(start.value, end.value) + 1;
  return log.exit(days === 1 ? `${shortDate(draft.start)}の1日だけ` : `${shortDate(draft.start)}〜${shortDate(draft.end)}・${days}日間`);
}

/**
 * アプリでの見え方（地図の期限カードとお店のページ）を作る。
 * @param info 店の情報
 * @param draft 入力中の値
 * @returns プレビューの要素
 */
export function renderEventPreview(info: CmsShopInfoDto, draft: EventDraft): HTMLElement {
  const log = logger.fn('renderEventPreview', { kind: draft.kind });
  const end = parseLocalDate(draft.end);
  const today = parseLocalDate(info.today);
  const daysLeft = end.ok && today.ok ? daysBetween(today.value, end.value) : undefined;
  const remaining = daysLeft === undefined || daysLeft < 0 ? '' : daysLeft === 0 ? '今日まで' : `あと${daysLeft}日`;
  const startsLater = draft.start > info.today;
  const cardNote = startsLater
    ? `地図の期限カードは、掲載が始まってから終わりの${DEADLINE_NOTICE_DAYS}日前になると出ます。`
    : daysLeft !== undefined && daysLeft <= DEADLINE_NOTICE_DAYS ? 'このお店を図鑑で見つけている人の地図に、すぐ出ます。' : `地図の期限カードは、終わりの${DEADLINE_NOTICE_DAYS}日前から出ます。お店のページにはすぐ出ます。`;
  const title = draft.title.trim() || '（題名）';
  return log.exit(h('div', { class: 'cms-preview', attrs: { 'data-testid': 'cms-event-preview' } }, [
    h('p', { class: 'cms-preview__kicker', text: 'アプリの地図に出る「期限カード」' }),
    h('div', { class: 'cms-reason-card' }, [
      h('span', { class: 'cms-reason-card__mark', attrs: { 'aria-hidden': 'true' }, text: '期' }),
      h('div', {}, [h('p', { class: 'cms-reason-card__title', text: `${info.name}の${KIND_LABELS[draft.kind]}、${remaining}` }), h('p', { class: 'cms-reason-card__sub', text: title })]),
    ]),
    h('p', { class: 'cms-note', text: cardNote }),
    h('p', { class: 'cms-preview__kicker', text: 'アプリのお店のページ' }),
    h('div', { class: 'cms-spot-event' }, [
      h('span', { class: 'cms-spot-event__label', text: startsLater ? '予定' : '期限' }),
      h('p', { class: 'cms-spot-event__title', text: title }),
      h('p', { class: 'cms-spot-event__sub', text: `${KIND_LABELS[draft.kind]}・${periodSummary(draft)}` }),
      h('p', { class: 'cms-spot-event__desc', text: draft.description.trim() || '（説明）' }),
    ]),
  ]));
}
