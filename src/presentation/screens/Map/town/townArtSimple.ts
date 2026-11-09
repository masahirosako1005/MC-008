/**
 * @file 街の地面を「簡易表示」で描く（presentation/screens/Map/town 層）
 * 2026-11-09 ユーザー指示「街のオブジェクトが多すぎて大変。お店以外は簡易オブジェクトに」で、建物は四角・木は丸い点・道は白い帯に。
 * 2026-11-09 ユーザー指示「陣取り＋街の成長要素が無いので入れてほしい」で、陣地によって街の育ち方を描き分ける:
 * - 自分の陣地の外: 灰色の四角（まだ育っていない街）。木もくすんだ色
 * - ライバルの陣地: 薄紫の四角
 * - 自分の陣地の中: 色づいた建物（屋根の明るい縁）。地区の成長段階で増える（Lv1 花、Lv2 窓と街灯、Lv3 灯る窓・屋根の小旗・道の提灯）
 * 主役（お店・名所・トイレの絵）は townScene が上に重ねる。townArt（細かいドット絵版）と同じ形の API（paintChunk・paintOverview）。
 */
import { createLogger } from '@/Common/logging/logger';
import { CELL_PX, CHUNK_CELLS, CHUNK_PX, Cell, OVERLAY_VIADUCT, OVERVIEW_PX_PER_CELL, TERRITORY_MINE, TERRITORY_RIVAL, isStreet } from '@/presentation/screens/Map/town/townTypes';
import type { TownGrid, TownPaintState } from '@/presentation/screens/Map/town/townTypes';

const logger = createLogger('presentation/screens/Map/town/townArtSimple');

/** 自分の陣地の中の建物の色（TownBuilding.roof の 0..7。赤・橙・青緑・青・紫・こげ茶・瓦・灰を、明るく色づけたもの） */
export const VIVID_BUILDING_COLORS: readonly string[] = ['#f4a596', '#f7bd84', '#8fd3c6', '#9fbdea', '#c6b3f0', '#d9b99c', '#aebad0', '#d9dde6'];
/** 色づいた建物の屋根の明るい縁 */
const VIVID_HIGHLIGHT: readonly string[] = ['#f9c9bf', '#fbd8b3', '#bfe7df', '#c7d8f3', '#ddd2f6', '#ead6c4', '#cdd5e3', '#ebedf2'];
/** 色づいた建物の影 */
const VIVID_SHADOW = '#b9a99a';
/** まだ育っていない建物（陣地の外） */
const DORMANT_BUILDING = '#e5e5e8';
const DORMANT_SHADOW = '#d3d3d8';
/** ライバルの陣地の建物 */
const RIVAL_BUILDING = '#ddd5f2';
const RIVAL_SHADOW = '#c7bde3';
/** 互換のため残す: 簡易表示の建物の基本色（全体図の凡例・テスト用） */
export const SIMPLE_BUILDING_COLORS: readonly string[] = VIVID_BUILDING_COLORS;

