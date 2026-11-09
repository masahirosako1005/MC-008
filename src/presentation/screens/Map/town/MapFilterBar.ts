/**
 * @file 地図の上端に重ねるフィルタのチップ列（presentation/screens/Map/town 層）
 * 左端の「好み」ボタンと、今日だけ・ベビーカーOK・トイレ・子連れ歓迎・雨の日OK・行きたい の切替チップを横スクロールで並べる（A 初回満足度・C 再訪動機）。
 * チップは押すたびに入切し（aria-pressed）、当てはまるスポットの件数を小さな札で示す。地図の強調は呼び出し側（MapScreen）が行う。
 */
import '@/presentation/screens/Map/town/mapTownUi.css';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { userAction } from '@/Common/ui/userAction';
import { MAP_FILTERS } from '@/presentation/screens/Map/town/mapPrefs';
import type { MapFilterId } from '@/presentation/screens/Map/town/mapPrefs';
import { createMapUiIcon } from '@/presentation/screens/Map/town/mapUiIcons';
import type { MapUiIcon } from '@/presentation/screens/Map/town/mapUiIcons';

const logger = createLogger('presentation/screens/Map/town/MapFilterBar');

/** チップのアイコンの大きさ（CSS px） */
const CHIP_ICON_PX = 16;

/** フィルタ → チップのアイコン */
const FILTER_ICONS: Readonly<Record<MapFilterId, MapUiIcon>> = {
  today: 'today',
  stroller: 'stroller',
  toilet: 'toilet',
  kids: 'kids',
  rainOk: 'rainOk',
  want: 'heart',
};

/** フィルタのチップ列の操作 */
export interface MapFilterBarHandle {
  readonly element: HTMLElement;
  /** 件数の札を更新する（0 件のチップは淡く出す） */
  update(counts: Readonly<Record<MapFilterId, number>>): void;
  /** 入っているフィルタ */
  active(): ReadonlySet<MapFilterId>;
  /** 入っているフィルタを外から設定する（onChange は呼ばない） */
  setActive(ids: ReadonlySet<MapFilterId>): void;
}

/** createMapFilterBar のオプション */
export interface MapFilterBarOptions {
  /** 利用者がチップを入切したとき（入っているフィルタ全体を渡す） */
  onChange(active: ReadonlySet<MapFilterId>): void;
  /** 「好み」ボタンを押したとき */
  onOpenPrefs(): void;
}

/**
 * フィルタのチップ列を作る。
 * @param opts 入切・好みボタンの通知先
 * @returns チップ列の操作
 */
export function createMapFilterBar(opts: MapFilterBarOptions): MapFilterBarHandle {
  const log = logger.fn('createMapFilterBar');
  const active = new Set<MapFilterId>();
  const chips = new Map<MapFilterId, FilterChip>();
  const items: HTMLElement[] = [prefsButton(opts.onOpenPrefs)];
  for (const filter of MAP_FILTERS) {
    const chip = filterChip(filter, (): void => toggleFilter(filter.id));
    chips.set(filter.id, chip);
    items.push(chip.button);
  }
  const element = h('div', { class: 'map-filter-bar', attrs: { role: 'toolbar', 'aria-label': '地図の絞り込み', 'data-testid': 'map-filter-bar' } }, [
    h('div', { class: 'map-filter-bar__track' }, items),
  ]);

  /**
   * 利用者の操作でフィルタを入切する。
   * @param id フィルタ
   * @sideEffect 相関ID を発行し、押下状態を変えて onChange を呼ぶ
   */
  const toggleFilter = (id: MapFilterId): void => {
    setCorrelationId();
    const toggleLog = logger.fn('toggleFilter', { id, on: !active.has(id) });
    if (active.has(id)) active.delete(id);
    else active.add(id);
    syncPressed(chips, active);
    opts.onChange(new Set(active));
    toggleLog.exit(undefined);
  };

  return log.exit({
    element,
    update: (counts): void => updateCounts(chips, counts),
    active: (): ReadonlySet<MapFilterId> => new Set(active),
    setActive: (ids): void => replaceActive(chips, active, ids),
  });
}

