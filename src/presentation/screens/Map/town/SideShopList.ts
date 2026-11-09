/**
 * @file 中間の表示で右側に出す「映っているお店」の列（presentation/screens/Map/town 層）
 * 2026-11-09 ユーザー指示「広域と中域でアイコン見えないので改善したい。例えば、リスト表示で右側で出るとか」。
 * 地図を引いて見ているとき（中間）、画面に映っているお店を写真つきで縦に並べる（今日だけ・行きたい・フィルタに合うものが上）。
 * 押すと、そのお店へ向かう（MapScreen がカードを出して歩き出す）。中身が変わったときだけ作り直す。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { userAction } from '@/Common/ui/userAction';
import { paintGoodsPhoto } from '@/presentation/screens/Map/town/goodsPhoto';
import type { GoodsIcon } from '@/presentation/screens/Map/town/pixelSprites';

const logger = createLogger('presentation/screens/Map/town/SideShopList');

/** 列に出す最大の件数 */
export const SIDE_LIST_MAX = 14;
/** 写真の大きさ（CSS px） */
const PHOTO_PX = 52;

/** 列の1件 */
export interface SideShopItem {
  readonly id: string;
  /** 名前（未発見は undefined） */
  readonly name?: string;
  readonly icon: GoodsIcon;
  readonly unknown: boolean;
  readonly visited: boolean;
  readonly want: boolean;
  /** 今日だけ・クーポンなどの札 */
  readonly tag?: string;
  readonly hot: boolean;
}

/** 列の操作 */
export interface SideShopListHandle {
  readonly element: HTMLElement;
  /** 中身を入れ替える（同じ並びなら何もしない） */
  update(items: readonly SideShopItem[]): void;
  /** 出す・隠す */
  setVisible(visible: boolean): void;
  /** 選択中のお店を強調する */
  setSelected(id: string | undefined): void;
}

/**
 * 右側の列を作る（最初は隠れている）。
 * @param onSelect お店が押されたとき
 * @returns 操作
 */
export function createSideShopList(onSelect: (id: string) => void): SideShopListHandle {
  const log = logger.fn('createSideShopList');
  const list = h('ul', { class: 'map-side-list__items' });
  const element = h('nav', { class: 'map-side-list', attrs: { 'aria-label': '映っているお店', 'data-testid': 'map-side-list' } }, [list]);
  element.hidden = true;
  let key = '';
  let selected: string | undefined;
  const handle: SideShopListHandle = {
    element,
    /**
     * 中身を入れ替える（同じ並びなら何もしない）。
     * @param items 並べるお店
     * @sideEffect 列の中身を作り直す
     */
    update(items: readonly SideShopItem[]): void { // audit-ignore: fnlog-missing 数フレームごとに呼ぶ（変わったときだけ作り直す）
      const next = items.map((i) => `${i.id}:${i.name ?? ''}:${i.tag ?? ''}:${i.visited ? 1 : 0}:${i.want ? 1 : 0}`).join('|');
      if (next === key) return;
      key = next;
      list.replaceChildren(...items.map((item) => itemElement(item, item.id === selected, onSelect)));
    },
    /**
     * 出す・隠す。
     * @param visible 出すなら true
     * @sideEffect hidden を切り替える
     */
    setVisible(visible: boolean): void { // audit-ignore: fnlog-missing 毎フレーム呼ぶ（変わったときだけ切り替える）
      if (element.hidden === !visible) return;
      element.hidden = !visible;
    },
    /**
     * 選択中のお店を強調する。
     * @param id 選択中のお店（無ければ undefined）
     * @sideEffect 各項目の data-selected を変える
     */
    setSelected(id: string | undefined): void { // audit-ignore: fnlog-missing 毎フレーム呼ぶ（変わったときだけ切り替える）
      if (selected === id) return;
      selected = id;
      for (const li of Array.from(list.children)) {
        if (li instanceof HTMLElement) li.dataset.selected = li.dataset.id === id ? '1' : '0';
      }
    },
  };
  return log.exit(handle);
}

/**
 * 列の1件（写真・名前・札）を作る。
 * @param item 1件
 * @param selected 選択中か
 * @param onSelect 押されたとき
 * @returns li 要素
 */
function itemElement(item: SideShopItem, selected: boolean, onSelect: (id: string) => void): HTMLElement {
  const log = logger.fn('itemElement', { id: item.id });
  const photo = h('canvas', { class: 'map-side-list__photo', attrs: { 'aria-hidden': 'true' } });
  paintGoodsPhoto(photo, item.icon, PHOTO_PX, { silhouette: item.unknown });
  const children: HTMLElement[] = [photo];
  if (item.tag !== undefined) children.push(h('span', { class: ['map-side-list__tag', item.hot ? 'map-side-list__tag--hot' : undefined], text: item.tag }));
  children.push(h('span', { class: 'map-side-list__name', text: item.name ?? '？？？' }));
  const button = h(
    'button',
    {
      class: 'map-side-list__item',
      attrs: { type: 'button', 'aria-label': `${item.name ?? 'まだ見つけていないお店'}${item.tag === undefined ? '' : `（${item.tag}）`}`, 'data-testid': 'map-side-item', 'data-spot-id': item.id },
      on: { click: userAction('map-side-item', () => onSelect(item.id)) },
    },
    children,
  );
  const li = h('li', { attrs: { 'data-id': item.id, 'data-selected': selected ? '1' : '0', 'data-visited': item.visited ? '1' : '0', 'data-want': item.want ? '1' : '0' } }, [button]);
  return log.exit(li);
}
