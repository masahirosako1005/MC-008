/**
 * @file QR コードを canvas に描く（Common/ui/canvas 層）
 * マスの大きさをデバイスピクセルの整数にそろえて、にじまずくっきり描く（読み取りやすさ優先）。周りに白い余白（クワイエットゾーン）を4マス取る。
 * 符号化は Common/qr/qrCode。色は既定で墨色（PALETTE.ink）と白（黒白の差が十分あるので読み取れる）。
 */
import { createLogger } from '@/Common/logging/logger';
import { qrIsDark } from '@/Common/qr/qrCode';
import type { QrMatrix } from '@/Common/qr/qrCode';
import { PALETTE } from '@/Common/ui/theme/palette';

const logger = createLogger('Common/ui/canvas/drawQr');

/** 余白（クワイエットゾーン）のマスの数（仕様の最小） */
export const QR_QUIET_MODULES = 4;

/** 描き方 */
export interface QrPaintOptions {
  /** 黒のマスの色（既定 PALETTE.ink） */
  readonly dark?: string;
  /** 白のマスと余白の色（既定 白） */
  readonly light?: string;
  /** 余白のマスの数（既定 4） */
  readonly quiet?: number;
}

/**
 * QR コードを (x, y) から一辺 size の正方形に描く。マスの大きさは scale（デバイスピクセル比）で整数にそろえ、余った分は中央に寄せる。
 * @param ctx 2D コンテキスト（CSS px 座標。setTransform(dpr) 済みでよい）
 * @param qr QR コード
 * @param box 左・上・一辺（CSS px）と dpr
 * @param opts 色・余白
 * @returns 実際に描いた一辺（CSS px。余白を含む）
 * @sideEffect canvas に描く
 */
export function drawQr(ctx: CanvasRenderingContext2D, qr: QrMatrix, box: { readonly x: number; readonly y: number; readonly size: number; readonly dpr: number }, opts: QrPaintOptions = {}): number {
  const log = logger.fn('drawQr', { version: qr.version, size: box.size });
  const quiet = opts.quiet ?? QR_QUIET_MODULES;
  const total = qr.size + quiet * 2;
  const devicePerModule = Math.max(1, Math.floor((box.size * box.dpr) / total));
  const m = devicePerModule / box.dpr;
  const drawn = m * total;
  const ox = Math.round((box.x + (box.size - drawn) / 2) * box.dpr) / box.dpr;
  const oy = Math.round((box.y + (box.size - drawn) / 2) * box.dpr) / box.dpr;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = opts.light ?? PALETTE.white;
  ctx.fillRect(ox, oy, drawn, drawn);
  ctx.fillStyle = opts.dark ?? PALETTE.ink;
  for (let y = 0; y < qr.size; y++) {
    // 横に続く黒はまとめて1つの矩形にする（継ぎ目が出ない）
    let run = -1;
    for (let x = 0; x <= qr.size; x++) {
      const dark = x < qr.size && qrIsDark(qr, x, y);
      if (dark && run < 0) run = x;
      if (!dark && run >= 0) {
        ctx.fillRect(ox + (quiet + run) * m, oy + (quiet + y) * m, (x - run) * m, m);
        run = -1;
      }
    }
  }
  ctx.restore();
  return log.exit(drawn);
}

/**
 * QR コード用の canvas（一辺 cssSize の CSS px、dpr 倍の実ピクセル）に描き直す。
 * @param canvas 描く canvas
 * @param qr QR コード
 * @param cssSize 一辺（CSS px）
 * @param dpr デバイスピクセル比
 * @param opts 色・余白
 * @sideEffect canvas の大きさを変えて描く
 */
export function paintQrCanvas(canvas: HTMLCanvasElement, qr: QrMatrix, cssSize: number, dpr: number, opts: QrPaintOptions = {}): void {
  const log = logger.fn('paintQrCanvas', { version: qr.version, cssSize });
  canvas.width = Math.max(1, Math.round(cssSize * dpr));
  canvas.height = Math.max(1, Math.round(cssSize * dpr));
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.exit(undefined, '2D コンテキストなし');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);
  ctx.fillStyle = opts.light ?? PALETTE.white;
  ctx.fillRect(0, 0, cssSize, cssSize);
  drawQr(ctx, qr, { x: 0, y: 0, size: cssSize, dpr }, opts);
  log.exit(undefined);
}
