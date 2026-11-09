/**
 * @file 検証済みマスタを保持するスポット・地区・クーポン/イベント・地図の背景の参照（infrastructure/master 層。SpotRepository の実装）
 * MasterDataLoader が検証した値だけを受け取り、起動後は同期・不変で返す（docs/08 §3.2）。
 * 索引（ID 引き・地区別・スポット別）は作成時に前計算する。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId, SpotId } from '@/Common/types/Id';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import type { MapBackdrop } from '@/domain/spot/MapBackdrop';
import type { Spot } from '@/domain/spot/Spot';
import type { CityBounds, SpotRepository } from '@/domain/spot/SpotRepository';
import { sortDistrictsByOrder } from '@/domain/town/District';
import type { District } from '@/domain/town/District';
import type { SpotCatalog } from '@/infrastructure/master/masterValidators';

const logger = createLogger('infrastructure/master/InMemorySpotRepository');

/** 空の配列（該当なしのときに返す共有の凍結済み配列） */
const EMPTY: readonly never[] = Object.freeze([]);

/**
 * キー関数で配列をまとめた索引を作る（各グループは凍結済み）。
 * @param items 要素
 * @param keyOf 要素からキーを取る関数
 * @returns キー → 要素の配列
 */
function groupBy<K, T>(items: readonly T[], keyOf: (item: T) => K): ReadonlyMap<K, readonly T[]> {
  const log = logger.fn('groupBy', { count: items.length });
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return log.exit(new Map([...groups].map(([key, group]) => [key, Object.freeze(group)])));
}

/** 検証済みマスタのメモリ上の参照 */
export class InMemorySpotRepository implements SpotRepository {
  private readonly spots: readonly Spot[];
  private readonly districts: readonly District[];
  private readonly shopEvents: readonly ShopEvent[];
  private readonly bounds: CityBounds;
  private readonly mapBackdrop: MapBackdrop;
  private readonly spotById: ReadonlyMap<SpotId, Spot>;
  private readonly districtById: ReadonlyMap<DistrictId, District>;
  private readonly spotsByDistrict: ReadonlyMap<DistrictId, readonly Spot[]>;
  private readonly eventsBySpot: ReadonlyMap<SpotId, readonly ShopEvent[]>;

  /**
   * 参照を作る。地区は order 昇順に並べ替える。
   * @param catalog 検証済みのスポット・地区・クーポン/イベント・市域・地図の背景（masterValidators.validateMaster の結果）
   */
  constructor(catalog: SpotCatalog) {
    const log = logger.fn('constructor', { spots: catalog.spots.length, districts: catalog.districts.length });
    this.spots = Object.freeze([...catalog.spots]);
    this.districts = Object.freeze(sortDistrictsByOrder(catalog.districts));
    this.shopEvents = Object.freeze([...catalog.shopEvents]);
    this.bounds = Object.freeze({ ...catalog.cityBounds });
    this.mapBackdrop = Object.freeze({ ...catalog.backdrop });
    this.spotById = new Map(this.spots.map((s) => [s.id, s]));
    this.districtById = new Map(this.districts.map((d) => [d.id, d]));
    this.spotsByDistrict = groupBy(this.spots, (s) => s.districtId);
    this.eventsBySpot = groupBy(this.shopEvents, (e) => e.spotId);
    log.exit(undefined);
  }

  /**
   * 全スポット（名所→店舗の順）を返す。
   * @returns スポット
   */
  allSpots(): readonly Spot[] {
    return this.spots;
  }

  /**
   * ID でスポットを探す。
   * @param id スポットID
   * @returns スポット（無ければ undefined）
   */
  findSpot(id: SpotId): Spot | undefined {
    return this.spotById.get(id);
  }

  /**
   * 地区内のスポットを返す。
   * @param id 地区ID
   * @returns スポット（無ければ空配列）
   */
  spotsInDistrict(id: DistrictId): readonly Spot[] {
    return this.spotsByDistrict.get(id) ?? EMPTY;
  }

  /**
   * 全地区（order 昇順）を返す。
   * @returns 地区
   */
  allDistricts(): readonly District[] {
    return this.districts;
  }

  /**
   * ID で地区を探す。
   * @param id 地区ID
   * @returns 地区（無ければ undefined）
   */
  findDistrict(id: DistrictId): District | undefined {
    return this.districtById.get(id);
  }

  /**
   * 全クーポン・イベントを返す。
   * @returns クーポン・イベント
   */
  allShopEvents(): readonly ShopEvent[] {
    return this.shopEvents;
  }

  /**
   * スポットのクーポン・イベントを返す。
   * @param id スポットID
   * @returns クーポン・イベント（無ければ空配列）
   */
  shopEventsForSpot(id: SpotId): readonly ShopEvent[] {
    return this.eventsBySpot.get(id) ?? EMPTY;
  }

  /**
   * 市域の範囲を返す。
   * @returns 南西・北東の緯度経度
   */
  cityBounds(): CityBounds {
    return this.bounds;
  }

  /**
   * 地図の背景（川・公園・道路・線路・駅）と便利施設ポイント（公衆トイレ等）を返す。
   * @returns 検証済みの背景一式（凍結済み）
   */
  backdrop(): MapBackdrop {
    return this.mapBackdrop;
  }
}
