/**
 * @file 図鑑画面の表示の切替（presentation/screens/Zukan 層）
 * 2026-11-10 ユーザー指示「図鑑/記録の機能に。図鑑画面とは切り替えられるように（情報が多いので）」。
 * 「図鑑」（カードの格子）と「記録」（訪問の年表と思い出）を、最上部の2つのタブで切り替える。タップ領域は 44px 以上。
 * 切り替えても作り直さず update で選択だけを差し替える（フォーカスを保つ）。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { userAction } from '@/Common/ui/userAction';
import { ZUKAN_MODES } from '@/presentation/screens/Zukan/visitLogModel';
import type { ZukanMode } from '@/presentation/screens/Zukan/visitLogModel';

const logger = createLogger('presentation/screens/Zukan/ZukanModeSwitch');

/** 切替の操作 */
export interface ZukanModeSwitchHandle {
  readonly element: HTMLElement;
  /** 選択中の表示を差し替える */
  update(mode: ZukanMode): void;
}

/**
 * 表示の切替（図鑑／記録）を作る。選択中と同じものを押しても何もしない。
 * @param mode いまの表示
 * @param onChange 切り替えたとき（相関ID 発行済み）
 * @returns 要素と、選択中を差し替える関数
 */
export function createZukanModeSwitch(mode: ZukanMode, onChange: (mode: ZukanMode) => void): ZukanModeSwitchHandle {
  const log = logger.fn('createZukanModeSwitch', { mode });
  let current = mode;
  const tabs = ZUKAN_MODES.map((m) => {
    const tab = h('button', { class: ['zukan-mode__tab', 'seg__item'], attrs: { type: 'button', role: 'tab', 'data-testid': `zukan-mode-${m.value}` }, text: m.label });
    /**
     * タブが押されたとき（選択中なら何もしない）。
     */
    const pick = (): void => {
      const pickLog = logger.fn('pick', { mode: m.value });
      if (m.value !== current) onChange(m.value);
      pickLog.exit(undefined);
    };
    tab.addEventListener('click', userAction(`zukan-mode-${m.value}`, pick));
    return { value: m.value, tab };
  });
  // 見た目は共通の切替（.seg.seg--s: 見た目 36px・当たり 44px・選択＝白い面＋太字）
  const element = h('div', { class: ['zukan-mode', 'seg', 'seg--s'], attrs: { role: 'tablist', 'aria-label': '表示の切替', 'data-testid': 'zukan-mode' } }, tabs.map((t) => t.tab));
  /**
   * 選択中の表示を差し替える。
   * @param next 新しい表示
   * @sideEffect タブの aria-selected を書き換える
   */
  const update = (next: ZukanMode): void => {
    const updateLog = logger.fn('update', { mode: next });
    current = next;
    for (const t of tabs) t.tab.setAttribute('aria-selected', t.value === next ? 'true' : 'false');
    updateLog.exit(undefined);
  };
  update(current);
  return log.exit({ element, update });
}
