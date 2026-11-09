/**
 * @file 地図の描画（presentation/screens/Map 層。状態を持たない純粋な draw 関数群）
 * 背景（陸・公園・川・道路・商店街・鉄道＝MapBackdropCanvas）→ 地区（成長Lv・色あせ。背景が透ける半透明）→ 建物 → 地区パルス
 * → 発見範囲（80m 破線円の1つだけ）・足あと → 駅・便利施設 → スポット → 旗（Lv3）→ ラベル（重なり回避）→ 現在地 → 発見リング の順に描く。
 * 成長: Lv0=破線の輪郭のみ／Lv1=地区色を薄く塗る／Lv2=＋建物／Lv3=＋名所に旗（CLAUDE.md 4.3）。
 * 色あせは彩度・透明度・破線・小アイコン ◌ の4重で示す（色だけに頼らない＝CLAUDE.md 6.1）。
 * ラベルは優先順（出典 → 地区ラベル／左上のタグ → 商店街・川 → 名所 → 駅 → 店舗）に置き、重なるものは位置を変えるか省略する。
 * requestAnimationFrame から毎フレーム呼ぶので関数ログは出さない（呼び出し側 MapScreen でまとめてログ）。座標は CSS px。
 */
import { canvasFont, drawCircle, drawPolygon, drawRoundRect, drawTextWithOutline } from '@/Common/ui/canvas/drawUtils';
import type { ShapeStyle } from '@/Common/ui/canvas/drawUtils';
import { FADE_ICON, fadedFill } from '@/Common/ui/canvas/fadeStyle';
import { mixColors, toRgba } from '@/Common/ui/canvas/colorUtils';
import { pointInPolygon, polygonBounds, topLabelSlot } from '@/Common/ui/canvas/geometry';
import type { Point2D, Rect } from '@/Common/ui/canvas/geometry';
import { createLabelLayout } from '@/Common/ui/canvas/labelLayout';
import type { LabelLayout } from '@/Common/ui/canvas/labelLayout';
import { DISCOVERY_RADIUS_M } from '@/domain/exploration/constants';
import {
  BACKDROP_COLORS,
  drawAmenityPoints,
  drawAttribution,
  drawBackdropBase,
  drawLineLabels,
  drawStationLabels,
  drawStations,
  measureLabel,
  stationMarkerRects,
} from '@/presentation/screens/Map/MapBackdropCanvas';
import type { BackdropScene } from '@/presentation/screens/Map/MapBackdropCanvas';
import { clamp01, project, screenDistricts, screenSpots, usableHeight } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, LatLng, MapDistrictVm, MapSpotVm, MapViewModel, ScreenDistrict, ScreenSpot, Viewport } from '@/presentation/screens/Map/MapViewModel';
import type { MapZoom } from '@/presentation/screens/Map/ZoomState';
import { PALETTE } from '@/Common/ui/theme/palette';
import { drawHouse as drawMiniHouse, drawIsland, drawLamps, drawTrees, fadeTone, houseSize } from '@/presentation/screens/Map/mapArt';
import type { IslandInput } from '@/presentation/screens/Map/mapArt';
import { MINI_PIN_RADIUS, bubbleRect, drawBubble, drawCrown, drawDistrictBadge, drawPin, drawPositionMarker, drawTagChips, measureBubble, measureDistrictBadge, pinRadius, resolvePinRadii } from '@/presentation/screens/Map/mapPins';
import type { BubbleSide, DistrictBadgeInput } from '@/presentation/screens/Map/mapPins';

/** 地図の色（Common/ui/theme/palette.ts の PALETTE に寄せる。背景の淡色は MapBackdropCanvas の BACKDROP_COLORS） */
export const MAP_COLORS = {
  land: BACKDROP_COLORS.land,
  accent: PALETTE.brand,
  accentStrong: PALETTE.brandInk,
  ink: PALETTE.ink,
  subInk: PALETTE.subInk,
  mutedInk: PALETTE.mutedInk,
  white: PALETTE.white,
  lv0Stroke: PALETTE.mutedInk,
  silhouette: PALETTE.discovered,
  unknownStroke: PALETTE.unknown,
  unknownText: PALETTE.mutedInk,
  pole: '#6b5a48',
} as const;

/** 地区の島の塗りの不透明度（広域。背景の道路・川がうっすら透ける） */
const ISLAND_WASH_WIDE = 0.86;
/** 地区の島の塗りの不透明度（地区・近接。背景とスポットを見やすく） */
const ISLAND_WASH_ZOOMED = 0.62;
/** 発見リングが広がる時間（ミリ秒） */
export const DISCOVERY_RING_MS = 600;
/** 地区パルスの時間（ミリ秒） */
export const DISTRICT_PULSE_MS = 1200;
/** 成長段階ごとの地区の塗りの不透明度（Lv0 は塗らない。背景の道路・川が透けて見える濃さ） */
export const DISTRICT_FILL_ALPHA: readonly number[] = [0, 0.2, 0.3, 0.4];
/** 地区・近接ズームでは塗りをさらに薄くしてスポットと背景を見やすくする係数 */
const ZOOMED_FILL_FACTOR = 0.55;
/** 建物1棟の大きさ（メートル）。画面では 5〜13px に丸める */
const BUILDING_SIZE_M = 26;
/** 破線のパターン（地区の輪郭・色あせ） */
const OUTLINE_DASH: readonly number[] = [6, 4];
/** 画面外とみなす余白（CSS px） */
const OFFSCREEN_MARGIN = 40;
/** 広域の地区ラベルの下地（下の背景と重なっても読めるように） */
const LABEL_PILL_FILL = 'rgba(255, 255, 255, 0.88)';
/** 現在地の淡い輪の半径（CSS px） */
const POSITION_HALO_PX = 15;
/** スポット名の文字サイズ（CSS px、拡大前） */
const SPOT_LABEL_PX = 11;
/** ラベルを画面の端からこれだけ内側に収める（CSS px） */
const LABEL_EDGE_PX = 8;
/** ラベルどうし・ピン・駅との最低の間隔（CSS px） */
const LABEL_GAP_PX = 8;
/** 地区の札とピン・ほかの札との最低の間隔（CSS px） */
const BADGE_GAP_PX = 12;
/** 広域で同じ地区のピンを1本にまとめる距離（CSS px） */
const GROUP_PX = 30;
/** 成長段階ごとの白いブロックの棟数（Lv0 は建物なし） */
const BLOCK_COUNT_BY_LEVEL: readonly number[] = [0, 3, 6, 11];
/** ピンからこの距離（CSS px）より近い駅・便利施設は描かない（重なり防止） */
const STATION_CLEARANCE_PX = 18;
/** 自分のアイコンの周りでピンを避ける半径（CSS px） */
const SELF_CLEARANCE_PX = 16;

