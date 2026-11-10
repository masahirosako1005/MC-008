/**
 * @file 「好み・行きたい場所」を選ぶパネル（presentation/screens/Map/town 層）
 * 好み（カフェ・甘いもの・トイレ・ベビーカーOK など）をチップで入切し、「行きたい」に入れたスポットの一覧から外せる（A 初回満足度・B 未開拓への興味）。
 * Common/ui/Modal の上に組み立て、「保存」で onSave に新しい好みを渡す（保存先への書き込みは呼び出し側）。
 */
import '@/presentation/screens/Map/town/mapTownUi.css';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { openModal } from '@/Common/ui/Modal';
import { userAction } from '@/Common/ui/userAction';
import { INTERESTS, toggleInterest, toggleWant } from '@/presentation/screens/Map/town/mapPrefs';
import type { InterestId, MapPrefs } from '@/presentation/screens/Map/town/mapPrefs';
import { createMapLineIcon } from '@/presentation/screens/Map/town/mapLineIcons';

const logger = createLogger('presentation/screens/Map/town/MapPrefsPanel');

/** openMapPrefsPanel のオプション */
export interface MapPrefsPanelOptions {
  /** 今の好み */
  readonly prefs: MapPrefs;
  /** 「行きたい」に入れたスポット・便利施設の表示名（prefs.wants の順でなくてよい。無い ID は ID のまま出さず「（名前未取得）」） */
  readonly wantNames: readonly { readonly id: string; readonly name: string }[];
  /** 好みで地図を絞り込んでいるか（パネルを開いたときの状態） */
  readonly filterOn: boolean;
  /** 「保存」を押したとき（filterOn＝好みで地図を絞り込むか） */
  onSave(prefs: MapPrefs, filterOn: boolean): void;
  /** 出す先（省略時は Modal の既定＝スマホ枠） */
  readonly host?: HTMLElement;
}

/**
 * 好み・行きたい場所のパネルを開く。
 * @param opts 今の好み・行きたい場所の名前・保存時の通知先
 * @returns パネルを閉じる関数（2回目以降は何もしない）
 * @sideEffect モーダルを開く
 */
export function openMapPrefsPanel(opts: MapPrefsPanelOptions): () => void {
  const log = logger.fn('openMapPrefsPanel', { interests: opts.prefs.interests.length, wants: opts.prefs.wants.length });
  let draft: MapPrefs = opts.prefs;
  let filterOn = opts.filterOn;
  // 好みで地図を絞り込む入切（上のバーにあった「好み」のチップをここへ移した。2026-11-10 ユーザー指示）
  const filterSwitch = h('button', {
    class: 'map-prefs__switch',
    attrs: { type: 'button', role: 'switch', 'aria-checked': filterOn ? 'true' : 'false', 'aria-label': '好みで地図を絞り込む', 'data-testid': 'map-prefs-filter' },
    on: { click: userAction('map-prefs-filter', () => setFilterOn(!filterOn)) },
  });
  /**
   * 好みで絞り込むかを切り替える。
   * @param on 絞り込むなら true
   * @sideEffect スイッチの見た目を変える
   */
  const setFilterOn = (on: boolean): void => {
    const switchLog = logger.fn('setFilterOn', { on });
    filterOn = on;
    filterSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
    switchLog.exit(undefined);
  };
  const interestList = h('div', { class: 'map-prefs__chips', attrs: { role: 'group', 'aria-label': '好み' } });
  const wantList = h('ul', { class: 'map-prefs__wants', attrs: { 'data-testid': 'map-prefs-wants' } });

  /**
   * 下書きの好みを差し替え、チップと行きたい一覧を描き直す（好みのチップ・「外す」から呼ぶ）。
   * @param next 新しい下書き
   * @sideEffect パネルの子要素を置き換える
   */
  const render = (next: MapPrefs): void => {
    const renderLog = logger.fn('render', { interests: next.interests.length, wants: next.wants.length });
    draft = next;
    interestList.replaceChildren(...INTERESTS.map((item) => interestChip(item, draft.interests.includes(item.id), (id: InterestId) => {
      const next2 = toggleInterest(draft, id);
      // 好みを新しく選んだら、絞り込みも入れる（選んだのに地図が変わらない、を避ける）
      if (next2.interests.length > draft.interests.length) setFilterOn(true);
      render(next2);
    })));
    wantList.replaceChildren(...wantItems(draft.wants, opts.wantNames, (id) => render(toggleWant(draft, id))));
    renderLog.exit(undefined);
  };

  render(draft);
  const handle = openModal({
    title: '絞り込み',
    body: panelBody(interestList, wantList, filterSwitch),
    host: opts.host,
    testId: 'map-prefs-panel',
    actions: [
      { label: 'とじる', variant: 'secondary', testId: 'map-prefs-close', onClick: (): void => undefined },
      { label: '保存', variant: 'primary', testId: 'map-prefs-save', onClick: (): void => opts.onSave(draft, filterOn) },
    ],
  });
  handle.element.classList.add('map-prefs-layer');
  return log.exit((): void => handle.close());
}

