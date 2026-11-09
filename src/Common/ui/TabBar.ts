/**
 * @file 下部タブ部品（Common/ui 層）
 * 地図／図鑑／アバター／ランキング／ランクの5タブ（CLAUDE.md 6.1）。ラベル・記号・testid・選択時の処理は props で受ける（画面の知識を持たない）。
 * 選択中は aria-current="page" とアイコン下のピル・塗りアイコン・太字で示す（色だけに頼らない）。各タブは 44px 以上。
 * art（呼び出し側が描いた絵。canvas など）があればそれを、無ければタブID が Common/ui/icons の名前なら SVG の線画アイコン、そうでなければ icon の文字を出す。
 */
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon, isIconName } from '@/Common/ui/icons';

const logger = createLogger('Common/ui/TabBar');

/** タブ1つの定義 */
export interface TabItem {
  readonly id: string;
  readonly label: string;
  /** タブの記号（1文字程度。art が無いときだけ使う） */
  readonly icon: string;
  /** タブの絵を作る（canvas など。選んでいないときの淡い表示は CSS で行う） */
  readonly art?: () => HTMLElement;
  readonly testId: string;
}

/** createTabBar のオプション */
export interface TabBarOptions {
  readonly tabs: readonly TabItem[];
  /** 最初に選択中にするタブ（省略時はどれも選択しない） */
  readonly active?: string;
  /** タブが押されたとき（相関ID 発行済み） */
  readonly onSelect: (id: string) => void;
}

/** 下部タブの操作 */
export interface TabBarHandle {
  readonly element: HTMLElement;
  /** 選択中のタブを変える（undefined でどれも選択しない） */
  setActive(id: string | undefined): void;
  destroy(): void;
}

/**
 * 下部タブを作る。
 * @param opts タブ定義・初期選択・選択時の処理
 * @returns 下部タブの操作
 */
export function createTabBar(opts: TabBarOptions): TabBarHandle {
  const log = logger.fn('createTabBar', { tabs: opts.tabs.map((t) => t.id), active: opts.active });
  const buttons = opts.tabs.map((tab) =>
    h(
      'button',
      {
        class: 'tab-bar__tab',
        attrs: { type: 'button', 'data-testid': tab.testId, 'data-tab': tab.id },
        on: {
          click: (): void => {
            setCorrelationId();
            opts.onSelect(tab.id);
          },
        },
      },
      [
        h('span', { class: 'tab-bar__icon', attrs: { 'aria-hidden': 'true' } }, [tab.art !== undefined ? tab.art() : isIconName(tab.id) ? createIcon(tab.id) : tab.icon]),
        h('span', { class: 'tab-bar__label', text: tab.label }),
      ],
    ),
  );
  const element = h('nav', { class: 'tab-bar', attrs: { 'aria-label': 'メインメニュー', 'data-testid': 'tab-bar' } }, buttons);
  /**
   * 選択中のタブを変える。
   * @param id タブID（undefined でどれも選択しない）
   * @sideEffect 各タブの aria-current を変更する
   */
  const setActive = (id: string | undefined): void => {
    const activeLog = logger.fn('setActive', { id });
    for (const button of buttons) {
      if (button.dataset.tab === id) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    activeLog.exit(undefined);
  };
  setActive(opts.active);
  return log.exit({ element, setActive, destroy: (): void => element.remove() });
}
