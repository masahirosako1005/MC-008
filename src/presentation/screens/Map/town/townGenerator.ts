/**
 * @file オリジナル地図「ドット絵の街」の生成（presentation/screens/Map/town 層。純粋関数・決定論的）
 * 実在の道路・川（OSM）は使わず、市域の大きさ・地区の形・スポットの位置だけから、5m 四方のセルで架空の下町を組み立てる。
 * 手順: 川 → 名所まわりの特別な区画（公園・境内・市場・桜の通り抜け・路地） → 道路網（大通り・商店街・通り・路地） → 川沿いの遊歩道 → 高架の線路 →
 *       スポットと公衆トイレの敷地（実際の位置にいちばん近い空き地。入口から道へ小道をつなぐ） → 建物で街区を埋める → 残りを木・花壇・駐輪場に。
 * 市域の外側にも TOWN_MARGIN_M だけ街を続け、どこへ動かしても地図が途切れないようにする（2026-11-09 ユーザー指示）。
 * 乱数は使わずセル座標のハッシュで決める（同じ入力なら毎回同じ街）。位置座標はログに出さない（件数だけ）。
 */
import { createLogger } from '@/Common/logging/logger';
import { pointInPolygon } from '@/Common/ui/canvas/geometry';
import { CELL_M, Cell, OVERLAY_STATION, OVERLAY_VIADUCT, TOWN_MARGIN_M, cellIndex, isStreet, isWalkable } from '@/presentation/screens/Map/town/townTypes';
import type { BuildingStyle, TownAnchor, TownBuilding, TownGrid, TownTheme } from '@/presentation/screens/Map/town/townTypes';

const logger = createLogger('presentation/screens/Map/town/townGenerator');

/** 緯度1度あたりのメートル（MapViewModel と同じ近似） */
const M_PER_DEG_LAT = 111_000;

// ---------------------------------------------------------------------------
// 街の設計値（市域の幅 W・高さ H に対する割合。市域の北西の角が (0,0)、x は東、y は南へ増えるメートル）
// ---------------------------------------------------------------------------

/** 東の川の中心線（市域の東端からの距離・メートル） */
const EAST_RIVER_FROM_EAST_M = 160;
/** 東の川の幅（メートル） */
const EAST_RIVER_WIDTH_M = 80; // audit-ignore: magic-radius 川の幅（発見・訪問の距離ルールではない）
/** 南の川の中心線（市域の南端からの距離・メートル） */
const SOUTH_RIVER_FROM_SOUTH_M = 165;
/** 南の川の幅（メートル） */
const SOUTH_RIVER_WIDTH_M = 70;
/** 川の蛇行の振れ幅（メートル） */
const RIVER_MEANDER_M = 30;
/** 商店街（南北の歩行者天国）の中心（市域の幅に対する割合） */
const ARCADE_X_RATIO = 0.4425;
/** 商店街の南北の範囲（市域の高さに対する割合） */
const ARCADE_Y_RANGE: readonly [number, number] = [0.012, 0.86];
/** 南北の大通りの中心（割合） */
const AVENUE_X_RATIOS: readonly number[] = [0.289, 0.657];
/** 東西の大通りの中心（割合） */
const AVENUE_Y_RATIOS: readonly number[] = [0.228, 0.514];
/** 南北の通りの間隔（メートル） */
const STREET_SPACING_X_M = 80; // audit-ignore: magic-radius 通りの間隔（発見・訪問の距離ルールではない）
/** 東西の通りの間隔（メートル） */
const STREET_SPACING_Y_M = 75;
/** 大通り・商店街からこの距離（メートル）以内の通りは引かない */
const STREET_CLEARANCE_M = 28;
/** 通りの一区間を省く割合（街区に大小をつける） */
const STREET_GAP_RATE = 0.14;
/** 高架の線路の南北位置（割合）と幅（メートル） */
const VIADUCT_Y_RATIO = 0.3777;
const VIADUCT_WIDTH_M = 15;
/** 駅のホームの東西の範囲（割合） */
const STATION_X_RANGE: readonly [number, number] = [0.455, 0.51];

/** 地区IDとテーマの対応（無い地区は order 順にテーマを回す） */
const THEME_BY_DISTRICT: Readonly<Record<string, TownTheme>> = {
  d_minamimori: 'monzen',
  d_tenma: 'market',
  d_tenroku: 'living',
  d_ogimachi: 'alley',
  d_okawa: 'river',
};
/** テーマを回すときの順番 */
const THEME_CYCLE: readonly TownTheme[] = ['monzen', 'market', 'living', 'alley', 'river'];

/**
 * テーマごとの屋根の色（屋根の色の番号: 0赤 1橙 2青緑 3青 4紫 5こげ茶 6瓦 7明るい灰）。
 * 地区ごとに色味をそろえ、街全体がまだらに見えないようにする（同じ番号を重ねて選ばれやすさを調整）。
 */
const ROOF_PALETTES: Readonly<Record<TownTheme, readonly number[]>> = {
  monzen: [6, 6, 6, 5, 6, 7, 0],
  market: [0, 1, 0, 1, 5, 7, 2],
  living: [2, 3, 1, 2, 7, 0, 3],
  alley: [5, 2, 1, 5, 4, 7, 2],
  river: [3, 7, 2, 3, 7, 4, 0],
  city: [7, 3, 6, 7, 2, 7, 5],
};
/** 小さな公園（街区1つ分の緑地）を探す格子の間隔（メートル） */
const POCKET_PARK_SPACING_M = 95;
/** 小さな公園になる割合 */
const POCKET_PARK_RATE = 0.16;

/** 建物の候補（幅・奥行きはセル数、weight は選ばれやすさ） */
interface BuildingPlan {
  readonly style: BuildingStyle;
  readonly w: number;
  readonly h: number;
  readonly weight: number;
}

/** テーマごとの建物の候補（下町らしく小さめの建物を密に並べる） */
const PLANS: Readonly<Record<TownTheme, readonly BuildingPlan[]>> = {
  monzen: [
    { style: 'kawaraHouse', w: 3, h: 3, weight: 5 },
    { style: 'kawaraHouse', w: 4, h: 3, weight: 3 },
    { style: 'nagaya', w: 5, h: 3, weight: 2 },
    { style: 'shophouse', w: 3, h: 3, weight: 3 },
    { style: 'apartment', w: 4, h: 4, weight: 1 },
  ],
  market: [
    { style: 'shophouse', w: 3, h: 3, weight: 5 },
    { style: 'stall', w: 2, h: 2, weight: 3 },
    { style: 'apartment', w: 4, h: 4, weight: 2 },
    { style: 'office', w: 4, h: 4, weight: 1 },
    { style: 'cafe', w: 3, h: 3, weight: 1 },
  ],
  living: [
    { style: 'house', w: 3, h: 3, weight: 5 },
    { style: 'house', w: 3, h: 2, weight: 2 },
    { style: 'apartment', w: 4, h: 4, weight: 3 },
    { style: 'mansion', w: 5, h: 5, weight: 2 },
    { style: 'shophouse', w: 3, h: 3, weight: 1 },
  ],
  alley: [
    { style: 'nagaya', w: 4, h: 2, weight: 4 },
    { style: 'house', w: 2, h: 2, weight: 3 },
    { style: 'house', w: 3, h: 2, weight: 3 },
    { style: 'cafe', w: 3, h: 3, weight: 2 },
    { style: 'shophouse', w: 3, h: 2, weight: 2 },
  ],
  river: [
    { style: 'house', w: 3, h: 3, weight: 3 },
    { style: 'apartment', w: 4, h: 4, weight: 3 },
    { style: 'mansion', w: 5, h: 5, weight: 2 },
    { style: 'cafe', w: 3, h: 3, weight: 2 },
    { style: 'warehouse', w: 4, h: 3, weight: 1 },
  ],
  city: [
    { style: 'office', w: 5, h: 5, weight: 3 },
    { style: 'mansion', w: 5, h: 5, weight: 3 },
    { style: 'apartment', w: 4, h: 4, weight: 3 },
    { style: 'office', w: 4, h: 4, weight: 2 },
    { style: 'shophouse', w: 3, h: 3, weight: 2 },
    { style: 'warehouse', w: 5, h: 4, weight: 1 },
  ],
};

