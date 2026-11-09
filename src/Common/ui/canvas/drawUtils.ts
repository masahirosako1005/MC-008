/**
 * @file Canvas の基本描画関数（Common/ui/canvas 層。状態を持たない純粋な draw 関数）
 * 角丸矩形・多角形・円（破線可）・折れ線・縁取り付き文字。ctx の状態は save/restore で元に戻す。
 * requestAnimationFrame の描画ループから毎フレーム呼ばれるので関数ログは出さない（呼び出し側でまとめてログ）。
 * 文字サイズは CSS px で渡し、scale に textScaleFactor() を渡すと文字拡大設定に追従する。
 */
import type { Point2D, Rect } from '@/Common/ui/canvas/geometry';

/** Canvas の文字に使うフォント（CSS の --font-display と同じ並び。丸ゴシックで地図の絵と調和させる） */
export const CANVAS_FONT_FAMILY = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';

/** 塗り・線のスタイル */
export interface ShapeStyle {
  /** 塗り色（省略時は塗らない） */
  readonly fill?: string;
  /** 線の色（省略時は線を描かない） */
  readonly stroke?: string;
  /** 線幅（CSS px。省略時 1） */
  readonly lineWidth?: number;
  /** 破線パターン（CSS px。省略時は実線） */
  readonly dash?: readonly number[];
  /** 全体の不透明度（0〜1。省略時 1） */
  readonly alpha?: number;
}

/** 文字のスタイル */
export interface TextStyle {
  /** 文字サイズ（CSS px、拡大前） */
  readonly sizePx: number;
  /** 文字拡大の倍率（textScaleFactor() を渡す。省略時 1） */
  readonly scale?: number;
  /** 太さ（省略時 400） */
  readonly weight?: number;
  /** 文字色 */
  readonly color: string;
  /** 縁取り色（省略時は縁取りなし） */
  readonly outlineColor?: string;
  /** 縁取りの太さ（CSS px。省略時 3） */
  readonly outlineWidth?: number;
  readonly align?: CanvasTextAlign;
  readonly baseline?: CanvasTextBaseline;
  /** 最大幅（CSS px。超えると縮めて描く） */
  readonly maxWidth?: number;
}

/**
 * Canvas の font 指定文字列を作る。
 * @param sizePx 文字サイズ（CSS px、拡大前）
 * @param weight 太さ
 * @param scale 文字拡大の倍率
 * @returns 例 '700 13.5px system-ui, …'
 */
export function canvasFont(sizePx: number, weight = 400, scale = 1): string { // audit-ignore: fnlog-missing 毎フレーム描画
  return `${weight} ${Math.round(sizePx * scale * 10) / 10}px ${CANVAS_FONT_FAMILY}`;
}

/**
 * 角丸矩形のパスを作る（beginPath から closePath まで。塗り・線は呼び出し側）。
 * @param ctx 2D コンテキスト
 * @param rect 矩形
 * @param radius 角の半径（幅・高さの半分を超えないよう丸める）
 * @sideEffect ctx の現在パスを置き換える
 */
