/**
 * @file 着せ替え（アバターに持たせるものを選ぶ）（presentation/screens/MyTown 層。DOM 部品）
 * 上に大きなプレビュー、下に選べるもの（カメラ＋手に入れたアイテム）と、まだ持っていないアイテム（点線・手に入れ方）。
 * 選ぶと onEquip を呼ぶ（保存は EquipAvatarItemUseCase。持っていないものは application 側でも拒否する）。
 * まだ持っていないアイテムは「手に入れ方」を見せる（B 未開拓への興味）。
 */
import type { MyTownDto } from '@/application/dto/Dto';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import type { AvatarLook } from '@/presentation/screens/MyTown/avatarArt';
import { SPRITE_BY_ITEM } from '@/presentation/screens/MyTown/myTownModel';
import { createPortrait } from '@/presentation/screens/MyTown/MyTownProfile';
import { createSprite } from '@/presentation/screens/MyTown/pixelSprites';
import type { SpriteName } from '@/presentation/screens/MyTown/pixelSprites';

const logger = createLogger('presentation/screens/MyTown/DressPanel');

/** 選択肢のアイコン（カメラ＋アイテム） */
const ICON_OF: Readonly<Record<string, SpriteName>> = { camera: 'camera', ...SPRITE_BY_ITEM };

/** createDressPanel の入力 */
export interface DressPanelInput {
  readonly dto: MyTownDto;
  readonly look: AvatarLook;
  /** 持たせるものを選んだとき（undefined はカメラ）。完了まで選択肢を無効にする */
  readonly onEquip: (itemId: string | undefined) => Promise<void>;
  /** まだ持っていないアイテムを押したとき（手に入れ方を伝える） */
  readonly onLocked: (name: string, hint: string) => void;
}

/** 選択肢1つ */
interface DressOption {
  readonly key: string;
  readonly itemId?: string;
  readonly name: string;
  readonly note: string;
  readonly isHeld: boolean;
}

/**
 * 選べるもの（カメラ＋手に入れたアイテム）を並べる。
 * @param dto マイ街
 * @returns 選択肢
 */
function optionsOf(dto: MyTownDto): DressOption[] {
  const log = logger.fn('optionsOf', { items: dto.items.length, held: dto.heldItemId });
  const camera: DressOption = { key: 'camera', name: 'カメラ', note: 'はじめから持っている', isHeld: dto.heldItemId === undefined };
  const items = dto.items.map((i) => ({ key: i.itemId, itemId: i.itemId, name: i.name, note: `${i.earnedOn} に入手`, isHeld: i.isHeld }));
  return log.exit([camera, ...items]);
}

/**
 * 選択肢のボタンを作る。
 * @param option 選択肢
 * @param onPick 押したとき
 * @returns ボタン
 */
function createOptionButton(option: DressOption, onPick: () => void): HTMLButtonElement {
  const log = logger.fn('createOptionButton', { key: option.key, isHeld: option.isHeld });
  const swatch = h('span', { class: 'mytown-item__swatch', attrs: { 'aria-hidden': 'true' } }, [createSprite(ICON_OF[option.key] ?? 'card', 3)]);
  const button = h('button', {
    class: ['mytown-item', option.isHeld ? 'mytown-item--held' : undefined],
    attrs: { type: 'button', 'aria-pressed': option.isHeld ? 'true' : 'false', 'data-testid': `mytown-dress-${option.key}` },
  }, [swatch, h('span', { class: 'mytown-item__body' }, [h('b', { text: option.name }), h('small', { text: option.isHeld ? '✓ 持っている' : option.note })])]);
  button.addEventListener('click', () => {
    setCorrelationId();
    onPick();
  });
  return log.exit(button);
}

/**
 * まだ持っていないアイテムのボタンを作る（点線・？）。
 * @param itemId アイテムID（アイコン）
 * @param name アイテム名
 * @param hint 手に入れ方
 * @param onTap 押したとき
 * @returns ボタン
 */
function createLockedButton(itemId: string, name: string, hint: string, onTap: () => void): HTMLButtonElement {
  const log = logger.fn('createLockedButton', { name });
  const button = h('button', { class: ['mytown-item', 'mytown-item--locked'], attrs: { type: 'button', 'aria-label': `${name}（まだ持っていません。${hint}）` } }, [
    h('span', { class: 'mytown-item__swatch', attrs: { 'aria-hidden': 'true' } }, [createSprite(ICON_OF[itemId] ?? 'card', 3, 'silhouette')]),
    h('span', { class: 'mytown-item__body' }, [h('b', { text: name }), h('small', { text: hint })]),
  ]);
  button.addEventListener('click', () => {
    setCorrelationId();
    onTap();
  });
  return log.exit(button);
}

/**
 * 着せ替えのパネルを作る。
 * @param input マイ街・装い・選んだときの処理
 * @returns 要素
 */
export function createDressPanel(input: DressPanelInput): HTMLElement {
  const log = logger.fn('createDressPanel', { items: input.dto.items.length, locked: input.dto.lockedItems.length });
  const grid = h('div', { class: 'mytown-items' });
  /**
   * 選んだものを持たせる（保存中は選択肢を busy にする）。
   * @param itemId 持たせるアイテム（undefined はカメラ）
   * @sideEffect onEquip を呼ぶ
   */
  const pick = async (itemId: string | undefined): Promise<void> => {
    const pickLog = logger.fn('pick', { itemId });
    grid.setAttribute('aria-busy', 'true');
    await input.onEquip(itemId);
    grid.removeAttribute('aria-busy');
    pickLog.exit(undefined);
  };
  grid.append(
    ...optionsOf(input.dto).map((o) => createOptionButton(o, (): void => void (o.isHeld ? undefined : pick(o.itemId)))),
    ...input.dto.lockedItems.map((i) => createLockedButton(i.itemId, i.name, i.hint, (): void => input.onLocked(i.name, i.hint))),
  );
  return log.exit(h('section', { class: 'mytown-dress', attrs: { 'data-testid': 'mytown-dress' } }, [
    h('div', { class: 'mytown-dress__preview' }, [
      createPortrait(input.look, { width: 140, height: 156, scale: 1.9 }),
      h('p', { class: 'mytown-hint', text: '訪問やイベントで手に入れたアイテムを、アバターに持たせられます。帽子は通った実績で変わります。' }),
    ]),
    h('h2', { class: 'mytown-sub', text: '持たせるもの' }),
    grid,
  ]));
}
