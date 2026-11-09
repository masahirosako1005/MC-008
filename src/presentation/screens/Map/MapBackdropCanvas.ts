/**
 * @file 地図の背景（ベースマップ）の描画（presentation/screens/Map 層。状態を持たない純粋な draw 関数群）
 * docs/08 §10.2・§10.4：Apple マップ／Google マップ風の淡いベースマップ。ゲームの情報（地区・建物・ピン）はこの上に重ねる。
 * レイヤー順: 陸（淡いクールグレー）→ 公園・境内・敷地（淡い面）→ 川（水色。縁取りなし）→ 道路（白＋縁。幹線は縁を濃く・太く）
 * → 商店街（淡いコーラルの帯＋中心にブランド色の細い破線）→ 鉄道（グレー＋白の破線）。ここまでを地区の塗りより下に描く。
 * 駅（白丸＋濃グレーの縁）と便利施設（「WC」などの角丸アイコン。地区・近接のみ）は地区の塗りの上に描く。
 * 線ラベル（商店街・川）・駅名・出典はラベルの重なり回避（labelLayout）を通して最後に置く。紙の質感・陰り・セピアは使わない。
 * 実在の地理（OpenStreetMap 由来）。出典「© OpenStreetMap contributors」を地図の左下に常時表示する（docs/08 §9、ODbL）。
 * requestAnimationFrame から毎フレーム呼ぶので関数ログは出さない（呼び出し側 MapScreen でまとめてログ）。座標は CSS px。
 */
import { canvasFont, drawCircle, drawPolygon, drawPolyline, drawRoundRect, drawTextWithOutline } from '@/Common/ui/canvas/drawUtils';
import type { Point2D, Rect } from '@/Common/ui/canvas/geometry';
import { inflateRect } from '@/Common/ui/canvas/labelLayout';
import type { LabelLayout } from '@/Common/ui/canvas/labelLayout';
import { PALETTE } from '@/Common/ui/theme/palette';
import {
  MIN_ARCADE_WIDTH_PX,
  MIN_LINE_WIDTH_PX,
  MIN_RAIL_WIDTH_PX,
  MIN_WATER_WIDTH_PX,
  lineLabelCandidates,
  lineWidthPx,
  projectPath,
} from '@/presentation/screens/Map/MapBackdropModel';
import type { AmenityKind, BackdropFeatureVm, BackdropVm, StationVm } from '@/presentation/screens/Map/MapBackdropModel';
import type { LatLng } from '@/presentation/screens/Map/MapViewModel';
import type { MapZoom } from '@/presentation/screens/Map/ZoomState';

/** 背景の色（docs/08 §10.2 の地図色。値は PALETTE に寄せ、縁などの派生色だけここで持つ。ブランド色は商店街の破線にだけ使う） */
export const BACKDROP_COLORS = {
  land: PALETTE.land,
  park: PALETTE.park,
  parkEdge: '#b9e0c4',
  shrine: PALETTE.shrine,
  shrineEdge: '#efcdc1',
  campus: PALETTE.campus,
  campusEdge: '#d9dde3',
  water: PALETTE.water,
  waterLabel: PALETTE.waterInk,
  road: PALETTE.road,
  roadCasing: PALETTE.roadCasing,
  arterialCasing: PALETTE.arterialCasing,
  arcade: PALETTE.arcade,
  arcadeEdge: '#f9cdbd',
  arcadeDash: PALETTE.brand,
  arcadeLabel: PALETTE.brandInk,
  rail: PALETTE.rail,
  railDash: PALETTE.rail,
  station: PALETTE.white,
  stationEdge: PALETTE.station,
  stationLabel: PALETTE.subInk,
  attribution: PALETTE.mutedInk,
  attributionFill: 'rgba(255, 255, 255, 0.85)',
  iconShadow: 'rgba(17, 24, 39, 0.18)',
  white: PALETTE.white,
} as const;

/** 便利施設アイコンの地色（文字は白。色だけでなく「WC」などの文字で区別する。地区色と紛れないよう無彩色寄り、AED だけ赤） */
export const AMENITY_COLORS: Readonly<Record<AmenityKind, string>> = { toilet: '#64748b', nursing: '#64748b', aed: '#dc2626' };