/** 緯度経度（座標はログに出さない） */
export interface GenLatLng {
  readonly lat: number;
  readonly lng: number;
}

/** 生成の入力（地図データから作る） */
export interface TownGenInput {
  readonly bounds: { readonly south: number; readonly west: number; readonly north: number; readonly east: number };
  /** order 順の地区 */
  readonly districts: readonly { readonly id: string; readonly polygon: readonly GenLatLng[] }[];
  readonly spots: readonly { readonly id: string; readonly lat: number; readonly lng: number; readonly kind: 'landmark' | 'shop'; readonly category?: string }[];
  /** 公衆トイレなどの便利施設 */
  readonly amenities: readonly { readonly id: string; readonly lat: number; readonly lng: number }[];
}

/** 生成中の作業領域 */
interface Work {
  readonly cols: number;
  readonly rows: number;
  /** 市域の北西の角から見たグリッド原点（メートル。どちらも -TOWN_MARGIN_M） */
  readonly marginM: number;
  /** 市域の幅・高さ（メートル） */
  readonly widthM: number;
  readonly heightM: number;
  readonly kinds: Uint8Array;
  readonly district: Uint8Array;
  readonly variant: Uint8Array;
  readonly overlay: Uint8Array;
  readonly buildingAt: Int32Array;
  readonly buildings: TownBuilding[];
  readonly themes: TownTheme[];
  readonly anchors: Map<string, TownAnchor>;
  /** スポットの敷地・特別な区画で、道路を引かないセル */
  readonly reserved: Uint8Array;
}

/**
 * 整数の組からばらつき 0..1 を作る（決定論的なハッシュ。乱数の代わり）。
 * @param a 1つ目
 * @param b 2つ目
 * @param salt 用途ごとの塩
 * @returns 0 以上 1 未満
 */
export function hash01(a: number, b: number, salt = 0): number { // audit-ignore: fnlog-missing 生成のセルごとに呼ぶ純粋な算術ヘルパー
  let h = Math.imul(a | 0, 374_761_393) ^ Math.imul(b | 0, 668_265_263) ^ Math.imul(salt | 0, 2_246_822_519);
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

/**
 * 地区IDからテーマを決める（表に無ければ順番で回す）。
 * @param id 地区ID
 * @param order 地区の並び（0 始まり）
 * @returns テーマ
 */
export function themeOfDistrict(id: string, order: number): TownTheme {
  const log = logger.fn('themeOfDistrict', { id, order });
  return log.exit(THEME_BY_DISTRICT[id] ?? THEME_CYCLE[order % THEME_CYCLE.length] ?? 'city');
}

/**
 * 市域と地区・スポットから街を作る。
 * @param input 市域・地区・スポット・便利施設
 * @returns 生成した街
 */
export function generateTown(input: TownGenInput): TownGrid {
  const log = logger.fn('generateTown', { districts: input.districts.length, spots: input.spots.length, amenities: input.amenities.length });
  const centerLat = (input.bounds.south + input.bounds.north) / 2;
  const mPerLng = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
  const widthM = (input.bounds.east - input.bounds.west) * mPerLng;
  const heightM = (input.bounds.north - input.bounds.south) * M_PER_DEG_LAT;
  const work = createWork(widthM, heightM);
  /**
   * 緯度経度を市域ローカル座標（メートル。北西の角が原点）にする。
   * @param ll 緯度経度
   * @returns x・y（メートル）
   */
  const toLocal = (ll: GenLatLng): { x: number; y: number } => ({ x: (ll.lng - input.bounds.west) * mPerLng, y: (input.bounds.north - ll.lat) * M_PER_DEG_LAT });
  paintDistricts(work, input.districts.map((d) => d.polygon.map(toLocal)), input.districts.map((d, i) => themeOfDistrict(d.id, i)));
  paintRivers(work);
  const spots = input.spots.map((s) => ({ ...s, ...toLocal(s) }));
  paintSpecialAreas(work, spots);
  paintStreets(work);
  paintAlleys(work);
  paintPromenades(work);
  paintViaduct(work);
  placeLots(work, spots, input.amenities.map((a) => ({ id: a.id, ...toLocal(a) })));
  placeStation(work);
  paintPocketParks(work);
  fillBuildings(work);
  fillLeftovers(work);
  const grid: TownGrid = {
    cols: work.cols,
    rows: work.rows,
    originLat: input.bounds.north + work.marginM / M_PER_DEG_LAT,
    originLng: input.bounds.west - work.marginM / mPerLng,
    metersPerDegLng: mPerLng,
    kinds: work.kinds,
    district: work.district,
    variant: work.variant,
    overlay: work.overlay,
    buildingAt: work.buildingAt,
    buildings: work.buildings,
    districtIds: input.districts.map((d) => d.id),
    themes: work.themes,
    anchors: work.anchors,
  };
  return log.exit(grid, `${work.cols}x${work.rows} セル・建物 ${work.buildings.length}・敷地 ${work.anchors.size}`);
}

/**
 * 作業領域を用意する（地面は芝、ばらつきはセル座標のハッシュ）。
 * @param widthM 市域の幅（メートル）
 * @param heightM 市域の高さ（メートル）
 * @returns 作業領域
 */
function createWork(widthM: number, heightM: number): Work {
  const log = logger.fn('createWork', { widthM: Math.round(widthM), heightM: Math.round(heightM) });
  const cols = Math.ceil((widthM + TOWN_MARGIN_M * 2) / CELL_M);
  const rows = Math.ceil((heightM + TOWN_MARGIN_M * 2) / CELL_M);
  const n = cols * rows;
  const variant = new Uint8Array(n);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) variant[r * cols + c] = Math.floor(hash01(c, r, 7) * 256);
  const work: Work = {
    cols,
    rows,
    marginM: TOWN_MARGIN_M,
    widthM,
    heightM,
    kinds: new Uint8Array(n),
    district: new Uint8Array(n),
    variant,
    overlay: new Uint8Array(n),
    buildingAt: new Int32Array(n).fill(-1),
    buildings: [],
    themes: ['city'],
    anchors: new Map(),
    reserved: new Uint8Array(n),
  };
  return log.exit(work, `${cols}x${rows}`);
}

