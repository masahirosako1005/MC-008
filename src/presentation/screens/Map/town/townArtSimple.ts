/**
 * @file 街の地面を「簡易表示」で描く（presentation/screens/Map/town 層）
 * 2026-11-09 ユーザー指示「街のオブジェクトが多すぎて大変。お店以外は簡易オブジェクトに」で、建物は四角・木は丸い点・道は白い帯に。
 * 2026-11-09 ユーザー指示「陣取り＋街の成長要素が無いので入れてほしい」で、陣地によって街の育ち方を描き分ける:
 * - 自分の陣地の外: 淡い色の四角（まだ育っていない街）。木はやわらかい緑
 * 2026-11-10 ユーザー指示「陣地がとられていくと街が廃れていく感じに」「街の表示がシステム表示みたい。旅の温かみある表示に」:
 * - ライバルの手に渡ったお店のまわりは「廃れた街」（くすんだ茶色の建物にシャッターの縞・屋根のひび、枯れ木、空き地の雑草、セピアの膜）
 * - 陣地の外も灰色をやめ、淡い色の建物と暖かいクリーム色の地・砂色の道にして、旅先の街の温かみを出す
 * - 自分の陣地の中: 色づいた建物（屋根の明るい縁）。地区の成長段階で増える（Lv1 花、Lv2 窓と街灯、Lv3 灯る窓・屋根の小旗・道の提灯）
 * 主役（お店・名所・トイレの絵）は townScene が上に重ねる。townRenderer から paintChunk・paintOverview で呼ばれる。
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
/** まだ育っていない建物（陣地の外）。灰色ではなく、屋根の色を淡くした暖かい色（roof 0..7） */
export const CALM_BUILDING_COLORS: readonly string[] = ['#f2dcd3', '#f3e0cb', '#d9ebe2', '#dde6f0', '#e5def0', '#ecdfd0', '#e2e2e2', '#ebe6dd'];
const DORMANT_BUILDING = '#ebe4d8';
const DORMANT_SHADOW = '#d9cdbb';
/** ライバルの手に渡ったお店のまわりの建物（廃れた街: くすんだ茶色・シャッター・ひび） */
export const DECAY_BUILDING = '#c9bba6';
const DECAY_SHADOW = '#a3937c';
const DECAY_SHUTTER = '#b2a48f';
const DECAY_CRACK = '#8c7d68';
/** 廃れた街の枯れ木・雑草 */
const TREE_WITHERED = { light: '#cbb98f', dark: '#ab9670' };
const WEED = '#9aa36a';
/** 互換のため残す: 簡易表示の建物の基本色（全体図の凡例・テスト用） */
export const SIMPLE_BUILDING_COLORS: readonly string[] = VIVID_BUILDING_COLORS;

/** セルの種類ごとの地面の色 */
const GROUND: Readonly<Record<number, string>> = {
  [Cell.GRASS]: '#f4ead9',
  [Cell.ROAD]: '#fffaf1',
  [Cell.AVENUE]: '#fffaf1',
  [Cell.ARCADE]: '#fde8d2',
  [Cell.ALLEY]: '#fbfaf7',
  [Cell.PATH]: '#efe8d8',
  [Cell.PLAZA]: '#ece7dc',
  [Cell.BRIDGE]: '#e9e3d8',
  [Cell.WATER]: '#b5d6dc',
  [Cell.BANK]: '#dbe6e4',
  [Cell.PARK]: '#dcebd2',
  [Cell.POND]: '#b5d6dc',
  [Cell.BUILDING]: '#f4ead9',
  [Cell.LOT]: '#f8f1e4',
  [Cell.TREE]: '#f4ead9',
  [Cell.SAKURA]: '#f4ead9',
  [Cell.GARDEN]: '#f4ead9',
  [Cell.PARKING]: '#f4ead9',
  [Cell.PLAYGROUND]: '#dcebd2',
};
/** 自分の陣地の中の地面（暖かい色） */
const MINE_GROUND = '#fdf5ed';
const MINE_PARK = '#cfeab9';
/** 道の縁（道でないセルとの境） */
const STREET_EDGE = '#e4d5bf';
/** 廃れた街の地面（少し枯れた色） */
const DECAY_GROUND = '#ebe0cc';
/** 大通りの面（ふつうの道と見分けるため、ほんの少し黄色に） */
const AVENUE_TINT = '#fffaea';
/** 木の色（色づいた・くすんだ） */
const TREE = { light: '#a8d596', dark: '#8cc47a' };
const TREE_DORMANT = { light: '#c9dfb8', dark: '#b4d0a1' };
const SAKURA = { light: '#f8cdda', dark: '#efb3c6' };
const SAKURA_DORMANT = { light: '#eadde2', dark: '#ddcdd3' };
/** 花の色 */
const FLOWER_COLORS: readonly string[] = ['#ff8fab', '#ffc83d', '#ff6a3d', '#b48cff', '#ffffff'];
/** 街灯・提灯 */
const LAMP_POST = '#6b6f80';
const LAMP_LIGHT = '#ffd84d';
const LANTERN = '#ff5a3d';
/** 高架の色（桁・縁・レール） */
const VIADUCT_FILL = '#dedad2';
const VIADUCT_EDGE = '#c8c2b8';
const VIADUCT_RAIL = '#b8b1a6';
/** 陣地の境を目立たせる地面の色づけ（自分は地面の色を変えるので、ここはライバルだけ） */
const RIVAL_TINT = { r: 110, g: 86, b: 60, a: 0.09 };
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
 * @param far 引いて見る用（中間・広域）なら true。木を1本ずつの点にせず、並木・公園の縁だけを緑の帯にまとめる
 * @sideEffect canvas に描く
 */
