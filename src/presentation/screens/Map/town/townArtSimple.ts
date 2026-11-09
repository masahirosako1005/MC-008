/**
 * @file 街の地面を「簡易表示」で描く（presentation/screens/Map/town 層）
 * 2026-11-09 ユーザー指示「街のオブジェクトが多すぎて大変。お店以外は簡易オブジェクトに」。
 * 建物は窓・看板・小物を描かず、淡い色の四角（下に1ドットの影）だけ。木は丸い点、道は白い帯、川は水色の面。
 * 提灯・旗・花壇・駐輪場などの飾りは描かない。主役（お店・名所・トイレのドット絵）は townScene が上に重ねる。
 * townArt（細かいドット絵版）と同じ形の API（paintChunk・paintOverview）なので、townRenderer はどちらでも描ける。
 */
import { createLogger } from '@/Common/logging/logger';
import { CELL_PX, CHUNK_CELLS, CHUNK_PX, Cell, OVERLAY_VIADUCT, OVERVIEW_PX_PER_CELL, TERRITORY_MINE, TERRITORY_RIVAL, isStreet } from '@/presentation/screens/Map/town/townTypes';
import type { TownGrid, TownPaintState } from '@/presentation/screens/Map/town/townTypes';

const logger = createLogger('presentation/screens/Map/town/townArtSimple');

/** 建物の淡い色（TownBuilding.roof の 0..7 に対応。赤・橙・青緑・青・紫・こげ茶・瓦・灰を淡くしたもの） */
export const SIMPLE_BUILDING_COLORS: readonly string[] = ['#f2d3cd', '#f5dfc6', '#cfe6e1', '#d3dff0', '#e0d7ef', '#e5d9cc', '#d6dbe4', '#e4e6eb'];
/** 建物の影（下の1ドット） */
const BUILDING_SHADOW = '#c9c3b8';

/** セルの種類ごとの地面の色 */
const GROUND: Readonly<Record<number, string>> = {
  [Cell.GRASS]: '#f4f0e7',
  [Cell.ROAD]: '#ffffff',
  [Cell.AVENUE]: '#ffffff',
  [Cell.ARCADE]: '#fde8d2',
  [Cell.ALLEY]: '#fbf9f4',
  [Cell.PATH]: '#efe6d2',
  [Cell.PLAZA]: '#ece7dc',
  [Cell.BRIDGE]: '#e9e7e2',
  [Cell.WATER]: '#a9d9f0',
  [Cell.BANK]: '#d3e6ec',
  [Cell.PARK]: '#d6ecc6',
  [Cell.POND]: '#a9d9f0',
  [Cell.BUILDING]: '#f4f0e7',
  [Cell.LOT]: '#f8f5ee',
  [Cell.TREE]: '#f4f0e7',
  [Cell.SAKURA]: '#f4f0e7',
  [Cell.GARDEN]: '#f4f0e7',
  [Cell.PARKING]: '#f4f0e7',
  [Cell.PLAYGROUND]: '#d6ecc6',
};
/** 道の縁（道でないセルとの境） */
const STREET_EDGE = '#dcd6ca';
/** 大通りの面（ふつうの道と見分けるため、ほんの少し黄色に） */
const AVENUE_TINT = '#fffaea';
/** 木の色（明るい・暗い） */
const TREE_LIGHT = '#a8d596';
const TREE_DARK = '#8cc47a';
/** 桜の色 */
const SAKURA_LIGHT = '#f8cdda';
const SAKURA_DARK = '#efb3c6';
/** 高架の色（桁・縁・レール） */
const VIADUCT_FILL = '#dadde4';
const VIADUCT_EDGE = '#c2c6d0';
const VIADUCT_RAIL = '#b3b8c3';
/** 陣地を重ねる色と濃さ */
const MINE_TINT = { r: 255, g: 106, b: 61, a: 0.2 };
const RIVAL_TINT = { r: 123, g: 97, b: 255, a: 0.16 };
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
 * 1チャンクを簡易表示で描く（地面 → 道の縁 → 木 → 建物 → 高架 → 陣地 → 色あせ）。
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
  ctx.fillStyle = GROUND[Cell.GRASS] ?? '#f4f0e7';
  ctx.fillRect(0, 0, CHUNK_PX, CHUNK_PX);
  const buildings = new Set<number>();
  for (let r = 0; r < CHUNK_CELLS; r++) {
    for (let c = 0; c < CHUNK_CELLS; c++) {
      const col = c0 + c;
      const row = r0 + r;
      const kind = kindAt(grid, col, row);
      paintCell(ctx, grid, kind, col, row, c * CELL_PX, r * CELL_PX);
      const b = col < grid.cols && row < grid.rows && col >= 0 && row >= 0 ? (grid.buildingAt[row * grid.cols + col] ?? -1) : -1;
      if (b >= 0) buildings.add(b);
    }
  }
  for (const b of buildings) paintBuilding(ctx, grid, b, c0, r0);
  paintViaduct(ctx, grid, c0, r0);
  paintTints(ctx, grid, state, c0, r0);
  log.exit(undefined, `建物 ${buildings.size}`);
}

