/**
 * @file 全画面演出の枠と再生の部品（presentation/screens/Effects 層）
 * - 演出1つ分の表示（EffectView）の共通形
 * - 全画面の枠（data-testid="effect"・data-effect-kind、右上「スキップ」data-testid="effect-skip"・44px、自動送りの進捗バー）
 * - 「スキップ」・Esc・自動送り（2.5 秒）のどれかで終わるのを待つ
 * - Canvas アニメーション（requestAnimationFrame。終わったら・止めたら必ず停止。prefers-reduced-motion なら完成形だけ描く）
 */
import { createLogger } from '@/Common/logging/logger';
import { createCanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSize, CanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import { h } from '@/Common/ui/dom';
import { userAction } from '@/Common/ui/userAction';
import { animationProgress } from '@/presentation/screens/Effects/effectMath';
import type { EffectKind } from '@/presentation/screens/Effects/effectPlan';

const logger = createLogger('presentation/screens/Effects/EffectFrame');

/** 演出1つ分の表示 */
export interface EffectView {
  readonly kind: EffectKind;
  /** 読み上げ用の名前（「金カード獲得」など） */
  readonly label: string;
  /** 枠の中に置く中身 */
  readonly element: HTMLElement;
  /** 枠が画面に追加された直後に呼ぶ（アニメーション開始） */
  start(): void;
  /** 終わるときに呼ぶ（アニメーション停止・後始末） */
  stop(): void;
}

/** 全画面の枠 */
export interface EffectFrameHandle {
  readonly element: HTMLElement;
  readonly skipButton: HTMLButtonElement;
}

/** 演出の終わり方 */
export type EffectEndReason = 'skip' | 'auto';

/** Canvas アニメーションの描画関数（progress は 0〜1。毎フレーム呼ばれる） */
export type CanvasFrameDrawer = (ctx: CanvasRenderingContext2D, size: CanvasSize, progress: number) => void;

/** Canvas アニメーションの操作 */
export interface CanvasAnimationHandle {
  /** ループを止めて canvas を片付ける（何度呼んでもよい） */
  stop(): void;
}

/**
 * 利用者が動きを減らす設定にしているか。
 * @returns prefers-reduced-motion: reduce なら true
 */
export function prefersReducedMotion(): boolean {
  const log = logger.fn('prefersReducedMotion');
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return log.exit(false);
  return log.exit(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * 全画面の枠を作る（ステータスバー・タブバーも覆う。中身は view.element）。
 * @param view 演出1つ分の表示
 * @param durationMs 自動送りまでの時間（進捗バーの長さに使う）
 * @returns 枠とスキップボタン
 */
export function createEffectFrame(view: EffectView, durationMs: number): EffectFrameHandle {
  const log = logger.fn('createEffectFrame', { kind: view.kind, durationMs });
  const skipButton = h('button', { class: 'fx__skip', attrs: { type: 'button', 'data-testid': 'effect-skip', 'aria-label': '演出をスキップ' }, text: 'スキップ' });
  const progress = h('div', { class: 'fx__progress', attrs: { 'aria-hidden': 'true' }, style: { '--fx-duration': `${durationMs}ms` } });
  const element = h(
    'div',
    {
      class: ['fx', `fx--${view.kind}`],
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': view.label, 'data-testid': 'effect', 'data-effect-kind': view.kind, tabindex: '-1' },
    },
    [skipButton, h('div', { class: 'fx__body' }, [view.element]), progress],
  );
  return log.exit({ element, skipButton });
}

/**
 * 演出が終わるのを待つ（「スキップ」・Esc キー・自動送りのいずれか早いもの）。
 * @param frame 全画面の枠
 * @param durationMs 自動送りまでの時間（ミリ秒）
 * @returns 終わり方
 * @sideEffect タイマーとリスナを登録し、終わったら外す。スキップ時は相関ID を発行する
 */
export async function waitForAdvance(frame: EffectFrameHandle, durationMs: number): Promise<EffectEndReason> {
  const log = logger.fn('waitForAdvance', { durationMs });
  const controller = new AbortController();
  const reason = await new Promise<EffectEndReason>((resolve): void => {
    const timer = window.setTimeout((): void => resolve('auto'), durationMs);
    controller.signal.addEventListener('abort', (): void => window.clearTimeout(timer));
    frame.skipButton.addEventListener('click', userAction('effect-skip', (): void => resolve('skip')), { signal: controller.signal });
    frame.element.addEventListener(
      'keydown',
      (event): void => {
        if (event.key === 'Escape') userAction('effect-skip-key', (): void => resolve('skip'))();
      },
      { signal: controller.signal },
    );
  });
  controller.abort();
  return log.exit(reason);
}

/**
 * 親要素いっぱいの canvas を作り、durationMs の間アニメーションさせる（完了したら最後の1枚で止まる）。
 * 大きさが変わったら今の進み具合で描き直す。prefers-reduced-motion なら完成形（progress=1）だけを描く。
 * @param container canvas を入れる親要素（DOM に追加済みで大きさが決まっていること）
 * @param opts 描画関数・長さ・読み上げ説明
 * @returns 停止の操作
 * @sideEffect container に canvas を追加し、requestAnimationFrame・ResizeObserver を登録する
 */
export function startCanvasAnimation(
  container: HTMLElement,
  opts: { readonly draw: CanvasFrameDrawer; readonly durationMs: number; readonly ariaLabel: string },
): CanvasAnimationHandle {
  const reduced = prefersReducedMotion();
  const log = logger.fn('startCanvasAnimation', { durationMs: opts.durationMs, reduced });
  let progress = reduced ? 1 : 0;
  let startedAt: number | undefined;
  let frameId: number | undefined;
  let stopped = false;
  let surface: CanvasSurface | undefined;
  surface = createCanvasSurface(container, {
    ariaLabel: opts.ariaLabel,
    onResize: (size): void => {
      if (surface !== undefined && !stopped) opts.draw(surface.ctx, size, progress);
    },
  });
  /**
   * 1フレーム描いて、終わっていなければ次のフレームを予約する。
   * @param now requestAnimationFrame の時刻（performance.now と同じ基準）
   * @sideEffect canvas に描画し、次のフレームを予約する
   */
  function onFrame(now: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    if (stopped || surface === undefined) return;
    startedAt ??= now;
    progress = animationProgress(now - startedAt, opts.durationMs);
    opts.draw(surface.ctx, surface.size(), progress);
    frameId = progress < 1 ? window.requestAnimationFrame(onFrame) : undefined;
  }
  if (surface !== undefined) {
    opts.draw(surface.ctx, surface.size(), progress);
    if (!reduced) frameId = window.requestAnimationFrame(onFrame);
  }
  const handle: CanvasAnimationHandle = {
    stop: (): void => {
      stopped = true;
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      frameId = undefined;
      surface?.destroy();
    },
  };
  return log.exit(handle);
}
