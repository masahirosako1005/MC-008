/**
 * @file 広域のイラストの街の「決めごと」（presentation/screens/Map/town 層。純粋関数）
 * 2026-11-10 ユーザー指示「広域表示のときのグレー部分の背景が殺風景なので、イラストなどを用いて楽しそうな町に」
 * 「陣取りで街の活性とともに、陣地がとられていくと街が廃れていく感じに。演出も」。
 * 絵を描く wideIllustration / wideIllustrationArt が使う、描かない部分（キャッシュの解像度の段・雰囲気ごとの見え方・
 * 切り替わりの波・川と高架の道筋・飾りを置く場所）をここに置く。乱数は使わず、セルの番号のハッシュで決める。座標はログに出さない。
 */
import { createLogger } from '@/Common/logging/logger';
import { hash01 } from '@/presentation/screens/Map/town/townGenerator';
import { CELL_M, Cell, OVERLAY_STATION, OVERLAY_VIADUCT, latLngToCell } from '@/presentation/screens/Map/town/townTypes';
import type { TownBuilding, TownGrid } from '@/presentation/screens/Map/town/townTypes';
import type { DistrictMood } from '@/presentation/screens/Map/town/vitality';

const logger = createLogger('presentation/screens/Map/town/wideIllustrationModel');

/** キャッシュの解像度の段（1セルあたりのキャンバス px）。縮尺と画面の密度に合う段を選ぶ */
export const LEVELS_PX_PER_CELL: readonly number[] = [1.6, 2.4, 3.6, 5.2];
/** 選んだ段をどこまで引き伸ばしてよいか（これより粗くなるなら1つ上の段） */
export const LEVEL_UPSCALE_OK = 1.15;
/** 雰囲気の切り替わりの長さ（ミリ秒） */
export const TRANSITION_MS = 1600;
/** 飾りを地区の中心からこれより離して置く（メートル。王者の台座と札の場所を空ける） */
export const DECOR_CENTER_CLEARANCE_M = 95;

/** 地区の見え方（雰囲気から決める。切り替わりのときは混ぜる） */
export interface DistrictLook {
  /** 彩度を落とす量 0..1 */
  readonly desat: number;
  /** 茶色くくすませる量 0..1 */
  readonly brown: number;
  /** 暖かい光で明るくする量 0..1 */
  readonly glow: number;
  /** にぎわいの飾り（提灯・のぼり・花・風船・花火）の濃さ 0..1 */
  readonly lively: number;
  /** 廃れの飾り（シャッター・枯れ木・雑草・ひび・雨雲・カラス）の濃さ 0..1 */
  readonly decay: number;
}

/** セル座標の点 */
export interface CellPoint {
  readonly col: number;
  readonly row: number;
}

/** 飾りの種類 */
export type DecorKind = 'lantern' | 'nobori' | 'flowers' | 'chimney' | 'balloon' | 'shutter' | 'withered' | 'weeds' | 'crack';

/** 飾り1つ（セル座標。建物に付くものは建物の大きさも持つ） */
export interface DecorItem {
  readonly kind: DecorKind;
  readonly col: number;
  readonly row: number;
  /** 建物の幅・高さ（セル。建物に付く飾りだけ） */
  readonly w?: number;
  readonly h?: number;
  /** 提灯の列の長さ（セル。lantern だけ） */
  readonly span?: number;
  /** ばらつき 0..1 */
  readonly seed: number;
  /** 地区の中心からの距離（セル。切り替わりの波が届く順） */
  readonly dist: number;
}

/** 地区ごとの飾りと、雨雲・風船の場所 */
export interface DistrictDecor {
  readonly items: readonly DecorItem[];
  /** 雨雲を浮かべる所（中心から少し離れた所） */
  readonly cloudAt: CellPoint;
  /** 中心から縁までのいちばん遠い距離（セル。切り替わりの波の半径） */
  readonly reachCells: number;
  /** 地区の中心（セル） */
  readonly center: CellPoint;
}

/**
 * 画面の密度に合うキャッシュの段を選ぶ。
 * @param deviceCellPx 1セルが画面で何デバイス px か
 * @returns LEVELS_PX_PER_CELL の添字
 */
