/**
 * @file 下シート部品（Common/ui 層）
 * 3段階（つまみ peek 約120px／半分 half 約50%／全画面 full 上部56pxを残す）。CLAUDE.md 6.3、wireframes/03_sheet。
 * つまみ（data-testid="sheet-handle"）のタップで peek→half→full→peek、上下スワイプで1段ずつ開閉する。
 * 親要素は position:relative で高さが決まっていること（シートは親の下端に絶対配置する）。
 */
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';

const logger = createLogger('Common/ui/BottomSheet');

/** シートの段階 */
export type SheetState = 'peek' | 'half' | 'full';

/** 段階の並び（小さい順） */
export const SHEET_STATES: readonly SheetState[] = ['peek', 'half', 'full'];

/** 段階の表示名（読み上げ用） */
export const SHEET_STATE_LABELS: Readonly<Record<SheetState, string>> = { peek: 'つまみ', half: '半分', full: '全画面' };

/** これ以上動いたらスワイプとみなす（CSS px） */
export const SWIPE_THRESHOLD_PX = 30;
/** これ未満の移動はタップとみなす（CSS px） */
export const TAP_SLOP_PX = 8;

/** BottomSheet のオプション */
export interface BottomSheetOptions {
  /** 段階が変わったとき（利用者操作・setState のどちらでも呼ばれる） */
  readonly onStateChange?: (state: SheetState) => void;
  /** 最初の段階（省略時 peek） */
  readonly initial?: SheetState;
  /** シート全体の testid（省略時 'bottom-sheet'） */
  readonly testId?: string;
  /** 読み上げ用の名前（省略時 '下シート'） */
  readonly label?: string;
}

/**
 * タップしたときの次の段階を返す（peek→half→full→peek）。
 * @param state 今の段階
 * @returns 次の段階
 */
export function nextSheetStateOnTap(state: SheetState): SheetState {
  const log = logger.fn('nextSheetStateOnTap', { state });
  if (state === 'peek') return log.exit('half');
  return log.exit(state === 'half' ? 'full' : 'peek');
}

/**
 * 縦方向の移動量からスワイプ後の段階を返す（上へ動かすと1段開き、下へ動かすと1段閉じる）。
 * @param state 今の段階
 * @param deltaY 移動量（CSS px。上がマイナス）
 * @returns 移動後の段階。スワイプでなければ undefined
 */
export function sheetStateAfterSwipe(state: SheetState, deltaY: number): SheetState | undefined {
  const log = logger.fn('sheetStateAfterSwipe', { state, deltaY });
  if (Math.abs(deltaY) < SWIPE_THRESHOLD_PX) return log.exit(undefined);
  const index = SHEET_STATES.indexOf(state);
  const nextIndex = Math.min(SHEET_STATES.length - 1, Math.max(0, index + (deltaY < 0 ? 1 : -1)));
  return log.exit(SHEET_STATES[nextIndex]);
}

/** 3段階の下シート */
export class BottomSheet {
  /** シート全体（親要素に追加して使う） */
  readonly element: HTMLElement;
  private readonly handle: HTMLButtonElement;
  private readonly body: HTMLElement;
  private readonly contents = new Map<SheetState, HTMLElement>();
  private readonly onStateChange: ((state: SheetState) => void) | undefined;
  private state: SheetState;
  private dragStartY: number | undefined;
  private suppressClick = false;

  /**
   * 下シートを作る（まだ親には追加しない）。
   * @param opts 段階変更時の処理・最初の段階・testid
   * @sideEffect つまみにポインタ・クリックのリスナを登録する
   */
  constructor(opts: BottomSheetOptions = {}) {
    const log = logger.fn('constructor', { initial: opts.initial });
    this.state = opts.initial ?? 'peek';
    this.onStateChange = opts.onStateChange;
    this.handle = h('button', { class: 'bottom-sheet__handle', attrs: { type: 'button', 'data-testid': 'sheet-handle' } }, [
      h('span', { class: 'bottom-sheet__grip', attrs: { 'aria-hidden': 'true' } }),
    ]);
    this.body = h('div', { class: 'bottom-sheet__body', attrs: { 'data-testid': 'sheet-body' } });
    this.element = h('section', { class: 'bottom-sheet', attrs: { 'aria-label': opts.label ?? '下シート', 'data-testid': opts.testId ?? 'bottom-sheet' } }, [
      this.handle,
      this.body,
    ]);
    this.handle.addEventListener('pointerdown', this.onPointerDown);
    this.handle.addEventListener('pointerup', this.onPointerUp);
    this.handle.addEventListener('pointercancel', this.onPointerCancel);
    this.handle.addEventListener('click', this.onHandleClick);
    this.render();
    log.exit(undefined);
  }

  /**
   * 段階ごとの中身を設定する。今の段階の中身ならすぐ差し替える。
   * 中身が無い段階では、それより小さい段階の中身を使う。
   * @param state 対象の段階
   * @param content 中身の要素
   * @sideEffect 表示中なら本文を差し替える
   */
  setContent(state: SheetState, content: HTMLElement): void {
    const log = logger.fn('setContent', { state, current: this.state });
    this.contents.set(state, content);
    if (this.contentFor(this.state) === content) this.renderBody();
    log.exit(undefined);
  }

