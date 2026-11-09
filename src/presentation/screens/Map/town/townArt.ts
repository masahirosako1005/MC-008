/**
 * @file 街のタイル描画（presentation/screens/Map/town 層）
 * townGenerator が作った TownGrid を、1セル=CELL_PX ドットのドット絵としてチャンク単位の canvas に描く（拡大表示用）。
 * 広域用には 1セル=OVERVIEW_PX_PER_CELL ドットの全体図（RGBA の画素列）を作る。
 * 地面は見下ろし、建物だけ 3/4 視点（上を屋根、下を正面の壁）で敷地の中に描く。成長段階・陣地・色あせで小物と色を変える。
 * 乱数は使わず、セルの variant と建物の seed で決定論的にばらつかせる。描画中の例外は外へ出さない（ログに残す）。
 * 描画はセルごとに何度も呼ぶ小さな関数の集まりなので、内側の関数は関数ログを出さない（入口の paintChunk／paintOverview で記録する）。
 */
import { createLogger } from '@/Common/logging/logger';
import {
  CELL_PX,
  CHUNK_CELLS,
  Cell,
  OVERLAY_STATION,
  OVERLAY_VIADUCT,
  OVERVIEW_PX_PER_CELL,
  TERRITORY_MINE,
  TERRITORY_MINE_COLOR,
  TERRITORY_RIVAL,
  TERRITORY_RIVAL_COLOR,
  cellIndex,
  isStreet,
} from '@/presentation/screens/Map/town/townTypes';
import type { TownBuilding, TownGrid, TownPaintState, TownTheme } from '@/presentation/screens/Map/town/townTypes';

const logger = createLogger('presentation/screens/Map/town/townArt');

/** 屋根・ひさしの色表（TownBuilding.roof の 0..7）。0=赤 1=橙 2=青緑 3=青 4=紫 5=こげ茶 6=瓦の青灰 7=明るい灰 */
export const ROOF_COLORS: readonly string[] = ['#e2574c', '#f08c3a', '#2fa39a', '#3e6fb5', '#8c6bc8', '#9a6b4f', '#5d6b85', '#c9ccd6'];

/** 地面・道・水などの基本色 */
const P = {
  grass: '#9ed36a',
  grassAlt: '#93ca61',
  grassTuft: '#74b552',
  moss: '#8fc86b',
  mossAlt: '#84bd61',
  park: '#a8dc78',
  parkAlt: '#9dd26d',
  road: '#6e7385',
  roadAlt: '#666b7d',
  avenue: '#646a7c',
  sidewalk: '#d8d1c1',
  sidewalkJoint: '#cbc3b1',
  curb: '#f2eee4',
  lineWhite: '#f4f1e8',
  lineYellow: '#f2c94c',
  arcade: '#ecd0a8',
  arcadeAlt: '#e2c299',
  arcadeEdge: '#c49e72',
  alley: '#d4c7ad',
  alleyStone: '#c2b497',
  alleyEdge: '#a8997d',
  path: '#e8d6a8',
  pathPebble: '#d2bc8c',
  pathEdge: '#d9c48f',
  plaza: '#e0d9ca',
  plazaLine: '#cac1ae',
  bridge: '#c99a62',
  bridgePlank: '#ad7f4b',
  bridgeRail: '#7a5233',
  bridgePost: '#e8c999',
  waterShallow: '#5cb6e8',
  water: '#4aa8e0',
  waterDeep: '#3d95d2',
  waterHi: '#a6dcf6',
  foam: '#e3f5fc',
  bank: '#c4b89f',
  bankLine: '#ab9f86',
  bankTop: '#ddd3bc',
  bankWet: '#7f7562',
  pond: '#66bde9',
  pondRim: '#e7dfc6',
  pondInner: '#4ba3da',
  lily: '#5aa55a',
  lot: '#efe8da',
  lotEdge: '#d9cfba',
  parking: '#8f94a2',
  parkingLine: '#eef0f4',
  sand: '#ecdcae',
  sandEdge: '#d8c48e',
  soil: '#9b7653',
  hedge: '#5a9e46',
  trunk: '#8a5a3c',
  shadow: 'rgba(28,40,52,0.22)',
  ink: '#2b2a3a',
  window: '#86c9f2',
  windowLit: '#ffe08a',
  wood: '#8a5a3c',
  woodDark: '#6b4a33',
  flowerBox: '#ff7aa2',
  concrete: '#a9adb8',
  concreteLight: '#cdd0d8',
  concreteEdge: '#babec8',
  concreteDark: '#858a97',
  ballast: '#9d968a',
  tie: '#6f5a47',
  rail: '#e1e4ea',
  viaductShadow: 'rgba(20,25,40,0.30)',
  platform: '#e4dfd2',
  tactile: '#f2c94c',
  canopy: '#2fa39a',
  lamp: '#4a4f5e',
  lampGlow: 'rgba(255,224,138,0.55)',
  lantern: '#e2574c',
  lanternBand: '#ffd37a',
  garlandString: '#6b5547',
} as const;

/** 花の色 */
const FLOWER_COLORS: readonly string[] = ['#ff6b8a', '#ffd23f', '#ffffff', '#c77dff', '#ff9f43', '#ff4d6d', '#7fd1ff'];
/** ガーランドの旗の色 */
const GARLAND_COLORS: readonly string[] = ['#ff6b6b', '#ffd93d', '#5ccf7a', '#4d96ff', '#ff9f1c', '#c77dff'];
/** 車の色 */
const CAR_COLORS: readonly string[] = ['#e2574c', '#3e6fb5', '#f4f4f4', '#f2c94c', '#2fa39a', '#34406b', '#8c6bc8'];
/** 壁の色 */
const WALL_COLORS: readonly string[] = ['#f6edd9', '#fbfaf6', '#efe2c8', '#e3e7ee', '#f6e3d8', '#e5efdf'];
/** 屋台・店先の品物の色 */
const GOODS_COLORS: readonly string[] = ['#e2574c', '#f2c94c', '#5ccf7a', '#ff9f43', '#c77dff', '#f4f4f4', '#7fd1ff'];
/** 木の色（樹冠・明るい所・暗い所） */
const TREE_TONES: readonly (readonly [string, string, string])[] = [
  ['#4fa35a', '#7ccb6b', '#2f7a43'],
  ['#45995a', '#6cc06a', '#2a6e3f'],
  ['#5aae5f', '#8bd47a', '#357f45'],
];
/** 桜の色（樹冠・明るい所・暗い所） */
const SAKURA_TONE: readonly [string, string, string] = ['#f7b6cc', '#ffe1ea', '#e58fae'];
/** 松（門前町）の色 */
const PINE_TONE: readonly [string, string, string] = ['#3f7f4a', '#5f9e5c', '#2c5f38'];
/** 瓦屋根の色（kawaraHouse は roof に関係なくこの色） */
const KAWARA_TONES: readonly { readonly base: string; readonly line: string; readonly ridge: string; readonly eave: string }[] = [
  { base: '#66738e', line: '#58647e', ridge: '#93a0b9', eave: '#3a4258' },
  { base: '#70737d', line: '#61646d', ridge: '#a0a3ad', eave: '#41434b' },
  { base: '#5b6b80', line: '#4d5c70', ridge: '#8798ad', eave: '#333e4d' },
  { base: '#7b6c61', line: '#6b5d53', ridge: '#a69585', eave: '#473b33' },
];
/** 全体図での瓦屋根の色（少し明るくして、地区全体が重く見えないようにする） */
const KAWARA_OVERVIEW = '#7f8ba3';
/** 全体図で建物の色を寄せる色（地区の中＝温かい白、地区の外＝薄い灰） */
const OVERVIEW_SOFT_IN: Rgb = [239, 233, 223];
const OVERVIEW_SOFT_OUT: Rgb = [214, 218, 226];
/** 平らな屋上の色 */
const FLAT_ROOF = { base: '#ced3dc', light: '#e8ebf0', dark: '#a9b0bd', gear: '#9aa3b2' } as const;

/** 色あせで重ねる色 */
const FADE_RGB: Rgb = [238, 238, 238];
/** 色あせを重ねる強さ（fade=1 のとき） */
const FADE_STRENGTH = 0.55;
/** 自分の陣地を重ねる強さ */
const MINE_TINT_ALPHA = 0.22;
/** ライバルの陣地を重ねる強さ */
const RIVAL_TINT_ALPHA = 0.18;

/** 道の上の陣地の重ね色（道は薄く。濁って見えないように） */
const MINE_STREET_TINT = rgba(TERRITORY_MINE_COLOR, 0.1);
/** 道の上のライバルの陣地の重ね色 */
const RIVAL_STREET_TINT = rgba(TERRITORY_RIVAL_COLOR, 0.08);
/** 陣地の斜線模様の元画像（色ごとに1回だけ作る） */
const hatchSources = new Map<number, CanvasImageSource | null>();

/** RGB（0..255） */
type Rgb = readonly [number, number, number];

/** 塗りの状態（fillStyle の付け替えを減らす） */
interface Pen {
  readonly ctx: CanvasRenderingContext2D;
  fill: string | CanvasPattern;
}

/** 1チャンクを描くときの共通の材料 */
interface Paint {
  readonly pen: Pen;
  readonly grid: TownGrid;
  readonly state: TownPaintState;
  /** チャンク左上のセル */
  readonly c0: number;
  readonly r0: number;
  /** 陣地の重ね色（自分・ライバル） */
  readonly mineTint: string | CanvasPattern;
  readonly rivalTint: string | CanvasPattern;
}

/** 描くセルの情報（x, y はチャンク内のドット位置） */
interface CellInfo {
  readonly col: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly kind: number;
  readonly v: number;
  readonly district: number;
  readonly theme: TownTheme;
  readonly level: number;
  readonly terr: number;
  readonly overlay: number;
}

/** 建物を描くときの材料 */
interface BuildingPaint {
  readonly pen: Pen;
  readonly b: TownBuilding;
  /** 敷地（チャンク内のドット） */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 屋根の色 */
  readonly roof: string;
  /** 自分の陣地の中（窓が灯り、花が増える） */
  readonly lit: boolean;
  readonly theme: TownTheme;
}

/** 道の向き（v=南北、h=東西、x=交差点） */
type Axis = 'v' | 'h' | 'x';
/** 歩道のある側 */
type Side = 'l' | 'r' | 't' | 'b';
/** 歩道に置く小物 */
type Furniture = 'lamp' | 'bench' | 'planter' | 'vending' | 'tree' | 'sakura' | 'bike' | 'pot' | 'toro' | 'crate';

// ---------------------------------------------------------------------------
// 色の計算
// ---------------------------------------------------------------------------

/**
 * '#rrggbb' を RGB にする。
 * @param hex 色
 * @returns RGB
 */