/** 発見リング（スポットが見つかった瞬間の輪） */
export interface DiscoveryRing {
  readonly spotId: string;
  /** performance.now() の時刻 */
  readonly startedAt: number;
}

/** 地区パルス（成長・復活した地区を光らせる） */
export interface DistrictPulse {
  readonly districtId: string;
  /** performance.now() の時刻 */
  readonly startedAt: number;
}

/**
 * このフレームで各ピンを描く半径（重なったピンは小さな点にする）。drawMap の冒頭で決め、マーカー・ラベル・旗・王冠で共有する。
 * 描画ループは1本なのでフレーム単位の作業領域として持つ（状態の保存には使わない）。
 */
let frameRadii: ReadonlyMap<string, number> = new Map();

/** 1フレームの描画入力 */
export interface MapDrawInput {
  readonly vm: MapViewModel;
  readonly camera: Camera;
  readonly viewport: Viewport;
  readonly zoom: MapZoom;
  /** 地区・近接ズームで注目している地区 */
  readonly focusDistrictId?: string;
  /** 現在地（不明なら undefined） */
  readonly position?: LatLng;
  /** 足あと（古い順） */
  readonly footprints: readonly LatLng[];
  readonly rings: readonly DiscoveryRing[];
  readonly pulse?: DistrictPulse;
  /** 文字拡大の倍率（textScaleFactor()） */
  readonly textScale: number;
}

/** 地図のタグ（主・色あせ・そろそろ） */
interface MapTag {
  readonly text: string;
  readonly kind: 'lord' | 'fade' | 'soon';
}

/** ラベルを置く段階で使う、1フレーム分の画面上の情報 */
interface LabelFrame {
  readonly input: MapDrawInput;
  readonly scene: BackdropScene;
  readonly districts: readonly ScreenDistrict[];
  readonly spots: readonly ScreenSpot[];
  /** ラベルがかぶらないよう避けるマーカー（スポット・駅・便利施設・現在地） */
  readonly markers: readonly Rect[];
  /** すでに描いた文字（発見範囲の距離など）。ラベルはここに重ねない */
  readonly reserved: readonly Rect[];
}

/**
 * 地図を1フレーム描く（beginFrame で消去・dpr 変換を済ませてから呼ぶ）。
 * 広域では未発見の「？」ピンを描かず地区の札に「?n」とまとめる。近いピンどうしは低い優先度の方を少しずらし、細い引き出し線で元の地点を示す。
 * @param ctx 2D コンテキスト
 * @param input 描画入力
 * @param t 現在時刻（performance.now()。演出の進み具合に使う）
 * @sideEffect ctx に描画する
 */
export function drawMap(ctx: CanvasRenderingContext2D, input: MapDrawInput, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const districts = screenDistricts(input.vm, input.camera, input.viewport);
  const all = screenSpots(input.vm, input.zoom, input.camera, input.viewport).filter((s) => !isOffscreen(s, input.viewport));
  const known = input.zoom === 'wide' ? all.filter((s) => s.spot.status !== 'unknown') : all;
  const grouped = input.zoom === 'wide' ? groupNearPins(known) : { reps: known, extra: new Map<string, number>() };
  const visible = grouped.reps;
  frameRadii = resolvePinRadii(visible, input.zoom);
  const self = input.position === undefined ? undefined : project(input.camera, input.viewport, input.position);
  const shown = spreadPins(visible, input.zoom, self);
  const scene = backdropScene(input);
  drawBackdropBase(ctx, scene);
  for (const d of districts) drawDistrictArea(ctx, d, input);
  for (const d of districts) drawBuildings(ctx, d.district, input);
  if (input.pulse !== undefined) drawPulse(ctx, districts, input.pulse, t);
  const reserved: Rect[] = [];
  if (input.zoom !== 'wide') {
    const radiusLabel = drawProximity(ctx, input);
    if (radiusLabel !== undefined) reserved.push(radiusLabel);
    drawFootprints(ctx, input);
  }
  const quietScene = withoutStationsNear(scene, shown);
  drawStations(ctx, quietScene);
  const amenityRects = drawAmenityPoints(ctx, quietScene);
  drawLeaderLines(ctx, shown, visible);
  for (const s of shown) drawSpotMarker(ctx, s, input);
  for (const s of shown) drawGroupCount(ctx, s, grouped.extra.get(s.spot.id) ?? 0, input);
  const markers = [...shown.map((s) => spotMarkerRect(s, input.zoom)), ...stationMarkerRects(quietScene), ...amenityRects, ...positionRects(input)];
  drawLabels(ctx, { input, scene: quietScene, districts, spots: shown, markers, reserved });
  drawLordCrowns(ctx, shown, input);
  drawPosition(ctx, input);
  drawRings(ctx, all, input.rings, t);
}

