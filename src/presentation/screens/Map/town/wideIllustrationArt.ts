/**
 * @file 広域のイラストの街の絵（presentation/screens/Map/town 層）
 * 2026-11-10 ユーザー指示「広域表示のときのグレー部分の背景が殺風景なので、イラストなどを用いて楽しそうな町に」
 * 「街の表示がシステム表示みたい。旅をしているときの温かみある表示に」。
 * 手描き風の観光マップのように、クリーム色の紙の地・青い川・もこもこの木・小さなかわいい家を描く（タイルの焼き込み＝paintTile）。
 * にぎわい（提灯・のぼり・花・煙・風船・花火）と廃れ（シャッター・枯れ木・雑草・屋根のひび・雨雲・カラス）、
 * 空の雲・鳥・小舟・電車は、毎フレーム画面の座標で小さく描く（draw*）。絵の部品の色はこのファイルの色表（CLAUDE.md MUST 12）。
 * 乱数は使わずセルの番号のハッシュで決める。座標はログに出さない。
 */
import { createLogger } from '@/Common/logging/logger';
import { hash01 } from '@/presentation/screens/Map/town/townGenerator';
import { Cell } from '@/presentation/screens/Map/town/townTypes';
import type { TownBuilding, TownGrid, TownTheme } from '@/presentation/screens/Map/town/townTypes';
import type { CellPoint, HouseSlot } from '@/presentation/screens/Map/town/wideIllustrationModel';

const logger = createLogger('presentation/screens/Map/town/wideIllustrationArt');

/** 紙の地の色・しみ */
export const PAPER = '#f7eedc';
const PAPER_SPECK = 'rgba(176, 140, 96, 0.13)';
const PAPER_FIBER = 'rgba(255, 255, 255, 0.55)';
/** 土地の色（セルの種類ごと。広域では細い道・路地・空き地は紙のまま＝大通り・商店街・川・公園だけを描く） */
const GROUND_COLORS: Readonly<Partial<Record<number, string>>> = {
  [Cell.WATER]: '#a7d6df',
  [Cell.POND]: '#a7d6df',
  [Cell.BANK]: '#eadbb6',
  [Cell.PARK]: '#d3e8b6',
  [Cell.PLAYGROUND]: '#d3e8b6',
  [Cell.PLAZA]: '#f0e2c4',
  [Cell.ARCADE]: '#f6d6a8',
  [Cell.AVENUE]: '#ecd5a6',
  [Cell.BRIDGE]: '#d2a878',
  [Cell.PATH]: '#ecdcb6',
};
/** 川の縁・さざ波 */
const WATER_RIM = '#86bfcd';
const WATER_WAVE = 'rgba(255, 255, 255, 0.75)';
/** 木（ふつう・桜）の色：影・葉・つや */
const TREE_COLORS = { shade: '#6fa564', leaf: '#8fc479', shine: '#b9de9c' };
const SAKURA_COLORS = { shade: '#e09ab0', leaf: '#f4bccb', shine: '#fde0e7' };
/** 家の影・線 */
const HOUSE_SHADOW = 'rgba(112, 78, 48, 0.18)';
const HOUSE_LINE = 'rgba(96, 64, 40, 0.5)';
const WINDOW = '#cfe4ea';
const DOOR = '#a2774f';
/** テーマごとの屋根の色（TownBuilding.roof の 0..7） */
const ROOFS: Readonly<Record<TownTheme, readonly string[]>> = {
  monzen: ['#6f7b8e', '#5d697c', '#8b6f5b', '#c9563e', '#7c8896', '#56627a', '#a5573a', '#6c8174'],
  market: ['#e0623f', '#f0a33a', '#d6473d', '#3f8fb0', '#e9b94a', '#c86d3b', '#7aa35a', '#d97d5f'],
  living: ['#d97b64', '#e4a96b', '#7fb1a3', '#7c9dc9', '#a78dc9', '#b98e6e', '#8e9eb6', '#caa56c'],
  alley: ['#b6664b', '#d58b5a', '#5f9b86', '#7090bf', '#9c80b8', '#8d6b51', '#7b8b9f', '#c18b6b'],
  river: ['#e48ba1', '#f0b58b', '#7ab9c5', '#89a9de', '#baa1e0', '#caa47d', '#9ba9c1', '#e1b1b9'],
  city: ['#e3b4a3', '#e8c9a4', '#b2d2c6', '#b6c7de', '#cdbfdd', '#d5bca3', '#c0c8d5', '#dccfb9'],
};
/** テーマごとの壁の色 */
const WALLS: Readonly<Record<TownTheme, string>> = { monzen: '#f5ebd8', market: '#fff3e0', living: '#fcf2e4', alley: '#f7e9d9', river: '#fdf4ea', city: '#f8f2e8' };
/** 平屋根の建物（マンション・事務所）の屋上 */
const FLAT_TOP = '#ece4d6';
/** 高架の色 */
const RAIL = { bed: '#cdb99c', edge: '#a8916f', tie: '#8d7658', steel: '#6d6a6a' };
/** 絵の家の大きさ（セル）。様式ごと（幅・高さ） */
const SLOT_SIZE: Readonly<Record<string, readonly [number, number]>> = {
  house: [7, 6],
  kawaraHouse: [8, 6],
  nagaya: [10, 5.5],
  shophouse: [8, 6],
  stall: [7, 5],
  cafe: [7, 6],
  apartment: [7, 8],
  mansion: [7, 10],
  office: [6.5, 11],
  warehouse: [9, 6],
  station: [12, 6],
};
/** にぎわいの飾りの色 */
const FESTIVE = ['#e0523c', '#f0a43a', '#3f86b8', '#d64d86', '#5aa36a'];
const LANTERN = '#e4472f';
const LANTERN_GLOW = 'rgba(255, 196, 92, 0.35)';
const FLOWER = ['#ff8fab', '#ffd166', '#ff7a59', '#b892ff', '#ffffff'];
/** 廃れの飾りの色 */
const SHUTTER = '#a7a29a';
const SHUTTER_LINE = 'rgba(90, 84, 76, 0.55)';
const DEAD_TREE = { leaf: '#b3a58c', branch: '#6e5a45' };
const WEED = '#8a8b55';
const CRACK = 'rgba(60, 46, 36, 0.75)';
const STORM = { dark: '#77716b', mid: '#8f8981', light: '#a8a198', rain: 'rgba(110, 130, 150, 0.75)' };
const CROW = '#2a2522';
/** 空の色 */
const CLOUD = { body: 'rgba(255, 255, 255, 0.92)', shade: 'rgba(214, 222, 232, 0.9)', shadow: 'rgba(90, 70, 50, 0.07)' };
const BIRD = 'rgba(70, 60, 55, 0.8)';
/** 小舟・電車 */
const BOAT = { hull: '#9a6b45', roof: '#e0623f', cabin: '#fff3e0', wake: 'rgba(255, 255, 255, 0.8)' };
const TRAIN = { body: '#f4e7cf', stripe: '#bc5b1b', window: '#8fb6c6', edge: 'rgba(80, 60, 40, 0.6)' };