function hexToRgb(hex: string): Rgb { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な算術ヘルパー
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

/**
 * RGB を '#rrggbb' にする。
 * @param rgb RGB
 * @returns 色
 */
function rgbToHex(rgb: Rgb): string { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な算術ヘルパー
  const c = clampByte;
  return `#${((1 << 24) | (c(rgb[0]) << 16) | (c(rgb[1]) << 8) | c(rgb[2])).toString(16).slice(1)}`;
}

/**
 * 0..255 の整数に丸める。
 * @param v 値
 * @returns 0..255
 */
function clampByte(v: number): number { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な算術ヘルパー
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * 2色を t の割合で混ぜる。
 * @param a 元の色
 * @param b 混ぜる色
 * @param t 0..1（1 で b）
 * @returns 混ぜた色
 */
function mixRgb(a: Rgb, b: Rgb, t: number): Rgb { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な算術ヘルパー
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** shade の結果のキャッシュ */
const shadeCache = new Map<string, string>();
/** 暗くするときに混ぜる色（黒ではなく紺墨にして、影を澄んだ色にする） */
const SHADE_DARK: Rgb = [38, 35, 56];
/** 明るくするときに混ぜる色 */
const SHADE_LIGHT: Rgb = [255, 255, 255];

/**
 * 色を明るく（amount>0）・暗く（amount<0）した色を返す（キャッシュする）。
 * @param hex 元の色
 * @param amount -1..1
 * @returns 色
 */
function shade(hex: string, amount: number): string { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な算術ヘルパー（キャッシュつき）
  const key = `${hex}|${amount}`;
  const hit = shadeCache.get(key);
  if (hit !== undefined) return hit;
  const out = rgbToHex(mixRgb(hexToRgb(hex), amount < 0 ? SHADE_DARK : SHADE_LIGHT, Math.min(1, Math.abs(amount))));
  shadeCache.set(key, out);
  return out;
}

/**
 * '#rrggbb' に透明度をつけた 'rgba()' を返す。
 * @param hex 色
 * @param alpha 透明度 0..1
 * @returns CSS の色
 */
function rgba(hex: string, alpha: number): string { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な算術ヘルパー
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 整数を混ぜて 0..2^32-1 のばらつきを作る（乱数の代わり）。
 * @param a 入力
 * @returns ばらつき
 */
function mixHash(a: number): number { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な算術ヘルパー
  let h = a | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * 範囲外のセルのばらつき（0..255）を作る。
 * @param col 列
 * @param row 行
 * @returns 0..255
 */
function hashCell(col: number, row: number): number { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な算術ヘルパー
  return mixHash(col * 374_761_393 + row * 668_265_263) & 255;
}

/**
 * 配列から番号で選ぶ（範囲外は先頭）。
 * @param list 候補
 * @param n 番号（負でもよい）
 * @returns 選んだ値
 */
function pick<T>(list: readonly T[], n: number): T { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な選択ヘルパー
  const i = ((Math.floor(n) % list.length) + list.length) % list.length;
  return list[i] ?? (list[0] as T);
}

// ---------------------------------------------------------------------------
// 塗りとセルの参照
// ---------------------------------------------------------------------------

/**
 * 四角を塗る（大きさ0以下は何もしない。fillStyle は変わったときだけ付け替える）。
 * @param pen 塗りの状態
 * @param x 左
 * @param y 上
 * @param w 幅
 * @param h 高さ
 * @param color 色
 * @sideEffect canvas に描く
 */
function rect(pen: Pen, x: number, y: number, w: number, h: number, color: string | CanvasPattern): void { // audit-ignore: fnlog-missing 描画の最小単位（1チャンクで数千回呼ぶ）
  if (w <= 0 || h <= 0) return;
  if (pen.fill !== color) {
    pen.ctx.fillStyle = color;
    pen.fill = color;
  }
  pen.ctx.fillRect(x, y, w, h);
}

/**
 * セルの種類を返す（範囲外は芝）。
 * @param grid 街
 * @param col 列
 * @param row 行
 * @returns セルの種類
 */
function kindOf(grid: TownGrid, col: number, row: number): number { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な参照ヘルパー
  const i = cellIndex(grid, col, row);
  return i < 0 ? Cell.GRASS : (grid.kinds[i] ?? Cell.GRASS);
}

/**
 * セルの overlay を返す（範囲外は0）。
 * @param grid 街
 * @param col 列
 * @param row 行
 * @returns overlay のビット
 */
function overlayOf(grid: TownGrid, col: number, row: number): number { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な参照ヘルパー
  const i = cellIndex(grid, col, row);
  return i < 0 ? 0 : (grid.overlay[i] ?? 0);
}

/**
 * 描くセルの情報を集める。
 * @param p 描画の材料
 * @param col 列
 * @param row 行
 * @returns セルの情報
 */
function readCell(p: Paint, col: number, row: number): CellInfo { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な参照ヘルパー
  const i = cellIndex(p.grid, col, row);
  const district = i < 0 ? 0 : (p.grid.district[i] ?? 0);
  return {
    col,
    row,
    x: (col - p.c0) * CELL_PX,
    y: (row - p.r0) * CELL_PX,
    kind: i < 0 ? Cell.GRASS : (p.grid.kinds[i] ?? Cell.GRASS),
    v: i < 0 ? hashCell(col, row) : (p.grid.variant[i] ?? 0),
    district,
    theme: p.grid.themes[district] ?? 'city',
    level: p.state.levels[district] ?? 0,
    terr: i < 0 ? 0 : (p.state.territory[i] ?? 0),
    overlay: i < 0 ? 0 : (p.grid.overlay[i] ?? 0),
  };
}

/**
 * 指定の向きに、条件を満たすセルが何個続くかを数える（start は数えない）。
 * @param grid 街
 * @param col 起点の列
 * @param row 起点の行
 * @param dc 列の向き
 * @param dr 行の向き
 * @param test 条件
 * @param max 数える上限
 * @returns 続く数
 */
function runOf(grid: TownGrid, col: number, row: number, dc: number, dr: number, test: (kind: number) => boolean, max: number): number { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な参照ヘルパー
  let n = 0;
  for (let i = 1; i <= max; i++) {
    if (!test(kindOf(grid, col + dc * i, row + dr * i))) break;
    n++;
  }
  return n;
}

/**
 * 車道（道路・大通り）か。
 * @param kind セルの種類
 * @returns 車道なら true
 */
function isRoadLike(kind: number): boolean { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な判定ヘルパー
  return kind === Cell.ROAD || kind === Cell.AVENUE;
}

/**
 * 商店街か。
 * @param kind セルの種類
 * @returns 商店街なら true
 */
function isArcade(kind: number): boolean { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な判定ヘルパー
  return kind === Cell.ARCADE;
}

/**
 * 道の向きを、同じ種類の道が縦・横にどれだけ続くかで決める（両方に長く続けば交差点）。
 * @param grid 街
 * @param col 列
 * @param row 行
 * @param test 同じ道とみなす条件
 * @returns 向き
 */
function axisOf(grid: TownGrid, col: number, row: number, test: (kind: number) => boolean): Axis { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な判定ヘルパー
  const across = runOf(grid, col, row, -1, 0, test, 4) + runOf(grid, col, row, 1, 0, test, 4) + 1;
  const along = runOf(grid, col, row, 0, -1, test, 4) + runOf(grid, col, row, 0, 1, test, 4) + 1;
  if (across >= 5 && along >= 5) return 'x';
  return along > across ? 'v' : 'h';
}

/**
 * 道路の隣に歩道を作る相手か（建物・芝など車道でない所）。
 * @param kind 隣のセルの種類
 * @returns 歩道を作るなら true
 */
function needsSidewalk(kind: number): boolean { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な判定ヘルパー
  return !isStreet(kind) && kind !== Cell.PLAZA && kind !== Cell.PARKING;
}

/**
 * 歩道のある側を返す（左・右・上・下の順で最初のもの）。
 * @param grid 街
 * @param ci セル
 * @returns 側（無ければ undefined）
 */
function sidewalkSide(grid: TownGrid, ci: CellInfo): Side | undefined { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な判定ヘルパー
  if (needsSidewalk(kindOf(grid, ci.col - 1, ci.row))) return 'l';
  if (needsSidewalk(kindOf(grid, ci.col + 1, ci.row))) return 'r';
  if (needsSidewalk(kindOf(grid, ci.col, ci.row - 1))) return 't';
  if (needsSidewalk(kindOf(grid, ci.col, ci.row + 1))) return 'b';
  return undefined;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * チャンク (chunkCol, chunkRow) を ctx（CHUNK_PX×CHUNK_PX の canvas、変換は単位行列）に 1セル=CELL_PX ドットで描く。
 * 範囲外のセルは地区の外の芝として描く。描画中の例外は外へ出さず、error ログに残す。
 * @param ctx 描き先（チャンク1枚分の canvas）
 * @param grid 街
 * @param chunkCol チャンクの列
 * @param chunkRow チャンクの行
 * @param state 成長・色あせ・陣地
 * @sideEffect ctx に描く
 */
export function paintChunk(ctx: CanvasRenderingContext2D, grid: TownGrid, chunkCol: number, chunkRow: number, state: TownPaintState): void {
  const log = logger.fn('paintChunk', { chunkCol, chunkRow });
  const p: Paint = {
    pen: { ctx, fill: '' },
    grid,
    state,
    c0: chunkCol * CHUNK_CELLS,
    r0: chunkRow * CHUNK_CELLS,
    mineTint: territoryFill(ctx, TERRITORY_MINE),
    rivalTint: territoryFill(ctx, TERRITORY_RIVAL),
  };
  try {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const rows = collectRows(p);
    paintGroundLayer(p, rows);
    paintMarkingLayer(p, rows);
    paintBuildingLayer(p);
    paintPropLayer(p, rows);
    paintViaductLayer(p, rows);
    paintFadeLayer(p, rows);
  } catch (error) {
    log.error('街のチャンクを描けませんでした', { error });
  }
  log.exit(undefined);
}

/**
 * 全体図（広域用）を 1セル=OVERVIEW_PX_PER_CELL ドットの RGBA 画素列に書く（画素を直接書くので速い）。
 * 幅＝grid.cols×OVERVIEW_PX_PER_CELL、高さ＝grid.rows×OVERVIEW_PX_PER_CELL。建物は屋根の色、手前の1列は壁として少し暗くする。
 * @param grid 街
 * @param state 成長・色あせ・陣地
 * @returns RGBA の画素列（不透明）
 */
export function paintOverview(grid: TownGrid, state: TownPaintState): Uint8ClampedArray {
  const log = logger.fn('paintOverview', { cols: grid.cols, rows: grid.rows });
  const s = OVERVIEW_PX_PER_CELL;
  const width = grid.cols * s;
  const out = new Uint8ClampedArray(width * grid.rows * s * 4);
  try {
    const roofRgb = ROOF_COLORS.map(hexToRgb);
    const mineRgb = hexToRgb(TERRITORY_MINE_COLOR);
    const rivalRgb = hexToRgb(TERRITORY_RIVAL_COLOR);
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const i = row * grid.cols + col;
        let c = overviewBase(grid, i, roofRgb);
        const kind = grid.kinds[i] ?? Cell.GRASS;
        const terr = state.territory[i] ?? 0;
        if (kind !== Cell.WATER && kind !== Cell.POND) {
          if (terr === TERRITORY_MINE) c = mixRgb(c, mineRgb, MINE_TINT_ALPHA);
          else if (terr === TERRITORY_RIVAL) c = mixRgb(c, rivalRgb, RIVAL_TINT_ALPHA);
        }
        const fade = state.fades[grid.district[i] ?? 0] ?? 0;
        if (fade > 0) c = mixRgb(c, FADE_RGB, Math.min(1, fade) * FADE_STRENGTH);
        writeOverviewCell(out, width, col, row, c, isBuildingFront(grid, i, row));
      }
    }
  } catch (error) {
    log.error('全体図を描けませんでした', { error });
  }
  return log.exit(out);
}

/**
 * 陣地の塗り（斜線の模様。作れない環境では一様な重ね色）を返す。
 * 模様はチャンクの原点に揃うので、チャンクの境目で途切れない（CHUNK_PX は 8 の倍数）。
 * @param ctx 描き先
 * @param terr TERRITORY_MINE / TERRITORY_RIVAL
 * @returns 塗り
 */
function territoryFill(ctx: CanvasRenderingContext2D, terr: number): string | CanvasPattern { // audit-ignore: fnlog-missing チャンクごとに呼ぶ描画ヘルパー（入口で記録済み）
  const mine = terr === TERRITORY_MINE;
  const flat = mine ? rgba(TERRITORY_MINE_COLOR, MINE_TINT_ALPHA) : rgba(TERRITORY_RIVAL_COLOR, RIVAL_TINT_ALPHA);
  const src = hatchSource(terr);
  if (src === null || typeof ctx.createPattern !== 'function') return flat;
  return ctx.createPattern(src, 'repeat') ?? flat;
}

/**
 * 陣地の斜線模様の元画像（8×8 ドット）を作る（キャッシュする）。canvas を作れない環境では null。
 * @param terr TERRITORY_MINE / TERRITORY_RIVAL
 * @returns 元画像（作れなければ null）
 */
function hatchSource(terr: number): CanvasImageSource | null { // audit-ignore: fnlog-missing チャンクごとに呼ぶ描画ヘルパー（キャッシュつき）
  const hit = hatchSources.get(terr);
  if (hit !== undefined) return hit;
  let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(CELL_PX, CELL_PX);
  else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = CELL_PX;
    canvas.height = CELL_PX;
  }
  const c = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
  if (canvas === null || c === null || c === undefined) {
    hatchSources.set(terr, null);
    return null;
  }
  const mine = terr === TERRITORY_MINE;
  const color = mine ? TERRITORY_MINE_COLOR : TERRITORY_RIVAL_COLOR;
  c.fillStyle = rgba(color, mine ? 0.13 : 0.11);
  c.fillRect(0, 0, CELL_PX, CELL_PX);
  c.fillStyle = rgba(color, mine ? 0.3 : 0.24);
  for (let i = 0; i < CELL_PX; i++) {
    c.fillRect(i, (CELL_PX - 1 - i + CELL_PX) % CELL_PX, 1, 1);
    c.fillRect(i, (CELL_PX - i) % CELL_PX, 1, 1);
  }
  hatchSources.set(terr, canvas);
  return canvas;
}

// ---------------------------------------------------------------------------
// 全体図
// ---------------------------------------------------------------------------

/** 全体図でのセルの種類ごとの色（Cell の値の順） */
const OVERVIEW_KIND_RGB: readonly Rgb[] = [
  hexToRgb(P.grass), // GRASS
  hexToRgb(P.road), // ROAD
  hexToRgb(P.avenue), // AVENUE
  hexToRgb('#e5c398'), // ARCADE
  hexToRgb(P.alley), // ALLEY
  hexToRgb(P.path), // PATH
  hexToRgb(P.plaza), // PLAZA
  hexToRgb(P.bridge), // BRIDGE
  hexToRgb(P.water), // WATER
  hexToRgb(P.bank), // BANK
  hexToRgb(P.park), // PARK
  hexToRgb(P.pond), // POND
  hexToRgb('#d5d8de'), // BUILDING（屋根の色で上書き）
  hexToRgb(P.lot), // LOT
  hexToRgb('#4fa35a'), // TREE
  hexToRgb('#f4adc6'), // SAKURA
  hexToRgb('#d98fb0'), // GARDEN
  hexToRgb(P.parking), // PARKING
  hexToRgb(P.sand), // PLAYGROUND
];

/** 全体図で使う色（画素ごとに色の文字列を読み直さないよう、先に RGB にしておく） */
const OV_CONCRETE: Rgb = hexToRgb(P.concrete);
const OV_KAWARA: Rgb = hexToRgb(KAWARA_OVERVIEW);
const OV_FLAT: Rgb = hexToRgb(FLAT_ROOF.base);
const OV_GRASS_ALT: Rgb = hexToRgb(P.grassAlt);

/** 平らな屋上の建物（全体図では屋上の灰色に屋根色を少し混ぜる） */
const FLAT_ROOF_STYLES: ReadonlySet<string> = new Set(['apartment', 'mansion', 'office', 'warehouse']);

/**
 * 全体図でのセルの基本色を返す（陣地・色あせを混ぜる前）。
 * @param grid 街
 * @param i セルの添字
 * @param roofRgb 屋根の色表（RGB）
 * @returns 色
 */
function overviewBase(grid: TownGrid, i: number, roofRgb: readonly Rgb[]): Rgb { // audit-ignore: fnlog-missing 全体図の画素ごとに呼ぶ純粋な算術ヘルパー
  if (((grid.overlay[i] ?? 0) & OVERLAY_VIADUCT) !== 0) return OV_CONCRETE;
  const kind = grid.kinds[i] ?? Cell.GRASS;
  if (kind === Cell.BUILDING) {
    const b = grid.buildings[grid.buildingAt[i] ?? -1];
    if (b === undefined) return pick(OVERVIEW_KIND_RGB, Cell.BUILDING);
    const roof = b.style === 'kawaraHouse' ? OV_KAWARA : pick(roofRgb, b.roof);
    const color = FLAT_ROOF_STYLES.has(b.style) ? mixRgb(OV_FLAT, roof, 0.22) : roof;
    return b.district === 0 ? mixRgb(color, OVERVIEW_SOFT_OUT, 0.45) : mixRgb(color, OVERVIEW_SOFT_IN, 0.18);
  }
  const base = OVERVIEW_KIND_RGB[kind] ?? OVERVIEW_KIND_RGB[0] ?? [0, 0, 0];
  if (kind === Cell.GRASS && ((grid.variant[i] ?? 0) & 7) === 0) return OV_GRASS_ALT;
  return base;
}

/**
 * 建物の手前の列（下のセルが同じ建物でない）か。
 * @param grid 街
 * @param i セルの添字
 * @param row 行
 * @returns 手前なら true
 */
function isBuildingFront(grid: TownGrid, i: number, row: number): boolean { // audit-ignore: fnlog-missing 全体図の画素ごとに呼ぶ純粋な判定ヘルパー
  if ((grid.kinds[i] ?? Cell.GRASS) !== Cell.BUILDING) return false;
  if (row + 1 >= grid.rows) return true;
  return (grid.buildingAt[i + grid.cols] ?? -1) !== (grid.buildingAt[i] ?? -2);
}

/**
 * 全体図の1セル（s×s 画素）を書く。手前の壁は下の1列を暗くする。
 * @param out RGBA の画素列
 * @param width 画像の幅（画素）
 * @param col 列
 * @param row 行
 * @param c 色
 * @param front 建物の手前なら true
 * @sideEffect out を書き換える
 */
function writeOverviewCell(out: Uint8ClampedArray, width: number, col: number, row: number, c: Rgb, front: boolean): void { // audit-ignore: fnlog-missing 全体図の画素ごとに呼ぶ書き込みヘルパー
  const s = OVERVIEW_PX_PER_CELL;
  for (let dy = 0; dy < s; dy++) {
    const dark = front && dy === s - 1;
    const r = dark ? c[0] * 0.78 : c[0];
    const g = dark ? c[1] * 0.78 : c[1];
    const b = dark ? c[2] * 0.82 : c[2];
    let o = ((row * s + dy) * width + col * s) * 4;
    for (let dx = 0; dx < s; dx++) {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
      o += 4;
    }
  }
}

// ---------------------------------------------------------------------------
// 層ごとの描画
// ---------------------------------------------------------------------------

/**
 * チャンクのセル情報を行ごとに集める（下に1行余分に持つ。木の枝が上のセルへはみ出すため）。
 * @param p 描画の材料
 * @returns 行ごとのセル情報（CHUNK_CELLS+1 行）
 */
function collectRows(p: Paint): CellInfo[][] { // audit-ignore: fnlog-missing paintChunk から1回だけ呼ぶ集計ヘルパー（入口で記録済み）
  const rows: CellInfo[][] = [];
  for (let r = 0; r <= CHUNK_CELLS; r++) {
    const line: CellInfo[] = [];
    for (let c = 0; c < CHUNK_CELLS; c++) line.push(readCell(p, p.c0 + c, p.r0 + r));
    rows.push(line);
  }
  return rows;
}

/**
 * 地面の層を描く（各セルの地面と陣地の重ね色）。
 * @param p 描画の材料
 * @param rows セル情報
 * @sideEffect canvas に描く
 */
function paintGroundLayer(p: Paint, rows: readonly CellInfo[][]): void { // audit-ignore: fnlog-missing paintChunk の内側（入口で記録済み）
  for (let r = 0; r < CHUNK_CELLS; r++) {
    for (const ci of rows[r] ?? []) {
      paintGround(p, ci);
      tintTerritory(p, ci);
    }
  }
}

/**
 * 陣地の色を地面に重ねる（川・池・建物には重ねない。建物は窓の明かりで示す）。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function tintTerritory(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  if (ci.terr === 0 || ci.kind === Cell.WATER || ci.kind === Cell.POND || ci.kind === Cell.BUILDING) return;
  const street = isStreet(ci.kind) || ci.kind === Cell.PARKING;
  if (ci.terr === TERRITORY_MINE) rect(p.pen, ci.x, ci.y, CELL_PX, CELL_PX, street ? MINE_STREET_TINT : p.mineTint);
  else if (ci.terr === TERRITORY_RIVAL) rect(p.pen, ci.x, ci.y, CELL_PX, CELL_PX, street ? RIVAL_STREET_TINT : p.rivalTint);
}

/**
 * 道路の線の層を描く（中央線・車線・横断歩道）。地面をすべて描いたあとに重ねる（隣のセルへはみ出す線があるため）。
 * @param p 描画の材料
 * @param rows セル情報
 * @sideEffect canvas に描く
 */
function paintMarkingLayer(p: Paint, rows: readonly CellInfo[][]): void { // audit-ignore: fnlog-missing paintChunk の内側（入口で記録済み）
  for (let r = 0; r < CHUNK_CELLS; r++) {
    for (const ci of rows[r] ?? []) if (isRoadLike(ci.kind) && (ci.overlay & OVERLAY_VIADUCT) === 0) paintRoadMarkings(p, ci);
  }
}

/**
 * 建物の層を描く（チャンクにかかる建物を、建物の原点を基準に描く。はみ出しは canvas で切れる）。
 * @param p 描画の材料
 * @sideEffect canvas に描く
 */
function paintBuildingLayer(p: Paint): void { // audit-ignore: fnlog-missing paintChunk の内側（入口で記録済み）
  const seen = new Set<number>();
  for (let r = 0; r < CHUNK_CELLS; r++) {
    for (let c = 0; c < CHUNK_CELLS; c++) {
      const i = cellIndex(p.grid, p.c0 + c, p.r0 + r);
      if (i < 0 || (p.grid.kinds[i] ?? Cell.GRASS) !== Cell.BUILDING) continue;
      const bi = p.grid.buildingAt[i] ?? -1;
      if (bi < 0 || seen.has(bi)) continue;
      seen.add(bi);
      const b = p.grid.buildings[bi];
      if (b !== undefined) paintBuilding(p, b);
    }
  }
}

/**
 * 小物の層を描く（木・歩道の小物・ガーランド・旗・猫など）。行の順に描き、木の枝は上のセルへ少しはみ出す。
 * @param p 描画の材料
 * @param rows セル情報（最後の1行はチャンクの下の行。木のはみ出しだけ描く）
 * @sideEffect canvas に描く
 */
function paintPropLayer(p: Paint, rows: readonly CellInfo[][]): void { // audit-ignore: fnlog-missing paintChunk の内側（入口で記録済み）
  for (let r = 0; r <= CHUNK_CELLS; r++) {
    const inChunk = r < CHUNK_CELLS;
    for (const ci of rows[r] ?? []) {
      if ((ci.overlay & OVERLAY_VIADUCT) !== 0) continue;
      if (ci.kind === Cell.TREE || ci.kind === Cell.SAKURA) paintTree(p, ci);
      else if (inChunk) paintCellProps(p, ci);
    }
  }
}

/**
 * セルの種類に合う小物を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintCellProps(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  if (isRoadLike(ci.kind)) {
    paintStreetFurniture(p, ci);
    if (ci.level >= 3) paintRoadGarland(p, ci);
    return;
  }
  if (ci.kind === Cell.ARCADE) {
    paintArcadeGarland(p, ci);
    return;
  }
  paintGroundProps(p, ci);
}

/**
 * 高架の線路の層を描く（桁・枕木・レール・ホーム、下に落ちる影と柱）。
 * @param p 描画の材料
 * @param rows セル情報
 * @sideEffect canvas に描く
 */
function paintViaductLayer(p: Paint, rows: readonly CellInfo[][]): void { // audit-ignore: fnlog-missing paintChunk の内側（入口で記録済み）
  for (let r = 0; r < CHUNK_CELLS; r++) {
    for (const ci of rows[r] ?? []) {
      if ((ci.overlay & OVERLAY_VIADUCT) !== 0) paintViaductCell(p, ci);
      else if ((overlayOf(p.grid, ci.col, ci.row - 1) & OVERLAY_VIADUCT) !== 0) paintViaductShadow(p, ci);
    }
  }
}

/**
 * 色あせの層を描く（地区の色あせに合わせて、建物を含むセル全体に淡い灰色を重ねる）。
 * @param p 描画の材料
 * @param rows セル情報
 * @sideEffect canvas に描く
 */
function paintFadeLayer(p: Paint, rows: readonly CellInfo[][]): void { // audit-ignore: fnlog-missing paintChunk の内側（入口で記録済み）
  const cache = new Map<number, string>();
  for (let r = 0; r < CHUNK_CELLS; r++) {
    for (const ci of rows[r] ?? []) {
      const fade = Math.min(1, Math.max(0, p.state.fades[ci.district] ?? 0));
      if (fade <= 0) continue;
      let color = cache.get(ci.district);
      if (color === undefined) {
        color = `rgba(${FADE_RGB[0]},${FADE_RGB[1]},${FADE_RGB[2]},${Math.round(fade * FADE_STRENGTH * 1000) / 1000})`;
        cache.set(ci.district, color);
      }
      rect(p.pen, ci.x, ci.y, CELL_PX, CELL_PX, color);
    }
  }
}

// ---------------------------------------------------------------------------
// 地面
// ---------------------------------------------------------------------------

/**
 * セルの地面を種類ごとに描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintGround(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  switch (ci.kind) {
    case Cell.ROAD:
    case Cell.AVENUE:
      return paintRoad(p, ci);
    case Cell.ARCADE:
      return paintArcade(p, ci);
    case Cell.ALLEY:
      return paintAlley(p, ci);
    case Cell.PATH:
      return paintPath(p, ci);
    case Cell.PLAZA:
      return paintPlaza(p, ci);
    case Cell.BRIDGE:
      return paintBridge(p, ci);
    case Cell.WATER:
      return paintWater(p, ci);
    case Cell.BANK:
      return paintBank(p, ci);
    case Cell.PARK:
      return paintPark(p, ci);
    case Cell.POND:
      return paintPond(p, ci);
    case Cell.LOT:
      return paintLot(p, ci);
    case Cell.TREE:
    case Cell.SAKURA:
      return paintTreeGround(p, ci);
    case Cell.GARDEN:
      return paintGarden(p, ci);
    case Cell.PARKING:
      return paintParking(p, ci);
    case Cell.PLAYGROUND:
      return paintPlayground(p, ci);
    case Cell.BUILDING:
      return rect(p.pen, ci.x, ci.y, CELL_PX, CELL_PX, P.sidewalk);
    default:
      return paintGrass(p, ci);
  }
}

/**
 * 小さな花（十字の5ドット）を描く。
 * @param pen 塗りの状態
 * @param x 左上
 * @param y 左上
 * @param color 花びらの色
 * @sideEffect canvas に描く
 */
function paintFlower(pen: Pen, x: number, y: number, color: string): void { // audit-ignore: fnlog-missing 描画の小さな部品
  rect(pen, x, y + 1, 3, 1, color);
  rect(pen, x + 1, y, 1, 3, color);
  rect(pen, x + 1, y + 1, 1, 1, '#ffe66b');
}

/**
 * 芝に咲く花の数（成長段階・自分の陣地で増える）。
 * @param ci セル
 * @returns 0..3
 */
function flowerCount(ci: CellInfo): number { // audit-ignore: fnlog-missing セルごとに呼ぶ純粋な算術ヘルパー
  let n = ci.v % 13 === 0 ? 1 : 0;
  if (ci.level >= 1 && ci.v % 7 === 3) n++;
  if (ci.level >= 2 && ci.v % 5 === 2) n++;
  if (ci.terr === TERRITORY_MINE && ci.v % 3 === 1) n++;
  return Math.min(3, n);
}

/**
 * 芝のセルに花を咲かせる。
 * @param p 描画の材料
 * @param ci セル
 * @param count 花の数
 * @sideEffect canvas に描く
 */
function paintFlowers(p: Paint, ci: CellInfo, count: number): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  for (let k = 0; k < count; k++) {
    const h = mixHash(ci.v * 31 + k * 977 + ci.col * 7);
    paintFlower(p.pen, ci.x + (h % 6), ci.y + ((h >>> 4) % 6), pick(FLOWER_COLORS, (h >>> 8) + k));
  }
}

/**
 * 芝（空き地。門前町は苔庭と飛び石）を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintGrass(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y, v } = ci;
  const monzen = ci.theme === 'monzen';
  rect(p.pen, x, y, CELL_PX, CELL_PX, monzen ? P.moss : P.grass);
  if ((v & 3) === 0) rect(p.pen, x + ((v >> 2) & 3), y + ((v >> 4) & 3) + 2, 4, 2, monzen ? P.mossAlt : P.grassAlt);
  if (v % 5 === 1) {
    const tx = x + 1 + ((v >> 3) % 5);
    rect(p.pen, tx, y + 3, 1, 2, P.grassTuft);
    rect(p.pen, tx + 2, y + 4, 1, 2, P.grassTuft);
  }
  if (monzen && v % 9 === 4) rect(p.pen, x + 2, y + 3, 3, 2, P.plaza);
  paintFlowers(p, ci, flowerCount(ci));
}

/**
 * 公園の芝（刈り込みの縞）を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintPark(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  rect(p.pen, ci.x, ci.y, CELL_PX, 4, P.park);
  rect(p.pen, ci.x, ci.y + 4, CELL_PX, 4, P.parkAlt);
  if (ci.v % 6 === 1) rect(p.pen, ci.x + 2 + (ci.v % 4), ci.y + 2, 1, 2, P.grassTuft);
  paintFlowers(p, ci, flowerCount(ci));
}

/**
 * 車道（道路・大通り）を描く。建物や芝に接する側は歩道と縁石にする。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintRoad(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y, v } = ci;
  rect(p.pen, x, y, CELL_PX, CELL_PX, ci.kind === Cell.AVENUE ? P.avenue : P.road);
  if (v % 6 === 0) rect(p.pen, x + ((v >> 3) % 6), y + ((v >> 5) % 7), 2, 1, P.roadAlt);
  const g = p.grid;
  if (needsSidewalk(kindOf(g, ci.col - 1, ci.row))) paintSidewalk(p.pen, ci, 'l');
  if (needsSidewalk(kindOf(g, ci.col + 1, ci.row))) paintSidewalk(p.pen, ci, 'r');
  if (needsSidewalk(kindOf(g, ci.col, ci.row - 1))) paintSidewalk(p.pen, ci, 't');
  if (needsSidewalk(kindOf(g, ci.col, ci.row + 1))) paintSidewalk(p.pen, ci, 'b');
}

/**
 * 歩道（2ドット）と縁石（1ドット）を片側に描く。
 * @param pen 塗りの状態
 * @param ci セル
 * @param side 側
 * @sideEffect canvas に描く
 */
function paintSidewalk(pen: Pen, ci: CellInfo, side: Side): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y } = ci;
  const joint = (ci.col + ci.row) % 2 === 0;
  if (side === 'l' || side === 'r') {
    const sx = side === 'l' ? x : x + 6;
    rect(pen, sx, y, 2, CELL_PX, P.sidewalk);
    if (joint) rect(pen, sx, y + 7, 2, 1, P.sidewalkJoint);
    rect(pen, side === 'l' ? x + 2 : x + 5, y, 1, CELL_PX, P.curb);
    return;
  }
  const sy = side === 't' ? y : y + 6;
  rect(pen, x, sy, CELL_PX, 2, P.sidewalk);
  if (joint) rect(pen, x + 7, sy, 1, 2, P.sidewalkJoint);
  rect(pen, x, side === 't' ? y + 2 : y + 5, CELL_PX, 1, P.curb);
}

