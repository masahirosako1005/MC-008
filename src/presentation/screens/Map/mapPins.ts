/**
 * @file 地図のピン・ラベルの描画（presentation/screens/Map 層。状態を持たない純粋な draw 関数群）
 * ピンは全スポット共通の「丸いバッジ」：中にカテゴリの記号（名所＝★、店舗＝店の記号）、外周に地区色、右肩に訪問回数。
 * 未発見＝破線の丸に「？」、発見済み＝白地に灰色の記号（シルエット）、訪問済み＝地区色の塗り（形・記号・色の多重表現）。
 * ラベルは白い角丸の吹き出しで、ピン・地区名・ほかのラベルと重ならない位置を探して置く（置けなければ出さない）。
 * requestAnimationFrame から毎フレーム呼ぶので関数ログは出さない。座標は CSS px。
 */
import { mixColors, toRgba } from '@/Common/ui/canvas/colorUtils';
import { canvasFont, roundRectPath } from '@/Common/ui/canvas/drawUtils';
import type { Point2D, Rect } from '@/Common/ui/canvas/geometry';
import { PALETTE } from '@/Common/ui/theme/palette';
import { fadeTone } from '@/presentation/screens/Map/mapArt';
import type { MapSpotVm } from '@/presentation/screens/Map/MapViewModel';
import type { MapZoom } from '@/presentation/screens/Map/ZoomState';

/** 地区の札の育成リングの半径（CSS px、拡大前） */
const RING_RADIUS = 10;
/** ラベルの吹き出しの高さ（CSS px、拡大前） */
const BUBBLE_H = 20;
/** ピンとラベルの間（CSS px） */
const BUBBLE_GAP = 5;

/** 重なったピンを小さく描くときの半径（CSS px） */
export const MINI_PIN_RADIUS = 5.5;

/**
 * ピンどうしが重ならないよう、優先度の低いピンを小さな点にした半径を返す（訪問済み＞発見済み＞未発見、名所＞店舗、回数の多い順）。
 * 位置は動かさない（タップ判定と地図の正確さを保つ）。
 * @param spots 画面座標つきのスポット
 * @param zoom ズーム段階
 * @returns スポットID → 描く半径
 */
export function resolvePinRadii(spots: readonly { readonly spot: MapSpotVm; readonly x: number; readonly y: number }[], zoom: MapZoom): Map<string, number> { // audit-ignore: fnlog-missing 毎フレーム描画
  /**
   * ピンの優先度（大きいほど先に場所を取る）。
   * @param spot スポット
   * @returns 優先度
   */
  const rank = (spot: MapSpotVm): number => (spot.status === 'visited' ? 200 : spot.status === 'discovered' ? 100 : 0) + (spot.kind === 'landmark' ? 50 : 0) + Math.min(49, spot.visitCount);
  const ordered = [...spots].sort((a, b) => rank(b.spot) - rank(a.spot));
  const placed: { readonly x: number; readonly y: number; readonly r: number }[] = [];
  const radii = new Map<string, number>();
  for (const s of ordered) {
    const full = pinRadius(s.spot, zoom);
    radii.set(s.spot.id, full);
    placed.push({ x: s.x, y: s.y, r: full });
  }
  return radii;
}

/**
 * 小さなピン（重なりで縮めたもの）を描く。訪問済み＝地区色の点、発見済み＝灰の輪、未発見＝破線の輪。
 * @param ctx 2D コンテキスト
 * @param spot スポット
 * @param at 中心
 * @param r 半径
 * @sideEffect ctx に描画する
 */
function drawMiniPin(ctx: CanvasRenderingContext2D, spot: MapSpotVm, at: Point2D, r: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = spot.status === 'visited' ? fadeTone(spot.color, spot.fade) : PALETTE.white;
  ctx.shadowColor = 'rgba(17, 24, 39, 0.25)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (spot.status === 'unknown') ctx.setLineDash([2, 1.5]);
  ctx.strokeStyle = spot.status === 'visited' ? PALETTE.white : spot.status === 'discovered' ? PALETTE.discovered : PALETTE.unknown;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
}

/** 吹き出しの置き場所の候補 */
export type BubbleSide = 'right' | 'left' | 'below' | 'above';

/**
 * ピンの半径（CSS px）を返す。名所は大きく、近接ではさらに大きく描く。
 * @param spot スポット
 * @param zoom ズーム段階
 * @returns 半径
 */
