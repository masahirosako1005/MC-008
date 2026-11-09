/**
 * @file スポットの街なみ絵（presentation/screens/Spot 層）
 * 写真の代わりに Canvas で街なみを描く（CLAUDE.md 6.1：素材不要・統一感・拡大に強い）。docs/08 §10.5 のフラットなモダン都市イラスト。
 * 部品は presentation/shared の cityArt（空・遠景・ビル・店先・街路樹）と landmarkArt（名所のピクト）を使い、
 * スポット詳細のヒーロー・図鑑のタイル・下シートのサムネで同じ絵になる。鳥居・瓦屋根などの「昔の日本」記号は使わない。
 * 訪問済み＝地区色のカラー、未訪問＝シルエット（灰色の形だけ）で「行けば色づく」と見せる（B・C）。
 * 地区色は model.tint、無ければ canvas の CSS 変数 --district（data-district-id から。tokens.css）、それも無ければブランド色。
 * 動きは無いので、大きさが変わったときだけ描き直す（rAF は使わない）。
 */
import type { SpotKindDto, SpotStatusDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { beginFrame, createCanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSize, CanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import { parseHexColor } from '@/Common/ui/canvas/colorUtils';
import { hashString } from '@/Common/ui/canvas/seededHash';
import { h } from '@/Common/ui/dom';
import { PALETTE } from '@/Common/ui/theme/palette';
import { colorTone, FAR_SKYLINE, fillBox, fillDisc, paintCloud, paintFarSkyline, paintMidrise, paintShopfront, paintSky, paintStreetTree, paintTower, silhouetteTone } from '@/presentation/shared/cityArt';
import type { ArtBox, CityTone } from '@/presentation/shared/cityArt';
import { LANDMARK_PAINTERS } from '@/presentation/shared/landmarkArt';
import type { LandmarkArt } from '@/presentation/shared/landmarkArt';
import { paintShopIcon } from '@/presentation/shared/shopIcons';
import type { ShopIcon } from '@/presentation/shared/shopIcons';

const logger = createLogger('presentation/screens/Spot/SpotIllustrationCanvas');

/** 絵の元になる情報 */
export interface SpotIllustrationModel {
  /** 決定論的な乱数の種（スポットID） */
  readonly seed: string;
  readonly kind: SpotKindDto;
  readonly category: string;
  readonly status: SpotStatusDto;
  /** 読み上げ用の名前（名所のピクトの選び分けにも使う） */
  readonly name: string;
  /** 地区色（'#rrggbb'。省略時は CSS の --district → ブランド色） */
  readonly tint?: string;
  /** 地区ID（絵の箱に data-district-id として付け、CSS の地区色を引けるようにする） */
  readonly districtId?: string;
}

/** 絵の操作 */
export interface SpotIllustrationHandle {
  readonly element: HTMLElement;
  /** canvas と監視を片付ける */
  destroy(): void;
}

/** 地面（歩道）の高さ（描画領域の上からの割合） */
const GROUND_RATIO = 0.86;
/** これより幅の小さい絵はサムネとして主役だけ大きく描く（CSS px） */
const THUMB_MAX_PX = 90;

/** 名所の絵の種類（landmarkArt のピクト＋この画面の「都市の中の緑の場所」） */
export type SpotArt = LandmarkArt | 'green';

/** 名所のカテゴリ → 絵の種類 */
const LANDMARK_ART_BY_CATEGORY: Readonly<Record<string, SpotArt>> = {
  '神社': 'green',
  '寺': 'green',
  '寄席': 'theater',
  '商店街': 'arcade',
  '市場': 'arcade',
  '飲食街': 'street',
  '町並み': 'street',
  '博物館': 'museum',
  '建築': 'hall',
  '公園': 'park',
  '広場': 'park',
  '自然': 'park',
  '展望': 'tower',
  '温泉': 'bathhouse',
  '銭湯': 'bathhouse',
  '駅': 'station',
};

/** 名所の名前の手がかり → 絵の種類（カテゴリが分からないとき） */
const LANDMARK_NAME_HINTS: readonly (readonly [string, SpotArt])[] = [['宮', 'green'], ['神社', 'green'], ['寺', 'green'], ['繁昌亭', 'theater'], ['劇', 'theater'], ['公園', 'park'], ['商店街', 'arcade'], ['市場', 'arcade'], ['館', 'museum']];

/** 店の名前の手がかり → 店構えの種類（カテゴリが分からないとき） */
const SHOP_NAME_HINTS: readonly (readonly [string, ShopIcon])[] = [['ベーカリー', 'bread'], ['パン', 'bread'], ['カフェ', 'cup'], ['珈琲', 'cup'], ['喫茶', 'cup'], ['焼き', 'sweets'], ['菓子', 'sweets'], ['甘', 'sweets'], ['うどん', 'bowl'], ['食堂', 'bowl'], ['寿司', 'bowl'], ['餃子', 'bowl'], ['酒', 'glass'], ['書', 'book'], ['本', 'book'], ['花', 'flower']];

/** カテゴリが分からない店に、スポットIDから決定的に選ぶ看板のアイコン */
const FALLBACK_SHOP_ICONS: readonly ShopIcon[] = ['cup', 'bread', 'sweets', 'bowl', 'book', 'bag', 'flower', 'glass'];

/** 店舗のカテゴリ → 看板のアイコン */
const SHOP_ICON_BY_CATEGORY: Readonly<Record<string, ShopIcon>> = {
  '喫茶': 'cup', 'カフェ': 'cup',
  'パン': 'bread',
  '和菓子': 'sweets', '洋菓子': 'sweets', '甘味処': 'sweets', '駄菓子': 'sweets',
  'うどん': 'bowl', '食堂': 'bowl', 'お好み焼き': 'bowl', 'たこ焼き': 'bowl', '寿司': 'bowl', '餃子': 'bowl', '焼き鳥': 'bowl', '精肉コロッケ': 'bowl',
  '鮮魚': 'fish',
  '立ち飲み': 'glass', '酒店': 'glass',
  '古書': 'book',
  '雑貨': 'bag', '金物': 'bag',
  '青果': 'leaf', '漬物': 'leaf', '豆腐': 'leaf',
  '花': 'flower',
  '銭湯': 'bath',
};

/**
 * 名所の絵の種類を選ぶ（名前の手がかり → カテゴリ → 既定は博物館風の建物）。カテゴリが分からない（下シートのサムネ）ときも名前で選ぶ。
 * @param category マスタのカテゴリ（分からなければ空文字）
 * @param name スポット名
 * @returns 絵の種類
 */
export function landmarkArtOf(category: string, name: string): SpotArt {
  const log = logger.fn('landmarkArtOf', { category });
  if (name.includes('高架')) return log.exit('viaduct');
  if (name.includes('桜')) return log.exit('blossom');
  if (name.includes('橋') && !name.includes('筋')) return log.exit('bridge');
  const known = LANDMARK_ART_BY_CATEGORY[category];
  if (known !== undefined) return log.exit(known);
  const byName = LANDMARK_NAME_HINTS.find(([word]) => name.includes(word));
  return log.exit(byName?.[1] ?? 'museum');
}

/**
 * 店舗の看板のアイコン（＝店構えの種類）を選ぶ。カテゴリ → 名前の手がかり（「ベーカリー」「カフェ」「焼き」など）→ スポットIDから決定的に。
 * @param category マスタのカテゴリ（分からなければ空文字）
 * @param seed スポットIDの種（手がかりが無いときに使う）
 * @param name スポット名（省略可）
 * @returns アイコンの種類
 */
export function shopIconOf(category: string, seed = 0, name = ''): ShopIcon {
  const log = logger.fn('shopIconOf', { category });
  const known = SHOP_ICON_BY_CATEGORY[category];
  if (known !== undefined) return log.exit(known);
  const byName = SHOP_NAME_HINTS.find(([word]) => name.includes(word));
  if (byName !== undefined) return log.exit(byName[1]);
  return log.exit(FALLBACK_SHOP_ICONS[seed % FALLBACK_SHOP_ICONS.length] ?? 'bag');
}

/**
 * 絵に使う地区色を決める（model.tint → canvas の CSS 変数 --district → ブランド色）。
 * @param ctx 2D コンテキスト（canvas の計算済みスタイルを読む）
 * @param model 絵の元になる情報
 * @returns '#rrggbb'
 */
function resolveTint(ctx: CanvasRenderingContext2D, model: SpotIllustrationModel): string { // audit-ignore: fnlog-missing paintIllustration でまとめてログ（描画ごとの小さな判定）
  if (model.tint !== undefined && parseHexColor(model.tint) !== undefined) return model.tint;
  const css = typeof getComputedStyle === 'function' && ctx.canvas instanceof HTMLCanvasElement ? getComputedStyle(ctx.canvas).getPropertyValue('--district').trim() : '';
  return parseHexColor(css) !== undefined ? css : PALETTE.brand;
}

/**
 * 背景（空・雲・遠いスカイライン・歩道）を描く。歩道は画面の地色（--paper）に合わせ、下の白いシートとつながって見えるようにする。
 * @param ctx 2D コンテキスト
 * @param size canvas の大きさ
 * @param seed 模様の種
 * @param visited 訪問済みか（未訪問は空を灰色寄りにする）
 * @sideEffect ctx に描画する
 */
function paintBackdrop(ctx: CanvasRenderingContext2D, size: CanvasSize, seed: number, visited: boolean): void { // audit-ignore: fnlog-missing paintIllustration でまとめてログ
  const { width, height } = size;
  const groundY = height * GROUND_RATIO;
  paintSky(ctx, [0, 0, width, groundY], visited ? undefined : ['#e5e8ec', '#f3f4f6']);
  if (visited && height >= 60) paintCloud(ctx, width * (0.12 + (seed % 20) / 100), height * 0.2, width * 0.16);
  paintFarSkyline(ctx, { from: 0, to: width }, { base: groundY, offset: seed % 37, color: visited ? FAR_SKYLINE : '#e5e7eb', minH: groundY * 0.25, maxH: groundY * 0.5, seed, unit: Math.max(10, width / 14) });
  fillBox(ctx, [0, groundY, width, height - groundY], PALETTE.paper);
  fillBox(ctx, [0, groundY, width, Math.max(1, height * 0.01)], '#dfe3e9');
}

/**
 * ヒーローの街並み：左に中層ビル、右に高いビル（非対称で奥行き）、主役の後ろに小さな2トーンの木、手前に主役。
 * 木は主役より奥のレイヤーで地面に立たせる（幹が地面より下へ出ない）。
 * @param ctx 2D コンテキスト
 * @param size canvas の大きさ
 * @param model 絵の元になる情報
 * @param tone 色一式（カラー or シルエット）
 * @sideEffect ctx に描画する
 */
function paintStreet(ctx: CanvasRenderingContext2D, size: CanvasSize, model: SpotIllustrationModel, tone: CityTone): void { // audit-ignore: fnlog-missing paintIllustration でまとめてログ
  const { width, height } = size;
  const groundY = height * GROUND_RATIO;
  const seed = hashString(model.seed);
  paintMidrise(ctx, { x: -width * 0.03, base: groundY, w: width * 0.2, h: groundY * (0.5 + (seed % 12) / 100) }, tone, { seed: seed + 1 });
  paintTower(ctx, { x: width * 0.81, base: groundY, w: width * 0.2, h: groundY * (0.8 + (seed % 10) / 100) }, tone, seed >>> 3);
  const treeW = Math.max(8, width * 0.07);
  paintStreetTree(ctx, { x: width * 0.17, base: groundY, w: treeW, h: groundY * 0.34 }, tone);
  paintStreetTree(ctx, { x: width * 0.74, base: groundY, w: treeW * 0.9, h: groundY * 0.3 }, tone);
  paintSubject(ctx, { x: width * 0.24, base: groundY, w: width * 0.52, h: groundY * 0.72 }, model, tone);
}

/**
 * 主役（名所の絵 or 店構え）を描く。店はアイコンの種類ごとに形を変える（ベーカリー＝アーチ窓、カフェ＝テラスのパラソル、
 * 和菓子・スイーツ＝細長い2階建て、食堂＝横長の暖簾なしの店、そのほか＝2階建ての店）。差し色は地区色1点。
 * @param ctx 2D コンテキスト
 * @param b 範囲
 * @param model 絵の元になる情報
 * @param tone 色一式
 * @sideEffect ctx に描画する
 */
function paintSubject(ctx: CanvasRenderingContext2D, b: ArtBox, model: SpotIllustrationModel, tone: CityTone): void { // audit-ignore: fnlog-missing paintIllustration でまとめてログ
  const seed = hashString(model.seed);
  if (model.kind === 'landmark') {
    const art = landmarkArtOf(model.category, model.name);
    if (art === 'green') paintGreenPlace(ctx, b, tone);
    else LANDMARK_PAINTERS[art](ctx, b, tone, seed);
    return;
  }
  const icon = shopIconOf(model.category, seed, model.name);
  if (icon === 'bread') paintBakery(ctx, b, tone, seed);
  else if (icon === 'cup') paintCafe(ctx, b, tone, seed);
  else if (icon === 'sweets') paintShopfront(ctx, { x: b.x + b.w * 0.2, base: b.base, w: b.w * 0.6, h: b.h * 1.05 }, tone, { icon, floors: 2, seed });
  else if (icon === 'bowl' || icon === 'fish' || icon === 'glass') paintShopfront(ctx, { x: b.x - b.w * 0.04, base: b.base, w: b.w * 1.08, h: b.h * 0.62 }, tone, { icon, floors: 1, seed });
  else paintShopfront(ctx, { x: b.x + b.w * 0.08, base: b.base, w: b.w * 0.84, h: b.h * 0.86 }, tone, { icon, floors: 2, seed });
}

/**
 * ベーカリー：低い店にアーチの大きな窓と丸い看板。
 * @param ctx 2D コンテキスト
 * @param b 範囲
 * @param tone 色一式
 * @param seed 模様の種
 * @sideEffect ctx に描画する
 */
function paintBakery(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, seed: number): void { // audit-ignore: fnlog-missing paintIllustration でまとめてログ
  const h = b.h * 0.66;
  const top = b.base - h;
  fillBox(ctx, [b.x, top, b.w, h], seed % 2 === 0 ? tone.wall : tone.wallAlt);
  fillBox(ctx, [b.x - 2, top - Math.max(2, h * 0.08), b.w + 4, Math.max(2, h * 0.08)], tone.accentDeep);
  const winW = b.w * 0.42;
  const winX = b.x + b.w * 0.1;
  const winTop = top + h * 0.28;
  ctx.save();
  ctx.fillStyle = tone.glass;
  ctx.beginPath();
  ctx.moveTo(winX, b.base - 2);
  ctx.lineTo(winX, winTop + winW / 2);
  ctx.arc(winX + winW / 2, winTop + winW / 2, winW / 2, Math.PI, 0);
  ctx.lineTo(winX + winW, b.base - 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  fillBox(ctx, [b.x + b.w * 0.62, top + h * 0.38, b.w * 0.26, h * 0.62 - 1], tone.glassDeep, 1);
  const signR = Math.max(4, h * 0.13);
  fillDisc(ctx, b.x + b.w * 0.75, top + h * 0.18, signR, tone.accent);
  if (tone.detail && signR >= 5) paintShopIcon(ctx, 'bread', { x: b.x + b.w * 0.75, y: top + h * 0.18 }, signR * 0.62, '#ffffff');
}

/**
 * カフェ：大きなガラスの店先と、前のテラスにパラソルとテーブル。
 * @param ctx 2D コンテキスト
 * @param b 範囲
 * @param tone 色一式
 * @param seed 模様の種
 * @sideEffect ctx に描画する
 */
function paintCafe(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, seed: number): void { // audit-ignore: fnlog-missing paintIllustration でまとめてログ
  paintShopfront(ctx, { x: b.x, base: b.base, w: b.w * 0.74, h: b.h * 0.7 }, tone, { icon: 'cup', floors: 1, seed });
  const px = b.x + b.w * 0.86;
  const top = b.base - b.h * 0.5;
  const span = b.w * 0.2;
  fillBox(ctx, [px - 0.8, top, 1.6, b.base - top], tone.frame);
  ctx.save();
  ctx.fillStyle = tone.accent;
  ctx.beginPath();
  ctx.moveTo(px - span, top + span * 0.35);
  ctx.quadraticCurveTo(px, top - span * 0.35, px + span, top + span * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  fillBox(ctx, [px - span * 0.55, b.base - b.h * 0.16, span * 1.1, Math.max(1.5, b.h * 0.025)], tone.ink, 1);
}

/**
 * 都市の中の緑の場所（神社・寺）：石畳の広場、大きく張り出した平らな庇の低い建物、奥の樹木、手前の植え込み。社殿・鳥居は描かない（docs/08 §10.5）。
 * @param ctx 2D コンテキスト
 * @param b 範囲
 * @param tone 色一式
 * @sideEffect ctx に描画する
 */
function paintGreenPlace(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing paintIllustration でまとめてログ
  const { x, base, w, h } = b;
  paintStreetTree(ctx, { x: x + w * 0.04, base, w: w * 0.2, h: h * 0.78 }, tone);
  paintStreetTree(ctx, { x: x + w * 0.76, base, w: w * 0.2, h: h * 0.72 }, tone);
  paintStreetTree(ctx, { x: x + w * 0.4, base: base - h * 0.3, w: w * 0.2, h: h * 0.62 }, tone);
  const bodyTop = base - h * 0.34;
  fillBox(ctx, [x + w * 0.2, bodyTop, w * 0.6, h * 0.34], tone.wall);
  fillBox(ctx, [x + w * 0.26, bodyTop + h * 0.07, w * 0.48, h * 0.27], tone.glass, 1);
  fillBox(ctx, [x + w * 0.46, bodyTop + h * 0.13, w * 0.08, h * 0.21], tone.glassDeep);
  const roofY = bodyTop - Math.max(3, h * 0.07);
  fillBox(ctx, [x - w * 0.04, roofY, w * 1.08, Math.max(3, h * 0.07)], tone.wall);
  fillBox(ctx, [x - w * 0.04, roofY + Math.max(3, h * 0.07) - 1.5, w * 1.08, 1.5], tone.accent);
  fillBox(ctx, [x + w * 0.02, roofY, 1.6, base - roofY], tone.frame);
  fillBox(ctx, [x + w * 0.98 - 1.6, roofY, 1.6, base - roofY], tone.frame);
  for (const px of [0.1, 0.66]) {
    fillBox(ctx, [x + w * px, base - h * 0.08, w * 0.22, h * 0.08], tone.wallAlt, 1);
    fillBox(ctx, [x + w * px + 1, base - h * 0.14, w * 0.22 - 2, h * 0.07], tone.leaf, 2);
  }
}

/**
 * 街なみ絵を描く。大きい絵（ヒーロー・図鑑）は空・遠景・両隣・木・主役。小さいサムネ（幅 90px 未満）は主役を大きく1つだけ描いて形で見分けられるようにする。
 * @param ctx 2D コンテキスト
 * @param size canvas の大きさ
 * @param model 絵の元になる情報
 * @sideEffect ctx に描画する
 */
export function paintIllustration(ctx: CanvasRenderingContext2D, size: CanvasSize, model: SpotIllustrationModel): void {
  const log = logger.fn('paintIllustration', { seed: model.seed, status: model.status, width: size.width, height: size.height });
  const visited = model.status === 'visited';
  const tone = visited ? colorTone(resolveTint(ctx, model)) : silhouetteTone();
  beginFrame(ctx, size);
  ctx.save();
  if (size.width < THUMB_MAX_PX) {
    const groundY = size.height * 0.84;
    paintSky(ctx, [0, 0, size.width, groundY], visited ? undefined : ['#e5e8ec', '#f3f4f6']);
    fillBox(ctx, [0, groundY, size.width, size.height - groundY], PALETTE.paper);
    paintSubject(ctx, { x: size.width * 0.1, base: groundY, w: size.width * 0.8, h: groundY * 0.8 }, model, tone);
  } else {
    paintBackdrop(ctx, size, hashString(model.seed), visited);
    paintStreet(ctx, size, model, tone);
  }
  ctx.restore();
  log.exit(undefined);
}

/**
 * 街なみ絵を parent に追加して描く（data-testid="spot-illustration"、data-status=状態）。
 * @param parent 絵を入れる親要素（DOM に追加済みであること）
 * @param model 絵の元になる情報
 * @returns 絵の操作
 * @sideEffect parent に要素を追加し、ResizeObserver を登録する
 */
export function createSpotIllustration(parent: HTMLElement, model: SpotIllustrationModel): SpotIllustrationHandle {
  const log = logger.fn('createSpotIllustration', { seed: model.seed, kind: model.kind, status: model.status });
  const box = h('div', { class: 'spot-illust', attrs: { 'data-testid': 'spot-illustration', 'data-status': model.status, 'data-district-id': model.districtId } });
  parent.append(box);
  let surface: CanvasSurface | undefined;
  surface = createCanvasSurface(box, {
    ariaLabel: model.status === 'visited' ? `${model.name}の街なみ（訪問済み）` : `${model.name}のシルエット（未訪問）`,
    onResize: (size): void => {
      if (surface !== undefined) paintIllustration(surface.ctx, size, model);
    },
  });
  if (surface !== undefined) paintIllustration(surface.ctx, surface.size(), model);
  else log.warn('Canvas を使えないため絵を省略します');
  const current = surface;
  return log.exit({ element: box, destroy: (): void => current?.destroy() });
}