/**
 * 商店街（暖色タイルの市松、店に接する側は軒の影）を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintArcade(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y } = ci;
  rect(p.pen, x, y, CELL_PX, CELL_PX, P.arcade);
  rect(p.pen, x, y + 3, CELL_PX, 1, P.arcadeAlt);
  rect(p.pen, x, y + 7, CELL_PX, 1, P.arcadeAlt);
  rect(p.pen, x + ((ci.row & 1) === 0 ? 3 : 7), y, 1, 3, P.arcadeAlt);
  rect(p.pen, x + ((ci.row & 1) === 0 ? 7 : 3), y + 4, 1, 3, P.arcadeAlt);
  if ((ci.col + ci.row) % 3 === 0) rect(p.pen, x + 1, y + 1, 2, 2, '#f3dcb9');
  const g = p.grid;
  const awning = pick(GARLAND_COLORS, Math.floor(ci.row / 2) + ci.col);
  if (!isWalkable2(kindOf(g, ci.col - 1, ci.row))) {
    rect(p.pen, x, y, 2, CELL_PX, awning);
    rect(p.pen, x, y + ((ci.row & 1) === 0 ? 0 : 4), 2, 4, '#fffaf0');
    rect(p.pen, x + 2, y, 1, CELL_PX, P.arcadeEdge);
  }
  if (!isWalkable2(kindOf(g, ci.col + 1, ci.row))) {
    rect(p.pen, x + 6, y, 2, CELL_PX, awning);
    rect(p.pen, x + 6, y + ((ci.row & 1) === 0 ? 0 : 4), 2, 4, '#fffaf0');
    rect(p.pen, x + 5, y, 1, CELL_PX, P.arcadeEdge);
  }
  if (!isWalkable2(kindOf(g, ci.col, ci.row - 1))) rect(p.pen, x, y, CELL_PX, 1, P.arcadeEdge);
  if (!isWalkable2(kindOf(g, ci.col, ci.row + 1))) rect(p.pen, x, y + 7, CELL_PX, 1, P.arcadeEdge);
}

/**
 * 芝・木など、遊歩道の縁取りを描く相手か。
 * @param k 隣のセルの種類
 * @returns 縁取りを描くなら true
 */
