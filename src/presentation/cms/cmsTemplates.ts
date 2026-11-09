/**
 * @file 店舗CMS の入力の手がかり（presentation/cms 層）
 * 初めての人が白紙から考えなくて済むように、クーポン・イベントの文面の例と、よく使う期間を用意する。
 * 例の文言は景品表示法に配慮し、実際より有利に見える言い方（「全品無料」など）を避ける（docs/09 CMS-E12）。
 */
import { createLogger } from '@/Common/logging/logger';
import { addDays, dayOfWeekOf, endOfMonth, parseLocalDate } from '@/Common/utils/date';

const logger = createLogger('presentation/cms/cmsTemplates');

/** 文面の例 */
export interface EventTemplate {
  /** ボタンに出す短い名前 */
  readonly label: string;
  readonly title: string;
  readonly description: string;
}

/** 種別ごとの文面の例 */
export const EVENT_TEMPLATES: Readonly<Record<'coupon' | 'event', readonly EventTemplate[]>> = {
  coupon: [
    { label: '100円引き', title: 'お会計から100円引き', description: 'お会計のときにアプリのこの画面を見せてください。1会計につき1回。' },
    { label: '1品サービス', title: 'おすすめ1品サービス', description: 'アプリの画面を見せると、おすすめを1品サービスします。数に限りがあります。' },
    { label: 'ドリンク', title: 'ドリンク1杯サービス', description: 'ご注文のときにアプリの画面を見せてください。お1人さま1回。' },
  ],
  event: [
    { label: '試食会', title: '新作の試食会', description: '期間中、店頭で新作の試食ができます。お気軽にお立ち寄りください。' },
    { label: '限定メニュー', title: '期間限定メニュー', description: 'この期間だけの限定メニューをご用意しています。' },
    { label: '体験会', title: '店頭の小さな体験会', description: '店頭で気軽に参加できる体験会をします。くわしくは店頭で。' },
  ],
};

/** よく使う期間 */
export type PeriodPresetId = 'today' | 'weekend' | 'week' | 'twoWeeks' | 'month';

/** 期間の表示名（ボタンの順） */
export const PERIOD_PRESETS: readonly { readonly id: PeriodPresetId; readonly label: string }[] = [
  { id: 'today', label: '今日だけ' },
  { id: 'weekend', label: '次の土日' },
  { id: 'week', label: '1週間' },
  { id: 'twoWeeks', label: '2週間' },
  { id: 'month', label: '今月末まで' },
];

/** 曜日番号（dayOfWeekOf: 0=日曜 … 6=土曜） */
const SATURDAY = 6;
const SUNDAY = 0;

/**
 * よく使う期間の開始日・終了日を返す。
 * @param id 期間の種類
 * @param today 今日（'YYYY-MM-DD'）
 * @returns 開始日・終了日（今日が不正なら今日のまま）
 */
export function periodOfPreset(id: PeriodPresetId, today: string): { readonly start: string; readonly end: string } {
  const log = logger.fn('periodOfPreset', { id, today });
  const parsed = parseLocalDate(today);
  if (!parsed.ok) return log.exit({ start: today, end: today });
  const day = parsed.value;
  const weekday = dayOfWeekOf(day);
  switch (id) {
    case 'today':
      return log.exit({ start: day, end: day });
    case 'weekend': {
      if (weekday === SUNDAY) return log.exit({ start: day, end: day });
      const saturday = weekday === SATURDAY ? day : addDays(day, SATURDAY - weekday);
      return log.exit({ start: saturday, end: addDays(saturday, 1) });
    }
    case 'week':
      return log.exit({ start: day, end: addDays(day, 6) });
    case 'twoWeeks':
      return log.exit({ start: day, end: addDays(day, 13) });
    case 'month':
      return log.exit({ start: day, end: endOfMonth(day) });
  }
}
