/**
 * @file デモメニュー：日付進行（presentation/screens/Demo 層）
 * +1日／+30日／+90日（data-testid="demo-advance-1|30|90"）。+30日で色あせ開始、+90日で最も薄くなる（CLAUDE.md 4.4・6.9）。
 * 実演の手順4（+30日 → 地区が色あせ、下シートに色あせカード）で使う。進めたらステータスバーを更新する。
 */
import type { AdvanceDateInput } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { showDemoError } from '@/presentation/screens/Demo/demoAction';
import type { DemoPanelDeps } from '@/presentation/screens/Demo/demoAction';
import { ADVANCE_DAYS, formatDemoDate } from '@/presentation/screens/Demo/demoModel';

const logger = createLogger('presentation/screens/Demo/DateAdvancePanel');

/**
 * デモ日付を進める。成功したら日付をトーストし、ステータスバーとメニュー内の表示を更新する。
 * @param deps パネルの依存
 * @param days 進める日数
 * @sideEffect services.demo.advanceDate を呼ぶ（デモ時計のずらし日数を保存）。トーストを出す
 */
async function advanceDate(deps: DemoPanelDeps, days: AdvanceDateInput['days']): Promise<void> {
  const log = logger.fn('advanceDate', { days });
  const result = await deps.demo.advanceDate.execute({ days });
  if (!result.ok) {
    showDemoError(deps.ctx, result.error);
    return log.fail(undefined, result.error.code);
  }
  deps.ctx.toast.show(`${formatDemoDate(result.value.today)} に進めました`, { kind: 'success' });
  await deps.ctx.refreshStatus();
  await deps.onStatusChanged();
  log.exit(undefined);
}

/**
 * 日付進行のパネルを作る（data-testid="demo-panel-date"）。
 * @param deps パネルの依存
 * @returns section 要素
 */
export function createDateAdvancePanel(deps: DemoPanelDeps): HTMLElement {
  const log = logger.fn('createDateAdvancePanel');
  const buttons = ADVANCE_DAYS.map((days) =>
    createButton({
      label: `+${days}日`,
      variant: days === 30 ? 'primary' : 'secondary',
      testId: `demo-advance-${days}`,
      onClick: (): Promise<void> => deps.runner.run(`advance-${days}`, (): Promise<void> => advanceDate(deps, days)),
    }),
  );
  return log.exit(
    h('section', { class: 'demo-panel', attrs: { 'data-testid': 'demo-panel-date' } }, [
      h('h2', { class: 'sheet-section-title', text: '日付進行' }),
      h('div', { class: 'demo-row' }, buttons),
      h('p', { class: 'hint', text: '+30日で色あせ開始、+90日で最も薄く（Lv・カードは減りません）' }),
    ]),
  );
}