/** 面の地物の塗り・縁の色 */
const AREA_STYLES: Readonly<Record<'park' | 'shrine' | 'campus', { readonly fill: string; readonly edge: string }>> = {
  park: { fill: BACKDROP_COLORS.park, edge: BACKDROP_COLORS.parkEdge },
  shrine: { fill: BACKDROP_COLORS.shrine, edge: BACKDROP_COLORS.shrineEdge },
  campus: { fill: BACKDROP_COLORS.campus, edge: BACKDROP_COLORS.campusEdge },
};

/** これ以上の幅（メートル）の道路を幹線として、縁を濃く・太く描く */
export const ARTERIAL_ROAD_WIDTH_M = 20;
/** 鉄道の線の太さの上限（CSS px）。近接で太くなりすぎないように */
const MAX_RAIL_WIDTH_PX = 5;
/** 線ラベル・駅名を置くとき、表示領域の端から空ける余白（CSS px） */
const LABEL_EDGE_MARGIN = 14;
/** 画面外とみなす余白（CSS px） */
const OFFSCREEN_MARGIN = 40;
/** 駅名の文字サイズ（CSS px、拡大前） */
const STATION_LABEL_PX = 10.5;
/** 便利施設アイコンの1辺（CSS px、拡大前） */
const AMENITY_ICON_PX = 16;

/** 背景の描画入力（MapCanvas が1フレームごとに作る） */
export interface BackdropScene {
  readonly backdrop: BackdropVm;
  /** 緯度経度 → 画面座標（カメラ・描画領域を部分適用した project） */
  readonly toScreen: (ll: LatLng) => Point2D;
  readonly metersPerPx: number;
  readonly width: number;
  readonly height: number;
  /** 下シートで隠れる分を除いた、表示に使える高さ */
  readonly usableHeight: number;
  readonly zoom: MapZoom;
  /** 文字拡大の倍率 */
  readonly textScale: number;
}

/** 測った文字の大きさ */
interface TextBox {
  readonly width: number;
  readonly height: number;
}

/**
 * 地区の塗りより下に描く背景（陸・面・川・道路・商店街・鉄道）を描く。陸は淡いクールグレーの単色（質感・陰りは付けない）。
 * @param ctx 2D コンテキスト
 * @param scene 背景の描画入力
 * @sideEffect ctx に描画する
 */
export function drawBackdropBase(ctx: CanvasRenderingContext2D, scene: BackdropScene): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.fillStyle = BACKDROP_COLORS.land;
  ctx.fillRect(0, 0, scene.width, scene.height);
  ctx.restore();
  const { layers } = scene.backdrop;
  for (const kind of ['park', 'shrine', 'campus'] as const) for (const f of layers[kind]) drawAreaFeature(ctx, scene, f, AREA_STYLES[kind]);
  drawWater(ctx, scene, layers.water);
  drawRoads(ctx, scene, layers.road);
  drawArcades(ctx, scene, layers.arcade);
  drawRails(ctx, scene, layers.rail);
}

/**
 * 面の地物（公園・境内・敷地。line で来たら細い線）を描く。
 * @param ctx 2D コンテキスト
 * @param scene 背景の描画入力
 * @param f 地物
 * @param style 塗りと縁の色
 * @sideEffect ctx に描画する
 */
function drawAreaFeature(ctx: CanvasRenderingContext2D, scene: BackdropScene, f: BackdropFeatureVm, style: { readonly fill: string; readonly edge: string }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const path = projectPath(f.points, scene.toScreen);
  if (f.shape === 'area') drawPolygon(ctx, path, { fill: style.fill, stroke: style.edge, lineWidth: 1 });
  else drawPolyline(ctx, path, { color: style.edge, width: lineWidthPx(f.widthM, scene.metersPerPx) });
}

/**
 * 川を描く（面は塗り、線は水色の太線。地図アプリ風に縁取りはしない）。
 * @param ctx 2D コンテキスト
 * @param scene 背景の描画入力
 * @param features 川の地物
 * @sideEffect ctx に描画する
 */
