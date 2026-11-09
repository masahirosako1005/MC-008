/**
 * @file 道に沿った経路（presentation/screens/Map/town 層。純粋関数）
 * デモで「お店をタップすると、自分のアイコンが道に沿ってそこまで歩く」ための経路を、歩けるセル（道路・商店街・路地・遊歩道・橋・広場）の上で A* で求める。
 * 8方向に進むが、建物の角はすり抜けない（斜めに進むのは両隣も歩けるときだけ）。公園の芝は遠回りより少しだけ嫌う。
 * 結果は向きが変わる点だけに間引いた緯度経度の折れ線（現在地 → … → お店の入口 → お店の敷地）。位置座標はログに出さない（セル数・距離だけ）。
 */
import { createLogger } from '@/Common/logging/logger';
import { CELL_M, Cell, cellCenterLatLng, cellIndex, isWalkable, latLngToCell } from '@/presentation/screens/Map/town/townTypes';
import type { TownGrid } from '@/presentation/screens/Map/town/townTypes';

const logger = createLogger('presentation/screens/Map/town/townPath');

/** 1回の探索で調べるセルの上限（これを超えたら経路なし） */
export const MAX_SEARCH_NODES = 400_000;
/** 近くの歩けるセルを探す半径（セル） */
export const NEAREST_WALKABLE_RADIUS = 40; // audit-ignore: magic-radius 探す半径（セル数。発見・訪問の距離ルールではない）
/** 公園の芝を通るときの重み（道より少し嫌う） */
const PARK_COST = 2.2;
/** 路地を通るときの重み（ほんの少し嫌う） */
const ALLEY_COST = 1.15;

/** セルの位置 */
export interface CellPos {
  readonly col: number;
  readonly row: number;
}

/** 緯度経度（座標はログに出さない） */
export interface PathLatLng {
  readonly lat: number;
  readonly lng: number;
}

/** 探索用の使い回しバッファ（街の大きさごと） */
interface SearchBuffers {
  readonly size: number;
  readonly g: Float32Array;
  readonly from: Int32Array;
  readonly stamp: Uint32Array;
  readonly closed: Uint32Array;
  generation: number;
}

let buffers: SearchBuffers | undefined;

/**
 * 探索用のバッファを用意する（同じ大きさなら使い回す）。
 * @param size セル数
 * @returns バッファ
 */
function buffersFor(size: number): SearchBuffers {
  const log = logger.fn('buffersFor', { size });
  if (buffers === undefined || buffers.size !== size) {
    buffers = { size, g: new Float32Array(size), from: new Int32Array(size), stamp: new Uint32Array(size), closed: new Uint32Array(size), generation: 0 };
  }
  buffers.generation += 1;
  return log.exit(buffers);
}

/**
 * セルを通る重みを返す（歩けなければ Infinity）。
 * @param kind セルの種類
 * @returns 重み
 */
export function stepCost(kind: number): number { // audit-ignore: fnlog-missing 経路探索でセルごとに呼ぶ純粋な算術ヘルパー
  if (!isWalkable(kind)) return Number.POSITIVE_INFINITY;
  if (kind === Cell.PARK) return PARK_COST;
  if (kind === Cell.ALLEY) return ALLEY_COST;
  return 1;
}

/**
 * いちばん近い歩けるセルを、近い順（四角い輪を広げながら）に探す。
 * @param grid 街
 * @param col 探し始めの列
 * @param row 探し始めの行
 * @param maxRadius 探す半径（セル）
 * @returns 歩けるセル（無ければ undefined）
 */
export function nearestWalkable(grid: TownGrid, col: number, row: number, maxRadius = NEAREST_WALKABLE_RADIUS): CellPos | undefined {
  const log = logger.fn('nearestWalkable', { maxRadius });
  const c0 = Math.round(col);
  const r0 = Math.round(row);
  for (let radius = 0; radius <= maxRadius; radius++) {
    let best: CellPos | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        const i = cellIndex(grid, c0 + dc, r0 + dr);
        if (i < 0 || !isWalkable(grid.kinds[i] ?? -1)) continue;
        const d = Math.hypot(c0 + dc - col, r0 + dr - row);
        if (d < bestD) {
          bestD = d;
          best = { col: c0 + dc, row: r0 + dr };
        }
      }
    }
    if (best !== undefined) return log.exit(best, `半径 ${radius}`);
  }
  return log.exit(undefined, '見つからない');
}

