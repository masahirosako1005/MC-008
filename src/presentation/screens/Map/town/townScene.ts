/**
 * @file 街の上に重ねるもの（presentation/screens/Map/town 層。毎フレーム描く）
 * お店・名所・公衆トイレのドット絵、看板商品の吹き出し、今日だけ・クーポンの印、行きたい・好みのハート、
 * 便利情報フィルタの強調（合うものを光らせ、合わないものを薄く）、陣地の境界と陣取りの演出、チェックインできる円、歩く道筋、地区の札。
 * 「地図だけ見ても行きたくなる」ように、看板商品をアイコンで見せる（未発見の店はシルエット＝B）。座標はログに出さない。
 */
import { canvasFont } from '@/Common/ui/canvas/drawUtils';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { project } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, LatLng, MapDistrictVm, Viewport } from '@/presentation/screens/Map/MapViewModel';
import type { GoodsInfo } from '@/presentation/screens/Map/town/goods';
import { drawGoodsPhoto } from '@/presentation/screens/Map/town/goodsPhoto';
import { badgeSpriteSize, drawBadge, drawGoods, drawLandmark, drawToilet, goodsSpriteSize, landmarkSpriteSize, shopSpriteSize } from '@/presentation/screens/Map/town/pixelSprites';
import type { BadgeSprite, LandmarkSprite } from '@/presentation/screens/Map/town/pixelSprites';
import type { TerritoryModel } from '@/presentation/screens/Map/town/territory';
import type { GridTransform } from '@/presentation/screens/Map/town/townRenderer';
import { TERRITORY_MINE_COLOR, TERRITORY_RIVAL_COLOR } from '@/presentation/screens/Map/town/townTypes';

/** 地図の寄り具合（広域・中間・詳細） */
export type SceneTier = 'wide' | 'district' | 'near';

/** 今日の情報（今日だけ・クーポン・イベント） */
export interface SceneToday {
  /** 札の文字（'今日だけ'・'あと3日'・'開催中'） */
  readonly tag: string;
  readonly title: string;
  /** 今日だけ・今日まで（いちばん目立たせる） */
  readonly hot: boolean;
}

/** 地図に置くもの（スポット・公衆トイレ） */
export interface SceneSpot {
  readonly id: string;
  readonly kind: 'landmark' | 'shop' | 'toilet';
  readonly status: 'unknown' | 'discovered' | 'visited';
  readonly name?: string;
  /** カテゴリ（好みの判定に使う。未発見の店でも文字では出さない） */
  readonly category?: string;
  /** 置く位置（街の敷地の中心） */
  readonly ll: LatLng;
  readonly goods?: GoodsInfo;
  readonly landmark?: LandmarkSprite;
  /** 店のひさしの色 */
  readonly awning: string;
  readonly today?: SceneToday;
  readonly amenities: readonly string[];
  readonly visitCount: number;
  /** 行きたいに入れた */
  readonly want: boolean;
  /** 好みに合う */
  readonly liked: boolean;
  /** 地区の色あせ 0..1 */
  readonly fade: number;
  /** 授乳室（トイレのとき） */
  readonly nursing?: boolean;
  /** 見た目のばらつき */
  readonly seed: number;
}

/** 毎フレームの描画の入力 */
export interface SceneInput {
  readonly camera: Camera;
  readonly vp: Viewport;
  readonly tier: SceneTier;
  readonly t: number;
  readonly textScale: number;
  /** フィルタが有効なとき、合うかどうか（無効なら undefined） */
  readonly matches?: (spot: SceneSpot) => boolean;
  /** 強調の色（フィルタの種類ごと） */
  readonly highlight: string;
  readonly selectedId?: string;
  /** チェックインできる範囲にあるスポット */
  readonly inRange: ReadonlySet<string>;
  /** お店の写真ピンの伸び縮み（チェックインの演出中だけ。横・縦の倍率） */
  readonly pinScale?: (spotId: string) => readonly [number, number];
}

/** 画面に置いたスポット */
export interface PlacedSpot {
  readonly spot: SceneSpot;
  /** 足もと（敷地の中心）の画面座標 */
  readonly x: number;
  readonly y: number;
  /** 描く倍率 */
  readonly scale: number;
  /** 合うか（フィルタ無効なら undefined） */
  readonly match?: boolean;
  /** タップ判定の矩形 */
  readonly hit: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 吹き出しを出すか */
  readonly bubble: boolean;
  /** 名前を出すか */
  readonly label: boolean;
  /** お店の写真ピンの一辺（CSS px。お店以外・点で描くときは 0） */
  readonly pin: number;
}