/**
 * 1セルの地面（と道の縁・大通りの中央線・木）を描く。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param kind セルの種類
 * @param col 列
 * @param row 行
 * @param x チャンク内の左（ドット）
 * @param y チャンク内の上（ドット）
 * @sideEffect canvas に描く
 */
function paintCell(ctx: CanvasRenderingContext2D, grid: TownGrid, kind: number, col: number, row: number, x: number, y: number): void { // audit-ignore: fnlog-missing チャンクを描くときにセルごとに呼ぶ（paintChunk でまとめてログ）
  if (kind !== Cell.GRASS && kind !== Cell.BUILDING) {
    ctx.fillStyle = GROUND[kind] ?? '#f4f0e7';
    ctx.fillRect(x, y, CELL_PX, CELL_PX);
  }
  if (isStreet(kind)) {
    paintStreetEdges(ctx, grid, kind, col, row, x, y);
    return;
  }
  if (kind === Cell.TREE || kind === Cell.SAKURA) paintTree(ctx, x, y, kind === Cell.SAKURA);
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
 * @param sakura 桜なら true
 * @sideEffect canvas に描く
 */
function paintTree(ctx: CanvasRenderingContext2D, x: number, y: number, sakura: boolean): void { // audit-ignore: fnlog-missing セルごとに呼ぶ（paintChunk でまとめてログ）
  ctx.fillStyle = sakura ? SAKURA_DARK : TREE_DARK;
  ctx.fillRect(x + 2, y + 2, 4, 5);
  ctx.fillRect(x + 1, y + 3, 6, 3);
  ctx.fillStyle = sakura ? SAKURA_LIGHT : TREE_LIGHT;
  ctx.fillRect(x + 2, y + 1, 4, 4);
  ctx.fillRect(x + 1, y + 2, 6, 2);
}

/**
 * 建物を淡い色の四角で描く（隣の建物と1ドット空け、下に1ドットの影）。チャンクからはみ出す分は切れる。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param index 建物の添字
 * @param c0 チャンクの左上の列
 * @param r0 チャンクの左上の行
 * @sideEffect canvas に描く
 */
function paintBuilding(ctx: CanvasRenderingContext2D, grid: TownGrid, index: number, c0: number, r0: number): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ（paintChunk でまとめてログ）
  const b = grid.buildings[index];
  if (b === undefined) return;
  const x = (b.col - c0) * CELL_PX + 1;
  const y = (b.row - r0) * CELL_PX + 1;
  const w = b.w * CELL_PX - 2;
  const h = b.h * CELL_PX - 2;
  ctx.fillStyle = BUILDING_SHADOW;
  ctx.fillRect(x, y + 1, w, h);
  ctx.fillStyle = b.style === 'station' ? '#d9dce3' : (SIMPLE_BUILDING_COLORS[b.roof] ?? '#e4e6eb');
  ctx.fillRect(x, y, w, h - 1);
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
 * 陣地と色あせを重ねる（セルごとの半透明の四角）。
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
      const owner = state.territory[i];
      const tint = owner === TERRITORY_MINE ? MINE_TINT : owner === TERRITORY_RIVAL ? RIVAL_TINT : undefined;
      if (tint !== undefined) {
        ctx.fillStyle = `rgba(${tint.r},${tint.g},${tint.b},${tint.a})`;
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
 * 全体図（広域用。1セル=OVERVIEW_PX_PER_CELL ドット）の画素を作る。建物は淡い色、木は緑、陣地と色あせも重ねる。
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
  const buildingRgb = SIMPLE_BUILDING_COLORS.map(rgbOf);
  const tree = rgbOf(TREE_LIGHT);
  const sakura = rgbOf(SAKURA_LIGHT);
  const viaduct = rgbOf(VIADUCT_FILL);
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const i = row * grid.cols + col;
      const kind = grid.kinds[i] ?? Cell.GRASS;
      const b = grid.buildingAt[i] ?? -1;
      let rgb = b >= 0 ? (buildingRgb[grid.buildings[b]?.roof ?? 7] ?? viaduct) : kind === Cell.TREE ? tree : kind === Cell.SAKURA ? sakura : (ground.get(kind) ?? viaduct);
      if (((grid.overlay[i] ?? 0) & OVERLAY_VIADUCT) !== 0) rgb = viaduct;
      const owner = state.territory[i];
      const tint = owner === TERRITORY_MINE ? MINE_TINT : owner === TERRITORY_RIVAL ? RIVAL_TINT : undefined;
      let { r, g, b: bl } = rgb;
      if (tint !== undefined) {
        r += (tint.r - r) * tint.a;
        g += (tint.g - g) * tint.a;
        bl += (tint.b - bl) * tint.a;
      }
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