export function chooseLevel(deviceCellPx: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  for (let i = 0; i < LEVELS_PX_PER_CELL.length; i++) {
    if ((LEVELS_PX_PER_CELL[i] ?? 0) * LEVEL_UPSCALE_OK >= deviceCellPx) return i;
  }
  return LEVELS_PX_PER_CELL.length - 1;
}

/**
 * 雰囲気と活気から地区の見え方を決める。
 * @param mood 雰囲気
 * @param vitality 活気 0..1
 * @returns 見え方
 */
export function lookOf(mood: DistrictMood, vitality: number): DistrictLook {
  const log = logger.fn('lookOf', { mood, vitality });
  const v = Math.min(1, Math.max(0, vitality));
  if (mood === 'lively') return log.exit({ desat: 0, brown: 0, glow: 0.4 + v * 0.4, lively: 0.7 + v * 0.3, decay: 0 });
  if (mood === 'decaying') {
    const k = Math.min(1, Math.max(0.55, 1 - v));
    return log.exit({ desat: 0.45 + k * 0.32, brown: 0.25 + k * 0.35, glow: 0, lively: 0, decay: k });
  }
  return log.exit({ desat: 0.18, brown: 0, glow: 0, lively: 0.12, decay: 0 });
}

/** 雰囲気の分からない地区の見え方（ふつう） */
export const CALM_LOOK: DistrictLook = { desat: 0.18, brown: 0, glow: 0, lively: 0.12, decay: 0 };

/**
 * 2つの見え方を混ぜる。
 * @param a 前
 * @param b 後
 * @param k 0..1（1 で後）
 * @returns 混ぜた見え方
 */
export function mixLook(a: DistrictLook, b: DistrictLook, k: number): DistrictLook { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const t = Math.min(1, Math.max(0, k));
  return {
    desat: a.desat + (b.desat - a.desat) * t,
    brown: a.brown + (b.brown - a.brown) * t,
    glow: a.glow + (b.glow - a.glow) * t,
    lively: a.lively + (b.lively - a.lively) * t,
    decay: a.decay + (b.decay - a.decay) * t,
  };
}

/**
 * 見え方が（見て分かるほど）違うか。
 * @param a 見え方
 * @param b 見え方
 * @returns 違えば true
 */
export function looksDiffer(a: DistrictLook, b: DistrictLook): boolean {
  const log = logger.fn('looksDiffer');
  const d = Math.abs(a.desat - b.desat) + Math.abs(a.brown - b.brown) + Math.abs(a.glow - b.glow) + Math.abs(a.lively - b.lively) + Math.abs(a.decay - b.decay);
  return log.exit(d > 0.05);
}

/**
 * 切り替わりの波の進み（0..1。ゆっくり止まる）。
 * @param startedAt 始めた時刻（ミリ秒）
 * @param now 現在時刻（ミリ秒）
 * @returns 0..1（始まる前は 0、終われば 1）
 */
export function waveProgress(startedAt: number, now: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const k = Math.min(1, Math.max(0, (now - startedAt) / TRANSITION_MS));
  return 1 - (1 - k) ** 3;
}

/**
 * 見え方が「よくなった」か（色が戻る波か、色が抜ける波か）。
 * @param from 前
 * @param to 後
 * @returns よくなったら true
 */
export function isUplift(from: DistrictLook, to: DistrictLook): boolean {
  const log = logger.fn('isUplift');
  /**
   * 見え方のよさの点数（明るさ・にぎわいから、くすみ・廃れを引く）。
   * @param l 見え方
   * @returns 点数
   */
  const score = (l: DistrictLook): number => l.glow + l.lively - l.desat - l.brown - l.decay; // audit-ignore: fnlog-missing 比べるための小さな採点
  return log.exit(score(to) >= score(from));
}

/**
 * 川の中心線を、縦に流れる川と横に流れる川の折れ線として取り出す（小舟を浮かべる道筋）。
 * 行ごとの細い水の帯の真ん中（縦の川）と、列ごとの細い水の帯の真ん中（横の川）を集め、間引いてつなぐ。
 * @param grid 街
 * @param maxWidthCells 川とみなす帯の最大幅（セル）
 * @param stepCells 間引く間隔（セル）
 * @returns 折れ線（セル座標）。川が無ければ空
 */