/**
 * セル中心の市域ローカル座標（メートル）を返す。
 * @param work 作業領域
 * @param col 列
 * @param row 行
 * @returns x・y（メートル）
 */
function cellXY(work: Work, col: number, row: number): { x: number; y: number } { // audit-ignore: fnlog-missing セルごとに呼ぶ純粋な変換ヘルパー
  return { x: (col + 0.5) * CELL_M - work.marginM, y: (row + 0.5) * CELL_M - work.marginM };
}

/**
 * 市域ローカル座標（メートル）を含むセルを返す（範囲外でもそのまま返す）。
 * @param work 作業領域
 * @param x 東向きのメートル
 * @param y 南向きのメートル
 * @returns 列・行
 */
function cellOf(work: Work, x: number, y: number): { col: number; row: number } { // audit-ignore: fnlog-missing セルごとに呼ぶ純粋な変換ヘルパー
  return { col: Math.floor((x + work.marginM) / CELL_M), row: Math.floor((y + work.marginM) / CELL_M) };
}

/**
 * 地区の多角形の中のセルに地区番号を付ける（多角形の外接矩形の中だけ調べる）。
 * @param work 作業領域
 * @param polygons 地区ごとの多角形（市域ローカル座標）
 * @param themes 地区ごとのテーマ
 * @sideEffect work.district・work.themes を書き換える
 */
function paintDistricts(work: Work, polygons: readonly (readonly { x: number; y: number }[])[], themes: readonly TownTheme[]): void {
  const log = logger.fn('paintDistricts', { districts: polygons.length });
  polygons.forEach((poly, i) => {
    work.themes.push(themes[i] ?? 'city');
    if (poly.length < 3) return;
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const a = cellOf(work, Math.min(...xs), Math.min(...ys));
    const b = cellOf(work, Math.max(...xs), Math.max(...ys));
    for (let r = Math.max(0, a.row); r <= Math.min(work.rows - 1, b.row); r++) {
      for (let c = Math.max(0, a.col); c <= Math.min(work.cols - 1, b.col); c++) {
        if (pointInPolygon(cellXY(work, c, r), poly)) work.district[r * work.cols + c] = i + 1;
      }
    }
  });
  log.exit(undefined);
}

/**
 * 川の中心線からの距離を返す（東の川・南の川・曲がり角のうち近いもの）。負なら川の中。
 * @param work 作業領域
 * @param x 東向きのメートル
 * @param y 南向きのメートル
 * @returns 岸からの距離（メートル。川の中は負）
 */
function riverDistance(work: Work, x: number, y: number): number { // audit-ignore: fnlog-missing セルごとに呼ぶ純粋な算術ヘルパー
  const eastX = work.widthM - EAST_RIVER_FROM_EAST_M;
  const southY = work.heightM - SOUTH_RIVER_FROM_SOUTH_M;
  const eastCenter = eastX + RIVER_MEANDER_M * Math.sin(y / 420);
  const southCenter = southY + RIVER_MEANDER_M * 0.8 * Math.sin(x / 300);
  let best = Number.POSITIVE_INFINITY;
  if (y <= southY) best = Math.min(best, Math.abs(x - eastCenter) - EAST_RIVER_WIDTH_M / 2);
  if (x <= eastX) best = Math.min(best, Math.abs(y - southCenter) - SOUTH_RIVER_WIDTH_M / 2);
  const corner = Math.hypot(x - (eastX + RIVER_MEANDER_M * Math.sin(southY / 420)), y - (southY + RIVER_MEANDER_M * 0.8 * Math.sin(eastX / 300)));
  best = Math.min(best, corner - EAST_RIVER_WIDTH_M / 2);
  return best;
}

/**
 * 東から南へ曲がる川と、その護岸を描く。
 * @param work 作業領域
 * @sideEffect work.kinds を書き換える
 */
function paintRivers(work: Work): void {
  const log = logger.fn('paintRivers');
  let water = 0;
  for (let r = 0; r < work.rows; r++) {
    for (let c = 0; c < work.cols; c++) {
      const { x, y } = cellXY(work, c, r);
      const d = riverDistance(work, x, y);
      const i = r * work.cols + c;
      if (d < 0) {
        work.kinds[i] = Cell.WATER;
        water++;
      } else if (d < CELL_M) work.kinds[i] = Cell.BANK;
    }
  }
  log.exit(undefined, `水 ${water} セル`);
}

/**
 * 矩形（セル）を種類で塗る（範囲外は無視）。overwrite が false なら芝・木だけを塗り替える。
 * @param work 作業領域
 * @param rect 左上の列・行と幅・高さ（セル）
 * @param kind 種類
 * @param overwrite 何でも塗り替えるか（川・敷地は常に残す）
 * @sideEffect work.kinds を書き換える
 */
function fillRect(work: Work, rect: { col: number; row: number; w: number; h: number }, kind: number, overwrite = true): void { // audit-ignore: fnlog-missing 生成の内部ヘルパー（呼び出し側でまとめてログ）
  for (let r = rect.row; r < rect.row + rect.h; r++) {
    for (let c = rect.col; c < rect.col + rect.w; c++) {
      const i = cellIndex(work, c, r);
      if (i < 0) continue;
      const k = work.kinds[i];
      if (k === Cell.WATER || k === Cell.BANK || k === Cell.LOT) continue;
      if (!overwrite && k !== Cell.GRASS && k !== Cell.TREE) continue;
      work.kinds[i] = kind;
    }
  }
}

/**
 * 名所のカテゴリに合わせて、まわりに特別な区画（公園・境内・市場・桜の通り抜け・路地の一角・前庭）を作る。
 * @param work 作業領域
 * @param spots 市域ローカル座標つきのスポット
 * @sideEffect work.kinds・work.reserved を書き換える
 */
function paintSpecialAreas(work: Work, spots: readonly { id: string; kind: string; category?: string; x: number; y: number }[]): void {
  const log = logger.fn('paintSpecialAreas');
  let areas = 0;
  for (const spot of spots) {
    if (spot.kind !== 'landmark') continue;
    const at = cellOf(work, spot.x, spot.y);
    const nearRiver = riverDistance(work, spot.x, spot.y) < 110;
    switch (spot.category) {
      case '公園':
        if (nearRiver) paintRiversidePark(work, at);
        else paintPark(work, at, 28, 24);
        break;
      case '神社':
        paintPrecinct(work, at, 14, 12);
        break;
      case '市場':
        paintPrecinct(work, at, 9, 8);
        break;
      case '名所':
        paintSakuraLane(work, at);
        break;
      case '町並み':
        paintAlleyQuarter(work, at);
        break;
      default:
        paintPrecinct(work, at, 7, 7);
    }
    areas++;
  }
  log.exit(undefined, `区画 ${areas}`);
}

/**
 * 公園（芝・十字の遊歩道・池・遊具・縁の木）を作る。
 * @param work 作業領域
 * @param at 中心セル
 * @param w 幅（セル）
 * @param h 高さ（セル）
 * @sideEffect work.kinds・work.reserved を書き換える
 */