/**
 * 広域で、同じ地区の中で近すぎる（GROUP_PX 以内）ピンを1本にまとめる（代表は訪問回数の多い名所）。まとめた数は代表に「+n」で添える。
 * タップ判定は MapScreen が元の位置で行うので、地図の正確さは変わらない。
 * @param spots 画面座標つきのスポット
 * @returns 代表のスポットと、代表ごとのまとめた数
 */
function groupNearPins(spots: readonly ScreenSpot[]): { readonly reps: ScreenSpot[]; readonly extra: Map<string, number> } { // audit-ignore: fnlog-missing 毎フレーム描画
  const order = [...spots].sort((a, b) => (b.spot.status === 'visited' ? 1 : 0) - (a.spot.status === 'visited' ? 1 : 0) || b.spot.visitCount - a.spot.visitCount);
  const reps: ScreenSpot[] = [];
  const extra = new Map<string, number>();
  for (const s of order) {
    const host = reps.find((r) => r.spot.districtId === s.spot.districtId && Math.hypot(r.x - s.x, r.y - s.y) < GROUP_PX);
    if (host === undefined) reps.push(s);
    else extra.set(host.spot.id, (extra.get(host.spot.id) ?? 0) + 1);
  }
  return { reps, extra };
}

/**
 * まとめたピンの数（「+n」の小さな紺のピル）をピンの左肩に描く。
 * @param ctx 2D コンテキスト
 * @param s 代表のスポット（表示位置）
 * @param n まとめた数（0 なら描かない）
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawGroupCount(ctx: CanvasRenderingContext2D, s: ScreenSpot, n: number, input: MapDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (n <= 0) return;
  const r = spotRadius(s.spot, input.zoom);
  const text = `+${n}`;
  ctx.save();
  ctx.font = canvasFont(9, 700, input.textScale);
  const w = ctx.measureText(text).width + 8;
  const rect = { x: s.x - r - w * 0.6, y: s.y - r - 6, width: w, height: 13 };
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 6.5);
  ctx.fillStyle = PALETTE.white;
  ctx.fill();
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = PALETTE.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2 + 0.5);
  ctx.restore();
}

/**
 * 近すぎるピンを少しずらした表示位置を返す（優先度の高いピンは動かさない。最大2周まで押し出す）。
 * @param spots 画面座標つきのスポット
 * @param zoom ズーム段階
 * @param self 現在地（自分のアイコン。ピンをここから避ける）
 * @returns 表示位置に置き換えたスポット（入力と同じ順）
 */
function spreadPins(spots: readonly ScreenSpot[], zoom: MapZoom, self: Point2D | undefined): ScreenSpot[] { // audit-ignore: fnlog-missing 毎フレーム描画
  /**
   * ピンの優先度（大きいほど動かさない）。
   * @param s スポット
   * @returns 優先度
   */
  const rank = (s: ScreenSpot): number => (s.spot.status === 'visited' ? 200 : s.spot.status === 'discovered' ? 100 : 0) + (s.spot.kind === 'landmark' ? 50 : 0) + Math.min(49, s.spot.visitCount);
  const order = [...spots].sort((a, b) => rank(b) - rank(a));
  const placed: { x: number; y: number; r: number }[] = self === undefined ? [] : [{ x: self.x, y: self.y, r: SELF_CLEARANCE_PX }];
  const moved = new Map<string, Point2D>();
  for (const s of order) {
    const r = s.spot.kind === 'landmark' ? pinRadius(s.spot, zoom) * 1.45 + 6 : pinRadius(s.spot, zoom) + 6;
    let at = { x: s.x, y: s.y };
    for (let pass = 0; pass < 3; pass++) {
      const hit = placed.find((p) => Math.hypot(p.x - at.x, p.y - at.y) < p.r + r + 2);
      if (hit === undefined) break;
      const dx = at.x - hit.x;
      const dy = at.y - hit.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = len < 0.5 ? 0.7 : dx / len;
      const uy = len < 0.5 ? -0.7 : dy / len;
      at = { x: hit.x + ux * (hit.r + r + 4), y: hit.y + uy * (hit.r + r + 4) };
    }
    placed.push({ ...at, r });
    if (at.x !== s.x || at.y !== s.y) moved.set(s.spot.id, at);
  }
  return spots.map((s) => {
    const at = moved.get(s.spot.id);
    return at === undefined ? s : { spot: s.spot, x: at.x, y: at.y };
  });
}

/**
 * ずらしたピンから元の地点へ細い引き出し線と小さな点を描く。
 * @param ctx 2D コンテキスト
 * @param shown 表示位置のスポット
 * @param original 元の位置のスポット（同じ順）
 * @sideEffect ctx に描画する
 */
