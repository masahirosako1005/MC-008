/**
 * @file 地図の上端に重ねるフィルタのチップ列（presentation/screens/Map/town 層）
 * 絞り込みの丸ボタン（好み・行きたい場所のパネルを開く。好みの絞り込みの入切もパネルの中）・今日だけ・ベビーカーOK・トイレ・子連れ歓迎・雨の日OK の切替チップを横スクロールで並べる（A 初回満足度・C 再訪動機）。アイコンは線の絵。
 * チップは押すたびに入切し（aria-pressed）、当てはまるスポットの件数を小さな札で示す。地図の強調は呼び出し側（MapScreen）が行う。
 */
import '@/presentation/screens/Map/town/mapTownUi.css';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createLineIcon } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';
import { mapLineIconPaths } from '@/presentation/screens/Map/town/mapLineIcons';
import type { MapLineIconName } from '@/presentation/screens/Map/town/mapLineIcons';
import { MAP_FILTERS } from '@/presentation/screens/Map/town/mapPrefs';
import type { MapFilterId } from '@/presentation/screens/Map/town/mapPrefs';

const logger = createLogger('presentation/screens/Map/town/MapFilterBar');

/** 円（中心 cx,cy・半径 r）の d 属性（線のアイコン用） */
const ring = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`;

/** フィルタ → チップのアイコン（線の絵。お店カード・好みパネルと同じ mapLineIcons の絵） */
const FILTER_ICONS: Readonly<Record<MapFilterId, MapLineIconName>> = { today: 'today', stroller: 'stroller', toilet: 'toilet', kids: 'kids', rainOk: 'rainOk', want: 'heart' };

/** 好みを選ぶボタンのアイコン（つまみが2本の調整の絵） */
const PREFS_ICON_PATHS: readonly string[] = ['M4 7.5h8', 'M17 7.5h3', ring(14.5, 7.5, 2.25), 'M4 16.5h3', 'M12 16.5h8', ring(9.5, 16.5, 2.25)];


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
  // 「好み」のチップは出さない（2026-11-10 ユーザー指示「好みをフィルタ内に統合して」）。
  // 好みの絞り込み（want）の入切は、絞り込みの丸ボタンから開くパネルの中で行い、入っているあいだは丸ボタンを選択中の色にする
  const prefs = prefsButton(opts.onOpenPrefs);
  const items: HTMLElement[] = [prefs];
  for (const filter of MAP_FILTERS) {
    if (filter.id === 'want') continue;
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
    prefs.dataset.active = active.has('want') ? '1' : '0';
    opts.onChange(new Set(active));
    toggleLog.exit(undefined);
  };

  return log.exit({
    element,
    update: (counts): void => updateCounts(chips, counts),
    active: (): ReadonlySet<MapFilterId> => new Set(active),
    setActive: (ids): void => {
      replaceActive(chips, active, ids);
      prefs.dataset.active = active.has('want') ? '1' : '0';
    },
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
 * 好みを選ぶ丸いボタンを作る（「好み」のチップのとなり。文字は出さず、読み上げ名で伝える）。
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
        attrs: { type: 'button', 'data-testid': 'map-prefs-open', 'data-active': '0', 'aria-label': '絞り込み（好みと行きたい場所）' },
        on: { click: userAction('map-prefs-open', onOpenPrefs) },
      },
      [createLineIcon(PREFS_ICON_PATHS, ['icon', 'map-filter-bar__line-icon'])],
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
    [createLineIcon(mapLineIconPaths(FILTER_ICONS[filter.id]), ['icon', 'map-filter-bar__line-icon']), h('span', { class: 'map-filter-chip__label', text: filter.label }), count],
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