/** セルの種類ごとの地面の色 */
const GROUND: Readonly<Record<number, string>> = {
  [Cell.GRASS]: '#f4f2ee',
  [Cell.ROAD]: '#ffffff',
  [Cell.AVENUE]: '#ffffff',
  [Cell.ARCADE]: '#fde8d2',
  [Cell.ALLEY]: '#fbfaf7',
  [Cell.PATH]: '#efe8d8',
  [Cell.PLAZA]: '#ecebe6',
  [Cell.BRIDGE]: '#e9e7e2',
  [Cell.WATER]: '#a9d9f0',
  [Cell.BANK]: '#d3e6ec',
  [Cell.PARK]: '#dcebd2',
  [Cell.POND]: '#a9d9f0',
  [Cell.BUILDING]: '#f4f2ee',
  [Cell.LOT]: '#f8f7f3',
  [Cell.TREE]: '#f4f2ee',
  [Cell.SAKURA]: '#f4f2ee',
  [Cell.GARDEN]: '#f4f2ee',
  [Cell.PARKING]: '#f4f2ee',
  [Cell.PLAYGROUND]: '#dcebd2',
};
/** 自分の陣地の中の地面（暖かい色） */
const MINE_GROUND = '#eef4ff';
const MINE_PARK = '#cfeab9';
/** 道の縁（道でないセルとの境） */
const STREET_EDGE = '#dcd6ca';
/** 大通りの面（ふつうの道と見分けるため、ほんの少し黄色に） */
const AVENUE_TINT = '#fffaea';
/** 木の色（色づいた・くすんだ） */
const TREE = { light: '#a8d596', dark: '#8cc47a' };
const TREE_DORMANT = { light: '#d3dccd', dark: '#c3cebc' };
const SAKURA = { light: '#f8cdda', dark: '#efb3c6' };
const SAKURA_DORMANT = { light: '#eadde2', dark: '#ddcdd3' };
/** 花の色 */
const FLOWER_COLORS: readonly string[] = ['#ff8fab', '#ffc83d', '#ff6a3d', '#b48cff', '#ffffff'];
/** 街灯・提灯 */
const LAMP_POST = '#6b6f80';
const LAMP_LIGHT = '#ffd84d';
const LANTERN = '#ff5a3d';
/** 高架の色（桁・縁・レール） */
const VIADUCT_FILL = '#dadde4';
const VIADUCT_EDGE = '#c2c6d0';
const VIADUCT_RAIL = '#b3b8c3';
/** 陣地の境を目立たせる地面の色づけ（自分は地面の色を変えるので、ここはライバルだけ） */
const RIVAL_TINT = { r: 123, g: 97, b: 255, a: 0.1 };
/** 色あせで重ねる色と、色あせ 1 のときの濃さ */
const FADE_TINT = { r: 238, g: 238, b: 238, a: 0.55 };

/**
 * セルの種類を返す（範囲外は空き地）。
 * @param grid 街
 * @param col 列
 * @param row 行
 * @returns 種類
 */
function kindAt(grid: TownGrid, col: number, row: number): number { // audit-ignore: fnlog-missing チャンクを描くときにセルごとに呼ぶ純粋な参照ヘルパー
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return Cell.GRASS;
  return grid.kinds[row * grid.cols + col] ?? Cell.GRASS;
}

/**
 * セルの陣地と、そのセルの地区の成長段階を返す（範囲外は陣地なし・Lv0）。
 * @param grid 街
 * @param state 描画状態
 * @param col 列
 * @param row 行
 * @returns 陣地（TERRITORY_*）と成長段階
 */
function ownerAt(grid: TownGrid, state: TownPaintState, col: number, row: number): { owner: number; level: number } { // audit-ignore: fnlog-missing セルごとに呼ぶ純粋な参照ヘルパー
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return { owner: 0, level: 0 };
  const i = row * grid.cols + col;
  return { owner: state.territory[i] ?? 0, level: state.levels[grid.district[i] ?? 0] ?? 0 };
}

/**
 * 1チャンクを描く（地面 → 道の縁・木 → 陣地の中の飾り → 建物 → 高架 → ライバルの色・色あせ）。
 * @param ctx CHUNK_PX 四方の canvas の 2D コンテキスト
 * @param grid 街
 * @param chunkCol チャンクの列
 * @param chunkRow チャンクの行
 * @param state 成長・色あせ・陣地
 * @sideEffect canvas に描く
 */
export function paintChunk(ctx: CanvasRenderingContext2D, grid: TownGrid, chunkCol: number, chunkRow: number, state: TownPaintState): void {
  const log = logger.fn('paintChunk', { chunkCol, chunkRow });
  const c0 = chunkCol * CHUNK_CELLS;
  const r0 = chunkRow * CHUNK_CELLS;
  ctx.fillStyle = GROUND[Cell.GRASS] ?? '#f4f2ee';
  ctx.fillRect(0, 0, CHUNK_PX, CHUNK_PX);
  const buildings = new Set<number>();
  for (let r = 0; r < CHUNK_CELLS; r++) {
    for (let c = 0; c < CHUNK_CELLS; c++) {
      const col = c0 + c;
      const row = r0 + r;
      const kind = kindAt(grid, col, row);
      const own = ownerAt(grid, state, col, row);
      paintCell(ctx, grid, kind, col, row, c * CELL_PX, r * CELL_PX, own.owner === TERRITORY_MINE);
      if (own.owner === TERRITORY_MINE) paintGrowth(ctx, grid, kind, col, row, c * CELL_PX, r * CELL_PX, own.level);
      const b = col < grid.cols && row < grid.rows && col >= 0 && row >= 0 ? (grid.buildingAt[row * grid.cols + col] ?? -1) : -1;
      if (b >= 0) buildings.add(b);
    }
  }
  for (const b of buildings) paintBuilding(ctx, grid, state, b, c0, r0);
  paintViaduct(ctx, grid, c0, r0);
  paintTints(ctx, grid, state, c0, r0);
  log.exit(undefined, `建物 ${buildings.size}`);
}