function drawLeaderLines(ctx: CanvasRenderingContext2D, shown: readonly ScreenSpot[], original: readonly ScreenSpot[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.strokeStyle = toRgba(PALETTE.subInk, 0.55);
  ctx.fillStyle = PALETTE.subInk;
  ctx.lineWidth = 1.2;
  shown.forEach((s, i) => {
    const o = original[i];
    if (o === undefined || (o.x === s.x && o.y === s.y)) return;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(o.x, o.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

/**
 * ピンの近く（18px 以内）にある駅・便利施設を外した背景の描画入力を返す（ピンに白丸が重ならないように）。
 * @param scene 背景の描画入力
 * @param pins 表示位置のスポット
 * @returns 背景の描画入力
 */
function withoutStationsNear(scene: BackdropScene, pins: readonly ScreenSpot[]): BackdropScene { // audit-ignore: fnlog-missing 毎フレーム描画
  /**
   * その地点がピンから十分離れているか。
   * @param ll 緯度経度
   * @returns 離れていれば true
   */
  const clear = (ll: LatLng): boolean => { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な判定
    const at = scene.toScreen(ll);
    return !pins.some((p) => Math.hypot(p.x - at.x, p.y - at.y) < STATION_CLEARANCE_PX);
  };
  return {
    ...scene,
    backdrop: {
      ...scene.backdrop,
      stations: scene.backdrop.stations.filter((st) => clear(st.position)),
      amenityPoints: scene.backdrop.amenityPoints.filter((a) => clear(a.position)),
    },
  };
}

/**
 * 背景の描画入力を作る（project をカメラと描画領域で部分適用する）。
 * @param input 描画入力
 * @returns 背景の描画入力
 */
function backdropScene(input: MapDrawInput): BackdropScene { // audit-ignore: fnlog-missing 毎フレーム描画
  return {
    backdrop: input.vm.backdrop,
    toScreen: (ll: LatLng): Point2D => project(input.camera, input.viewport, ll),
    metersPerPx: input.camera.metersPerPx,
    width: input.viewport.width,
    height: input.viewport.height,
    usableHeight: usableHeight(input.viewport),
    zoom: input.zoom,
    textScale: input.textScale,
  };
}

/**
 * 発見リングがまだ動いているか。
 * @param rings 発見リング
 * @param t 現在時刻
 * @returns 1つでも再生中なら true
 */
export function ringsActive(rings: readonly DiscoveryRing[], t: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画（ループ継続の判定）
  return rings.some((r) => t - r.startedAt < DISCOVERY_RING_MS);
}

/**
 * 地区パルスがまだ動いているか。
 * @param pulse 地区パルス
 * @param t 現在時刻
 * @returns 再生中なら true
 */
export function pulseActive(pulse: DistrictPulse | undefined, t: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画（ループ継続の判定）
  return pulse !== undefined && t - pulse.startedAt < DISTRICT_PULSE_MS;
}

/**
 * 地区の面を「ベースマップに重ねる情報レイヤー」として描く（半透明の地区色＋細い実線。docs/08 §10.4）。
 * @param ctx 2D コンテキスト
 * @param d 画面座標つきの地区
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawDistrictArea(ctx: CanvasRenderingContext2D, d: ScreenDistrict, input: MapDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  drawIsland(ctx, islandInputOf(d, input));
}

/**
 * 地区の島の描画入力を作る（広域は濃いめ、地区・近接は背景とスポットが見えるよう淡く）。
 * @param d 画面座標つきの地区
 * @param input 描画入力
 * @returns 島の入力
 */
function islandInputOf(d: ScreenDistrict, input: MapDrawInput): IslandInput { // audit-ignore: fnlog-missing 毎フレーム描画
  const zoomed = input.zoom !== 'wide';
  return {
    id: d.district.id,
    color: d.district.color,
    level: d.district.level,
    fade: d.district.fade,
    polygon: d.polygon,
    metersPerPx: input.camera.metersPerPx,
    zoomed,
    focused: zoomed && input.focusDistrictId === d.district.id,
    wash: zoomed ? ISLAND_WASH_ZOOMED : ISLAND_WASH_WIDE,
  };
}

/**
 * 地区の「育ち」を白いブロックの街区で見せる（Lv1＝3棟・Lv2＝6棟・Lv3＝11棟。Lv3 は2〜3段の高い建物を混ぜて窓に灯り）。
 * 建物は 16〜24px の白い立体（屋根の縁が地区色・弱い影）で、ピンと札から離れた1か所にかたまりで置く。成長は下がらないので棟数も減らない（色あせは色だけ）。
 * @param ctx 2D コンテキスト
 * @param district 地区
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawBuildings(ctx: CanvasRenderingContext2D, district: MapDistrictVm, input: MapDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const level = Math.min(3, Math.max(0, Math.round(district.level)));
  const count = BLOCK_COUNT_BY_LEVEL[level] ?? 0;
  if (count === 0) return;
  const d = screenDistricts(input.vm, input.camera, input.viewport).find((x) => x.district.id === district.id);
  if (d === undefined) return;
  const size = input.zoom === 'wide' ? 18 : 23;
  const pins = screenSpots(input.vm, input.zoom, input.camera, input.viewport).map((s) => ({ x: s.x, y: s.y }));
  const self = input.position === undefined ? [] : [project(input.camera, input.viewport, input.position)];
  const spots = blockSpots(d, { count, size, pins: [...pins, ...self] });
  const tallness = spots.map((_, i) => (level >= 3 ? [1.6, 1, 1.3][i % 3] ?? 1 : level === 2 && i % 3 === 0 ? 1.15 : 1));
  const order = spots.map((p, i) => ({ p, k: tallness[i] ?? 1 })).sort((a, b) => a.p.y - b.p.y);
  for (const { p, k } of order) drawMiniHouse(ctx, p, { size: size * (k > 1.2 ? 1.05 : 1), roof: district.color, lit: level >= 3 && k > 1.2, fade: district.fade, storeys: k });
}

/**
 * ブロックを置く場所を返す。地区の中で「ピンからいちばん遠く、上端（札の置き場）から離れた点」を街区の中心に選び、
 * そこから外へ格子状に詰めて1つのかたまりにする（ピン・ラベルに隠れにくくする）。
 * @param d 画面座標つきの地区
 * @param opts 棟数・大きさ・避けるピン
 * @returns 足もとの位置（最大 count 個）
 */
function blockSpots(d: ScreenDistrict, opts: { readonly count: number; readonly size: number; readonly pins: readonly Point2D[] }): Point2D[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const { count, size, pins } = opts;
  const box = polygonBounds(d.polygon);
  const topBand = box.y + 34;
  let best: Point2D = { x: d.anchor.x, y: Math.max(d.anchor.y, topBand + size) };
  let bestScore = -1;
  for (let y = topBand + size; y < box.y + box.height - 4; y += 8) {
    for (let x = box.x + size * 0.6; x < box.x + box.width - size * 0.6; x += 8) {
      if (!pointInPolygon({ x, y }, d.polygon)) continue;
      const score = Math.min(60, ...pins.map((p) => Math.hypot(p.x - x, p.y - y))) - Math.hypot(x - d.anchor.x, y - d.anchor.y) * 0.15;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  const stepX = size * 0.8;
  const stepY = size * 0.66;
  const cells: Point2D[] = [];
  for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) cells.push({ x: best.x + i * stepX + (j % 2 === 0 ? 0 : stepX / 2), y: best.y + j * stepY });
  cells.sort((a, b) => Math.hypot(a.x - best.x, (a.y - best.y) * 1.25) - Math.hypot(b.x - best.x, (b.y - best.y) * 1.25));
  const out: Point2D[] = [];
  for (const p of cells) {
    if (out.length >= count) break;
    const inside = [p, { x: p.x - size * 0.45, y: p.y }, { x: p.x + size * 0.45, y: p.y }, { x: p.x, y: p.y - size }].every((q) => pointInPolygon(q, d.polygon));
    if (!inside || p.y - size < topBand - 6 || pins.some((pin) => Math.hypot(pin.x - p.x, pin.y - (p.y - size * 0.4)) < size * 0.6 + 14)) continue;
    out.push(p);
  }
  return out;
}

/**
 * 発見範囲（DISCOVERY_RADIUS_M の破線円）を現在地中心に1つだけ描く。近接では円の上に距離を添える。
 * 訪問できる距離（VISIT_RADIUS_M）は円では示さず、下シートの「訪問できます」とスポット詳細のボタンで伝える。
 * @param ctx 2D コンテキスト
 * @param input 描画入力
 * @returns 距離の文字の矩形（描かなければ undefined。ラベルを重ねないため）
 * @sideEffect ctx に描画する
 */
function drawProximity(ctx: CanvasRenderingContext2D, input: MapDrawInput): Rect | undefined { // audit-ignore: fnlog-missing 毎フレーム描画
  if (input.position === undefined) return undefined;
  const center = project(input.camera, input.viewport, input.position);
  const discoverR = DISCOVERY_RADIUS_M / input.camera.metersPerPx;
  drawCircle(ctx, center, discoverR, { fill: toRgba(MAP_COLORS.accent, 0.06), stroke: toRgba(MAP_COLORS.accent, 0.9), lineWidth: 1.75, dash: [6, 5] });
  if (input.zoom !== 'near') return undefined;
  const text = `${DISCOVERY_RADIUS_M}m`;
  const box = measureLabel(ctx, text, { sizePx: 10, weight: 700, scale: input.textScale });
  const pill = { x: center.x - box.width / 2 - 4, y: center.y - discoverR - box.height / 2, width: box.width + 8, height: box.height };
  ctx.save();
  ctx.shadowColor = 'rgba(17, 24, 39, 0.12)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  drawRoundRect(ctx, pill, pill.height / 2, { fill: MAP_COLORS.white });
  ctx.restore();
  drawTextWithOutline(ctx, text, { x: center.x, y: pill.y + pill.height / 2 + 0.5 }, { sizePx: 10, scale: input.textScale, weight: 700, color: MAP_COLORS.accentStrong });
  return pill;
}

/**
 * 現在地の点と輪が占める矩形（ラベルがかぶらないよう避けるため）。
 * @param input 描画入力
 * @returns 矩形（現在地が無ければ空）
 */
function positionRects(input: MapDrawInput): Rect[] { // audit-ignore: fnlog-missing 毎フレーム描画
  if (input.position === undefined) return [];
  const at = project(input.camera, input.viewport, input.position);
  return [{ x: at.x - POSITION_HALO_PX, y: at.y - POSITION_HALO_PX, width: POSITION_HALO_PX * 2, height: POSITION_HALO_PX * 2 }];
}

/**
 * 足あと（歩いた軌跡）をブランド色の丸い点の列で描く（地図アプリの経路の点線風）。
 * @param ctx 2D コンテキスト
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawFootprints(ctx: CanvasRenderingContext2D, input: MapDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const trail = input.position === undefined ? input.footprints : [...input.footprints, input.position];
  if (trail.length < 2) return;
  ctx.save();
  ctx.beginPath();
  trail.forEach((p, i) => {
    const at = project(input.camera, input.viewport, p);
    if (i === 0) ctx.moveTo(at.x, at.y);
    else ctx.lineTo(at.x, at.y);
  });
  ctx.strokeStyle = MAP_COLORS.accent;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([0.1, 8]);
  ctx.stroke();
  ctx.restore();
}

/**
 * スポットのピン（丸いバッジ）の半径を返す（名所は大きい。近接では大きく描く。ほかのピンと重なるものは小さな点。描画は mapPins.ts）。
 * @param spot スポット
 * @param zoom ズーム段階
 * @returns 半径（CSS px）
 */
export function spotRadius(spot: MapSpotVm, zoom: MapZoom): number { // audit-ignore: fnlog-missing 毎フレーム描画
  return frameRadii.get(spot.id) ?? pinRadius(spot, zoom);
}

/**
 * スポットのピンが占める矩形（白い縁・右肩の回数バッジ・しずく型の先端を含む。ラベルがかぶらないよう避けるため）。
 * @param s 画面座標つきのスポット
 * @param zoom ズーム段階
 * @returns 矩形（CSS px）
 */
function spotMarkerRect(s: ScreenSpot, zoom: MapZoom): Rect { // audit-ignore: fnlog-missing 毎フレーム描画
  const r = spotRadius(s.spot, zoom) + 3;
  const tip = s.spot.kind === 'landmark' ? r * 0.75 : 0;
  return { x: s.x - r, y: s.y - r - 3, width: r * 2 + 4, height: r * 2 + 3 + tip };
}

/**
 * スポットのピン（丸いバッジ）を1つ描く。未発見＝破線の丸に「？」、発見済み＝白地に灰色の記号、訪問済み＝地区色＋右肩に回数。
 * 名前は drawSpotLabel で吹き出しにして置く。
 * @param ctx 2D コンテキスト
 * @param s 画面座標つきのスポット
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawSpotMarker(ctx: CanvasRenderingContext2D, s: ScreenSpot, input: MapDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (isOffscreen(s, input.viewport)) return;
  drawPin(ctx, s.spot, s, input.zoom, input.textScale, spotRadius(s.spot, input.zoom));
}

/**
 * Lv3 の地区の名所のピンに小さな三角旗を立てる（未発見の名所には描かない）。
 * @param ctx 2D コンテキスト
 * @param s 画面座標つきのスポット
 * @param district 所属地区（見つからなければ undefined）
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawFlagIfLv3(ctx: CanvasRenderingContext2D, s: ScreenSpot, district: MapDistrictVm | undefined, input: MapDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (district === undefined || district.level < 3 || s.spot.kind !== 'landmark' || s.spot.status === 'unknown') return;
  if (isOffscreen(s, input.viewport)) return;
  const r = spotRadius(s.spot, input.zoom);
  if (r <= MINI_PIN_RADIUS) return;
  const foot = { x: s.x - r * 0.55, y: s.y - r * 0.75 };
  const top = { x: foot.x - 3, y: foot.y - 15 };
  ctx.save();
  ctx.strokeStyle = MAP_COLORS.pole;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(foot.x, foot.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();
  ctx.restore();
  drawPolygon(ctx, [top, { x: top.x - 11, y: top.y + 2.5 }, { x: top.x - 1.2, y: top.y + 7 }], { fill: fadeTone(PALETTE.brand, district.fade), stroke: PALETTE.white, lineWidth: 1 });
}

/**
 * 地区・近接ズームで、地区の主（自分）の地区のいちばん通った名所のピンの上に王冠を載せる（「主」の印をピンに付ける）。
 * 広域では地区名の札の左に王冠を付ける（札がピンを隠すことがあるため）。
 * @param ctx 2D コンテキスト
 * @param spots 画面座標つきのスポット
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawLordCrowns(ctx: CanvasRenderingContext2D, spots: readonly ScreenSpot[], input: MapDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (input.zoom === 'wide') return;
  for (const district of input.vm.districts) {
    if (!district.isLordMe) continue;
    const top = spots
      .filter((s) => s.spot.districtId === district.id && s.spot.status === 'visited' && !isOffscreen(s, input.viewport) && spotRadius(s.spot, input.zoom) > MINI_PIN_RADIUS)
      .sort((a, b) => Number(b.spot.kind === 'landmark') - Number(a.spot.kind === 'landmark') || b.spot.visitCount - a.spot.visitCount)[0];
    if (top === undefined) continue;
    drawCrown(ctx, { x: top.x, y: top.y - spotRadius(top.spot, input.zoom) - 9 }, 16);
  }
}

/**
 * ラベルを優先順に置いて描く（出典 → 地区の札／左上のタグ → 商店街・川 → 名所 → 駅 → 店舗）。
 * 置けないラベルは省略する。表示範囲は下シートで隠れる部分を除き、画面の端から LABEL_EDGE_PX 内側に収める。
 * @param ctx 2D コンテキスト
 * @param frame 1フレーム分の画面上の情報
 * @sideEffect ctx に描画する
 */
function drawLabels(ctx: CanvasRenderingContext2D, frame: LabelFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { input, scene } = frame;
  const layout = createLabelLayout({ x: LABEL_EDGE_PX, y: LABEL_EDGE_PX, width: scene.width - LABEL_EDGE_PX * 2, height: scene.usableHeight - LABEL_EDGE_PX * 2 });
  drawAttribution(ctx, scene, layout);
  for (const r of frame.reserved) layout.reserve(r);
  if (input.zoom === 'wide') for (const d of frame.districts) drawDistrictLabel(ctx, d, { scale: input.textScale, unknown: unknownCountOf(input.vm, d.district.id), width: scene.width, avoid: frame.markers, districts: frame.districts }, layout);
  else drawFocusTags(ctx, input, layout);
  drawLineLabels(ctx, scene, layout, frame.markers);
  const ordered = [...frame.spots].sort((a, b) => labelRank(a.spot) - labelRank(b.spot));
  const lc = { scene, layout, avoid: frame.markers };
  for (const s of ordered) if (s.spot.kind === 'landmark') drawSpotLabel(ctx, s, input, lc);
  drawStationLabels(ctx, lc);
  for (const s of ordered) if (s.spot.kind === 'shop') drawSpotLabel(ctx, s, input, lc);
}

/**
 * 広域で地区の札にまとめる未発見の名所の数を返す（広域は店舗を出さないので名所だけ数える）。
 * @param vm 描画データ
 * @param districtId 地区ID
 * @returns 未発見の名所の数
 */
function unknownCountOf(vm: MapViewModel, districtId: string): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な集計
  return vm.spots.filter((s) => s.districtId === districtId && s.kind === 'landmark' && s.status === 'unknown').length;
}

/**
 * スポット名を置く優先度（小さいほど先。訪問済み → 発見済み → 未発見）。
 * @param spot スポット
 * @returns 優先度
 */
function labelRank(spot: MapSpotVm): number { // audit-ignore: fnlog-missing 毎フレーム描画
  return spot.status === 'visited' ? 0 : spot.status === 'discovered' ? 1 : 2;
}

/**
 * スポット名を、ピンの下（だめなら右→左→上）の空いている場所に白フチの文字で置く（地区の札とは別の1種類に統一）。
 * ラベルどうし・ピン・駅との間は最低 LABEL_GAP_PX あける。訪問回数はピン右肩のバッジで示すので名前だけ。
 * 広域では訪問済みの名所だけ名前を出す（拡大すると全部出る）。どこにも置けなければ省略する。
 * @param ctx 2D コンテキスト
 * @param s 画面座標つきのスポット（表示位置）
 * @param input 描画入力
 * @param lc 背景の描画入力・ラベル配置・避ける矩形
 * @sideEffect ctx に描画し、layout に登録する
 */
function drawSpotLabel(ctx: CanvasRenderingContext2D, s: ScreenSpot, input: MapDrawInput, lc: { readonly layout: LabelLayout; readonly avoid: readonly Rect[] }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const text = s.spot.name ?? s.spot.label;
  if (text === undefined || isOffscreen(s, input.viewport)) return;
  const visited = s.spot.status === 'visited';
  if (input.zoom === 'wide' && !visited) return;
  const box = measureLabel(ctx, text, { sizePx: SPOT_LABEL_PX, weight: visited ? 700 : 500, scale: input.textScale });
  const r = spotRadius(s.spot, input.zoom);
  const tipBelow = s.spot.kind === 'landmark' ? r * 0.6 : 0;
  const g = LABEL_GAP_PX / 2;
  const rects: Rect[] = [
    { x: s.x - box.width / 2, y: s.y + r + tipBelow + 3, width: box.width, height: box.height },
    { x: s.x + r + 6, y: s.y - box.height / 2, width: box.width, height: box.height },
    { x: s.x - r - 6 - box.width, y: s.y - box.height / 2, width: box.width, height: box.height },
    { x: s.x - box.width / 2, y: s.y - r - 6 - box.height, width: box.width, height: box.height },
  ].map((q) => ({ x: q.x - g, y: q.y - g, width: q.width + g * 2, height: q.height + g * 2 }));
  const own = spotMarkerRect(s, input.zoom);
  const avoid = lc.avoid.filter((q) => !(Math.abs(q.x - own.x) < 0.5 && Math.abs(q.y - own.y) < 0.5));
  const placed = lc.layout.place(rects, avoid);
  if (placed === undefined) return;
  const color = visited ? PALETTE.ink : PALETTE.subInk;
  drawTextWithOutline(ctx, text, { x: placed.x + placed.width / 2, y: placed.y + placed.height / 2 }, { sizePx: SPOT_LABEL_PX, scale: input.textScale, weight: visited ? 700 : 500, color, outlineColor: PALETTE.white, outlineWidth: 3.5 });
}

/**
 * 広域の地区名の札（白いピルに「南森町」と育成リング。地区の主なら王冠、未発見があれば「?n」、色あせ中は ◌ と灰色の破線の札）と、
 * 色あせ間近ならその下に「あとn日」のタグを描く。札は必ず自分の地区の上に置く（中心が自分の地区の内側で、角がほかの地区に入らない場所）。
 * ピン・ほかの札との間は LABEL_GAP_PX 以上あける。置き場が無いときは地区の中心に置く（スポット名のラベルの方を諦める）。
 * @param ctx 2D コンテキスト
 * @param d 画面座標つきの地区
 * @param opts 文字拡大の倍率・未発見の数・描画領域の幅・避ける矩形・全地区
 * @param layout ラベル配置（札とタグの場所を予約する）
 * @sideEffect ctx に描画し、layout に登録する
 */
function drawDistrictLabel(ctx: CanvasRenderingContext2D, d: ScreenDistrict, opts: { readonly scale: number; readonly unknown: number; readonly width: number; readonly avoid: readonly Rect[]; readonly districts: readonly ScreenDistrict[] }, layout: LabelLayout): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { scale } = opts;
  const district = d.district;
  const badge: DistrictBadgeInput = {
    name: district.shortName,
    level: district.level,
    tone: fadeTone(district.color, district.fade),
    faded: district.fade.icon !== '',
    lordMe: district.isLordMe,
    unexplored: district.level <= 0,
    unknownCount: opts.unknown,
  };
  const m = measureDistrictBadge(ctx, badge, scale);
  const tagList = tagsOf(district).filter((tag) => tag.kind === 'soon');
  const extraH = tagList.length > 0 ? 22 * scale : 0;
  const at = badgeSlot(d, { w: m.width, h: m.height + extraH, width: opts.width, avoid: opts.avoid, districts: opts.districts }, layout) ?? { x: d.anchor.x, y: d.anchor.y - extraH / 2 };
  const badgeAt = { x: at.x, y: at.y - extraH / 2 };
  layout.reserve(drawDistrictBadge(ctx, badgeAt, badge, scale));
  const tags = drawTagChips(ctx, tagList, { x: badgeAt.x, y: badgeAt.y + m.height / 2 + 12 * scale }, scale, 'center');
  if (tags !== undefined) layout.reserve(tags);
}

/**
 * 地区の札（タグ込み）を置ける中心を、地区の上の方から順に探す（中心は自分の地区の内側、四隅はほかの地区に入らない、
 * 画面内、ほかの札・ピンと LABEL_GAP_PX 以上離れる）。
 * @param d 画面座標つきの地区
 * @param o 札の幅・高さ・描画領域の幅・避ける矩形・全地区
 * @param layout ラベル配置
 * @returns 中心（見つからなければ undefined）
 */
function badgeSlot(d: ScreenDistrict, o: { readonly w: number; readonly h: number; readonly width: number; readonly avoid: readonly Rect[]; readonly districts: readonly ScreenDistrict[] }, layout: LabelLayout): Point2D | undefined { // audit-ignore: fnlog-missing 毎フレーム描画
  const box = polygonBounds(d.polygon);
  const others = o.districts.filter((x) => x.district.id !== d.district.id);
  const g = BADGE_GAP_PX;
  for (let y = box.y + o.h / 2 + 2; y < box.y + box.height - o.h / 2; y += 6) {
    const xs = [d.anchor.x, d.anchor.x - 16, d.anchor.x + 16, d.anchor.x - 32, d.anchor.x + 32];
    for (const rawX of xs) {
      const x = Math.min(Math.max(rawX, o.w / 2 + LABEL_EDGE_PX), o.width - o.w / 2 - LABEL_EDGE_PX);
      const rect = { x: x - o.w / 2, y: y - o.h / 2, width: o.w, height: o.h };
      if (!pointInPolygon({ x, y }, d.polygon)) continue;
      const corners = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }];
      if (corners.some((c) => others.some((od) => pointInPolygon(c, od.polygon)))) continue;
      if (!layout.isFree({ x: rect.x - g, y: rect.y - g, width: rect.width + g * 2, height: rect.height + g * 2 }, o.avoid)) continue;
      return { x, y };
    }
  }
  return undefined;
}

/**
 * 地区・近接ズームで、注目中の地区のタグ（主・色あせ）を地図の左上に描く。
 * @param ctx 2D コンテキスト
 * @param input 描画入力
 * @param layout ラベル配置（タグの場所を予約する）
 * @sideEffect ctx に描画し、layout に登録する
 */
function drawFocusTags(ctx: CanvasRenderingContext2D, input: MapDrawInput, layout: LabelLayout): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const district = input.vm.districts.find((d) => d.id === input.focusDistrictId);
  if (district === undefined) return;
  const rect = drawTagChips(ctx, tagsOf(district), { x: 12, y: 14 + 9 * input.textScale }, input.textScale, 'left');
  if (rect !== undefined) layout.reserve(rect);
}

/**
 * 地区に付けるタグを返す。
 * @param district 地区
 * @returns タグ（主・色あせ・そろそろ）
 */
function tagsOf(district: MapDistrictVm): MapTag[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const tags: MapTag[] = [];
  if (district.isLordMe) tags.push({ text: '♛ 主', kind: 'lord' });
  if (district.fadeTag !== undefined) {
    const fading = district.fadeKind === 'fading';
    tags.push({ text: fading ? `${FADE_ICON} ${district.fadeTag}` : district.fadeTag, kind: fading ? 'fade' : 'soon' });
  }
  return tags;
}

/**
 * 現在地（朱の点・白い縁・やわらかい光の輪）を描く。
 * @param ctx 2D コンテキスト
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawPosition(ctx: CanvasRenderingContext2D, input: MapDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (input.position === undefined) return;
  drawPositionMarker(ctx, project(input.camera, input.viewport, input.position));
}

/**
 * 発見リング（600ms で広がって消える輪）を描く。ブランド色の淡い円が広がり、その縁に細い輪が2重に追いかける。
 * @param ctx 2D コンテキスト
 * @param spots 画面座標つきのスポット（このズームで描いているもの）
 * @param rings 発見リング
 * @param t 現在時刻
 * @sideEffect ctx に描画する
 */
function drawRings(ctx: CanvasRenderingContext2D, spots: readonly ScreenSpot[], rings: readonly DiscoveryRing[], t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (const ring of rings) {
    const p = (t - ring.startedAt) / DISCOVERY_RING_MS;
    if (p < 0 || p >= 1) continue;
    const s = spots.find((x) => x.spot.id === ring.spotId);
    if (s === undefined) continue;
    const eased = 1 - (1 - p) * (1 - p);
    const r = 10 + 26 * eased;
    drawCircle(ctx, s, r, { fill: toRgba(MAP_COLORS.accent, 0.14 * (1 - p)), stroke: MAP_COLORS.accent, lineWidth: 1 + 2 * (1 - p), alpha: 1 - p });
    drawCircle(ctx, s, Math.max(1, r - 8), { stroke: MAP_COLORS.white, lineWidth: 1.5, alpha: 0.9 * (1 - p) });
  }
}

/**
 * 地区パルス（1.2 秒、輪郭が太く光って消える）を描く。
 * @param ctx 2D コンテキスト
 * @param districts 画面座標つきの地区
 * @param pulse 地区パルス
 * @param t 現在時刻
 * @sideEffect ctx に描画する
 */
function drawPulse(ctx: CanvasRenderingContext2D, districts: readonly ScreenDistrict[], pulse: DistrictPulse, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const p = clamp01((t - pulse.startedAt) / DISTRICT_PULSE_MS);
  if (p >= 1) return;
  const d = districts.find((x) => x.district.id === pulse.districtId);
  if (d === undefined) return;
  const wave = Math.sin(p * Math.PI * 2) * 0.5 + 0.5;
  drawPolygon(ctx, d.polygon, { fill: toRgba(MAP_COLORS.accent, 0.22 * (1 - p)), stroke: MAP_COLORS.accent, lineWidth: 2 + 6 * wave, alpha: 1 - p * 0.8 });
}

/**
 * 点が画面外（余白込み）か判定する。
 * @param at 画面上の点
 * @param vp 描画領域
 * @returns 画面外なら true
 */
function isOffscreen(at: Point2D, vp: Viewport): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
  return at.x < -OFFSCREEN_MARGIN || at.y < -OFFSCREEN_MARGIN || at.x > vp.width + OFFSCREEN_MARGIN || at.y > vp.height + OFFSCREEN_MARGIN;
}
