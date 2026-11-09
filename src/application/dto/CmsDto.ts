/**
 * @file 店舗CMS の DTO（application 層 → presentation/cms）
 * プリミティブだけで構成する（docs/01 §3-6）。ID・日付は文字列。
 */

/** 店舗の選択肢（デモではログインの代わりに店を選ぶ＝docs/09 CMS-A09） */
export interface CmsShopSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly districtName: string;
  readonly category: string;
  /** 協力店か */
  readonly partner: boolean;
  /** CMS で情報を編集済みか */
  readonly edited: boolean;
  /** 掲載中・掲載予定のクーポン・イベントの数 */
  readonly openEvents: number;
}

/** クーポン・イベントの状態 */
export type CmsShopEventStatus = 'active' | 'scheduled' | 'ended' | 'withdrawn';

/** CMS の一覧に出すクーポン・イベント */
export interface CmsShopEventDto {
  readonly id: string;
  readonly kind: 'coupon' | 'event';
  readonly title: string;
  readonly description: string;
  /** 'YYYY-MM-DD' */
  readonly start: string;
  readonly end: string;
  readonly status: CmsShopEventStatus;
  /** 掲載中なら終了まで何日か（当日終了=0） */
  readonly daysLeft?: number;
  /** 掲載予定なら開始まで何日か */
  readonly daysUntilStart?: number;
  /** master: アプリ同梱のデータ／cms: CMS で登録したもの */
  readonly source: 'master' | 'cms';
  /** 取り下げできるか（CMS で登録した、まだ終わっていないもの） */
  readonly canWithdraw: boolean;
  /** 取り下げた日（'YYYY-MM-DD'） */
  readonly withdrawnOn?: string;
}

/** 営業時間の入力値（全曜日共通の時間＋定休日） */
export interface CmsBusinessHoursDto {
  readonly open: string;
  readonly close: string;
  /** 0=月 … 6=日 */
  readonly closedDays: readonly number[];
}

/** 店舗の情報（CMS の各画面で使う） */
export interface CmsShopInfoDto {
  readonly id: string;
  readonly name: string;
  readonly districtName: string;
  readonly category: string;
  readonly description: string;
  readonly partner: boolean;
  /** 利用者アプリに出る営業時間（編集後の値） */
  readonly hoursText: string;
  /** 営業時間の入力欄の初期値（書式が違って戻せないときは undefined） */
  readonly hours?: CmsBusinessHoursDto;
  /** 便利情報（編集後の値。Amenity のキー） */
  readonly amenities: readonly string[];
  /** CMS で編集済みか */
  readonly edited: boolean;
  /** 最後に編集した日時（ISO） */
  readonly updatedAt?: string;
  /** 今日（'YYYY-MM-DD'。デモの日付進行を含む） */
  readonly today: string;
  /** クーポン・イベント（掲載中 → 掲載予定 → 終了・取り下げ の順） */
  readonly events: readonly CmsShopEventDto[];
  /** あと何件登録できるか（同時掲載の上限まで） */
  readonly remainingSlots: number;
}

/** 店舗情報の保存の入力 */
export interface SaveShopInfoInput {
  readonly spotId: string;
  readonly hours: CmsBusinessHoursDto;
  readonly amenities: readonly string[];
  readonly operationId: string;
}

/** クーポン・イベント登録の入力 */
export interface RegisterShopEventInput {
  readonly spotId: string;
  readonly kind: string;
  readonly title: string;
  readonly description: string;
  readonly start: string;
  readonly end: string;
  readonly operationId: string;
}

/** クーポン・イベント取り下げの入力 */
export interface WithdrawShopEventInput {
  readonly spotId: string;
  readonly shopEventId: string;
  readonly operationId: string;
}

/** 店舗を指す入力 */
export interface CmsShopInput {
  readonly spotId: string;
}

/** 集計の1項目（少数は秘匿する＝docs/09 CMS-D05） */
export interface CmsCountDto {
  readonly label: string;
  /** 人数・回数（秘匿したときは undefined） */
  readonly value?: number;
  /** 少数のため秘匿したか */
  readonly suppressed: boolean;
}

/** 来訪データ（フェーズ1はダミー＝docs/09 CMS-D08） */
export interface CmsVisitStatsDto {
  /** ダミーデータか（フェーズ1は常に true） */
  readonly isDummy: true;
  /** 集計の終わりの日（今日） */
  readonly today: string;
  /** 直近30日の訪問数 */
  readonly visits30d: CmsCountDto;
  /** 直近30日に訪れた人の数 */
  readonly visitors30d: CmsCountDto;
  /** 30日以内の再訪率（%） */
  readonly revisitRatePct: number;
  /** 初めての人の割合（%） */
  readonly firstTimerPct: number;
  /** 週ごとの訪問数（古い週 → 今週。8週） */
  readonly weekly: readonly CmsCountDto[];
  /** 曜日別の訪問数（月〜日） */
  readonly byWeekday: readonly CmsCountDto[];
  /** 時間帯別の訪問数（朝・昼・午後・夕方・夜） */
  readonly byTimeBand: readonly CmsCountDto[];
  /** 施策の効果（発見→訪問・クーポン・おかえり） */
  readonly effects: readonly CmsCountDto[];
}
