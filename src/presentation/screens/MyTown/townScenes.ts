/**
 * @file 地区ごとの街並みの配置（presentation/screens/MyTown 層。定数のみ）
 * 地区のテーマ（SceneKind）ごとに、建物を置く場所を「建つ順」に並べる。先頭は名所（その地区の象徴＝控えめなモダンのピクト）。
 * 低層の店 → 中層ビル → 高層ビルの順に建ち、街が都会らしく育つ（docs/08 §10.5）。描き方は townPieceArt。
 * 座標は1地区ぶん（幅 DISTRICT_WIDTH_PX）の中の CSS px。base は地面からの持ち上げ、z は奥(-)〜手前(+)。
 */
import type { SceneKind } from '@/presentation/screens/MyTown/myTownModel';

/** 建物・木などの部品の種類 */
export type PieceKind =
  | 'tower' | 'house' | 'shop' | 'castle' | 'station' | 'lighthouse' | 'warehouse' | 'crane'
  | 'boat' | 'tree' | 'pine' | 'willow' | 'lamp' | 'gate' | 'bridge' | 'bathhouse' | 'torii' | 'sakura'
  | 'midrise' | 'pavilion' | 'park';

/** 部品1つの置き方 */
export interface Piece {
  readonly kind: PieceKind;
  readonly x: number;
  readonly w: number;
  readonly h: number;
  /** 地面からの持ち上げ（負なら地面より下＝水面など） */
  readonly base?: number;
  readonly z: number;
}

/** 背景の種類 */
export type SceneBackground = 'plain' | 'hill' | 'river' | 'sea' | 'fields';

/** 1地区の街並み */
export interface Scene {
  readonly background: SceneBackground;
  /** 建つ順（SCENE_SLOT_COUNT 個） */
  readonly pieces: readonly Piece[];
}

/** 1地区の幅（CSS px） */
export const DISTRICT_WIDTH_PX = 200;

/** 街並みの高さ・地面・歩道の位置（CSS px） */
export const STRIP_HEIGHT_PX = 250;
export const GROUND_Y_PX = 180;
export const ROAD_Y_PX = 214;

/**
 * 低層の店が並ぶ（Lv1）→ 中層ビルと店が増える（Lv2）→ 高層ビル（Lv3）の順に建つ配置を作る。先頭は名所。
 * 建つ数（builtSlots）は Lv1=1〜3・Lv2=4〜7・Lv3=8〜9 にほぼ対応する（myTownModel.builtSlotsOf）。
 * @param landmark 名所（地区の象徴。先頭に建つ）
 * @param extra 名所の地区らしさを出す差し替え（4〜7 番目の部品の上書き）
 * @returns 9 個の部品
 */
function cityScene(landmark: Piece, extra: Partial<Record<3 | 4 | 5 | 6, Piece>> = {}): Piece[] { // audit-ignore: fnlog-missing 定数を作るためモジュール読み込み時に数回だけ呼ぶ純粋な配置ヘルパー
  const base: Piece[] = [
    landmark,
    { kind: 'shop', x: 4, w: 46, h: 42, z: 1 },
    { kind: 'shop', x: 150, w: 46, h: 46, z: 1 },
    { kind: 'tree', x: 44, w: 16, h: 36, z: 3 },
    { kind: 'midrise', x: 8, w: 40, h: 90, z: -1 },
    { kind: 'tree', x: 140, w: 16, h: 34, z: 3 },
    { kind: 'midrise', x: 152, w: 40, h: 98, z: -1 },
    { kind: 'tower', x: 108, w: 34, h: 134, z: -3 },
    { kind: 'tower', x: 62, w: 30, h: 118, z: -2 },
  ];
  return base.map((piece, i) => extra[i as 3 | 4 | 5 | 6] ?? piece);
}

/** テーマごとの街並み（旧来のテーマは近い現代の街並みに寄せる） */
const SHRINE: Scene = { background: 'plain', pieces: cityScene({ kind: 'pavilion', x: 56, w: 88, h: 58, z: 2 }) };
const MARKET: Scene = { background: 'plain', pieces: cityScene({ kind: 'gate', x: 52, w: 96, h: 66, z: 2 }, { 5: { kind: 'midrise', x: 120, w: 26, h: 76, z: -2 } }) };
const PLAIN: Scene = { background: 'plain', pieces: cityScene({ kind: 'station', x: 52, w: 96, h: 56, z: 2 }) };
const PARK: Scene = { background: 'plain', pieces: cityScene({ kind: 'park', x: 42, w: 116, h: 62, z: 2 }, { 3: { kind: 'tree', x: 26, w: 18, h: 40, z: 0 }, 5: { kind: 'tree', x: 156, w: 18, h: 38, z: 0 } }) };
const RIVERSIDE: Scene = { background: 'river', pieces: [
  { kind: 'bridge', x: 22, w: 156, h: 46, base: -18, z: 3 },
  { kind: 'sakura', x: 4, w: 34, h: 50, z: 2 },
  { kind: 'shop', x: 40, w: 46, h: 42, z: 1 },
  { kind: 'sakura', x: 162, w: 34, h: 48, z: 2 },
  { kind: 'midrise', x: 120, w: 40, h: 88, z: -1 },
  { kind: 'midrise', x: 84, w: 34, h: 74, z: -1 },
  { kind: 'sakura', x: 92, w: 26, h: 36, z: 2 },
  { kind: 'tower', x: 18, w: 34, h: 130, z: -2 },
  { kind: 'tower', x: 152, w: 30, h: 116, z: -2 },
] };

/** テーマごとの街並み */
export const SCENES: Readonly<Record<SceneKind, Scene>> = {
  shrine: SHRINE,
  market: MARKET,
  arcade: MARKET,
  plain: PLAIN,
  castle: PLAIN,
  park: PARK,
  satoyama: PARK,
  riverside: RIVERSIDE,
  harbor: RIVERSIDE,
  onsen: RIVERSIDE,
};
