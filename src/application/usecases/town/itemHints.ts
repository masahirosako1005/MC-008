/**
 * @file まだ持っていないアイテムの「手に入れ方」の文言（application 層）
 * 条件は domain/reward/ItemPolicy と同じ（しきい値は reward/constants の（仮）定数をそのまま使い、文言と判定がずれないようにする）。
 */
import { createLogger } from '@/Common/logging/logger';
import { MATSU_LANDMARK_DISTRICTS, NOBORI_DISTINCT_SHOPS } from '@/domain/reward/constants';
import type { ItemKey } from '@/domain/reward/ItemPolicy';

const logger = createLogger('application/usecases/town/itemHints');

/**
 * アイテムの手に入れ方を返す。
 * @param key アイテムの種類
 * @returns 文言
 */
export function lockedItemHintOf(key: ItemKey): string {
  const log = logger.fn('lockedItemHintOf', { key });
  const hints: Readonly<Record<ItemKey, string>> = {
    chochin: '期間限定イベントの開催中に、そのスポットを訪れる',
    nobori: `ちがうお店を${NOBORI_DISTINCT_SHOPS}軒訪れる`,
    matsu: `${MATSU_LANDMARK_DISTRICTS}つの地区で名所を訪れる`,
  };
  return log.exit(hints[key]);
}
