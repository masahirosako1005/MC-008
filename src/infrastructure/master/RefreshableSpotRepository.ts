/**
 * @file 中身を差し替えられる SpotRepository（infrastructure/master 層。デモで店舗CMS の登録内容を反映するため）
 * docs/08 §3.2 の「読込後は同期・不変」は、差し替えの単位（1つのスナップショット）の中では守る。
 * 差し替えは丸ごと1回で行い、読む側が途中の状態を見ることはない（docs/09 §7.1「スナップショット単位で置き換える」）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId, SpotId } from '@/Common/types/Id';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import type { MapBackdrop } from '@/domain/spot/MapBackdrop';
import type { Spot } from '@/domain/spot/Spot';
import type { CityBounds, SpotRepository } from '@/domain/spot/SpotRepository';
import type { District } from '@/domain/town/District';
import { InMemorySpotRepository } from '@/infrastructure/master/InMemorySpotRepository';
import type { SpotCatalog } from '@/infrastructure/master/masterValidators';

const logger = createLogger('infrastructure/master/RefreshableSpotRepository');

/** 中身を差し替えられる SpotRepository */
export class RefreshableSpotRepository implements SpotRepository {
  private current: InMemorySpotRepository;

  /**
   * 最初の中身で作る。
   * @param catalog 検証済みのマスタ（CMS の登録内容を重ねたもの）
   */
  constructor(catalog: SpotCatalog) {
    this.current = new InMemorySpotRepository(catalog);
  }

  /**
   * 中身を丸ごと差し替える。
   * @param catalog 検証済みのマスタ（CMS の登録内容を重ねたもの）
   * @sideEffect 以後の読み出しは新しい中身を返す
   */
  replace(catalog: SpotCatalog): void {
    const log = logger.fn('replace', { spots: catalog.spots.length, shopEvents: catalog.shopEvents.length });
    this.current = new InMemorySpotRepository(catalog);
    log.exit(undefined);
  }

  /**
   * 全スポットを返す。
   * @returns スポット
   */
  allSpots(): readonly Spot[] {
    return this.current.allSpots();
  }

  /**
   * ID でスポットを探す。
   * @param id スポットID
   * @returns スポット（無ければ undefined）
   */
  findSpot(id: SpotId): Spot | undefined {
    return this.current.findSpot(id);
  }

  /**
   * 地区内のスポットを返す。
   * @param id 地区ID
   * @returns スポット
   */
  spotsInDistrict(id: DistrictId): readonly Spot[] {
    return this.current.spotsInDistrict(id);
  }

  /**
   * 全地区を返す。
   * @returns 地区（order 昇順）
   */
  allDistricts(): readonly District[] {
    return this.current.allDistricts();
  }

  /**
   * ID で地区を探す。
   * @param id 地区ID
   * @returns 地区（無ければ undefined）
   */
  findDistrict(id: DistrictId): District | undefined {
    return this.current.findDistrict(id);
  }

  /**
   * 全クーポン・イベントを返す。
   * @returns クーポン・イベント
   */
  allShopEvents(): readonly ShopEvent[] {
    return this.current.allShopEvents();
  }

  /**
   * スポットのクーポン・イベントを返す。
   * @param id スポットID
   * @returns クーポン・イベント
   */
  shopEventsForSpot(id: SpotId): readonly ShopEvent[] {
    return this.current.shopEventsForSpot(id);
  }

  /**
   * 市域の範囲を返す。
   * @returns 南西・北東の緯度経度
   */
  cityBounds(): CityBounds {
    return this.current.cityBounds();
  }

  /**
   * 地図の背景を返す。
   * @returns 背景一式
   */
  backdrop(): MapBackdrop {
    return this.current.backdrop();
  }
}