export function riverPathsOf(grid: Pick<TownGrid, 'cols' | 'rows' | 'kinds'>, maxWidthCells = 30, stepCells = 8): CellPoint[][] {
  const log = logger.fn('riverPathsOf', { cols: grid.cols, rows: grid.rows });
  /**
   * そのセルが川か。
   * @param c 列
   * @param r 行
   * @returns 川なら true
   */
  const water = (c: number, r: number): boolean => grid.kinds[r * grid.cols + c] === Cell.WATER; // audit-ignore: fnlog-missing セルごとの判定
  const vertical: CellPoint[] = [];
  for (let r = 0; r < grid.rows; r += stepCells) {
    for (const run of runsOf(grid.cols, (c) => water(c, r))) if (run.len <= maxWidthCells && run.len >= 3) vertical.push({ col: run.start + run.len / 2, row: r + 0.5 });
  }
  const horizontal: CellPoint[] = [];
  for (let c = 0; c < grid.cols; c += stepCells) {
    for (const run of runsOf(grid.rows, (r) => water(c, r))) if (run.len <= maxWidthCells && run.len >= 3) horizontal.push({ col: c + 0.5, row: run.start + run.len / 2 });
  }
  const paths = [splitPath(vertical, stepCells * 2.5), splitPath(horizontal, stepCells * 2.5)].flat().filter((p) => p.length >= 4);
  return log.exit(paths, `${paths.length} 本`);
}

/**
 * 1列の中で条件を満たす連続した区間を返す。
 * @param n 長さ
 * @param test 条件
 * @returns 区間（始まりと長さ）
 */
function runsOf(n: number, test: (i: number) => boolean): { start: number; len: number }[] { // audit-ignore: fnlog-missing 川の取り出しで何百回も呼ぶ内部ヘルパー
  const out: { start: number; len: number }[] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && test(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push({ start, len: i - start });
      start = -1;
    }
  }
  return out;
}

/**
 * 並んだ点を、間が離れすぎた所で切って折れ線に分ける。
 * @param points 点（並び順）
 * @param maxGap これより離れたら切る（セル）
 * @returns 折れ線
 */