/** 陣取りの演出 */
export interface ClaimAnimation {
  readonly cells: readonly number[];
  readonly maxDist: number;
  readonly center: { readonly col: number; readonly row: number };
  readonly startedAt: number;
  readonly gained: number;
}

/** 陣取りの演出の時間（ミリ秒） */
export const CLAIM_ANIMATION_MS = 1900;
/** インクの色（輪郭・文字） */
const INK = '#2b2a3a';

/**
 * 寄り具合ごとのスプライトの倍率（0.5 刻み＝高精細画面でドットがそろう）。
 * @param tier 寄り具合
 * @param kind 種類
 * @returns 倍率
 */
export function spriteScale(tier: SceneTier, kind: SceneSpot['kind']): number { // audit-ignore: fnlog-missing 毎フレーム描画
  if (tier === 'near') return kind === 'landmark' ? 1.5 : 1.5;
  if (tier === 'district') return 1;
  return kind === 'landmark' ? 0.75 : 0.5;
}

/**
 * スポットの絵の大きさ（倍率前のドット）。
 * @param spot スポット
 * @returns 幅・高さ
 */
function spriteBox(spot: SceneSpot): { w: number; h: number } { // audit-ignore: fnlog-missing 毎フレーム描画
  if (spot.kind === 'landmark' && spot.landmark !== undefined) return landmarkSpriteSize(spot.landmark);
  if (spot.kind === 'toilet') return { w: 16, h: 16 };
  return shopSpriteSize();
}

/**
 * 見えているスポットを画面に置き、手前（下）ほど後に描く順に並べる。
 * @param spots スポット
 * @param input 描画の入力
 * @returns 置いたスポット
 */
export function placeSpots(spots: readonly SceneSpot[], input: SceneInput): PlacedSpot[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const out: PlacedSpot[] = [];
  const pad = 80;
  for (const spot of spots) {
    if (input.tier === 'wide' && spot.kind === 'toilet' && input.matches === undefined && !spot.want) continue;
    const p = project(input.camera, input.vp, spot.ll);
    if (p.x < -pad || p.y < -pad || p.x > input.vp.width + pad || p.y > input.vp.height + pad) continue;
    const match = input.matches?.(spot);
    const emphasized = spot.want || spot.today?.hot === true || match === true || spot.id === input.selectedId;
    const base = spriteScale(input.tier, spot.kind);
    const scale = input.tier === 'wide' && emphasized && spot.kind !== 'landmark' ? 1 : match === true && input.tier !== 'near' ? base + 0.5 : base;
    const box = spriteBox(spot);
    const bubble = spot.kind === 'shop' && spot.goods !== undefined && (input.tier !== 'wide' || emphasized) && match !== false;
    // 広域は地区の札を主役にし、スポットの名前は出さない（寄ると出る）
    const label = spot.name !== undefined && match !== false && (input.tier === 'near' || (input.tier === 'district' && (emphasized || spot.kind === 'landmark')));
    const pin = spot.kind === 'shop' && (input.tier !== 'wide' || emphasized) ? pinSize(input.tier, match === true || spot.id === input.selectedId) : 0;
    if (pin > 0) {
      out.push({ spot, x: p.x, y: p.y, scale, match, bubble: false, label, pin, hit: { x: p.x - pin / 2 - 6, y: p.y - pin - PIN_TAIL_PX - 8, w: pin + 12, h: pin + PIN_TAIL_PX + 14 } });
      continue;
    }
    const bubbleH = bubble ? goodsSpriteSize() * scale + 14 : 0;
    const w = Math.max(box.w * scale, 28);
    const h = box.h * scale + bubbleH;
    out.push({ spot, x: p.x, y: p.y, scale, match, bubble, label, pin: 0, hit: { x: p.x - w / 2, y: p.y - h - 4, w, h: h + 10 } });
  }
  return out.sort((a, b) => a.y - b.y);
}

/**
 * タップした所のスポットを返す（手前に描いたものを優先し、ほかに無ければ少し離れていても近いものを拾う）。
 * @param placed 置いたスポット
 * @param tap タップした点
 * @returns スポット（無ければ undefined）
 */
