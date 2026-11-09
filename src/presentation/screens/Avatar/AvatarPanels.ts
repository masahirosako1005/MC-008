/**
 * @file アバター画面のタブの中身（presentation/screens/Avatar 層。DOM 部品）
 * 部品の格子（試着サムネイル・レア度の枠・NEW・鍵）、色のチップ、選んだ部品の詳しい情報、称号の札、
 * ピックアップ（NEW・もうすぐ手に入る）、マイコーデを作る。状態は持たず、押したときの処理は呼び出し側に渡す。
 * まだ持っていない部品は「手に入れ方」と進み具合を見せ、試着できる（B 未開拓への興味・C 再訪動機）。
 */
import type { AvatarCoordDto, AvatarPartDto } from '@/application/dto/Dto';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createAvatarIcon, iconText } from '@/presentation/screens/Avatar/avatarIcons';
import type { AvatarIconName } from '@/presentation/screens/Avatar/avatarIcons';
import { REMOVABLE_SLOTS, remainingTextOf } from '@/presentation/screens/Avatar/avatarScreenModel';
import { createOutfitThumb, createPartThumb } from '@/presentation/screens/Avatar/partThumb';
import { HAIR_COLORS, SKIN_COLORS, TOP_COLORS, splitPartId } from '@/presentation/shared/avatar/avatarLook';

const logger = createLogger('presentation/screens/Avatar/AvatarPanels');

/** サムネイルの一辺（CSS px） */
const THUMB_PX = 64;

/** 色のチップの色（枠 → 種類 → 色） */
const CHIP_COLORS: Readonly<Record<string, Readonly<Record<string, string>>>> = { hairColor: HAIR_COLORS, skin: SKIN_COLORS, topColor: TOP_COLORS };

/** レア度の読み上げ */
const RARITY_LABEL: Readonly<Record<string, string>> = { N: 'ノーマル', R: 'レア', SR: 'スーパーレア', SSR: 'スペシャルレア' };

/** 格子・チップの入力 */
export interface PartListInput {
  readonly parts: readonly AvatarPartDto[];
  /** 保存している装い（身につけている印に使う） */
  readonly outfit: readonly string[];
  /** 試着中の装い（サムネイルの土台） */
  readonly preview: readonly string[];
  readonly tryOnId?: string;
  readonly selectedId?: string;
  readonly onPick: (part: AvatarPartDto) => void;
}

/**
 * 押したときの処理を付ける（相関ID を発行してから呼ぶ）。
 * @param el 要素
 * @param handler 処理
 * @returns el
 */
function onTap<T extends HTMLElement>(el: T, handler: () => void): T { // audit-ignore: fnlog-missing ボタンごとに呼ぶ小さな配線ヘルパー
  el.addEventListener('click', () => {
    setCorrelationId();
    handler();
  });
  return el;
}

/**
 * レア度の札を作る。
 * @param rarity レア度
 * @returns 要素
 */
export function createRarityTag(rarity: string): HTMLElement {
  return h('span', { class: ['avatar-rarity', `avatar-rarity--${rarity.toLowerCase()}`], attrs: { 'aria-label': RARITY_LABEL[rarity] ?? rarity } }, [h('span', { class: 'avatar-rarity__text', text: rarity })]);
}

