/**
 * @file スポット・地区・クーポン/イベントのマスタ参照 IF（domain/spot 層）
 * 実装は infrastructure/master/InMemorySpotRepository。起動時に検証済みマスタを読み込んだ後は同期・不変。
 */
import type { DistrictId, SpotId } from '@/Common/types/Id';
import type { GeoBounds } from '@/domain/exploration/GeoPoint';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import type { Spot } from '@/domain/spot/Spot';
import type { District } from '@/domain/town/District';
import type { MapBackdrop } from '@/domain/spot/MapBackdrop';

/** 市域の範囲（地図の広域表示に使う） */
export type CityBounds = GeoBounds;

/** マスタ参照（読込後は同期・不変） */
export interface SpotRepository {
  /** 全スポット（名所14＋店舗66） */
  allSpots(): readonly Spot[];
  /** ID でスポットを探す */
  findSpot(id: SpotId): Spot | undefined;
  /** 地区内のスポット */
  spotsInDistrict(id: DistrictId): readonly Spot[];
  /** 全地区（order 昇順） */
  allDistricts(): readonly District[];
  /** ID で地区を探す */
  findDistrict(id: DistrictId): District | undefined;
  /** 全クーポン・イベント */
  allShopEvents(): readonly ShopEvent[];
  /** スポットのクーポン・イベント */
  shopEventsForSpot(id: SpotId): readonly ShopEvent[];
  /** 市域の範囲 */
  cityBounds(): CityBounds;
  /** 地図の背景（川・公園・道路・線路・駅）と便利施設ポイント（公衆トイレ等）。無ければ EMPTY_BACKDROP */
  backdrop(): MapBackdrop;
}
