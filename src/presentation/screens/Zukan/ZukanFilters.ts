/**
 * @file 図鑑の絞り込み（presentation/screens/Zukan 層）
 * 2026-11-09 ユーザー指示「最上部の町ごとに分けなくていい。地区と状態でフィルターできるように」で地区タブをやめ、
 * 同日「タブがでかいので、プルダウン形式で」で、地区と状態をプルダウン（ネイティブの select）2つの1段にした。図鑑を開いてすぐカードが見えるようにする。
 * - 地区: すべての地区／各地区（色あせ中・未訪問は文言で添える。選んだ地区の色の丸をプルダウンの左に出す）
 * - 状態: すべての状態／達成済み／発見済み／未発見
 * 絞り込みを変えても作り直さず update で選択だけを差し替える（フォーカスを保つ）。タップ領域は 44px 以上。
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

/** プルダウンの選択肢1つ分 */
interface OptionSpec {
  readonly value: string;
  readonly label: string;
}

/**
 * 地区の状態の添え書き（色は select の中に出せないので文言で伝える）。
 * @param district 地区
 * @returns '・色あせ'／'・未達成'／''（括弧書きにしない。呼び方は CLAUDE.md §11.1）
 */
function districtNote(district: ZukanDistrictTabDto): string {
  const log = logger.fn('districtNote', { districtId: district.id, fade: district.fadeKind });
  return log.exit(district.fadeKind === 'fading' ? '・色あせ' : district.fadeKind === 'never' ? '・未達成' : '');
}

/**
 * 地区の選択肢（先頭は「すべての地区」、続いて地区の表示順。色あせ中・未訪問は文言で添える）。
 * @param districts 地区の一覧
 * @returns 選択肢
 */
export function districtOptionsOf(districts: readonly ZukanDistrictTabDto[]): OptionSpec[] {
  const log = logger.fn('districtOptionsOf', { count: districts.length });
  // 左に小さな見出し「地区」があるので、選択肢は「すべて」だけにする（同じ語を2回出さない）
  return log.exit([{ value: ALL_DISTRICTS, label: 'すべて' }, ...districts.map((d) => ({ value: d.id, label: `${d.shortName}${districtNote(d)}` }))]);
}

/**
 * 状態の選択肢（先頭は「すべての状態」）。
 * @returns 選択肢
 */
export function statusOptionsOf(): OptionSpec[] {
  const log = logger.fn('statusOptionsOf');
  return log.exit(STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label })));
}

/**
 * プルダウン1つ（小さな見出し＋select＋開く印）を作る。
 * @param group 組の名前（testid に使う）
 * @param title 見出し（'地区'／'状態'）
 * @param options 選択肢
 * @param onPick 選ばれたときの処理
 * @returns ラベル要素と select
 */
function createSelect(group: string, title: string, options: readonly OptionSpec[], onPick: (value: string) => void): { label: HTMLElement; select: HTMLSelectElement } {
  const log = logger.fn('createSelect', { group, count: options.length });
  const select = h(
    'select',
    { class: 'zukan-select__input', attrs: { 'aria-label': `${title}で絞り込む`, 'data-testid': `zukan-filter-${group}` } },
    options.map((o) => h('option', { attrs: { value: o.value }, text: o.label })),
  );
  select.addEventListener('change', userAction(`zukan-filter-${group}`, (): void => onPick(select.value)));
  const label = h('label', { class: 'zukan-select', dataset: { group } }, [
    h('span', { class: 'zukan-select__title', attrs: { 'aria-hidden': 'true' }, text: title }),
    group === 'district' ? h('span', { class: 'zukan-select__dot', attrs: { 'aria-hidden': 'true' } }) : undefined,
    select,
    h('span', { class: 'zukan-select__chevron', attrs: { 'aria-hidden': 'true' } }),
  ]);
  return log.exit({ label, select });
}

/**
 * 図鑑の絞り込み（地区・状態のプルダウン2つ）を作る。選択中と同じものを選んでも何もしない。
 * @param opts 地区一覧・いまの絞り込み・変わったときの処理
 * @returns 要素と、選択中を差し替える関数
 */
export function createZukanFilters(opts: ZukanFiltersOptions): ZukanFiltersHandle {
  const log = logger.fn('createZukanFilters', { districts: opts.districts.length, districtId: opts.filter.districtId, status: opts.filter.status });
  let current = opts.filter;
  /**
   * 地区が選ばれたとき（選択中なら何もしない）。
   * @param value 選択肢の値（'all' はすべての地区）
   */
  const pickDistrict = (value: string): void => {
    const pickLog = logger.fn('pickDistrict', { value });
    const districtId = value === ALL_DISTRICTS ? undefined : value;
    if (districtId !== current.districtId) opts.onChange({ ...current, districtId });
    pickLog.exit(undefined);
  };
  /**
   * 状態が選ばれたとき（選択中なら何もしない）。
   * @param value 選択肢の値（'all' はすべての状態）
   */
  const pickStatus = (value: string): void => {
    const pickLog = logger.fn('pickStatus', { value });
    const status = value as ZukanStatusFilter;
    if (status !== current.status) opts.onChange({ ...current, status });
    pickLog.exit(undefined);
  };
  const district = createSelect('district', '地区', districtOptionsOf(opts.districts), pickDistrict);
  const status = createSelect('status', '状態', statusOptionsOf(), pickStatus);
  const element = h('div', { class: 'zukan-filter', attrs: { 'data-testid': 'zukan-filter', role: 'group', 'aria-label': '図鑑の絞り込み' } }, [district.label, status.label]);
  /**
   * 選択中の表示を差し替える（選んだ地区の色の丸も）。
   * @param filter 新しい絞り込み
   * @sideEffect select の値と地区の色の丸を書き換える
   */
  const update = (filter: ZukanFilter): void => {
    const updateLog = logger.fn('update', { districtId: filter.districtId, status: filter.status });
    current = filter;
    district.select.value = filter.districtId ?? ALL_DISTRICTS;
    status.select.value = filter.status;
    const picked = opts.districts.find((d) => d.id === filter.districtId);
    district.label.dataset.picked = picked === undefined ? '0' : '1';
    if (picked !== undefined) setStyle(district.label, '--district', picked.color);
    updateLog.exit(undefined);
  };
  update(current);
  return log.exit({ element, update });
}