/** 季節 → アイコン */
const SEASON_ICON: Readonly<Record<string, AvatarIconName>> = { spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' };
/** 季節 → 名前 */
export const SEASON_LABEL: Readonly<Record<string, string>> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

/**
 * 季節のアイコンを作る。
 * @param season 季節
 * @param size 一辺（CSS px）
 * @returns canvas（知らない季節なら undefined）
 */
export function createSeasonIcon(season: string, size: number): HTMLCanvasElement | undefined { // audit-ignore: fnlog-missing 札ごとに呼ぶ小さな分岐（作るときは createAvatarIcon がログを出す）
  const icon = SEASON_ICON[season];
  return icon === undefined ? undefined : createAvatarIcon(icon, size);
}

/**
 * ご当地（地区の色の札）・季節（季節の絵の札）の札を作る。
 * @param part 部品
 * @returns 要素（どちらでもなければ undefined）
 */
export function createPlaceTag(part: Pick<AvatarPartDto, 'region' | 'season' | 'districtId'>): HTMLElement | undefined {
  const log = logger.fn('createPlaceTag', { region: part.region, season: part.season });
  if (part.season !== undefined) {
    const label = SEASON_LABEL[part.season] ?? '';
    return log.exit(h('span', { class: ['avatar-place', 'avatar-place--season'], attrs: { 'aria-label': label + 'の部品' } }, [createSeasonIcon(part.season, 12), h('span', { text: label })]));
  }
  if (part.region === undefined) return log.exit(undefined);
  return log.exit(h('span', { class: ['avatar-place', 'avatar-place--region'], attrs: { 'data-district-id': part.districtId }, text: part.region }));
}

/**
 * 部品の格子の1マスを作る。
 * @param part 部品
 * @param input 格子の入力
 * @param index 並びの番号（光の筋をずらす）
 * @returns ボタン
 */
function createPartCell(part: AvatarPartDto, input: PartListInput, index = 0): HTMLButtonElement {
  const log = logger.fn('createPartCell', { id: part.id });
  const equipped = input.outfit.includes(part.id);
  const trying = input.tryOnId === part.id;
  const state = part.owned ? (equipped ? '身につけています' : '持っています') : `まだ持っていません。${part.hint}`;
  const button = h('button', {
    class: ['avatar-item', `avatar-item--${part.rarity.toLowerCase()}`, part.owned ? undefined : 'avatar-item--locked', equipped ? 'avatar-item--on' : undefined,
      trying ? 'avatar-item--trying' : undefined, input.selectedId === part.id ? 'avatar-item--selected' : undefined],
    attrs: { type: 'button', 'aria-pressed': equipped ? 'true' : 'false', 'aria-label': `${part.name}（${RARITY_LABEL[part.rarity] ?? part.rarity}）${state}`, 'data-testid': `avatar-part-${part.id}` },
    style: { '--i': String(index % 12) },
  }, [
    h('span', { class: 'avatar-item__art' }, [createPartThumb(part.id, input.preview, THUMB_PX), createPlaceTag(part)]),
    h('span', { class: 'avatar-item__name', text: part.name }),
    part.owned ? undefined : h('span', { class: 'avatar-item__how', text: part.hint }),
    createRarityTag(part.rarity),
    part.isNew ? h('span', { class: 'avatar-badge avatar-badge--new', text: 'NEW' }) : undefined,
    equipped ? createAvatarIcon('check', 20, 'avatar-badge--on') : undefined,
    part.owned ? undefined : h('span', { class: 'avatar-item__lock', attrs: { 'aria-hidden': 'true' } }, [createAvatarIcon('lock', 20), h('small', { text: remainingTextOf(part) })]),
  ]);
  return log.exit(onTap(button, () => input.onPick(part)));
}

/**
 * 「なし（はずす）」のマスを作る。
 * @param slot 枠
 * @param isEmpty いま何も着けていない
 * @param onClear 押したとき
 * @returns ボタン
 */
function createNoneCell(slot: string, isEmpty: boolean, onClear: () => void): HTMLButtonElement {
  const log = logger.fn('createNoneCell', { slot, isEmpty });
  const label = slot === 'object' ? 'ぜんぶ片づける' : 'なし';
  const button = h('button', {
    class: ['avatar-item', 'avatar-item--none', isEmpty ? 'avatar-item--on' : undefined],
    attrs: { type: 'button', 'aria-pressed': isEmpty ? 'true' : 'false', 'data-testid': `avatar-none-${slot}` },
  }, [h('span', { class: 'avatar-item__art avatar-item__art--none' }, [createAvatarIcon('none', 30)]), h('span', { class: 'avatar-item__name', text: label })]);
  return log.exit(onTap(button, onClear));
}

/**
 * 部品の格子を作る（はずせる枠は先頭に「なし」）。
 * @param slot 枠
 * @param input 格子の入力
 * @param onClear 「なし」を押したとき
 * @returns 要素
 */
export function createPartGrid(slot: string, input: PartListInput, onClear: () => void): HTMLElement {
  const log = logger.fn('createPartGrid', { slot });
  const parts = input.parts.filter((p) => p.slot === slot);
  const isEmpty = !input.outfit.some((id) => id.startsWith(`${slot}.`));
  const cells = parts.map((p, i) => createPartCell(p, input, i));
  const none = REMOVABLE_SLOTS.has(slot) ? createNoneCell(slot, isEmpty, onClear) : undefined;
  return log.exit(h('div', { class: 'avatar-grid', attrs: { role: 'list', 'data-testid': `avatar-grid-${slot}` } }, [none, ...cells]));
}

/**
 * 色のチップの列を作る。
 * @param slot 色の枠（hairColor・skin・topColor）
 * @param title 見出し
 * @param input 格子の入力
 * @returns 要素
 */
export function createColorChips(slot: string, title: string, input: PartListInput): HTMLElement {
  const log = logger.fn('createColorChips', { slot });
  const table = CHIP_COLORS[slot] ?? {};
  const chips = input.parts.filter((p) => p.slot === slot).map((p) => {
    const color = table[splitPartId(p.id)?.style ?? ''] ?? '#cccccc';
    const on = input.outfit.includes(p.id);
    const chip = h('button', {
      class: ['avatar-chip', p.owned ? undefined : 'avatar-chip--locked', on ? 'avatar-chip--on' : undefined, input.tryOnId === p.id ? 'avatar-chip--trying' : undefined],
      attrs: { type: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-label': `${p.name}${p.owned ? '' : `（まだ持っていません。${p.hint}）`}`, title: p.name, 'data-testid': `avatar-part-${p.id}` },
      style: { '--chip': color },
    }, [p.owned ? undefined : h('span', { class: 'avatar-chip__lock' }, [createAvatarIcon('lock', 18)]), p.isNew ? h('span', { class: 'avatar-chip__new', attrs: { 'aria-hidden': 'true' } }) : undefined]);
    return onTap(chip, () => input.onPick(p));
  });
  return log.exit(h('section', { class: 'avatar-chips' }, [h('h3', { class: 'avatar-sub', text: title }), h('div', { class: 'avatar-chips__row' }, chips)]));
}

/**
 * 進み具合のバーを作る。
 * @param part 部品
 * @returns 要素
 */
export function createProgressBar(part: AvatarPartDto): HTMLElement {
  const log = logger.fn('createProgressBar', { id: part.id });
  const ratio = part.target <= 0 ? 1 : part.current / part.target;
  const label = part.unit === '' ? (part.owned ? '達成' : 'まだ') : `${part.current} / ${part.target}${part.unit}`;
  return log.exit(h('div', { class: 'avatar-progress', attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': part.target, 'aria-valuenow': part.current, 'aria-label': part.hint } }, [
    h('span', { class: 'avatar-progress__bar' }, [h('span', { class: 'avatar-progress__fill', style: { width: `${Math.round(ratio * 100)}%` } })]),
    h('small', { class: 'avatar-progress__text', text: label }),
  ]));
}

/** 詳しい情報の操作 */
export interface DetailActions {
  readonly onStopTryOn: () => void;
  readonly onUnequip: (part: AvatarPartDto) => void;
  /** 地図を開く（地区の条件ならその地区、ほかは地図全体） */
  readonly onGoMap: (districtId?: string) => void;
}

/**
 * 選んだ部品の詳しい情報（名前・レア度・手に入れ方・進み具合・操作）を作る。
 * @param part 部品
 * @param input 格子の入力
 * @param actions 操作
 * @returns 要素
 */
export function createPartDetail(part: AvatarPartDto, input: PartListInput, actions: DetailActions): HTMLElement {
  const log = logger.fn('createPartDetail', { id: part.id, owned: part.owned });
  const equipped = input.outfit.includes(part.id);
  const status = part.owned ? (equipped ? '身につけています' : '持っています') : '試着中（まだ持っていません）';
  const buttons: HTMLElement[] = [];
  if (!part.owned && input.tryOnId === part.id) buttons.push(onTap(h('button', { class: 'avatar-pill', text: '試着をやめる', attrs: { type: 'button' } }), actions.onStopTryOn));
  if (!part.owned) {
    const label = part.districtId === undefined ? '地図で探す' : '地図で向かう';
    buttons.push(onTap(h('button', { class: ['avatar-pill', 'avatar-pill--primary'], text: label, attrs: { type: 'button', 'data-testid': 'avatar-detail-go' } }), () => actions.onGoMap(part.districtId)));
  }
  if (part.owned && equipped && REMOVABLE_SLOTS.has(part.slot)) buttons.push(onTap(h('button', { class: 'avatar-pill', text: 'はずす', attrs: { type: 'button' } }), () => actions.onUnequip(part)));
  return log.exit(h('section', { class: ['avatar-detail', `avatar-detail--${part.rarity.toLowerCase()}`], attrs: { 'aria-live': 'polite', 'data-testid': 'avatar-detail' } }, [
    h('div', { class: 'avatar-detail__head' }, [
      createRarityTag(part.rarity),
      h('b', { class: 'avatar-detail__name', text: part.name }),
      h('span', { class: ['avatar-detail__status', part.owned ? undefined : 'avatar-detail__status--locked'], text: status }),
    ]),
    h('p', { class: 'avatar-detail__hint' }, [iconText('key', part.owned ? `手に入れ方：${part.hint}` : part.hint)]),
    part.target > 0 ? createProgressBar(part) : undefined,
    buttons.length > 0 ? h('div', { class: 'avatar-detail__actions' }, buttons) : undefined,
  ]));
}

/**
 * 称号の札の一覧を作る（先頭に「なし」）。
 * @param input 格子の入力
 * @param onClear 「なし」を押したとき
 * @returns 要素
 */
export function createTitleList(input: PartListInput, onClear: () => void): HTMLElement {
  const log = logger.fn('createTitleList');
  const titles = input.parts.filter((p) => p.slot === 'title').map((p) => {
    const on = input.outfit.includes(p.id);
    const plate = h('button', {
      class: ['avatar-title', `avatar-title--${p.rarity.toLowerCase()}`, p.owned ? undefined : 'avatar-title--locked', on ? 'avatar-title--on' : undefined, input.tryOnId === p.id ? 'avatar-title--trying' : undefined],
      attrs: { type: 'button', 'aria-pressed': on ? 'true' : 'false', 'data-testid': `avatar-part-${p.id}` },
    }, [createRarityTag(p.rarity), h('b', { text: p.name }), p.owned ? h('small', { text: on ? 'つけています' : p.hint }) : h('small', {}, [iconText('lock', `${remainingTextOf(p)}・${p.hint}`, 13)]), p.isNew ? h('span', { class: 'avatar-badge avatar-badge--new', text: 'NEW' }) : undefined]);
    return onTap(plate, () => input.onPick(p));
  });
  const none = onTap(h('button', { class: ['avatar-title', 'avatar-title--none'], text: '称号をつけない', attrs: { type: 'button' } }), onClear);
  return log.exit(h('div', { class: 'avatar-titles' }, [none, ...titles]));
}

/** ピックアップの入力 */
export interface PickupInput extends PartListInput {
  /** いまの季節（'autumn' など） */
  readonly season: string;
  /** もうすぐ手に入る部品 */
  readonly nearly: readonly AvatarPartDto[];
  readonly onGoMap: (districtId?: string) => void;
}

/**
 * もうすぐ手に入る部品の1行を作る。
 * @param part 部品
 * @param input ピックアップの入力
 * @returns 要素
 */
function createNearlyRow(part: AvatarPartDto, input: PickupInput): HTMLElement {
  const log = logger.fn('createNearlyRow', { id: part.id });
  const tryOn = onTap(h('button', { class: ['avatar-pill', input.tryOnId === part.id ? 'avatar-pill--on' : undefined], text: input.tryOnId === part.id ? '試着中' : '試着', attrs: { type: 'button' } }), () => input.onPick(part));
  const go = onTap(h('button', { class: ['avatar-pill', 'avatar-pill--primary'], text: part.districtId === undefined ? '地図で探す' : '地図で向かう', attrs: { type: 'button' } }), () => input.onGoMap(part.districtId));
  return log.exit(h('li', { class: ['avatar-nearly', `avatar-nearly--${part.rarity.toLowerCase()}`] }, [
    h('span', { class: 'avatar-nearly__art' }, [part.slot === 'title' ? createAvatarIcon('tag', 40) : createPartThumb(part.id, input.preview, 56)]),
    h('div', { class: 'avatar-nearly__body' }, [
      h('div', { class: 'avatar-nearly__head' }, [createRarityTag(part.rarity), h('b', { text: part.name }), h('span', { class: 'avatar-nearly__left', text: remainingTextOf(part) })]),
      h('p', { class: 'avatar-nearly__hint', text: part.hint }),
      createProgressBar(part),
      h('div', { class: 'avatar-nearly__actions' }, [tryOn, go]),
    ]),
  ]));
}

/**
 * ピックアップ（手に入れたばかり・もうすぐ手に入る）を作る。
 * @param input ピックアップの入力
 * @returns 要素
 */
export function createPickup(input: PickupInput): HTMLElement {
  const log = logger.fn('createPickup', { nearly: input.nearly.length });
  const fresh = input.parts.filter((p) => p.isNew && p.slot !== 'title');
  const freshGrid = h('div', { class: 'avatar-grid' }, fresh.map((p, i) => createPartCell(p, input, i)));
  const seasonal = input.parts.filter((p) => !p.owned && p.season === input.season);
  const seasonTitle = 'いまの季節だけ（' + (SEASON_LABEL[input.season] ?? '') + '）';
  return log.exit(h('div', { class: 'avatar-pickup', attrs: { 'data-testid': 'avatar-pickup' } }, [
    fresh.length > 0 ? h('h3', { class: 'avatar-sub' }, [iconText('party', `手に入れたばかり（${fresh.length}）`, 20)]) : undefined,
    fresh.length > 0 ? freshGrid : undefined,
    seasonal.length > 0 ? h('h3', { class: 'avatar-sub' }, [iconText(SEASON_ICON[input.season] ?? 'key', seasonTitle, 20)]) : undefined,
    seasonal.length > 0 ? h('ul', { class: 'avatar-nearly-list' }, seasonal.map((p) => createNearlyRow(p, input))) : undefined,
    h('h3', { class: 'avatar-sub' }, [iconText('key', 'もうすぐ手に入る', 20)]),
    h('ul', { class: 'avatar-nearly-list' }, input.nearly.filter((p) => p.season !== input.season).map((p) => createNearlyRow(p, input))),
  ]));
}

/** マイコーデの操作 */
export interface CoordActions {
  readonly onWear: (coord: AvatarCoordDto) => void;
  readonly onSave: (index: number) => void;
  readonly onDelete: (index: number) => void;
}

/**
 * 小さな丸いボタンを作る。
 * @param text ラベル
 * @param handler 押したとき
 * @param primary 主な操作なら true
 * @returns ボタン
 */
function pill(text: string, handler: () => void, primary = false): HTMLElement {
  return onTap(h('button', { class: ['avatar-pill', primary ? 'avatar-pill--primary' : undefined], text, attrs: { type: 'button' } }), handler);
}

/**
 * マイコーデ（保存した装いの枠）を作る。
 * @param coords マイコーデ
 * @param actions 操作
 * @returns 要素
 */
export function createCoordPanel(coords: readonly AvatarCoordDto[], actions: CoordActions): HTMLElement {
  const log = logger.fn('createCoordPanel', { count: coords.length });
  const cards = coords.map((c) => {
    const saved = c.partIds;
    return h('li', { class: ['avatar-coord', saved === undefined ? 'avatar-coord--empty' : undefined], attrs: { 'data-testid': `avatar-coord-${c.index}` } }, [
      h('b', { class: 'avatar-coord__name', text: `コーデ ${c.index + 1}` }),
      saved === undefined ? h('span', { class: 'avatar-coord__empty', attrs: { 'aria-label': '空き' } }) : h('span', { class: 'avatar-coord__frame' }, [createOutfitThumb(saved, 96)]),
      h('div', { class: 'avatar-coord__actions' }, saved === undefined
        ? [pill('今の服を保存', () => actions.onSave(c.index), true)]
        : [pill('着る', () => actions.onWear(c), true), pill('上書き', () => actions.onSave(c.index)), pill('消す', () => actions.onDelete(c.index))]),
    ]);
  });
  return log.exit(h('div', { class: 'avatar-coords' }, [
    h('ul', { class: 'avatar-coords__list' }, cards),
  ]));
}