function drawWater(ctx: CanvasRenderingContext2D, scene: BackdropScene, features: readonly BackdropFeatureVm[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (const f of features) {
    const path = projectPath(f.points, scene.toScreen);
    if (f.shape === 'area') drawPolygon(ctx, path, { fill: BACKDROP_COLORS.water });
    else drawPolyline(ctx, path, { color: BACKDROP_COLORS.water, width: lineWidthPx(f.widthM, scene.metersPerPx, MIN_WATER_WIDTH_PX) });
  }
}

/**
 * 道路を白い線＋薄いグレーの縁で描く（幹線＝ARTERIAL_ROAD_WIDTH_M 以上は縁を濃く・太く）。
 * 交差がつながって見えるよう、全部の縁を先に描いてから中身を描く。
 * @param ctx 2D コンテキスト
 * @param scene 背景の描画入力
 * @param features 道路の地物
 * @sideEffect ctx に描画する
 */
function drawRoads(ctx: CanvasRenderingContext2D, scene: BackdropScene, features: readonly BackdropFeatureVm[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const zoomed = scene.zoom !== 'wide';
  const roads = features
    .filter((f) => f.shape === 'line')
    .map((f) => ({ path: projectPath(f.points, scene.toScreen), w: lineWidthPx(f.widthM, scene.metersPerPx, MIN_LINE_WIDTH_PX), arterial: f.widthM >= ARTERIAL_ROAD_WIDTH_M }));
  for (const r of roads) {
    const casing = r.arterial ? (zoomed ? 3 : 2) : zoomed ? 2 : 1;
    drawPolyline(ctx, r.path, { color: r.arterial ? BACKDROP_COLORS.arterialCasing : BACKDROP_COLORS.roadCasing, width: r.w + casing });
  }
  for (const r of roads) drawPolyline(ctx, r.path, { color: BACKDROP_COLORS.road, width: r.w });
}

/**
 * 商店街（アーケード）を描く: 淡いコーラルの帯（薄い縁つき）の中心に、ブランド色の細い破線を引く（docs/08 §10.2）。
 * @param ctx 2D コンテキスト
 * @param scene 背景の描画入力
 * @param features 商店街の地物
 * @sideEffect ctx に描画する
 */
function drawArcades(ctx: CanvasRenderingContext2D, scene: BackdropScene, features: readonly BackdropFeatureVm[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (const f of features) {
    const path = projectPath(f.points, scene.toScreen);
    const w = lineWidthPx(f.widthM, scene.metersPerPx, MIN_ARCADE_WIDTH_PX);
    drawPolyline(ctx, path, { color: BACKDROP_COLORS.arcadeEdge, width: w + 2 });
    drawPolyline(ctx, path, { color: BACKDROP_COLORS.arcade, width: w });
    drawPolyline(ctx, path, { color: BACKDROP_COLORS.arcadeDash, width: Math.min(1.5, Math.max(1, w * 0.2)), dash: [4, 4], cap: 'butt', alpha: 0.85 });
  }
}

/**
 * 鉄道をグレーの線の上に白い破線を重ねて描く（太さは MAX_RAIL_WIDTH_PX まで）。
 * @param ctx 2D コンテキスト
 * @param scene 背景の描画入力
 * @param features 鉄道の地物
 * @sideEffect ctx に描画する
 */
function drawRails(ctx: CanvasRenderingContext2D, scene: BackdropScene, features: readonly BackdropFeatureVm[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (const f of features) {
    const path = projectPath(f.points, scene.toScreen);
    const w = Math.min(MAX_RAIL_WIDTH_PX, lineWidthPx(f.widthM, scene.metersPerPx, MIN_RAIL_WIDTH_PX));
    const dash = Math.max(4, w * 1.6);
    drawPolyline(ctx, path, { color: BACKDROP_COLORS.rail, width: w, cap: 'butt' });
    drawPolyline(ctx, path, { color: BACKDROP_COLORS.railDash, width: Math.max(1, w - 2), dash: [dash, dash], cap: 'butt' });
  }
}

/**
 * 点が画面外（余白込み）か判定する。
 * @param at 画面上の点
 * @param scene 背景の描画入力
 * @returns 画面外なら true
 */
function isOffscreen(at: Point2D, scene: BackdropScene): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
  return at.x < -OFFSCREEN_MARGIN || at.y < -OFFSCREEN_MARGIN || at.x > scene.width + OFFSCREEN_MARGIN || at.y > scene.height + OFFSCREEN_MARGIN;
}

/**
 * 駅の丸の半径を返す（広域は小さく）。
 * @param zoom ズーム段階
 * @returns 半径（CSS px）
 */
function stationRadius(zoom: MapZoom): number { // audit-ignore: fnlog-missing 毎フレーム描画
  return zoom === 'wide' ? 3.5 : 5;
}

/**
 * 駅を小さな丸（白地に濃いグレーの縁）で描く。名前は drawStationLabels で置く。
 * @param ctx 2D コンテキスト
 * @param scene 背景の描画入力
 * @sideEffect ctx に描画する
 */
export function drawStations(ctx: CanvasRenderingContext2D, scene: BackdropScene): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const r = stationRadius(scene.zoom);
  for (const s of scene.backdrop.stations) {
    const at = scene.toScreen(s.position);
    if (isOffscreen(at, scene)) continue;
    drawCircle(ctx, at, r, { fill: BACKDROP_COLORS.station, stroke: BACKDROP_COLORS.stationEdge, lineWidth: scene.zoom === 'wide' ? 1.75 : 2.25 });
  }
}

/**
 * 駅の丸の矩形を返す（線ラベルや名前がかぶらないように避けるため）。
 * @param scene 背景の描画入力
 * @returns 矩形（CSS px）
 */
export function stationMarkerRects(scene: BackdropScene): Rect[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const r = stationRadius(scene.zoom) + 1;
  return scene.backdrop.stations.map((s) => {
    const at = scene.toScreen(s.position);
    return { x: at.x - r, y: at.y - r, width: r * 2, height: r * 2 };
  });
}

/**
 * 便利施設アイコン（「WC」「授乳」「AED」入りの小さな角丸の正方形。文字が長ければ横に伸ばす）の矩形を返す。
 * @param ctx 2D コンテキスト（文字の幅を測る）
 * @param at アイコンの中心
 * @param glyph アイコンの文字
 * @param scale 文字拡大の倍率
 * @returns 矩形（CSS px）
 */
function amenityIconRect(ctx: CanvasRenderingContext2D, at: Point2D, glyph: string, scale: number): Rect { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(8, 700, scale);
  const side = AMENITY_ICON_PX * scale;
  const width = Math.max(side, ctx.measureText(glyph).width + 7 * scale);
  ctx.restore();
  return { x: at.x - width / 2, y: at.y - side / 2, width, height: side };
}

/**
 * 便利施設（公衆トイレ・授乳室・AED）をモダンな角丸アイコンで描く。広域では描かない（地区・近接だけ）。
 * @param ctx 2D コンテキスト
 * @param scene 背景の描画入力
 * @returns 描いたアイコンの矩形（ラベルが避けるため）
 * @sideEffect ctx に描画する
 */
export function drawAmenityPoints(ctx: CanvasRenderingContext2D, scene: BackdropScene): Rect[] { // audit-ignore: fnlog-missing 毎フレーム描画
  if (scene.zoom === 'wide') return [];
  const rects: Rect[] = [];
  for (const a of scene.backdrop.amenityPoints) {
    const at = scene.toScreen(a.position);
    if (isOffscreen(at, scene)) continue;
    const rect = amenityIconRect(ctx, at, a.glyph, scene.textScale);
    drawAmenityIcon(ctx, rect, a.kind, a.glyph, scene.textScale);
    rects.push(rect);
  }
  return rects;
}

/**
 * 便利施設アイコンを1つ描く（色の角丸＋白い縁＋ごく弱い影＋白い文字）。
 * @param ctx 2D コンテキスト
 * @param rect アイコンの矩形
 * @param kind 種類（地色を決める）
 * @param glyph アイコンの文字（'WC' など）
 * @param scale 文字拡大の倍率
 * @sideEffect ctx に描画する
 */
function drawAmenityIcon(ctx: CanvasRenderingContext2D, rect: Rect, kind: AmenityKind, glyph: string, scale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const radius = 5 * scale;
  ctx.save();
  ctx.shadowColor = BACKDROP_COLORS.iconShadow;
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  drawRoundRect(ctx, rect, radius, { fill: AMENITY_COLORS[kind] });
  ctx.restore();
  drawRoundRect(ctx, rect, radius, { stroke: BACKDROP_COLORS.white, lineWidth: 1.5 });
  drawTextWithOutline(ctx, glyph, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 + 0.5 }, { sizePx: 8, scale, weight: 700, color: BACKDROP_COLORS.white });
}

/**
 * 文字の大きさを測る（縁取りの分だけ少し広げる）。
 * @param ctx 2D コンテキスト
 * @param text 文字列
 * @param font 文字サイズ・太さ・倍率
 * @returns 幅と高さ（CSS px）
 */
export function measureLabel(ctx: CanvasRenderingContext2D, text: string, font: { readonly sizePx: number; readonly weight: number; readonly scale: number }): TextBox { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(font.sizePx, font.weight, font.scale);
  const width = ctx.measureText(text).width + 4 * font.scale;
  ctx.restore();
  return { width, height: font.sizePx * font.scale * 1.3 };
}

/**
 * 点が線ラベルを置ける範囲（表示領域から余白を除いた内側）にあるか。
 * @param p 点
 * @param scene 背景の描画入力
 * @returns 内側なら true
 */
function inLabelArea(p: Point2D, scene: BackdropScene): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
  const m = LABEL_EDGE_MARGIN;
  return p.x >= m && p.x <= scene.width - m && p.y >= m && p.y <= scene.usableHeight - m;
}

