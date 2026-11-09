/**
 * @file アバター画面の表示モデル（presentation/screens/Avatar 層。純粋関数）
 * カテゴリ（タブ）の定義、装いの付け外し（1枠1つ・置くものは最大3つ）、試着、ピックアップ（NEW・もうすぐ手に入る）、おまかせを扱う。
 * 状態・DOM は持たない（docs/03 §7）。持っているかの最終判定は application（SaveAvatarUseCase）が行う。
 */
import type { AvatarPartDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/screens/Avatar/avatarScreenModel');

/** 置くものの最大数（domain/avatar/AvatarCatalog の MAX_OBJECTS と同じ。保存時は application が正規化する） */
export const MAX_STAGE_OBJECTS = 3;

/** はずせる枠（何も着けない状態にできる） */
export const REMOVABLE_SLOTS: ReadonlySet<string> = new Set(['hat', 'accessory', 'pet', 'object', 'title', 'aura', 'emote']);

/** サムネイルで切り出すところ */
export type ThumbFocus = 'head' | 'body' | 'legs' | 'full';

/** カテゴリ（タブ）のキー */
export type CategoryKey = 'pickup' | 'collection' | 'hair' | 'face' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory' | 'held' | 'pet' | 'aura' | 'emote' | 'background' | 'object' | 'title' | 'coord';

/** カテゴリの定義 */
export interface CategoryDef {
  readonly key: CategoryKey;
  readonly label: string;
  /** 格子に並べる部品の枠 */
  readonly gridSlot?: string;
  /** 格子の上に色のチップで並べる枠 */
  readonly chipSlot?: string;
  /** チップの見出し */
  readonly chipLabel?: string;
  /** 格子の上に小さく並べる別の枠（顔のタブの性別など） */
  readonly topSlot?: string;
  /** topSlot の見出し */
  readonly topLabel?: string;
  readonly focus: ThumbFocus;
}

/** カテゴリ（タブの並び） */
export const CATEGORIES: readonly CategoryDef[] = Object.freeze([
  { key: 'pickup', label: 'ピックアップ', focus: 'full' },
  { key: 'collection', label: 'コレクション', focus: 'full' },
  { key: 'hair', label: '髪型', gridSlot: 'hair', chipSlot: 'hairColor', chipLabel: '髪の色', focus: 'head' },
  { key: 'face', label: '顔', gridSlot: 'eyes', chipSlot: 'skin', chipLabel: 'はだの色', topSlot: 'body', topLabel: '性別', focus: 'head' },
  { key: 'top', label: 'トップス', gridSlot: 'top', chipSlot: 'topColor', chipLabel: '服の色', focus: 'body' },
  { key: 'bottom', label: 'ボトムス', gridSlot: 'bottom', focus: 'legs' },
  { key: 'shoes', label: 'くつ', gridSlot: 'shoes', focus: 'legs' },
  { key: 'hat', label: '帽子', gridSlot: 'hat', focus: 'head' },
  { key: 'accessory', label: 'アクセ', gridSlot: 'accessory', focus: 'full' },
  { key: 'held', label: '持ち物', gridSlot: 'held', focus: 'full' },
  { key: 'pet', label: '相棒', gridSlot: 'pet', focus: 'full' },
  { key: 'emote', label: 'エモート', gridSlot: 'emote', focus: 'full' },
  { key: 'aura', label: 'オーラ', gridSlot: 'aura', focus: 'full' },
  { key: 'background', label: '背景', gridSlot: 'background', focus: 'full' },
  { key: 'object', label: 'オブジェ', gridSlot: 'object', focus: 'full' },
  { key: 'title', label: '称号', gridSlot: 'title', focus: 'full' },
  { key: 'coord', label: 'マイコーデ', focus: 'full' },
] as const);

/**
 * 部品ID の枠を返す。
 * @param partId 部品ID（'<枠>.<種類>'）
 * @returns 枠
 */
export function slotOfPartId(partId: string): string {
  return partId.split('.')[0] ?? '';
}

/**
 * 枠の部品を表示順に返す。
 * @param parts すべての部品
 * @param slot 枠
 * @returns その枠の部品
 */
export function partsOfSlot(parts: readonly AvatarPartDto[], slot: string): AvatarPartDto[] {
  return parts.filter((p) => p.slot === slot);
}

/** 付け外しの結果 */
export interface EquipResult {
  readonly outfit: readonly string[];
  /** 置くものがいっぱいで入れ替えた部品 */
  readonly replaced?: string;
}

/**
 * 部品を身につける（1枠1つ。置くものは最大 MAX_STAGE_OBJECTS で、いっぱいなら一番古いものと入れ替える）。
 * @param outfit いまの装い
 * @param partId 身につける部品
 * @returns 新しい装い
 */
export function equipPart(outfit: readonly string[], partId: string): EquipResult {
  const log = logger.fn('equipPart', { partId });
  const slot = slotOfPartId(partId);
  if (outfit.includes(partId)) return log.exit({ outfit });
  if (slot !== 'object') return log.exit({ outfit: [...outfit.filter((id) => slotOfPartId(id) !== slot), partId] });
  const objects = outfit.filter((id) => slotOfPartId(id) === 'object');
  if (objects.length < MAX_STAGE_OBJECTS) return log.exit({ outfit: [...outfit, partId] });
  const replaced = objects[0];
  return log.exit({ outfit: [...outfit.filter((id) => id !== replaced), partId], replaced });
}

/**
 * 部品をはずす（はずせない枠なら何もしない）。
 * @param outfit いまの装い
 * @param partId はずす部品
 * @returns 新しい装い
 */
export function unequipPart(outfit: readonly string[], partId: string): readonly string[] {
  const log = logger.fn('unequipPart', { partId });
  if (!REMOVABLE_SLOTS.has(slotOfPartId(partId))) return log.exit(outfit);
  return log.exit(outfit.filter((id) => id !== partId));
}

/**
 * 枠の部品をすべてはずす。
 * @param outfit いまの装い
 * @param slot 枠
 * @returns 新しい装い
 */
export function clearSlot(outfit: readonly string[], slot: string): readonly string[] {
  const log = logger.fn('clearSlot', { slot });
  if (!REMOVABLE_SLOTS.has(slot)) return log.exit(outfit);
  return log.exit(outfit.filter((id) => slotOfPartId(id) !== slot));
}

/**
 * 試着している部品を重ねた装い（見た目だけ。保存しない）。
 * @param outfit 保存している装い
 * @param tryOnId 試着している部品
 * @returns 表示用の装い
 */
export function withTryOn(outfit: readonly string[], tryOnId: string | undefined): readonly string[] {
  const log = logger.fn('withTryOn', { tryOnId });
  return log.exit(tryOnId === undefined ? outfit : equipPart(outfit, tryOnId).outfit);
}

/**
 * セットの部品をまとめて重ねた装い（試着・着る）。
 * @param outfit もとの装い
 * @param partIds セットの部品
 * @returns 新しい装い
 */
export function withSet(outfit: readonly string[], partIds: readonly string[]): readonly string[] {
  const log = logger.fn('withSet', { count: partIds.length });
  return log.exit(partIds.reduce<readonly string[]>((acc, id) => equipPart(acc, id).outfit, outfit));
}

/**
 * 2つの装いが同じか（並びは問わない）。
 * @param a 装い
 * @param b 装い
 * @returns 同じなら true
 */
export function sameOutfit(a: readonly string[], b: readonly string[]): boolean {
  const log = logger.fn('sameOutfit', { a: a.length, b: b.length });
  return log.exit(a.length === b.length && a.every((id) => b.includes(id)));
}

/**
 * まだ手に入れていない部品を、手に入るのが近い順に返す（残りが少ない順 → 進み具合の大きい順）。
 * @param parts すべての部品
 * @param limit 最大数
 * @returns もうすぐ手に入る部品
 */
export function nearlyUnlockedOf(parts: readonly AvatarPartDto[], limit: number): AvatarPartDto[] {
  const log = logger.fn('nearlyUnlockedOf', { limit });
  const locked = parts.filter((p) => !p.owned && p.target > 0);
  const sorted = [...locked].sort((a, b) => (a.target - a.current) - (b.target - b.current) || b.current / b.target - a.current / a.target);
  return log.exit(sorted.slice(0, limit));
}

/**
 * 枠ごとの NEW の数。
 * @param parts すべての部品
 * @param slots 数える枠
 * @returns NEW の数
 */
export function newCountOf(parts: readonly AvatarPartDto[], slots: readonly (string | undefined)[]): number {
  const log = logger.fn('newCountOf', { slots: slots.length });
  return log.exit(parts.filter((p) => p.isNew && slots.includes(p.slot)).length);
}

/**
 * カテゴリに含まれる枠。
 * @param category カテゴリ
 * @returns 枠（ピックアップ・マイコーデは空）
 */
export function slotsOfCategory(category: CategoryDef): string[] {
  return [category.topSlot, category.gridSlot, category.chipSlot].filter((s): s is string => s !== undefined);
}

/**
 * おまかせの装いを作る（必須の枠は持っている部品から1つ、はずせる枠は半分の確率で1つ、置くものは0〜2つ）。性別はいまのままにする。
 * @param parts すべての部品
 * @param random 0 以上 1 未満の乱数を返す関数
 * @param current いまの装い（性別を引き継ぐ）
 * @returns 装い
 */
export function randomOutfitOf(parts: readonly AvatarPartDto[], random: () => number, current: readonly string[] = []): string[] {
  const log = logger.fn('randomOutfitOf', { parts: parts.length });
  const owned = parts.filter((p) => p.owned);
  const slots = [...new Set(owned.map((p) => p.slot))].filter((slot) => slot !== 'body');
  /**
   * 候補から1つ選ぶ。
   * @param list 候補
   * @returns 選んだ部品ID
   */
  const pick = (list: readonly AvatarPartDto[]): string | undefined => list[Math.floor(random() * list.length)]?.id; // audit-ignore: fnlog-missing 枠ごとに呼ぶ1行の選択
  const outfit: string[] = current.filter((id) => slotOfPartId(id) === 'body');
  for (const slot of slots) {
    const list = owned.filter((p) => p.slot === slot);
    const count = slot === 'object' ? Math.floor(random() * 3) : REMOVABLE_SLOTS.has(slot) && random() < 0.5 ? 0 : 1;
    for (let i = 0; i < count; i += 1) {
      const id = pick(list.filter((p) => !outfit.includes(p.id)));
      if (id !== undefined) outfit.push(id);
    }
  }
  return log.exit(outfit);
}

/**
 * 進み具合の文言（「あと2回」など）。
 * @param part 部品
 * @returns 文言（持っている・はじめからなら空）
 */
export function remainingTextOf(part: AvatarPartDto): string {
  const log = logger.fn('remainingTextOf', { id: part.id });
  if (part.owned || part.target <= 0) return log.exit('');
  return log.exit(part.unit === '' ? 'もうすこし' : `あと${part.target - part.current}${part.unit}`);
}
