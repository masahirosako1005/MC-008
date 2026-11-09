/**
 * @file デモメニュー：ライバル行動（presentation/screens/Demo 層）
 * 「おまいり番長が天満地区の主を奪う」（data-testid="demo-rival"）。地区は選択できる（data-testid="demo-rival-district"、既定 天満＝d_tenma）。
 * 実演の手順5（ライバル行動 → 下シートに「取り返し」カード）で使う（CLAUDE.md 6.9）。
 */
import { createLogger } from '@/Common/logging/logger';
import { createButton, setButtonLabel } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { userAction } from '@/Common/ui/userAction';
import { showDemoError } from '@/presentation/screens/Demo/demoAction';
import type { DemoPanelDeps } from '@/presentation/screens/Demo/demoAction';
import {
  DEFAULT_RIVAL_DISTRICT_ID,
  DEFAULT_RIVAL_ID,
  districtNameOf,
  rivalButtonLabel,
  rivalDistrictOptions,
  rivalResultMessage,
} from '@/presentation/screens/Demo/demoModel';
import type { RivalDistrictOption } from '@/presentation/screens/Demo/demoModel';
import { newOperationId } from '@/presentation/shared/operation';

const logger = createLogger('presentation/screens/Demo/RivalActionPanel');

/**
 * ライバルに地区の主を奪わせる（今日付のライバル訪問を追記して主を判定し直す）。
 * @param deps パネルの依存
 * @param districtId 対象の地区ID
 * @sideEffect services.demo.simulateRival を呼ぶ（書込み・operationId 付き＝DI-07）。トーストを出す
 */
async function simulateRival(deps: DemoPanelDeps, districtId: string): Promise<void> {
  const log = logger.fn('simulateRival', { districtId });
  const result = await deps.demo.simulateRival.execute({ operationId: newOperationId(), rivalId: DEFAULT_RIVAL_ID, districtId });
  if (!result.ok) {
    showDemoError(deps.ctx, result.error);
    return log.fail(undefined, result.error.code);
  }
  deps.ctx.toast.show(rivalResultMessage(result.value), { kind: 'info' });
  log.exit(undefined);
}

/**
 * 地区の選択欄を作る。
 * @param options 選べる地区
 * @param selectedId 最初に選んでおく地区ID
 * @returns select 要素
 */
function createDistrictSelect(options: readonly RivalDistrictOption[], selectedId: string): HTMLSelectElement {
  const log = logger.fn('createDistrictSelect', { count: options.length, selectedId });
  const items = options.map((option) => h('option', { attrs: { value: option.id, selected: option.id === selectedId }, text: option.name }));
  return log.exit(h('select', { class: 'demo-select', attrs: { 'data-testid': 'demo-rival-district', 'aria-label': '主を奪う地区' } }, items));
}

/**
 * ライバル行動のパネルを作る（data-testid="demo-panel-rival"）。
 * @param deps パネルの依存
 * @param districts 地区（ID と名前。読めなければ空）
 * @returns section 要素
 */
export function createRivalActionPanel(deps: DemoPanelDeps, districts: readonly RivalDistrictOption[]): HTMLElement {
  const log = logger.fn('createRivalActionPanel', { count: districts.length });
  const options = rivalDistrictOptions(districts);
  const initialId = options.some((o) => o.id === DEFAULT_RIVAL_DISTRICT_ID) ? DEFAULT_RIVAL_DISTRICT_ID : (options[0]?.id ?? DEFAULT_RIVAL_DISTRICT_ID);
  const select = createDistrictSelect(options, initialId);
  const button = createButton({
    label: rivalButtonLabel(districtNameOf(options, initialId)),
    testId: 'demo-rival',
    onClick: (): Promise<void> => deps.runner.run('rival', (): Promise<void> => simulateRival(deps, select.value)),
  });
  select.addEventListener('change', userAction('demo-rival-district', (): void => setButtonLabel(button, rivalButtonLabel(districtNameOf(options, select.value)))));
  return log.exit(
    h('section', { class: 'demo-panel', attrs: { 'data-testid': 'demo-panel-rival' } }, [
      h('h2', { class: 'sheet-section-title', text: 'ライバル行動' }),
      select,
      h('div', { class: 'demo-row' }, [button]),
      h('p', { class: 'hint', text: '閉じると下シートに「取り返し」カードが出ます' }),
    ]),
  );
}
