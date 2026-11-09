/**
 * @file アイテム獲得の判定（domain/reward 層の純粋関数・Could 機能）
 * 訪問記録から導出し保存しない（docs/08 D16、D4）。追記専用の記録から毎回求めるので、一度得たアイテムは失われない。
 * - 提灯（i_chochin）: イベント（kind='event'）の期間中に、そのイベントのスポットを訪問
 * - のぼり（i_nobori）: 異なる店舗を NOBORI_DISTINCT_SHOPS 軒訪問
 * - 松（i_matsu）: 名所を MATSU_LANDMARK_DISTRICTS 地区で訪問
 * earnedOn は条件を満たした訪問の暦日。
 */
import { createLogger } from '@/Common/logging/logger';
import { parseItemId, spotKindOfId } from '@/Common/types/Id';
import type { DistrictId, ItemId, SpotId } from '@/Common/types/Id';
import { invariant } from '@/Common/utils/assert';
import type { LocalDate } from '@/Common/utils/date';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { isActive } from '@/domain/revisit/ShopEvent';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import { MATSU_LANDMARK_DISTRICTS, NOBORI_DISTINCT_SHOPS } from '@/domain/reward/constants';
import { sortVisitsChronologically } from '@/domain/reward/VisitChronology';
import type { Spot, SpotKind } from '@/domain/spot/Spot';

const logger = createLogger('domain/reward/ItemPolicy');

/** しきい値は reward/constants.ts の（仮）定数。既存の import 先を変えないためここからも再 export する */
export { MATSU_LANDMARK_DISTRICTS, NOBORI_DISTINCT_SHOPS } from '@/domain/reward/constants';

/** アイテムの定義（ID の元の文字列と表示名） */
export const ITEM_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'chochin', rawId: 'i_chochin', name: '提灯' }),
  Object.freeze({ key: 'nobori', rawId: 'i_nobori', name: 'のぼり' }),
  Object.freeze({ key: 'matsu', rawId: 'i_matsu', name: '松' }),
] as const);

/** アイテムの種類 */
export type ItemKey = (typeof ITEM_DEFINITIONS)[number]['key'];

/** 獲得済みアイテム */
export interface EarnedItem {
  readonly itemId: ItemId;
  readonly name: string;
  /** 条件を満たした訪問の暦日 */
  readonly earnedOn: LocalDate;
}

/** itemsOf の入力 */
export interface ItemsInput {
  /** 訪問記録（全地区・順不同でよい） */
  readonly visits: readonly VisitRecord[];
  /** スポットのマスタ（種別の判定に使う。マスタに無いスポットは ID の接頭辞で判定する） */
  readonly spots: readonly Spot[];
  /** クーポン・イベントのマスタ */
  readonly shopEvents: readonly ShopEvent[];
}

/**
 * 定義の ID 文字列を ItemId にする。定義は固定値なので、失敗はプログラムの誤り（バグ）として扱う。
 * @param rawId 'i_xxx' 形式の ID 文字列
 * @returns ItemId
 * @throws Error 定義の ID が正規表現に合わない（バグ）
 */
function itemIdOf(rawId: string): ItemId {
  const log = logger.fn('itemIdOf', { rawId });
  const parsed = parseItemId(rawId);
  invariant(parsed.ok, `ItemPolicy: アイテムID の定義が不正 (${rawId})`);
  return log.exit(parsed.value);
}

/**
 * アイテムの種類から獲得済みアイテムを作る。
 * @param key アイテムの種類
 * @param earnedOn 条件を満たした暦日
 * @returns 凍結済みの獲得済みアイテム
 */
function earnedItem(key: ItemKey, earnedOn: LocalDate): EarnedItem {
  const log = logger.fn('earnedItem', { key, earnedOn });
  const definition = ITEM_DEFINITIONS.find((d) => d.key === key);
  invariant(definition !== undefined, `ItemPolicy: 未定義のアイテム (${key})`);
  return log.exit(Object.freeze({ itemId: itemIdOf(definition.rawId), name: definition.name, earnedOn }));
}

/**
 * 提灯の獲得日を返す: イベント（kind='event'）の期間中に、そのイベントのスポットを訪問した最初の日。
 * @param sorted 古い順の訪問記録
 * @param shopEvents クーポン・イベント
 * @returns 獲得日。未獲得なら undefined
 */