export function roundRectPath(ctx: CanvasRenderingContext2D, rect: Rect, radius: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  const { x, y, width: w, height: hgt } = rect;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 多角形のパスを作る（beginPath から closePath まで）。
 * @param ctx 2D コンテキスト
 * @param points 頂点（CSS px）
 * @sideEffect ctx の現在パスを置き換える
 */
export function polygonPath(ctx: CanvasRenderingContext2D, points: readonly Point2D[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/**
 * 現在のパスをスタイルに従って塗り・線描きする（ctx の状態は元に戻す）。
 * @param ctx 2D コンテキスト
 * @param style 塗り・線のスタイル
 * @sideEffect ctx に描画する
 */
export function paintPath(ctx: CanvasRenderingContext2D, style: ShapeStyle): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  if (style.alpha !== undefined) ctx.globalAlpha *= Math.min(1, Math.max(0, style.alpha));
  if (style.fill !== undefined) {
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  if (style.stroke !== undefined) {
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.lineWidth ?? 1;
    ctx.setLineDash(style.dash === undefined ? [] : [...style.dash]);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 角丸矩形を描く。
 * @param ctx 2D コンテキスト
 * @param rect 矩形
 * @param radius 角の半径
 * @param style 塗り・線のスタイル
 * @sideEffect ctx に描画する
 */
export function drawRoundRect(ctx: CanvasRenderingContext2D, rect: Rect, radius: number, style: ShapeStyle): void { // audit-ignore: fnlog-missing 毎フレーム描画
  roundRectPath(ctx, rect, radius);
  paintPath(ctx, style);
}

/**
 * 多角形を描く（地区ポリゴンなど）。
 * @param ctx 2D コンテキスト
 * @param points 頂点（CSS px）
 * @param style 塗り・線のスタイル（色あせは dash で破線に）
 * @sideEffect ctx に描画する
 */
export function drawPolygon(ctx: CanvasRenderingContext2D, points: readonly Point2D[], style: ShapeStyle): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (points.length < 2) return;
  polygonPath(ctx, points);
  paintPath(ctx, style);
}

/**
 * 円を描く（実線・破線どちらも可。発見範囲の破線円・スポットの点など）。
 * @param ctx 2D コンテキスト
 * @param center 中心（CSS px）
 * @param radius 半径（CSS px）
 * @param style 塗り・線のスタイル
 * @sideEffect ctx に描画する
 */
export function drawCircle(ctx: CanvasRenderingContext2D, center: Point2D, radius: number, style: ShapeStyle): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (!(radius > 0)) return;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  paintPath(ctx, style);
}

/**
 * 破線の円を描く（発見範囲の円など）。
 * @param ctx 2D コンテキスト
 * @param center 中心（CSS px）
 * @param radius 半径（CSS px）
 * @param style 線の色・幅・破線パターン（dash 省略時は [6, 4]）
 * @sideEffect ctx に描画する
 */
export function drawDashedCircle(ctx: CanvasRenderingContext2D, center: Point2D, radius: number, style: ShapeStyle): void { // audit-ignore: fnlog-missing 毎フレーム描画
  drawCircle(ctx, center, radius, { ...style, dash: style.dash ?? [6, 4] });
}

/**
 * 縁取り付きの文字を描く（地図の上でも読めるよう白などで縁取る）。
 * @param ctx 2D コンテキスト
 * @param text 文字列
 * @param at 位置（CSS px）
 * @param style 文字のスタイル（sizePx×scale で描く）
 * @sideEffect ctx に描画する
 */
export function drawTextWithOutline(ctx: CanvasRenderingContext2D, text: string, at: Point2D, style: TextStyle): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(style.sizePx, style.weight ?? 400, style.scale ?? 1);
  ctx.textAlign = style.align ?? 'center';
  ctx.textBaseline = style.baseline ?? 'middle';
  ctx.lineJoin = 'round';
  if (style.outlineColor !== undefined) {
    ctx.strokeStyle = style.outlineColor;
    ctx.lineWidth = (style.outlineWidth ?? 3) * (style.scale ?? 1);
    ctx.strokeText(text, at.x, at.y, style.maxWidth);
  }
  ctx.fillStyle = style.color;
  ctx.fillText(text, at.x, at.y, style.maxWidth);
  ctx.restore();
}

/** 折れ線のスタイル */
export interface LineStyle {
  /** 線の色 */
  readonly color: string;
  /** 線幅（CSS px） */
  readonly width: number;
  /** 破線パターン（CSS px。省略時は実線） */
  readonly dash?: readonly number[];
  /** 線端（省略時 round） */
  readonly cap?: CanvasLineCap;
  /** 全体の不透明度（0〜1。省略時 1） */
  readonly alpha?: number;
}

/**
 * 折れ線を描く（川・道路・線路・商店街など。角は丸める）。
 * @param ctx 2D コンテキスト
 * @param points 頂点（CSS px。2点未満なら何もしない）
 * @param style 線のスタイル
 * @sideEffect ctx に描画する
 */
export function drawPolyline(ctx: CanvasRenderingContext2D, points: readonly Point2D[], style: LineStyle): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (points.length < 2 || !(style.width > 0)) return;
  ctx.save();
  if (style.alpha !== undefined) ctx.globalAlpha *= Math.min(1, Math.max(0, style.alpha));
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = style.cap ?? 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(style.dash === undefined ? [] : [...style.dash]);
  ctx.stroke();
  ctx.restore();
}
