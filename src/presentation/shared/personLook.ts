/**
 * @file ほかの旅人のアバターの装い（presentation/shared）
 * 地図のほかの旅人（Map/mapPeople）とランキングの参加者で、同じ人が同じ見た目になるように、人ごとのキーから装いを決める。
 * 服の色・帽子・持ち物・ねこはキーのハッシュで固定。地区の主は王冠をかぶる。
 */
import { createLogger } from '@/Common/logging/logger';
import { hashString } from '@/Common/ui/canvas/seededHash';
import { PALETTE } from '@/Common/ui/theme/palette';
import type { AvatarLook } from '@/presentation/shared/avatarSprite';

const logger = createLogger('presentation/shared/personLook');

/** ほかの旅人の色（人ごとに固定。地区色と混ざらない濃いめの色） */
export const PERSON_COLORS: readonly string[] = ['#4338ca', '#0369a1', '#047857', '#b45309', '#be185d', '#6d28d9', '#0f766e'];
/** ほかの旅人の帽子（地区の主は王冠） */
const PERSON_HATS: readonly (AvatarLook['hat'])[] = ['beret', 'straw', undefined];
/** ほかの旅人が手に持つもの */
const PERSON_HELD: readonly AvatarLook['held'][] = ['camera', 'chochin', 'nobori', 'matsu'];

/**
 * 人ごとの色を返す。
 * @param personId 人ごとのキー（模擬ライバルはライバルID）
 * @returns '#rrggbb'
 */
export function personColorOfId(personId: string): string { // audit-ignore: fnlog-missing 地図の毎フレーム描画で呼ぶ純粋なヘルパー
  return PERSON_COLORS[hashString(personId) % PERSON_COLORS.length] ?? PALETTE.ink;
}

/**
 * 人ごとのキーからアバターの装いを決める。
 * @param personId 人ごとのキー（模擬ライバルはライバルID）
 * @param isLord 地区の主か（王冠をかぶる）
 * @returns 装い
 */
export function personLookOf(personId: string, isLord: boolean): AvatarLook {
  const log = logger.fn('personLookOf', { personId, isLord });
  const seed = hashString(personId);
  const hat = isLord ? 'crown' : PERSON_HATS[seed % PERSON_HATS.length];
  const held = PERSON_HELD[Math.floor(seed / 3) % PERSON_HELD.length] ?? 'camera';
  return log.exit({ hat, outfitColor: personColorOfId(personId), held, hasCat: Math.floor(seed / 12) % 3 === 0 });
}