function isSoftGround(k: number): boolean { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な判定ヘルパー
  return k === Cell.GRASS || k === Cell.PARK || k === Cell.TREE || k === Cell.SAKURA;
}

/**
 * 水辺（川・護岸・池）か。橋の欄干を描く相手。
 * @param k 隣のセルの種類
 * @returns 水辺なら true
 */
function isWet(k: number): boolean { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な判定ヘルパー
  return k === Cell.WATER || k === Cell.BANK || k === Cell.POND;
}

/**
 * 池でないか（池の縁取りを描く相手）。
 * @param k 隣のセルの種類
 * @returns 池でなければ true
 */
function isNotPond(k: number): boolean { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な判定ヘルパー
  return k !== Cell.POND;
}

/**
 * 高架のビットが立っているか。
 * @param bits overlay のビット
 * @returns 高架なら true
 */
function isViaduct(bits: number): boolean { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な判定ヘルパー
  return (bits & OVERLAY_VIADUCT) !== 0;
}

/**
 * 地面として続いて見えるセルか（縁取りを描かない相手）。
 * @param kind 隣のセルの種類
 * @returns 続いて見えるなら true
 */
function isWalkable2(kind: number): boolean { // audit-ignore: fnlog-missing 描画で呼ぶ純粋な判定ヘルパー
  return isStreet(kind) || kind === Cell.PLAZA || kind === Cell.PATH || kind === Cell.PARKING || kind === Cell.PARK;
}

/**
 * 路地（細い石畳）を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintAlley(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y } = ci;
  rect(p.pen, x, y, CELL_PX, CELL_PX, P.alley);
  const odd = (ci.row & 1) === 1;
  rect(p.pen, x + (odd ? 1 : 4), y + 1, 3, 2, P.alleyStone);
  rect(p.pen, x + (odd ? 4 : 0), y + 5, 3, 2, P.alleyStone);
  const g = p.grid;
  if (!isWalkable2(kindOf(g, ci.col - 1, ci.row))) rect(p.pen, x, y, 1, CELL_PX, P.alleyEdge);
  if (!isWalkable2(kindOf(g, ci.col + 1, ci.row))) rect(p.pen, x + 7, y, 1, CELL_PX, P.alleyEdge);
  if (!isWalkable2(kindOf(g, ci.col, ci.row - 1))) rect(p.pen, x, y, CELL_PX, 1, P.alleyEdge);
  if (!isWalkable2(kindOf(g, ci.col, ci.row + 1))) rect(p.pen, x, y + 7, CELL_PX, 1, P.alleyEdge);
}

/**
 * 遊歩道（土色、小石）を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintPath(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y, v } = ci;
  rect(p.pen, x, y, CELL_PX, CELL_PX, P.path);
  if (v % 3 === 0) rect(p.pen, x + ((v >> 2) % 7), y + ((v >> 5) % 7), 1, 1, P.pathPebble);
  if (v % 4 === 1) rect(p.pen, x + ((v >> 3) % 6), y + ((v >> 1) % 6), 2, 1, P.pathPebble);
  const g = p.grid;
  const soft = isSoftGround;
  if (soft(kindOf(g, ci.col - 1, ci.row))) rect(p.pen, x, y, 1, CELL_PX, P.pathEdge);
  if (soft(kindOf(g, ci.col + 1, ci.row))) rect(p.pen, x + 7, y, 1, CELL_PX, P.pathEdge);
  if (soft(kindOf(g, ci.col, ci.row - 1))) rect(p.pen, x, y, CELL_PX, 1, P.pathEdge);
  if (soft(kindOf(g, ci.col, ci.row + 1))) rect(p.pen, x, y + 7, CELL_PX, 1, P.pathEdge);
}

/**
 * 石畳の広場・境内を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintPlaza(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y } = ci;
  const odd = (ci.row & 1) === 1;
  rect(p.pen, x, y, CELL_PX, CELL_PX, P.plaza);
  rect(p.pen, x, y + 3, CELL_PX, 1, P.plazaLine);
  rect(p.pen, x, y + 7, CELL_PX, 1, P.plazaLine);
  rect(p.pen, x + (odd ? 2 : 6), y, 1, 3, P.plazaLine);
  rect(p.pen, x + (odd ? 6 : 2), y + 4, 1, 3, P.plazaLine);
}

/**
 * 橋（木の板と欄干）を描く。渡る向きは隣の道で決める。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintBridge(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y } = ci;
  const g = p.grid;
  const axis = axisOf(g, ci.col, ci.row, isStreet);
  rect(p.pen, x, y, CELL_PX, CELL_PX, P.bridge);
  for (let k = 1; k < CELL_PX; k += 3) {
    if (axis === 'v') rect(p.pen, x, y + k, CELL_PX, 1, P.bridgePlank);
    else rect(p.pen, x + k, y, 1, CELL_PX, P.bridgePlank);
  }
  const wet = isWet;
  if (wet(kindOf(g, ci.col - 1, ci.row))) paintRail(p.pen, x, y, 'v');
  if (wet(kindOf(g, ci.col + 1, ci.row))) paintRail(p.pen, x + 6, y, 'v');
  if (wet(kindOf(g, ci.col, ci.row - 1))) paintRail(p.pen, x, y, 'h');
  if (wet(kindOf(g, ci.col, ci.row + 1))) paintRail(p.pen, x, y + 6, 'h');
}

/**
 * 橋の欄干（2ドットの木と明るい柱）を描く。
 * @param pen 塗りの状態
 * @param x 左
 * @param y 上
 * @param dir 'v'=縦の欄干、'h'=横の欄干
 * @sideEffect canvas に描く
 */
function paintRail(pen: Pen, x: number, y: number, dir: 'v' | 'h'): void { // audit-ignore: fnlog-missing 描画の小さな部品
  if (dir === 'v') {
    rect(pen, x, y, 2, CELL_PX, P.bridgeRail);
    rect(pen, x, y + 1, 2, 1, P.bridgePost);
    rect(pen, x, y + 5, 2, 1, P.bridgePost);
    return;
  }
  rect(pen, x, y, CELL_PX, 2, P.bridgeRail);
  rect(pen, x + 1, y, 1, 2, P.bridgePost);
  rect(pen, x + 5, y, 1, 2, P.bridgePost);
}

/**
 * 川（岸からの距離で浅い・深いを塗り分け、さざ波と泡を描く）。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintWater(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y, v } = ci;
  const g = p.grid;
  /**
   * 隣（dc, dr）が水でない（岸）か。
   * @param dc 列の差
   * @param dr 行の差
   * @returns 岸なら true
   */
  const dry = (dc: number, dr: number): boolean => { // audit-ignore: fnlog-missing セルごとに呼ぶ判定ヘルパー
    const k = kindOf(g, ci.col + dc, ci.row + dr);
    return k !== Cell.WATER && k !== Cell.BRIDGE;
  };
  const l = dry(-1, 0);
  const r = dry(1, 0);
  const t = dry(0, -1);
  const b = dry(0, 1);
  const near = l || r || t || b;
  rect(p.pen, x, y, CELL_PX, CELL_PX, near ? P.waterShallow : P.water);
  if (!near && v % 3 === 2) rect(p.pen, x + ((v >> 2) % 4), y + ((v >> 5) % 6), 4 + (v % 3), 1, P.waterDeep);
  if (v % 4 === 0) rect(p.pen, x + ((v >> 2) % 5), y + ((v >> 4) % 7), 3, 1, P.waterHi);
  if (v % 9 === 1) rect(p.pen, x + ((v >> 3) % 6), y + ((v >> 1) % 7), 2, 1, P.waterHi);
  if (l) rect(p.pen, x, y, 1, CELL_PX, P.foam);
  if (r) rect(p.pen, x + 7, y, 1, CELL_PX, P.foam);
  if (t) rect(p.pen, x, y, CELL_PX, 1, P.foam);
  if (b) rect(p.pen, x, y + 7, CELL_PX, 1, P.foam);
}

