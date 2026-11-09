/**
 * @file 地図の描画データとカメラ計算（presentation/screens/Map 層。純粋関数）
 * MapDataDto を描画用の ViewModel に変換し、緯度経度 ⇔ canvas CSS px の変換・各ズームのカメラ・建物の配置・ヒットテストを提供する。
 * 背景（川・道路など。docs/08 §9）の変換は MapBackdropModel に分け、建物は川・道路・商店街・線路の上に置かない。
 * 投影は正距円筒（1m ≒ 緯度 1/111,000°、経度は cos(緯度) で補正）。位置座標はログに出さない（件数・距離・ID だけ）。
 * 投影・カメラ計算は描画ループから毎フレーム呼ぶので関数ログを出さない（呼び出し側でまとめてログ）。
 */
import type { DistrictMapDto, FadeDto, MapDataDto, MapSpotDto, SpotKindDto, SpotStatusDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { fadeVisual } from '@/Common/ui/canvas/fadeStyle';
import type { FadeKind, FadeVisual } from '@/Common/ui/canvas/fadeStyle';
import { distance2D, distanceToPolyline, interiorPoint, pointInPolygon, polygonBounds, rectsOverlap } from '@/Common/ui/canvas/geometry';
import type { Point2D, Rect } from '@/Common/ui/canvas/geometry';
import { inflateRect } from '@/Common/ui/canvas/labelLayout';
import { seededRandomFor } from '@/Common/ui/canvas/seededHash';
import { distanceLabel, fadeLabel, levelLabel } from '@/presentation/shared/labels';
import { buildBackdropVm, buildingAvoidAreas, buildingAvoidLines } from '@/presentation/screens/Map/MapBackdropModel';
import type { AvoidLine, BackdropVm } from '@/presentation/screens/Map/MapBackdropModel';
import { showsShops } from '@/presentation/screens/Map/ZoomState';
import type { MapZoom, ZoomState } from '@/presentation/screens/Map/ZoomState';

const logger = createLogger('presentation/screens/Map/MapViewModel');

/** 緯度1度あたりのメートル（正距円筒近似。1m ≒ 緯度 1/111,000°） */
export const METERS_PER_DEG_LAT = 111_000;
/** 広域で市域に当てはめるときの余白（CSS px） */
export const WIDE_PADDING_PX = 12;
/** 地区ズームで地区ポリゴンに当てはめるときの余白（CSS px） */
export const DISTRICT_PADDING_PX = 24;
/** 近接表示の横幅（メートル）（仮） */
export const NEAR_VIEW_WIDTH_M = 450;
/** スポットのタップ判定半径（CSS px） */
export const SPOT_HIT_RADIUS_PX = 22;
/** カメラ遷移の時間（ミリ秒） */
export const CAMERA_TRANSITION_MS = 350;
/** 下シートで隠れる高さとして扱う上限（表示高さに対する割合） */
export const MAX_BOTTOM_INSET_RATIO = 0.6;
/** 建物どうしの最小間隔（メートル） */
export const BUILDING_MIN_GAP_M = 32;
/** 建物とスポットの最小間隔（メートル。マーカーと重ならないように） */
export const BUILDING_SPOT_CLEARANCE_M = 24;
/** 建物を地区の境界からこれだけ内側に置く（メートル） */
export const BUILDING_EDGE_INSET_M = 12;
/** 建物1棟あたりの配置試行回数の上限 */
const BUILDING_ATTEMPTS_PER_ITEM = 60;
/** 色が取れないときのスポット色 */
const FALLBACK_SPOT_COLOR = '#8a8a8a';
/** 成長段階の上限 */
const MAX_LEVEL = 3;

/** 緯度経度（描画専用。ログに出さない） */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** 緯度経度の範囲 */
export interface GeoBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** カメラ（表示中心の緯度経度と縮尺）。座標を含むのでログに出さない */
export interface Camera {
  readonly centerLat: number;
  readonly centerLng: number;
  /** 1 CSS px あたりのメートル */
  readonly metersPerPx: number;
}

/** 描画領域（CSS px）。bottomInset は下シートのつまみで隠れる下端の高さ */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly bottomInset: number;
}

