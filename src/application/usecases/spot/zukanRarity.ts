/**
 * @file 図鑑カードのレア度と取得方法（application 層の共通部品）
 * domain/spot/SpotRarity の判定に、画面で出す文言（レア度名・取得方法の手順・短い入手条件）を添える。
 * 未発見のカードにもレア度と取得方法を出す（名前・位置・カテゴリは出さない＝B。「何かすごいものが眠っている」と伝える）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { Season } from '@/Common/utils/date';
import type { RarityDto, ZukanTileDto } from '@/application/dto/Dto';
import { DISCOVERY_RADIUS_M, VISIT_RADIUS_M } from '@/domain/exploration/constants';
import type { Spot } from '@/domain/spot/Spot';
import { isAwakened, rarityOf } from '@/domain/spot/SpotRarity';
import type { Rarity } from '@/domain/spot/SpotRarity';

const logger = createLogger('application/usecases/spot/zukanRarity');

/** レア度の名前（仮） */
export const RARITY_NAMES: Readonly<Record<Rarity, string>> = Object.freeze({ 1: 'ノーマル', 2: 'レア', 3: 'スーパーレア', 4: 'レジェンド' });

/** タイルに足すレア度の項目 */
export type RarityFields = Pick<ZukanTileDto, 'rarity' | 'rarityName' | 'acquisitionShort' | 'acquisitionSteps' | 'awakened'>;

/**
 * 取得方法の手順を作る（見つける → 訪れる → レア度ごとの特別な条件）。
 * @param rarity レア度
 * @returns 手順の文言（凍結済み）
 */
function acquisitionStepsOf(rarity: Rarity): readonly string[] {
  const log = logger.fn('acquisitionStepsOf', { rarity });
  const steps = [`${DISCOVERY_RADIUS_M}m以内に近づいて「発見」`, `${VISIT_RADIUS_M}m以内で「達成」するとカード入手`];
  if (rarity === 2) steps.push('協力店なので店頭のQRでも達成できます');
  if (rarity === 3) steps.push('名所カード。通うほど★が増え、なじみ→常連へ育ちます');
  if (rarity === 4) steps.push('地区の象徴。春・夏・秋・冬それぞれで達成すると「極」に覚醒します');
  return log.exit(Object.freeze(steps));
}

/**
 * 短い入手条件（カードの下に出す1行）。
 * @param rarity レア度
 * @returns 文言
 */
function acquisitionShortOf(rarity: Rarity): string {
  const log = logger.fn('acquisitionShortOf', { rarity });
  if (rarity === 4) return log.exit('達成で入手・四季で覚醒');
  if (rarity === 2) return log.exit('達成 or 店頭QR');
  return log.exit('達成で入手');
}

/**
 * スポットのレア度の項目を作る。
 * @param spot スポット
 * @param legendIds 地区の象徴の名所の ID（legendSpotIdsOf）
 * @param seasons 訪れた季節（訪問済みのみ。覚醒の判定に使う）
 * @returns RarityFields
 */
export function rarityFieldsOf(spot: Spot, legendIds: ReadonlySet<string>, seasons: readonly Season[] = []): RarityFields {
  const log = logger.fn('rarityFieldsOf', { spotId: spot.id });
  const rarity = rarityOf(spot, legendIds);
  return log.exit({
    rarity: rarity as RarityDto,
    rarityName: RARITY_NAMES[rarity],
    acquisitionShort: acquisitionShortOf(rarity),
    acquisitionSteps: acquisitionStepsOf(rarity),
    awakened: isAwakened(rarity, seasons),
  });
}

/**
 * 作ったタイルにレア度の項目を足す。
 * @param tile タイル
 * @param spot スポット
 * @param legendIds 地区の象徴の名所の ID
 * @returns レア度つきのタイル（凍結済み）
 */
export function withRarity(tile: ZukanTileDto, spot: Spot, legendIds: ReadonlySet<string>): ZukanTileDto {
  const log = logger.fn('withRarity', { spotId: spot.id, status: tile.status });
  return log.exit(Object.freeze({ ...tile, ...rarityFieldsOf(spot, legendIds, (tile.seasons ?? []) as readonly Season[]) }));
}
