/**
 * @file ボタン部品（Common/ui 層）
 * タップ領域は最小 44×44px（components.css の .btn）。クリック時に相関ID を発行してから onClick を呼ぶ。
 * onClick が Promise を返すと完了まで無効化する（連打による二重送信を防ぐ＝DI-07 の補助）。
 */
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';

const logger = createLogger('Common/ui/Button');

/** ボタンの見た目（主要操作／通常／控えめ） */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

/** ボタンの大きさ */
export type ButtonSize = 'normal' | 'large';

/** createButton のオプション */
export interface ButtonOptions {
  readonly label: string;
  /** 省略時 'secondary' */
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  readonly testId?: string;
  /** 押されたとき（相関ID 発行済みの状態で呼ばれる）。Promise を返すと完了まで無効化する */
  readonly onClick: () => void | Promise<unknown>;
  /** 'large' は幅いっぱいの大きなボタン（訪問ボタンなど） */
  readonly size?: ButtonSize;
  /** 先頭に付ける小さな記号（任意） */
  readonly icon?: string;
  /** 読み上げ用の名前（label と違う説明が要るとき） */
  readonly ariaLabel?: string;
}

/**
 * ボタンを作る。
 * @param opts ラベル・見た目・無効・testid・押下時の処理
 * @returns button 要素
 */
export function createButton(opts: ButtonOptions): HTMLButtonElement {
  const log = logger.fn('createButton', { label: opts.label, testId: opts.testId });
  const button = h(
    'button',
    {
      class: ['btn', `btn--${opts.variant ?? 'secondary'}`, opts.size === 'large' ? 'btn--large' : undefined],
      attrs: { type: 'button', 'data-testid': opts.testId, 'aria-label': opts.ariaLabel },
    },
    [opts.icon === undefined ? undefined : h('span', { class: 'btn__icon', attrs: { 'aria-hidden': 'true' }, text: opts.icon }), h('span', { class: 'btn__label', text: opts.label })],
  );
  setButtonDisabled(button, opts.disabled === true);
  button.addEventListener('click', () => {
    void handleButtonClick(button, opts);
  });
  return log.exit(button);
}

/**
 * ボタンの有効・無効を設定する（処理中の一時無効が解けた後もこの値が使われる）。
 * @param button 対象のボタン
 * @param disabled 無効にするなら true
 * @sideEffect button.disabled と data-want-disabled を変更する
 */
export function setButtonDisabled(button: HTMLButtonElement, disabled: boolean): void {
  const log = logger.fn('setButtonDisabled', { testId: button.dataset.testid, disabled });
  button.dataset.wantDisabled = disabled ? '1' : '0';
  if (button.dataset.busy !== '1') button.disabled = disabled;
  log.exit(undefined);
}

/**
 * ボタンのラベルを差し替える。
 * @param button 対象のボタン
 * @param label 新しいラベル
 * @sideEffect ラベル要素の textContent を変更する
 */
export function setButtonLabel(button: HTMLButtonElement, label: string): void {
  const log = logger.fn('setButtonLabel', { testId: button.dataset.testid, label });
  const target = button.querySelector('.btn__label');
  if (target !== null) target.textContent = label;
  log.exit(undefined);
}

/**
 * クリックを処理する。相関ID を発行して onClick を呼び、Promise なら完了まで無効化する。
 * @param button 押されたボタン
 * @param opts ボタンのオプション
 * @sideEffect 相関ID を変更し、onClick を呼ぶ。処理中は button を無効化する
 */
async function handleButtonClick(button: HTMLButtonElement, opts: ButtonOptions): Promise<void> {
  setCorrelationId();
  const log = logger.fn('handleButtonClick', { label: opts.label, testId: opts.testId });
  if (button.disabled || button.dataset.busy === '1') {
    log.exit(undefined, '無効または処理中のため無視');
    return;
  }
  const result = opts.onClick();
  if (!(result instanceof Promise)) {
    log.exit(undefined);
    return;
  }
  button.dataset.busy = '1';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    await result;
  } finally {
    delete button.dataset.busy;
    button.removeAttribute('aria-busy');
    button.disabled = button.dataset.wantDisabled === '1';
  }
  log.exit(undefined);
}