export function hitTestScene(placed: readonly PlacedSpot[], tap: Point2D): SceneSpot | undefined { // audit-ignore: fnlog-missing タップごとに呼ぶ純粋な判定ヘルパー
  for (let k = placed.length - 1; k >= 0; k--) {
    const p = placed[k];
    if (p === undefined || p.match === false) continue;
    const r = p.hit;
    if (tap.x >= r.x && tap.x <= r.x + r.w && tap.y >= r.y && tap.y <= r.y + r.h) return p.spot;
  }
  let best: PlacedSpot | undefined;
  let bestD = 26;
  for (const p of placed) {
    if (p.match === false) continue;
    const d = Math.hypot(p.x - tap.x, p.y - 8 - tap.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best?.spot;
}

/**
 * スポットを描く（影 → 強調の輪 → 建物 → 印 → 吹き出し → 名前）。
 * @param ctx 2D コンテキスト
 * @param placed 置いたスポット（描く順）
 * @param input 描画の入力
 * @sideEffect canvas に描く
 */
export function drawSpots(ctx: CanvasRenderingContext2D, placed: readonly PlacedSpot[], input: SceneInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const labels: { x: number; y: number; w: number; h: number }[] = [];
  for (const p of placed) drawOneSpot(ctx, p, input);
  // 名前は大事なもの（選択中・行きたい・今日だけ）から、重ならない分だけ
  const order = [...placed].filter((p) => p.label).sort((a, b) => labelPriority(b, input) - labelPriority(a, input));
  for (const p of order) drawLabel(ctx, p, input, labels);
}

/**
 * 名前を出す優先度。
 * @param p 置いたスポット
 * @param input 描画の入力
 * @returns 大きいほど先
 */
function labelPriority(p: PlacedSpot, input: SceneInput): number { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  return (s.id === input.selectedId ? 100 : 0) + (s.want ? 40 : 0) + (s.today?.hot === true ? 30 : 0) + (p.match === true ? 25 : 0) + (s.kind === 'landmark' ? 20 : 0) + (s.status === 'visited' ? 10 : 0);
}

/**
 * スポットを1つ描く。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param input 描画の入力
 * @sideEffect canvas に描く
 */
function drawOneSpot(ctx: CanvasRenderingContext2D, p: PlacedSpot, input: SceneInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const alpha = p.match === false ? 0.28 : 1;
  const silhouette = s.status === 'unknown' && s.kind === 'shop';
  // 未発見の店は建物を淡く描き、吹き出しの看板商品だけシルエットにする（何のお店かは近づくと分かる＝B）
  const faded = s.status === 'visited' ? s.fade : Math.max(s.fade, s.status === 'unknown' ? 0.72 : 0);
  const box = spriteBox(s);
  const h = box.h * p.scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (input.tier === 'wide' && s.kind === 'shop' && !p.bubble && p.match !== true && s.id !== input.selectedId) {
    drawDot(ctx, p, s);
    ctx.restore();
    return;
  }
  if (p.pin > 0) {
    drawShopPin(ctx, p, input, silhouette);
    ctx.restore();
    return;
  }
  drawShadow(ctx, p.x, p.y, box.w * p.scale * 0.42);
  if (s.id === input.selectedId) drawGlow(ctx, p.x, p.y - h * 0.45, Math.max(box.w, box.h) * p.scale * 0.62, '#1e6bff', input.t);
  if (s.kind === 'landmark' && s.landmark !== undefined) drawLandmark(ctx, s.landmark, p.x, p.y, p.scale, { faded });
  else drawToilet(ctx, p.x, p.y, p.scale, { nursing: s.nursing === true });
  drawMarks(ctx, p, input, p.x + (box.w * p.scale) / 2 - 2, p.y - h + 4);
  if (p.bubble && s.goods !== undefined) drawBubble(ctx, p, input, h, silhouette);
  if (s.id === input.selectedId) drawSelectArrow(ctx, p.x, p.y - h - (p.bubble ? goodsSpriteSize() * p.scale + 16 : 4), input.t);
  ctx.restore();
}

/** 写真ピンのしっぽの長さ（CSS px） */
const PIN_TAIL_PX = 9;
/** 写真ピンの白い縁の太さ（CSS px） */
const PIN_FRAME_PX = 3;

/**
 * 寄り具合ごとの写真ピンの大きさ（強調中は少し大きく）。
 * @param tier 寄り具合
 * @param emphasized 強調中か（フィルタに合う・選択中）
 * @returns 一辺（CSS px）
 */
function pinSize(tier: SceneTier, emphasized: boolean): number { // audit-ignore: fnlog-missing 毎フレーム描画
  const base = tier === 'near' ? 46 : tier === 'district' ? 34 : 24;
  return emphasized ? base + 8 : base;
}

/**
 * お店を「写真ピン」で描く（白い縁の角丸の写真＋地面を指すしっぽ。訪問済みは朱・行きたいはピンク・今日だけは黄の縁）。
 * 未発見の店は写真をぼかしたシルエットにして「？」を重ねる（何のお店かは近づくと分かる＝B）。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param input 描画の入力
 * @param silhouette 未発見の店か
 * @sideEffect canvas に描く
 */
function drawShopPin(ctx: CanvasRenderingContext2D, p: PlacedSpot, input: SceneInput, silhouette: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const size = p.pin;
  const bob = s.today?.hot === true ? Math.sin(input.t / 260) * 1.5 : 0;
  const left = p.x - size / 2;
  const top = p.y - size - PIN_TAIL_PX - PIN_FRAME_PX + bob;
  const radius = Math.max(4, size * 0.24);
  const f = PIN_FRAME_PX;
  const ring = s.today?.hot === true ? '#ffc83d' : s.want ? '#ff8fab' : s.status === 'visited' ? TERRITORY_MINE_COLOR : '#ffffff';
  drawShadow(ctx, p.x, p.y, Math.max(4, size * 0.22));
  // 2026-11-09 ユーザー指示「フィルターするときにお店のサークル（外枠）いらない」: 輪は選択中のお店だけ
  if (s.id === input.selectedId) drawGlow(ctx, p.x, top + size / 2, size * 0.7, '#1e6bff', input.t);
  const squash = input.pinScale?.(s.id);
  if (squash !== undefined && (squash[0] !== 1 || squash[1] !== 1)) {
    ctx.translate(p.x, p.y);
    ctx.scale(squash[0], squash[1]);
    ctx.translate(-p.x, -p.y);
  }
  // 柔らかい影
  ctx.fillStyle = 'rgba(30, 30, 50, 0.22)';
  ctx.beginPath();
  ctx.roundRect(left - f + 1, top - f + 3, size + f * 2, size + f * 2, radius + f);
  ctx.fill();
  // しっぽと縁
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.moveTo(p.x - 6, top + size);
  ctx.lineTo(p.x + 6, top + size);
  ctx.lineTo(p.x, p.y - 1);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(left - f, top - f, size + f * 2, size + f * 2, radius + f);
  ctx.fill();
  if (ring !== '#ffffff') {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(left - 1, top - 1, size + 2, size + 2, radius + 1);
    ctx.fill();
  }
  drawGoodsPhoto(ctx, s.goods?.icon ?? 'gift', left, top, size, { silhouette, radius });
  if (s.status === 'visited' && s.fade > 0.05) {
    ctx.fillStyle = `rgba(238, 238, 238, ${Math.min(0.6, s.fade * 0.6)})`;
    ctx.beginPath();
    ctx.roundRect(left, top, size, size, radius);
    ctx.fill();
  }
  if (silhouette) drawQuestion(ctx, p.x, top + size / 2, size, input.textScale);
  if (s.today !== undefined && input.tier !== 'wide') drawTodayTag(ctx, p.x, top - f - 2, s.today.hot ? s.today.tag : s.today.tag, s.today.hot, input.textScale);
  drawMarks(ctx, p, input, left + size + f, top + 2);
  if (s.id === input.selectedId) drawSelectArrow(ctx, p.x, top - f - (s.today !== undefined ? 16 : 3), input.t);
}

/**
 * 未発見の店の写真に重ねる「？」。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param size 写真の一辺
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawQuestion(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(Math.max(11, size * 0.42), 900, Math.min(textScale, 1.15));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(43, 42, 58, 0.55)';
  ctx.strokeText('？', x, y + 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('？', x, y + 1);
  ctx.restore();
}

/**
 * 写真ピンの上の「今日だけ」などの小さな札（今日だけ・今日までは黄、それ以外は白地に朱の文字）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param bottom 札の下端
 * @param text 文字
 * @param hot 今日だけ・今日までか
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawTodayTag(ctx: CanvasRenderingContext2D, x: number, bottom: number, text: string, hot: boolean, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(9, 900, Math.min(textScale, 1.15));
  const w = ctx.measureText(text).width + 10;
  const h = 14;
  ctx.fillStyle = hot ? '#ffc83d' : '#ffffff';
  ctx.strokeStyle = hot ? '#e0a100' : 'rgba(30, 107, 255, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, bottom - h, w, h, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = hot ? INK : '#1556d6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, bottom - h / 2 + 0.5);
  ctx.restore();
}

/**
 * 広域で目立たない店を小さな点で描く。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param s スポット
 * @sideEffect canvas に描く
 */
function drawDot(ctx: CanvasRenderingContext2D, p: PlacedSpot, s: SceneSpot): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const r = s.status === 'visited' ? 3 : 2.4;
  ctx.fillStyle = INK;
  ctx.fillRect(Math.round(p.x - r - 1), Math.round(p.y - r - 1), Math.round(r * 2 + 2), Math.round(r * 2 + 2));
  ctx.fillStyle = s.status === 'visited' ? TERRITORY_MINE_COLOR : s.status === 'unknown' ? '#9aa0b5' : s.awning;
  ctx.fillRect(Math.round(p.x - r), Math.round(p.y - r), Math.round(r * 2), Math.round(r * 2));
}

/**
 * 足もとの影（だ円）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 足もと
 * @param rx 横の半径
 * @sideEffect canvas に描く
 */
function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = 'rgba(30, 30, 50, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y + 1, Math.max(4, rx), Math.max(2, rx * 0.32), 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 強調の光（ゆっくり脈打つ輪）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param r 半径
 * @param color 色
 * @param t 現在時刻
 * @sideEffect canvas に描く
 */
function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const k = 0.5 + 0.5 * Math.sin(t / 260);
  ctx.save();
  ctx.globalAlpha *= 0.22 + 0.18 * k;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r + 4 + k * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.lineDashOffset = -t / 60;
  ctx.beginPath();
  ctx.arc(x, y, r + 6 + k * 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * 印（訪問の旗と回数・行きたい・好み・チェックインできる）を絵の右上に並べる。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param input 描画の入力
 * @param right 印を並べ始める右端（CSS px）
 * @param top 印の中心の高さ（CSS px）
 * @sideEffect canvas に描く
 */
function drawMarks(ctx: CanvasRenderingContext2D, p: PlacedSpot, input: SceneInput, right: number, top: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const marks: BadgeSprite[] = [];
  if (s.status === 'visited') marks.push('flagMine');
  if (s.want) marks.push('heart');
  else if (s.liked) marks.push('sparkle');
  if (input.inRange.has(s.id) && s.kind !== 'toilet') marks.push('check');
  const scale = input.tier === 'near' ? 1.5 : 1;
  let x = right;
  const y = top;
  for (const mark of marks) {
    const size = badgeSpriteSize(mark) * scale;
    drawBadge(ctx, mark, x, y, scale);
    if (mark === 'flagMine' && s.visitCount > 1 && input.tier !== 'wide') drawCount(ctx, x + size * 0.55, y + size * 0.35, s.visitCount, input.textScale);
    x -= size + 1;
  }
}

/**
 * 訪問回数の小さな数字。
 * @param ctx 2D コンテキスト
 * @param x 左
 * @param y 中心
 * @param count 回数
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawCount(ctx: CanvasRenderingContext2D, x: number, y: number, count: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.font = canvasFont(9, 800, textScale);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(`×${count}`, x, y);
  ctx.fillStyle = INK;
  ctx.fillText(`×${count}`, x, y);
}

/**
 * 看板商品の吹き出し（今日だけは黄色、行きたいはピンクの縁）。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param input 描画の入力
 * @param h 絵の高さ（CSS px）
 * @param silhouette 未発見の店（アイコンをシルエットに）
 * @sideEffect canvas に描く
 */
function drawBubble(ctx: CanvasRenderingContext2D, p: PlacedSpot, input: SceneInput, h: number, silhouette: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const icon = goodsSpriteSize() * p.scale;
  const size = icon + 8;
  const bob = s.today?.hot === true ? Math.sin(input.t / 220) * 1.5 : 0;
  const cx = p.x;
  const cy = p.y - h - size / 2 - 3 + bob;
  const left = Math.round(cx - size / 2);
  const top = Math.round(cy - size / 2);
  const fill = s.today?.hot === true ? '#ffe066' : s.today !== undefined ? '#fff4c2' : '#ffffff';
  ctx.fillStyle = INK;
  ctx.fillRect(left - 1, top - 1, size + 2, size + 2);
  ctx.fillStyle = s.want ? '#ff8fab' : INK;
  ctx.fillRect(left - 1, top - 1, size + 2, size + 2);
  ctx.fillStyle = fill;
  ctx.fillRect(left + 1, top + 1, size - 2, size - 2);
  // しっぽ
  ctx.fillStyle = INK;
  ctx.fillRect(Math.round(cx - 2), top + size, 4, 2);
  ctx.fillRect(Math.round(cx - 1), top + size + 2, 2, 2);
  drawGoods(ctx, s.goods?.icon ?? 'gift', cx, cy, p.scale, { silhouette });
  if (s.today !== undefined) drawBadge(ctx, s.today.hot ? 'today' : 'coupon', left + size, top, input.tier === 'near' ? 1.5 : 1);
}

/**
 * 選択中のスポットの上で弾む矢印。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 下端
 * @param t 現在時刻
 * @sideEffect canvas に描く
 */
function drawSelectArrow(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const bob = Math.round(Math.abs(Math.sin(t / 200)) * 4);
  const top = Math.round(y - 14 - bob);
  ctx.fillStyle = INK;
  ctx.fillRect(Math.round(x - 7), top - 1, 14, 6);
  ctx.fillRect(Math.round(x - 5), top + 5, 10, 3);
  ctx.fillRect(Math.round(x - 3), top + 8, 6, 3);
  ctx.fillStyle = '#1e6bff';
  ctx.fillRect(Math.round(x - 6), top, 12, 4);
  ctx.fillRect(Math.round(x - 4), top + 4, 8, 3);
  ctx.fillRect(Math.round(x - 2), top + 7, 4, 3);
}

/**
 * 名前の札を描く（ほかの札と重なるなら描かない）。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param input 描画の入力
 * @param taken 描いた札の矩形
 * @sideEffect canvas に描く。taken に追加する
 */
function drawLabel(ctx: CanvasRenderingContext2D, p: PlacedSpot, input: SceneInput, taken: { x: number; y: number; w: number; h: number }[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const text = s.today?.hot === true && input.tier === 'near' ? `${s.name ?? ''}` : (s.name ?? '');
  if (text === '') return;
  ctx.font = canvasFont(input.tier === 'near' ? 11 : 10, 700, input.textScale);
  const w = ctx.measureText(text).width + 8;
  const h = 15 * input.textScale;
  const rect = { x: p.x - w / 2, y: p.y + 3, w, h };
  if (taken.some((r) => rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y)) return;
  taken.push(rect);
  ctx.save();
  ctx.globalAlpha = p.match === false ? 0.3 : 1;
  ctx.fillStyle = s.want ? '#ffe3ea' : s.status === 'visited' ? '#fff1ea' : 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = s.want ? '#ff5a7a' : s.status === 'visited' ? TERRITORY_MINE_COLOR : 'rgba(43,42,58,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, p.x, rect.y + h / 2 + 0.5);
  ctx.restore();
}

/**
 * 陣地の境界線を描く（自分は朱の実線、ライバルは紫の破線。白い縁で地図から浮かせる）。
 * @param ctx 2D コンテキスト
 * @param territory 陣地
 * @param tr セル → 画面の変換
 * @param vp 描画領域
 * @param t 現在時刻
 * @sideEffect canvas に描く
 */
export function drawTerritoryEdges(ctx: CanvasRenderingContext2D, territory: TerritoryModel, tr: GridTransform, vp: Viewport, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const width = tr.cellW < 2 ? 1.5 : 2.5;
  strokeEdges(ctx, territory.rivalEdges, tr, vp, { color: TERRITORY_RIVAL_COLOR, width, dash: [5, 4], offset: t / 80 });
  strokeEdges(ctx, territory.mineEdges, tr, vp, { color: TERRITORY_MINE_COLOR, width, dash: [], offset: 0 });
}

/**
 * 線分の集まりを、白い縁つきで描く（画面外の線分は飛ばす）。
 * @param ctx 2D コンテキスト
 * @param edges [c0, r0, c1, r1, ...]
 * @param tr 変換
 * @param vp 描画領域
 * @param style 色・太さ・破線
 * @sideEffect canvas に描く
 */
function strokeEdges(ctx: CanvasRenderingContext2D, edges: Float32Array, tr: GridTransform, vp: Viewport, style: { color: string; width: number; dash: number[]; offset: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (edges.length === 0) return;
  const path = new Path2D();
  for (let k = 0; k < edges.length; k += 4) {
    const x0 = tr.ox + (edges[k] ?? 0) * tr.cellW;
    const y0 = tr.oy + (edges[k + 1] ?? 0) * tr.cellH;
    const x1 = tr.ox + (edges[k + 2] ?? 0) * tr.cellW;
    const y1 = tr.oy + (edges[k + 3] ?? 0) * tr.cellH;
    if (Math.max(x0, x1) < -4 || Math.min(x0, x1) > vp.width + 4 || Math.max(y0, y1) < -4 || Math.min(y0, y1) > vp.height + 4) continue;
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
  }
  ctx.save();
  ctx.lineCap = 'square';
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = style.width + 2.5;
  ctx.stroke(path);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.setLineDash(style.dash);
  ctx.lineDashOffset = -style.offset;
  ctx.stroke(path);
  ctx.restore();
}

/**
 * 陣取りの演出（新しく取ったマスが中心から波のように色づき、「+n マス」が浮かぶ）。
 * @param ctx 2D コンテキスト
 * @param anim 演出
 * @param cols 街の列数
 * @param tr 変換
 * @param t 現在時刻
 * @param textScale 文字の拡大率
 * @returns まだ続くなら true
 * @sideEffect canvas に描く
 */
export function drawClaimAnimation(ctx: CanvasRenderingContext2D, anim: ClaimAnimation, cols: number, tr: GridTransform, t: number, textScale: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
  const elapsed = t - anim.startedAt;
  if (elapsed > CLAIM_ANIMATION_MS) return false;
  const spread = CLAIM_ANIMATION_MS * 0.55;
  ctx.save();
  for (const i of anim.cells) {
    const c = i % cols;
    const r = (i - c) / cols;
    const d = Math.hypot(c - anim.center.col, r - anim.center.row);
    const local = elapsed - (anim.maxDist > 0 ? (d / anim.maxDist) * spread : 0);
    if (local < 0) continue;
    const k = Math.min(1, local / 380);
    const pop = 1 + (1 - k) * 0.6;
    const w = tr.cellW * pop;
    const h = tr.cellH * pop;
    ctx.globalAlpha = (1 - k) * 0.85 + 0.15 * (1 - elapsed / CLAIM_ANIMATION_MS);
    ctx.fillStyle = k < 0.5 ? '#fff3a8' : TERRITORY_MINE_COLOR;
    ctx.fillRect(tr.ox + (c + 0.5) * tr.cellW - w / 2, tr.oy + (r + 0.5) * tr.cellH - h / 2, w, h);
  }
  const cx = tr.ox + (anim.center.col + 0.5) * tr.cellW;
  const cy = tr.oy + (anim.center.row + 0.5) * tr.cellH;
  const ring = (elapsed / CLAIM_ANIMATION_MS) * (anim.maxDist + 4) * tr.cellW;
  ctx.globalAlpha = Math.max(0, 1 - elapsed / CLAIM_ANIMATION_MS);
  ctx.strokeStyle = TERRITORY_MINE_COLOR;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, ring, 0, Math.PI * 2);
  ctx.stroke();
  const rise = Math.min(1, elapsed / 500);
  ctx.globalAlpha = elapsed < CLAIM_ANIMATION_MS * 0.75 ? 1 : Math.max(0, (CLAIM_ANIMATION_MS - elapsed) / (CLAIM_ANIMATION_MS * 0.25));
  ctx.font = canvasFont(18, 900, textScale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffffff';
  // gained が 0 のときは文字を出さない（チェックインでは、ごほうびの帯が「領地 +n マス」を数え上げる）
  if (anim.gained > 0) {
    const label = `領地 +${anim.gained}マス！`;
    ctx.strokeText(label, cx, cy - 46 - rise * 18);
    ctx.fillStyle = TERRITORY_MINE_COLOR;
    ctx.fillText(label, cx, cy - 46 - rise * 18);
  }
  ctx.restore();
  return true;
}

/**
 * チェックインできる範囲の円（自分の位置が中心。中に入ったスポットはチェックインできる）。
 * @param ctx 2D コンテキスト
 * @param center 自分の画面座標
 * @param radiusPx 半径（CSS px）
 * @param label 円に添える文字（無ければ添えない）
 * @param textScale 文字の拡大率
 * @param t 現在時刻
 * @sideEffect canvas に描く
 */
export function drawCheckInCircle(ctx: CanvasRenderingContext2D, center: Point2D, radiusPx: number, label: string | undefined, textScale: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (radiusPx < 6) return;
  ctx.save();
  ctx.fillStyle = 'rgba(30, 107, 255, 0.09)';
  ctx.beginPath();
  ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = '#1e6bff';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.lineDashOffset = -t / 70;
  ctx.stroke();
  if (label !== undefined) {
    ctx.setLineDash([]);
    ctx.font = canvasFont(10, 800, textScale);
    const w = ctx.measureText(label).width + 10;
    const x = center.x - w / 2;
    const y = center.y - radiusPx - 9;
    ctx.fillStyle = '#1e6bff';
    ctx.beginPath();
    ctx.roundRect(x, y - 8, w, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, center.x, y + 0.5);
  }
  ctx.restore();
}

/**
 * これから歩く道筋（点線）と行き先の旗。
 * @param ctx 2D コンテキスト
 * @param points 道筋の画面座標（先頭が今の位置）
 * @param t 現在時刻
 * @sideEffect canvas に描く
 */
export function drawRoute(ctx: CanvasRenderingContext2D, points: readonly Point2D[], t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (points.length < 2) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = '#1e6bff';
  ctx.lineWidth = 3.5;
  ctx.setLineDash([2, 7]);
  ctx.lineDashOffset = -t / 40;
  ctx.stroke();
  ctx.restore();
}

/**
 * 地区の札（広域・中間。地区名と Lv、自分が主なら王冠、ライバルが主なら紫の旗、色あせの札）。
 * @param ctx 2D コンテキスト
 * @param districts 地区
 * @param camera カメラ
 * @param vp 描画領域
 * @param tier 寄り具合
 * @param mineByDistrict 地区ごとの自分の陣地（マス）
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
export function drawDistrictLabels(ctx: CanvasRenderingContext2D, districts: readonly MapDistrictVm[], camera: Camera, vp: Viewport, tier: SceneTier, mineByDistrict: ReadonlyMap<string, number>, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (tier === 'near') return;
  for (const d of districts) {
    const p = project(camera, vp, d.center);
    if (p.x < -60 || p.y < -30 || p.x > vp.width + 60 || p.y > vp.height + 30) continue;
    const mine = mineByDistrict.get(d.id) ?? 0;
    const sub = mine > 0 ? `領地 ${mine}マス` : undefined;
    drawDistrictPill(ctx, { x: p.x, y: tier === 'wide' ? p.y : p.y - 40 }, d, sub, textScale, tier === 'wide' ? 13 : 11);
  }
}

/**
 * 地区の札を1つ描く。
 * @param ctx 2D コンテキスト
 * @param at 中心
 * @param d 地区
 * @param sub 下の小さな文字
 * @param textScale 文字の拡大率
 * @param size 文字の大きさ（px）
 * @sideEffect canvas に描く
 */
function drawDistrictPill(ctx: CanvasRenderingContext2D, at: Point2D, d: MapDistrictVm, sub: string | undefined, textScale: number, size: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(size, 900, textScale);
  const title = d.label;
  const w = ctx.measureText(title).width + 22 + (d.isLordMe ? 14 : 0);
  const h = (size + 10) * textScale;
  const x = at.x - w / 2;
  const y = at.y - h / 2;
  ctx.globalAlpha = 0.95 * Math.max(0.55, d.fade.alpha);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(x - 1.5, y - 1.5, w + 3, h + 3, 7);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.fillStyle = d.color;
  ctx.fillRect(x + 6, y + 4, 4, h - 8);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, x + 14, at.y + 0.5);
  if (d.isLordMe) drawBadge(ctx, 'crown', x + w - 10, at.y, 1);
  if (sub !== undefined || d.fadeTag !== undefined) {
    const text = [sub, d.fadeTag].filter((v) => v !== undefined).join('・');
    ctx.font = canvasFont(9, 800, textScale);
    const sw = ctx.measureText(text).width + 10;
    ctx.fillStyle = d.fadeTag !== undefined ? '#8a8fa3' : TERRITORY_MINE_COLOR;
    ctx.beginPath();
    ctx.roundRect(at.x - sw / 2, y + h + 2, sw, 14 * textScale, 7);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(text, at.x, y + h + 2 + 7 * textScale);
  }
  ctx.restore();
}

/**
 * 発見の輪（スポットのまわりに広がる輪）。
 * @param ctx 2D コンテキスト
 * @param at 中心
 * @param k 進み 0..1
 * @sideEffect canvas に描く
 */
export function drawDiscoveryRing(ctx: CanvasRenderingContext2D, at: Point2D, k: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = '#ffb400';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(at.x, at.y - 10, 10 + k * 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * 出典の小さな文字（右上・フィルタの列の下）。公衆トイレの位置は OpenStreetMap のデータを使っているため表示する（ODbL）。
 * @param ctx 2D コンテキスト
 * @param text 出典
 * @param vp 描画領域
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
export function drawAttribution(ctx: CanvasRenderingContext2D, text: string, vp: Viewport, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(8, 600, textScale);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeText(text, vp.width - 6, 58);
  ctx.fillStyle = 'rgba(43,42,58,0.75)';
  ctx.fillText(text, vp.width - 6, 58);
  ctx.restore();
}
