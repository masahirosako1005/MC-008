/**
 * @file 地図の背景（川・公園・境内・道路・商店街・線路・駅・公衆トイレ）の描画データ（presentation/screens/Map 層。純粋関数）
 * MapBackdropDto を描画用に検証・整形し（点が足りない地物は捨てる・太さの既定値）、メートル→px の換算、線ラベルの候補位置を提供する。
 * 背景は実在の地理（OpenStreetMap 由来）で、ゲームの進捗には関わらない（docs/08 §9）。出典は地図の左下に常時表示する（ODbL）。
 * 位置座標はログに出さない（件数・ID だけ）。換算・候補位置は描画ループから毎フレーム呼ぶので関数ログを出さない。
 */
import type { MapBackdropDto, MapFeatureDto, MapFeatureKindDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import type { LatLng } from '@/presentation/screens/Map/MapViewModel';

const logger = createLogger('presentation/screens/Map/MapBackdropModel');

/** 出典の既定（データに無いとき。背景は OpenStreetMap 由来＝docs/08 §9） */
export const DEFAULT_ATTRIBUTION = '© OpenStreetMap contributors';
/** 線の最小の太さ（CSS px）。広域でも道路が消えないように */
export const MIN_LINE_WIDTH_PX = 2;
/** widthM が無い線の太さ（メートル） */
export const DEFAULT_LINE_WIDTH_M: Readonly<Record<MapFeatureKindDto, number>> = {
  water: 60,
  park: 6,
  shrine: 6,
  campus: 6,
  arcade: 12,
  road: 12,
  rail: 10,
};
/** 建物を線（川・道路・商店街・線路）から離す余白（メートル。線の太さの半分に足す） */
export const BUILDING_LINE_CLEARANCE_M = 8;
/** 線ラベルの候補を線に沿って取る間隔（CSS px） */
export const LINE_LABEL_STEP_PX = 24;

/** 便利施設ポイントの種類（DTO と同じ） */
export type AmenityKind = 'toilet' | 'nursing' | 'aed';

/** 便利施設アイコンの文字（「WC」入りの角丸など） */
export const AMENITY_GLYPHS: Readonly<Record<AmenityKind, string>> = { toilet: 'WC', nursing: '授乳', aed: 'AED' };

/** 背景地物（描画用） */
export interface BackdropFeatureVm {
  readonly id: string;
  readonly kind: MapFeatureKindDto;
  readonly name: string;
  readonly shape: 'line' | 'area';
  readonly points: readonly LatLng[];
  /** 線の太さ（メートル。area では使わない） */
  readonly widthM: number;
}

/** 駅（描画用） */
export interface StationVm {
  readonly id: string;
  /** 地図に添える文字（例 '南森町駅'） */
  readonly label: string;
  readonly position: LatLng;
  readonly lines: string;
}

/** 便利施設ポイント（描画用） */
export interface AmenityPointVm {
  readonly id: string;
  readonly kind: AmenityKind;
  readonly name: string;
  /** アイコンの文字（'WC' など） */
  readonly glyph: string;
  readonly position: LatLng;
}

/** 背景地物を種類ごとに分けたもの（描く順はレイヤーごと） */
export type BackdropLayers = Readonly<Record<MapFeatureKindDto, readonly BackdropFeatureVm[]>>;

/** 地図の背景一式（描画用） */
export interface BackdropVm {
  readonly layers: BackdropLayers;
  readonly stations: readonly StationVm[];
  readonly amenityPoints: readonly AmenityPointVm[];
  /** 出典表示（背景が空でなければ必ず入る） */
  readonly attribution?: string;
}

/** 建物を置かない線（川・道路など） */
export interface AvoidLine {
  readonly points: readonly LatLng[];
  /** 線の中心からこの距離（メートル）以内には置かない */
  readonly clearanceM: number;
}

/** 空の背景 */
export const EMPTY_BACKDROP_VM: BackdropVm = { layers: emptyLayers(), stations: [], amenityPoints: [] };

/**
 * 種類ごとの空の配列を作る。
 * @returns 空のレイヤー
 */
function emptyLayers(): Record<MapFeatureKindDto, BackdropFeatureVm[]> {
  return { water: [], park: [], shrine: [], campus: [], arcade: [], road: [], rail: [] };
}

/**
 * 緯度経度が有限の数か。
 * @param p 点
 * @returns 有限なら true
 */
function isFinitePoint(p: { readonly lat: number; readonly lng: number }): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/**
 * 背景地物 DTO を描画用に変換する（点が足りない＝line は2点未満・area は3点未満、なら捨てる）。
 * @param f 地物 DTO
 * @returns 描画用の地物（捨てるなら undefined）
 */
function toFeatureVm(f: MapFeatureDto): BackdropFeatureVm | undefined {
  const log = logger.fn('toFeatureVm', { featureId: f.id, kind: f.kind, shape: f.shape, points: f.points.length });
  const points = f.points.filter(isFinitePoint).map((p) => ({ lat: p.lat, lng: p.lng }));
  if (points.length < (f.shape === 'area' ? 3 : 2)) return log.exit(undefined, '点が足りないため捨てる');
  const widthM = f.widthM !== undefined && Number.isFinite(f.widthM) && f.widthM > 0 ? f.widthM : DEFAULT_LINE_WIDTH_M[f.kind];
  return log.exit({ id: f.id, kind: f.kind, name: f.name, shape: f.shape, points, widthM });
}

/**
 * 駅名に「駅」を付けた地図用の文字を返す（すでに付いていればそのまま）。
 * @param name 駅名
 * @returns 例 '南森町駅'
 */
export function stationLabel(name: string): string {
  return name.endsWith('駅') ? name : `${name}駅`;
}

/**
 * 背景 DTO を描画用に変換する（データ取得のたびに1回）。座標が壊れた地物・駅・ポイントは捨てる。
 * @param dto 背景 DTO（無ければ空の背景）
 * @returns 描画用の背景
 */
export function buildBackdropVm(dto: MapBackdropDto | undefined): BackdropVm {
  const log = logger.fn('buildBackdropVm', { features: dto?.features.length ?? 0, stations: dto?.stations.length ?? 0, amenityPoints: dto?.amenityPoints.length ?? 0 });
  if (dto === undefined) return log.exit(EMPTY_BACKDROP_VM, 'データなし');
  const layers = emptyLayers();
  let dropped = 0;
  for (const f of dto.features) {
    const vm = toFeatureVm(f);
    if (vm === undefined) dropped++;
    else layers[vm.kind].push(vm);
  }
  const stations = dto.stations.filter(isFinitePoint).map((s) => ({ id: s.id, label: stationLabel(s.name), position: { lat: s.lat, lng: s.lng }, lines: s.lines }));
  const amenityPoints = dto.amenityPoints
    .filter(isFinitePoint)
    .map((a) => ({ id: a.id, kind: a.kind, name: a.name, glyph: AMENITY_GLYPHS[a.kind], position: { lat: a.lat, lng: a.lng } }));
  const hasContent = dto.features.length + stations.length + amenityPoints.length > 0;
  const attribution = dto.attribution !== undefined && dto.attribution.trim() !== '' ? dto.attribution : hasContent ? DEFAULT_ATTRIBUTION : undefined;
  log.exit({ dropped, stations: stations.length, amenityPoints: amenityPoints.length });
  return { layers, stations, amenityPoints, attribution };
}

/**
 * 建物を置かない線（川・道路・商店街・線路）を返す。余白は線の太さの半分＋BUILDING_LINE_CLEARANCE_M。
 * 川の面（area）は avoidAreas で別に返す。
 * @param backdrop 背景
 * @returns 避ける線
 */
export function buildingAvoidLines(backdrop: BackdropVm): AvoidLine[] {
  const log = logger.fn('buildingAvoidLines');
  const kinds: readonly MapFeatureKindDto[] = ['water', 'road', 'arcade', 'rail'];
  const lines = kinds
    .flatMap((k) => backdrop.layers[k])
    .filter((f) => f.shape === 'line')
    .map((f) => ({ points: f.points, clearanceM: f.widthM / 2 + BUILDING_LINE_CLEARANCE_M }));
  return log.exit(lines, `${lines.length}本`);
}

/**
 * 建物を置かない面（川の面）を返す。
 * @param backdrop 背景
 * @returns 避ける面（多角形の頂点）
 */
export function buildingAvoidAreas(backdrop: BackdropVm): (readonly LatLng[])[] {
  const log = logger.fn('buildingAvoidAreas');
  const areas = backdrop.layers.water.filter((f) => f.shape === 'area').map((f) => f.points);
  return log.exit(areas, `${areas.length}面`);
}

/**
 * 線の太さ（メートル）を画面の px に換算する（最小 minPx）。
 * @param widthM 太さ（メートル）
 * @param metersPerPx 1 CSS px あたりのメートル
 * @param minPx 最小の太さ（CSS px。既定 MIN_LINE_WIDTH_PX）
 * @returns 太さ（CSS px）
 */
export function lineWidthPx(widthM: number, metersPerPx: number, minPx = MIN_LINE_WIDTH_PX): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  if (!(metersPerPx > 0) || !Number.isFinite(widthM)) return minPx;
  return Math.max(minPx, widthM / metersPerPx);
}

