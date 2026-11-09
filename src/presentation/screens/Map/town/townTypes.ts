/**
 * @file オリジナル地図「ドット絵の街」の共通の型と定数（presentation/screens/Map/town 層）
 * 実在の地理（OSM）は使わず、スポットの位置と地区の形だけを手がかりに、5m 四方のセルを並べた架空の街を作る。
 * 生成（townGenerator）・経路（townPath）・タイル描画（townArt）・合成（townRenderer）がこの型を共有する。
 * セル (col, row) は北西の角を原点に、col は東へ、row は南へ増える。位置座標はログに出さない。
 */

/** 1セルの一辺（メートル）。道路は2セル（10m）、大通りは3〜4セル */
export const CELL_M = 5;
/** 1セルを描くドット数（ドット絵の解像度。1ドット ≒ 0.625m） */
export const CELL_PX = 8;
/** 描画キャッシュの1チャンクのセル数（一辺）。32セル＝160m＝256ドット */
export const CHUNK_CELLS = 32;
/** 1チャンクのドット数（一辺） */
export const CHUNK_PX = CHUNK_CELLS * CELL_PX;
/** 全体図（広域用の縮小画像）で1セルを描くドット数 */
export const OVERVIEW_PX_PER_CELL = 2;
/** 市域の外側にも街を続ける幅（メートル）。どこへ動かしても地図が途切れないようにする */
export const TOWN_MARGIN_M = 700;

/** セルの種類（Uint8Array に入れる値） */
export const Cell = {
  /** 空き地の芝（歩けない） */
  GRASS: 0,
  /** 道路（歩ける） */
  ROAD: 1,
  /** 大通り（歩ける。中央線あり） */
  AVENUE: 2,
  /** 商店街（歩行者天国。歩ける） */
  ARCADE: 3,
  /** 路地（1セル幅。歩ける） */
  ALLEY: 4,
  /** 公園・川沿いの遊歩道（歩ける） */
  PATH: 5,
  /** 石畳の広場・境内（歩ける） */
  PLAZA: 6,
  /** 橋（歩ける） */
  BRIDGE: 7,
  /** 川（歩けない） */
  WATER: 8,
  /** 川岸の護岸・砂地（歩けない） */
  BANK: 9,
  /** 公園の芝（歩ける。経路は遠回りを嫌う） */
  PARK: 10,
  /** 池（歩けない） */
  POND: 11,
  /** 建物（buildingAt で建物を引く。歩けない） */
  BUILDING: 12,
  /** スポットの敷地（スポットの絵を上に重ねる。経路の目的地にだけなる） */
  LOT: 13,
  /** 木（歩けない） */
  TREE: 14,
  /** 桜（歩けない） */
  SAKURA: 15,
  /** 花壇・庭（歩けない） */
  GARDEN: 16,
  /** 駐車場・駐輪場（歩ける） */
  PARKING: 17,
  /** 遊具（歩けない） */
  PLAYGROUND: 18,
} as const;

/** セルの種類の値 */
export type CellKind = (typeof Cell)[keyof typeof Cell];

/** overlay のビット: 高架の線路が上を通る（下は歩ける） */
export const OVERLAY_VIADUCT = 1;
/** overlay のビット: 駅のホーム（高架の上） */
export const OVERLAY_STATION = 2;

/** 地区のテーマ（街並みの描き分け）。city は地区の外 */
export type TownTheme = 'monzen' | 'market' | 'living' | 'alley' | 'river' | 'city';

/** 建物の種類（3/4 見下ろしで、屋根＋正面の壁を敷地の中に描く） */
export type BuildingStyle =
  | 'house'
  | 'kawaraHouse'
  | 'nagaya'
  | 'apartment'
  | 'mansion'
  | 'office'
  | 'shophouse'
  | 'stall'
  | 'cafe'
  | 'warehouse'
  | 'station';

/** 街の建物（敷地は col..col+w-1 × row..row+h-1） */
export interface TownBuilding {
  readonly col: number;
  readonly row: number;
  readonly w: number;
  readonly h: number;
  readonly style: BuildingStyle;
  /** 屋根・ひさしの色の番号（0..7。townArt の色表で引く） */
  readonly roof: number;
  /** 窓・飾りのばらつき用の種 */
  readonly seed: number;
  /** 地区の番号（0=地区の外、1..n） */
  readonly district: number;
}

/** スポット（名所・店舗）や公衆トイレを置いたセル */
export interface TownAnchor {
  /** 敷地の中心セル */
  readonly col: number;
  readonly row: number;
  /** 敷地に接する歩けるセル（入口。経路の終点） */
  readonly doorCol: number;
  readonly doorRow: number;
}