/**
 * 1セルの地面（と道の縁・木）を描く。自分の陣地の中は地面を暖かい色に、木を色づける。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param kind セルの種類
 * @param col 列
 * @param row 行
 * @param x チャンク内の左（ドット）
 * @param y チャンク内の上（ドット）
 * @param mine 自分の陣地か
 * @sideEffect canvas に描く
 */
function paintCell(ctx: CanvasRenderingContext2D, grid: TownGrid, kind: number, col: number, row: number, x: number, y: number, mine: boolean): void { // audit-ignore: fnlog-missing チャンクを描くときにセルごとに呼ぶ（paintChunk でまとめてログ）
  const open = kind === Cell.GRASS || kind === Cell.BUILDING || kind === Cell.TREE || kind === Cell.SAKURA || kind === Cell.GARDEN || kind === Cell.PARKING || kind === Cell.LOT;
  const park = kind === Cell.PARK || kind === Cell.PLAYGROUND;
  ctx.fillStyle = mine && open ? MINE_GROUND : mine && park ? MINE_PARK : (GROUND[kind] ?? '#f4f2ee');
  ctx.fillRect(x, y, CELL_PX, CELL_PX);
  if (isStreet(kind)) {
    paintStreetEdges(ctx, grid, kind, col, row, x, y);
    return;
  }
  if (kind === Cell.TREE || kind === Cell.SAKURA) paintTree(ctx, x, y, kind === Cell.SAKURA ? (mine ? SAKURA : SAKURA_DORMANT) : mine ? TREE : TREE_DORMANT);
  else if (kind === Cell.BANK) {
    ctx.fillStyle = '#c3dbe3';
    ctx.fillRect(x, y + CELL_PX - 1, CELL_PX, 1);
  }
}

/**
 * 道の縁（道でない隣との境に1ドットの線）を描く。大通りは面をほんの少し黄色にする。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param kind セルの種類
 * @param col 列
 * @param row 行
 * @param x 左（ドット）
 * @param y 上（ドット）
 * @sideEffect canvas に描く
 */
function paintStreetEdges(ctx: CanvasRenderingContext2D, grid: TownGrid, kind: number, col: number, row: number, x: number, y: number): void { // audit-ignore: fnlog-missing セルごとに呼ぶ（paintChunk でまとめてログ）
  ctx.fillStyle = STREET_EDGE;
  if (!isStreet(kindAt(grid, col, row - 1))) ctx.fillRect(x, y, CELL_PX, 1);
  if (!isStreet(kindAt(grid, col, row + 1))) ctx.fillRect(x, y + CELL_PX - 1, CELL_PX, 1);
  if (!isStreet(kindAt(grid, col - 1, row))) ctx.fillRect(x, y, 1, CELL_PX);
  if (!isStreet(kindAt(grid, col + 1, row))) ctx.fillRect(x + CELL_PX - 1, y, 1, CELL_PX);
  if (kind === Cell.AVENUE) {
    ctx.fillStyle = AVENUE_TINT;
    ctx.fillRect(x + 1, y + 1, CELL_PX - 2, CELL_PX - 2);
  }
}

/**
 * 木を丸い点で描く（6ドットの丸に下側の影）。
 * @param ctx 2D コンテキスト
 * @param x 左（ドット）
 * @param y 上（ドット）
 * @param color 明るい色と暗い色
 * @sideEffect canvas に描く
 */