export function pinRadius(spot: MapSpotVm, zoom: MapZoom): number { // audit-ignore: fnlog-missing 毎フレーム描画
  const base = spot.status === 'unknown' ? 8 : spot.kind === 'landmark' ? 12 : 9.5;
  return zoom === 'near' ? base * 1.25 : base;
}

/**
 * 星の頂点（名所の記号）を返す。
 * @param at 中心
 * @param r 外側の半径
 * @returns 10頂点
 */
function starPoints(at: Point2D, r: number): Point2D[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const pts: Point2D[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push({ x: at.x + Math.cos(a) * rr, y: at.y + Math.sin(a) * rr });
  }
  return pts;
}

/**
 * カテゴリの記号を描く（名所＝★、店舗＝屋根つきの店）。
 * @param ctx 2D コンテキスト
 * @param spot スポット
 * @param at 中心
 * @param r ピンの半径
 * @param color 記号の色
 * @sideEffect ctx に描画する
 */
function drawGlyph(ctx: CanvasRenderingContext2D, spot: MapSpotVm, at: Point2D, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  if (spot.kind === 'landmark') {
    starPoints({ x: at.x, y: at.y + r * 0.04 }, r * 0.58).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = r * 0.12;
    ctx.stroke();
    ctx.fill();
  } else {
    const w = r * 0.95;
    ctx.moveTo(at.x - w * 0.62, at.y - w * 0.08);
    ctx.lineTo(at.x - w * 0.45, at.y - w * 0.5);
    ctx.lineTo(at.x + w * 0.45, at.y - w * 0.5);
    ctx.lineTo(at.x + w * 0.62, at.y - w * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(at.x - w * 0.46, at.y - w * 0.02, w * 0.92, w * 0.52);
    ctx.fillStyle = spot.status === 'visited' ? toRgba(PALETTE.ink, 0.35) : PALETTE.white;
    ctx.fillRect(at.x - w * 0.12, at.y + w * 0.14, w * 0.24, w * 0.36);
  }
  ctx.restore();
}

/**
 * スポットのピン（丸いバッジ）を描く。未発見は破線の丸に「？」、発見済みは白地＋灰色の記号、訪問済みは地区色の塗り＋白い記号＋右肩に回数。
 * @param ctx 2D コンテキスト
 * @param spot スポット
 * @param at 中心（CSS px）
 * @param zoom ズーム段階
 * @param scale 文字拡大の倍率
 * @param radius 描く半径（重なりを避けて小さくしたもの。省略時は pinRadius）
 * @sideEffect ctx に描画する
 */
export function drawPin(ctx: CanvasRenderingContext2D, spot: MapSpotVm, at: Point2D, zoom: MapZoom, scale: number, radius?: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const r = radius ?? pinRadius(spot, zoom);
  if (r <= MINI_PIN_RADIUS) {
    drawMiniPin(ctx, spot, at, r);
    return;
  }
  if (spot.status === 'unknown') {
    drawUnknownPin(ctx, at, r, scale);
    return;
  }
  const visited = spot.status === 'visited';
  const tone = visited ? fadeTone(spot.color, spot.fade) : PALETTE.discovered;
  ctx.save();
  ctx.shadowColor = 'rgba(17, 24, 39, 0.28)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  if (spot.kind === 'landmark') traceTeardrop(ctx, at, r + 2.5);
  else ctx.arc(at.x, at.y, r + 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  if (visited) {
    const g = ctx.createLinearGradient(at.x, at.y - r, at.x, at.y + r);
    g.addColorStop(0, mixColors(tone, PALETTE.white, 0.18));
    g.addColorStop(1, mixColors(tone, '#2a2030', 0.12));
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    ctx.strokeStyle = tone;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (spot.fade.dashed && visited) {
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = PALETTE.sepiaInk;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(at.x, at.y, r + 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  drawGlyph(ctx, spot, at, r, visited ? PALETTE.white : tone);
  if (visited && spot.visitCount > 0) drawCountBadge(ctx, spot.visitCount, { x: at.x + r * 0.78, y: at.y - r * 0.78 }, scale);
}

/**
 * しずく型ピン（名所）の外形を今のパスに書き足す。頭の円の中心が地点、下に短い先端を出す（docs/08 §10.4）。
 * @param ctx 2D コンテキスト
 * @param at 頭の円の中心
 * @param r 頭の円の半径
 * @sideEffect ctx のパスに書き足す
 */
function traceTeardrop(ctx: CanvasRenderingContext2D, at: Point2D, r: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const tip = { x: at.x, y: at.y + r * 1.6 };
  const a = Math.PI * 0.25;
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(at.x + r * Math.cos(Math.PI / 2 + a), at.y + r * Math.sin(Math.PI / 2 + a));
  ctx.arc(at.x, at.y, r, Math.PI / 2 + a, Math.PI / 2 - a, false);
  ctx.closePath();
}

/**
 * 未発見のピン（破線の丸＋「？」）を描く。
 * @param ctx 2D コンテキスト
 * @param at 中心
 * @param r 半径
 * @param scale 文字拡大の倍率
 * @sideEffect ctx に描画する
 */
function drawUnknownPin(ctx: CanvasRenderingContext2D, at: Point2D, r: number, scale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.fill();
  ctx.setLineDash([2.5, 2]);
  ctx.strokeStyle = PALETTE.unknown;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = canvasFont(r * 1.1, 800, Math.min(scale, 1.2));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.mutedInk;
  ctx.fillText('?', at.x, at.y + 0.5);
  ctx.restore();
}

/**
 * ピンの右肩に訪問回数のバッジ（紺の丸に白い数字）を描く。
 * @param ctx 2D コンテキスト
 * @param count 訪問回数
 * @param at バッジの中心
 * @param scale 文字拡大の倍率
 * @sideEffect ctx に描画する
 */
function drawCountBadge(ctx: CanvasRenderingContext2D, count: number, at: Point2D, scale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const text = count > 99 ? '99+' : String(count);
  ctx.save();
  ctx.font = canvasFont(9, 800, scale);
  const w = Math.max(14 * scale, ctx.measureText(text).width + 7 * scale);
  const hgt = 14 * scale;
  roundRectPath(ctx, { x: at.x - w / 2, y: at.y - hgt / 2, width: w, height: hgt }, hgt / 2);
  ctx.fillStyle = PALETTE.ink;
  ctx.fill();
  ctx.strokeStyle = PALETTE.white;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = PALETTE.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, at.y + 0.5);
  ctx.restore();
}

/**
 * 王冠（地区の主）を描く。
 * @param ctx 2D コンテキスト
 * @param at 王冠の中心
 * @param size 幅（CSS px）
 * @sideEffect ctx に描画する
 */
export function drawCrown(ctx: CanvasRenderingContext2D, at: Point2D, size: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const w = size;
  const hgt = size * 0.72;
  const x = at.x - w / 2;
  const y = at.y - hgt / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(17, 24, 39, 0.2)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + hgt * 0.28);
  ctx.lineTo(x + w * 0.26, y + hgt * 0.55);
  ctx.lineTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 0.74, y + hgt * 0.55);
  ctx.lineTo(x + w, y + hgt * 0.28);
  ctx.lineTo(x + w * 0.88, y + hgt);
  ctx.lineTo(x + w * 0.12, y + hgt);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, y, 0, y + hgt);
  g.addColorStop(0, '#ffe38a');
  g.addColorStop(1, PALETTE.goldDeep);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = PALETTE.white;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/**
 * 2つの矩形が重なるか。
 * @param a 矩形
 * @param b 矩形
 * @returns 重なれば true
 */
export function rectsOverlap(a: Rect, b: Rect): boolean { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * 吹き出しの矩形を、置き場所の候補ごとに求める。
 * @param at ピンの中心
 * @param r ピンの半径
 * @param w 吹き出しの幅
 * @param hgt 吹き出しの高さ
 * @param side 置き場所
 * @returns 矩形
 */
export function bubbleRect(at: Point2D, r: number, w: number, hgt: number, side: BubbleSide): Rect { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const gap = r + 2.5 + BUBBLE_GAP;
  if (side === 'right') return { x: at.x + gap, y: at.y - hgt / 2, width: w, height: hgt };
  if (side === 'left') return { x: at.x - gap - w, y: at.y - hgt / 2, width: w, height: hgt };
  if (side === 'below') return { x: at.x - w / 2, y: at.y + gap - 2, width: w, height: hgt };
  return { x: at.x - w / 2, y: at.y - gap - hgt + 2, width: w, height: hgt };
}

/**
 * 吹き出しの大きさを測る。
 * @param ctx 2D コンテキスト
 * @param text 文字
 * @param bold 太字か
 * @param scale 文字拡大の倍率
 * @returns 幅・高さ（CSS px）
 */
export function measureBubble(ctx: CanvasRenderingContext2D, text: string, bold: boolean, scale: number): { readonly width: number; readonly height: number } { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(11, bold ? 700 : 500, scale);
  const width = ctx.measureText(text).width + 14 * scale;
  ctx.restore();
  return { width, height: BUBBLE_H * scale };
}

/** placeBubble の入力 */
export interface BubbleRequest {
  readonly text: string;
  readonly at: Point2D;
  readonly pinRadius: number;
  /** 文字の強調色（訪問済みは地区色の濃い色） */
  readonly accent?: string;
  readonly bold: boolean;
}

/**
 * ラベルの吹き出しを、重ならない場所に置いて描く（右→左→下→上の順に試し、どこにも置けなければ描かない）。
 * @param ctx 2D コンテキスト
 * @param req 吹き出しの内容と位置
 * @param taken すでに使われている矩形（置いたら追加する）
 * @param bounds 描画してよい範囲
 * @param scale 文字拡大の倍率
 * @returns 置けたら true
 * @sideEffect ctx に描画し、taken に矩形を追加する
 */
export function placeBubble(ctx: CanvasRenderingContext2D, req: BubbleRequest, taken: Rect[], bounds: Rect, scale: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
  const { width: w, height: hgt } = measureBubble(ctx, req.text, req.bold, scale);
  const sides: readonly BubbleSide[] = ['right', 'left', 'below', 'above'];
  for (const side of sides) {
    const rect = bubbleRect(req.at, req.pinRadius, w, hgt, side);
    const inside = rect.x >= bounds.x && rect.y >= bounds.y && rect.x + rect.width <= bounds.x + bounds.width && rect.y + rect.height <= bounds.y + bounds.height;
    if (!inside || taken.some((t) => rectsOverlap(t, rect))) continue;
    drawBubble(ctx, rect, side, req, scale);
    taken.push(rect);
    return true;
  }
  return false;
}

/**
 * 吹き出しを1つ描く（白い角丸＋ピン側の小さなしっぽ＋柔らかい影）。
 * @param ctx 2D コンテキスト
 * @param rect 吹き出しの矩形
 * @param side ピンから見た置き場所
 * @param req 吹き出しの内容
 * @param scale 文字拡大の倍率
 * @sideEffect ctx に描画する
 */
export function drawBubble(ctx: CanvasRenderingContext2D, rect: Rect, side: BubbleSide, req: Pick<BubbleRequest, 'text' | 'accent' | 'bold'>, scale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.shadowColor = 'rgba(17, 24, 39, 0.18)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = PALETTE.white;
  roundRectPath(ctx, rect, rect.height / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  const cy = rect.y + rect.height / 2;
  const cx = rect.x + rect.width / 2;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const tails: Readonly<Record<BubbleSide, readonly (readonly [number, number])[]>> = {
    right: [[rect.x + 1, cy - 3.5], [rect.x - 3.5, cy], [rect.x + 1, cy + 3.5]],
    left: [[right - 1, cy - 3.5], [right + 3.5, cy], [right - 1, cy + 3.5]],
    below: [[cx - 3.5, rect.y + 1], [cx, rect.y - 3.5], [cx + 3.5, rect.y + 1]],
    above: [[cx - 3.5, bottom - 1], [cx, bottom + 3.5], [cx + 3.5, bottom - 1]],
  };
  ctx.beginPath();
  tails[side].forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
  ctx.fill();
  ctx.font = canvasFont(11, req.bold ? 700 : 500, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = req.accent ?? PALETTE.ink;
  ctx.fillText(req.text, cx, cy + 0.5);
  ctx.restore();
}

/** 地区名の札の入力 */
export interface DistrictBadgeInput {
  readonly name: string;
  readonly level: number;
  /** 地区色（色あせを掛けたもの） */
  readonly tone: string;
  readonly faded: boolean;
  readonly lordMe: boolean;
  readonly unexplored: boolean;
  /** 広域でまとめて示す未発見の数（0 なら出さない） */
  readonly unknownCount?: number;
}

/** 地区名の札の寸法 */
export interface DistrictBadgeMetrics {
  readonly width: number;
  readonly height: number;
  readonly titleWidth: number;
  readonly lvWidth: number;
}

/**
 * 地区名の札の大きさを測る（置き場所を探すため、描く前に使う）。札は［王冠］名前［育成リング］［?n］。
 * @param ctx 2D コンテキスト
 * @param input 札の内容
 * @param scale 文字拡大の倍率
 * @returns 寸法（CSS px）
 */
export function measureDistrictBadge(ctx: CanvasRenderingContext2D, input: DistrictBadgeInput, scale: number): DistrictBadgeMetrics { // audit-ignore: fnlog-missing 毎フレーム描画
  const title = input.faded ? `◌ ${input.name}` : input.name;
  ctx.save();
  ctx.font = canvasFont(13, 700, scale);
  const titleWidth = ctx.measureText(title).width;
  ctx.font = canvasFont(10, 500, scale);
  const unknownWidth = (input.unknownCount ?? 0) > 0 ? ctx.measureText(`?${input.unknownCount ?? 0}`).width + 6 * scale : 0;
  ctx.restore();
  const lvWidth = RING_RADIUS * 2 * scale;
  const crownW = input.lordMe ? 18 * scale : 0;
  return { width: 10 * scale + crownW + titleWidth + 6 * scale + lvWidth + unknownWidth + 6 * scale, height: 28 * scale, titleWidth, lvWidth };
}

/**
 * 地区名の札（白いピル＋弱い影。左に王冠、名前、右に育成リング、未発見があれば小さな「?n」）を描く。
 * 色あせ中は ◌ を前に付け、札を灰色の破線にする（色だけに頼らない）。
 * @param ctx 2D コンテキスト
 * @param at 札の中心
 * @param input 札の内容
 * @param scale 文字拡大の倍率
 * @returns 札の矩形（ラベルの重なり判定に使う）
 * @sideEffect ctx に描画する
 */
export function drawDistrictBadge(ctx: CanvasRenderingContext2D, at: Point2D, input: DistrictBadgeInput, scale: number): Rect { // audit-ignore: fnlog-missing 毎フレーム描画
  const title = input.faded ? `◌ ${input.name}` : input.name;
  const m = measureDistrictBadge(ctx, input, scale);
  const rect = { x: at.x - m.width / 2, y: at.y - m.height / 2, width: m.width, height: m.height };
  ctx.save();
  ctx.shadowColor = 'rgba(17, 24, 39, 0.16)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = input.faded ? '#f1f3f6' : PALETTE.white;
  roundRectPath(ctx, rect, m.height / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (input.faded) {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = PALETTE.mutedInk;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
  let x = rect.x + 10 * scale;
  if (input.lordMe) {
    drawCrown(ctx, { x: x + 7 * scale, y: at.y - 0.5 }, 14 * scale);
    x += 18 * scale;
  }
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = canvasFont(13, 700, scale);
  ctx.fillStyle = input.unexplored || input.faded ? PALETTE.subInk : PALETTE.ink;
  ctx.fillText(title, x, at.y + 0.5);
  ctx.restore();
  x += m.titleWidth + 6 * scale;
  drawGrowthRing(ctx, { x: x + RING_RADIUS * scale, y: at.y }, { radius: RING_RADIUS * scale, level: input.level, color: input.tone, scale });
  ctx.save();
  ctx.font = canvasFont(10, 500, scale);
  drawUnknownChip(ctx, input.unknownCount ?? 0, { x: x + RING_RADIUS * 2 * scale + 4 * scale, y: at.y }, scale);
  ctx.restore();
  return rect;
}

/**
 * 育成リング（3分割の弧＋中央の数字）を Canvas に描く。DOM 版は Common/ui/growthRing.ts（同じ見た目）。
 * @param ctx 2D コンテキスト
 * @param at 中心
 * @param opts 半径・成長段階・地区色・文字拡大の倍率
 * @sideEffect ctx に描画する
 */
export function drawGrowthRing(ctx: CanvasRenderingContext2D, at: Point2D, opts: { readonly radius: number; readonly level: number; readonly color: string; readonly scale: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const level = Math.min(3, Math.max(0, Math.round(opts.level)));
  const r = opts.radius - 1.6;
  const gap = (14 * Math.PI) / 180;
  ctx.save();
  ctx.lineWidth = Math.max(2.4, opts.radius * 0.26);
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const from = -Math.PI / 2 + (i * Math.PI * 2) / 3 + gap / 2;
    const to = -Math.PI / 2 + ((i + 1) * Math.PI * 2) / 3 - gap / 2;
    ctx.strokeStyle = i < level ? opts.color : '#e5e7eb';
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, from, to);
    ctx.stroke();
  }
  ctx.font = canvasFont(10, 700, opts.scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(String(level), at.x, at.y + 0.5);
  ctx.restore();
}

/**
 * タグの並びの幅を測る（drawTagChips と同じ寸法）。
 * @param ctx 2D コンテキスト
 * @param tags タグ
 * @param scale 文字拡大の倍率
 * @returns 幅（CSS px。タグが無ければ 0）
 */
export function measureTagChips(ctx: CanvasRenderingContext2D, tags: readonly MapTagChip[], scale: number): number { // audit-ignore: fnlog-missing 毎フレーム描画
  if (tags.length === 0) return 0;
  ctx.save();
  ctx.font = canvasFont(10, 700, scale);
  const total = tags.reduce((sum, tag) => sum + ctx.measureText(tag.text).width + 14 * scale, 0) + 4 * scale * (tags.length - 1);
  ctx.restore();
  return total;
}

/**
 * 地区の札の右端に、まとめた未発見の数（小さな灰色の「?n」）を描く。
 * @param ctx 2D コンテキスト（文字の設定済み）
 * @param count 未発見の数（0 なら描かない）
 * @param at チップの左端・縦の中心
 * @param scale 文字拡大の倍率
 * @sideEffect ctx に描画する
 */
function drawUnknownChip(ctx: CanvasRenderingContext2D, count: number, at: Point2D, scale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (count <= 0) return;
  ctx.save();
  ctx.font = canvasFont(10, 500, scale);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.mutedInk;
  ctx.fillText(`?${count}`, at.x + 1, at.y + 0.5);
  ctx.restore();
}

/** 地図のタグ（主・色あせ・そろそろ） */
export interface MapTagChip {
  readonly text: string;
  readonly kind: 'lord' | 'fade' | 'soon';
}

/**
 * タグを横に並べて描く（色あせ＝セピアの破線枠、そろそろ＝白地に時計色の文字、主＝金）。
 * @param ctx 2D コンテキスト
 * @param tags タグ
 * @param at 並びの基準点（align='center' なら中央、'left' なら左端。y は中央）
 * @param scale 文字拡大の倍率
 * @param align 揃え
 * @returns 並び全体の矩形（何も描かなければ undefined）
 * @sideEffect ctx に描画する
 */
export function drawTagChips(ctx: CanvasRenderingContext2D, tags: readonly MapTagChip[], at: Point2D, scale: number, align: 'center' | 'left'): Rect | undefined { // audit-ignore: fnlog-missing 毎フレーム描画
  if (tags.length === 0) return undefined;
  ctx.save();
  ctx.font = canvasFont(10, 700, scale);
  const padX = 7 * scale;
  const hgt = 18 * scale;
  const gap = 4 * scale;
  const widths = tags.map((tag) => ctx.measureText(tag.text).width + padX * 2);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (tags.length - 1);
  let x = align === 'center' ? at.x - total / 2 : at.x;
  const area = { x, y: at.y - hgt / 2, width: total, height: hgt };
  tags.forEach((tag, i) => {
    const w = widths[i] ?? 0;
    const rect = { x, y: at.y - hgt / 2, width: w, height: hgt };
    const fill = tag.kind === 'lord' ? '#fff4cf' : tag.kind === 'fade' ? '#f1f3f6' : PALETTE.white;
    const ink = tag.kind === 'lord' ? PALETTE.goldInk : tag.kind === 'fade' ? PALETTE.sepiaInk : PALETTE.deadline;
    ctx.shadowColor = 'rgba(17, 24, 39, 0.14)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    roundRectPath(ctx, rect, hgt / 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (tag.kind === 'fade') {
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = PALETTE.sepiaInk;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag.text, x + w / 2, at.y + 0.5);
    x += w + gap;
  });
  ctx.restore();
  return area;
}

/**
 * 現在地（朱の点＋白い縁＋やわらかい光の輪）を描く。
 * @param ctx 2D コンテキスト
 * @param at 現在地（CSS px）
 * @sideEffect ctx に描画する
 */
export function drawPositionMarker(ctx: CanvasRenderingContext2D, at: Point2D): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  const halo = ctx.createRadialGradient(at.x, at.y, 4, at.x, at.y, 22);
  halo.addColorStop(0, toRgba(PALETTE.brand, 0.32));
  halo.addColorStop(1, toRgba(PALETTE.brand, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'rgba(120, 30, 10, 0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = PALETTE.brand;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