function paintPark(work: Work, at: { col: number; row: number }, w: number, h: number): void {
  const log = logger.fn('paintPark', { w, h });
  const rect = { col: at.col - Math.floor(w / 2), row: at.row - Math.floor(h / 2), w, h };
  fillRect(work, rect, Cell.PARK);
  reserve(work, rect);
  for (let c = rect.col; c < rect.col + w; c++) {
    setKind(work, c, rect.row, Cell.TREE);
    setKind(work, c, rect.row + h - 1, Cell.TREE);
  }
  for (let r = rect.row; r < rect.row + h; r++) {
    setKind(work, rect.col, r, Cell.TREE);
    setKind(work, rect.col + w - 1, r, Cell.TREE);
  }
  // 十字の遊歩道（2セル幅）で四方の道とつなぐ
  fillRect(work, { col: rect.col, row: at.row - 1, w, h: 2 }, Cell.PATH);
  fillRect(work, { col: at.col - 1, row: rect.row, w: 2, h }, Cell.PATH);
  fillRect(work, { col: rect.col + 3, row: rect.row + 3, w: 7, h: 5 }, Cell.POND);
  fillRect(work, { col: rect.col + w - 8, row: rect.row + h - 7, w: 4, h: 3 }, Cell.PLAYGROUND);
  fillRect(work, { col: rect.col + 3, row: rect.row + h - 6, w: 5, h: 2 }, Cell.GARDEN);
  log.exit(undefined);
}

/**
 * 川沿いの細長い公園（桜並木と遊歩道）を、川の岸に沿って作る。
 * @param work 作業領域
 * @param at 名所のセル
 * @sideEffect work.kinds を書き換える
 */
function paintRiversidePark(work: Work, at: { col: number; row: number }): void {
  const log = logger.fn('paintRiversidePark');
  const half = 50;
  for (let r = at.row - 16; r <= at.row + 16; r++) {
    for (let c = at.col - half; c <= at.col + half; c++) {
      const i = cellIndex(work, c, r);
      if (i < 0) continue;
      const { x, y } = cellXY(work, c, r);
      const d = riverDistance(work, x, y);
      if (d < CELL_M || d > 45) continue;
      const k = work.kinds[i];
      if (k === Cell.WATER || k === Cell.BANK || k === Cell.LOT) continue;
      work.kinds[i] = d < 12 ? Cell.PATH : (c + r) % 3 === 0 ? Cell.SAKURA : Cell.PARK;
      work.reserved[i] = 1;
    }
  }
  log.exit(undefined);
}

/**
 * 石畳の広場（境内・市場の前・名所の前庭）を作り、縁に木を植える。
 * @param work 作業領域
 * @param at 中心セル
 * @param w 幅（セル）
 * @param h 高さ（セル）
 * @sideEffect work.kinds・work.reserved を書き換える
 */
function paintPrecinct(work: Work, at: { col: number; row: number }, w: number, h: number): void {
  const log = logger.fn('paintPrecinct', { w, h });
  const rect = { col: at.col - Math.floor(w / 2), row: at.row - Math.floor(h / 2), w, h };
  fillRect(work, rect, Cell.PLAZA);
  reserve(work, rect);
  if (w >= 10) {
    for (let c = rect.col; c < rect.col + w; c += 2) {
      setKind(work, c, rect.row, Cell.TREE);
    }
    for (let r = rect.row; r < rect.row + h; r += 2) {
      setKind(work, rect.col, r, Cell.TREE);
      setKind(work, rect.col + w - 1, r, Cell.TREE);
    }
  }
  log.exit(undefined);
}

/**
 * 桜の通り抜け（真ん中の遊歩道と両側の桜並木）を作る。
 * @param work 作業領域
 * @param at 名所のセル
 * @sideEffect work.kinds・work.reserved を書き換える
 */
function paintSakuraLane(work: Work, at: { col: number; row: number }): void {
  const log = logger.fn('paintSakuraLane');
  const rect = { col: at.col - 8, row: at.row - 18, w: 16, h: 36 };
  fillRect(work, rect, Cell.PARK);
  reserve(work, rect);
  fillRect(work, { col: at.col - 1, row: rect.row, w: 3, h: rect.h }, Cell.PATH);
  for (let r = rect.row; r < rect.row + rect.h; r += 2) {
    for (const c of [at.col - 3, at.col - 5, at.col + 3, at.col + 5]) setKind(work, c, r, Cell.SAKURA);
  }
  log.exit(undefined);
}

/**
 * 路地の一角（1セル幅の路地を細かく通す）を作る。建物は後で長屋・小さな家で埋まる。
 * @param work 作業領域
 * @param at 名所のセル
 * @sideEffect work.kinds を書き換える
 */
function paintAlleyQuarter(work: Work, at: { col: number; row: number }): void {
  const log = logger.fn('paintAlleyQuarter');
  const rect = { col: at.col - 14, row: at.row - 12, w: 28, h: 24 };
  for (let r = rect.row; r < rect.row + rect.h; r++) {
    for (let c = rect.col; c < rect.col + rect.w; c++) {
      const onLane = (r - rect.row) % 5 === 2 || ((c - rect.col) % 6 === 3 && hash01(c, Math.floor(r / 5), 31) > 0.25);
      if (onLane) setKind(work, c, r, Cell.ALLEY, false);
    }
  }
  fillRect(work, { col: at.col - 2, row: at.row - 2, w: 5, h: 5 }, Cell.PLAZA);
  log.exit(undefined);
}

/**
 * 1セルの種類を変える（川・護岸・敷地は守る。onlyFree なら芝・木だけ）。
 * @param work 作業領域
 * @param col 列
 * @param row 行
 * @param kind 種類
 * @param overwrite 道・広場なども塗り替えるか
 * @sideEffect work.kinds を書き換える
 */
function setKind(work: Work, col: number, row: number, kind: number, overwrite = true): void { // audit-ignore: fnlog-missing 生成の内部ヘルパー（セルごと）
  const i = cellIndex(work, col, row);
  if (i < 0) return;
  const k = work.kinds[i];
  if (k === Cell.WATER || k === Cell.BANK || k === Cell.LOT) return;
  if (!overwrite && k !== Cell.GRASS && k !== Cell.TREE) return;
  work.kinds[i] = kind;
}

/**
 * 矩形を「道路を引かない区画」にする。
 * @param work 作業領域
 * @param rect 左上の列・行と幅・高さ（セル）
 * @sideEffect work.reserved を書き換える
 */
function reserve(work: Work, rect: { col: number; row: number; w: number; h: number }): void { // audit-ignore: fnlog-missing 生成の内部ヘルパー
  for (let r = rect.row; r < rect.row + rect.h; r++) {
    for (let c = rect.col; c < rect.col + rect.w; c++) {
      const i = cellIndex(work, c, r);
      if (i >= 0) work.reserved[i] = 1;
    }
  }
}

/** 通り1本（南北なら x、東西なら y の中心と幅） */
interface StreetLine {
  readonly vertical: boolean;
  /** 中心（メートル） */
  readonly at: number;
  readonly widthM: number;
  readonly kind: number;
  /** 通りの範囲（もう一方の軸のメートル。無ければ全体） */
  readonly from?: number;
  readonly to?: number;
  /** 川に橋を架けるか */
  readonly bridge: boolean;
  /** 区間を省けるか（大通り・商店街は省かない） */
  readonly gaps: boolean;
}