export function paintChunk(ctx: CanvasRenderingContext2D, grid: TownGrid, chunkCol: number, chunkRow: number, state: TownPaintState, far = false): void {
  const log = logger.fn('paintChunk', { chunkCol, chunkRow });
  const c0 = chunkCol * CHUNK_CELLS;
  const r0 = chunkRow * CHUNK_CELLS;
  ctx.fillStyle = GROUND[Cell.GRASS] ?? '#f3ede2';
  ctx.fillRect(0, 0, CHUNK_PX, CHUNK_PX);
  const buildings = new Set<number>();
  for (let r = 0; r < CHUNK_CELLS; r++) {
    for (let c = 0; c < CHUNK_CELLS; c++) {
      const col = c0 + c;
      const row = r0 + r;
      const kind = kindAt(grid, col, row);
      const own = ownerAt(grid, state, col, row);
      paintCell(ctx, grid, kind, col, row, c * CELL_PX, r * CELL_PX, own.owner, far);
      if (own.owner === TERRITORY_MINE) paintGrowth(ctx, grid, kind, col, row, c * CELL_PX, r * CELL_PX, own.level);
      else if (own.owner === TERRITORY_RIVAL) paintDecay(ctx, grid, kind, col, row, c * CELL_PX, r * CELL_PX);
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
 * 1セルの地面（と道の縁・木）を描く。自分の陣地の中は地面を暖かい色に、木を色づける。廃れた街は地面が枯れ色、木は枯れ木。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param kind セルの種類
 * @param col 列
 * @param row 行
 * @param x チャンク内の左（ドット）
 * @param y チャンク内の上（ドット）
 * @param owner 陣地（TERRITORY_*）
 * @param far 引いて見る用なら true（木は緑の帯にまとめる）
 * @sideEffect canvas に描く
 */
function paintCell(ctx: CanvasRenderingContext2D, grid: TownGrid, kind: number, col: number, row: number, x: number, y: number, owner: number, far: boolean): void { // audit-ignore: fnlog-missing チャンクを描くときにセルごとに呼ぶ（paintChunk でまとめてログ）
  const mine = owner === TERRITORY_MINE;
  const decay = owner === TERRITORY_RIVAL;
  const open = kind === Cell.GRASS || kind === Cell.BUILDING || kind === Cell.TREE || kind === Cell.SAKURA || kind === Cell.GARDEN || kind === Cell.PARKING || kind === Cell.LOT;
  const park = kind === Cell.PARK || kind === Cell.PLAYGROUND;
  ctx.fillStyle = mine && open ? MINE_GROUND : mine && park ? MINE_PARK : decay && open ? DECAY_GROUND : (GROUND[kind] ?? '#f4ead9');
  ctx.fillRect(x, y, CELL_PX, CELL_PX);
  if (isStreet(kind)) {
    paintStreetEdges(ctx, grid, kind, col, row, x, y);
    return;
  }
  if (isTreeKind(kind)) {
    const color = decay ? TREE_WITHERED : kind === Cell.SAKURA ? (mine ? SAKURA : SAKURA_DORMANT) : mine ? TREE : TREE_DORMANT;
    if (!far) paintTree(ctx, x, y, color);
    else if (inGrove(grid, col, row)) paintGrove(ctx, grid, col, row, x, y, color);
  } else if (kind === Cell.BANK) {
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
 * そのセルが木（木・桜）か。
 * @param kind セルの種類
 * @returns 木なら true
 */
function isTreeKind(kind: number): boolean { // audit-ignore: fnlog-missing セルごとに呼ぶ純粋な判定ヘルパー
  return kind === Cell.TREE || kind === Cell.SAKURA;
}

/**
 * 木のセルが「まとまり」（並木・木立・公園の縁）の一部か。引いて見るとき、ぽつんと立つ木は粒に見えるので描かない。
 * @param grid 街
 * @param col 列
 * @param row 行
 * @returns 上下左右のどこかが木か公園なら true
 */
export function inGrove(grid: TownGrid, col: number, row: number): boolean { // audit-ignore: fnlog-missing セルごとに呼ぶ純粋な判定ヘルパー
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const k = kindAt(grid, col + dc, row + dr);
    if (isTreeKind(k) || k === Cell.PARK || k === Cell.PLAYGROUND) return true;
  }
  return false;
}

/**
 * 引いて見る用の木。セルいっぱいの緑で塗り、隣の木とつながった帯にする（南の端だけ影）。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param col 列
 * @param row 行
 * @param x 左（ドット）
 * @param y 上（ドット）
 * @param color 明るい色と暗い色
 * @sideEffect canvas に描く
 */
function paintGrove(ctx: CanvasRenderingContext2D, grid: TownGrid, col: number, row: number, x: number, y: number, color: { light: string; dark: string }): void { // audit-ignore: fnlog-missing セルごとに呼ぶ（paintChunk でまとめてログ）
  ctx.fillStyle = color.light;
  ctx.fillRect(x, y, CELL_PX, CELL_PX);
  if (isTreeKind(kindAt(grid, col, row + 1))) return;
  ctx.fillStyle = color.dark;
  ctx.fillRect(x, y + CELL_PX - 2, CELL_PX, 2);
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
 * 廃れた街のしるし（空き地のところどころに雑草、道ばたに枯れ色の点）。
 * @param ctx 2D コンテキスト
 * @param grid 街
 * @param kind セルの種類
 * @param col 列
 * @param row 行
 * @param x 左（ドット）
 * @param y 上（ドット）
 * @sideEffect canvas に描く
 */
function paintDecay(ctx: CanvasRenderingContext2D, grid: TownGrid, kind: number, col: number, row: number, x: number, y: number): void { // audit-ignore: fnlog-missing セルごとに呼ぶ（paintChunk でまとめてログ）
  const v = grid.variant[row * grid.cols + col] ?? 0;
  if (kind === Cell.GRASS || kind === Cell.GARDEN || kind === Cell.PARKING || kind === Cell.PARK) {
    if (v % 5 !== 0) return;
    ctx.fillStyle = WEED;
    ctx.fillRect(x + 2 + (v % 3), y + 4, 1, 3);
    ctx.fillRect(x + 3 + (v % 3), y + 3, 1, 4);
    ctx.fillRect(x + 4 + (v % 3), y + 5, 1, 2);
    return;
  }
  if (isStreet(kind) && v % 11 === 0) {
    ctx.fillStyle = TREE_WITHERED.dark;
    ctx.fillRect(x + 1 + (v % 5), y + 2 + ((v >> 3) % 4), 2, 1);
  }
}

/**
 * 建物を四角で描く。自分の陣地の中は色づき（成長段階で窓・灯り・屋根の小旗が増える）、外は淡い色、ライバルの手に渡った所は廃れた建物（シャッター・ひび）。
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
  if (own.owner === TERRITORY_RIVAL) {
    paintDecayedBuilding(ctx, x, y, w, h, b.seed);
    return;
  }
  if (own.owner !== TERRITORY_MINE) {
    ctx.fillStyle = DORMANT_SHADOW;
    ctx.fillRect(x, y + 1, w, h);
    ctx.fillStyle = b.style === 'station' ? DORMANT_BUILDING : (CALM_BUILDING_COLORS[b.roof] ?? DORMANT_BUILDING);
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
 * 廃れた建物（くすんだ茶色・閉じたシャッターの横縞・屋根のひび）。
 * @param ctx 2D コンテキスト
 * @param x 左
 * @param y 上
 * @param w 幅
 * @param h 高さ
 * @param seed ひびの位置を決める種
 * @sideEffect canvas に描く
 */
function paintDecayedBuilding(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number): void { // audit-ignore: fnlog-missing 建物ごとに呼ぶ（paintChunk でまとめてログ）
  ctx.fillStyle = DECAY_SHADOW;
  ctx.fillRect(x, y + 1, w, h);
  ctx.fillStyle = DECAY_BUILDING;
  ctx.fillRect(x, y, w, h - 1);
  if (w >= 8 && h >= 8) {
    // 下半分に閉じたシャッター（横縞）
    ctx.fillStyle = DECAY_SHUTTER;
    const top = y + Math.floor(h * 0.5);
    for (let sy = top; sy < y + h - 2; sy += 2) ctx.fillRect(x + 2, sy, w - 4, 1);
  }
  // 屋根のひび（斜めの折れ線を点で）
  ctx.fillStyle = DECAY_CRACK;
  const cx = x + 2 + (seed % Math.max(1, w - 5));
  ctx.fillRect(cx, y + 1, 1, 2);
  ctx.fillRect(cx + 1, y + 3, 1, 1);
  ctx.fillRect(cx + 2, y + 4, 1, 2);
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
  const calm = CALM_BUILDING_COLORS.map(rgbOf);
  const rival = rgbOf(DECAY_BUILDING);
  const withered = rgbOf(TREE_WITHERED.light);
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
      if (b >= 0) rgb = owner === TERRITORY_MINE ? (vivid[grid.buildings[b]?.roof ?? 7] ?? dormant) : owner === TERRITORY_RIVAL ? rival : (calm[grid.buildings[b]?.roof ?? 7] ?? dormant);
      else if (isTreeKind(kind) && inGrove(grid, col, row)) rgb = owner === TERRITORY_MINE ? tree : owner === TERRITORY_RIVAL ? withered : treeDormant;
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
