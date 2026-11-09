/**
 * @file 演出の装飾の描画（presentation/screens/Effects 層。Canvas 描画の純粋関数）
 * 幾何学的な紙吹雪（四角・三角・丸・細い帯）、4方向のきらめき、やわらかい光の輪（docs/08 §10.5「演出」）。
 * 紙吹雪の動きは effectMath（決定論的・テスト済み）。ここでは描くだけ。
 * requestAnimationFrame の描画ループから毎フレーム呼ばれるため関数ログは出さない（呼び出し側の start/stop でまとめてログ）。
 */
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { PALETTE } from '@/Common/ui/theme/palette';
import { confettiPose } from '@/presentation/screens/Effects/effectMath';
import type { ConfettiPiece } from '@/presentation/screens/Effects/effectMath';

/** 紙吹雪の既定の色（演出で共通の PALETTE.confetti＝ブランド・金・白金・伝説。白いカードの上に描くので白は除く） */
export const CONFETTI_COLORS: readonly string[] = PALETTE.confetti.filter((c) => c !== PALETTE.white);

/**
 * 紙吹雪を描く。
 * @param ctx 描画先
 * @param pieces 小片（effectMath.confettiFor）
 * @param at 広がりの中心・半径（CSS px）
 * @param progress 0〜1
 * @param colors 色の配列（piece.color で選ぶ）
 * @sideEffect ctx に描画する（状態は save/restore で戻す）
 */
export function drawConfetti( // audit-ignore: fnlog-missing 毎フレーム描画
  ctx: CanvasRenderingContext2D,
  pieces: readonly ConfettiPiece[],
  at: { readonly center: Point2D; readonly radius: number },
  progress: number,
  colors: readonly string[] = CONFETTI_COLORS,
): void {
  for (const piece of pieces) {
    const pose = confettiPose(piece, progress);
    if (pose.alpha <= 0) continue;
    ctx.save();
    ctx.translate(at.center.x + pose.dx * at.radius, at.center.y + pose.dy * at.radius);
    ctx.rotate(pose.rotation);
    ctx.globalAlpha = pose.alpha;
    ctx.fillStyle = colors[piece.color % colors.length] ?? CONFETTI_COLORS[0] ?? PALETTE.brand;
    const s = piece.size;
    ctx.beginPath();
    if (piece.shape === 'rect') ctx.rect(-s / 2, -s * 0.3, s, s * 0.6);
    else if (piece.shape === 'bar') ctx.rect(-s * 0.8, -s * 0.16, s * 1.6, s * 0.32);
    else if (piece.shape === 'dot') ctx.arc(0, 0, s * 0.38, 0, Math.PI * 2);
    else { ctx.moveTo(0, -s * 0.55); ctx.lineTo(s * 0.5, s * 0.4); ctx.lineTo(-s * 0.5, s * 0.4); ctx.closePath(); }
    ctx.fill();
    ctx.restore();
  }
}

/**
 * 4方向のきらめき（細いひし形を2つ重ねた星）を描く。
 * @param ctx 描画先
 * @param at 中心
 * @param r 大きさ（中心から先端まで）
 * @param color 色
 * @sideEffect ctx に描画する
 */
export function drawSparkle(ctx: CanvasRenderingContext2D, at: Point2D, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (r <= 0) return;
  const k = r * 0.22;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y - r); ctx.lineTo(at.x + k, at.y - k); ctx.lineTo(at.x + r, at.y); ctx.lineTo(at.x + k, at.y + k);
  ctx.lineTo(at.x, at.y + r); ctx.lineTo(at.x - k, at.y + k); ctx.lineTo(at.x - r, at.y); ctx.lineTo(at.x - k, at.y - k);
  ctx.closePath();
  ctx.fill();
}

/**
 * やわらかい光の輪（中心が濃く外へ消える円）を描く。
 * @param ctx 描画先
 * @param at 中心
 * @param r 半径
 * @param color 中心の色（'rgba(…)'）
 * @sideEffect ctx に描画する
 */
export function drawHalo(ctx: CanvasRenderingContext2D, at: Point2D, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (r <= 0) return;
  const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(at.x - r, at.y - r, r * 2, r * 2);
}
