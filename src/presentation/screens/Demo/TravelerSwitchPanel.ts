/**
 * @file デモメニュー：旅人切替（presentation/screens/Demo 層）
 * 「初回の人」（何も発見していない）と「通い慣れた人」（Lv・カードあり）を切り替える（data-testid="demo-traveler-first|regular"）。
 * 切り替えたら地図の UI 状態（ズーム・足あと）を初期化し、ステータスバーを更新して画面を作り直す（CLAUDE.md 6.9）。
 */
import type { AppStatusDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { showDemoError } from '@/presentation/screens/Demo/demoAction';
import type { DemoPanelDeps } from '@/presentation/screens/Demo/demoAction';
import { resetMapUi, TRAVELER_PROFILE_LABELS, TRAVELER_PROFILES } from '@/presentation/screens/Demo/demoModel';
import type { DemoTravelerProfile } from '@/presentation/screens/Demo/demoModel';

const logger = createLogger('presentation/screens/Demo/TravelerSwitchPanel');

/**
 * 旅人を切り替える（デモ日付は今日に戻り、シードを作り直す＝docs/08 D13）。
 * @param deps パネルの依存
 * @param profile 切り替え先
 * @sideEffect services.demo.switchTraveler を呼ぶ。ctx.ui を初期化し、ステータスを更新して画面を作り直す
 */
async function switchTraveler(deps: DemoPanelDeps, profile: DemoTravelerProfile): Promise<void> {
  const log = logger.fn('switchTraveler', { profile });
  const result = await deps.demo.switchTraveler.execute({ profile });
  if (!result.ok) {
    showDemoError(deps.ctx, result.error);
    return log.fail(undefined, result.error.code);
  }
  resetMapUi(deps.ctx.ui);
  deps.ctx.toast.show(`「${TRAVELER_PROFILE_LABELS[profile]}」に切り替えました（日付は今日に戻ります）`, { kind: 'success' });
  await deps.ctx.refreshStatus();
  deps.ctx.router.reload();
  log.exit(undefined);
}

/**
 * 旅人切替のパネルを作る（data-testid="demo-panel-traveler"）。今の旅人は aria-pressed="true" で強調する。
 * @param deps パネルの依存
 * @param current 今の旅人の種類（読めなければ undefined）
 * @returns section 要素
 */
export function createTravelerSwitchPanel(deps: DemoPanelDeps, current: AppStatusDto['travelerProfile'] | undefined): HTMLElement {
  const log = logger.fn('createTravelerSwitchPanel', { current });
  const buttons = TRAVELER_PROFILES.map((profile): HTMLButtonElement => {
    const isCurrent = profile === current;
    const button = createButton({
      label: TRAVELER_PROFILE_LABELS[profile],
      variant: isCurrent ? 'primary' : 'secondary',
      icon: isCurrent ? '✓' : undefined,
      testId: `demo-traveler-${profile}`,
      onClick: (): Promise<void> => deps.runner.run(`traveler-${profile}`, (): Promise<void> => switchTraveler(deps, profile)),
    });
    button.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
    return button;
  });
  return log.exit(
    h('section', { class: 'demo-panel', attrs: { 'data-testid': 'demo-panel-traveler' } }, [
      h('h2', { class: 'sheet-section-title', text: '冒険者切替' }),
      h('div', { class: ['demo-row', 'demo-row--even'] }, buttons),
      h('p', { class: 'hint', text: '初回の人＝まだ何も見つけていない／通い慣れた人＝Lv・カードあり' }),
    ]),
  );
}
