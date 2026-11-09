/**
 * @file デモメニュー：位置リセット（presentation/screens/Demo 層）
 * 「位置リセット（南森町駅へ）」（data-testid="demo-reset-position"）。南森町駅＝開始地区（南森町・天満宮地区）の入口へ戻す。
 * 実演を最初からやり直すための保険（CLAUDE.md 6.9、docs/08 §9.3）。
 * 足あと（メモリのみ＝D15）も消す。位置座標はログに出さない。
 */
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { showDemoError } from '@/presentation/screens/Demo/demoAction';
import type { DemoPanelDeps } from '@/presentation/screens/Demo/demoAction';
import { resetPositionTexts } from '@/presentation/screens/Demo/demoModel';
import type { ResetPositionTexts, RivalDistrictOption } from '@/presentation/screens/Demo/demoModel';

const logger = createLogger('presentation/screens/Demo/ResetPositionPanel');

/**
 * デモ位置を開始地区の入口（南森町駅付近）へ戻し、足あとを消す。
 * @param deps パネルの依存
 * @param texts 位置リセットの文言
 * @sideEffect services.demo.resetPosition を呼ぶ。ctx.ui.footprints を空にしてトーストを出す
 */
async function resetPosition(deps: DemoPanelDeps, texts: ResetPositionTexts): Promise<void> {
  const log = logger.fn('resetPosition', { footprints: deps.ctx.ui.footprints.length });
  const result = await deps.demo.resetPosition.execute();
  if (!result.ok) {
    showDemoError(deps.ctx, result.error);
    return log.fail(undefined, result.error.code);
  }
  deps.ctx.ui.footprints = [];
  deps.ctx.toast.show(texts.done, { kind: 'success' });
  log.exit(undefined);
}

/**
 * 位置リセットのパネルを作る（data-testid="demo-panel-position"）。
 * @param deps パネルの依存
 * @param districts 地区（ID と名前。読めなければ空＝既定の地区名を使う）
 * @returns section 要素
 */
export function createResetPositionPanel(deps: DemoPanelDeps, districts: readonly RivalDistrictOption[]): HTMLElement {
  const log = logger.fn('createResetPositionPanel', { count: districts.length });
  const texts = resetPositionTexts(districts);
  const button = createButton({
    label: texts.button,
    testId: 'demo-reset-position',
    onClick: (): Promise<void> => deps.runner.run('reset-position', (): Promise<void> => resetPosition(deps, texts)),
  });
  return log.exit(
    h('section', { class: 'demo-panel', attrs: { 'data-testid': 'demo-panel-position' } }, [
      h('h2', { class: 'sheet-section-title', text: '位置' }),
      h('div', { class: 'demo-row' }, [button]),
      h('p', { class: 'hint', text: texts.hint }),
    ]),
  );
}
