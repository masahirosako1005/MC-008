/**
 * @file 図鑑の地区タブ（presentation/screens/Zukan 層）
 * 5地区を横一列のタブで切り替える（wireframes/05_zukan の①）。各タブに地区の色の丸（色あせ中は破線の輪、未訪問は灰色の輪）。
 * 色あせ中であることは読み上げ名でも伝える（色だけに頼らない）。
 * 選択中は aria-selected と下線・太字で示す（色だけに頼らない）。
 */
import type { ZukanDistrictTabDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';
import { userAction } from '@/Common/ui/userAction';

const logger = createLogger('presentation/screens/Zukan/DistrictTabs');

/** createDistrictTabs のオプション */
export interface DistrictTabsOptions {
  readonly districts: readonly ZukanDistrictTabDto[];
  readonly selectedId: string;
  /** 別の地区が選ばれたとき（相関ID 発行済み） */
  readonly onSelect: (districtId: string) => void;
}

/**
 * タブ1つを作る。
 * @param district 地区
 * @param selected 選択中か
 * @param onSelect 選ばれたときの処理
 * @returns button 要素
 */
function createTab(district: ZukanDistrictTabDto, selected: boolean, onSelect: (districtId: string) => void): HTMLElement {
  const log = logger.fn('createTab', { districtId: district.id, selected, fade: district.fadeKind });
  const fading = district.fadeKind === 'fading';
  const dot = h('span', { class: 'zukan-tabs__dot', attrs: { 'aria-hidden': 'true' }, dataset: { fade: district.fadeKind } });
  setStyle(dot, '--district', district.color);
  const tab = h(
    'button',
    {
      class: 'zukan-tabs__tab',
      attrs: {
        type: 'button', role: 'tab', 'aria-selected': selected ? 'true' : 'false',
        'aria-label': `${district.shortName}（${district.theme}）${fading ? '、色あせ中' : ''}`,
        'data-testid': 'zukan-tab', 'data-district-id': district.id,
      },
      on: { click: userAction('zukan-tab', (): void => (selected ? undefined : onSelect(district.id))) },
    },
    [dot, h('span', { class: 'zukan-tabs__label', text: district.shortName })],
  );
  return log.exit(tab);
}

/**
 * 地区タブを作る。選択中のタブを押しても何もしない。
 * @param opts 地区一覧・選択中の地区・選択時の処理
 * @returns role="tablist" の要素
 */
export function createDistrictTabs(opts: DistrictTabsOptions): HTMLElement {
  const log = logger.fn('createDistrictTabs', { selectedId: opts.selectedId, count: opts.districts.length });
  const tabs = opts.districts.map((district) => createTab(district, district.id === opts.selectedId, opts.onSelect));
  return log.exit(h('div', { class: 'zukan-tabs', attrs: { role: 'tablist', 'aria-label': '地区' } }, tabs));
}