/** 地図に描く地区 */
export interface MapDistrictVm {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  /** '#rrggbb' */
  readonly color: string;
  /** 成長段階 0..3（下がらない） */
  readonly level: number;
  readonly polygon: readonly LatLng[];
  readonly center: LatLng;
  /** 地図のラベル（例 '南森町 Lv2'） */
  readonly label: string;
  /** 上部バーの見出し（例 '南森町・天満宮地区 Lv2'） */
  readonly title: string;
  /** 上部バーの補足（色あせ・地区の主）。無ければ undefined */
  readonly subtitle?: string;
  readonly isLordMe: boolean;
  readonly fadeKind: FadeKind;
  /** 色あせの描画パラメータ（彩度・透明度・破線・◌） */
  readonly fade: FadeVisual;
  /** 地図に添えるタグ（'色あせ'／'あと5日'）。fresh・never は undefined */
  readonly fadeTag?: string;
  /** 建物の位置（Lv2 以上だけ。地区ID から決定論的に配置） */
  readonly buildings: readonly LatLng[];
}

/** 地図に描くスポット */
export interface MapSpotVm {
  readonly id: string;
  readonly kind: SpotKindDto;
  readonly districtId: string;
  readonly position: LatLng;
  readonly status: SpotStatusDto;
  /** 名前。未発見の店舗は undefined（名前を漏らさない＝B）。未発見の名所は実在の名前を出す（application が返したときだけ） */
  readonly name?: string;
  readonly visitCount: number;
  /** 地図に添える文字（訪問済みは回数つき）。名前が無ければ undefined */
  readonly label?: string;
  /** 地区の色（訪問済みの塗りに使う） */
  readonly color: string;
  /** 地区の色あせ（訪問済みの塗りにも掛ける） */
  readonly fade: FadeVisual;
  readonly hasActiveShopEvent: boolean;
}

/** 地図全体の描画データ */
export interface MapViewModel {
  readonly today: string;
  readonly bounds: GeoBounds;
  readonly districts: readonly MapDistrictVm[];
  readonly spots: readonly MapSpotVm[];
  /** 背景（川・公園・道路・線路・駅・公衆トイレ・出典） */
  readonly backdrop: BackdropVm;
}

/** 画面座標に置いたスポット */
export interface ScreenSpot {
  readonly spot: MapSpotVm;
  readonly x: number;
  readonly y: number;
}

/** 画面座標に置いた地区 */
export interface ScreenDistrict {
  readonly district: MapDistrictVm;
  readonly polygon: readonly Point2D[];
  /** 代表点（ポリゴンの重心。L 字などで重心が外に出るときは内側の点） */
  readonly anchor: Point2D;
}

// ---------------------------------------------------------------------------
// 投影（緯度経度 ⇔ canvas CSS px）
// ---------------------------------------------------------------------------

/**
 * 経度1度あたりのメートルを返す（cos(緯度) で補正）。
 * @param lat 緯度（度）
 * @returns メートル
 */
export function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/**
 * 下シートで隠れる分を除いた、表示に使える高さを返す（隠れは高さの MAX_BOTTOM_INSET_RATIO までに丸める）。
 * @param vp 描画領域
 * @returns 高さ（CSS px、1 以上）
 */
export function usableHeight(vp: Viewport): number {
  return Math.max(1, vp.height - Math.min(Math.max(0, vp.bottomInset), vp.height * MAX_BOTTOM_INSET_RATIO));
}

/**
 * カメラ中心が来る画面上の点（表示に使える領域の中央）を返す。
 * @param vp 描画領域
 * @returns 点（CSS px）
 */