  /**
   * 段階を変える。変わったら onStateChange を呼ぶ。
   * @param state 新しい段階
   * @sideEffect data-state・本文・aria 属性を変更し、onStateChange を呼ぶ
   */
  setState(state: SheetState): void {
    const log = logger.fn('setState', { from: this.state, to: state });
    if (state === this.state) return log.exit(undefined);
    this.state = state;
    this.render();
    this.onStateChange?.(state);
    log.exit(undefined);
  }

  /**
   * 今の段階を返す。
   * @returns 段階
   */
  getState(): SheetState {
    return this.state;
  }

  /**
   * リスナを外して要素を取り除く。
   * @sideEffect element を DOM から削除する
   */
  destroy(): void {
    const log = logger.fn('destroy', { state: this.state });
    this.handle.removeEventListener('pointerdown', this.onPointerDown);
    this.handle.removeEventListener('pointerup', this.onPointerUp);
    this.handle.removeEventListener('pointercancel', this.onPointerCancel);
    this.handle.removeEventListener('click', this.onHandleClick);
    this.contents.clear();
    this.element.remove();
    log.exit(undefined);
  }

  /**
   * 段階に応じた中身を返す（無ければ小さい段階の中身）。
   * @param state 段階
   * @returns 中身。どの段階にも無ければ undefined
   */
  private contentFor(state: SheetState): HTMLElement | undefined {
    const log = logger.fn('contentFor', { state });
    const index = SHEET_STATES.indexOf(state);
    for (let i = index; i >= 0; i--) {
      const key = SHEET_STATES[i];
      const content = key === undefined ? undefined : this.contents.get(key);
      if (content !== undefined) return log.exit(content);
    }
    return log.exit(undefined);
  }

  /**
   * data-state・aria 属性・本文を今の段階に合わせる。
   * @sideEffect element と handle の属性、本文を変更する
   */
  private render(): void {
    const log = logger.fn('render', { state: this.state });
    this.element.dataset.state = this.state;
    const next = SHEET_STATE_LABELS[nextSheetStateOnTap(this.state)];
    this.handle.setAttribute('aria-label', `シートの高さ：${SHEET_STATE_LABELS[this.state]}（タップで${next}）`);
    this.handle.setAttribute('aria-expanded', this.state === 'peek' ? 'false' : 'true');
    this.renderBody();
    log.exit(undefined);
  }

  /**
   * 本文を今の段階の中身に差し替える（スクロール位置は先頭へ）。
   * @sideEffect body の子要素を差し替える
   */
  private renderBody(): void {
    const log = logger.fn('renderBody', { state: this.state });
    const content = this.contentFor(this.state);
    if (content === undefined) this.body.replaceChildren();
    else if (this.body.firstElementChild !== content || this.body.childElementCount !== 1) this.body.replaceChildren(content);
    this.body.scrollTop = 0;
    log.exit(undefined);
  }

  /**
   * つまみを押し始めた位置を覚える（スワイプ判定用）。
   * @param event ポインタイベント
   * @sideEffect ポインタをつまみに捕捉する
   */
  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragStartY = event.clientY;
    this.suppressClick = false;
    if (typeof this.handle.setPointerCapture === 'function') this.handle.setPointerCapture(event.pointerId);
  };

  /**
   * つまみを離したとき、十分動いていればスワイプとして段階を変える。
   * @param event ポインタイベント
   * @sideEffect 相関ID を発行し、段階を変える
   */
  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.dragStartY === undefined) return;
    const deltaY = event.clientY - this.dragStartY;
    this.dragStartY = undefined;
    if (Math.abs(deltaY) < TAP_SLOP_PX) return;
    setCorrelationId();
    const log = logger.fn('onSwipe', { deltaY: Math.round(deltaY), state: this.state });
    this.suppressClick = true;
    const next = sheetStateAfterSwipe(this.state, deltaY);
    if (next !== undefined) this.setState(next);
    log.exit(undefined);
  };

  /**
   * ポインタ操作が中断されたらスワイプ判定を捨てる。
   */
  private readonly onPointerCancel = (): void => {
    this.dragStartY = undefined;
  };

  /**
   * つまみのタップ（またはキーボード操作）で次の段階へ進める。スワイプ直後のクリックは無視する。
   * @param event マウスイベント（detail=0 はキーボード操作）
   * @sideEffect 相関ID を発行し、段階を変える
   */
  private readonly onHandleClick = (event: MouseEvent): void => {
    if (this.suppressClick && event.detail !== 0) {
      this.suppressClick = false;
      return;
    }
    setCorrelationId();
    const log = logger.fn('onHandleClick', { state: this.state });
    this.setState(nextSheetStateOnTap(this.state));
    log.exit(undefined);
  };
}