/**
 * 川岸の護岸（石垣）を描く。水に接する側は濡れた線、陸に接する側は明るい天端。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintBank(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y } = ci;
  const odd = (ci.row & 1) === 1;
  rect(p.pen, x, y, CELL_PX, CELL_PX, P.bank);
  rect(p.pen, x, y + 3, CELL_PX, 1, P.bankLine);
  rect(p.pen, x, y + 7, CELL_PX, 1, P.bankLine);
  rect(p.pen, x + (odd ? 2 : 6), y, 1, 3, P.bankLine);
  rect(p.pen, x + (odd ? 6 : 2), y + 4, 1, 3, P.bankLine);
  const g = p.grid;
  const sides: readonly [number, number, number, number, number, number][] = [
    [-1, 0, x, y, 1, CELL_PX],
    [1, 0, x + 7, y, 1, CELL_PX],
    [0, -1, x, y, CELL_PX, 1],
    [0, 1, x, y + 7, CELL_PX, 1],
  ];
  for (const [dc, dr, sx, sy, sw, sh] of sides) {
    const k = kindOf(g, ci.col + dc, ci.row + dr);
    if (k === Cell.WATER) rect(p.pen, sx, sy, sw, sh, P.bankWet);
    else if (k !== Cell.BANK && k !== Cell.BRIDGE) rect(p.pen, sx, sy, sw, sh, P.bankTop);
  }
}

/**
 * 公園の池（石の縁取り、睡蓮）を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintPond(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y, v } = ci;
  const g = p.grid;
  rect(p.pen, x, y, CELL_PX, CELL_PX, P.pond);
  if (v % 5 === 0) rect(p.pen, x + ((v >> 2) % 5), y + ((v >> 4) % 6) + 1, 3, 1, P.waterHi);
  const edge = isNotPond;
  if (edge(kindOf(g, ci.col - 1, ci.row))) { rect(p.pen, x, y, 1, CELL_PX, P.pondRim); rect(p.pen, x + 1, y, 1, CELL_PX, P.pondInner); }
  if (edge(kindOf(g, ci.col + 1, ci.row))) { rect(p.pen, x + 7, y, 1, CELL_PX, P.pondRim); rect(p.pen, x + 6, y, 1, CELL_PX, P.pondInner); }
  if (edge(kindOf(g, ci.col, ci.row - 1))) { rect(p.pen, x, y, CELL_PX, 1, P.pondRim); rect(p.pen, x, y + 1, CELL_PX, 1, P.pondInner); }
  if (edge(kindOf(g, ci.col, ci.row + 1))) { rect(p.pen, x, y + 7, CELL_PX, 1, P.pondRim); rect(p.pen, x, y + 6, CELL_PX, 1, P.pondInner); }
  if (v % 7 === 0) {
    rect(p.pen, x + 2, y + 3, 3, 2, P.lily);
    rect(p.pen, x + 3, y + 3, 1, 1, '#ff9ec0');
  }
}

/**
 * スポットの敷地（上にスポットの絵が重なる明るい舗装）を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintLot(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y } = ci;
  const g = p.grid;
  rect(p.pen, x, y, CELL_PX, CELL_PX, P.lot);
  if ((ci.col + ci.row) % 2 === 0) rect(p.pen, x + 3, y + 3, 2, 2, P.lotEdge);
  if (kindOf(g, ci.col - 1, ci.row) !== Cell.LOT) rect(p.pen, x, y, 1, CELL_PX, P.lotEdge);
  if (kindOf(g, ci.col + 1, ci.row) !== Cell.LOT) rect(p.pen, x + 7, y, 1, CELL_PX, P.lotEdge);
  if (kindOf(g, ci.col, ci.row - 1) !== Cell.LOT) rect(p.pen, x, y, CELL_PX, 1, P.lotEdge);
  if (kindOf(g, ci.col, ci.row + 1) !== Cell.LOT) rect(p.pen, x, y + 7, CELL_PX, 1, P.lotEdge);
}

/**
 * 木の根元の地面を描く（公園の中なら公園の芝、桜なら花びら）。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintTreeGround(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const g = p.grid;
  const inPark = [kindOf(g, ci.col - 1, ci.row), kindOf(g, ci.col + 1, ci.row), kindOf(g, ci.col, ci.row - 1), kindOf(g, ci.col, ci.row + 1)].some(
    (k) => k === Cell.PARK || k === Cell.PATH,
  );
  if (inPark) {
    rect(p.pen, ci.x, ci.y, CELL_PX, 4, P.park);
    rect(p.pen, ci.x, ci.y + 4, CELL_PX, 4, P.parkAlt);
  } else {
    rect(p.pen, ci.x, ci.y, CELL_PX, CELL_PX, ci.theme === 'monzen' ? P.moss : P.grass);
  }
  if (ci.kind === Cell.SAKURA) {
    rect(p.pen, ci.x + 1, ci.y + 7, 1, 1, '#ffd5e2');
    rect(p.pen, ci.x + 6, ci.y + 6, 1, 1, '#ffd5e2');
  }
}

/**
 * 花壇（生け垣の縁、土、色とりどりの花）を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintGarden(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y, v } = ci;
  const g = p.grid;
  rect(p.pen, x, y, CELL_PX, CELL_PX, P.soil);
  if (kindOf(g, ci.col - 1, ci.row) !== Cell.GARDEN) rect(p.pen, x, y, 1, CELL_PX, P.hedge);
  if (kindOf(g, ci.col + 1, ci.row) !== Cell.GARDEN) rect(p.pen, x + 7, y, 1, CELL_PX, P.hedge);
  if (kindOf(g, ci.col, ci.row - 1) !== Cell.GARDEN) rect(p.pen, x, y, CELL_PX, 1, P.hedge);
  if (kindOf(g, ci.col, ci.row + 1) !== Cell.GARDEN) rect(p.pen, x, y + 7, CELL_PX, 1, P.hedge);
  rect(p.pen, x + 1, y + 4, 6, 1, '#6aa84f');
  const count = 2 + (ci.level >= 1 ? 1 : 0) + (ci.terr === TERRITORY_MINE ? 1 : 0);
  const spots: readonly [number, number][] = [[1, 1], [4, 1], [2, 4], [5, 4]];
  for (let k = 0; k < count; k++) {
    const at = spots[k] ?? [1, 1];
    paintFlower(p.pen, x + at[0], y + at[1], pick(FLOWER_COLORS, v + k * 3));
  }
}

/**
 * 駐車場・駐輪場（白線と車、暮らしの地区は自転車）を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintParking(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y, v } = ci;
  rect(p.pen, x, y, CELL_PX, CELL_PX, P.parking);
  rect(p.pen, x, y + 1, 1, 6, P.parkingLine);
  rect(p.pen, x + 4, y + 1, 1, 6, P.parkingLine);
  if (ci.theme === 'living' || ci.theme === 'alley') {
    for (let k = 0; k < 3; k++) {
      if (((v >> k) & 1) === 0) continue;
      const bx = x + 1 + k * 2 + (k > 1 ? 1 : 0);
      rect(p.pen, bx, y + 2, 1, 4, '#3a3f4f');
      rect(p.pen, bx, y + 3, 1, 1, pick(CAR_COLORS, v + k));
    }
    return;
  }
  for (let k = 0; k < 2; k++) {
    if (((v >> (k + 1)) & 1) === 0) continue;
    const cx = x + 1 + k * 4;
    const color = pick(CAR_COLORS, (v >> 3) + k * 2);
    rect(p.pen, cx, y + 1, 3, 6, color);
    rect(p.pen, cx, y + 2, 3, 1, '#bfe6ff');
    rect(p.pen, cx, y + 5, 3, 1, shade(color, -0.3));
  }
}

/**
 * 遊具（砂場にすべり台・ブランコ）を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintPlayground(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y, v } = ci;
  rect(p.pen, x, y, CELL_PX, CELL_PX, P.sand);
  if ((v & 1) === 0) {
    rect(p.pen, x + 1, y + 2, 1, 5, '#9aa3b2');
    rect(p.pen, x + 2, y + 2, 2, 1, '#9aa3b2');
    rect(p.pen, x + 3, y + 3, 1, 1, '#e2574c');
    rect(p.pen, x + 4, y + 4, 1, 1, '#e2574c');
    rect(p.pen, x + 5, y + 5, 2, 1, '#e2574c');
    return;
  }
  rect(p.pen, x + 1, y + 1, 6, 1, '#3e6fb5');
  rect(p.pen, x + 1, y + 1, 1, 6, '#3e6fb5');
  rect(p.pen, x + 6, y + 1, 1, 6, '#3e6fb5');
  rect(p.pen, x + 3, y + 2, 1, 2, '#9aa3b2');
  rect(p.pen, x + 3, y + 4, 1, 1, '#f2c94c');
  rect(p.pen, x + 5, y + 2, 1, 3, '#9aa3b2');
  rect(p.pen, x + 5, y + 5, 1, 1, '#ff6b8a');
}

// ---------------------------------------------------------------------------
// 道路の線
// ---------------------------------------------------------------------------

/**
 * 車道の中央線・車線・横断歩道を描く（交差点の中には線を引かない）。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintRoadMarkings(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const g = p.grid;
  const axis = axisOf(g, ci.col, ci.row, isRoadLike);
  if (axis === 'x') return;
  const vertical = axis === 'v';
  const before = vertical ? runOf(g, ci.col, ci.row, -1, 0, isRoadLike, 4) : runOf(g, ci.col, ci.row, 0, -1, isRoadLike, 4);
  const after = vertical ? runOf(g, ci.col, ci.row, 1, 0, isRoadLike, 4) : runOf(g, ci.col, ci.row, 0, 1, isRoadLike, 4);
  const widthPx = (before + after + 1) * CELL_PX;
  const offset = before * CELL_PX;
  if (ci.kind === Cell.AVENUE) {
    paintLaneLine(p.pen, ci, vertical, widthPx / 2 - 1 - offset, 2, P.lineYellow, false);
    paintLaneLine(p.pen, ci, vertical, Math.round(widthPx / 4) - offset, 1, P.lineWhite, true);
    paintLaneLine(p.pen, ci, vertical, Math.round((widthPx * 3) / 4) - offset, 1, P.lineWhite, true);
  } else if (widthPx >= 2 * CELL_PX) {
    paintLaneLine(p.pen, ci, vertical, widthPx / 2 - 1 - offset, 1, P.lineWhite, true);
  }
  paintCrosswalks(p, ci, vertical);
}

/**
 * 道に沿った線を1本描く（セルの中に入る所だけ。破線は前半5ドット）。
 * @param pen 塗りの状態
 * @param ci セル
 * @param vertical 南北の道なら true
 * @param at 道の幅方向の位置（セルの左端・上端からのドット）
 * @param thick 線の太さ
 * @param color 色
 * @param dashed 破線なら true
 * @sideEffect canvas に描く
 */
function paintLaneLine(pen: Pen, ci: CellInfo, vertical: boolean, at: number, thick: number, color: string, dashed: boolean): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  if (at < 0 || at >= CELL_PX) return;
  const len = dashed ? 5 : CELL_PX;
  if (vertical) rect(pen, ci.x + at, ci.y, thick, len, color);
  else rect(pen, ci.x, ci.y + at, len, thick, color);
}

/**
 * 交差点に接する側に白い横断歩道を描く。
 * @param p 描画の材料
 * @param ci セル
 * @param vertical 南北の道なら true
 * @sideEffect canvas に描く
 */
function paintCrosswalks(p: Paint, ci: CellInfo, vertical: boolean): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const g = p.grid;
  const { x, y } = ci;
  /**
   * 隣（dc, dr）が交差点か。
   * @param dc 列の差
   * @param dr 行の差
   * @returns 交差点なら true
   */
  const cross = (dc: number, dr: number): boolean => // audit-ignore: fnlog-missing セルごとに呼ぶ判定ヘルパー
    isRoadLike(kindOf(g, ci.col + dc, ci.row + dr)) && axisOf(g, ci.col + dc, ci.row + dr, isRoadLike) === 'x';
  if (vertical) {
    for (const [dr, top] of [[1, y + 2], [-1, y + 1]] as const) {
      if (!cross(0, dr)) continue;
      for (const bx of [0, 3, 6]) rect(p.pen, x + bx, top, 2, 5, P.lineWhite);
    }
    return;
  }
  for (const [dc, left] of [[1, x + 2], [-1, x + 1]] as const) {
    if (!cross(dc, 0)) continue;
    for (const by of [0, 3, 6]) rect(p.pen, left, y + by, 5, 2, P.lineWhite);
  }
}

// ---------------------------------------------------------------------------
// 小物
// ---------------------------------------------------------------------------

/**
 * 木（丸い樹冠・桜・門前町の松）を描く。樹冠は上のセルへ2ドットはみ出す。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintTree(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y, v } = ci;
  const pen = p.pen;
  rect(pen, x + 1, y + 6, 7, 2, P.shadow);
  rect(pen, x + 3, y + 4, 2, 3, P.trunk);
  if (ci.kind === Cell.TREE && ci.theme === 'monzen' && v % 3 === 0) {
    const [base, light, dark] = PINE_TONE;
    rect(pen, x + 3, y - 2, 2, 1, base);
    rect(pen, x + 2, y - 1, 4, 2, base);
    rect(pen, x + 1, y + 1, 6, 2, base);
    rect(pen, x + 1, y + 3, 6, 1, dark);
    rect(pen, x + 2, y - 1, 1, 1, light);
    rect(pen, x + 1, y + 1, 2, 1, light);
    return;
  }
  const [base, light, dark] = ci.kind === Cell.SAKURA ? SAKURA_TONE : pick(TREE_TONES, v);
  rect(pen, x + 2, y - 2, 4, 1, base);
  rect(pen, x + 1, y - 1, 6, 4, base);
  rect(pen, x + 1, y + 3, 6, 1, dark);
  rect(pen, x + 2, y + 4, 4, 1, dark);
  rect(pen, x + 2, y - 1, 2, 2, light);
  rect(pen, x + 3, y - 2, 2, 1, light);
  if (ci.kind === Cell.SAKURA && v % 2 === 0) rect(pen, x + 5, y + 1, 1, 1, '#ffffff');
}

/**
 * 歩道に置く小物を選ぶ（テーマ・成長段階・自分の陣地による）。
 * @param ci セル
 * @returns 小物（置かないなら undefined）
 */
