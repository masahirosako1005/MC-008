/**
 * @file 記念撮影（presentation/screens/Avatar 層。Canvas 描画と画像の保存）
 * ステージの絵に、パステルのグラデの額・四隅の星・ニックネームと称号の帯を付けた画像を作り、PNG で保存させる。
 * 画像は端末の中で作るだけで、外へ送らない。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { paintTwinkle } from '@/presentation/screens/Avatar/stageSparkle';

const logger = createLogger('presentation/screens/Avatar/photoFrame');

/** 額の太さ・下の帯の高さ（ステージの canvas の画素に対する割合） */
const BORDER_RATIO = 0.035;
const BAND_RATIO = 0.16;

/** 写真に入れる文字 */
export interface PhotoCaption {
  readonly nickname: string;
  /** 称号（無ければ undefined） */
  readonly title?: string;
}

/**
 * 額と帯を描く。
 * @param ctx 描画先
 * @param w 幅（画素）
 * @param h 高さ（画素）
 * @param border 額の太さ（画素）
 */
function paintFrame(ctx: CanvasRenderingContext2D, w: number, h: number, border: number): void {
  const log = logger.fn('paintFrame', { w, h });
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#ffb3d6'); g.addColorStop(0.5, '#c9a2ff'); g.addColorStop(1, '#9adfff');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, border * 1.6); ctx.fill();
  for (const [x, y] of [[border, border], [w - border, border], [border, h - border], [w - border, h - border]] as const) {
    paintTwinkle(ctx, x, y, border * 1.1, '#ffffff');
  }
  log.exit(undefined);
}

/**
 * 下の帯（ニックネーム・称号・アプリ名）を描く。
 * @param ctx 描画先
 * @param rect 帯の位置と大きさ
 * @param caption 文字
 */
function paintBand(ctx: CanvasRenderingContext2D, rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }, caption: PhotoCaption): void {
  const log = logger.fn('paintBand', { hasTitle: caption.title !== undefined });
  ctx.fillStyle = '#fff5fb';
  ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.h * 0.2); ctx.fill();
  const pad = rect.h * 0.28;
  const font = '"M PLUS Rounded 1c", "Noto Sans JP", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (caption.title !== undefined) {
    ctx.font = `800 ${rect.h * 0.22}px ${font}`;
    ctx.fillStyle = '#b0125a';
    ctx.fillText(caption.title, rect.x + pad, rect.y + rect.h * 0.3);
  }
  ctx.font = `900 ${rect.h * 0.34}px ${font}`;
  ctx.fillStyle = '#4a2350';
  ctx.fillText(caption.nickname, rect.x + pad, rect.y + rect.h * (caption.title === undefined ? 0.5 : 0.66));
  ctx.textAlign = 'right';
  ctx.font = `800 ${rect.h * 0.22}px ${font}`;
  ctx.fillStyle = '#8a4f7d';
  ctx.fillText('かよいまち', rect.x + rect.w - pad, rect.y + rect.h * 0.5);
  log.exit(undefined);
}

/**
 * ステージの絵から、額つきの写真を作る。
 * @param source ステージの canvas（いまの絵）
 * @param caption 文字
 * @returns 写真の canvas（作れなければ undefined）
 */
export function composePhoto(source: HTMLCanvasElement, caption: PhotoCaption): HTMLCanvasElement | undefined {
  const log = logger.fn('composePhoto', { w: source.width, h: source.height });
  const border = Math.round(source.width * BORDER_RATIO);
  const band = Math.round(source.height * BAND_RATIO);
  const w = source.width + border * 2;
  const hgt = source.height + border * 3 + band;
  const canvas = h('canvas', { attrs: { width: w, height: hgt } });
  const ctx = canvas.getContext('2d');
  if (ctx === null || source.width === 0) return log.fail(undefined, '描けない');
  paintFrame(ctx, w, hgt, border);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(border, border, source.width, source.height, border); ctx.clip();
  ctx.drawImage(source, border, border);
  ctx.restore();
  paintBand(ctx, { x: border, y: border * 2 + source.height, w: source.width, h: band }, caption);
  return log.exit(canvas);
}

/**
 * canvas を PNG で保存させる（ダウンロード）。
 * @param canvas 写真
 * @param filename ファイル名
 * @returns 保存を始められたら true
 * @sideEffect 一時的な URL を作ってリンクを押し、少しあとで URL を解放する
 */
export async function savePhoto(canvas: HTMLCanvasElement, filename: string): Promise<boolean> {
  const log = logger.fn('savePhoto', { filename });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob === null) return log.fail(false, 'PNG にできない');
  const url = URL.createObjectURL(blob);
  const link = h('a', { attrs: { href: url, download: filename } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return log.exit(true);
}
