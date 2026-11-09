/**
 * @file 簡易モーダル（Common/ui 層）
 * 確認や補足説明を、スマホ枠の上に重ねて出す。背景タップ・「閉じる」・Esc で閉じる。
 * 出す先は host（省略時は [data-modal-host] 要素、無ければ body）。App がスマホ枠に data-modal-host を付ける。
 */
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import type { ButtonVariant } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';

const logger = createLogger('Common/ui/Modal');

/** モーダル下部のボタン */
export interface ModalAction {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly testId?: string;
  /** 押されたとき（呼んだ後にモーダルは閉じる） */
  readonly onClick: () => void;
}

/** openModal のオプション */
export interface ModalOptions {
  readonly title: string;
  /** 本文（文字列はテキストとして表示） */
  readonly body: string | HTMLElement;
  /** 省略時は「閉じる」ボタンだけ */
  readonly actions?: readonly ModalAction[];
  /** 出す先（省略時は [data-modal-host]、無ければ body） */
  readonly host?: HTMLElement;
  /** 閉じた後に呼ばれる */
  readonly onClose?: () => void;
  readonly testId?: string;
}

/** 開いたモーダルの操作 */
export interface ModalHandle {
  readonly element: HTMLElement;
  /** 閉じる（2回目以降は何もしない） */
  close(): void;
}

/**
 * モーダルを開く。
 * @param opts タイトル・本文・ボタン・出す先
 * @returns 閉じるための操作
 * @sideEffect host にモーダル要素を追加し、document に keydown リスナを登録する（閉じると外す）
 */
export function openModal(opts: ModalOptions): ModalHandle {
  const log = logger.fn('openModal', { title: opts.title, testId: opts.testId });
  const host = opts.host ?? document.querySelector<HTMLElement>('[data-modal-host]') ?? document.body;
  let closed = false;
  const dim = h('div', { class: 'modal-layer' });
  /**
   * モーダルを閉じる。
   * @param byUser 利用者の操作（Esc・背景タップ）なら true（相関ID を発行する）
   * @sideEffect 要素とリスナを取り除き、onClose を呼ぶ
   */
  const close = (byUser = false): void => {
    if (byUser) setCorrelationId();
    const closeLog = logger.fn('close', { title: opts.title, closed, byUser });
    if (closed) return closeLog.exit(undefined);
    closed = true;
    dim.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
    closeLog.exit(undefined);
  };
  /**
   * Esc で閉じる。
   * @param event キーボードイベント
   */
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close(true);
  };
  const dialog = buildDialog(opts, () => close());
  dim.append(dialog);
  dim.addEventListener('click', (event) => {
    if (event.target === dim) close(true);
  });
  document.addEventListener('keydown', onKey);
  host.append(dim);
  dialog.querySelector<HTMLElement>('button')?.focus();
  return log.exit({ element: dim, close });
}

/**
 * ダイアログ本体（タイトル・本文・ボタン）を作る。
 * @param opts モーダルのオプション
 * @param close 閉じる関数
 * @returns ダイアログ要素
 */
function buildDialog(opts: ModalOptions, close: () => void): HTMLElement {
  const log = logger.fn('buildDialog', { title: opts.title });
  const actions = opts.actions ?? [{ label: '閉じる', variant: 'secondary' as const, testId: 'modal-close', onClick: (): void => undefined }];
  const buttons = actions.map((action) =>
    createButton({
      label: action.label,
      variant: action.variant ?? 'secondary',
      testId: action.testId,
      onClick: (): void => {
        action.onClick();
        close();
      },
    }),
  );
  const body = typeof opts.body === 'string' ? h('p', { class: 'modal__body', text: opts.body }) : opts.body;
  return log.exit(
    h('div', { class: 'modal', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title, 'data-testid': opts.testId ?? 'modal' } }, [
      h('h2', { class: 'modal__title', text: opts.title }),
      body,
      h('div', { class: 'modal__actions' }, buttons),
    ]),
  );
}