/** 線ラベルの置き方 */
interface LineLabelSpec {
  readonly sizePx: number;
  readonly color: string;
  /** 'center' は線の上（川）、'side' は線の右か左（商店街） */
  readonly placement: 'center' | 'side';
  readonly minPx: number;
  /** 文字の太さ（川は細め、商店街は太め） */
  readonly weight: number;
}

/**
 * 線ラベル（商店街・川の名前）を置いて描く。同じ名前は1回だけ。見えている部分の真ん中に近い位置から、空いている場所を探す。
 * 商店街は地区・近接だけ、川はすべてのズームで出す。
 * @param ctx 2D コンテキスト
 * @param scene 背景の描画入力
 * @param layout ラベル配置
 * @param avoid 避ける矩形（マーカー）
 * @sideEffect ctx に描画し、layout に登録する
 */
export function drawLineLabels(ctx: CanvasRenderingContext2D, scene: BackdropScene, layout: LabelLayout, avoid: readonly Rect[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { layers } = scene.backdrop;
  const arcade: LineLabelSpec = { sizePx: 11, color: BACKDROP_COLORS.arcadeLabel, placement: 'side', minPx: MIN_ARCADE_WIDTH_PX, weight: 700 };
  const water: LineLabelSpec = { sizePx: 11, color: BACKDROP_COLORS.waterLabel, placement: 'center', minPx: MIN_WATER_WIDTH_PX, weight: 500 };
  if (scene.zoom !== 'wide') placeNamedLineLabels(ctx, { scene, layout, avoid }, layers.arcade, arcade);
  placeNamedLineLabels(ctx, { scene, layout, avoid }, layers.water.filter((f) => f.shape === 'line'), water);
}

/** 線ラベル・駅名を置くときの共通の入力 */
export interface LabelContext {
  readonly scene: BackdropScene;
  readonly layout: LabelLayout;
  readonly avoid: readonly Rect[];
}

/**
 * 名前ごとに1つ、線ラベルを置いて描く。
 * @param ctx 2D コンテキスト
 * @param lc 背景の描画入力・ラベル配置・避ける矩形
 * @param features 線の地物
 * @param spec 置き方
 * @sideEffect ctx に描画し、layout に登録する
 */
function placeNamedLineLabels(ctx: CanvasRenderingContext2D, lc: LabelContext, features: readonly BackdropFeatureVm[], spec: LineLabelSpec): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const done = new Set<string>();
  for (const f of features) {
    if (f.name === '' || done.has(f.name)) continue;
    if (placeLineLabel(ctx, lc, f, spec)) done.add(f.name);
  }
}