export function viewAnchor(vp: Viewport): Point2D {
  return { x: vp.width / 2, y: usableHeight(vp) / 2 };
}

/**
 * 緯度経度を canvas の CSS px に変換する。
 * @param camera カメラ
 * @param vp 描画領域
 * @param ll 緯度経度
 * @returns 画面上の点（CSS px。左上原点、y は下向き）
 */
export function project(camera: Camera, vp: Viewport, ll: LatLng): Point2D { // audit-ignore: fnlog-missing 毎フレーム描画
  const anchor = viewAnchor(vp);
  return {
    x: anchor.x + ((ll.lng - camera.centerLng) * metersPerDegLng(camera.centerLat)) / camera.metersPerPx,
    y: anchor.y - ((ll.lat - camera.centerLat) * METERS_PER_DEG_LAT) / camera.metersPerPx,
  };
}

/**
 * canvas の CSS px を緯度経度に戻す（project の逆変換）。
 * @param camera カメラ
 * @param vp 描画領域
 * @param point 画面上の点（CSS px）
 * @returns 緯度経度
 */
export function unproject(camera: Camera, vp: Viewport, point: Point2D): LatLng { // audit-ignore: fnlog-missing タップごとに呼ぶ純粋な変換ヘルパー（座標を扱うのでログに出さない）
  const anchor = viewAnchor(vp);
  return {
    lat: camera.centerLat - ((point.y - anchor.y) * camera.metersPerPx) / METERS_PER_DEG_LAT,
    lng: camera.centerLng + ((point.x - anchor.x) * camera.metersPerPx) / metersPerDegLng(camera.centerLat),
  };
}

/**
 * 2点間の距離（メートル）を正距円筒近似で返す。
 * @param a 地点1
 * @param b 地点2
 * @returns 距離（メートル）
 */
