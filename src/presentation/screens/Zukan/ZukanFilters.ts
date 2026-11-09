/**
 * @file 図鑑の絞り込み（presentation/screens/Zukan 層）
 * 2026-11-09 ユーザー指示「最上部の町ごとに分けなくていい。地区と状態でフィルターできるように」で、地区タブを2段の絞り込みに置き換えた。
 * - 地区: すべて／各地区（地区の色の丸。色あせ中は破線の輪、未訪問は灰色の輪）
 * - 状態: すべて／訪問済み／発見済み／未発見
 * 選択中は aria-checked と白い選択面・太字で示す（色だけに頼らない）。色あせ中であることは読み上げ名でも伝える。
 * 絞り込みを変えても作り直さず update で選択だけを差し替える（フォーカスを保つ）。
 */
import type { ZukanDistrictTabDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';
import { userAction } from '@/Common/ui/userAction';
import { STATUS_FILTERS } from '@/presentation/screens/Zukan/zukanModel';
import type { ZukanFilter, ZukanStatusFilter } from '@/presentation/screens/Zukan/zukanModel';

const logger = createLogger('presentation/screens/Zukan/ZukanFilters');

/** 地区の「すべて」を表す選択肢の値 */
const ALL_DISTRICTS = 'all';

/** createZukanFilters のオプション */
export interface ZukanFiltersOptions {
  readonly districts: readonly ZukanDistrictTabDto[];
  readonly filter: ZukanFilter;
  /** 絞り込みが変わったとき（相関ID 発行済み） */
  readonly onChange: (filter: ZukanFilter) => void;
}

/** 絞り込みの操作 */
export interface ZukanFiltersHandle {
  readonly element: HTMLElement;
  /** 選択中の表示を差し替える */
  update(filter: ZukanFilter): void;
}

/** 選択肢1つ分の材料 */
interface ChoiceSpec {
  readonly value: string;
  readonly label: string;
  readonly ariaLabel?: string;
  /** 地区の色の丸（地区のときだけ） */
  readonly dot?: { readonly color: string; readonly fadeKind: ZukanDistrictTabDto['fadeKind'] };
}

/**
 * 選択肢のボタンを1つ作る。
 * @param group 選択肢の組の名前（testid に使う）
 * @param spec 選択肢
 * @param onPick 押されたときの処理
 * @returns button 要素（role="radio"）
 */
function createChoice(group: string, spec: ChoiceSpec, onPick: (value: string) => void): HTMLElement {
  const log = logger.fn('createChoice', { group, value: spec.value });
  let dot: HTMLElement | undefined;
  if (spec.dot !== undefined) {
    dot = h('span', { class: 'zukan-filter__dot', attrs: { 'aria-hidden': 'true' }, dataset: { fade: spec.dot.fadeKind } });
    setStyle(dot, '--district', spec.dot.color);
  }
  const button = h(
    'button',
    {
      class: 'zukan-filter__choice',
      attrs: { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': spec.ariaLabel ?? spec.label, 'data-testid': `zukan-filter-${group}`, 'data-value': spec.value },
      on: { click: userAction(`zukan-filter-${group}`, (): void => onPick(spec.value)) },
    },
    [dot, h('span', { class: 'zukan-filter__label', text: spec.label })],
  );
  return log.exit(button);
}

/**
 * 1段分（見出し＋選択肢の組）を作る。
 * @param group 選択肢の組の名前
 * @param title 見出し（'地区'／'状態'）
 * @param choices 選択肢のボタン
 * @returns 要素
 */
function createRow(group: string, title: string, choices: readonly HTMLElement[]): HTMLElement {
  const log = logger.fn('createRow', { group, count: choices.length });
  const titleId = `zukan-filter-title-${group}`;
  return log.exit(
    h('div', { class: 'zukan-filter__row' }, [
      h('span', { class: 'zukan-filter__title', attrs: { id: titleId }, text: title }),
      h('div', { class: 'zukan-filter__choices', attrs: { role: 'radiogroup', 'aria-labelledby': titleId }, dataset: { group } }, choices),
    ]),
  );
}

/**
 * 選択肢の組の選択中を差し替える。
 * @param choices 選択肢のボタン
 * @param value 選択中の値
 * @sideEffect aria-checked を書き換える
 */
function markChecked(choices: readonly HTMLElement[], value: string): void {
  const log = logger.fn('markChecked', { value });
  for (const choice of choices) choice.setAttribute('aria-checked', choice.dataset.value === value ? 'true' : 'false');
  log.exit(undefined);
}

/**
 * 地区の選択肢の材料（先頭は「すべて」、続いて地区の表示順）を作る。
 * @param districts 地区の一覧
 * @returns 選択肢の材料
 */
function districtChoiceSpecs(districts: readonly ZukanDistrictTabDto[]): ChoiceSpec[] {
  const log = logger.fn('districtChoiceSpecs', { count: districts.length });
  return log.exit([
    { value: ALL_DISTRICTS, label: 'すべて', ariaLabel: 'すべての地区' },
    ...districts.map((d) => ({
      value: d.id,
      label: d.shortName,
      ariaLabel: `${d.shortName}（${d.theme}）${d.fadeKind === 'fading' ? '、色あせ中' : ''}`,
      dot: { color: d.color, fadeKind: d.fadeKind },
    })),
  ]);
}

/**
 * 図鑑の絞り込み（地区・状態の2段）を作る。選択中の選択肢を押しても何もしない。
 * @param opts 地区一覧・いまの絞り込み・変わったときの処理
 * @returns 要素と、選択中を差し替える関数
 */
export function createZukanFilters(opts: ZukanFiltersOptions): ZukanFiltersHandle {
  const log = logger.fn('createZukanFilters', { districts: opts.districts.length, districtId: opts.filter.districtId, status: opts.filter.status });
  let current = opts.filter;
  /**
   * 地区の選択肢が押されたとき（選択中なら何もしない）。
   * @param value 選択肢の値（'all' はすべての地区）
   */
  const pickDistrict = (value: string): void => {
    const pickLog = logger.fn('pickDistrict', { value });
    const districtId = value === ALL_DISTRICTS ? undefined : value;
    if (districtId !== current.districtId) opts.onChange({ ...current, districtId });
    pickLog.exit(undefined);
  };
  /**
   * 状態の選択肢が押されたとき（選択中なら何もしない）。
   * @param value 選択肢の値（'all' はすべての状態）
   */
  const pickStatus = (value: string): void => {
    const pickLog = logger.fn('pickStatus', { value });
    const status = value as ZukanStatusFilter;
    if (status !== current.status) opts.onChange({ ...current, status });
    pickLog.exit(undefined);
  };
  const districtChoices = districtChoiceSpecs(opts.districts).map((spec) => createChoice('district', spec, pickDistrict));
  const statusChoices = STATUS_FILTERS.map((s) => createChoice('status', { value: s.value, label: s.label, ariaLabel: `状態: ${s.label}` }, pickStatus));
  const element = h('div', { class: 'zukan-filter', attrs: { 'data-testid': 'zukan-filter', role: 'group', 'aria-label': '図鑑の絞り込み' } }, [
    createRow('district', '地区', districtChoices),
    createRow('status', '状態', statusChoices),
  ]);
  /**
   * 選択中の表示を差し替える。
   * @param filter 新しい絞り込み
   * @sideEffect 選択肢の aria-checked を書き換える
   */
  const update = (filter: ZukanFilter): void => {
    const updateLog = logger.fn('update', { districtId: filter.districtId, status: filter.status });
    current = filter;
    markChecked(districtChoices, filter.districtId ?? ALL_DISTRICTS);
    markChecked(statusChoices, filter.status);
    updateLog.exit(undefined);
  };
  update(current);
  return log.exit({ element, update });
}