/** 最小ヒープ（添字と優先度） */
class MinHeap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];

  /**
   * 要素の数。
   * @returns 数
   */
  get size(): number {
    return this.items.length;
  }

  /**
   * 追加する。
   * @param item セルの添字
   * @param key 優先度（小さいほど先）
   * @sideEffect ヒープを並べ替える
   */
  push(item: number, key: number): void { // audit-ignore: fnlog-missing 経路探索で何万回も呼ぶヒープ操作
    const items = this.items;
    const keys = this.keys;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((keys[p] ?? 0) <= key) break;
      items[i] = items[p] ?? 0;
      keys[i] = keys[p] ?? 0;
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }

  /**
   * 最小の要素を取り出す。
   * @returns セルの添字（空なら -1）
   * @sideEffect ヒープを並べ替える
   */
  pop(): number { // audit-ignore: fnlog-missing 経路探索で何万回も呼ぶヒープ操作
    const items = this.items;
    const keys = this.keys;
    if (items.length === 0) return -1;
    const top = items[0] ?? -1;
    const lastItem = items.pop() ?? 0;
    const lastKey = keys.pop() ?? 0;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && (keys[r] ?? 0) < (keys[l] ?? 0) ? r : l;
        if ((keys[m] ?? 0) >= lastKey) break;
        items[i] = items[m] ?? 0;
        keys[i] = keys[m] ?? 0;
        i = m;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}

/** 8方向（列・行の差と重み） */
const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * 歩けるセルだけを通る最短経路を A* で求める（両端を含む）。端が歩けないセルでも、端そのものは通ってよい。
 * @param grid 街
 * @param start 始点
 * @param goal 終点
 * @returns セルの列（見つからなければ undefined）
 */
export function findPath(grid: TownGrid, start: CellPos, goal: CellPos): CellPos[] | undefined {
  const log = logger.fn('findPath');
  const s = cellIndex(grid, start.col, start.row);
  const t = cellIndex(grid, goal.col, goal.row);
  if (s < 0 || t < 0) return log.exit(undefined, '範囲外');
  if (s === t) return log.exit([start]);
  const buf = buffersFor(grid.cols * grid.rows);
  const gen = buf.generation;
  const heap = new MinHeap();
  buf.g[s] = 0;
  buf.stamp[s] = gen;
  buf.from[s] = -1;
  heap.push(s, octile(start.col, start.row, goal.col, goal.row));
  let visited = 0;
  while (heap.size > 0 && visited < MAX_SEARCH_NODES) {
    const i = heap.pop();
    if (i === t) return log.exit(reconstruct(grid, buf, t), `調べた ${visited} セル`);
    if (buf.closed[i] === gen) continue;
    buf.closed[i] = gen;
    visited++;
    expand(grid, buf, heap, i, t, goal);
  }
  return log.exit(undefined, `経路なし（調べた ${visited} セル）`);
}

/**
 * 1セルのまわり8方向を調べて、良くなるならヒープに積む。
 * @param grid 街
 * @param buf 探索バッファ
 * @param heap ヒープ
 * @param i いまのセル
 * @param t 終点の添字
 * @param goal 終点
 * @sideEffect buf とヒープを書き換える
 */
function expand(grid: TownGrid, buf: SearchBuffers, heap: MinHeap, i: number, t: number, goal: CellPos): void { // audit-ignore: fnlog-missing 経路探索でセルごとに呼ぶ内部ヘルパー（findPath でまとめてログ）
  const gen = buf.generation;
  const c = i % grid.cols;
  const r = (i - c) / grid.cols;
  const gi = buf.g[i] ?? 0;
  for (const [dc, dr, w] of DIRS) {
    const j = cellIndex(grid, c + dc, r + dr);
    if (j < 0 || buf.closed[j] === gen) continue;
    const cost = j === t ? 1 : stepCost(grid.kinds[j] ?? -1);
    if (!Number.isFinite(cost)) continue;
    if (dc !== 0 && dr !== 0) {
      // 斜めは、縦横の両隣も歩けるときだけ（建物の角をすり抜けない）
      if (!isWalkable(grid.kinds[cellIndex(grid, c + dc, r)] ?? -1) || !isWalkable(grid.kinds[cellIndex(grid, c, r + dr)] ?? -1)) continue;
    }
    const g = gi + w * cost;
    if (buf.stamp[j] === gen && (buf.g[j] ?? 0) <= g) continue;
    buf.stamp[j] = gen;
    buf.g[j] = g;
    buf.from[j] = i;
    heap.push(j, g + octile(c + dc, r + dr, goal.col, goal.row));
  }
}

/**
 * 8方向で動くときの、障害物なしの最短距離（A* の見積もり）。
 * @param c0 始点の列
 * @param r0 始点の行
 * @param c1 終点の列
 * @param r1 終点の行
 * @returns 距離（セル）
 */