export function distanceMeters(a: LatLng, b: LatLng): number { // audit-ignore: fnlog-missing 歩行の刻みごとに呼ぶ純粋な算術ヘルパー
  const dx = (b.lng - a.lng) * metersPerDegLng((a.lat + b.lat) / 2);
  const dy = (b.lat - a.lat) * METERS_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/**
 * 基準点からの東西・南北のメートル（x=東、y=北）に変換する。
 * @param origin 基準点
 * @param ll 変換する点
 * @returns ローカル座標（メートル）
 */
export function toLocalMeters(origin: LatLng, ll: LatLng): Point2D {
  return { x: (ll.lng - origin.lng) * metersPerDegLng(origin.lat), y: (ll.lat - origin.lat) * METERS_PER_DEG_LAT };
}

/**
 * ローカル座標（メートル、x=東、y=北）を緯度経度に戻す。
 * @param origin 基準点
 * @param point ローカル座標
 * @returns 緯度経度
 */
export function fromLocalMeters(origin: LatLng, point: Point2D): LatLng {
  return { lat: origin.lat + point.y / METERS_PER_DEG_LAT, lng: origin.lng + point.x / metersPerDegLng(origin.lat) };
}

// ---------------------------------------------------------------------------
// カメラ
// ---------------------------------------------------------------------------

/**
 * 点群を囲む緯度経度の範囲を返す。
 * @param points 緯度経度の点群（空なら原点の範囲）
 * @returns 範囲
 */
export function boundsOf(points: readonly LatLng[]): GeoBounds { // audit-ignore: fnlog-missing 毎フレーム描画（地区ズームのカメラ計算）
  const box = polygonBounds(points.map((p) => ({ x: p.lng, y: p.lat })));
  return { south: box.y, west: box.x, north: box.y + box.height, east: box.x + box.width };
}

/**
 * 範囲を、余白を残して表示領域（下シートで隠れる分を除く）に収めるカメラを返す。
 * @param bounds 収めたい範囲
 * @param vp 描画領域
 * @param paddingPx 四辺の余白（CSS px）
 * @returns カメラ
 */
export function fitBounds(bounds: GeoBounds, vp: Viewport, paddingPx: number): Camera { // audit-ignore: fnlog-missing 毎フレーム描画（カメラ計算）
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLng = (bounds.west + bounds.east) / 2;
  const widthM = Math.max(1, (bounds.east - bounds.west) * metersPerDegLng(centerLat));
  const heightM = Math.max(1, (bounds.north - bounds.south) * METERS_PER_DEG_LAT);
  const availW = Math.max(1, vp.width - paddingPx * 2);
  const availH = Math.max(1, usableHeight(vp) - paddingPx * 2);
  return { centerLat, centerLng, metersPerPx: Math.max(widthM / availW, heightM / availH) };
}

/**
 * 近接表示のカメラ（現在地中心、横幅 NEAR_VIEW_WIDTH_M）を返す。
 * @param position 現在地
 * @param vp 描画領域
 * @returns カメラ
 */
export function nearCamera(position: LatLng, vp: Viewport): Camera {
  return { centerLat: position.lat, centerLng: position.lng, metersPerPx: NEAR_VIEW_WIDTH_M / Math.max(1, vp.width) };
}

/**
 * ズーム状態に合うカメラを返す。
 * wide: 市域に 12px 余白でフィット／district: 地区ポリゴンに 24px 余白でフィット／near: 現在地中心で幅 NEAR_VIEW_WIDTH_M（450m）。
 * near で現在地が無いときは地区、地区が見つからないときは広域にする。
 * @param zoom ズーム状態
 * @param vm 描画データ
 * @param position 現在地（不明なら undefined）
 * @param vp 描画領域
 * @returns カメラ
 */
export function cameraFor(zoom: ZoomState, vm: MapViewModel, position: LatLng | undefined, vp: Viewport): Camera { // audit-ignore: fnlog-missing 毎フレーム描画（カメラ追従）
  if (zoom.zoom === 'near' && position !== undefined) return nearCamera(position, vp);
  const district = zoom.zoom === 'wide' || zoom.districtId === undefined ? undefined : findDistrict(vm, zoom.districtId);
  if (district !== undefined) return fitBounds(boundsOf(district.polygon), vp, DISTRICT_PADDING_PX);
  return fitBounds(vm.bounds, vp, WIDE_PADDING_PX);
}

/**
 * 2つのカメラの間を補間する（中心は線形、縮尺は対数で補間するので拡大縮小が等速に見える）。
 * @param from 開始カメラ
 * @param to 終了カメラ
 * @param t 進み具合（0〜1。範囲外は丸める）
 * @returns 補間したカメラ
 */
export function interpolateCamera(from: Camera, to: Camera, t: number): Camera { // audit-ignore: fnlog-missing 毎フレーム描画（カメラ遷移）
  const k = clamp01(t);
  return {
    centerLat: from.centerLat + (to.centerLat - from.centerLat) * k,
    centerLng: from.centerLng + (to.centerLng - from.centerLng) * k,
    metersPerPx: from.metersPerPx * Math.pow(to.metersPerPx / from.metersPerPx, k),
  };
}

/**
 * イージング（ease-in-out cubic）。
 * @param t 進み具合（0〜1。範囲外は丸める）
 * @returns 0〜1
 */
export function easeInOutCubic(t: number): number { // audit-ignore: fnlog-missing 毎フレーム描画（カメラ遷移）
  const k = clamp01(t);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/**
 * 値を 0〜1 に丸める（NaN は 0）。
 * @param value 値
 * @returns 0〜1
 */
export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

// ---------------------------------------------------------------------------
// 建物の配置（決定論的。Math.random は使わない）
// ---------------------------------------------------------------------------

/** 境界から内側にあるかを確かめるためにずらす向き（メートル） */
const INSET_OFFSETS: readonly Point2D[] = [
  { x: BUILDING_EDGE_INSET_M, y: 0 },
  { x: -BUILDING_EDGE_INSET_M, y: 0 },
  { x: 0, y: BUILDING_EDGE_INSET_M },
  { x: 0, y: -BUILDING_EDGE_INSET_M },
];

/** 建物を置かない場所 */
export interface BuildingAvoid {
  /** 避ける点（スポットの位置。BUILDING_SPOT_CLEARANCE_M 以内に置かない） */
  readonly points: readonly LatLng[];
  /** 避ける線（川・道路・商店街・線路） */
  readonly lines?: readonly AvoidLine[];
  /** 避ける面（川の面） */
  readonly areas?: readonly (readonly LatLng[])[];
}

/** 建物の候補地の判定に使う、ローカル座標（メートル）にした障害物 */
interface BuildingSiteContext {
  readonly polygon: readonly Point2D[];
  readonly placed: readonly Point2D[];
  readonly blocked: readonly Point2D[];
  readonly lines: readonly { readonly points: readonly Point2D[]; readonly clearanceM: number }[];
  readonly areas: readonly (readonly Point2D[])[];
}

/**
 * 地区ポリゴンの中に建物を count 棟、地区ID から決定論的に配置する（同じ地区・同じ数なら毎回同じ絵）。
 * 数が増えても既存の建物の位置は変わらない（同じ乱数列の先頭から採用するため）。境界・スポット・他の建物・川や道路とは間隔をあける。
 * @param districtId 地区ID（乱数のシード）
 * @param polygon 地区ポリゴン（3頂点以上）
 * @param count 建物の数（0 以上）
 * @param avoid 避ける点・線・面
 * @returns 建物の位置（置けた分だけ。count より少ないことがある）
 */
export function placeBuildings(districtId: string, polygon: readonly LatLng[], count: number, avoid: BuildingAvoid): LatLng[] {
  const log = logger.fn('placeBuildings', { districtId, count, points: avoid.points.length, lines: avoid.lines?.length ?? 0 });
  const want = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const origin = polygon[0];
  if (want === 0 || origin === undefined || polygon.length < 3) return log.exit([]);
  const local = polygon.map((p) => toLocalMeters(origin, p));
  const box = polygonBounds(local);
  const site: BuildingSiteContext = {
    polygon: local,
    placed: [],
    blocked: avoid.points.map((p) => toLocalMeters(origin, p)),
    lines: localAvoidLines(origin, box, avoid.lines ?? []),
    areas: (avoid.areas ?? []).map((a) => a.map((p) => toLocalMeters(origin, p))),
  };
  const placed: Point2D[] = [];
  const random = seededRandomFor(`buildings:${districtId}`);
  for (let attempt = 0; attempt < want * BUILDING_ATTEMPTS_PER_ITEM && placed.length < want; attempt++) {
    const candidate = { x: box.x + random() * box.width, y: box.y + random() * box.height };
    if (isBuildingSite(candidate, { ...site, placed })) placed.push(candidate);
  }
  log.exit({ placed: placed.length, lines: site.lines.length });
  return placed.map((p) => fromLocalMeters(origin, p));
}

/**
 * 避ける線をローカル座標にし、地区の外接矩形（余白込み）に掛からない線は落とす（判定を軽くする）。
 * @param origin ローカル座標の基準点
 * @param box 地区の外接矩形（ローカル座標）
 * @param lines 避ける線
 * @returns ローカル座標の線
 */
function localAvoidLines(origin: LatLng, box: Rect, lines: readonly AvoidLine[]): BuildingSiteContext['lines'] {
  const log = logger.fn('localAvoidLines', { lines: lines.length });
  const result = lines
    .map((l) => ({ points: l.points.map((p) => toLocalMeters(origin, p)), clearanceM: l.clearanceM }))
    .filter((l) => rectsOverlap(inflateRect(polygonBounds(l.points), l.clearanceM), box));
  return log.exit(result, `${result.length}本`);
}

/**
 * 建物を置ける場所か判定する（境界から内側・他の建物と離れている・スポットと離れている・川や道路の上でない）。
 * @param candidate 候補点（ローカル座標）
 * @param site 地区ポリゴン・置いた建物・障害物（ローカル座標）
 * @returns 置けるなら true
 */
function isBuildingSite(candidate: Point2D, site: BuildingSiteContext): boolean { // audit-ignore: fnlog-missing 建物配置の試行ごとに呼ぶ純粋な判定ヘルパー
  if (!INSET_OFFSETS.every((o) => pointInPolygon({ x: candidate.x + o.x, y: candidate.y + o.y }, site.polygon))) return false;
  if (site.placed.some((p) => distance2D(p, candidate) < BUILDING_MIN_GAP_M)) return false;
  if (site.blocked.some((p) => distance2D(p, candidate) < BUILDING_SPOT_CLEARANCE_M)) return false;
  if (site.areas.some((a) => pointInPolygon(candidate, a))) return false;
  return !site.lines.some((l) => distanceToPolyline(candidate, l.points) < l.clearanceM);
}

// ---------------------------------------------------------------------------
// DTO → ViewModel
// ---------------------------------------------------------------------------

/**
 * 地図データ DTO を描画用の ViewModel に変換する（データ取得のたびに1回）。
 * 未発見の店舗の名前は落とす（DTO に入っていても描かない＝B）。未発見の名所は実在の地名なので名前を残す（docs/08 §9）。地区は order 順に並べる。
 * @param dto application の地図データ
 * @returns 描画データ
 */
export function buildMapViewModel(dto: MapDataDto): MapViewModel {
  const log = logger.fn('buildMapViewModel', { districts: dto.districts.length, spots: dto.spots.length, features: dto.backdrop?.features.length ?? 0 });
  const backdrop = buildBackdropVm(dto.backdrop);
  const lines = buildingAvoidLines(backdrop);
  const areas = buildingAvoidAreas(backdrop);
  const districts = [...dto.districts]
    .sort((a, b) => a.order - b.order)
    .map((d) => toDistrictVm(d, { points: dto.spots.filter((s) => s.districtId === d.id).map((s) => ({ lat: s.lat, lng: s.lng })), lines, areas }));
  const byId = new Map(districts.map((d) => [d.id, d] as const));
  const spots = dto.spots.map((s) => toSpotVm(s, byId.get(s.districtId)));
  const vm: MapViewModel = { today: dto.today, bounds: { ...dto.bounds }, districts, spots, backdrop };
  log.exit({ districts: districts.length, spots: spots.length });
  return vm;
}

/**
 * 地区 DTO を描画用に変換する（ラベル・色あせ・建物を前計算）。
 * @param d 地区 DTO
 * @param avoid 建物を避ける点（その地区のスポット位置）・線（川・道路など）・面
 * @returns 地区の描画データ
 */
function toDistrictVm(d: DistrictMapDto, avoid: BuildingAvoid): MapDistrictVm {
  const log = logger.fn('toDistrictVm', { districtId: d.id, level: d.level, fade: d.fade.kind });
  const level = Number.isFinite(d.level) ? Math.min(MAX_LEVEL, Math.max(0, Math.round(d.level))) : 0;
  const lv = levelLabel(level);
  const polygon = d.polygon.map((p) => ({ lat: p.lat, lng: p.lng }));
  const lordText = d.isLordMe ? '♛ あなたが地区の主' : d.lordName === undefined ? undefined : `主：${d.lordName}`;
  const subtitle = [fadeLabel(d.fade), lordText].filter((s): s is string => s !== undefined).join(' ・ ');
  const vm: MapDistrictVm = {
    id: d.id,
    name: d.name,
    shortName: d.shortName,
    color: d.color,
    level,
    polygon,
    center: { lat: d.center.lat, lng: d.center.lng },
    label: `${d.shortName} ${lv}`,
    title: `${d.name} ${lv}`,
    subtitle: subtitle.length > 0 ? subtitle : undefined,
    isLordMe: d.isLordMe,
    fadeKind: d.fade.kind,
    fade: fadeVisual(d.fade.kind, d.fade.progress ?? 0),
    fadeTag: fadeTagOf(d.fade),
    buildings: level >= 2 ? placeBuildings(d.id, polygon, d.buildings, avoid) : [],
  };
  log.exit({ buildings: vm.buildings.length, fadeTag: vm.fadeTag });
  return vm;
}

/**
 * 地図に添える色あせタグの文言を返す。
 * @param fade 色あせ状態
 * @returns fading は '色あせ'、soon は 'あとn日で色あせ'（日数不明は 'そろそろ色あせ'）、それ以外は undefined
 */
export function fadeTagOf(fade: FadeDto): string | undefined {
  const log = logger.fn('fadeTagOf', { kind: fade.kind, daysUntilFade: fade.daysUntilFade });
  if (fade.kind === 'fading') return log.exit('色あせ');
  if (fade.kind === 'soon') return log.exit(fade.daysUntilFade === undefined ? 'そろそろ色あせ' : `あと${fade.daysUntilFade}日で色あせ`);
  return log.exit(undefined);
}

/**
 * スポット DTO を描画用に変換する。
 * @param s スポット DTO
 * @param district 所属地区の描画データ（見つからなければ undefined）
 * @returns スポットの描画データ
 */
function toSpotVm(s: MapSpotDto, district: MapDistrictVm | undefined): MapSpotVm {
  const log = logger.fn('toSpotVm', { spotId: s.id, status: s.status });
  const name = s.status === 'unknown' && s.kind !== 'landmark' ? undefined : s.name;
  const label = name === undefined ? undefined : s.status === 'visited' && s.visitCount > 0 ? `${name} ${s.visitCount}回` : name;
  log.exit({ hasName: name !== undefined });
  return {
    id: s.id,
    kind: s.kind,
    districtId: s.districtId,
    position: { lat: s.lat, lng: s.lng },
    status: s.status,
    name,
    visitCount: s.visitCount,
    label,
    color: district?.color ?? FALLBACK_SPOT_COLOR,
    fade: district?.fade ?? fadeVisual('fresh'),
    hasActiveShopEvent: s.hasActiveShopEvent,
  };
}

// ---------------------------------------------------------------------------
// 画面座標・ヒットテスト
// ---------------------------------------------------------------------------

/**
 * 地区ID で地区を探す。
 * @param vm 描画データ
 * @param districtId 地区ID
 * @returns 地区（無ければ undefined）
 */
export function findDistrict(vm: MapViewModel, districtId: string): MapDistrictVm | undefined {
  return vm.districts.find((d) => d.id === districtId);
}

/**
 * このズームで描くスポットを返す（広域は名所だけ。店舗は隠す）。
 * @param vm 描画データ
 * @param zoom ズーム段階
 * @returns 描くスポット
 */
export function spotsForZoom(vm: MapViewModel, zoom: MapZoom): readonly MapSpotVm[] { // audit-ignore: fnlog-missing 毎フレーム描画
  return showsShops(zoom) ? vm.spots : vm.spots.filter((s) => s.kind === 'landmark');
}

/**
 * このズームで描くスポットを画面座標に置く。
 * @param vm 描画データ
 * @param zoom ズーム段階
 * @param camera カメラ
 * @param vp 描画領域
 * @returns 画面座標つきのスポット
 */
export function screenSpots(vm: MapViewModel, zoom: MapZoom, camera: Camera, vp: Viewport): ScreenSpot[] { // audit-ignore: fnlog-missing 毎フレーム描画
  return spotsForZoom(vm, zoom).map((spot) => ({ spot, ...project(camera, vp, spot.position) }));
}

/**
 * 地区を画面座標に置く（ポリゴンとラベル位置）。
 * @param vm 描画データ
 * @param camera カメラ
 * @param vp 描画領域
 * @returns 画面座標つきの地区
 */
export function screenDistricts(vm: MapViewModel, camera: Camera, vp: Viewport): ScreenDistrict[] { // audit-ignore: fnlog-missing 毎フレーム描画
  return vm.districts.map((district) => {
    const polygon = district.polygon.map((p) => project(camera, vp, p));
    return { district, polygon, anchor: interiorPoint(polygon) };
  });
}

/**
 * 点が表示に使える領域（下シートで隠れる部分を除く）の内側にあるか。
 * @param point 画面上の点
 * @param vp 描画領域
 * @param margin 内側に取る余白（CSS px）
 * @returns 内側なら true
 */
export function isInView(point: Point2D, vp: Viewport, margin = 0): boolean {
  return point.x >= margin && point.x <= vp.width - margin && point.y >= margin && point.y <= usableHeight(vp) - margin;
}

/**
 * タップした点から radius 以内でいちばん近いスポットを返す。
 * @param spots 画面座標つきのスポット
 * @param tap タップした点（CSS px）
 * @param radius 判定半径（CSS px。既定 SPOT_HIT_RADIUS_PX）
 * @returns スポット（無ければ undefined）
 */
export function hitTestSpot(spots: readonly ScreenSpot[], tap: Point2D, radius = SPOT_HIT_RADIUS_PX): ScreenSpot | undefined {
  const log = logger.fn('hitTestSpot', { candidates: spots.length, radius });
  let best: ScreenSpot | undefined;
  let bestDistance = Infinity;
  for (const s of spots) {
    const d = distance2D(s, tap);
    if (d <= radius && d < bestDistance) {
      best = s;
      bestDistance = d;
    }
  }
  return log.exit(best, best === undefined ? 'なし' : best.spot.id);
}

/**
 * タップした点を含む地区を返す。
 * @param districts 画面座標つきの地区
 * @param tap タップした点（CSS px）
 * @returns 地区（どれにも入らなければ undefined）
 */
export function hitTestDistrict(districts: readonly ScreenDistrict[], tap: Point2D): ScreenDistrict | undefined {
  const log = logger.fn('hitTestDistrict', { candidates: districts.length });
  const hit = districts.find((d) => pointInPolygon(tap, d.polygon));
  return log.exit(hit, hit === undefined ? 'なし' : hit.district.id);
}

/**
 * 緯度経度がどの地区の中にあるかを返す（近接表示の地区名・歩行先の地区に使う）。
 * @param vm 描画データ
 * @param ll 緯度経度
 * @returns 地区ID（どの地区にも入らなければ undefined）
 */
export function districtAt(vm: MapViewModel, ll: LatLng): string | undefined {
  const log = logger.fn('districtAt', { districts: vm.districts.length });
  const origin = { x: 0, y: 0 };
  const hit = vm.districts.find((d) => pointInPolygon(origin, d.polygon.map((p) => toLocalMeters(ll, p))));
  return log.exit(hit?.id);
}

/**
 * 読み上げ用のスポット名（名前の無い未発見スポットは「未発見のスポット」）と距離の文言を作る。
 * @param spot スポット
 * @param meters 現在地からの距離（メートル。不明なら undefined）
 * @returns 例 '天満天神繁昌亭 62m'／'未発見のスポット 120m'
 */
export function spotAriaLabel(spot: MapSpotVm, meters: number | undefined): string {
  const log = logger.fn('spotAriaLabel', { spotId: spot.id, meters });
  const name = spot.name ?? '未発見のスポット';
  return log.exit(meters === undefined ? name : `${name} ${distanceLabel(Math.round(meters))}`);
}
