/**
 * @file 右上の歯車（presentation/App 層）
 * 通常タップ＝設定、0.8 秒長押し＝デモメニュー（デモビルドのときだけ。CLAUDE.md 6.9）。
 * 長押し中は輪のプログレスで残り時間を示す。キーボードでは Enter＝設定、Shift+Enter＝デモメニュー。
 */
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';

const logger = createLogger('presentation/App/GearMenu');

/** デモメニューを開く長押しの時間（ミリ秒） */
export const GEAR_LONG_PRESS_MS = 800;

/** これ以上指が動いたら長押しを取り消す（CSS px） */
const MOVE_CANCEL_PX = 12;

/** createGearMenu のオプション */
export interface GearMenuOptions {
  /** デモビルドなら true（長押しを有効にする） */
  readonly isDemo: boolean;
  /** 通常タップ（相関ID 発行済み） */
  readonly onTap: () => void;
  /** 長押し（相関ID 発行済み。isDemo のときだけ呼ばれる） */
  readonly onLongPress: () => void;
}

/** 歯車の操作 */
export interface GearMenuHandle {
  readonly element: HTMLElement;
  destroy(): void;
}

/**
 * 長押しの進み具合を 0〜1 で返す（純粋関数）。
 * @param elapsedMs 押し始めからの経過ミリ秒
 * @param thresholdMs 長押し成立までのミリ秒
 * @returns 0〜1
 */
export function longPressProgress(elapsedMs: number, thresholdMs: number = GEAR_LONG_PRESS_MS): number { // audit-ignore: fnlog-missing 毎フレーム描画（長押し中の輪の更新で毎フレーム呼ぶ）
  if (!(thresholdMs > 0) || !Number.isFinite(elapsedMs)) return 0;
  return Math.min(1, Math.max(0, elapsedMs / thresholdMs));
}

/** 押下中の状態 */
interface PressState {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  frame: number;
  fired: boolean;
}

/**
 * 右上の歯車を作る。
 * @param opts デモビルドか・タップ時・長押し時の処理
 * @returns 歯車の操作
 * @sideEffect 要素にポインタ・キーボードのリスナを登録する
 */
export function createGearMenu(opts: GearMenuOptions): GearMenuHandle {
  const log = logger.fn('createGearMenu', { isDemo: opts.isDemo });
  const label = opts.isDemo ? '設定（長押しでデモメニュー）' : '設定';
  const element = h('button', { class: 'gear', attrs: { type: 'button', 'data-testid': 'gear', 'aria-label': label, title: label } }, [
    h('span', { class: 'gear__ring', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'gear__face', attrs: { 'aria-hidden': 'true' } }, [createIcon('gear')]),
  ]);
  const controller = new GearPressController(element, opts);
  return log.exit({ element, destroy: (): void => controller.destroy() });
}

/** 歯車の押下（タップ・長押し）を判定する */
class GearPressController {
  private press: PressState | undefined;

  /**
   * リスナを登録する。
   * @param element 歯車のボタン
   * @param opts 歯車のオプション
   * @sideEffect element にリスナを登録する
   */
  constructor(
    private readonly element: HTMLButtonElement,
    private readonly opts: GearMenuOptions,
  ) {
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerCancel);
    element.addEventListener('contextmenu', this.onContextMenu);
    element.addEventListener('keydown', this.onKeyDown);
  }

  /**
   * リスナを外し、進行中の長押しを止める。
   * @sideEffect element からリスナを外す
   */
  destroy(): void {
    const log = logger.fn('destroy');
    this.cancel();
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerCancel);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    this.element.removeEventListener('keydown', this.onKeyDown);
    log.exit(undefined);
  }

  /**
   * 押し始め：長押しの計測とプログレス表示を始める。
   * @param event ポインタイベント
   * @sideEffect ポインタを捕捉し、アニメーションフレームを要求する
   */
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.press !== undefined) return;
    event.preventDefault();
    if (typeof this.element.setPointerCapture === 'function') this.element.setPointerCapture(event.pointerId);
    this.element.dataset.pressing = '1';
    const startedAt = performance.now();
    this.press = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startedAt, frame: 0, fired: false };
    if (this.opts.isDemo) this.press.frame = requestAnimationFrame(this.tick);
  };

  /**
   * 押している間、輪のプログレスを更新し、時間が来たら長押しを成立させる。
   * @param now アニメーションフレームの時刻
   */
  private readonly tick = (now: number): void => { // audit-ignore: fnlog-missing 毎フレーム描画
    const press = this.press;
    if (press === undefined || press.fired) return;
    const progress = longPressProgress(now - press.startedAt);
    setStyle(this.element, '--gear-progress', String(progress));
    if (progress < 1) {
      press.frame = requestAnimationFrame(this.tick);
      return;
    }
    press.fired = true;
    this.fireLongPress();
  };

  /**
   * 長押しを成立させてデモメニューを開く。
   * @sideEffect 相関ID を発行し、onLongPress を呼ぶ
   */
  private fireLongPress(): void {
    setCorrelationId();
    const log = logger.fn('fireLongPress');
    this.resetVisual();
    this.opts.onLongPress();
    log.exit(undefined);
  }

  /**
   * 指が大きく動いたら長押しを取り消す。
   * @param event ポインタイベント
   */
  private readonly onPointerMove = (event: PointerEvent): void => {
    const press = this.press;
    if (press === undefined || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > MOVE_CANCEL_PX) this.cancel();
  };

  /**
   * 離したとき：長押しが成立していなければタップとして設定を開く。
   * @param event ポインタイベント
   * @sideEffect 相関ID を発行し、onTap を呼ぶことがある
   */
  private readonly onPointerUp = (event: PointerEvent): void => {
    const press = this.press;
    if (press === undefined || press.pointerId !== event.pointerId) return;
    const fired = press.fired;
    this.cancel();
    if (fired) return;
    setCorrelationId();
    const log = logger.fn('onTap', { heldMs: Math.round(performance.now() - press.startedAt) });
    this.opts.onTap();
    log.exit(undefined);
  };

  /**
   * ポインタ操作が中断されたら取り消す。
   */
  private readonly onPointerCancel = (): void => {
    this.cancel();
  };

  /**
   * 長押しで出るブラウザのメニューを抑える。
   * @param event マウスイベント
   */
  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  /**
   * キーボード操作：Enter／Space＝設定、Shift+Enter＝デモメニュー（デモビルドのみ）。
   * @param event キーボードイベント
   * @sideEffect 相関ID を発行し、onTap または onLongPress を呼ぶ
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setCorrelationId();
    const log = logger.fn('onKeyDown', { key: event.key, shift: event.shiftKey });
    if (event.shiftKey && event.key === 'Enter' && this.opts.isDemo) this.opts.onLongPress();
    else this.opts.onTap();
    log.exit(undefined);
  };

  /**
   * 押下状態とプログレス表示を消す。
   * @sideEffect アニメーションフレームを取り消し、表示を戻す
   */
  private cancel(): void {
    const log = logger.fn('cancel', { pressing: this.press !== undefined });
    if (this.press !== undefined) cancelAnimationFrame(this.press.frame);
    this.press = undefined;
    this.resetVisual();
    log.exit(undefined);
  }

  /**
   * 輪のプログレスと押下中の表示を消す。
   * @sideEffect 要素のスタイル・data 属性を変更する
   */
  private resetVisual(): void {
    const log = logger.fn('resetVisual');
    setStyle(this.element, '--gear-progress', undefined);
    delete this.element.dataset.pressing;
    log.exit(undefined);
  }
}
