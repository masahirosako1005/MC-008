/**
 * @file クーポン・期間限定イベントの型（domain/revisit 層）
 * マスタデータ（shopEvents.json）。期限は Period（JST 暦日）で判定し、画面の表示値を信用しない（DI-09）。
 */
import type { DistrictId, ShopEventId, SpotId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import type { Period } from '@/domain/revisit/Period';

/** 種別（クーポン／イベント） */
export const SHOP_EVENT_KINDS = ['coupon', 'event'] as const;

/** 種別 */
export type ShopEventKind = (typeof SHOP_EVENT_KINDS)[number];

/** クーポン・イベント */
export interface ShopEvent {
  readonly id: ShopEventId;
  readonly spotId: SpotId;
  readonly districtId: DistrictId;
  readonly kind: ShopEventKind;
  readonly title: string;
  readonly description: string;
  readonly period: Period;
}

/**
 * その日がクーポン・イベントの期間内か判定する（開始日・終了日を含む）。
 * @param event クーポン・イベント
 * @param date 判定する暦日（通常は Clock.today()）
 * @returns 期間内なら true
 */
export function isActive(event: ShopEvent, date: LocalDate): boolean {
  return event.period.contains(date);
}

/**
 * クーポンか判定する（イベントは利用操作がない）。
 * @param event クーポン・イベント
 * @returns クーポンなら true
 */
export function isCoupon(event: ShopEvent): boolean {
  return event.kind === 'coupon';
}

/**
 * 未検証の値が種別か判定する型ガード（マスタ検証用）。
 * @param value 判定する値
 * @returns 'coupon' または 'event' なら true
 */
export function isShopEventKind(value: unknown): value is ShopEventKind {
  return value === 'coupon' || value === 'event';
}