function splitPath(points: readonly CellPoint[], maxGap: number): CellPoint[][] { // audit-ignore: fnlog-missing 川の取り出しで呼ぶ内部ヘルパー
  const out: CellPoint[][] = [];
  let cur: CellPoint[] = [];
  for (const p of points) {
    const last = cur[cur.length - 1];
    if (last !== undefined && Math.hypot(p.col - last.col, p.row - last.row) > maxGap) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/**
 * 高架（線路）の線と駅の範囲を返す（小さな電車を走らせる）。
 * @param grid 街
 * @returns 高架の中心の行・西端と東端の列・駅の列の範囲。無ければ undefined
 */
export function viaductLineOf(grid: Pick<TownGrid, 'cols' | 'rows' | 'overlay'>): { row: number; col0: number; col1: number; station?: { col0: number; col1: number } } | undefined {
  const log = logger.fn('viaductLineOf');
  let rowSum = 0;
  let rowN = 0;
  let col0 = Number.POSITIVE_INFINITY;
  let col1 = -1;
  let s0 = Number.POSITIVE_INFINITY;
  let s1 = -1;
  for (let i = 0; i < grid.overlay.length; i++) {
    const o = grid.overlay[i] ?? 0;
    if ((o & OVERLAY_VIADUCT) === 0) continue;
    const c = i % grid.cols;
    rowSum += (i - c) / grid.cols;
    rowN++;
    col0 = Math.min(col0, c);
    col1 = Math.max(col1, c);
    if ((o & OVERLAY_STATION) !== 0) {
      s0 = Math.min(s0, c);
      s1 = Math.max(s1, c);
    }
  }
  if (rowN === 0) return log.exit(undefined, '高架なし');
  return log.exit({ row: rowSum / rowN + 0.5, col0, col1: col1 + 1, ...(s1 >= 0 ? { station: { col0: s0, col1: s1 + 1 } } : {}) });
}

/**
 * 地区の多角形（緯度経度）をセル座標にする。
 * @param grid 街
 * @param polygon 多角形
 * @returns セル座標の多角形
 */
export function polygonToCells(grid: Pick<TownGrid, 'originLat' | 'originLng' | 'metersPerDegLng'>, polygon: readonly { readonly lat: number; readonly lng: number }[]): CellPoint[] {
  const log = logger.fn('polygonToCells', { points: polygon.length });
  return log.exit(polygon.map((ll) => latLngToCell(grid, ll)));
}

/** 絵の家・木を置く1か所（セル座標。広域では建物を1棟ずつ描かず、間引いた所にかわいい家を大きめに描く） */
export interface HouseSlot {
  readonly col: number;
  readonly row: number;
  readonly kind: 'house' | 'tree';
  readonly style: TownBuilding['style'];
  readonly roof: number;
  /** 地区の番号（0=地区の外） */
  readonly district: number;
  readonly seed: number;
}

/** 背の高い箱の建物 */
const TALL_STYLES = new Set(['apartment', 'mansion', 'office']);
/** 家を置く間隔（セル。地区の中は密に、外はゆったり）（仮） */
export const SLOT_SPACING = { inside: { dx: 9, dy: 7 }, outside: { dx: 12, dy: 10 } } as const;

/**
 * 広域に描く家と木の場所を決める（ずらした格子の点のうち、建物の上にある所だけ。外は所々を木と空き地にする）。
 * @param grid 街
 * @returns 奥（北）から手前（南）の順に並べた場所
 */
export function houseSlotsOf(grid: Pick<TownGrid, 'cols' | 'rows' | 'kinds' | 'district' | 'buildingAt' | 'buildings'>): HouseSlot[] {
  const log = logger.fn('houseSlotsOf', { cols: grid.cols, rows: grid.rows });
  const out: HouseSlot[] = [];
  const used = new Set<number>();
  for (const zone of ['inside', 'outside'] as const) {
    const { dx, dy } = SLOT_SPACING[zone];
    for (let r = 2, line = 0; r < grid.rows - 2; r += dy, line++) {
      for (let c = 2 + (line % 2) * Math.floor(dx / 2); c < grid.cols - 2; c += dx) {
        const col = Math.round(c + (hash01(c, r, 41) - 0.5) * 3);
        const row = Math.round(r + (hash01(c, r, 42) - 0.5) * 2);
        const i = row * grid.cols + col;
        const district = grid.district[i] ?? 0;
        if ((zone === 'inside') !== district > 0) continue;
        const b = grid.buildingAt[i] ?? -1;
        const building = b >= 0 ? grid.buildings[b] : undefined;
        if (building === undefined || used.has(b) || building.style === 'station') continue;
        const h = hash01(c, r, 43);
        if (zone === 'outside' && h < 0.18) continue;
        used.add(b);
        const kind = h < (zone === 'outside' ? 0.4 : 0.26) && h >= (zone === 'outside' ? 0.18 : 0.2) ? 'tree' : 'house';
        // 地区の外は白い箱（マンション・事務所）ばかりにならないよう、多くを小さな家にする
        const style = zone === 'outside' && TALL_STYLES.has(building.style) && hash01(c, r, 45) < 0.7 ? (hash01(c, r, 46) < 0.5 ? 'house' : 'kawaraHouse') : building.style;
        out.push({ col, row, kind, style, roof: building.roof, district, seed: hash01(c, r, 44) });
      }
    }
  }
  out.sort((a, b) => a.row - b.row || a.col - b.col);
  return log.exit(out, `${out.length} か所`);
}

/**
 * 場所を 32 セル四方の箱に分ける（タイルを焼くとき、近くの場所だけを描く）。
 * @param slots 場所
 * @param bucketCells 箱の一辺（セル）
 * @returns 箱のキー（"bx,by"）→ 場所（奥から手前の順のまま）
 */
export function bucketSlots(slots: readonly HouseSlot[], bucketCells = 32): Map<string, HouseSlot[]> {
  const log = logger.fn('bucketSlots', { slots: slots.length });
  const out = new Map<string, HouseSlot[]>();
  for (const s of slots) {
    const key = `${Math.floor(s.col / bucketCells)},${Math.floor(s.row / bucketCells)}`;
    const list = out.get(key);
    if (list === undefined) out.set(key, [s]);
    else list.push(s);
  }
  return log.exit(out, `${out.size} 箱`);
}

/**
 * 建物を 32 セル四方の箱に分けて引けるようにする（タイルを焼くとき、近くの建物だけを描く）。
 * @param grid 街
 * @param bucketCells 箱の一辺（セル）
 * @returns 箱のキー（"bx,by"）→ 建物の添字
 */
export function bucketBuildings(grid: Pick<TownGrid, 'buildings'>, bucketCells = 32): Map<string, number[]> {
  const log = logger.fn('bucketBuildings', { buildings: grid.buildings.length });
  const out = new Map<string, number[]>();
  grid.buildings.forEach((b, i) => {
    const key = `${Math.floor(b.col / bucketCells)},${Math.floor(b.row / bucketCells)}`;
    const list = out.get(key);
    if (list === undefined) out.set(key, [i]);
    else list.push(i);
  });
  return log.exit(out, `${out.size} 箱`);
}

/** 飾りを選ぶときの数（地区ごと）（仮） */
// 家に付く飾り（シャッター・煙突の煙・屋根のひび）は、家を描かなくなったので 0（2026-11-10 ユーザー指示「手書き風の家のアイコンは削除」）
const DECOR_COUNTS: Readonly<Record<DecorKind, number>> = { lantern: 3, nobori: 5, flowers: 8, chimney: 0, balloon: 2, shutter: 0, withered: 7, weeds: 9, crack: 0 };
/** お店らしい建物（のぼり・シャッター） */
const SHOP_STYLES = new Set(['shophouse', 'stall', 'cafe', 'nagaya']);
/** 屋根のある家（煙突・ひび） */
const HOUSE_STYLES = new Set(['house', 'kawaraHouse', 'nagaya', 'shophouse']);

/**
 * 地区の飾りの置き場所を決める（中心の台座のまわりは空ける。同じ街なら毎回同じ場所）。
 * @param grid 街
 * @param districtNumber 地区の番号（1..n）
 * @param polygon 地区の多角形（セル座標）
 * @param center 地区の中心（セル座標）
 * @returns 飾り
 */
export function decorOf(grid: TownGrid, districtNumber: number, polygon: readonly CellPoint[], center: CellPoint): DistrictDecor {
  const log = logger.fn('decorOf', { districtNumber });
  const clear = DECOR_CENTER_CLEARANCE_M / CELL_M;
  const reachCells = polygon.reduce((m, p) => Math.max(m, Math.hypot(p.col - center.col, p.row - center.row)), 1);
  /**
   * 地区の中心からの距離（セル）。
   * @param col 列
   * @param row 行
   * @returns 距離
   */
  const dist = (col: number, row: number): number => Math.hypot(col - center.col, row - center.row); // audit-ignore: fnlog-missing 飾りを選ぶときの距離
  const buildings = grid.buildings
    .map((b, i) => ({ b, i, d: dist(b.col + b.w / 2, b.row + b.h / 2) }))
    .filter((x) => x.b.district === districtNumber && x.d > clear);
  const items: DecorItem[] = [];
  /**
   * 建物の候補から、決まった順（ハッシュ）で飾りを選んで足す。
   * @param kind 飾りの種類
   * @param list 候補の建物
   * @param salt ハッシュの塩
   * @sideEffect items に足す
   */
  const pick = (kind: DecorKind, list: readonly { b: TownBuilding; i: number; d: number }[], salt: number): void => { // audit-ignore: fnlog-missing 飾りを選ぶ内部ヘルパー
    const chosen = [...list].sort((a, z) => hash01(a.i, salt) - hash01(z.i, salt)).slice(0, DECOR_COUNTS[kind]);
    for (const x of chosen) items.push({ kind, col: x.b.col, row: x.b.row, w: x.b.w, h: x.b.h, seed: hash01(x.i, salt + 1), dist: x.d });
  };
  pick('nobori', buildings.filter((x) => SHOP_STYLES.has(x.b.style)), 11);
  pick('shutter', buildings.filter((x) => SHOP_STYLES.has(x.b.style) || x.b.style === 'house'), 12);
  pick('chimney', buildings.filter((x) => HOUSE_STYLES.has(x.b.style)), 13);
  pick('crack', buildings.filter((x) => HOUSE_STYLES.has(x.b.style)), 14);
  pick('balloon', buildings.filter((x) => x.d < reachCells * 0.65), 15);
  for (const kind of ['flowers', 'withered', 'weeds', 'lantern'] as const) items.push(...cellDecor(grid, districtNumber, center, clear, kind));
  const cloud = buildings.filter((x) => x.d > reachCells * 0.25 && x.d < reachCells * 0.6).sort((a, z) => hash01(a.i, 17) - hash01(z.i, 17))[0];
  const cloudAt = cloud === undefined ? center : { col: cloud.b.col + cloud.b.w / 2, row: cloud.b.row };
  return log.exit({ items, cloudAt, reachCells, center }, `${items.length} 個`);
}

/**
 * セルに置く飾り（花＝公園・庭、枯れ木＝木、雑草＝空き地・道、提灯＝商店街・大通り）を選ぶ。
 * @param grid 街
 * @param districtNumber 地区の番号
 * @param center 地区の中心（セル）
 * @param clear 中心から空ける距離（セル）
 * @param kind 飾りの種類
 * @returns 飾り
 */
function cellDecor(grid: TownGrid, districtNumber: number, center: CellPoint, clear: number, kind: 'flowers' | 'withered' | 'weeds' | 'lantern'): DecorItem[] { // audit-ignore: fnlog-missing 地区ごとに4回呼ぶ内部ヘルパー（decorOf でまとめてログ）
  const want: Readonly<Record<typeof kind, readonly number[]>> = {
    flowers: [Cell.PARK, Cell.GARDEN, Cell.PLAZA],
    withered: [Cell.TREE, Cell.SAKURA],
    weeds: [Cell.GRASS, Cell.LOT, Cell.ROAD, Cell.PARKING],
    lantern: [Cell.ARCADE, Cell.AVENUE, Cell.ROAD],
  };
  const kinds = new Set(want[kind]);
  const salt = kind.length * 31 + districtNumber;
  const cands: { col: number; row: number; h: number; d: number; span: number }[] = [];
  for (let r = 1; r < grid.rows - 1; r += 3) {
    for (let c = 1; c < grid.cols - 1; c += 3) {
      const i = r * grid.cols + c;
      if (grid.district[i] !== districtNumber || !kinds.has(grid.kinds[i] ?? -1)) continue;
      const d = Math.hypot(c - center.col, r - center.row);
      if (d <= clear) continue;
      const span = kind === 'lantern' ? streetSpan(grid, c, r, kinds) : 0;
      if (kind === 'lantern' && span < 14) continue;
      cands.push({ col: c, row: r, h: hash01(c, r, salt), d, span });
    }
  }
  cands.sort((a, b) => a.h - b.h);
  const out: DecorItem[] = [];
  for (const x of cands) {
    if (out.length >= DECOR_COUNTS[kind]) break;
    // 同じ種類の飾りどうしは離す（ひとかたまりにならないように）
    if (out.some((o) => Math.hypot(o.col - x.col, o.row - x.row) < (kind === 'lantern' ? 30 : 12))) continue;
    out.push({ kind, col: x.col + 0.5, row: x.row + 0.5, seed: x.h, dist: x.d, ...(kind === 'lantern' ? { span: Math.min(28, x.span) } : {}) });
  }
  return out;
}

/**
 * その道のセルから東へ、同じ種類の道がどこまで続くか（提灯の列を張れる長さ）。
 * @param grid 街
 * @param col 列
 * @param row 行
 * @param kinds 道とみなす種類
 * @returns 続くセルの数
 */
function streetSpan(grid: TownGrid, col: number, row: number, kinds: ReadonlySet<number>): number { // audit-ignore: fnlog-missing 提灯の候補ごとに呼ぶ内部ヘルパー
  let n = 0;
  while (col + n < grid.cols && n < 40 && kinds.has(grid.kinds[row * grid.cols + col + n] ?? -1)) n++;
  return n;
}