function paintTree(ctx: CanvasRenderingContext2D, x: number, y: number, color: { light: string; dark: string }): void { // audit-ignore: fnlog-missing セルごとに呼ぶ（paintChunk でまとめてログ）
  ctx.fillStyle = color.dark;
  ctx.fillRect(x + 2, y + 2, 4, 5);
  ctx.fillRect(x + 1, y + 3, 6, 3);
  ctx.fillStyle = color.light;
  ctx.fillRect(x + 2, y + 1, 4, 4);
  ctx.fillRect(x + 1, y + 2, 6, 2);
}

/**
 * 自分の陣地の中の「街が育った」しるし（地区の成長段階で増える）。
 * Lv0 以上: 空き地にときどき花。Lv1 以上: 花が増える。Lv2 以上: 道ばたに街灯。Lv3: 道に提灯。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param kind セルの種類
 * @param col 列
 * @param row 行
 * @param x 左（ドット）
 * @param y 上（ドット）
 * @param level 地区の成長段階
 * @sideEffect canvas に描く
 */
function paintGrowth(ctx: CanvasRenderingContext2D, grid: TownGrid, kind: number, col: number, row: number, x: number, y: number, level: number): void { // audit-ignore: fnlog-missing セルごとに呼ぶ（paintChunk でまとめてログ）
  const v = grid.variant[row * grid.cols + col] ?? 0;
  if (kind === Cell.GRASS || kind === Cell.GARDEN || kind === Cell.PARKING || kind === Cell.PARK) {
    const rate = 40 + level * 45;
    if (v < rate) {
      ctx.fillStyle = FLOWER_COLORS[v % FLOWER_COLORS.length] ?? '#ff8fab';
      ctx.fillRect(x + 1 + (v % 3), y + 2 + ((v >> 2) % 3), 2, 2);
      ctx.fillStyle = FLOWER_COLORS[(v + 2) % FLOWER_COLORS.length] ?? '#ffc83d';
      ctx.fillRect(x + 5 - ((v >> 3) % 2), y + 5 - ((v >> 4) % 2), 2, 2);
    }
    return;
  }
  if (!isStreet(kind) || kind === Cell.BRIDGE) return;
  const besideBuilding = !isStreet(kindAt(grid, col, row - 1));
  if (level >= 2 && besideBuilding && (col + row * 3) % 7 === 0) {
    ctx.fillStyle = LAMP_POST;
    ctx.fillRect(x + 3, y + 1, 1, 5);
    ctx.fillStyle = LAMP_LIGHT;
    ctx.fillRect(x + 2, y, 3, 2);
  }
  if (level >= 3 && besideBuilding && col % 2 === 0) {
    ctx.fillStyle = LANTERN;
    ctx.fillRect(x + 2, y + 1, 3, 3);
    ctx.fillStyle = LAMP_LIGHT;
    ctx.fillRect(x + 3, y + 2, 1, 1);
  }
}

/**
 * 建物を四角で描く。自分の陣地の中は色づき（成長段階で窓・灯り・屋根の小旗が増える）、外は灰色、ライバルの陣地は薄紫。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param state 描画状態
 * @param index 建物の添字
 * @param c0 チャンクの左上の列
 * @param r0 チャンクの左上の行
 * @sideEffect canvas に描く
 */
function paintBuilding(ctx: CanvasRenderingContext2D, grid: TownGrid, state: TownPaintState, index: number, c0: number, r0: number): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ（paintChunk でまとめてログ）
  const b = grid.buildings[index];
  if (b === undefined) return;
  const x = (b.col - c0) * CELL_PX + 1;
  const y = (b.row - r0) * CELL_PX + 1;
  const w = b.w * CELL_PX - 2;
  const h = b.h * CELL_PX - 2;
  const own = ownerAt(grid, state, b.col + Math.floor(b.w / 2), b.row + Math.floor(b.h / 2));
  if (own.owner !== TERRITORY_MINE) {
    ctx.fillStyle = own.owner === TERRITORY_RIVAL ? RIVAL_SHADOW : DORMANT_SHADOW;
    ctx.fillRect(x, y + 1, w, h);
    ctx.fillStyle = own.owner === TERRITORY_RIVAL ? RIVAL_BUILDING : DORMANT_BUILDING;
    ctx.fillRect(x, y, w, h - 1);
    return;
  }
  ctx.fillStyle = VIVID_SHADOW;
  ctx.fillRect(x, y + 1, w, h);
  ctx.fillStyle = b.style === 'station' ? '#c9cfdc' : (VIVID_BUILDING_COLORS[b.roof] ?? '#d9dde6');
  ctx.fillRect(x, y, w, h - 1);
  ctx.fillStyle = VIVID_HIGHLIGHT[b.roof] ?? '#ebedf2';
  ctx.fillRect(x, y, w, 2);
  if (own.level >= 2 && w >= 10 && h >= 8) paintWindows(ctx, x, y, w, h, own.level >= 3, b.seed);
  if (own.level >= 3 && b.seed % 3 === 0) {
    ctx.fillStyle = LAMP_POST;
    ctx.fillRect(x + w - 4, y - 4, 1, 5);
    ctx.fillStyle = LANTERN;
    ctx.fillRect(x + w - 3, y - 4, 3, 2);
  }
}