/**
 * 1本の線に名前を置いて描く（マーカーを避けられる候補を優先し、無ければラベルどうしだけ避ける）。
 * @param ctx 2D コンテキスト
 * @param lc 背景の描画入力・ラベル配置・避ける矩形
 * @param f 線の地物
 * @param spec 置き方
 * @returns 置けたら true
 * @sideEffect ctx に描画し、layout に登録する
 */
function placeLineLabel(ctx: CanvasRenderingContext2D, lc: LabelContext, f: BackdropFeatureVm, spec: LineLabelSpec): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
  const { scene } = lc;
  const box = measureLabel(ctx, f.name, { sizePx: spec.sizePx, weight: spec.weight, scale: scene.textScale });
  const half = lineWidthPx(f.widthM, scene.metersPerPx, spec.minPx) / 2;
  const points = lineLabelCandidates(projectPath(f.points, scene.toScreen), (p) => inLabelArea(p, scene));
  const rects = points.flatMap((p): Rect[] => {
    const y = p.y - box.height / 2;
    if (spec.placement === 'center') return [{ x: p.x - box.width / 2, y, width: box.width, height: box.height }];
    return [
      { x: p.x + half + 3, y, width: box.width, height: box.height },
      { x: p.x - half - 3 - box.width, y, width: box.width, height: box.height },
    ];
  });
  const rect = lc.layout.place(rects, lc.avoid) ?? lc.layout.place(rects);
  if (rect === undefined) return false;
  const at = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  drawTextWithOutline(ctx, f.name, at, { sizePx: spec.sizePx, scale: scene.textScale, weight: spec.weight, color: spec.color, outlineColor: BACKDROP_COLORS.white, outlineWidth: 3 });
  return true;
}

