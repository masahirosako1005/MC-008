/**
 * @file マイ街の街並みの部品をモダンな都市イラストで描く（presentation/screens/MyTown 層。Canvas 描画の純粋関数）
 * 街並みの配置（townScenes の PieceKind）を、共通の絵の部品（shared/cityArt・landmarkArt）に対応づける（docs/08 §10.5）。
 * 低層の店＝ガラス張りの店先と地区色のストライプの日よけ、中層ビル・高層ビル＝窓のグリッド、名所＝控えめなピクト。
 * 旧来の部品名（torii・castle など）も残っているが、鳥居・城などは描かず現代の形に置き換える。
 * 毎フレーム描画から呼ばれるため関数ログは出さない（呼び出し側でまとめてログ）。
 */
import { fillBox, fillDisc, fillPoly, paintMidrise, paintShopfront, paintStreetLamp, paintStreetTree, paintTower } from '@/presentation/shared/cityArt';
import type { ArtBox, CityTone } from '@/presentation/shared/cityArt';
import { LANDMARK_PAINTERS } from '@/presentation/shared/landmarkArt';
import { paintShopIcon } from '@/presentation/shared/shopIcons';
import type { ShopIcon } from '@/presentation/shared/shopIcons';
import type { PieceKind } from '@/presentation/screens/MyTown/townScenes';

/** 店の看板のアイコン（位置から決定論的に選ぶ） */
const SHOP_ICONS: readonly ShopIcon[] = ['cup', 'bread', 'bowl', 'book', 'bag', 'sweets', 'flower', 'glass'];

/** 部品を描く関数 */
type PiecePainter = (ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, seed: number) => void;

/**
 * 門前の案内塔（地区色のパネルに梅の紋＋植え込み）を描く。鳥居の代わりの目印。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 */
function paintPylon(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const cx = b.x + b.w / 2;
  const pw = Math.max(8, b.w * 0.3);
  const top = b.base - b.h;
  fillBox(ctx, [cx - pw / 2, top, pw, b.h], tone.wall, 2);
  fillBox(ctx, [cx - pw / 2, top, pw, b.h * 0.42], tone.accent, 2);
  if (tone.detail) {
    fillDisc(ctx, cx, top + b.h * 0.2, pw * 0.32, '#ffffff');
    paintShopIcon(ctx, 'plum', { x: cx, y: top + b.h * 0.2 }, pw * 0.22, tone.accent);
  }
  fillBox(ctx, [b.x, b.base - b.h * 0.14, b.w * 0.26, b.h * 0.14], tone.leaf, 2);
  fillBox(ctx, [b.x + b.w * 0.74, b.base - b.h * 0.14, b.w * 0.26, b.h * 0.14], tone.leaf, 2);
}

/**
 * 小さな船（白い船体に地区色の帯）を描く。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 */
function paintBoat(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  fillBox(ctx, [b.x + b.w * 0.3, b.base - b.h, b.w * 0.36, b.h * 0.5], tone.wall, 2);
  fillPoly(ctx, [[b.x, b.base - b.h * 0.5], [b.x + b.w, b.base - b.h * 0.5], [b.x + b.w * 0.86, b.base], [b.x + b.w * 0.08, b.base]], tone.wallAlt);
  fillBox(ctx, [b.x + b.w * 0.04, b.base - b.h * 0.36, b.w * 0.9, b.h * 0.12], tone.accent);
}

/** 部品の種類 → 描き方 */
const PAINTERS: Readonly<Record<PieceKind, PiecePainter>> = {
  tower: (ctx, b, tone, seed) => paintTower(ctx, b, tone, seed),
  midrise: (ctx, b, tone, seed) => paintMidrise(ctx, b, tone, { seed, shopBase: seed % 2 === 0 }),
  house: (ctx, b, tone, seed) => paintMidrise(ctx, b, tone, { seed }),
  warehouse: (ctx, b, tone, seed) => paintMidrise(ctx, b, tone, { seed, shopBase: true }),
  crane: (ctx, b, tone, seed) => paintTower(ctx, b, tone, seed),
  shop: (ctx, b, tone, seed) => paintShopfront(ctx, b, tone, { icon: SHOP_ICONS[seed % SHOP_ICONS.length], floors: b.h >= 46 ? 2 : 1, seed }),
  tree: (ctx, b, tone) => paintStreetTree(ctx, b, tone),
  pine: (ctx, b, tone) => paintStreetTree(ctx, b, tone),
  willow: (ctx, b, tone) => paintStreetTree(ctx, b, tone),
  sakura: (ctx, b, tone) => paintStreetTree(ctx, b, tone, true),
  lamp: (ctx, b, tone) => paintStreetLamp(ctx, b.x + b.w / 2, b.base, b.h, tone),
  torii: paintPylon,
  boat: paintBoat,
  pavilion: LANDMARK_PAINTERS.pavilion,
  park: LANDMARK_PAINTERS.park,
  gate: LANDMARK_PAINTERS.arcade,
  station: LANDMARK_PAINTERS.station,
  bridge: LANDMARK_PAINTERS.bridge,
  castle: LANDMARK_PAINTERS.hall,
  lighthouse: LANDMARK_PAINTERS.tower,
  bathhouse: LANDMARK_PAINTERS.bathhouse,
};

/**
 * 街並みの部品を1つ描く。
 * @param ctx 描画先
 * @param kind 部品の種類
 * @param b 範囲（x=左端、base=足元の Y）
 * @param tone 色一式（地区色のカラー・ライトアップ）
 * @param seed 模様の種（整数。窓の灯り・看板のアイコン・ビルの形を決める）
 * @sideEffect ctx に描画する
 */
export function paintTownPiece(ctx: CanvasRenderingContext2D, kind: PieceKind, b: ArtBox, tone: CityTone, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  PAINTERS[kind](ctx, b, tone, Math.abs(Math.round(seed)));
}