/** 生成済みの街（不変として扱う。配列は読み取り専用で使う） */
export interface TownGrid {
  readonly cols: number;
  readonly rows: number;
  /** 北西の角（セル (0,0) の左上）の緯度経度 */
  readonly originLat: number;
  readonly originLng: number;
  /** 経度1度あたりのメートル（市域の中心の緯度で固定） */
  readonly metersPerDegLng: number;
  /** セルの種類（cols*rows。Cell の値） */
  readonly kinds: Uint8Array;
  /** セルの地区番号（0=地区の外、1..n は districtIds の添字+1） */
  readonly district: Uint8Array;
  /** セルごとのばらつき（0..255。草の模様・花の色などに使う） */
  readonly variant: Uint8Array;
  /** 重ねて描くもの（OVERLAY_* のビット） */
  readonly overlay: Uint8Array;
  /** セル → 建物の添字（建物でなければ -1） */
  readonly buildingAt: Int32Array;
  readonly buildings: readonly TownBuilding[];
  /** 地区番号-1 → 地区ID */
  readonly districtIds: readonly string[];
  /** 地区番号 → テーマ（添字0は地区の外＝city） */
  readonly themes: readonly TownTheme[];
  /** スポットID・便利施設ID → 置いたセル */
  readonly anchors: ReadonlyMap<string, TownAnchor>;
}

/** 描画で変わる状態（成長・色あせ・陣地）。変わったらチャンクを描き直す */
export interface TownPaintState {
  /** 地区番号 → 成長段階 0..3（添字0は地区の外で常に0） */
  readonly levels: readonly number[];
  /** 地区番号 → 色あせ 0..1（1 が最も薄い。添字0は0） */
  readonly fades: readonly number[];
  /** セルごとの陣地（cols*rows。0=なし、1=自分、2=ライバル） */
  readonly territory: Uint8Array;
}

/** 陣地の値: なし */
export const TERRITORY_NONE = 0;
/** 陣地の値: 自分 */
export const TERRITORY_MINE = 1;
/** 陣地の値: ライバル（地区の主） */
export const TERRITORY_RIVAL = 2;

/** 自分の陣地の色 */
export const TERRITORY_MINE_COLOR = '#1e6bff';
/** ライバルの陣地の色 */
export const TERRITORY_RIVAL_COLOR = '#ff5a3d';

/**
 * セルの添字を返す（範囲外は -1）。
 * @param grid 街
 * @param col 列
 * @param row 行
 * @returns 添字
 */
export function cellIndex(grid: Pick<TownGrid, 'cols' | 'rows'>, col: number, row: number): number { // audit-ignore: fnlog-missing 毎フレーム描画・経路探索で呼ぶ純粋な算術ヘルパー
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return -1;
  return row * grid.cols + col;
}

/**
 * 歩けるセルか（経路探索に使う。LOT は目的地としてだけ別に扱う）。
 * @param kind セルの種類
 * @returns 歩けるなら true
 */
export function isWalkable(kind: number): boolean { // audit-ignore: fnlog-missing 経路探索で呼ぶ純粋な判定ヘルパー
  return (
    kind === Cell.ROAD ||
    kind === Cell.AVENUE ||
    kind === Cell.ARCADE ||
    kind === Cell.ALLEY ||
    kind === Cell.PATH ||
    kind === Cell.PLAZA ||
    kind === Cell.BRIDGE ||
    kind === Cell.PARK ||
    kind === Cell.PARKING
  );
}

/**
 * 道として描くセルか（道路・大通り・商店街・路地・橋）。
 * @param kind セルの種類
 * @returns 道なら true
 */
export function isStreet(kind: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画・生成で呼ぶ純粋な判定ヘルパー
  return kind === Cell.ROAD || kind === Cell.AVENUE || kind === Cell.ARCADE || kind === Cell.ALLEY || kind === Cell.BRIDGE;
}

/**
 * セルの中心の緯度経度を返す。
 * @param grid 街
 * @param col 列（小数可）
 * @param row 行（小数可）
 * @returns 緯度経度
 */
export function cellCenterLatLng(grid: Pick<TownGrid, 'originLat' | 'originLng' | 'metersPerDegLng'>, col: number, row: number): { lat: number; lng: number } { // audit-ignore: fnlog-missing 経路・描画で呼ぶ純粋な変換ヘルパー（座標はログに出さない）
  return {
    lat: grid.originLat - ((row + 0.5) * CELL_M) / 111_000,
    lng: grid.originLng + ((col + 0.5) * CELL_M) / grid.metersPerDegLng,
  };
}

/**
 * 緯度経度を含むセル（小数の列・行）を返す。
 * @param grid 街
 * @param ll 緯度経度
 * @returns 列・行（小数。セルの左上が整数）
 */
export function latLngToCell(grid: Pick<TownGrid, 'originLat' | 'originLng' | 'metersPerDegLng'>, ll: { readonly lat: number; readonly lng: number }): { col: number; row: number } { // audit-ignore: fnlog-missing 経路・描画で呼ぶ純粋な変換ヘルパー（座標はログに出さない）
  return {
    col: ((ll.lng - grid.originLng) * grid.metersPerDegLng) / CELL_M,
    row: ((grid.originLat - ll.lat) * 111_000) / CELL_M,
  };
}