/**
 * 緯度経度の列を画面座標の列にする。
 * @param points 緯度経度の列
 * @param toScreen 1点の変換（project を部分適用したもの）
 * @returns 画面座標の列
 */
export function projectPath(points: readonly LatLng[], toScreen: (ll: LatLng) => Point2D): Point2D[] { // audit-ignore: fnlog-missing 毎フレーム描画
  return points.map(toScreen);
}

/**
 * 折れ線に沿って step px ごとに点を取り、見えている点だけを「見えている部分の真ん中に近い順」に返す（線ラベルの候補位置）。
 * @param path 折れ線（画面座標）
 * @param visible 点が見えているか（表示領域の内側か）
 * @param step 間隔（CSS px。既定 LINE_LABEL_STEP_PX）
 * @returns 候補位置（見えていなければ空）
 */
export function lineLabelCandidates(path: readonly Point2D[], visible: (p: Point2D) => boolean, step = LINE_LABEL_STEP_PX): Point2D[] { // audit-ignore: fnlog-missing 毎フレーム描画（線ラベルの位置）
  const samples: Point2D[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a === undefined || b === undefined) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, step)));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) samples.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const shown = samples.filter(visible);
  const mid = (shown.length - 1) / 2;
  return shown.map((p, i) => ({ p, d: Math.abs(i - mid) })).sort((a, b) => a.d - b.d).map((x) => x.p);
}