/**
 * 道路網（大通り・商店街・通り）を引く。特別な区画（公園・境内）の中は避け、川は橋でだけ渡る。
 * @param work 作業領域
 * @sideEffect work.kinds を書き換える
 */
function paintStreets(work: Work): void {
  const log = logger.fn('paintStreets');
  const lines = streetLines(work);
  const verticals = lines.filter((l) => l.vertical).map((l) => l.at).sort((a, b) => a - b);
  const horizontals = lines.filter((l) => !l.vertical).map((l) => l.at).sort((a, b) => a - b);
  // 省くのは通り（細い道）だけ。大通り・商店街を先に引き、通りの上書きで太さが変わらないようにする
  const ordered = [...lines].sort((a, b) => priorityOf(a.kind) - priorityOf(b.kind));
  for (const line of ordered) drawStreet(work, line, line.vertical ? horizontals : verticals);
  log.exit(undefined, `通り ${lines.length} 本`);
}

/**
 * 通りの種類の描く順（先に描くほど上書きされにくい…ではなく、後に描く方が上に乗る）。
 * @param kind セルの種類
 * @returns 順番（小さいほど先）
 */
function priorityOf(kind: number): number { // audit-ignore: fnlog-missing 生成の内部ヘルパー
  if (kind === Cell.ROAD) return 0;
  if (kind === Cell.AVENUE) return 1;
  return 2;
}

/**
 * 街の通りの一覧を作る（大通り・商店街・一定間隔の通り）。
 * @param work 作業領域
 * @returns 通り
 */
function streetLines(work: Work): StreetLine[] {
  const log = logger.fn('streetLines');
  const W = work.widthM;
  const H = work.heightM;
  const arcadeX = W * ARCADE_X_RATIO;
  const avenueXs = AVENUE_X_RATIOS.map((k) => W * k);
  const avenueYs = AVENUE_Y_RATIOS.map((k) => H * k);
  const lines: StreetLine[] = [];
  for (const x of avenueXs) lines.push({ vertical: true, at: x, widthM: 20, kind: Cell.AVENUE, bridge: true, gaps: false });
  for (const y of avenueYs) lines.push({ vertical: false, at: y, widthM: 20, kind: Cell.AVENUE, bridge: true, gaps: false });
  lines.push({ vertical: true, at: arcadeX, widthM: 15, kind: Cell.ARCADE, from: H * ARCADE_Y_RANGE[0], to: H * ARCADE_Y_RANGE[1], bridge: false, gaps: false });
  lines.push({ vertical: true, at: arcadeX, widthM: 10, kind: Cell.ROAD, bridge: true, gaps: false });
  const xBlockers = [arcadeX, ...avenueXs];
  let k = 0;
  for (let x = arcadeX - Math.ceil((arcadeX + work.marginM) / STREET_SPACING_X_M) * STREET_SPACING_X_M; x < W + work.marginM; x += STREET_SPACING_X_M) {
    k++;
    if (xBlockers.some((b) => Math.abs(b - x) < STREET_CLEARANCE_M)) continue;
    lines.push({ vertical: true, at: x, widthM: 10, kind: Cell.ROAD, bridge: k % 3 === 0, gaps: true });
  }
  for (let y = 15 - Math.ceil(work.marginM / STREET_SPACING_Y_M) * STREET_SPACING_Y_M; y < H + work.marginM; y += STREET_SPACING_Y_M) {
    k++;
    if (avenueYs.some((b) => Math.abs(b - y) < STREET_CLEARANCE_M)) continue;
    lines.push({ vertical: false, at: y, widthM: 10, kind: Cell.ROAD, bridge: k % 3 === 0, gaps: true });
  }
  return log.exit(lines, `${lines.length} 本`);
}

/**
 * 通りを1本描く。交差する通りの間の区間ごとに、ハッシュで一部を省く（gaps のとき）。
 * @param work 作業領域
 * @param line 通り
 * @param crossings 交差する向きの通りの位置（メートル、昇順）
 * @sideEffect work.kinds を書き換える
 */
function drawStreet(work: Work, line: StreetLine, crossings: readonly number[]): void {
  const log = logger.fn('drawStreet', { vertical: line.vertical, kind: line.kind });
  const half = line.widthM / 2;
  const lineIndex = Math.round(line.at / 5);
  const lengthCells = line.vertical ? work.rows : work.cols;
  for (let t = 0; t < lengthCells; t++) {
    const along = (t + 0.5) * CELL_M - work.marginM;
    if (line.from !== undefined && along < line.from) continue;
    if (line.to !== undefined && along > line.to) continue;
    if (line.gaps) {
      const segment = crossings.findIndex((c) => c > along);
      if (hash01(lineIndex, segment, line.vertical ? 11 : 13) < STREET_GAP_RATE) continue;
    }
    for (let off = -half + CELL_M / 2; off < half; off += CELL_M) {
      const across = line.at + off;
      const cell = line.vertical ? cellOf(work, across, along) : cellOf(work, along, across);
      paintStreetCell(work, cell.col, cell.row, line);
    }
  }
  log.exit(undefined);
}

/**
 * 通りの1セルを塗る（川は橋の通りだけ橋に、特別な区画・敷地は避ける）。
 * @param work 作業領域
 * @param col 列
 * @param row 行
 * @param line 通り
 * @sideEffect work.kinds を書き換える
 */
function paintStreetCell(work: Work, col: number, row: number, line: StreetLine): void { // audit-ignore: fnlog-missing 生成の内部ヘルパー（セルごと）
  const i = cellIndex(work, col, row);
  if (i < 0) return;
  const k = work.kinds[i];
  if (k === Cell.WATER || k === Cell.BANK) {
    if (line.bridge) work.kinds[i] = Cell.BRIDGE;
    return;
  }
  if (k === Cell.BRIDGE || k === Cell.LOT) return;
  if (work.reserved[i] === 1) return;
  if (k === Cell.ARCADE && line.kind !== Cell.ARCADE) return;
  work.kinds[i] = line.kind;
}

/**
 * 路地のテーマの地区に、通りの間を細かく分ける1セル幅の路地を通す。
 * @param work 作業領域
 * @sideEffect work.kinds を書き換える
 */
function paintAlleys(work: Work): void {
  const log = logger.fn('paintAlleys');
  let alleys = 0;
  for (let r = 0; r < work.rows; r++) {
    for (let c = 0; c < work.cols; c++) {
      const i = r * work.cols + c;
      const theme = work.themes[work.district[i] ?? 0];
      if (theme !== 'alley' && theme !== 'monzen') continue;
      if (work.kinds[i] !== Cell.GRASS || work.reserved[i] === 1) continue;
      const { x, y } = cellXY(work, c, r);
      const midY = Math.abs(((y - 15 + STREET_SPACING_Y_M / 2) % STREET_SPACING_Y_M) - 0) < CELL_M / 2 + 0.01;
      const lane = theme === 'alley' ? midY || Math.abs((x % 40) - 20) < 2.6 : midY && hash01(Math.floor(x / 80), Math.floor(y / 75), 41) < 0.6;
      if (!lane) continue;
      work.kinds[i] = Cell.ALLEY;
      alleys++;
    }
  }
  log.exit(undefined, `路地 ${alleys} セル`);
}