function pickFurniture(ci: CellInfo): Furniture | undefined { // audit-ignore: fnlog-missing セルごとに呼ぶ純粋な選択ヘルパー
  const v = ci.v;
  if (ci.level >= 2) {
    if (v % 10 === 3) return 'lamp';
    if (v % 19 === 7) return 'bench';
    if (v % 23 === 11) return 'planter';
  }
  if (ci.terr === TERRITORY_MINE && v % 13 === 9) return 'planter';
  switch (ci.theme) {
    case 'city':
      return v % 17 === 0 ? 'vending' : v % 9 === 5 ? 'tree' : v % 29 === 2 ? 'lamp' : undefined;
    case 'river':
      return v % 7 === 2 ? 'sakura' : v % 21 === 4 ? 'bench' : undefined;
    case 'living':
      return v % 11 === 1 ? 'bike' : v % 13 === 6 ? 'tree' : undefined;
    case 'alley':
      return v % 9 === 4 ? 'pot' : v % 31 === 8 ? 'vending' : undefined;
    case 'monzen':
      return v % 13 === 6 ? 'toro' : v % 17 === 3 ? 'pot' : undefined;
    case 'market':
      return v % 7 === 1 ? 'crate' : v % 19 === 5 ? 'vending' : undefined;
    default:
      return undefined;
  }
}

/**
 * 歩道の帯の中に四角を塗る（帯の座標: along=歩道に沿う向き、across=縁からの深さ）。
 * @param pen 塗りの状態
 * @param ci セル
 * @param side 歩道の側
 * @param along 歩道に沿う位置
 * @param len 沿う長さ
 * @param across 縁からの位置
 * @param depth 深さ
 * @param color 色
 * @sideEffect canvas に描く
 */
function stripRect(pen: Pen, ci: CellInfo, side: Side, along: number, len: number, across: number, depth: number, color: string): void { // audit-ignore: fnlog-missing 描画の小さな部品
  const { x, y } = ci;
  if (side === 'l') rect(pen, x + across, y + along, depth, len, color);
  else if (side === 'r') rect(pen, x + CELL_PX - across - depth, y + along, depth, len, color);
  else if (side === 't') rect(pen, x + along, y + across, len, depth, color);
  else rect(pen, x + along, y + CELL_PX - across - depth, len, depth, color);
}

/**
 * 歩道の小物（街灯・ベンチ・プランター・自販機・街路樹・自転車・植木鉢・灯籠・木箱）を見下ろしで描く。
 * @param p 描画の材料
 * @param ci セル（車道）
 * @sideEffect canvas に描く
 */
function paintStreetFurniture(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const item = pickFurniture(ci);
  if (item === undefined) return;
  const side = sidewalkSide(p.grid, ci);
  if (side === undefined) return;
  const pen = p.pen;
  /**
   * 歩道の帯の座標で塗る。
   * @param along 沿う位置
   * @param len 沿う長さ
   * @param across 縁からの位置
   * @param depth 深さ
   * @param color 色
   * @sideEffect canvas に描く
   */
  const s = (along: number, len: number, across: number, depth: number, color: string): void => // audit-ignore: fnlog-missing 描画の小さな部品
    stripRect(pen, ci, side, along, len, across, depth, color);
  drawFurniture(item, ci, s);
}

/**
 * 歩道の小物を、歩道の帯の座標で描く。
 * @param item 小物
 * @param ci セル（車道）
 * @param s 歩道の帯の座標で塗る関数
 * @sideEffect canvas に描く
 */
function drawFurniture(item: Furniture, ci: CellInfo, s: (along: number, len: number, across: number, depth: number, color: string) => void): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  switch (item) {
    case 'lamp':
      s(2, 3, 0, 3, P.lampGlow);
      s(3, 1, 1, 1, P.lamp);
      return;
    case 'bench':
      s(1, 5, 0, 2, '#b07d47');
      s(1, 5, 0, 1, '#7a5233');
      return;
    case 'planter':
      s(1, 5, 0, 2, '#9b7653');
      s(1, 5, 0, 1, '#5aae5f');
      s(2, 1, 0, 1, pick(FLOWER_COLORS, ci.v));
      s(4, 1, 0, 1, pick(FLOWER_COLORS, ci.v + 2));
      return;
    case 'vending':
      s(2, 2, 0, 3, ci.v % 2 === 0 ? '#d94a4a' : '#3e6fb5');
      s(2, 2, 2, 1, '#f4f4f4');
      return;
    case 'tree':
    case 'sakura':
      s(1, 5, 0, 3, item === 'sakura' ? SAKURA_TONE[0] : '#5aae5f');
      s(2, 2, 0, 2, item === 'sakura' ? SAKURA_TONE[1] : '#8bd47a');
      return;
    case 'bike':
      s(1, 5, 1, 1, '#3a3f4f');
      s(3, 1, 0, 1, pick(CAR_COLORS, ci.v));
      return;
    case 'pot':
      s(2, 2, 0, 2, '#c06a3a');
      s(2, 2, 0, 1, '#5aae5f');
      return;
    case 'toro':
      s(2, 3, 0, 3, '#cfcabd');
      s(3, 1, 1, 1, '#ffe08a');
      return;
    default:
      s(1, 4, 0, 2, '#c08a52');
      s(1, 1, 0, 1, '#e2574c');
      s(2, 1, 0, 1, '#5ccf7a');
      s(3, 1, 0, 1, '#ff9f43');
  }
}

/**
 * 成長段階3の車道に、道を横切る提灯のガーランドを描く。
 * @param p 描画の材料
 * @param ci セル（車道）
 * @sideEffect canvas に描く
 */
function paintRoadGarland(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const axis = axisOf(p.grid, ci.col, ci.row, isRoadLike);
  const { x, y } = ci;
  if (axis === 'v' && ci.row % 6 === 0) {
    rect(p.pen, x, y + 2, CELL_PX, 1, P.garlandString);
    rect(p.pen, x + 3, y + 3, 3, 3, P.lantern);
    rect(p.pen, x + 3, y + 4, 3, 1, P.lanternBand);
  } else if (axis === 'h' && ci.col % 6 === 0) {
    rect(p.pen, x + 3, y, 1, CELL_PX, P.garlandString);
    rect(p.pen, x + 2, y + 3, 3, 3, P.lantern);
    rect(p.pen, x + 2, y + 4, 3, 1, P.lanternBand);
  }
}

/**
 * 商店街の頭上の三角旗ガーランド（成長段階3では赤ちょうちんも）を描く。
 * @param p 描画の材料
 * @param ci セル（商店街）
 * @sideEffect canvas に描く
 */
function paintArcadeGarland(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const vertical = axisOf(p.grid, ci.col, ci.row, isArcade) !== 'h';
  const { x, y } = ci;
  const step = vertical ? ci.row : ci.col;
  if (step % 4 === 0) {
    if (vertical) {
      rect(p.pen, x, y + 1, CELL_PX, 1, P.garlandString);
      for (const [k, fx] of [[0, 1], [1, 5]] as const) {
        const color = pick(GARLAND_COLORS, ci.col * 2 + k + ci.row);
        rect(p.pen, x + fx, y + 2, 3, 1, color);
        rect(p.pen, x + fx + 1, y + 3, 1, 1, color);
      }
    } else {
      rect(p.pen, x + 1, y, 1, CELL_PX, P.garlandString);
      for (const [k, fy] of [[0, 1], [1, 5]] as const) {
        const color = pick(GARLAND_COLORS, ci.row * 2 + k + ci.col);
        rect(p.pen, x + 2, y + fy, 1, 3, color);
        rect(p.pen, x + 3, y + fy + 1, 1, 1, color);
      }
    }
  } else if (ci.level >= 3 && step % 4 === 2 && ci.v % 2 === 0) {
    rect(p.pen, x + 3, y + 2, 2, 3, P.lantern);
    rect(p.pen, x + 3, y + 3, 2, 1, P.lanternBand);
  }
}

/**
 * 地面の小物（陣地の小旗、路地の猫と植木鉢、遊歩道のベンチと街灯、境内の灯籠）を描く。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintGroundProps(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y, v, kind } = ci;
  const open = kind === Cell.GRASS || kind === Cell.PARK || kind === Cell.PLAZA || kind === Cell.PATH;
  if (open && ci.terr === TERRITORY_MINE && v % 23 === 0) return paintFlag(p.pen, x, y, TERRITORY_MINE_COLOR);
  if (open && ci.terr === TERRITORY_RIVAL && v % 37 === 0) return paintFlag(p.pen, x, y, TERRITORY_RIVAL_COLOR);
  if (kind === Cell.ALLEY) {
    if (ci.theme === 'alley' && v % 29 === 7) return paintCat(p.pen, x, y, v);
    if (v % 7 === 2) {
      rect(p.pen, x + 1, y + 3, 2, 2, '#c06a3a');
      rect(p.pen, x + 1, y + 2, 2, 1, '#5aae5f');
    }
    return;
  }
  if (kind === Cell.PATH) {
    if (v % 13 === 5) {
      rect(p.pen, x + 1, y + 2, 2, 5, '#b07d47');
      rect(p.pen, x + 1, y + 2, 1, 5, '#7a5233');
    } else if (ci.level >= 2 && v % 11 === 2) {
      rect(p.pen, x + 5, y + 2, 3, 3, P.lampGlow);
      rect(p.pen, x + 6, y + 3, 1, 1, P.lamp);
    }
    return;
  }
  if (kind === Cell.PLAZA && ci.theme === 'monzen' && v % 17 === 0) {
    rect(p.pen, x + 2, y + 1, 4, 1, '#b9b3a5');
    rect(p.pen, x + 3, y + 2, 2, 2, '#d8d3c6');
    rect(p.pen, x + 3, y + 2, 1, 1, '#ffe08a');
    rect(p.pen, x + 2, y + 4, 4, 1, '#b9b3a5');
    rect(p.pen, x + 3, y + 5, 2, 2, '#c9c3b5');
    return;
  }
  if (kind === Cell.GRASS && ci.theme === 'alley' && v % 47 === 11) paintCat(p.pen, x, y, v);
}

/**
 * 小旗（ポールと三角の旗）を描く。
 * @param pen 塗りの状態
 * @param x セルの左
 * @param y セルの上
 * @param color 旗の色
 * @sideEffect canvas に描く
 */
function paintFlag(pen: Pen, x: number, y: number, color: string): void { // audit-ignore: fnlog-missing 描画の小さな部品
  rect(pen, x + 2, y + 6, 3, 1, P.shadow);
  rect(pen, x + 2, y, 1, 7, '#5b4636');
  rect(pen, x + 3, y, 4, 2, color);
  rect(pen, x + 3, y + 2, 2, 1, color);
  rect(pen, x + 4, y + 1, 1, 1, '#ffffff');
}

/**
 * 猫（丸まった小さな猫）を描く。
 * @param pen 塗りの状態
 * @param x セルの左
 * @param y セルの上
 * @param v ばらつき（毛色）
 * @sideEffect canvas に描く
 */
function paintCat(pen: Pen, x: number, y: number, v: number): void { // audit-ignore: fnlog-missing 描画の小さな部品
  const fur = pick(['#f0a050', '#3a3a3a', '#f4f4f4', '#9a8f86'], v >> 2);
  rect(pen, x + 2, y + 4, 4, 2, fur);
  rect(pen, x + 2, y + 3, 1, 1, fur);
  rect(pen, x + 4, y + 3, 1, 1, fur);
  rect(pen, x + 6, y + 4, 1, 1, fur);
  rect(pen, x + 2, y + 6, 4, 1, P.shadow);
}

// ---------------------------------------------------------------------------
// 高架
// ---------------------------------------------------------------------------

/**
 * 高架の1セルを描く（桁の上面・側面、枕木とレール、駅ならホームと屋根）。
 * @param p 描画の材料
 * @param ci セル
 * @sideEffect canvas に描く
 */
function paintViaductCell(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const g = p.grid;
  const viaduct = isViaduct;
  let up = 0;
  while (up < 8 && viaduct(overlayOf(g, ci.col, ci.row - up - 1))) up++;
  let down = 0;
  while (down < 8 && viaduct(overlayOf(g, ci.col, ci.row + down + 1))) down++;
  const bandH = (up + down + 1) * CELL_PX;
  const top = up * CELL_PX;
  const deckH = bandH - 3;
  const pen = p.pen;
  const station = (ci.overlay & OVERLAY_STATION) !== 0;
  /**
   * 高架の帯の座標（帯の上端からのドット）で、このセルに入る所だけ塗る。
   * @param by 帯の上端からの位置
   * @param h 高さ
   * @param bx セルの左からの位置
   * @param w 幅
   * @param color 色
   * @sideEffect canvas に描く
   */
  const band = (by: number, h: number, bx: number, w: number, color: string): void => { // audit-ignore: fnlog-missing 描画の小さな部品
    const y0 = Math.max(by, top);
    const y1 = Math.min(by + h, top + CELL_PX);
    if (y1 > y0) rect(pen, ci.x + bx, ci.y + (y0 - top), w, y1 - y0, color);
  };
  band(0, deckH, 0, CELL_PX, P.concrete);
  band(0, 1, 0, CELL_PX, P.concreteLight);
  band(1, 1, 0, CELL_PX, P.concreteEdge);
  band(deckH, 3, 0, CELL_PX, P.concreteDark);
  band(deckH, 1, 0, CELL_PX, '#9a9fab');
  const centers = deckH >= 18 && !station ? [Math.round(deckH * 0.32), Math.round(deckH * 0.72)] : [Math.round(deckH / 2)];
  if (station) paintPlatform(ci, deckH, centers, band);
  for (const tc of centers) {
    band(tc - 3, 7, 0, CELL_PX, P.ballast);
    for (let i = 0; i < CELL_PX; i++) if ((ci.col * CELL_PX + i) % 3 === 0) band(tc - 3, 7, i, 1, P.tie);
    band(tc - 2, 1, 0, CELL_PX, P.rail);
    band(tc + 2, 1, 0, CELL_PX, P.rail);
  }
}