function octile(c0: number, r0: number, c1: number, r1: number): number { // audit-ignore: fnlog-missing 経路探索でセルごとに呼ぶ純粋な算術ヘルパー
  const dx = Math.abs(c1 - c0);
  const dy = Math.abs(r1 - r0);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

/**
 * 探索結果から経路を復元する。
 * @param grid 街
 * @param buf 探索バッファ
 * @param t 終点の添字
 * @returns 始点から終点までのセル
 */
function reconstruct(grid: TownGrid, buf: SearchBuffers, t: number): CellPos[] { // audit-ignore: fnlog-missing 内部ヘルパー（findPath でログ）
  const out: CellPos[] = [];
  let i = t;
  while (i >= 0) {
    out.push({ col: i % grid.cols, row: Math.floor(i / grid.cols) });
    i = buf.from[i] ?? -1;
  }
  return out.reverse();
}

/**
 * 経路を、向きが変わる点だけに間引く（両端は残す）。
 * @param cells 経路
 * @returns 間引いた経路
 */
export function simplifyPath(cells: readonly CellPos[]): CellPos[] {
  const log = logger.fn('simplifyPath', { cells: cells.length });
  if (cells.length <= 2) return log.exit([...cells]);
  const out: CellPos[] = [cells[0] as CellPos];
  for (let k = 1; k < cells.length - 1; k++) {
    const a = cells[k - 1] as CellPos;
    const b = cells[k] as CellPos;
    const c = cells[k + 1] as CellPos;
    if (b.col - a.col !== c.col - b.col || b.row - a.row !== c.row - b.row) out.push(b);
  }
  out.push(cells[cells.length - 1] as CellPos);
  return log.exit(out, `${out.length} 点`);
}

/**
 * 折れ線の長さ（メートル）を返す。
 * @param points 緯度経度の折れ線
 * @param metersPerDegLng 経度1度あたりのメートル
 * @returns 長さ（メートル）
 */
export function polylineMeters(points: readonly PathLatLng[], metersPerDegLng: number): number { // audit-ignore: fnlog-missing 歩行の毎フレームでも呼ぶ純粋な算術ヘルパー
  let total = 0;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1] as PathLatLng;
    const b = points[k] as PathLatLng;
    total += Math.hypot((b.lng - a.lng) * metersPerDegLng, (b.lat - a.lat) * 111_000);
  }
  return total;
}

/** 経路の目的地 */
export type RouteTarget = { readonly anchorId: string } | { readonly point: PathLatLng };

/**
 * 現在地から目的地（スポット・便利施設の敷地、または地図の1点）まで、道に沿った緯度経度の折れ線を作る。
 * 敷地が目的地なら、入口まで道を歩き、最後に敷地の中心へ入る。
 * @param grid 街
 * @param from 現在地
 * @param target 目的地
 * @returns 折れ線（先頭は現在地）。道が見つからなければ undefined
 */
export function routeTo(grid: TownGrid, from: PathLatLng, target: RouteTarget): PathLatLng[] | undefined {
  const log = logger.fn('routeTo', { anchor: 'anchorId' in target ? target.anchorId : undefined });
  const fromCell = latLngToCell(grid, from);
  const start = nearestWalkable(grid, fromCell.col - 0.5, fromCell.row - 0.5);
  if (start === undefined) return log.exit(undefined, '現在地の近くに道が無い');
  let goal: CellPos | undefined;
  let finish: PathLatLng | undefined;
  if ('anchorId' in target) {
    const anchor = grid.anchors.get(target.anchorId);
    if (anchor === undefined) return log.exit(undefined, '敷地が無い');
    goal = { col: anchor.doorCol, row: anchor.doorRow };
    finish = cellCenterLatLng(grid, anchor.col, anchor.row);
  } else {
    const c = latLngToCell(grid, target.point);
    goal = nearestWalkable(grid, c.col - 0.5, c.row - 0.5);
    finish = undefined;
  }
  if (goal === undefined) return log.exit(undefined, '目的地の近くに道が無い');
  const cells = findPath(grid, start, goal);
  if (cells === undefined) return log.exit(undefined, '道がつながっていない');
  const points: PathLatLng[] = [{ lat: from.lat, lng: from.lng }, ...simplifyPath(cells).map((p) => cellCenterLatLng(grid, p.col, p.row))];
  if (finish !== undefined) points.push(finish);
  return log.exit(dedupe(points), `${cells.length} セル・約 ${Math.round(cells.length * CELL_M)}m`);
}

/**
 * 続けて同じ（1cm 未満の差の）点を取り除く。
 * @param points 折れ線
 * @returns 取り除いた折れ線
 */
function dedupe(points: readonly PathLatLng[]): PathLatLng[] { // audit-ignore: fnlog-missing 内部ヘルパー（routeTo でログ）
  const out: PathLatLng[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(last.lat - p.lat) < 1e-7 && Math.abs(last.lng - p.lng) < 1e-7) continue;
    out.push(p);
  }
  return out;
}