/**
 * 建物の窓（2ドットの四角を並べる。lit なら一部が黄色く灯る）。
 * @param ctx 2D コンテキスト
 * @param x 左
 * @param y 上
 * @param w 幅
 * @param h 高さ
 * @param lit 灯るか
 * @param seed 灯る窓を決める種
 * @sideEffect canvas に描く
 */
function paintWindows(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit: boolean, seed: number): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ（paintChunk でまとめてログ）
  let k = seed;
  for (let wy = y + 4; wy <= y + h - 4; wy += 4) {
    for (let wx = x + 2; wx <= x + w - 4; wx += 4) {
      k = (k * 1103515245 + 12345) & 0x7fffffff;
      ctx.fillStyle = lit && k % 3 === 0 ? LAMP_LIGHT : 'rgba(255, 255, 255, 0.75)';
      ctx.fillRect(wx, wy, 2, 2);
    }
  }
}

/**
 * 高架の線路（東西の帯。縁と2本のレールだけ）を重ねる。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param c0 チャンクの左上の列
 * @param r0 チャンクの左上の行
 * @sideEffect canvas に描く
 */
function paintViaduct(ctx: CanvasRenderingContext2D, grid: TownGrid, c0: number, r0: number): void { // audit-ignore: fnlog-missing チャンクごとに呼ぶ（paintChunk でまとめてログ）
  for (let r = 0; r < CHUNK_CELLS; r++) {
    const row = r0 + r;
    if (row < 0 || row >= grid.rows) continue;
    const first = (grid.overlay[row * grid.cols + Math.max(0, Math.min(grid.cols - 1, c0))] ?? 0) & OVERLAY_VIADUCT;
    if (first === 0) continue;
    const above = row > 0 && ((grid.overlay[(row - 1) * grid.cols + Math.max(0, c0)] ?? 0) & OVERLAY_VIADUCT) !== 0;
    const below = row < grid.rows - 1 && ((grid.overlay[(row + 1) * grid.cols + Math.max(0, c0)] ?? 0) & OVERLAY_VIADUCT) !== 0;
    const y = r * CELL_PX;
    ctx.fillStyle = VIADUCT_FILL;
    ctx.fillRect(0, y, CHUNK_PX, CELL_PX);
    ctx.fillStyle = VIADUCT_EDGE;
    if (!above) ctx.fillRect(0, y, CHUNK_PX, 1);
    if (!below) ctx.fillRect(0, y + CELL_PX - 1, CHUNK_PX, 1);
    if (above && below) {
      ctx.fillStyle = VIADUCT_RAIL;
      ctx.fillRect(0, y + 2, CHUNK_PX, 1);
      ctx.fillRect(0, y + 5, CHUNK_PX, 1);
    }
  }
}

/**
 * ライバルの陣地の色づけと、色あせを重ねる（セルごとの半透明の四角）。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param state 成長・色あせ・陣地
 * @param c0 チャンクの左上の列
 * @param r0 チャンクの左上の行
 * @sideEffect canvas に描く
 */