/**
 * 高架の駅のホーム（線路の外側の明るい床、黄色い点字ブロック、青緑の屋根と柱）を描く。
 * @param ci セル
 * @param deckH 桁の上面の高さ（ドット）
 * @param centers 線路の中心（帯の上からのドット）
 * @param band 帯の座標で塗る関数
 * @sideEffect canvas に描く
 */
function paintPlatform(ci: CellInfo, deckH: number, centers: readonly number[], band: (by: number, h: number, bx: number, w: number, color: string) => void): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const first = (centers[0] ?? deckH / 2) - 4;
  const last = (centers[centers.length - 1] ?? deckH / 2) + 4;
  if (first > 2) {
    band(2, first - 2, 0, CELL_PX, P.platform);
    band(first - 1, 1, 0, CELL_PX, P.tactile);
    band(2, Math.max(2, Math.floor((first - 2) / 2)), 0, CELL_PX, P.canopy);
    band(2, 1, 0, CELL_PX, shade(P.canopy, 0.35));
    if (ci.col % 4 === 0) band(2 + Math.floor((first - 2) / 2), Math.ceil((first - 2) / 2) - 1, 3, 1, '#7d828f');
  }
  if (deckH - last > 2) {
    band(last + 1, deckH - last - 1, 0, CELL_PX, P.platform);
    band(last + 1, 1, 0, CELL_PX, P.tactile);
  }
}

/**
 * 高架のすぐ南のセルに、桁の影と柱を描く。
 * @param p 描画の材料
 * @param ci セル（高架でない）
 * @sideEffect canvas に描く
 */
function paintViaductShadow(p: Paint, ci: CellInfo): void { // audit-ignore: fnlog-missing セルごとに呼ぶ描画ヘルパー
  const { x, y } = ci;
  rect(p.pen, x, y, CELL_PX, 4, P.viaductShadow);
  if (ci.col % 5 === 0) {
    rect(p.pen, x + 3, y, 2, 5, P.concreteDark);
    rect(p.pen, x + 3, y, 1, 5, P.concrete);
    rect(p.pen, x + 3, y + 5, 3, 1, P.shadow);
  }
}

// ---------------------------------------------------------------------------
// 建物
// ---------------------------------------------------------------------------

/**
 * 建物を種類ごとに描く（敷地の中に、上を屋根、下を正面の壁）。
 * @param p 描画の材料
 * @param b 建物
 * @sideEffect canvas に描く
 */
function paintBuilding(p: Paint, b: TownBuilding): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const center = cellIndex(p.grid, b.col + Math.floor(b.w / 2), b.row + Math.floor(b.h / 2));
  const bp: BuildingPaint = {
    pen: p.pen,
    b,
    x: (b.col - p.c0) * CELL_PX,
    y: (b.row - p.r0) * CELL_PX,
    w: b.w * CELL_PX,
    h: b.h * CELL_PX,
    roof: pick(ROOF_COLORS, b.roof),
    lit: center >= 0 && (p.state.territory[center] ?? 0) === TERRITORY_MINE,
    theme: p.grid.themes[b.district] ?? 'city',
  };
  const painter = BUILDING_PAINTERS[b.style] ?? paintHouse;
  painter(bp);
}

/**
 * 窓の色（自分の陣地の中はほとんど灯る。外は時々灯る）。
 * @param bp 建物の材料
 * @param i 窓の番号
 * @returns 色
 */
function windowColor(bp: BuildingPaint, i: number): string { // audit-ignore: fnlog-missing 窓ごとに呼ぶ純粋な選択ヘルパー
  const h = mixHash(bp.b.seed * 131 + i * 7919);
  if (bp.lit) return (h & 3) !== 0 ? P.windowLit : P.window;
  return (h & 7) === 0 ? P.windowLit : P.window;
}

/**
 * 壁の色を建物の seed で選ぶ。
 * @param bp 建物の材料
 * @returns 色
 */
function wallColor(bp: BuildingPaint): string { // audit-ignore: fnlog-missing 建物ごとに呼ぶ純粋な選択ヘルパー
  return pick(WALL_COLORS, bp.b.seed >>> 3);
}

/**
 * 切妻屋根（棟の明るい線、瓦の段、軒の濃い線）を描く。
 * @param bp 建物の材料
 * @param roofH 屋根の高さ（ドット）
 * @param color 屋根の色
 * @param lineStep 瓦の段の間隔
 * @sideEffect canvas に描く
 */
function paintGableRoof(bp: BuildingPaint, roofH: number, color: string, lineStep: number): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w } = bp;
  rect(pen, x, y + 1, w, roofH - 1, color);
  rect(pen, x + 1, y, w - 2, 1, shade(color, 0.2));
  rect(pen, x + 1, y + 1, w - 2, 1, shade(color, 0.35));
  for (let ry = y + 2 + lineStep; ry < y + roofH - 1; ry += lineStep) rect(pen, x + 1, ry, w - 2, 1, shade(color, -0.14));
  rect(pen, x, y + 1, 1, roofH - 1, shade(color, -0.22));
  rect(pen, x + w - 1, y + 1, 1, roofH - 1, shade(color, -0.22));
  rect(pen, x, y + roofH - 1, w, 1, shade(color, -0.42));
}

/**
 * 正面の壁（窓・戸・幅木、陣地の中は窓辺の花）を描く。
 * @param bp 建物の材料
 * @param wy 壁の上端
 * @param wh 壁の高さ
 * @param wall 壁の色
 * @sideEffect canvas に描く
 */
function paintFrontWall(bp: BuildingPaint, wy: number, wh: number, wall: string): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, w, b } = bp;
  rect(pen, x + 1, wy, w - 2, wh, wall);
  rect(pen, x + 1, wy, w - 2, 1, shade(wall, -0.16));
  rect(pen, x + 1, wy + wh - 1, w - 2, 1, shade(wall, -0.28));
  const slots = Math.max(1, Math.floor((w - 3) / 4));
  const door = b.seed % slots;
  const winH = Math.max(1, Math.min(2, wh - 3));
  for (let i = 0; i < slots; i++) {
    const wx = x + 2 + i * 4;
    if (i === door) {
      rect(pen, wx, wy + 1, 2, wh - 2, P.wood);
      rect(pen, wx, wy + 1, 2, 1, P.woodDark);
      continue;
    }
    rect(pen, wx, wy + 1, 2, winH, windowColor(bp, i));
    if (bp.lit && wh >= 5) rect(pen, wx, wy + 1 + winH, 2, 1, i % 2 === 0 ? P.flowerBox : '#5aae5f');
  }
  if (((b.seed >>> 5) & 3) === 0 && w >= 16) rect(pen, x + w - 4, wy + wh - 3, 2, 2, '#e4e7ec');
}

/**
 * 一戸建て（切妻屋根）を描く。
 * @param bp 建物の材料
 * @sideEffect canvas に描く
 */
function paintHouse(bp: BuildingPaint): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const roofH = Math.max(4, Math.round(bp.h * 0.6));
  paintGableRoof(bp, roofH, bp.roof, 3);
  if (((bp.b.seed >>> 7) & 3) === 1 && bp.w >= 16) {
    rect(bp.pen, bp.x + bp.w - 6, bp.y + 1, 3, 3, '#b0573f');
    rect(bp.pen, bp.x + bp.w - 6, bp.y + 1, 3, 1, '#d07a62');
  }
  paintFrontWall(bp, bp.y + roofH, bp.h - roofH, wallColor(bp));
}

/**
 * 瓦屋根の町家（瓦の濃紺灰屋根・白壁・格子窓・のれん、門前町は提灯）を描く。
 * @param bp 建物の材料
 * @sideEffect canvas に描く
 */
function paintKawaraHouse(bp: BuildingPaint): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w, h, b } = bp;
  const tone = pick(KAWARA_TONES, b.seed >>> 2);
  const roofH = Math.max(4, Math.round(h * 0.58));
  rect(pen, x, y + 1, w, roofH - 1, tone.base);
  for (let ry = y + 3; ry < y + roofH - 1; ry += 2) rect(pen, x + 1, ry, w - 2, 1, tone.line);
  rect(pen, x, y, w, 2, tone.ridge);
  rect(pen, x, y, 2, 2, tone.eave);
  rect(pen, x + w - 2, y, 2, 2, tone.eave);
  rect(pen, x, y + roofH - 1, w, 1, tone.eave);
  const wy = y + roofH;
  const wh = h - roofH;
  const wall = (b.seed >>> 6) % 3 === 0 ? '#efe4cf' : '#f8f4ec';
  rect(pen, x + 1, wy, w - 2, wh, wall);
  rect(pen, x + 1, wy + wh - 1, w - 2, 1, '#8f7a63');
  rect(pen, x + 1, wy, 1, wh, P.woodDark);
  rect(pen, x + w - 2, wy, 1, wh, P.woodDark);
  paintKawaraFront(bp, wy, wh);
  if (bp.theme === 'monzen' && b.seed % 3 === 0 && w >= 16) {
    rect(pen, x + w - 5, wy + 1, 2, 3, P.lantern);
    rect(pen, x + w - 5, wy + 2, 2, 1, P.lanternBand);
  }
}

/**
 * 町家の正面を seed で描き分ける（格子窓／腰板と小窓／のれんの店先）。
 * @param bp 建物の材料
 * @param wy 壁の上端
 * @param wh 壁の高さ
 * @sideEffect canvas に描く
 */
function paintKawaraFront(bp: BuildingPaint, wy: number, wh: number): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, w, b } = bp;
  const inner = Math.max(1, wh - 3);
  const front = (b.seed >>> 4) % 3;
  if (front === 0) {
    rect(pen, x + 3, wy + 1, w - 6, inner, P.woodDark);
    for (let lx = x + 4; lx < x + w - 3; lx += 2) rect(pen, lx, wy + 1, 1, inner, bp.lit ? P.windowLit : '#c9a56f');
    return;
  }
  if (front === 1) {
    rect(pen, x + 2, wy + wh - 3, w - 4, 2, '#7a5a40');
    for (let wx = x + 3, k = 0; wx + 2 <= x + w - 3; wx += 5, k++) rect(pen, wx, wy + 1, 2, 1, windowColor(bp, k));
    rect(pen, x + Math.floor(w / 2) - 1, wy + 1, 2, wh - 2, P.wood);
    return;
  }
  rect(pen, x + 2, wy + 1, w - 4, Math.min(2, inner), '#2c3e66');
  for (let nx = x + 4; nx < x + w - 3; nx += 4) rect(pen, nx, wy + 1, 1, Math.min(2, inner), shade('#2c3e66', 0.25));
  rect(pen, x + Math.floor(w / 2), wy + 1, 1, 1, '#ffffff');
  rect(pen, x + 2, wy + 3, w - 4, Math.max(0, wh - 4), '#5a4a42');
  for (let gx = x + 3, k = 0; gx < x + w - 3; gx += 2, k++) rect(pen, gx, wy + wh - 2, 1, 1, pick(GOODS_COLORS, b.seed + k));
}

/**
 * 長屋（横長の屋根、戸と窓が並び、軒先に植木鉢）を描く。
 * @param bp 建物の材料
 * @sideEffect canvas に描く
 */
function paintNagaya(bp: BuildingPaint): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w, h } = bp;
  const roofH = Math.max(4, Math.round(h * 0.55));
  paintGableRoof(bp, roofH, bp.roof, 2);
  const wy = y + roofH;
  const wh = h - roofH;
  rect(pen, x + 1, wy, w - 2, wh, '#efe3cc');
  rect(pen, x + 1, wy + wh - 1, w - 2, 1, '#bfae92');
  for (let ux = x + 1, k = 0; ux + 7 <= x + w; ux += 8, k++) {
    rect(pen, ux, wy, 1, wh, '#cbb895');
    rect(pen, ux + 1, wy + 1, 2, wh - 2, P.wood);
    rect(pen, ux + 4, wy + 1, 2, Math.min(2, wh - 2), windowColor(bp, k));
    if (wh >= 5) {
      rect(pen, ux + 5, wy + wh - 3, 2, 1, '#5aae5f');
      rect(pen, ux + 5, wy + wh - 2, 2, 1, '#c06a3a');
    }
  }
}

/**
 * 平らな屋上（パラペット、貯水槽・室外機）を描く。
 * @param bp 建物の材料
 * @param roofH 屋上の高さ（ドット）
 * @sideEffect canvas に描く
 */
