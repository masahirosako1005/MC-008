/**
 * @file 店舗CMS の API で受け渡す JSON の形（infrastructure/api/schema 層。サーバーとブラウザで共有する契約）
 * - 応答（サーバー → CMS 画面）：application/dto/CmsDto.ts の DTO と同じ構造。ブラウザ側が応答を検証してから画面へ渡す（DI-01）
 * - リクエストの本文（CMS 画面 → サーバー）：サーバー側が検証してからユースケースへ渡す（DI-01、SEC-16）
 * DTO を変えたら、ここも同じように変える（統合テスト cmsBackend.test.ts が、直接呼んだ結果と HTTP 経由の結果の一致を確かめる）。
 */
import { shape } from '@/infrastructure/api/schema/shape';
import type { Shape } from '@/infrastructure/api/schema/shape';

const { array, literal, object, optional } = shape;

/** CmsShopSummaryDto[] */
export const CMS_SHOP_LIST_SHAPE: Shape = array(object({
  id: 'string',
  name: 'string',
  districtName: 'string',
  category: 'string',
  partner: 'boolean',
  edited: 'boolean',
  openEvents: 'integer',
}));

/** CmsShopEventDto */
const CMS_SHOP_EVENT_SHAPE: Shape = object({
  id: 'string',
  kind: literal('coupon', 'event'),
  title: 'string',
  description: 'string',
  start: 'string',
  end: 'string',
  status: literal('active', 'scheduled', 'ended', 'withdrawn'),
  daysLeft: optional('integer'),
  daysUntilStart: optional('integer'),
  source: literal('master', 'cms'),
  canWithdraw: 'boolean',
  withdrawnOn: optional('string'),
});

/** CmsBusinessHoursDto */
const CMS_BUSINESS_HOURS_SHAPE: Shape = object({
  open: 'string',
  close: 'string',
  closedDays: array('integer'),
  note: optional('string'),
});

/** CmsShopInfoDto */
export const CMS_SHOP_INFO_SHAPE: Shape = object({
  id: 'string',
  name: 'string',
  districtId: 'string',
  districtName: 'string',
  category: 'string',
  description: 'string',
  partner: 'boolean',
  hoursText: 'string',
  hours: optional(CMS_BUSINESS_HOURS_SHAPE),
  amenities: array('string'),
  edited: 'boolean',
  updatedAt: optional('string'),
  today: 'string',
  events: array(CMS_SHOP_EVENT_SHAPE),
  remainingSlots: 'integer',
});

/** CmsCountDto */
const CMS_COUNT_SHAPE: Shape = object({
  label: 'string',
  value: optional('number'),
  suppressed: 'boolean',
  note: optional('string'),
});

/** CmsVisitStatsDto */
export const CMS_VISIT_STATS_SHAPE: Shape = object({
  isDummy: literal(true),
  today: 'string',
  visits30d: CMS_COUNT_SHAPE,
  visitors30d: CMS_COUNT_SHAPE,
  revisitRatePct: 'number',
  firstTimerPct: 'number',
  weekly: array(CMS_COUNT_SHAPE),
  byWeekday: array(CMS_COUNT_SHAPE),
  byTimeBand: array(CMS_COUNT_SHAPE),
  effects: array(CMS_COUNT_SHAPE),
});

/** CmsSurveyChoiceDto */
const CMS_SURVEY_CHOICE_SHAPE: Shape = object({ key: 'string', label: 'string', count: 'integer', pct: 'integer' });

/** CmsSurveySlotDto */
const CMS_SURVEY_SLOT_SHAPE: Shape = object({ label: 'string', count: 'integer', avg: optional('number'), topConcern: optional('string'), note: optional('string') });

/** CmsSurveyDto */
export const CMS_SURVEY_SHAPE: Shape = object({
  today: 'string',
  windowDays: 'integer',
  total: 'integer',
  sampleCount: 'integer',
  satisfactionAvg: optional('number'),
  satisfaction: array(CMS_SURVEY_CHOICE_SHAPE),
  revisitPct: optional('integer'),
  triggers: array(CMS_SURVEY_CHOICE_SHAPE),
  goods: array(CMS_SURVEY_CHOICE_SHAPE),
  concerns: array(CMS_SURVEY_CHOICE_SHAPE),
  byWeekday: array(CMS_SURVEY_SLOT_SHAPE),
  byTimeBand: array(CMS_SURVEY_SLOT_SHAPE),
  recentAvg: optional('number'),
  previousAvg: optional('number'),
  comments: array(object({ date: 'string', satisfaction: 'integer', text: 'string' })),
});

/** 本文：営業時間・便利情報の保存（spotId は道筋から取る） */
export const SAVE_SHOP_INFO_BODY_SHAPE: Shape = object({
  hours: CMS_BUSINESS_HOURS_SHAPE,
  amenities: array('string'),
  operationId: 'string',
});

/** 本文：クーポン・イベントの登録（spotId は道筋から取る） */
export const REGISTER_SHOP_EVENT_BODY_SHAPE: Shape = object({
  kind: 'string',
  title: 'string',
  description: 'string',
  start: 'string',
  end: 'string',
  operationId: 'string',
});

/** 本文：取り下げ（spotId・shopEventId は道筋から取る） */
export const WITHDRAW_SHOP_EVENT_BODY_SHAPE: Shape = object({
  operationId: 'string',
});