function paintTints(ctx: CanvasRenderingContext2D, grid: TownGrid, state: TownPaintState, c0: number, r0: number): void { // audit-ignore: fnlog-missing チャンクごとに呼ぶ（paintChunk でまとめてログ）
  for (let r = 0; r < CHUNK_CELLS; r++) {
    const row = r0 + r;
    if (row < 0 || row >= grid.rows) continue;
    for (let c = 0; c < CHUNK_CELLS; c++) {
      const col = c0 + c;
      if (col < 0 || col >= grid.cols) continue;
      const i = row * grid.cols + col;
      if (state.territory[i] === TERRITORY_RIVAL) {
        ctx.fillStyle = `rgba(${RIVAL_TINT.r},${RIVAL_TINT.g},${RIVAL_TINT.b},${RIVAL_TINT.a})`;
        ctx.fillRect(c * CELL_PX, r * CELL_PX, CELL_PX, CELL_PX);
      }
      const fade = state.fades[grid.district[i] ?? 0] ?? 0;
      if (fade > 0) {
        ctx.fillStyle = `rgba(${FADE_TINT.r},${FADE_TINT.g},${FADE_TINT.b},${Math.min(1, fade) * FADE_TINT.a})`;
        ctx.fillRect(c * CELL_PX, r * CELL_PX, CELL_PX, CELL_PX);
      }
    }
  }
}

/**
 * '#rrggbb' を RGB にする。
 * @param hex 色
 * @returns RGB
 */
function rgbOf(hex: string): { r: number; g: number; b: number } { // audit-ignore: fnlog-missing 全体図を作るときに色ごとに呼ぶ純粋な変換ヘルパー
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * 全体図（広域用。1セル=OVERVIEW_PX_PER_CELL ドット）の画素を作る。建物・木は陣地に合わせて色づけ、色あせも重ねる。
 * @param grid 街
 * @param state 成長・色あせ・陣地
 * @returns RGBA の画素（幅 cols*k、高さ rows*k）
 */
export function paintOverview(grid: TownGrid, state: TownPaintState): Uint8ClampedArray {
  const log = logger.fn('paintOverview', { cols: grid.cols, rows: grid.rows });
  const k = OVERVIEW_PX_PER_CELL;
  const width = grid.cols * k;
  const out = new Uint8ClampedArray(width * grid.rows * k * 4);
  const ground = new Map<number, { r: number; g: number; b: number }>();
  for (const [kind, hex] of Object.entries(GROUND)) ground.set(Number(kind), rgbOf(hex));
  const vivid = VIVID_BUILDING_COLORS.map(rgbOf);
  const dormant = rgbOf(DORMANT_BUILDING);
  const rival = rgbOf(RIVAL_BUILDING);
  const mineGround = rgbOf(MINE_GROUND);
  const tree = rgbOf(TREE.light);
  const treeDormant = rgbOf(TREE_DORMANT.light);
  const viaduct = rgbOf(VIADUCT_FILL);
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const i = row * grid.cols + col;
      const kind = grid.kinds[i] ?? Cell.GRASS;
      const owner = state.territory[i] ?? 0;
      const b = grid.buildingAt[i] ?? -1;
      let rgb: { r: number; g: number; b: number };
      if (b >= 0) rgb = owner === TERRITORY_MINE ? (vivid[grid.buildings[b]?.roof ?? 7] ?? dormant) : owner === TERRITORY_RIVAL ? rival : dormant;
      else if (kind === Cell.TREE || kind === Cell.SAKURA) rgb = owner === TERRITORY_MINE ? tree : treeDormant;
      else if (owner === TERRITORY_MINE && kind === Cell.GRASS) rgb = mineGround;
      else rgb = ground.get(kind) ?? viaduct;
      if (((grid.overlay[i] ?? 0) & OVERLAY_VIADUCT) !== 0) rgb = viaduct;
      let { r, g, b: bl } = rgb;
      const fade = Math.min(1, state.fades[grid.district[i] ?? 0] ?? 0) * FADE_TINT.a;
      if (fade > 0) {
        r += (FADE_TINT.r - r) * fade;
        g += (FADE_TINT.g - g) * fade;
        bl += (FADE_TINT.b - bl) * fade;
      }
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const o = ((row * k + dy) * width + col * k + dx) * 4;
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = bl;
          out[o + 3] = 255;
        }
      }
    }
  }
  return log.exit(out);
}
