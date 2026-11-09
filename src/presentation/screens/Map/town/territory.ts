/**
 * @file 陣取り（presentation/screens/Map/town 層。純粋関数）
 * 訪問（チェックイン）したスポットのまわりが「自分の陣地」になり、通った回数と地区の成長段階で広がる（下がらない＝CLAUDE.md 4.3・5章）。
 * ライバルが地区の主の地区では、その地区のいくつかのスポットのまわりがライバルの陣地として見える（取り返す相手が地図で分かる＝C）。
 * 陣地は訪問記録から毎回導出するので、保存はしない（DI-05 と同じ考え方）。マス＝5m 四方のセル。位置座標はログに出さない。
 */
import { createLogger } from '@/Common/logging/logger';
import { hashString } from '@/Common/ui/canvas/seededHash';
import { CELL_M, Cell, TERRITORY_MINE, TERRITORY_NONE, TERRITORY_RIVAL } from '@/presentation/screens/Map/town/townTypes';
import type { TownGrid } from '@/presentation/screens/Map/town/townTypes';

const logger = createLogger('presentation/screens/Map/town/territory');

/** 1回目の訪問で取れる陣地の半径（メートル）（仮） */
export const TERRITORY_BASE_M = 30;
/** 2回目以降の訪問1回ごとに広がる半径（メートル）（仮） */
export const TERRITORY_PER_VISIT_M = 10;
/** 訪問回数で広がるのはこの回数まで（仮） */
export const TERRITORY_MAX_EXTRA_VISITS = 8;
/** 地区の成長段階1つごとに広がる半径（メートル）（仮） */
export const TERRITORY_PER_LEVEL_M = 6;
/** ライバルの陣地の半径（メートル）（仮） */
export const RIVAL_TERRITORY_M = 45;
/** ライバルが陣取るスポットの数（地区ごと）（仮） */
export const RIVAL_CLAIMS_PER_DISTRICT = 4;

/** 陣地の計算に使うスポット */
export interface TerritorySpot {
  readonly id: string;
  readonly districtId: string;
  readonly visitCount: number;
}

/** 陣地の計算に使う地区 */
export interface TerritoryDistrict {
  readonly id: string;
  readonly level: number;
  readonly isLordMe: boolean;
  readonly lordName?: string;
}

/** 陣地の旗（陣取りしたスポット） */
export interface TerritoryClaim {
  readonly spotId: string;
  readonly col: number;
  readonly row: number;
  readonly radiusM: number;
  readonly owner: typeof TERRITORY_MINE | typeof TERRITORY_RIVAL;
}

/** 陣地 */
export interface TerritoryModel {
  /** セルごとの陣地（TERRITORY_*） */
  readonly cells: Uint8Array;
  readonly mineCount: number;
  readonly rivalCount: number;
  /** 地区ID → 自分の陣地のマス数 */
  readonly mineByDistrict: ReadonlyMap<string, number>;
  /** 地区ID → 地区の陸のマス数（陣地の割合の分母） */
  readonly landByDistrict: ReadonlyMap<string, number>;
  readonly claims: readonly TerritoryClaim[];
  /** 自分の陣地の境界線（セル座標の線分 [c0, r0, c1, r1, ...]） */
  readonly mineEdges: Float32Array;
  /** ライバルの陣地の境界線（同上） */
  readonly rivalEdges: Float32Array;
}

/**
 * 訪問回数と地区の成長段階から、陣地の半径（メートル）を決める。
 * @param visitCount そのスポットの訪問回数（1 以上）
 * @param level 地区の成長段階（0..3）
 * @returns 半径（メートル）
 */
export function territoryRadiusM(visitCount: number, level: number): number {
  const log = logger.fn('territoryRadiusM', { visitCount, level });
  if (visitCount <= 0) return log.exit(0);
  const extra = Math.min(TERRITORY_MAX_EXTRA_VISITS, visitCount - 1);
  return log.exit(TERRITORY_BASE_M + extra * TERRITORY_PER_VISIT_M + Math.max(0, level) * TERRITORY_PER_LEVEL_M);
}

/**
 * 陣地を計算する（自分 → ライバルの順。ライバルは自分の陣地を上書きしない）。
 * @param grid 街
 * @param spots スポット（訪問回数つき）
 * @param districts 地区（成長段階・地区の主）
 * @returns 陣地
 */