/** タイルを焼くときに使う街の材料 */
export interface TileScene {
  readonly grid: TownGrid;
  /** 絵の家・木の場所の箱（wideIllustrationModel.bucketSlots） */
  readonly slots: ReadonlyMap<string, readonly HouseSlot[]>;
  /** 箱の一辺（セル） */
  readonly bucketCells: number;
  /** 地区の多角形（セル座標）と色 */
  readonly districts: readonly { readonly cells: readonly CellPoint[]; readonly color: string }[];
  /** 高架の線（無ければ undefined） */
  readonly viaduct?: { readonly row: number; readonly col0: number; readonly col1: number; readonly station?: { readonly col0: number; readonly col1: number } };
  /** 駅舎（無ければ undefined） */
  readonly station?: TownBuilding;
}

/**
 * タイル1枚を焼く（紙の地 → 土地 → 川の縁とさざ波 → 地区のうっすらした色 → 高架 → 木 → 家）。
 * @param ctx タイルの 2D コンテキスト（大きさ tilePx 四方）
 * @param scene 街の材料
 * @param cellPx 1セルの px
 * @param tx タイルの列
 * @param ty タイルの行
 * @param tilePx タイルの一辺（px）
 * @sideEffect ctx に描く
 */
export function paintTile(ctx: CanvasRenderingContext2D, scene: TileScene, cellPx: number, tx: number, ty: number, tilePx: number): void {
  const log = logger.fn('paintTile', { cellPx, tx, ty });
  const grid = scene.grid;
  const L = cellPx;
  const range = {
    c0: Math.max(0, Math.floor((tx * tilePx) / L) - 2),
    r0: Math.max(0, Math.floor((ty * tilePx) / L) - 2),
    c1: Math.min(grid.cols, Math.ceil(((tx + 1) * tilePx) / L) + 2),
    r1: Math.min(grid.rows, Math.ceil(((ty + 1) * tilePx) / L) + 2),
  };
  ctx.setTransform(1, 0, 0, 1, -tx * tilePx, -ty * tilePx);
  ctx.fillStyle = PAPER;
  ctx.fillRect(tx * tilePx, ty * tilePx, tilePx, tilePx);
  paintPaperGrain(ctx, range, L);
  paintGround(ctx, grid, range, L);
  paintWater(ctx, grid, range, L);
  for (const d of scene.districts) paintDistrictTint(ctx, d.cells, d.color, L);
  if (scene.viaduct !== undefined) paintViaduct(ctx, scene.viaduct, L);
  paintTrees(ctx, grid, range, L);
  paintHouses(ctx, scene, range, L);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  log.exit(undefined);
}

/** タイルで描くセルの範囲 */
interface CellRange {
  readonly c0: number;
  readonly r0: number;
  readonly c1: number;
  readonly r1: number;
}

/**
 * 紙のしみと繊維（うっすらした紙の質感）。
 * @param ctx 2D コンテキスト
 * @param range セルの範囲
 * @param L 1セルの px
 * @sideEffect ctx に描く
 */
function paintPaperGrain(ctx: CanvasRenderingContext2D, range: CellRange, L: number): void { // audit-ignore: fnlog-missing タイルごとに呼ぶ（paintTile でまとめてログ）
  const size = Math.max(0.8, L * 0.42);
  ctx.fillStyle = PAPER_SPECK;
  for (let r = range.r0 - (range.r0 % 2); r < range.r1; r += 2) {
    for (let c = range.c0 - (range.c0 % 2); c < range.c1; c += 2) {
      if (hash01(c, r, 7) < 0.1) ctx.fillRect(c * L + hash01(c, r, 8) * L, r * L + hash01(c, r, 9) * L, size, size);
    }
  }
  ctx.fillStyle = PAPER_FIBER;
  for (let r = range.r0 - (range.r0 % 6); r < range.r1; r += 6) {
    for (let c = range.c0 - (range.c0 % 6); c < range.c1; c += 6) {
      if (hash01(c, r, 10) < 0.25) ctx.fillRect(c * L, r * L + hash01(c, r, 11) * 4 * L, 3 * L, Math.max(0.6, L * 0.2));
    }
  }
}

/**
 * 土地の色（川・公園・広場・道）を行ごとの連続した区間でまとめて塗る。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param range セルの範囲
 * @param L 1セルの px
 * @sideEffect ctx に描く
 */
function paintGround(ctx: CanvasRenderingContext2D, grid: TownGrid, range: CellRange, L: number): void { // audit-ignore: fnlog-missing タイルごとに呼ぶ（paintTile でまとめてログ）
  for (let r = range.r0; r < range.r1; r++) {
    let start = range.c0;
    let color = GROUND_COLORS[grid.kinds[r * grid.cols + range.c0] ?? -1];
    for (let c = range.c0 + 1; c <= range.c1; c++) {
      const next = c < range.c1 ? GROUND_COLORS[grid.kinds[r * grid.cols + c] ?? -1] : undefined;
      if (next === color && c < range.c1) continue;
      if (color !== undefined) {
        ctx.fillStyle = color;
        ctx.fillRect(start * L, r * L, (c - start) * L + 0.4, L + 0.4);
      }
      start = c;
      color = next;
    }
  }
}

/**
 * 川の縁をもこもこの丸で柔らかくし、さざ波の線を描く（手描きの川に見えるように）。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param range セルの範囲
 * @param L 1セルの px
 * @sideEffect ctx に描く
 */
