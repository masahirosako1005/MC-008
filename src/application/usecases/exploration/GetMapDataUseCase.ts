/**
 * @file 地図に描くデータ（全地区の成長・色あせ・地区の主と、全スポットの状態・地図の背景）を返すユースケース（application 層・読取系）
 * 地区は order 順。スポットは未発見でも位置と種別だけは返す（B: 「何かある」を見せる）。未発見の店舗は名前を入れない（D12・B）が、
 * 名所は実在の名所なので未発見でも名前を返す（ワイヤーフレーム 01「名所名は見せる」。2026-11-09 の舞台変更＝docs/08 §9）。
 * 背景（川・公園・道路・線路・駅・公衆トイレ）はマスタの MapBackdrop をそのまま DTO にする（不変なのでインスタンス内で使い回す）。
 * 色あせ・成長は訪問記録と今日から毎回導出する（DI-05）。書込みはしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { LocalDate } from '@/Common/utils/date';
import type { UseCase } from '@/application/AppServices';
import type { AmenityPointDto, LatLngDto, MapBackdropDto, MapDataDto, MapFeatureDto, MapSpotDto, MapSpotEventDto, SpotStatusDto, StationDto } from '@/application/dto/Dto';
import { hasActiveShopEventOn, spotStatusOf } from '@/application/usecases/exploration/SpotStatus';
import { districtViewsOf, toDistrictMapDto } from '@/application/usecases/shared/DistrictView';
import { loadWorld } from '@/application/usecases/shared/World';
import type { World, WorldDeps } from '@/application/usecases/shared/World';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';
import { visitCountOfSpot } from '@/domain/exploration/VisitStats';
import { isActive } from '@/domain/revisit/ShopEvent';
import type { Traveler } from '@/domain/exploration/Traveler';
import type { AmenityPoint, MapBackdrop, MapFeature, Station } from '@/domain/spot/MapBackdrop';
import type { Spot } from '@/domain/spot/Spot';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/exploration/GetMapDataUseCase');

/** GetMapDataUseCase の依存（旅人の世界を読む一式） */
export type GetMapDataDeps = WorldDeps;

/** toMapSpotDto の入力 */
interface MapSpotContext {
  readonly traveler: Traveler;
  readonly spots: SpotRepository;
  readonly today: LocalDate;
}

/**
 * 地図に名前を出さないスポットか判定する（未発見の店舗だけ。名所は実在の名所なので未発見でも名前を出す）。
 * @param spot スポット
 * @param status 旅人から見た状態
 * @returns 名前を隠すなら true
 */
function hidesName(spot: Spot, status: SpotStatusDto): boolean {
  return status === 'unknown' && spot.kind === 'shop';
}

/**
 * スポット1件を地図用の DTO にする。未発見（unknown）の店舗なら name を含めない（キー自体を持たない）。
 * @param spot スポット
 * @param context 旅人・マスタ参照・今日
 * @returns MapSpotDto（凍結済み）
 */
function toMapSpotDto(spot: Spot, context: MapSpotContext): MapSpotDto {
  const log = logger.fn('toMapSpotDto', { spotId: spot.id });
  const status = spotStatusOf(context.traveler, spot.id);
  const dto: MapSpotDto = Object.freeze({
    id: spot.id,
    kind: spot.kind,
    districtId: spot.districtId,
    lat: spot.point.lat,
    lng: spot.point.lng,
    status,
    ...(hidesName(spot, status) ? {} : { name: spot.name }),
    visitCount: visitCountOfSpot(context.traveler.visits, spot.id),
    amenities: Object.freeze([...spot.amenities]),
    hasActiveShopEvent: hasActiveShopEventOn(context.spots, spot.id, context.today),
    category: spot.category,
    ...activeEventField(spot, context),
  });
  return log.exit(dto, status);
}

/**
 * スポットで開催中のクーポン・イベントのうち、終わりがいちばん近いものを地図用に要約する（無ければ空のオブジェクト）。
 * 地図の「今日だけ」「あと n 日」の表示に使う（C: 期限の再訪理由を地図の上でも見せる）。
 * @param spot スポット
 * @param context 旅人・マスタ・今日
 * @returns activeEvent を含むオブジェクト、または空のオブジェクト
 */