/**
 * 川沿いに遊歩道（岸に接する2セル）と並木を作る（通り・特別な区画は上書きしない）。
 * @param work 作業領域
 * @sideEffect work.kinds を書き換える
 */
function paintPromenades(work: Work): void {
  const log = logger.fn('paintPromenades');
  for (let r = 0; r < work.rows; r++) {
    for (let c = 0; c < work.cols; c++) {
      const i = r * work.cols + c;
      if (work.kinds[i] !== Cell.GRASS) continue;
      const { x, y } = cellXY(work, c, r);
      const d = riverDistance(work, x, y);
      if (d < CELL_M || d >= CELL_M * 4) continue;
      const theme = work.themes[work.district[i] ?? 0];
      if (d < CELL_M * 3) work.kinds[i] = Cell.PATH;
      else if ((c + r) % 2 === 0) work.kinds[i] = theme === 'river' || theme === 'city' ? Cell.SAKURA : Cell.TREE;
    }
  }
  log.exit(undefined);
}

/**
 * 東西に走る高架の線路と駅のホームを重ねる（下は歩ける。地面の種類は変えない）。
 * @param work 作業領域
 * @sideEffect work.overlay を書き換える
 */
function paintViaduct(work: Work): void {
  const log = logger.fn('paintViaduct');
  const y0 = work.heightM * VIADUCT_Y_RATIO;
  const x0 = work.widthM * STATION_X_RANGE[0];
  const x1 = work.widthM * STATION_X_RANGE[1];
  for (let r = 0; r < work.rows; r++) {
    const { y } = cellXY(work, 0, r);
    if (y < y0 || y >= y0 + VIADUCT_WIDTH_M) continue;
    for (let c = 0; c < work.cols; c++) {
      const { x } = cellXY(work, c, r);
      const i = r * work.cols + c;
      work.overlay[i] = (work.overlay[i] ?? 0) | OVERLAY_VIADUCT | (x >= x0 && x < x1 ? OVERLAY_STATION : 0);
    }
  }
  log.exit(undefined);
}

/** 敷地を置く対象 */
interface LotTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** 敷地の一辺（セル） */
  readonly size: number;
}

/**
 * スポット（名所→店舗の順）と便利施設の敷地を置く。
 * @param work 作業領域
 * @param spots 市域ローカル座標つきのスポット
 * @param amenities 市域ローカル座標つきの便利施設
 * @sideEffect work.kinds・work.anchors を書き換える
 */
function placeLots(work: Work, spots: readonly { id: string; kind: string; x: number; y: number }[], amenities: readonly { id: string; x: number; y: number }[]): void {
  const log = logger.fn('placeLots', { spots: spots.length, amenities: amenities.length });
  const targets: LotTarget[] = [
    ...spots.filter((s) => s.kind === 'landmark').map((s) => ({ id: s.id, x: s.x, y: s.y, size: 5 })),
    ...spots.filter((s) => s.kind !== 'landmark').map((s) => ({ id: s.id, x: s.x, y: s.y, size: 3 })),
    ...amenities.map((a) => ({ id: a.id, x: a.x, y: a.y, size: 2 })),
  ];
  let forced = 0;
  for (const target of targets) if (!placeLot(work, target)) forced++;
  log.exit(undefined, `敷地 ${work.anchors.size}・無理に置いた ${forced}`);
}

/** 敷地に使ってよいセル */
const LOT_OK: ReadonlySet<number> = new Set([Cell.GRASS, Cell.PARK, Cell.PLAZA, Cell.TREE, Cell.SAKURA, Cell.GARDEN, Cell.PLAYGROUND]);

/**
 * 1件の敷地を、実際の位置にいちばん近い空き地に置き、入口から道へ小道をつなぐ。
 * 空き地が見つからなければ実際の位置に無理に置く（川は避ける）。
 * @param work 作業領域
 * @param target 置くもの
 * @returns 空き地に置けたら true
 * @sideEffect work.kinds・work.anchors を書き換える
 */
function placeLot(work: Work, target: LotTarget): boolean {
  const log = logger.fn('placeLot', { id: target.id, size: target.size });
  const center = cellOf(work, target.x, target.y);
  const half = Math.floor(target.size / 2);
  let best: { col: number; row: number; score: number } | undefined;
  for (let dr = -7; dr <= 7; dr++) {
    for (let dc = -7; dc <= 7; dc++) {
      const col = center.col + dc;
      const row = center.row + dr;
      if (!lotFits(work, col - half, row - half, target.size)) continue;
      const score = Math.hypot(dc, dr) - (touchesWalkable(work, col - half, row - half, target.size) ? 2.5 : 0);
      if (best === undefined || score < best.score) best = { col, row, score };
    }
  }
  const at = best ?? center;
  for (let r = at.row - half; r < at.row - half + target.size; r++) {
    for (let c = at.col - half; c < at.col - half + target.size; c++) {
      const i = cellIndex(work, c, r);
      if (i >= 0 && work.kinds[i] !== Cell.WATER) work.kinds[i] = Cell.LOT;
    }
  }
  const door = connectLot(work, at.col - half, at.row - half, target.size);
  work.anchors.set(target.id, { col: at.col, row: at.row, doorCol: door.col, doorRow: door.row });
  return log.exit(best !== undefined);
}

/**
 * 敷地（左上と一辺）が空き地だけでできているか。
 * @param work 作業領域
 * @param col 左上の列
 * @param row 左上の行
 * @param size 一辺（セル）
 * @returns 置けるなら true
 */
function lotFits(work: Work, col: number, row: number, size: number): boolean { // audit-ignore: fnlog-missing 敷地探しで何百回も呼ぶ純粋な判定ヘルパー
  for (let r = row; r < row + size; r++) {
    for (let c = col; c < col + size; c++) {
      const i = cellIndex(work, c, r);
      if (i < 0 || !LOT_OK.has(work.kinds[i] ?? -1)) return false;
    }
  }
  return true;
}

/**
 * 敷地のまわり（4辺の外側1セル）に歩けるセルがあるか。
 * @param work 作業領域
 * @param col 左上の列
 * @param row 左上の行
 * @param size 一辺（セル）
 * @returns あれば true
 */
function touchesWalkable(work: Work, col: number, row: number, size: number): boolean { // audit-ignore: fnlog-missing 敷地探しで何百回も呼ぶ純粋な判定ヘルパー
  return perimeter(col, row, size).some(([c, r]) => isWalkable(work.kinds[cellIndex(work, c, r)] ?? -1));
}

/**
 * 敷地の4辺の外側のセル（角は除く）を、下辺・左右・上辺の順に返す（入口は道に面した下側を優先）。
 * @param col 左上の列
 * @param row 左上の行
 * @param size 一辺（セル）
 * @returns 列・行の組
 */
function perimeter(col: number, row: number, size: number): [number, number][] { // audit-ignore: fnlog-missing 敷地探しで何百回も呼ぶ純粋な算術ヘルパー
  const out: [number, number][] = [];
  for (let k = 0; k < size; k++) out.push([col + k, row + size]);
  for (let k = 0; k < size; k++) out.push([col - 1, row + k], [col + size, row + k]);
  for (let k = 0; k < size; k++) out.push([col + k, row - 1]);
  return out;
}