function chochinEarnedOn(sorted: readonly VisitRecord[], shopEvents: readonly ShopEvent[]): LocalDate | undefined {
  const log = logger.fn('chochinEarnedOn', { visits: sorted.length, shopEvents: shopEvents.length });
  const events = shopEvents.filter((e) => e.kind === 'event');
  const hit = sorted.find((v) => events.some((e) => e.spotId === v.spotId && isActive(e, v.localDate)));
  return log.exit(hit?.localDate);
}

/**
 * 条件に合う訪問の「異なるキー」の数が threshold に届いた訪問の暦日を返す。
 * @param sorted 古い順の訪問記録（条件に合うものだけ）
 * @param keyOf 数える単位（店舗ID・地区ID など）
 * @param threshold 必要な種類数（1 以上）
 * @returns 届いた日。届かなければ undefined
 */
function distinctReachedOn(
  sorted: readonly VisitRecord[],
  keyOf: (visit: VisitRecord) => SpotId | DistrictId,
  threshold: number,
): LocalDate | undefined {
  const log = logger.fn('distinctReachedOn', { visits: sorted.length, threshold });
  const seen = new Set<string>();
  for (const visit of sorted) {
    seen.add(keyOf(visit));
    if (seen.size >= threshold) return log.exit(visit.localDate);
  }
  return log.exit(undefined, `種類数 ${seen.size}`);
}

/**
 * スポット種別を引く関数を作る。マスタに無いスポットは ID の接頭辞（l_=名所, s_=店舗）で判定する。
 * マスタからスポットが消えても、獲得済みのアイテムが消えないようにするため（CLAUDE.md 5「失う体験を作らない」）。
 * @param spots スポットのマスタ
 * @returns スポットID → 種別
 */
function kindLookup(spots: readonly Spot[]): (spotId: SpotId) => SpotKind {
  const log = logger.fn('kindLookup', { spots: spots.length });
  const kinds = new Map<SpotId, SpotKind>(spots.map((s) => [s.id, s.kind]));
  return log.exit((spotId: SpotId): SpotKind => kinds.get(spotId) ?? spotKindOfId(spotId));
}

/**
 * 訪問記録から獲得済みアイテムを返す（定義順: 提灯→のぼり→松。各1個まで）。
 * @param input 訪問記録・スポット・クーポン・イベント
 * @returns 獲得済みアイテム（凍結済み）。無ければ空配列
 */
export function itemsOf(input: ItemsInput): EarnedItem[] {
  const log = logger.fn('itemsOf', { visits: input.visits.length, spots: input.spots.length, shopEvents: input.shopEvents.length });
  const sorted = sortVisitsChronologically(input.visits);
  const kindOf = kindLookup(input.spots);
  const shops = sorted.filter((v) => kindOf(v.spotId) === 'shop');
  const landmarks = sorted.filter((v) => kindOf(v.spotId) === 'landmark');
  const earnedOn: Readonly<Record<ItemKey, LocalDate | undefined>> = {
    chochin: chochinEarnedOn(sorted, input.shopEvents),
    nobori: distinctReachedOn(shops, (v) => v.spotId, NOBORI_DISTINCT_SHOPS),
    matsu: distinctReachedOn(landmarks, (v) => v.districtId, MATSU_LANDMARK_DISTRICTS),
  };
  const items: EarnedItem[] = [];
  for (const definition of ITEM_DEFINITIONS) {
    const on = earnedOn[definition.key];
    if (on !== undefined) items.push(earnedItem(definition.key, on));
  }
  return log.exit(items);
}

/**
 * 訪問の前後のアイテムを比べ、新しく獲得したアイテムを返す（ItemAcquired 発行用）。
 * @param before 訪問前に獲得済みのアイテム
 * @param after 訪問後に獲得済みのアイテム
 * @returns after にあって before に無いアイテム
 */
export function newlyAcquiredItems(before: readonly EarnedItem[], after: readonly EarnedItem[]): EarnedItem[] {
  const log = logger.fn('newlyAcquiredItems', { before: before.length, after: after.length });
  const had = new Set<string>(before.map((i) => i.itemId));
  return log.exit(after.filter((i) => !had.has(i.itemId)));
}

/** アイテム判定をまとめた名前空間（`ItemPolicy.itemsOf(...)` と書ける） */
export const ItemPolicy = Object.freeze({ itemsOf, newlyAcquiredItems });
