/**
 * @file Canvas の土台（Common/ui/canvas 層）
 * devicePixelRatio に合わせて canvas の実ピクセルを決め、ResizeObserver で親要素の大きさに追従する。
 * 描画側は CSS px の座標系で描けばよい（beginFrame が dpr の変換を設定する）。
 */
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';

const logger = createLogger('Common/ui/canvas/CanvasBase');

/** devicePixelRatio の上限（大きすぎるとメモリを食うので 3 で頭打ち） */
export const MAX_DEVICE_PIXEL_RATIO = 3;

/** canvas の大きさ（width/height は CSS px） */
export interface CanvasSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

/** Canvas 面（描画先と大きさ） */
export interface CanvasSurface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** 現在の大きさ */
  size(): CanvasSize;
  /** 監視を止めて canvas を取り除く */
  destroy(): void;
}

/** createCanvasSurface のオプション */
export interface CanvasSurfaceOptions {
  /** 大きさが変わった直後に呼ばれる（最初の1回を含む）。ここで再描画する */
  readonly onResize: (size: CanvasSize) => void;
  readonly testId?: string;
  /** 読み上げ用の説明 */
  readonly ariaLabel?: string;
  readonly className?: string;
}

/**
 * devicePixelRatio を 1〜MAX_DEVICE_PIXEL_RATIO に丸める。
 * @param raw window.devicePixelRatio（不正値は 1）
 * @returns 丸めた倍率
 */
export function normalizeDpr(raw: number | undefined): number {
  const log = logger.fn('normalizeDpr', { raw });
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return log.exit(1);
  return log.exit(Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, raw)));
}

/**
 * CSS px の大きさから canvas の実ピクセル数を求める。
 * @param cssWidth 幅（CSS px）
 * @param cssHeight 高さ（CSS px）
 * @param dpr 倍率
 * @returns 実ピクセルの幅・高さ（1 以上の整数）
 */
export function backingStoreSize(cssWidth: number, cssHeight: number, dpr: number): { readonly width: number; readonly height: number } {
  return { width: Math.max(1, Math.round(cssWidth * dpr)), height: Math.max(1, Math.round(cssHeight * dpr)) };
}

/**
 * フレームの描画を始める（dpr の変換を設定し全体を消す）。以降は CSS px で描ける。
 * @param ctx 2D コンテキスト
 * @param size 現在の大きさ
 * @sideEffect ctx の変換行列を設定し、canvas を消去する
 */
export function beginFrame(ctx: CanvasRenderingContext2D, size: CanvasSize): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
}

/**
 * canvas を親要素に合わせた大きさにする。
 * @param canvas 対象の canvas
 * @param container 親要素
 * @returns 新しい大きさ
 * @sideEffect canvas の width/height 属性と CSS サイズを変更する
 */
function syncCanvasSize(canvas: HTMLCanvasElement, container: HTMLElement): CanvasSize {
  const log = logger.fn('syncCanvasSize');
  const dpr = normalizeDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  const backing = backingStoreSize(width, height, dpr);
  if (canvas.width !== backing.width) canvas.width = backing.width;
  if (canvas.height !== backing.height) canvas.height = backing.height;
  setStyle(canvas, 'width', `${width}px`);
  setStyle(canvas, 'height', `${height}px`);
  return log.exit({ width, height, dpr });
}

/**
 * 親要素いっぱいの canvas を作り、親の大きさの変化に追従させる。
 * 親要素は大きさが決まっていること（position:relative＋高さ指定など）。
 * @param container canvas を入れる親要素
 * @param opts リサイズ時のコールバック・testid・読み上げ説明
 * @returns Canvas 面。2D コンテキストが取れなければ undefined
 * @sideEffect container に canvas を追加し、ResizeObserver を登録する
 */
export function createCanvasSurface(container: HTMLElement, opts: CanvasSurfaceOptions): CanvasSurface | undefined {
  const log = logger.fn('createCanvasSurface', { testId: opts.testId });
  const canvas = h('canvas', {
    class: ['canvas-surface', opts.className],
    attrs: { 'data-testid': opts.testId, 'aria-label': opts.ariaLabel, role: opts.ariaLabel === undefined ? undefined : 'img' },
  });
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.fail(undefined, '2D コンテキストを取得できません');
  container.append(canvas);
  let size = syncCanvasSize(canvas, container);
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
    const next = syncCanvasSize(canvas, container);
    if (next.width === size.width && next.height === size.height && next.dpr === size.dpr) return;
    size = next;
    opts.onResize(size);
  });
  observer?.observe(container);
  opts.onResize(size);
  return log.exit({
    canvas,
    ctx,
    size: (): CanvasSize => size,
    destroy: (): void => {
      observer?.disconnect();
      canvas.remove();
    },
  });
}