function paintWater(ctx: CanvasRenderingContext2D, grid: TownGrid, range: CellRange, L: number): void { // audit-ignore: fnlog-missing タイルごとに呼ぶ（paintTile でまとめてログ）
  /**
   * そのセルが水（川・池）か。
   * @param c 列
   * @param r 行
   * @returns 水なら true
   */
  const isWater = (c: number, r: number): boolean => { // audit-ignore: fnlog-missing セルごとの判定
    const k = grid.kinds[r * grid.cols + c];
    return k === Cell.WATER || k === Cell.POND;
  };
  const rim = new Path2D();
  const fill = new Path2D();
  for (let r = Math.max(1, range.r0); r < Math.min(grid.rows - 1, range.r1); r++) {
    for (let c = Math.max(1, range.c0); c < Math.min(grid.cols - 1, range.c1); c++) {
      if (!isWater(c, r)) continue;
      if (isWater(c - 1, r) && isWater(c + 1, r) && isWater(c, r - 1) && isWater(c, r + 1)) continue;
      const x = (c + 0.5) * L;
      const y = (r + 0.5) * L;
      rim.moveTo(x + L * 1.05, y);
      rim.arc(x, y, L * 1.05, 0, Math.PI * 2);
      fill.moveTo(x + L * 0.78, y);
      fill.arc(x, y, L * 0.78, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = WATER_RIM;
  ctx.fill(rim);
  ctx.fillStyle = GROUND_COLORS[Cell.WATER] ?? PAPER;
  ctx.fill(fill);
  // 縁の外へはみ出した濃い色を、水の面で上から塗り直す（内側の縁だけ残す）
  for (let r = range.r0; r < range.r1; r++) {
    for (let c = range.c0; c < range.c1; c++) {
      if (isWater(c, r) && c > 0 && r > 0 && c < grid.cols - 1 && r < grid.rows - 1 && isWater(c - 1, r) && isWater(c + 1, r) && isWater(c, r - 1) && isWater(c, r + 1)) ctx.fillRect(c * L, r * L, L + 0.4, L + 0.4);
    }
  }
  paintWaves(ctx, range, L, isWater);
}

/**
 * 川のさざ波の線を描く。
 * @param ctx 2D コンテキスト
 * @param range セルの範囲
 * @param L 1セルの px
 * @param isWater そのセルが水か
 * @sideEffect ctx に描く
 */
function paintWaves(ctx: CanvasRenderingContext2D, range: CellRange, L: number, isWater: (c: number, r: number) => boolean): void { // audit-ignore: fnlog-missing タイルごとに呼ぶ（paintTile でまとめてログ）
  ctx.strokeStyle = WATER_WAVE;
  ctx.lineWidth = Math.max(0.7, L * 0.3);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let r = range.r0 - (range.r0 % 5); r < range.r1; r += 5) {
    for (let c = range.c0 - (range.c0 % 5); c < range.c1; c += 5) {
      if (c < 1 || r < 1 || !isWater(c, r) || hash01(c, r, 21) > 0.4) continue;
      const x = (c + hash01(c, r, 22) * 3) * L;
      const y = (r + hash01(c, r, 23) * 3) * L;
      ctx.moveTo(x - L * 1.1, y);
      ctx.quadraticCurveTo(x - L * 0.55, y + L * 0.7, x, y);
      ctx.quadraticCurveTo(x + L * 0.55, y + L * 0.7, x + L * 1.1, y);
    }
  }
  ctx.stroke();
}

/**
 * 地区の中をうっすら地区の色にする。
 * @param ctx 2D コンテキスト
 * @param cells 地区の多角形（セル座標）
 * @param color 地区の色
 * @param L 1セルの px
 * @sideEffect ctx に描く
 */
function paintDistrictTint(ctx: CanvasRenderingContext2D, cells: readonly CellPoint[], color: string, L: number): void { // audit-ignore: fnlog-missing タイルごとに呼ぶ（paintTile でまとめてログ）
  if (cells.length < 3) return;
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = color;
  ctx.beginPath();
  cells.forEach((p, k) => (k === 0 ? ctx.moveTo(p.col * L, p.row * L) : ctx.lineTo(p.col * L, p.row * L)));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 高架の線路（砂色の帯・2本のレール・枕木）と駅のホームを描く。
 * @param ctx 2D コンテキスト
 * @param v 高架の線
 * @param L 1セルの px
 * @sideEffect ctx に描く
 */
function paintViaduct(ctx: CanvasRenderingContext2D, v: NonNullable<TileScene['viaduct']>, L: number): void { // audit-ignore: fnlog-missing タイルごとに呼ぶ（paintTile でまとめてログ）
  const y = v.row * L;
  const half = Math.max(1.6, L * 1.3);
  ctx.fillStyle = RAIL.edge;
  ctx.fillRect(v.col0 * L, y - half - L * 0.25, (v.col1 - v.col0) * L, half * 2 + L * 0.5);
  ctx.fillStyle = RAIL.bed;
  ctx.fillRect(v.col0 * L, y - half, (v.col1 - v.col0) * L, half * 2);
  if (v.station !== undefined) {
    ctx.fillStyle = '#e9d9bd';
    ctx.fillRect(v.station.col0 * L, y - half * 1.6, (v.station.col1 - v.station.col0) * L, half * 3.2);
    ctx.fillStyle = '#c9563e';
    ctx.fillRect(v.station.col0 * L, y - half * 1.6, (v.station.col1 - v.station.col0) * L, Math.max(1, L * 0.55));
  }
  ctx.fillStyle = RAIL.tie;
  const step = Math.max(2.2, L * 1.4);
  for (let x = v.col0 * L; x < v.col1 * L; x += step) ctx.fillRect(x, y - half * 0.75, Math.max(0.7, L * 0.35), half * 1.5);
  ctx.fillStyle = RAIL.steel;
  ctx.fillRect(v.col0 * L, y - half * 0.45, (v.col1 - v.col0) * L, Math.max(0.6, L * 0.22));
  ctx.fillRect(v.col0 * L, y + half * 0.3, (v.col1 - v.col0) * L, Math.max(0.6, L * 0.22));
}

/**
 * セルの種類を返す（範囲外は -1）。
 * @param grid 街
 * @param c 列
 * @param r 行
 * @returns 種類
 */
function cellKindAt(grid: TownGrid, c: number, r: number): number { // audit-ignore: fnlog-missing セルごとの参照
  return c < 0 || r < 0 || c >= grid.cols || r >= grid.rows ? -1 : (grid.kinds[r * grid.cols + c] ?? -1);
}

/**
 * 木か公園か（木立のつながりを見るため）。
 * @param k 種類
 * @returns 緑なら true
 */
function isGreenCell(k: number): boolean { // audit-ignore: fnlog-missing セルごとの判定
  return k === Cell.TREE || k === Cell.SAKURA || k === Cell.PARK || k === Cell.PLAYGROUND;
}

/**
 * 川・池のそばの木か（川沿いの並木だけを残すため。上下左右 3 セル以内に水か護岸）。
 * @param grid 街
 * @param c 列
 * @param r 行
 * @returns そばなら true
 */
function isNearWater(grid: TownGrid, c: number, r: number): boolean { // audit-ignore: fnlog-missing セルごとの判定
  for (let d = 1; d <= 3; d++) {
    for (const k of [cellKindAt(grid, c + d, r), cellKindAt(grid, c - d, r), cellKindAt(grid, c, r + d), cellKindAt(grid, c, r - d)]) if (k === Cell.WATER || k === Cell.BANK || k === Cell.POND) return true;
  }
  return false;
}

/**
 * 大きな公園の中か（街なかの小さな公園は、引くと粒に見えるので木を描かない。上下左右 6 セル先も緑）。
 * @param grid 街
 * @param c 列
 * @param r 行
 * @returns 大きな公園の中なら true
 */
function isDeepInPark(grid: TownGrid, c: number, r: number): boolean { // audit-ignore: fnlog-missing セルごとの判定
  return isGreenCell(cellKindAt(grid, c + 6, r)) && isGreenCell(cellKindAt(grid, c - 6, r)) && isGreenCell(cellKindAt(grid, c, r + 6)) && isGreenCell(cellKindAt(grid, c, r - 6));
}

/**
 * 木を「木立」にまとめて、もこもこの丸で描く（川沿いの並木と、大きな公園の中だけ）。
 * 2026-11-10 ユーザー指示「木がぶつぶつに見えて気持ち悪い」: 街なかの木・小さな公園の木は描かず、
 * 5セル四方ごとに、川沿いの木を1つの大きめの丸にまとめる（隣の丸と重なって、ひと続きの並木に見える）。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param range セルの範囲
 * @param L 1セルの px
 * @sideEffect ctx に描く
 */
function paintTrees(ctx: CanvasRenderingContext2D, grid: TownGrid, range: CellRange, L: number): void { // audit-ignore: fnlog-missing タイルごとに呼ぶ（paintTile でまとめてログ）
  const normal: { x: number; y: number; s: number }[] = [];
  const sakura: { x: number; y: number; s: number }[] = [];
  const step = 5;
  for (let r = range.r0 - (range.r0 % step) - step; r < range.r1 + step; r += step) {
    for (let c = range.c0 - (range.c0 % step) - step; c < range.c1 + step; c += step) {
      let n = 0;
      let pink = 0;
      let park = 0;
      let sx = 0;
      let sy = 0;
      for (let dr = 0; dr < step; dr++) {
        for (let dc = 0; dc < step; dc++) {
          const k = cellKindAt(grid, c + dc, r + dr);
          if (k === Cell.PARK || k === Cell.PLAYGROUND) park++;
          if (k !== Cell.TREE && k !== Cell.SAKURA) continue;
          if (!isNearWater(grid, c + dc, r + dr)) continue;
          n++;
          if (k === Cell.SAKURA) pink++;
          sx += c + dc + 0.5;
          sy += r + dr + 0.5;
        }
      }
      if (n >= 2) (pink * 2 > n ? sakura : normal).push({ x: (sx / n) * L, y: (sy / n) * L, s: (2.1 + Math.min(n, 6) * 0.2 + hash01(c, r, 32) * 0.4) * L });
      else if (park >= step * step * 0.6 && isDeepInPark(grid, c + 2, r + 2) && hash01(c, r, 31) < 0.45) normal.push({ x: (c + 1 + hash01(c, r, 33) * 3) * L, y: (r + 1 + hash01(c, r, 34) * 3) * L, s: (2.2 + hash01(c, r, 32) * 0.7) * L });
    }
  }
  paintPuffs(ctx, normal, TREE_COLORS, L);
  paintPuffs(ctx, sakura, SAKURA_COLORS, L);
}

/**
 * もこもこの木の丸をまとめて描く（影 → 葉 → つや）。
 * @param ctx 2D コンテキスト
 * @param list 木（中心と半径）
 * @param colors 色
 * @param L 1セルの px
 * @sideEffect ctx に描く
 */
function paintPuffs(ctx: CanvasRenderingContext2D, list: readonly { x: number; y: number; s: number }[], colors: { shade: string; leaf: string; shine: string }, L: number): void { // audit-ignore: fnlog-missing タイルごとに呼ぶ（paintTile でまとめてログ）
  if (list.length === 0) return;
  ctx.fillStyle = HOUSE_SHADOW;
  ctx.beginPath();
  for (const p of list) {
    ctx.moveTo(p.x + p.s * 1.15, p.y + p.s * 0.75);
    ctx.ellipse(p.x + p.s * 0.25, p.y + p.s * 0.75, p.s * 0.9, p.s * 0.35, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = colors.shade;
  ctx.beginPath();
  for (const p of list) {
    ctx.moveTo(p.x + p.s, p.y + p.s * 0.15);
    ctx.arc(p.x, p.y + p.s * 0.15, p.s, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = colors.leaf;
  ctx.beginPath();
  for (const p of list) {
    ctx.moveTo(p.x + p.s * 0.86, p.y - p.s * 0.05);
    ctx.arc(p.x, p.y - p.s * 0.05, p.s * 0.86, 0, Math.PI * 2);
  }
  ctx.fill();
  if (L < 2) return;
  ctx.fillStyle = colors.shine;
  ctx.beginPath();
  for (const p of list) {
    ctx.moveTo(p.x - p.s * 0.05, p.y - p.s * 0.38);
    ctx.arc(p.x - p.s * 0.33, p.y - p.s * 0.38, p.s * 0.28, 0, Math.PI * 2);
  }
  ctx.fill();
}

/**
 * タイルにかかる絵の木を、奥（北）から手前（南）の順に描く。駅舎は本物の大きさで描く。
 * 手描き風の家のアイコンは描かない（2026-11-10 ユーザー指示「手書き風の家のアイコンは削除」）。drawSlotHouse は残してある。
 * @param ctx 2D コンテキスト
 * @param scene 街の材料
 * @param range セルの範囲
 * @param L 1セルの px
 * @sideEffect ctx に描く
 */
function paintHouses(ctx: CanvasRenderingContext2D, scene: TileScene, range: CellRange, L: number): void { // audit-ignore: fnlog-missing タイルごとに呼ぶ（paintTile でまとめてログ）
  const B = scene.bucketCells;
  const list: HouseSlot[] = [];
  for (let by = Math.floor((range.r0 - 14) / B); by <= Math.floor((range.r1 + 14) / B); by++) {
    for (let bx = Math.floor((range.c0 - 14) / B); bx <= Math.floor((range.c1 + 14) / B); bx++) {
      for (const s of scene.slots.get(`${bx},${by}`) ?? []) {
        if (s.col < range.c0 - 8 || s.col > range.c1 + 8 || s.row < range.r0 - 2 || s.row > range.r1 + 13) continue;
        list.push(s);
      }
    }
  }
  list.sort((a, b) => a.row - b.row || a.col - b.col);
  const station = scene.station;
  let stationDrawn = station === undefined;
  for (const s of list) {
    if (!stationDrawn && station !== undefined && s.row > station.row + station.h) {
      drawStation(ctx, station, L);
      stationDrawn = true;
    }
    // 街なかに散らした絵の木は描かない（2026-11-10 ユーザー指示「木がぶつぶつに見える」。木は paintTrees の木立だけ）
  }
  if (!stationDrawn && station !== undefined) drawStation(ctx, station, L);
}

/** 屋根の形の種類 */
type RoofShape = 'gable' | 'hip' | 'flat' | 'vault';

/**
 * 建物の様式から屋根の形を決める。
 * @param style 建物の様式
 * @param seed ばらつき
 * @returns 屋根の形
 */
function roofShapeOf(style: TownBuilding['style'], seed: number): RoofShape { // audit-ignore: fnlog-missing 建物ごとに呼ぶ純粋なヘルパー
  if (style === 'apartment' || style === 'mansion' || style === 'office') return 'flat';
  if (style === 'warehouse') return 'vault';
  if (style === 'kawaraHouse' || style === 'nagaya' || style === 'shophouse') return 'hip';
  return seed < 0.6 ? 'gable' : 'hip';
}

/**
 * 絵の家を1軒描く（足もとの影・正面の壁・屋根・窓・戸・お店のひさし）。
 * @param ctx 2D コンテキスト
 * @param s 置く場所（col,row が家の足もとの真ん中）
 * @param theme 地区のテーマ（屋根・壁の色）
 * @param L 1セルの px
 * @sideEffect ctx に描く
 */
export function drawSlotHouse(ctx: CanvasRenderingContext2D, s: HouseSlot, theme: TownTheme, L: number): void { // audit-ignore: fnlog-missing 家ごとに呼ぶ（paintTile でまとめてログ）
  const size = SLOT_SIZE[s.style] ?? [7, 6];
  const k = 0.9 + s.seed * 0.22;
  const w = size[0] * k * L;
  const h = size[1] * k * L;
  const x = s.col * L - w / 2;
  const base = s.row * L;
  const roof = ROOFS[theme][s.roof % 8] ?? '#d9a99a';
  const shape = roofShapeOf(s.style, s.seed);
  ctx.fillStyle = HOUSE_SHADOW;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.62, base + 0.2 * L, w * 0.6, Math.max(0.8, 1.1 * L), 0, 0, Math.PI * 2);
  ctx.fill();
  const wallH = shape === 'flat' ? h * 0.86 : h * 0.5;
  const wallTop = base - wallH;
  ctx.fillStyle = WALLS[theme];
  ctx.fillRect(x, wallTop, w, wallH);
  ctx.fillStyle = 'rgba(120, 90, 60, 0.12)';
  ctx.fillRect(x + w * 0.82, wallTop, w * 0.18, wallH);
  const ov = Math.max(0.4, 0.45 * L);
  ctx.fillStyle = roof;
  roofPath(ctx, shape, { x, w, h, base, wallTop, ov, L });
  ctx.fill();
  if (w >= 6) {
    ctx.strokeStyle = HOUSE_LINE;
    ctx.lineWidth = Math.max(0.5, L * 0.18);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.strokeRect(x, wallTop, w, wallH);
  }
  if (shape === 'flat' && w >= 6) {
    ctx.fillStyle = FLAT_TOP;
    ctx.fillRect(x + ov * 0.5, base - h + 0.3 * L, w - ov, Math.max(0.5, L * 0.3));
  }
  drawHouseFront(ctx, s, { x, y: wallTop, w, h: wallH }, roof, L);
}

/**
 * 屋根の形のパスを作る（塗りと縁取りに使う）。
 * @param ctx 2D コンテキスト
 * @param shape 屋根の形
 * @param g 家の左・幅・高さ・足もと・壁の上・軒の出・1セルの px
 * @sideEffect ctx のパスを作り直す
 */
function roofPath(ctx: CanvasRenderingContext2D, shape: RoofShape, g: { x: number; w: number; h: number; base: number; wallTop: number; ov: number; L: number }): void { // audit-ignore: fnlog-missing 家ごとに呼ぶ（paintTile でまとめてログ）
  const { x, w, h, base, wallTop, ov } = g;
  ctx.beginPath();
  if (shape === 'flat') ctx.rect(x - ov * 0.5, base - h, w + ov, h - (base - wallTop) + 0.3 * g.L);
  else if (shape === 'vault') {
    ctx.moveTo(x - ov, wallTop);
    ctx.quadraticCurveTo(x + w / 2, base - h * 1.45, x + w + ov, wallTop);
  } else if (shape === 'gable') {
    ctx.moveTo(x - ov, wallTop);
    ctx.lineTo(x + w / 2, base - h);
    ctx.lineTo(x + w + ov, wallTop);
  } else {
    ctx.moveTo(x - ov, wallTop);
    ctx.lineTo(x + w * 0.2, base - h);
    ctx.lineTo(x + w * 0.8, base - h);
    ctx.lineTo(x + w + ov, wallTop);
  }
  ctx.closePath();
}

/**
 * 家の正面（窓・戸・お店のひさし）を描く。
 * @param ctx 2D コンテキスト
 * @param s 置く場所
 * @param front 壁の左・上・幅・高さ（px）
 * @param roof 屋根の色
 * @param L 1セルの px
 * @sideEffect ctx に描く
 */
function drawHouseFront(ctx: CanvasRenderingContext2D, s: HouseSlot, front: { x: number; y: number; w: number; h: number }, roof: string, L: number): void { // audit-ignore: fnlog-missing 家ごとに呼ぶ（paintTile でまとめてログ）
  const { x, y, w, h } = front;
  if (w < 5 || h < 3) return;
  const shop = s.style === 'shophouse' || s.style === 'stall' || s.style === 'cafe';
  if (shop) {
    const sw = Math.max(1.2, w / 5);
    const ah = Math.max(1, h * 0.3);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 === 0 ? roof : '#ffffff';
      ctx.fillRect(x + i * sw, y, sw + 0.2, ah);
    }
  }
  const tall = s.style === 'office' || s.style === 'mansion' || s.style === 'apartment';
  const ws = Math.max(0.9, L * 0.9);
  const rows = tall ? Math.max(1, Math.floor((h - ws) / (ws * 2.1))) : 1;
  const cols = tall ? Math.max(1, Math.floor(w / (ws * 2.2))) : 2;
  ctx.fillStyle = WINDOW;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = tall ? x + (c + 0.5) * (w / cols) - ws / 2 : c === 0 ? x + w * 0.16 : x + w * 0.66;
      const wy = tall ? y + ws * 0.8 + r * ws * 2.1 : shop ? y + h * 0.45 : y + h * 0.28;
      ctx.fillRect(wx, wy, ws, ws * (tall ? 1 : 1.1));
    }
  }
  if (!tall) {
    ctx.fillStyle = DOOR;
    ctx.fillRect(x + w * 0.44, y + h * 0.42, w * 0.16, h * 0.58);
  }
}

/**
 * 駅舎（赤い屋根・白い壁・時計）を本物の大きさで描く。
 * @param ctx 2D コンテキスト
 * @param b 駅舎
 * @param L 1セルの px
 * @sideEffect ctx に描く
 */
function drawStation(ctx: CanvasRenderingContext2D, b: TownBuilding, L: number): void { // audit-ignore: fnlog-missing タイルごとに1回（paintTile でまとめてログ）
  const x = b.col * L;
  const base = (b.row + b.h) * L;
  const w = b.w * L;
  const h = b.h * L * 1.6;
  ctx.fillStyle = HOUSE_SHADOW;
  ctx.fillRect(x + L * 0.6, base - h * 0.5 + L * 0.6, w, h * 0.5);
  ctx.fillStyle = '#fff6e8';
  ctx.fillRect(x, base - h * 0.55, w, h * 0.55);
  ctx.fillStyle = '#c9563e';
  ctx.beginPath();
  ctx.moveTo(x - L * 0.6, base - h * 0.55);
  ctx.lineTo(x + w * 0.15, base - h);
  ctx.lineTo(x + w * 0.85, base - h);
  ctx.lineTo(x + w + L * 0.6, base - h * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x + w / 2, base - h * 0.75, Math.max(0.8, h * 0.11), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = WINDOW;
  for (let i = 0; i < 4; i++) ctx.fillRect(x + w * (0.12 + i * 0.21), base - h * 0.42, w * 0.12, h * 0.16);
}

// ---------------------------------------------------------------------------
// 毎フレーム描く飾り（画面の座標。s は大きさの倍率、alpha は濃さ）
// ---------------------------------------------------------------------------

/**
 * 提灯の列（たるんだ紐に赤い提灯が並び、ゆれて灯る）。
 * @param ctx 2D コンテキスト
 * @param x0 左端
 * @param x1 右端
 * @param y 紐の高さ
 * @param s 大きさの倍率
 * @param t 時刻（ミリ秒）
 * @param alpha 濃さ
 * @sideEffect ctx に描く
 */
export function drawLanternString(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, s: number, t: number, alpha: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0.01 || x1 - x0 < 8) return;
  const sag = 3.5 * s;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(90, 60, 40, 0.7)';
  ctx.lineWidth = Math.max(0.6, 0.7 * s);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.quadraticCurveTo((x0 + x1) / 2, y + sag * 2, x1, y);
  ctx.stroke();
  const n = Math.max(2, Math.floor((x1 - x0) / (6.5 * s)));
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const lx = x0 + (x1 - x0) * k;
    const ly = y + sag * 4 * k * (1 - k) + 1.6 * s + Math.sin(t / 600 + i) * 0.5 * s;
    const glow = 0.6 + 0.4 * Math.sin(t / 420 + i * 1.3);
    ctx.fillStyle = LANTERN_GLOW;
    ctx.globalAlpha = alpha * glow;
    ctx.beginPath();
    ctx.arc(lx, ly, 3.6 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = LANTERN;
    ctx.beginPath();
    ctx.ellipse(lx, ly, 1.5 * s, 1.9 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * のぼり（棒に縦長の旗がはためく）。
 * @param ctx 2D コンテキスト
 * @param x 根もと
 * @param y 根もと
 * @param s 大きさの倍率
 * @param t 時刻
 * @param alpha 濃さ
 * @param seed ばらつき 0..1
 * @sideEffect ctx に描く
 */
export function drawNobori(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, alpha: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0.01) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#6d5440';
  ctx.lineWidth = Math.max(0.7, 0.8 * s);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 13 * s);
  ctx.stroke();
  const wave = Math.sin(t / 260 + seed * 9) * 1.2 * s;
  const color = FESTIVE[Math.floor(seed * FESTIVE.length) % FESTIVE.length] ?? LANTERN;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - 12.5 * s);
  ctx.lineTo(x + 4 * s, y - 12.5 * s + wave * 0.3);
  ctx.quadraticCurveTo(x + 4 * s + wave, y - 8 * s, x + 4 * s, y - 4 * s + wave * 0.3);
  ctx.lineTo(x, y - 4 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 0.6 * s, y - 11.5 * s, 1.1 * s, 6 * s);
  ctx.globalAlpha = 1;
}

/**
 * 花のかたまり（色とりどりの点）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param s 大きさの倍率
 * @param alpha 濃さ
 * @param seed ばらつき
 * @sideEffect ctx に描く
 */
export function drawFlowers(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, alpha: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0.01) return;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 6; i++) {
    const a = seed * 6 + i * 1.05;
    ctx.fillStyle = FLOWER[(i + Math.floor(seed * 5)) % FLOWER.length] ?? '#ffffff';
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 3 * s * (0.5 + (i % 3) * 0.3), y + Math.sin(a) * 2 * s, 1.15 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * 煙突の煙（ふわふわ昇って消える3つの丸）。
 * @param ctx 2D コンテキスト
 * @param x 煙突の先
 * @param y 煙突の先
 * @param s 大きさの倍率
 * @param t 時刻
 * @param alpha 濃さ
 * @param seed ばらつき
 * @sideEffect ctx に描く
 */
export function drawSmoke(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, alpha: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0.01) return;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 3; i++) {
    const k = ((t / 2600 + seed + i / 3) % 1 + 1) % 1;
    ctx.globalAlpha = alpha * 0.75 * (1 - k);
    ctx.beginPath();
    ctx.arc(x + Math.sin(k * 5 + seed * 7) * 2 * s + k * 4 * s, y - k * 14 * s, (1.2 + k * 2.4) * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * 風船（ふわっと昇って消える）。
 * @param ctx 2D コンテキスト
 * @param x 放つ所
 * @param y 放つ所
 * @param s 大きさの倍率
 * @param t 時刻
 * @param alpha 濃さ
 * @param seed ばらつき
 * @sideEffect ctx に描く
 */
export function drawBalloon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, alpha: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0.01) return;
  const k = ((t / 6200 + seed) % 1 + 1) % 1;
  const bx = x + Math.sin(k * 6 + seed * 10) * 5 * s;
  const by = y - 6 * s - k * 62 * s;
  ctx.globalAlpha = alpha * Math.min(1, k * 6) * (1 - k * k);
  ctx.strokeStyle = 'rgba(90, 70, 60, 0.6)';
  ctx.lineWidth = 0.6 * s;
  ctx.beginPath();
  ctx.moveTo(bx, by + 3.4 * s);
  ctx.quadraticCurveTo(bx - 1.5 * s, by + 6 * s, bx + 0.5 * s, by + 8.5 * s);
  ctx.stroke();
  ctx.fillStyle = FESTIVE[Math.floor(seed * 97) % FESTIVE.length] ?? LANTERN;
  ctx.beginPath();
  ctx.ellipse(bx, by, 2.7 * s, 3.4 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.arc(bx - 0.9 * s, by - 1.2 * s, 0.8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * 小さな花火（打ち上げ → ぱっと開いて散る）。
 * @param ctx 2D コンテキスト
 * @param x 開く所
 * @param y 開く所
 * @param s 大きさの倍率
 * @param k 進み 0..1
 * @param seed ばらつき
 * @sideEffect ctx に描く
 */
export function drawFirework(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, k: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (k <= 0 || k >= 1) return;
  const color = FESTIVE[Math.floor(seed * 13) % FESTIVE.length] ?? LANTERN;
  if (k < 0.25) {
    const q = k / 0.25;
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(x, y + (1 - q) * 40 * s, 1.1 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  const q = (k - 0.25) / 0.75;
  const r = (4 + 18 * (1 - (1 - q) ** 2)) * s;
  ctx.globalAlpha = 1 - q;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + seed * 3;
    ctx.fillStyle = i % 2 === 0 ? color : '#fff3c4';
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r + q * q * 6 * s, (1.4 - q) * s + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * 下りたシャッター（灰色の縞）。
 * @param ctx 2D コンテキスト
 * @param x 左
 * @param y 上
 * @param w 幅
 * @param h 高さ
 * @param alpha 濃さ
 * @sideEffect ctx に描く
 */
export function drawShutter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0.01 || w < 2 || h < 2) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = SHUTTER;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = SHUTTER_LINE;
  for (let yy = y + 1; yy < y + h; yy += 1.6) ctx.fillRect(x, yy, w, 0.5);
  ctx.globalAlpha = 1;
}

/**
 * 枯れ木（くすんだ葉の名残と、むき出しの枝）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param s 大きさの倍率
 * @param alpha 濃さ
 * @param seed ばらつき
 * @sideEffect ctx に描く
 */
export function drawWitheredTree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, alpha: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0.01) return;
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = DEAD_TREE.leaf;
  ctx.beginPath();
  ctx.arc(x, y, 3.2 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = DEAD_TREE.branch;
  ctx.lineWidth = Math.max(0.6, 0.8 * s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + 4 * s);
  ctx.lineTo(x, y - 2 * s);
  ctx.moveTo(x, y);
  ctx.lineTo(x - 2.6 * s, y - 2.6 * s - seed * s);
  ctx.moveTo(x, y - 1 * s);
  ctx.lineTo(x + 2.4 * s, y - 3.4 * s);
  ctx.moveTo(x - 1.4 * s, y - 1.6 * s);
  ctx.lineTo(x - 1.2 * s, y - 3.6 * s);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * 雑草（伸びた草のひと株）。
 * @param ctx 2D コンテキスト
 * @param x 根もと
 * @param y 根もと
 * @param s 大きさの倍率
 * @param alpha 濃さ
 * @param seed ばらつき
 * @sideEffect ctx に描く
 */
export function drawWeeds(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, alpha: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0.01) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = WEED;
  ctx.lineWidth = Math.max(0.6, 0.75 * s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const dx = (i - 1.5) * 1.3 * s;
    ctx.moveTo(x + dx, y);
    ctx.quadraticCurveTo(x + dx + (seed - 0.5) * 2 * s, y - 2.5 * s, x + dx * 1.6, y - (3 + (i % 2) * 1.5) * s);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * 屋根のひび（ぎざぎざの線）。
 * @param ctx 2D コンテキスト
 * @param x 屋根の左
 * @param y 屋根の上
 * @param w 屋根の幅
 * @param h 屋根の高さ
 * @param alpha 濃さ
 * @sideEffect ctx に描く
 */
export function drawCrack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0.01 || w < 3) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = CRACK;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.3, y);
  ctx.lineTo(x + w * 0.42, y + h * 0.35);
  ctx.lineTo(x + w * 0.34, y + h * 0.55);
  ctx.lineTo(x + w * 0.5, y + h * 0.9);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * 小さな黒い雲と小雨（地面に暗い影を落とす）。
 * @param ctx 2D コンテキスト
 * @param x 雲の中心
 * @param y 雲の中心
 * @param s 大きさの倍率
 * @param t 時刻
 * @param alpha 濃さ
 * @sideEffect ctx に描く
 */
export function drawRainCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, alpha: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0.01) return;
  const dx = Math.sin(t / 2400) * 3 * s;
  ctx.globalAlpha = alpha * 0.14;
  ctx.fillStyle = '#3d3630';
  ctx.beginPath();
  ctx.ellipse(x + dx, y + 30 * s, 20 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = STORM.rain;
  ctx.lineWidth = Math.max(0.6, 0.8 * s);
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const k = ((t / 700 + i * 0.37) % 1 + 1) % 1;
    const rx = x + dx + (i - 5.5) * 2.6 * s - k * 2 * s;
    const ry = y + 5 * s + k * 24 * s;
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx - 1.2 * s, ry + 4.5 * s);
  }
  ctx.stroke();
  ctx.globalAlpha = alpha;
  for (const [ox, oy, r, color] of [[-8, 1, 6.5, STORM.dark], [8, 1.5, 6, STORM.dark], [0, -3, 8, STORM.mid], [-4, -5, 4, STORM.light]] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + dx + ox * s, y + oy * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * カラス（羽ばたく黒い鳥）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param s 大きさの倍率
 * @param t 時刻
 * @param alpha 濃さ
 * @param seed ばらつき
 * @sideEffect ctx に描く
 */
export function drawCrow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, alpha: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0.01) return;
  const flap = Math.sin(t / 130 + seed * 20) * 2.2 * s;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = CROW;
  ctx.strokeStyle = CROW;
  ctx.lineWidth = Math.max(0.9, 1.1 * s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 4 * s, y - flap);
  ctx.quadraticCurveTo(x - 1.5 * s, y - 1 * s, x, y);
  ctx.quadraticCurveTo(x + 1.5 * s, y - 1 * s, x + 4 * s, y - flap);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y + 0.3 * s, 1.3 * s, 0.9 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * 白い雲（地面に薄い影も落とす）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param s 大きさの倍率
 * @param seed ばらつき（形）
 * @sideEffect ctx に描く
 */
export function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const parts: readonly (readonly [number, number, number])[] = seed < 0.5
    ? [[-12, 2, 7], [0, -3, 10], [12, 1, 8], [4, 4, 7], [-5, 4, 7]]
    : [[-9, 1, 8], [4, -4, 9], [15, 2, 6], [-1, 4, 8]];
  ctx.fillStyle = CLOUD.shadow;
  ctx.beginPath();
  for (const [ox, oy, r] of parts) {
    ctx.moveTo(x + (ox + 10) * s + r * s, y + (oy + 34) * s);
    ctx.arc(x + (ox + 10) * s, y + (oy + 34) * s, r * s, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = CLOUD.shade;
  ctx.beginPath();
  for (const [ox, oy, r] of parts) {
    ctx.moveTo(x + ox * s + r * s, y + (oy + 1.5) * s);
    ctx.arc(x + ox * s, y + (oy + 1.5) * s, r * s, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = CLOUD.body;
  ctx.beginPath();
  for (const [ox, oy, r] of parts) {
    ctx.moveTo(x + ox * s + r * 0.92 * s, y + oy * s);
    ctx.arc(x + ox * s, y + oy * s, r * 0.92 * s, 0, Math.PI * 2);
  }
  ctx.fill();
}

/**
 * 空を渡る小鳥（「へ」の字の線）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param s 大きさの倍率
 * @param t 時刻
 * @param seed ばらつき
 * @sideEffect ctx に描く
 */
export function drawBird(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const flap = Math.sin(t / 160 + seed * 30) * 1.5 * s;
  ctx.strokeStyle = BIRD;
  ctx.lineWidth = Math.max(0.8, 0.9 * s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 3 * s, y - flap);
  ctx.quadraticCurveTo(x - 1 * s, y - 1.2 * s, x, y);
  ctx.quadraticCurveTo(x + 1 * s, y - 1.2 * s, x + 3 * s, y - flap);
  ctx.stroke();
}

/**
 * 小舟（屋形船。後ろに白い波の筋）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param s 大きさの倍率
 * @param angle 進む向き（ラジアン）
 * @sideEffect ctx に描く
 */
export function drawBoat(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = BOAT.wake;
  ctx.lineWidth = Math.max(0.7, 0.8 * s);
  ctx.beginPath();
  ctx.moveTo(-5 * s, -1.5 * s);
  ctx.lineTo(-11 * s, -3 * s);
  ctx.moveTo(-5 * s, 1.5 * s);
  ctx.lineTo(-11 * s, 3 * s);
  ctx.stroke();
  ctx.fillStyle = BOAT.hull;
  ctx.beginPath();
  ctx.moveTo(-5 * s, -2 * s);
  ctx.lineTo(4 * s, -2 * s);
  ctx.lineTo(6.5 * s, 0);
  ctx.lineTo(4 * s, 2 * s);
  ctx.lineTo(-5 * s, 2 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BOAT.cabin;
  ctx.fillRect(-3.5 * s, -1.3 * s, 6 * s, 2.6 * s);
  ctx.fillStyle = BOAT.roof;
  ctx.fillRect(-4 * s, -1.6 * s, 7 * s, 1.1 * s);
  ctx.restore();
}

/**
 * 高架を走る小さな電車（3両）。
 * @param ctx 2D コンテキスト
 * @param x 先頭の中心
 * @param y 線路の中心
 * @param s 大きさの倍率
 * @param dir 進む向き（1=東、-1=西）
 * @sideEffect ctx に描く
 */
export function drawTrain(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, dir: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const carW = 9 * s;
  const carH = 4.4 * s;
  for (let i = 0; i < 3; i++) {
    const cx = x - dir * i * (carW + 1.2 * s);
    ctx.fillStyle = 'rgba(70, 50, 30, 0.2)';
    ctx.fillRect(cx - carW / 2 + 0.8 * s, y - carH / 2 + 1.2 * s, carW, carH);
    ctx.fillStyle = TRAIN.body;
    ctx.beginPath();
    ctx.roundRect(cx - carW / 2, y - carH / 2, carW, carH, i === 0 ? 2 * s : 0.8 * s);
    ctx.fill();
    ctx.strokeStyle = TRAIN.edge;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.fillStyle = TRAIN.stripe;
    ctx.fillRect(cx - carW / 2, y + carH * 0.12, carW, carH * 0.22);
    ctx.fillStyle = TRAIN.window;
    for (let w = 0; w < 3; w++) ctx.fillRect(cx - carW / 2 + (1.2 + w * 2.6) * s, y - carH * 0.32, 1.6 * s, 1.4 * s);
  }
}

/**
 * 雰囲気が切り替わる波の前線（よくなる＝金色の光の輪ときらめき、悪くなる＝くすんだ土ぼこりの輪）。
 * @param ctx 2D コンテキスト
 * @param cx 中心
 * @param cy 中心
 * @param r 半径
 * @param up よくなる波か
 * @param fade 濃さ（終わりに向けて薄くする）
 * @param t 時刻
 * @sideEffect ctx に描く
 */
export function drawWaveFront(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, up: boolean, fade: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (fade <= 0.01 || r < 2) return;
  ctx.globalAlpha = fade;
  ctx.strokeStyle = up ? 'rgba(255, 214, 120, 0.85)' : 'rgba(120, 104, 88, 0.6)';
  ctx.lineWidth = up ? 7 : 9;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = up ? 'rgba(255, 255, 255, 0.9)' : 'rgba(90, 80, 70, 0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + t / 900;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (up) drawSparkle(ctx, px, py, 2.4 + (i % 3));
    else {
      ctx.fillStyle = i % 2 === 0 ? '#9c8f7f' : '#7c6e60';
      ctx.beginPath();
      ctx.arc(px, py + (i % 4), 1.6 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * 4つの角のきらめき。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param r 大きさ
 * @sideEffect ctx に描く
 */
function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = '#fff4c2';
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

/**
 * 土地の色だけの粗い全体図（1セル=1ドット）を作る（タイルが焼けるまでの代わり。空白を作らない）。
 * @param grid 街
 * @returns RGBA の画素（cols*rows*4）
 */
export function paintLanduse(grid: Pick<TownGrid, 'cols' | 'rows' | 'kinds' | 'buildingAt'>): Uint8ClampedArray {
  const log = logger.fn('paintLanduse', { cols: grid.cols, rows: grid.rows });
  const out = new Uint8ClampedArray(grid.cols * grid.rows * 4);
  const paper = rgbOf(PAPER);
  const cache = new Map<string, { r: number; g: number; b: number }>();
  for (let i = 0; i < grid.cols * grid.rows; i++) {
    const kind = grid.kinds[i] ?? 0;
    const hex = GROUND_COLORS[kind];
    let c = paper;
    // 家は描かないので、建物のセルも地面の色にする
    if ((grid.buildingAt[i] ?? -1) < 0 && hex !== undefined) {
      c = cache.get(hex) ?? rgbOf(hex);
      cache.set(hex, c);
    }
    const o = i * 4;
    out[o] = c.r;
    out[o + 1] = c.g;
    out[o + 2] = c.b;
    out[o + 3] = 255;
  }
  return log.exit(out);
}

/**
 * '#rrggbb' を数にする。
 * @param hex 色
 * @returns r・g・b
 */
function rgbOf(hex: string): { r: number; g: number; b: number } { // audit-ignore: fnlog-missing 色ごとに呼ぶ純粋な変換ヘルパー
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