export function computeTerritory(grid: TownGrid, spots: readonly TerritorySpot[], districts: readonly TerritoryDistrict[]): TerritoryModel {
  const log = logger.fn('computeTerritory', { spots: spots.length, districts: districts.length });
  const cells = new Uint8Array(grid.cols * grid.rows);
  const levelOf = new Map(districts.map((d) => [d.id, d.level]));
  const claims: TerritoryClaim[] = [];
  for (const spot of spots) {
    if (spot.visitCount <= 0) continue;
    const anchor = grid.anchors.get(spot.id);
    if (anchor === undefined) continue;
    const radiusM = territoryRadiusM(spot.visitCount, levelOf.get(spot.districtId) ?? 0);
    paintDisc(grid, cells, anchor.col, anchor.row, radiusM, TERRITORY_MINE);
    claims.push({ spotId: spot.id, col: anchor.col, row: anchor.row, radiusM, owner: TERRITORY_MINE });
  }
  for (const district of districts) {
    if (district.isLordMe || district.lordName === undefined) continue;
    for (const spot of rivalSpotsOf(spots, district.id)) {
      const anchor = grid.anchors.get(spot.id);
      if (anchor === undefined) continue;
      paintDisc(grid, cells, anchor.col, anchor.row, RIVAL_TERRITORY_M, TERRITORY_RIVAL);
      claims.push({ spotId: spot.id, col: anchor.col, row: anchor.row, radiusM: RIVAL_TERRITORY_M, owner: TERRITORY_RIVAL });
    }
  }
  const counts = countCells(grid, cells);
  const model: TerritoryModel = {
    cells,
    mineCount: counts.mine,
    rivalCount: counts.rival,
    mineByDistrict: counts.mineByDistrict,
    landByDistrict: counts.landByDistrict,
    claims,
    mineEdges: edgesOf(grid, cells, TERRITORY_MINE),
    rivalEdges: edgesOf(grid, cells, TERRITORY_RIVAL),
  };
  return log.exit(model, `自分 ${counts.mine} マス・ライバル ${counts.rival} マス`);
}

/**
 * ライバルが陣取るスポットを地区から選ぶ（自分が訪問していないスポットから、ID のハッシュ順に決定論的に）。
 * @param spots スポット
 * @param districtId 地区ID
 * @returns 選んだスポット
 */
export function rivalSpotsOf(spots: readonly TerritorySpot[], districtId: string): TerritorySpot[] {
  const log = logger.fn('rivalSpotsOf', { districtId });
  const picked = spots
    .filter((s) => s.districtId === districtId && s.visitCount === 0)
    .sort((a, b) => hashString(`${districtId}:${a.id}`) - hashString(`${districtId}:${b.id}`))
    .slice(0, RIVAL_CLAIMS_PER_DISTRICT);
  return log.exit(picked, `${picked.length} 件`);
}

/**
 * 円の中の陸のセルを陣地にする（自分の陣地はライバルで上書きしない）。
 * @param grid 街
 * @param cells 陣地
 * @param col 中心の列
 * @param row 中心の行
 * @param radiusM 半径（メートル）
 * @param owner 陣地の持ち主
 * @sideEffect cells を書き換える
 */
function paintDisc(grid: TownGrid, cells: Uint8Array, col: number, row: number, radiusM: number, owner: number): void { // audit-ignore: fnlog-missing 内部ヘルパー（computeTerritory でまとめてログ）
  const r = radiusM / CELL_M;
  const rr = r * r;
  const span = Math.ceil(r);
  for (let dr = -span; dr <= span; dr++) {
    for (let dc = -span; dc <= span; dc++) {
      if (dc * dc + dr * dr > rr) continue;
      const c = col + dc;
      const w = row + dr;
      if (c < 0 || w < 0 || c >= grid.cols || w >= grid.rows) continue;
      const i = w * grid.cols + c;
      const kind = grid.kinds[i];
      if (kind === Cell.WATER || kind === Cell.BANK) continue;
      if (owner === TERRITORY_RIVAL && cells[i] === TERRITORY_MINE) continue;
      cells[i] = owner;
    }
  }
}

/**
 * 陣地のマス数（全体・地区ごと）を数える。
 * @param grid 街
 * @param cells 陣地
 * @returns 自分・ライバルのマス数と地区ごとの自分のマス数
 */