/**
 * 敷地の入口を決める。まわりに歩けるセルが無ければ、いちばん近い歩けるセルまで小道（路地）を切り開く。
 * @param work 作業領域
 * @param col 左上の列
 * @param row 左上の行
 * @param size 一辺（セル）
 * @returns 入口のセル
 * @sideEffect 小道を切り開いたら work.kinds を書き換える
 */
function connectLot(work: Work, col: number, row: number, size: number): { col: number; row: number } {
  const log = logger.fn('connectLot', { size });
  const ring = perimeter(col, row, size);
  const direct = ring.find(([c, r]) => isWalkable(work.kinds[cellIndex(work, c, r)] ?? -1));
  if (direct !== undefined) return log.exit({ col: direct[0], row: direct[1] }, '道に面している');
  const path = searchWalkable(work, ring);
  if (path === undefined) {
    const first = ring.find(([c, r]) => cellIndex(work, c, r) >= 0) ?? [col, row + size];
    return log.exit({ col: first[0], row: first[1] }, '道が見つからない');
  }
  for (const [c, r] of path) {
    const i = cellIndex(work, c, r);
    if (i >= 0 && !isWalkable(work.kinds[i] ?? -1)) work.kinds[i] = Cell.ALLEY;
  }
  const door = path[0] ?? [col, row + size];
  return log.exit({ col: door[0], row: door[1] }, `小道 ${path.length} セル`);
}

/**
 * 敷地のまわりから、川・敷地を通らずにいちばん近い歩けるセルを幅優先で探し、敷地側からの道筋を返す（最大 20 セル）。
 * @param work 作業領域
 * @param starts 敷地のまわりのセル
 * @returns 道筋（先頭が敷地に接するセル、末尾は歩けるセルの手前まで）。見つからなければ undefined
 */
function searchWalkable(work: Work, starts: readonly [number, number][]): [number, number][] | undefined {
  const log = logger.fn('searchWalkable', { starts: starts.length });
  const prev = new Map<number, number>();
  const queue: number[] = [];
  for (const [c, r] of starts) {
    const i = cellIndex(work, c, r);
    if (i < 0 || !passableForCarve(work.kinds[i] ?? -1) || prev.has(i)) continue;
    prev.set(i, -1);
    queue.push(i);
  }
  for (let head = 0; head < queue.length && head < 4000; head++) {
    const i = queue[head] ?? 0;
    const c = i % work.cols;
    const r = Math.floor(i / work.cols);
    for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]] as const) {
      const j = cellIndex(work, nc, nr);
      if (j < 0 || prev.has(j)) continue;
      const k = work.kinds[j] ?? -1;
      if (isWalkable(k)) return log.exit(tracePath(work, prev, i));
      if (!passableForCarve(k)) continue;
      prev.set(j, i);
      queue.push(j);
    }
  }
  return log.exit(undefined, '見つからない');
}

/**
 * 小道を切り開いてよいセルか（川・護岸・敷地・建物以外）。
 * @param kind セルの種類
 * @returns 切り開けるなら true
 */
function passableForCarve(kind: number): boolean { // audit-ignore: fnlog-missing 幅優先探索で呼ぶ純粋な判定ヘルパー
  return kind !== Cell.WATER && kind !== Cell.BANK && kind !== Cell.LOT && kind !== Cell.BUILDING && kind !== Cell.POND;
}

/**
 * 幅優先探索の結果から、敷地側から見た道筋を復元する。
 * @param work 作業領域
 * @param prev 1つ前のセル（始点は -1）
 * @param last 歩けるセルの手前のセル
 * @returns 道筋（敷地側が先頭）
 */
function tracePath(work: Work, prev: ReadonlyMap<number, number>, last: number): [number, number][] { // audit-ignore: fnlog-missing 生成の内部ヘルパー（searchWalkable でログ）
  const out: [number, number][] = [];
  let i = last;
  while (i >= 0) {
    out.push([i % work.cols, Math.floor(i / work.cols)]);
    i = prev.get(i) ?? -1;
  }
  return out.reverse();
}

/**
 * 高架の駅の下に駅舎を置く（空き地があるときだけ）。
 * @param work 作業領域
 * @sideEffect work.kinds・work.buildings・work.buildingAt を書き換える
 */
function placeStation(work: Work): void {
  const log = logger.fn('placeStation');
  const x = work.widthM * (STATION_X_RANGE[0] + 0.012);
  const y = work.heightM * VIADUCT_Y_RATIO + VIADUCT_WIDTH_M + CELL_M;
  const at = cellOf(work, x, y);
  for (let shift = 0; shift < 12; shift++) {
    if (placeBuilding(work, at.col + shift, at.row, { style: 'station', w: 8, h: 4, weight: 1 })) return log.exit(undefined, '駅舎を置いた');
  }
  log.exit(undefined, '置けなかった');
}

/**
 * 建物を1棟置く（敷地がすべて芝なら）。
 * @param work 作業領域
 * @param col 左上の列
 * @param row 左上の行
 * @param plan 建物の種類と大きさ
 * @returns 置けたら true
 * @sideEffect work.kinds・work.buildings・work.buildingAt を書き換える
 */
function placeBuilding(work: Work, col: number, row: number, plan: BuildingPlan): boolean { // audit-ignore: fnlog-missing 街区を埋めるときに何万回も呼ぶ内部ヘルパー（fillBuildings でまとめてログ）
  for (let r = row; r < row + plan.h; r++) {
    for (let c = col; c < col + plan.w; c++) {
      const i = cellIndex(work, c, r);
      if (i < 0 || work.kinds[i] !== Cell.GRASS) return false;
    }
  }
  const index = work.buildings.length;
  const anchor = row * work.cols + col;
  work.buildings.push({
    col,
    row,
    w: plan.w,
    h: plan.h,
    style: plan.style,
    roof: roofOf(work, anchor, col, row),
    seed: Math.floor(hash01(col, row, 19) * 65_536),
    district: work.district[anchor] ?? 0,
  });
  for (let r = row; r < row + plan.h; r++) {
    for (let c = col; c < col + plan.w; c++) {
      const i = r * work.cols + c;
      work.kinds[i] = Cell.BUILDING;
      work.buildingAt[i] = index;
    }
  }
  return true;
}

/**
 * 建物の屋根の色の番号を、地区のテーマの色味から選ぶ。
 * @param work 作業領域
 * @param anchor 建物の左上セルの添字
 * @param col 左上の列
 * @param row 左上の行
 * @returns ROOF_COLORS の番号（0..7）
 */
function roofOf(work: Work, anchor: number, col: number, row: number): number { // audit-ignore: fnlog-missing 建物ごとに呼ぶ純粋な選択ヘルパー
  const palette = ROOF_PALETTES[work.themes[work.district[anchor] ?? 0] ?? 'city'];
  return palette[Math.floor(hash01(col, row, 17) * palette.length)] ?? 7;
}

/**
 * 街区のところどころを小さな公園（木に囲まれた芝・花壇・遊具）にする。建物で埋める前に呼ぶ。
 * @param work 作業領域
 * @sideEffect work.kinds・work.reserved を書き換える
 */
