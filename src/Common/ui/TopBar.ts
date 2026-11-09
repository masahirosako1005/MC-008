/**
 * @file 画面上部バー部品（Common/ui 層）
 * 画面タイトルと任意の「戻る」ボタン。右端は歯車（App が重ねる）のため 56px（3.5rem）空ける。
 */
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';

const logger = createLogger('Common/ui/TopBar');

/** 戻るボタンの定義 */
export interface TopBarBack {
  readonly label: string;
  /** 押されたとき（相関ID 発行済み） */
  readonly onClick: () => void;
  readonly testId?: string;
}

/** createTopBar のオプション */
export interface TopBarOptions {
  readonly title: string;
  readonly subtitle?: string;
  readonly back?: TopBarBack;
  readonly testId?: string;
}

/**
 * 画面上部バーを作る。
 * @param opts タイトル・補足・戻るボタン
 * @returns header 要素
 */
export function createTopBar(opts: TopBarOptions): HTMLElement {
  const log = logger.fn('createTopBar', { title: opts.title });
  const back = opts.back;
  const backButton =
    back === undefined
      ? undefined
      : h(
          'button',
          {
            class: 'top-bar__back',
            attrs: { type: 'button', 'data-testid': back.testId ?? 'topbar-back', 'aria-label': back.label },
            on: {
              click: (): void => {
                setCorrelationId();
                back.onClick();
              },
            },
          },
          [h('span', { class: 'top-bar__back-icon', attrs: { 'aria-hidden': 'true' } }, [createIcon('chevronLeft')]), h('span', { class: 'top-bar__back-label', text: back.label })],
        );
  const titles = h('div', { class: 'top-bar__titles' }, [
    h('h1', { class: 'top-bar__title', text: opts.title }),
    opts.subtitle === undefined ? undefined : h('p', { class: 'top-bar__subtitle', text: opts.subtitle }),
  ]);
  return log.exit(h('header', { class: 'top-bar', attrs: { 'data-testid': opts.testId ?? 'top-bar' } }, [backButton, titles]));
}