/**
 * 入っているフィルタを外から置き換える（onChange は呼ばない）。
 * @param chips フィルタ → チップの要素
 * @param active 入っているフィルタ（書き換える）
 * @param ids 新しく入れるフィルタ
 * @sideEffect active とチップの aria-pressed を変更する
 */
function replaceActive(chips: ReadonlyMap<MapFilterId, FilterChip>, active: Set<MapFilterId>, ids: ReadonlySet<MapFilterId>): void {
  const log = logger.fn('replaceActive', { ids: [...ids] });
  active.clear();
  for (const id of ids) active.add(id);
  syncPressed(chips, active);
  log.exit(undefined);
}

/**
 * チップの押下状態を入っているフィルタに合わせる。
 * @param chips フィルタ → チップの要素
 * @param active 入っているフィルタ
 * @sideEffect チップの aria-pressed を変更する
 */
function syncPressed(chips: ReadonlyMap<MapFilterId, FilterChip>, active: ReadonlySet<MapFilterId>): void {
  const log = logger.fn('syncPressed', { active: [...active] });
  for (const [id, chip] of chips) chip.button.setAttribute('aria-pressed', active.has(id) ? 'true' : 'false');
  log.exit(undefined);
}

/** フィルタのチップの要素 */
interface FilterChip {
  readonly button: HTMLButtonElement;
  readonly count: HTMLElement;
}

/**
 * 左端の「好み」ボタンを作る。
 * @param onOpenPrefs 押されたとき
 * @returns button 要素
 */
function prefsButton(onOpenPrefs: () => void): HTMLButtonElement {
  const log = logger.fn('prefsButton');
  return log.exit(
    h(
      'button',
      {
        class: 'map-filter-bar__prefs',
        attrs: { type: 'button', 'data-testid': 'map-prefs-open', 'aria-label': '好みと行きたい場所を選ぶ' },
        on: { click: userAction('map-prefs-open', onOpenPrefs) },
      },
      [createMapUiIcon('heart', CHIP_ICON_PX, 'map-filter-bar__icon'), h('span', { class: 'map-filter-bar__label', text: '好み' })],
    ),
  );
}

/**
 * フィルタのチップ（入切ボタン＋件数の札）を作る。
 * @param filter フィルタの表示名
 * @param onToggle 押されたとき
 * @returns チップの要素
 */
function filterChip(filter: (typeof MAP_FILTERS)[number], onToggle: () => void): FilterChip {
  const log = logger.fn('filterChip', { id: filter.id });
  const count = h('span', { class: 'map-filter-chip__count', attrs: { 'aria-hidden': 'true' }, text: '' });
  count.hidden = true;
  const button = h(
    'button',
    {
      class: 'map-filter-chip',
      attrs: { type: 'button', 'aria-pressed': 'false', 'data-testid': 'map-filter', 'data-filter': filter.id, 'aria-label': filter.label },
      on: { click: onToggle },
    },
    [h('span', { class: 'map-filter-chip__badge' }, [createMapUiIcon(FILTER_ICONS[filter.id], CHIP_ICON_PX, 'map-filter-bar__icon')]), h('span', { class: 'map-filter-chip__label', text: filter.label }), count],
  );
  return log.exit({ button, count });
}

/**
 * チップの件数の札を更新する（0 件は札を消してチップを淡くする）。
 * @param chips フィルタ → チップの要素
 * @param counts フィルタ → 当てはまる件数
 * @sideEffect 札の文言とチップの data-empty を変更する
 */
function updateCounts(chips: ReadonlyMap<MapFilterId, FilterChip>, counts: Readonly<Record<MapFilterId, number>>): void {
  const log = logger.fn('updateCounts', { counts });
  for (const [id, chip] of chips) {
    const n = Math.max(0, Math.floor(counts[id] ?? 0));
    chip.count.textContent = n > 0 ? String(n) : '';
    chip.count.hidden = n === 0;
    chip.button.dataset.empty = n === 0 ? '1' : '0';
    const label = MAP_FILTERS.find((f) => f.id === id)?.label ?? id;
    chip.button.setAttribute('aria-label', n > 0 ? `${label}（${n}件）` : label);
  }
  log.exit(undefined);
}
