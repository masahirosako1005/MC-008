/**
 * @file チップ部品（Common/ui 層）
 * 便利情報フィルタなどのオン／オフ切替。aria-pressed で状態を示し、色だけでなく ✓ 記号でも選択を示す（色覚配慮）。
 */
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';

const logger = createLogger('Common/ui/Chip');

/** createChip のオプション */
export interface ChipOptions {
  readonly label: string;
  readonly selected?: boolean;
  /** 先頭の小さな記号（任意） */
  readonly icon?: string;
  readonly testId?: string;
  /** 切り替わった後に呼ばれる（相関ID 発行済み） */
  readonly onToggle?: (selected: boolean) => void;
}

/**
 * チップを作る。タップでオン／オフが切り替わる。
 * @param opts ラベル・初期状態・testid・切替時の処理
 * @returns button 要素（aria-pressed 付き）
 */
export function createChip(opts: ChipOptions): HTMLButtonElement {
  const log = logger.fn('createChip', { label: opts.label, testId: opts.testId });
  const chip = h('button', { class: 'chip', attrs: { type: 'button', 'data-testid': opts.testId } }, [
    h('span', { class: 'chip__check', attrs: { 'aria-hidden': 'true' } }, [createIcon('check')]),
    opts.icon === undefined ? undefined : h('span', { class: 'chip__icon', attrs: { 'aria-hidden': 'true' }, text: opts.icon }),
    h('span', { class: 'chip__label', text: opts.label }),
  ]);
  setChipSelected(chip, opts.selected === true);
  chip.addEventListener('click', () => {
    setCorrelationId();
    const next = !isChipSelected(chip);
    setChipSelected(chip, next);
    opts.onToggle?.(next);
  });
  return log.exit(chip);
}

/**
 * チップの選択状態を設定する。
 * @param chip 対象のチップ
 * @param selected 選択するなら true
 * @sideEffect aria-pressed を変更する
 */
export function setChipSelected(chip: HTMLButtonElement, selected: boolean): void {
  chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
}

/**
 * チップが選択されているか返す。
 * @param chip 対象のチップ
 * @returns 選択中なら true
 */
export function isChipSelected(chip: HTMLButtonElement): boolean {
  return chip.getAttribute('aria-pressed') === 'true';
}