/**
 * 駅名を置いて描く（地区・近接だけ。右→左→下→上の順に空いている場所。置けなければ省略）。
 * @param ctx 2D コンテキスト
 * @param lc 背景の描画入力・ラベル配置・避ける矩形
 * @sideEffect ctx に描画し、layout に登録する
 */
export function drawStationLabels(ctx: CanvasRenderingContext2D, lc: LabelContext): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { scene } = lc;
  if (scene.zoom === 'wide') return;
  const r = stationRadius(scene.zoom) + 2;
  for (const s of scene.backdrop.stations) {
    const at = scene.toScreen(s.position);
    if (!inLabelArea(at, scene)) continue;
    const rect = placeAround(ctx, lc, { at, r, text: s.label });
    if (rect !== undefined) drawStationName(ctx, s, rect, scene.textScale);
  }
}

/**
 * 点のまわり（右→左→下→上）に文字の箱を置く。
 * @param ctx 2D コンテキスト
 * @param lc 背景の描画入力・ラベル配置・避ける矩形
 * @param target 中心・マーカーの半径・文字列
 * @returns 置いた矩形（置けなければ undefined）
 * @sideEffect layout に登録する
 */
function placeAround(ctx: CanvasRenderingContext2D, lc: LabelContext, target: { readonly at: Point2D; readonly r: number; readonly text: string }): Rect | undefined { // audit-ignore: fnlog-missing 毎フレーム描画
  const box = measureLabel(ctx, target.text, { sizePx: STATION_LABEL_PX, weight: 700, scale: lc.scene.textScale });
  const { at, r } = target;
  const rects: Rect[] = [
    { x: at.x + r + 2, y: at.y - box.height / 2, width: box.width, height: box.height },
    { x: at.x - r - 2 - box.width, y: at.y - box.height / 2, width: box.width, height: box.height },
    { x: at.x - box.width / 2, y: at.y + r + 1, width: box.width, height: box.height },
    { x: at.x - box.width / 2, y: at.y - r - 1 - box.height, width: box.width, height: box.height },
  ];
  return lc.layout.place(rects, lc.avoid);
}

/**
 * 駅名を描く。
 * @param ctx 2D コンテキスト
 * @param s 駅
 * @param rect 置いた矩形
 * @param scale 文字拡大の倍率
 * @sideEffect ctx に描画する
 */
function drawStationName(ctx: CanvasRenderingContext2D, s: StationVm, rect: Rect, scale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const at = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  drawTextWithOutline(ctx, s.label, at, { sizePx: STATION_LABEL_PX, scale, weight: 700, color: BACKDROP_COLORS.stationLabel, outlineColor: BACKDROP_COLORS.white, outlineWidth: 3 });
}

/**
 * 出典（© OpenStreetMap contributors）を地図の左下（下シートより上）に小さく描き、その場所を layout に予約する。
 * @param ctx 2D コンテキスト
 * @param scene 背景の描画入力
 * @param layout ラベル配置
 * @sideEffect ctx に描画し、layout に登録する
 */
export function drawAttribution(ctx: CanvasRenderingContext2D, scene: BackdropScene, layout: LabelLayout): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const text = scene.backdrop.attribution;
  if (text === undefined) return;
  const box = measureLabel(ctx, text, { sizePx: 9, weight: 400, scale: scene.textScale });
  const rect = { x: 6, y: scene.usableHeight - 6 - box.height, width: box.width + 8, height: box.height + 2 };
  drawRoundRect(ctx, rect, 4, { fill: BACKDROP_COLORS.attributionFill });
  drawTextWithOutline(ctx, text, { x: rect.x + 6, y: rect.y + rect.height / 2 }, { sizePx: 9, scale: scene.textScale, color: BACKDROP_COLORS.attribution, align: 'left' });
  layout.reserve(inflateRect(rect, 2));
}