function activeEventField(spot: Spot, context: MapSpotContext): { readonly activeEvent?: MapSpotEventDto } {
  const log = logger.fn('activeEventField', { spotId: spot.id });
  const active = context.spots
    .shopEventsForSpot(spot.id)
    .filter((event) => isActive(event, context.today))
    .map((event) => ({ kind: event.kind, title: event.title, daysLeft: event.period.daysUntilEnd(context.today) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const first = active[0];
  return log.exit(first === undefined ? {} : { activeEvent: Object.freeze(first) }, first === undefined ? 'なし' : `あと${first.daysLeft}日`);
}

/**
 * 位置を緯度経度の DTO にする。
 * @param point 位置
 * @returns LatLngDto（凍結済み）
 */
function toLatLngDto(point: GeoPoint): LatLngDto {
  return Object.freeze({ lat: point.lat, lng: point.lng });
}

/**
 * 背景地物1件を DTO にする（widthM は持つときだけ）。
 * @param feature 背景地物
 * @returns MapFeatureDto（凍結済み）
 */
function toMapFeatureDto(feature: MapFeature): MapFeatureDto {
  const log = logger.fn('toMapFeatureDto', { id: feature.id, points: feature.points.length });
  const { id, kind, name, shape, widthM } = feature;
  const points = Object.freeze(feature.points.map(toLatLngDto));
  return log.exit(Object.freeze({ id, kind, name, shape, points, ...(widthM === undefined ? {} : { widthM }) }));
}

/**
 * 駅1件を DTO にする。
 * @param station 駅
 * @returns StationDto（凍結済み）
 */
function toStationDto(station: Station): StationDto {
  return Object.freeze({ id: station.id, name: station.name, lat: station.point.lat, lng: station.point.lng, lines: station.lines });
}

/**
 * 便利施設ポイント1件を DTO にする。
 * @param point 便利施設ポイント
 * @returns AmenityPointDto（凍結済み）
 */
function toAmenityPointDto(point: AmenityPoint): AmenityPointDto {
  return Object.freeze({ id: point.id, kind: point.kind, name: point.name, lat: point.point.lat, lng: point.point.lng, note: point.note });
}

/**
 * 地図の背景一式を DTO にする（出典は持つときだけ）。
 * @param backdrop 地図の背景（マスタ）
 * @returns MapBackdropDto（凍結済み）
 */
export function toMapBackdropDto(backdrop: MapBackdrop): MapBackdropDto {
  const log = logger.fn('toMapBackdropDto', { features: backdrop.features.length, stations: backdrop.stations.length, amenityPoints: backdrop.amenityPoints.length });
  const dto: MapBackdropDto = Object.freeze({
    features: Object.freeze(backdrop.features.map(toMapFeatureDto)),
    stations: Object.freeze(backdrop.stations.map(toStationDto)),
    amenityPoints: Object.freeze(backdrop.amenityPoints.map(toAmenityPointDto)),
    ...(backdrop.attribution === undefined ? {} : { attribution: backdrop.attribution }),
  });
  return log.exit(dto);
}

/**
 * 旅人の世界から地図のデータを組み立てる。
 * @param world 旅人の世界
 * @param backdrop 地図の背景の DTO（マスタから作ったもの）
 * @returns MapDataDto（凍結済み。地区は order 順、スポットはマスタの順）
 */
function mapDataOf(world: World, backdrop: MapBackdropDto): MapDataDto {
  const log = logger.fn('mapDataOf', { today: world.today });
  const views = districtViewsOf(world).sort((a, b) => a.district.order - b.district.order);
  const context: MapSpotContext = { traveler: world.traveler, spots: world.spots, today: world.today };
  const bounds = world.spots.cityBounds();
  const dto: MapDataDto = Object.freeze({
    today: world.today,
    districts: Object.freeze(views.map(toDistrictMapDto)),
    spots: Object.freeze(world.spots.allSpots().map((spot) => toMapSpotDto(spot, context))),
    bounds: Object.freeze({ south: bounds.south, west: bounds.west, north: bounds.north, east: bounds.east }),
    backdrop,
  });
  return log.exit(dto, `地区 ${dto.districts.length}・スポット ${dto.spots.length}`);
}

/** 地図のデータを返す */
export class GetMapDataUseCase implements UseCase<void, MapDataDto> {
  /** 背景の DTO の使い回し（マスタは読込後に不変なので、同じ MapBackdrop からは一度だけ作る） */
  private backdropCache: { readonly source: MapBackdrop; readonly dto: MapBackdropDto } | undefined;

  /**
   * 依存を受け取る。
   * @param deps 旅人の世界を読む一式（セッション・各リポジトリ・マスタ・時計）
   */
  constructor(private readonly deps: GetMapDataDeps) {}

  /**
   * マスタの背景を DTO にする（同じ MapBackdrop なら前回の DTO を返す）。
   * @returns 地図の背景の DTO
   * @sideEffect backdropCache を更新する（インスタンス内のみ）
   */
  private backdropDto(): MapBackdropDto {
    const log = logger.fn('backdropDto', { cached: this.backdropCache !== undefined });
    const source = this.deps.spots.backdrop();
    if (this.backdropCache?.source !== source) this.backdropCache = { source, dto: toMapBackdropDto(source) };
    return log.exit(this.backdropCache.dto);
  }

  /**
   * 地図に描く全地区・全スポット・地図の背景を返す。
   * @returns 成功: MapDataDto。失敗: TRAVELER_NOT_FOUND（旅人が無い）／STORAGE_FAILED（読込失敗）
   * @sideEffect セッション・旅人・地区の主・ライバル行動のリポジトリを読む（書込みはしない）
   */
  async execute(): Promise<Result<MapDataDto>> {
    const log = logger.fn('execute');
    const world = await loadWorld(this.deps);
    if (!world.ok) return log.fail(world);
    return log.exit(ok(mapDataOf(world.value, this.backdropDto())));
  }
}
