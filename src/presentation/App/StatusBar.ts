/**
 * @file ステータスバー（presentation/App 層）
 * services.status の結果から、時刻・「デモ」バッジ・日付（デモで日付を進めていれば「（+30日）」）・旅人の種類を表示する。
 * 日付は data-testid="status-date"（E2E で日付進行を確認する）。
 */
import type { AppStatusDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';

const logger = createLogger('presentation/App/StatusBar');

/** 旅人の種類の表示名（デモの旅人切替で見分ける） */
const PROFILE_LABELS: Readonly<Record<AppStatusDto['travelerProfile'], string>> = {
  first: '初回の人',
  regular: '通い慣れた人',
  user: '',
};

/** ステータスバーの操作 */
export interface StatusBarHandle {
  readonly element: HTMLElement;
  /** 表示を更新する */
  update(status: AppStatusDto): void;
}

/**
 * 日付の表示文言を作る（デモで日付を進めていれば「（+n日）」を付ける）。
 * @param status アプリ状態
 * @returns 例 '2026/12/09（水）（+30日）'
 */
export function statusDateText(status: Pick<AppStatusDto, 'dateLabel' | 'dayOffset'>): string {
  const log = logger.fn('statusDateText', { dayOffset: status.dayOffset });
  const offset = status.dayOffset ?? 0;
  return log.exit(offset > 0 ? `${status.dateLabel}（+${offset}日）` : status.dateLabel);
}

/**
 * ステータスバーを作る（最初は空。update で中身が入る）。
 * @returns ステータスバーの操作
 */
export function createStatusBar(): StatusBarHandle {
  const log = logger.fn('createStatusBar');
  const time = h('span', { class: 'status-bar__time', attrs: { 'data-testid': 'status-time' } });
  const demo = h('span', { class: 'status-bar__demo', text: 'デモ', attrs: { hidden: true } });
  const date = h('span', { class: 'status-bar__date', attrs: { 'data-testid': 'status-date' } });
  const profile = h('span', { class: 'status-bar__profile', attrs: { 'data-testid': 'status-profile' } });
  const element = h('header', { class: 'status-bar', attrs: { 'data-testid': 'status-bar' } }, [
    time,
    h('span', { class: 'status-bar__center' }, [demo, date]),
    profile,
  ]);
  /**
   * 表示を更新する。
   * @param status アプリ状態
   * @sideEffect 各要素の textContent・hidden を変更する
   */
  const update = (status: AppStatusDto): void => {
    const updateLog = logger.fn('update', { today: status.today, isDemo: status.isDemo, dayOffset: status.dayOffset });
    time.textContent = status.timeLabel;
    demo.hidden = !status.isDemo;
    date.textContent = statusDateText(status);
    date.dataset.today = status.today;
    profile.textContent = status.isDemo ? PROFILE_LABELS[status.travelerProfile] : '';
    updateLog.exit(undefined);
  };
  return log.exit({ element, update });
}