function countCells(grid: TownGrid, cells: Uint8Array): { mine: number; rival: number; mineByDistrict: Map<string, number>; landByDistrict: Map<string, number> } {
  const log = logger.fn('countCells');
  let mine = 0;
  let rival = 0;
  const byIndex = new Map<number, number>();
  const landIndex = new Map<number, number>();
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    const dist = grid.district[i] ?? 0;
    const kind = grid.kinds[i];
    if (dist > 0 && kind !== Cell.WATER && kind !== Cell.BANK) landIndex.set(dist, (landIndex.get(dist) ?? 0) + 1);
    if (v === TERRITORY_RIVAL) rival++;
    if (v !== TERRITORY_MINE) continue;
    mine++;
    const d = grid.district[i] ?? 0;
    if (d > 0) byIndex.set(d, (byIndex.get(d) ?? 0) + 1);
  }
  const mineByDistrict = new Map<string, number>();
  for (const [d, n] of byIndex) {
    const id = grid.districtIds[d - 1];
    if (id !== undefined) mineByDistrict.set(id, n);
  }
  const landByDistrict = new Map<string, number>();
  for (const [d, n] of landIndex) {
    const id = grid.districtIds[d - 1];
    if (id !== undefined) landByDistrict.set(id, n);
  }
  return log.exit({ mine, rival, mineByDistrict, landByDistrict });
}

/**
 * 陣地の境界線を、縦横につながる線分にまとめて返す（セル座標）。
 * @param grid 街
 * @param cells 陣地
 * @param owner 持ち主
 * @returns [c0, r0, c1, r1, ...]
 */
export function edgesOf(grid: Pick<TownGrid, 'cols' | 'rows'>, cells: Uint8Array, owner: number): Float32Array {
  const log = logger.fn('edgesOf', { owner });
  const out: number[] = [];
  /**
   * そのセルが持ち主の陣地か（範囲外は陣地でない）。
   * @param c 列
   * @param r 行
   * @returns 陣地なら true
   */
  const at = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && cells[r * grid.cols + c] === owner; // audit-ignore: fnlog-missing 境界を調べるセルごとの判定
  // 横の辺（セルの上辺・下辺）
  for (let r = 0; r <= grid.rows; r++) {
    let start = -1;
    for (let c = 0; c <= grid.cols; c++) {
      const edge = c < grid.cols && at(c, r) !== at(c, r - 1);
      if (edge && start < 0) start = c;
      if (!edge && start >= 0) {
        out.push(start, r, c, r);
        start = -1;
      }
    }
  }
  // 縦の辺（セルの左辺・右辺）
  for (let c = 0; c <= grid.cols; c++) {
    let start = -1;
    for (let r = 0; r <= grid.rows; r++) {
      const edge = r < grid.rows && at(c, r) !== at(c - 1, r);
      if (edge && start < 0) start = r;
      if (!edge && start >= 0) {
        out.push(c, start, c, r);
        start = -1;
      }
    }
  }
  return log.exit(Float32Array.from(out), `${out.length / 4} 本`);
}

/**
 * 前回より増えた自分の陣地のセルを、中心から近い順に返す（陣取りの演出に使う）。
 * @param grid 街
 * @param before 前回の陣地（無ければ空とみなす）
 * @param after 今回の陣地
 * @param center 演出の中心セル（チェックインしたスポット）
 * @returns 増えたセルの添字（近い順）と、中心からの距離の最大（セル）
 */
export function newlyClaimed(grid: Pick<TownGrid, 'cols'>, before: Uint8Array | undefined, after: Uint8Array, center: { col: number; row: number }): { cells: number[]; maxDist: number } {
  const log = logger.fn('newlyClaimed');
  const added: { i: number; d: number }[] = [];
  for (let i = 0; i < after.length; i++) {
    if (after[i] !== TERRITORY_MINE || before?.[i] === TERRITORY_MINE) continue;
    const c = i % grid.cols;
    const r = (i - c) / grid.cols;
    added.push({ i, d: Math.hypot(c - center.col, r - center.row) });
  }
  added.sort((a, b) => a.d - b.d);
  const maxDist = added.length === 0 ? 0 : (added[added.length - 1]?.d ?? 0);
  return log.exit({ cells: added.map((a) => a.i), maxDist }, `${added.length} マス`);
}

/**
 * 陣地が無いとき用の空の陣地。
 * @param grid 街
 * @returns 空の陣地
 */
export function emptyTerritory(grid: Pick<TownGrid, 'cols' | 'rows'>): TerritoryModel {
  const log = logger.fn('emptyTerritory');
  return log.exit({
    cells: new Uint8Array(grid.cols * grid.rows).fill(TERRITORY_NONE),
    mineCount: 0,
    rivalCount: 0,
    mineByDistrict: new Map(),
    landByDistrict: new Map(),
    claims: [],
    mineEdges: new Float32Array(0),
    rivalEdges: new Float32Array(0),
  });
}