function paintPocketParks(work: Work): void {
  const log = logger.fn('paintPocketParks');
  const step = Math.round(POCKET_PARK_SPACING_M / CELL_M);
  let parks = 0;
  for (let r = 4; r < work.rows - 12; r += step) {
    for (let c = 4; c < work.cols - 12; c += step) {
      if (hash01(c, r, 43) >= POCKET_PARK_RATE) continue;
      const spot = findFreeSquare(work, c, r, 7, 8);
      if (spot === undefined) continue;
      const rect = { col: spot.col, row: spot.row, w: 7, h: 7 };
      fillRect(work, rect, Cell.PARK);
      reserve(work, rect);
      for (let k = 0; k < 7; k += 2) {
        setKind(work, rect.col + k, rect.row, Cell.TREE);
        setKind(work, rect.col + k, rect.row + 6, Cell.TREE);
        setKind(work, rect.col, rect.row + k, Cell.TREE);
        setKind(work, rect.col + 6, rect.row + k, Cell.TREE);
      }
      setKind(work, rect.col + 2, rect.row + 2, hash01(c, r, 47) < 0.5 ? Cell.PLAYGROUND : Cell.GARDEN);
      setKind(work, rect.col + 4, rect.row + 4, Cell.GARDEN);
      parks++;
    }
  }
  log.exit(undefined, `小さな公園 ${parks}`);
}

/**
 * (col,row) の近く（search セル以内）で、size×size がすべて芝の場所を探す。
 * @param work 作業領域
 * @param col 探し始めの列
 * @param row 探し始めの行
 * @param size 一辺（セル）
 * @param search 探す範囲（セル）
 * @returns 左上の列・行（無ければ undefined）
 */
function findFreeSquare(work: Work, col: number, row: number, size: number, search: number): { col: number; row: number } | undefined { // audit-ignore: fnlog-missing 生成の内部ヘルパー（paintPocketParks でまとめてログ）
  for (let dr = 0; dr <= search; dr++) {
    for (let dc = 0; dc <= search; dc++) {
      let ok = true;
      for (let r = row + dr; ok && r < row + dr + size; r++) {
        for (let c = col + dc; c < col + dc + size; c++) {
          const i = cellIndex(work, c, r);
          if (i < 0 || work.kinds[i] !== Cell.GRASS || work.reserved[i] === 1) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return { col: col + dc, row: row + dr };
    }
  }
  return undefined;
}

/**
 * 道からの距離（セル。歩ける道のセルが 0、最大 cap）を多始点の幅優先探索で求める。
 * @param work 作業領域
 * @param cap 打ち切る距離
 * @returns セルごとの距離
 */
function streetDistance(work: Work, cap: number): Uint8Array {
  const log = logger.fn('streetDistance', { cap });
  const dist = new Uint8Array(work.cols * work.rows).fill(255);
  const queue = new Int32Array(work.cols * work.rows);
  let tail = 0;
  for (let i = 0; i < dist.length; i++) {
    if (isStreet(work.kinds[i] ?? -1)) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head] ?? 0;
    const d = dist[i] ?? 255;
    if (d >= cap) continue;
    const c = i % work.cols;
    for (const j of [i - 1, i + 1, i - work.cols, i + work.cols]) {
      if (j < 0 || j >= dist.length || (j === i - 1 && c === 0) || (j === i + 1 && c === work.cols - 1)) continue;
      if ((dist[j] ?? 0) <= d + 1) continue;
      dist[j] = d + 1;
      queue[tail++] = j;
    }
  }
  return log.exit(dist);
}

/**
 * 街区を建物で埋める（道に近い所から。テーマごとの候補を重みつきで選び、入らなければ小さいものを試す）。
 * @param work 作業領域
 * @sideEffect work.kinds・work.buildings・work.buildingAt を書き換える
 */
function fillBuildings(work: Work): void {
  const log = logger.fn('fillBuildings');
  const dist = streetDistance(work, 12);
  for (let r = 0; r < work.rows; r++) {
    for (let c = 0; c < work.cols; c++) {
      const i = r * work.cols + c;
      if (work.kinds[i] !== Cell.GRASS || (dist[i] ?? 255) > 9) continue;
      // ときどき1セルの隙間（庭・木）を残して、詰まりすぎないようにする
      if (hash01(c, r, 23) < 0.07) continue;
      const theme = work.themes[work.district[i] ?? 0] ?? 'city';
      const plans = plansNear(work, c, r, theme, dist[i] ?? 255);
      const first = pickPlan(plans, hash01(c, r, 29));
      const tries = [first, ...[...plans].sort((a, b) => b.w * b.h - a.w * a.h)];
      for (const plan of tries) if (placeBuilding(work, c, r, plan)) break;
    }
  }
  log.exit(undefined, `建物 ${work.buildings.length}`);
}

/**
 * その場所の建物の候補を返す（商店街のそばは店が並ぶ）。
 * @param work 作業領域
 * @param col 列
 * @param row 行
 * @param theme 地区のテーマ
 * @param streetDist 道からの距離（セル）
 * @returns 候補
 */
function plansNear(work: Work, col: number, row: number, theme: TownTheme, streetDist: number): readonly BuildingPlan[] { // audit-ignore: fnlog-missing 街区を埋めるときにセルごとに呼ぶ内部ヘルパー
  const { x } = cellXY(work, col, row);
  const nearArcade = Math.abs(x - work.widthM * ARCADE_X_RATIO) < 30 && streetDist <= 3;
  if (nearArcade) return [{ style: 'shophouse', w: 3, h: 3, weight: 4 }, { style: 'stall', w: 2, h: 2, weight: 2 }, { style: 'cafe', w: 3, h: 3, weight: 1 }];
  return PLANS[theme];
}

/**
 * 重みつきで建物の候補を1つ選ぶ。
 * @param plans 候補
 * @param k 0..1 のばらつき
 * @returns 選んだ候補
 */
function pickPlan(plans: readonly BuildingPlan[], k: number): BuildingPlan { // audit-ignore: fnlog-missing 街区を埋めるときにセルごとに呼ぶ純粋な選択ヘルパー
  const total = plans.reduce((sum, p) => sum + p.weight, 0);
  let t = k * total;
  for (const plan of plans) {
    t -= plan.weight;
    if (t < 0) return plan;
  }
  return plans[plans.length - 1] ?? { style: 'house', w: 2, h: 2, weight: 1 };
}

/**
 * 建物が入らなかった芝を、木・花壇・駐輪場・芝にする（道に面した所は駐輪場が多め）。
 * @param work 作業領域
 * @sideEffect work.kinds を書き換える
 */
function fillLeftovers(work: Work): void {
  const log = logger.fn('fillLeftovers');
  for (let r = 0; r < work.rows; r++) {
    for (let c = 0; c < work.cols; c++) {
      const i = r * work.cols + c;
      if (work.kinds[i] !== Cell.GRASS) continue;
      const theme = work.themes[work.district[i] ?? 0];
      const k = hash01(c, r, 37);
      const besideStreet = [i - 1, i + 1, i - work.cols, i + work.cols].some((j) => isStreet(work.kinds[j] ?? -1));
      if (besideStreet && k < 0.3) work.kinds[i] = Cell.PARKING;
      else if (k < 0.55) work.kinds[i] = theme === 'river' && k < 0.4 ? Cell.SAKURA : Cell.TREE;
      else if (k < 0.85) work.kinds[i] = Cell.GARDEN;
    }
  }
  log.exit(undefined);
}
