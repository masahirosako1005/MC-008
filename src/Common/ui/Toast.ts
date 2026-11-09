/**
 * @file トースト（短い通知）部品（Common/ui 層）
 * 発見・成長・エラーなどを画面上部に短く出す。読み上げは aria-live="polite"。最大3件まで重ね、古いものから消す。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';

const logger = createLogger('Common/ui/Toast');

/** トーストの種類（info 通常／discover 発見／success 成功／error 失敗） */
export type ToastKind = 'info' | 'discover' | 'success' | 'error';

/** show のオプション */
export interface ToastOptions {
  readonly kind?: ToastKind;
  /** 表示時間（ミリ秒。省略時 info/discover/success 2400、error 3600） */
  readonly durationMs?: number;
}

/** 同時に出すトーストの最大数 */
export const MAX_VISIBLE_TOASTS = 3;
/** 既定の表示時間（ミリ秒） */
export const DEFAULT_TOAST_MS = 2400;
/** エラーの既定の表示時間（ミリ秒） */
export const ERROR_TOAST_MS = 3600;

/** 種類ごとの先頭の線アイコン（色だけに頼らない。info は無し） */
const TOAST_ICONS: Readonly<Record<ToastKind, IconName | undefined>> = { info: undefined, discover: 'sparkle', success: 'check', error: 'info' };

/** トーストを表示する層 */
export class ToastHost {
  /** トーストを並べる層（aria-live 領域） */
  readonly element: HTMLElement;

  /**
   * トースト層を作って container に追加する。
   * @param container 層を入れる親要素（スマホ枠など。position が設定されていること）
   * @sideEffect container に子要素を追加する
   */
  constructor(container: HTMLElement) {
    this.element = h('div', { class: 'toast-layer', attrs: { role: 'status', 'aria-live': 'polite', 'data-testid': 'toast-layer' } });
    container.append(this.element);
  }

  /**
   * トーストを1件表示する。一定時間後に自動で消える。
   * @param message 表示する文言（利用者向けの日本語。内部情報を含めない）
   * @param opts 種類・表示時間
   * @sideEffect 層に要素を追加し、タイマーで削除する
   */
  show(message: string, opts: ToastOptions = {}): void {
    const kind = opts.kind ?? 'info';
    const log = logger.fn('show', { kind, length: message.length });
    const icon = TOAST_ICONS[kind];
    const toast = h('div', { class: ['toast', `toast--${kind}`], attrs: { 'data-testid': 'toast', 'data-kind': kind } }, [
      icon === undefined ? undefined : h('span', { class: 'toast__icon', attrs: { 'aria-hidden': 'true' } }, [createIcon(icon)]),
      h('span', { class: 'toast__text', text: message }),
    ]);
    this.element.append(toast);
    while (this.element.childElementCount > MAX_VISIBLE_TOASTS) this.element.firstElementChild?.remove();
    const duration = opts.durationMs ?? (kind === 'error' ? ERROR_TOAST_MS : DEFAULT_TOAST_MS);
    window.setTimeout(() => toast.remove(), Math.max(0, duration));
    log.exit(undefined);
  }

  /**
   * 表示中のトーストをすべて消す。
   * @sideEffect 層の子要素をすべて削除する
   */
  clear(): void {
    this.element.replaceChildren();
  }
}
