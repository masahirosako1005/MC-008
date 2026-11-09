/**
 * @file 再訪動機コンテキストの数値ルール（domain 層）
 * すべて（仮）。docs/08 D12。
 */

/** クーポン・イベントの終了が何日以内なら「期限」理由を出すか（仮） */
export const DEADLINE_NOTICE_DAYS = 7;

/** 店舗CMS で登録するクーポン・イベントの題名の最大文字数（master.schema.json・TEXT_LIMITS.eventTitle と同じ。docs/09 CMS-E03） */
export const SHOP_EVENT_TITLE_MAX = 30;

/** 店舗CMS で登録するクーポン・イベントの説明の最大文字数（TEXT_LIMITS.eventDescription と同じ） */
export const SHOP_EVENT_DESCRIPTION_MAX = 80;

/** 店舗CMS で登録できる期間の最長日数（両端を含む。仮。docs/09 CMS-E04） */
export const SHOP_EVENT_MAX_DAYS = 90;

/** 1店で同時に掲載中・掲載予定にできるクーポン・イベントの数（仮。期限トリガーの乱発を防ぐ。docs/09 CMS-E06） */
export const SHOP_EVENT_MAX_OPEN_PER_SPOT = 3;