/**
 * パネルの本文（好みのチップ・行きたい一覧）を組み立てる。説明の文は置かない（見出しは全画面共通の .section-title）。
 * @param interestList 好みのチップを入れる要素
 * @param wantList 行きたい一覧を入れる要素
 * @param filterSwitch 好みで地図を絞り込む入切（「好み」の見出しの右に置く）
 * @returns 本文の要素
 */
function panelBody(interestList: HTMLElement, wantList: HTMLElement, filterSwitch: HTMLElement): HTMLElement {
  const log = logger.fn('panelBody');
  return log.exit(
    h('div', { class: 'map-prefs', attrs: { 'data-testid': 'map-prefs' } }, [
      h('div', { class: 'map-prefs__head' }, [h('h3', { class: ['section-title', 'map-prefs__heading'], text: '好み' }), filterSwitch]),
      interestList,
      h('h3', { class: ['section-title', 'map-prefs__heading'], text: '行きたい場所' }),
      wantList,
    ]),
  );
}

/**
 * 好みのチップ（入切ボタン）を作る。
 * @param item 好みの表示名（アイコンは同じ名前の線の絵）
 * @param selected 選んでいれば true
 * @param onToggle 押されたとき
 * @returns button 要素
 */
function interestChip(item: (typeof INTERESTS)[number], selected: boolean, onToggle: (id: InterestId) => void): HTMLButtonElement {
  const log = logger.fn('interestChip', { id: item.id, selected });
  return log.exit(
    h(
      'button',
      {
        class: 'map-prefs__chip',
        attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false', 'data-testid': 'map-prefs-interest', 'data-interest': item.id },
        on: { click: userAction('map-prefs-interest', () => onToggle(item.id)) },
      },
      [createMapLineIcon(item.id, 'map-prefs__icon'), h('span', { text: item.label })],
    ),
  );
}

/**
 * 「行きたい」一覧の行を作る（空なら線の絵＋「なし」）。
 * @param wants 行きたいに入れた ID（入れた順）
 * @param names ID → 表示名
 * @param onRemove 「外す」を押したとき
 * @returns li 要素
 */
function wantItems(wants: readonly string[], names: readonly { readonly id: string; readonly name: string }[], onRemove: (id: string) => void): HTMLLIElement[] {
  const log = logger.fn('wantItems', { wants: wants.length });
  if (wants.length === 0) {
    return log.exit([h('li', { class: 'map-prefs__empty', attrs: { 'data-testid': 'map-prefs-empty' } }, [createMapLineIcon('heart', 'map-prefs__empty-icon'), h('span', { text: 'なし' })])]);
  }
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  return log.exit(
    wants.map((id) =>
      h('li', { class: 'map-prefs__want', attrs: { 'data-want-id': id } }, [
        createMapLineIcon(id.startsWith('a_') ? 'toilet' : 'heart', 'map-prefs__want-icon'),
        h('span', { class: 'map-prefs__want-name', text: nameOf.get(id) ?? '？？？' }),
        h('button', {
          class: 'map-prefs__remove',
          attrs: { type: 'button', 'data-testid': 'map-prefs-remove', 'aria-label': `${nameOf.get(id) ?? 'この場所'}を行きたいから外す` },
          text: '外す',
          on: { click: userAction('map-prefs-remove', () => onRemove(id)) },
        }),
      ]),
    ),
  );
}