function paintFlatRoof(bp: BuildingPaint, roofH: number): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w, b } = bp;
  rect(pen, x, y, w, roofH, FLAT_ROOF.base);
  rect(pen, x, y, w, 1, FLAT_ROOF.light);
  rect(pen, x, y, 1, roofH, FLAT_ROOF.light);
  rect(pen, x + w - 1, y, 1, roofH, FLAT_ROOF.dark);
  rect(pen, x, y + roofH - 1, w, 1, FLAT_ROOF.dark);
  if (roofH >= 6 && w >= 12) {
    const tx = x + 2 + (b.seed % Math.max(1, w - 8));
    rect(pen, tx, y + 2, 4, 3, FLAT_ROOF.gear);
    rect(pen, tx, y + 2, 4, 1, '#bcc4d1');
  }
  if (roofH >= 5) {
    rect(pen, x + w - 4, y + 2, 2, 1, '#bfc5cf');
    if (w >= 20) rect(pen, x + 3, y + roofH - 3, 2, 1, '#bfc5cf');
  }
}

/**
 * アパート（屋上、パステルの壁、各階の窓とベランダ、暮らしの地区は洗濯物）を描く。
 * @param bp 建物の材料
 * @sideEffect canvas に描く
 */
function paintApartment(bp: BuildingPaint): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w, h, b } = bp;
  const roofH = Math.max(4, Math.round(h * 0.36));
  paintFlatRoof(bp, roofH);
  const wall = shade(bp.roof, 0.74);
  rect(pen, x, y + roofH, w, h - roofH, wall);
  rect(pen, x + w - 1, y + roofH, 1, h - roofH, shade(wall, -0.15));
  let floor = 0;
  for (let fy = y + roofH + 1; fy + 3 <= y + h - 1; fy += 4, floor++) {
    for (let wx = x + 2, k = 0; wx + 2 <= x + w - 1; wx += 4, k++) {
      rect(pen, wx, fy, 2, 2, windowColor(bp, floor * 16 + k));
      if (bp.theme === 'living' && ((b.seed >>> (k + floor)) & 7) === 0) rect(pen, wx + 1, fy + 2, 1, 1, pick(GARLAND_COLORS, k + floor));
    }
    rect(pen, x + 1, fy + 2, w - 2, 1, shade(bp.roof, 0.2));
  }
  rect(pen, x + Math.floor(w / 2) - 1, y + h - 3, 3, 2, '#5a5f70');
  rect(pen, x, y + h - 1, w, 1, shade(wall, -0.3));
}

/**
 * 高層マンション（屋上設備とアンテナ、細かな窓、中央の色帯）を描く。
 * @param bp 建物の材料
 * @sideEffect canvas に描く
 */
function paintMansion(bp: BuildingPaint): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w, h } = bp;
  const roofH = Math.max(4, Math.round(h * 0.26));
  paintFlatRoof(bp, roofH);
  rect(pen, x + 2, y, 1, 2, '#7d828f');
  const wall = '#e9edf3';
  rect(pen, x, y + roofH, w, h - roofH, wall);
  rect(pen, x + w - 1, y + roofH, 1, h - roofH, '#c9d0db');
  let n = 0;
  for (let fy = y + roofH + 1; fy + 2 <= y + h - 2; fy += 3) {
    for (let wx = x + 2; wx + 2 <= x + w - 1; wx += 3) rect(pen, wx, fy, 2, 2, windowColor(bp, n++));
  }
  const cx = x + Math.floor(w / 2) - 1;
  rect(pen, cx, y + roofH, 2, h - roofH - 1, bp.roof);
  rect(pen, cx - 1, y + h - 3, 4, 2, '#4d5466');
  rect(pen, x, y + h - 1, w, 1, '#a9b0bd');
}

/**
 * オフィスビル（ガラスの壁、桟、斜めの映り込み、入口のひさし）を描く。
 * @param bp 建物の材料
 * @sideEffect canvas に描く
 */
function paintOffice(bp: BuildingPaint): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w, h } = bp;
  const roofH = Math.max(4, Math.round(h * 0.3));
  paintFlatRoof(bp, roofH);
  const fy0 = y + roofH;
  const fh = h - roofH;
  rect(pen, x, fy0, w, fh, '#5b8fc7');
  let n = 0;
  for (let fy = fy0 + 1; fy < y + h - 1; fy += 3) {
    rect(pen, x, fy + 2, w, 1, '#3f6fa3');
    for (let wx = x + 1; wx < x + w - 1; wx += 4) if (bp.lit ? n++ % 3 !== 0 : mixHash(bp.b.seed + n++) % 9 === 0) rect(pen, wx, fy, 2, 2, P.windowLit);
  }
  for (let vx = x + 3; vx < x + w - 1; vx += 4) rect(pen, vx, fy0, 1, fh, '#3f6fa3');
  for (let k = 0; k < Math.min(fh - 1, w - 3); k++) rect(pen, x + 2 + k, y + h - 2 - k, 2, 1, 'rgba(200,232,255,0.55)');
  rect(pen, x + Math.floor(w / 2) - 3, y + h - 4, 6, 1, '#e8ebf0');
  rect(pen, x + Math.floor(w / 2) - 2, y + h - 3, 4, 3, '#2e4f78');
  rect(pen, x + w - 1, fy0, 1, fh, '#3f6fa3');
}

/**
 * 店舗つき住宅（屋根、2階の窓、看板、縞のひさし、店先の品物、市場は赤ちょうちん）を描く。
 * @param bp 建物の材料
 * @sideEffect canvas に描く
 */
function paintShophouse(bp: BuildingPaint): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w, h, b } = bp;
  const roofH = Math.max(4, Math.round(h * 0.42));
  paintGableRoof(bp, roofH, bp.roof, 3);
  const wall = wallColor(bp);
  const awningY = y + h - 6;
  rect(pen, x + 1, y + roofH, w - 2, awningY - (y + roofH), wall);
  for (let wx = x + 2, k = 0; wx + 2 <= x + w - 2; wx += 4, k++) rect(pen, wx, y + roofH + 1, 2, Math.min(2, awningY - y - roofH - 1), windowColor(bp, k));
  if (awningY - 2 >= y + roofH + 3) {
    rect(pen, x + 2, awningY - 2, w - 4, 2, '#fff6e0');
    rect(pen, x + 3, awningY - 2, 2, 2, bp.roof);
  }
  paintAwning(bp, awningY, 2);
  rect(pen, x + 1, y + h - 4, w - 2, 3, '#4d4250');
  for (let gx = x + 2, k = 0; gx < x + w - 2; gx += 2, k++) rect(pen, gx, y + h - 3, 1, 1, pick(GOODS_COLORS, b.seed + k));
  rect(pen, x + 1, y + h - 1, w - 2, 1, shade(wall, -0.3));
  if (bp.theme === 'market' || ((b.seed >>> 4) & 3) === 0) {
    rect(pen, x + 1, awningY + 2, 1, 2, P.lantern);
    rect(pen, x + w - 2, awningY + 2, 1, 2, P.lantern);
  }
}

/**
 * 縞のひさし（屋根の色と白の縦縞、裾の影）を描く。
 * @param bp 建物の材料
 * @param ay ひさしの上端
 * @param ah ひさしの高さ
 * @sideEffect canvas に描く
 */
function paintAwning(bp: BuildingPaint, ay: number, ah: number): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, w } = bp;
  for (let sx = x, k = 0; sx < x + w; sx += 2, k++) rect(pen, sx, ay, Math.min(2, x + w - sx), ah, k % 2 === 0 ? bp.roof : '#fffaf0');
  for (let sx = x + 1; sx < x + w; sx += 2) rect(pen, sx, ay + ah, 1, 1, shade(bp.roof, -0.35));
}

/**
 * 市場の屋台（縞の日よけ、台に並ぶ色とりどりの品物、柱、市場は提灯）を描く。
 * @param bp 建物の材料
 * @sideEffect canvas に描く
 */
function paintStall(bp: BuildingPaint): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w, h, b } = bp;
  const aH = Math.max(3, Math.round(h * 0.45));
  paintAwning(bp, y, aH);
  rect(pen, x, y, w, 1, shade(bp.roof, 0.3));
  rect(pen, x, y + aH + 1, 1, h - aH - 1, P.woodDark);
  rect(pen, x + w - 1, y + aH + 1, 1, h - aH - 1, P.woodDark);
  rect(pen, x + 1, y + aH + 1, w - 2, h - aH - 2, '#c9a26b');
  let k = 0;
  for (let gy = y + aH + 2; gy < y + h - 2; gy += 2) {
    for (let gx = x + 2; gx < x + w - 2; gx += 2) rect(pen, gx, gy, 1, 1, pick(GOODS_COLORS, b.seed + k++));
  }
  rect(pen, x + 1, y + h - 1, w - 2, 1, '#8a6a43');
  if (bp.theme === 'market') {
    rect(pen, x + 1, y + aH + 1, 1, 2, P.lantern);
    rect(pen, x + w - 2, y + aH + 1, 1, 2, P.lantern);
  }
}

/**
 * カフェ（屋根、大きなガラス窓、ひさし、店先のテラスとパラソル）を描く。
 * @param bp 建物の材料
 * @sideEffect canvas に描く
 */
function paintCafe(bp: BuildingPaint): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w, h } = bp;
  const roofH = Math.max(4, Math.round(h * 0.42));
  paintGableRoof(bp, roofH, bp.roof, 3);
  const wy = y + roofH;
  rect(pen, x + 1, wy, w - 2, h - roofH, '#fff8ee');
  rect(pen, x + 2, wy + 1, w - 4, 3, bp.lit ? '#ffe9a8' : '#bfe6ff');
  rect(pen, x + 2, wy + 1, w - 4, 1, '#ffffff');
  for (let mx = x + 5; mx < x + w - 3; mx += 4) rect(pen, mx, wy + 1, 1, 3, '#6b4a33');
  paintAwning(bp, wy + 4, 1);
  rect(pen, x + 1, y + h - 1, w - 2, 1, '#cdbfa6');
  for (let px = x + 1, k = 0; px + 4 <= x + w; px += 6, k++) {
    const umbrella = k % 2 === 0 ? shade(bp.roof, 0.25) : '#fffaf0';
    rect(pen, px, y + h - 4, 4, 2, umbrella);
    rect(pen, px + 1, y + h - 5, 2, 1, umbrella);
    rect(pen, px + 1, y + h - 2, 2, 1, '#6b4a33');
  }
}

/**
 * 倉庫（波板の屋根、大きなシャッター）を描く。
 * @param bp 建物の材料
 * @sideEffect canvas に描く
 */
function paintWarehouse(bp: BuildingPaint): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w, h } = bp;
  const roofH = Math.max(4, Math.round(h * 0.55));
  rect(pen, x, y, w, roofH, '#8d9db5');
  for (let sx = x + 1; sx < x + w; sx += 2) rect(pen, sx, y, 1, roofH, '#7d8da6');
  rect(pen, x, y, w, 1, '#aab8cc');
  rect(pen, x, y + roofH - 1, w, 1, '#5d6b85');
  const wy = y + roofH;
  const wh = h - roofH;
  rect(pen, x, wy, w, wh, '#c9cfd8');
  const sw = Math.max(4, w - 8);
  const sx0 = x + Math.floor((w - sw) / 2);
  rect(pen, sx0, wy + 1, sw, wh - 2, '#a2a9b5');
  for (let ly = wy + 2; ly < wy + wh - 1; ly += 2) rect(pen, sx0, ly, sw, 1, '#8f97a4');
  rect(pen, x, y + h - 1, w, 1, '#8f97a4');
  if (bp.lit) rect(pen, x + 2, wy + 1, 2, 2, P.windowLit);
}

/**
 * 駅舎（屋根と白い縁取り、時計、駅名板、ガラスの入口）を描く。
 * @param bp 建物の材料
 * @sideEffect canvas に描く
 */
function paintStation(bp: BuildingPaint): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ描画ヘルパー
  const { pen, x, y, w, h } = bp;
  const roofH = Math.max(5, Math.round(h * 0.45));
  paintGableRoof(bp, roofH, bp.roof, 3);
  rect(pen, x, y + roofH, w, 1, '#ffffff');
  const cx = x + Math.floor(w / 2);
  rect(pen, cx - 2, y + roofH - 5, 4, 4, '#ffffff');
  rect(pen, cx - 2, y + roofH - 5, 4, 1, shade(bp.roof, -0.3));
  rect(pen, cx - 1, y + roofH - 4, 1, 2, P.ink);
  rect(pen, cx, y + roofH - 3, 1, 1, P.ink);
  const wy = y + roofH + 1;
  rect(pen, x + 1, wy, w - 2, y + h - wy, '#fbfaf6');
  rect(pen, x + 2, wy + 1, w - 4, 2, '#2c3e66');
  for (let dx = x + 4; dx < x + w - 4; dx += 3) rect(pen, dx, wy + 1, 1, 1, '#ffffff');
  rect(pen, cx - 4, wy + 3, 8, Math.max(1, y + h - wy - 4), '#3d4f6e');
  rect(pen, cx - 4, wy + 3, 8, 1, '#a9d4f5');
  for (let wx = x + 2; wx + 2 < cx - 5; wx += 4) rect(pen, wx, wy + 4, 2, 2, windowColor(bp, wx));
  for (let wx = cx + 6; wx + 2 <= x + w - 2; wx += 4) rect(pen, wx, wy + 4, 2, 2, windowColor(bp, wx));
  rect(pen, x + 1, y + h - 1, w - 2, 1, '#bfb6a5');
}

/** 建物の種類 → 描く関数 */
const BUILDING_PAINTERS: Readonly<Record<string, (bp: BuildingPaint) => void>> = {
  house: paintHouse,
  kawaraHouse: paintKawaraHouse,
  nagaya: paintNagaya,
  apartment: paintApartment,
  mansion: paintMansion,
  office: paintOffice,
  shophouse: paintShophouse,
  stall: paintStall,
  cafe: paintCafe,
  warehouse: paintWarehouse,
  station: paintStation,
};
