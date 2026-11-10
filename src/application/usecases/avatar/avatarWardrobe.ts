/**
 * @file アバターの着せ替えで共通に使う処理（application 層）
 * - 旅人の訪問記録から通った実績と持っている部品を求める（カード・アイテムは domain/reward の判定を使う。月間リーグの報酬は competition/leagueAwards）
 * - 保存された装いを正規化する（旧来の「手に持つアイテム」だけの保存データは持ち物の初期値に移す）
 * - 手に入れ方の文言を作る（しきい値は domain/avatar/AvatarCatalog の（仮）の値をそのまま使い、文言と判定がずれないようにする）
 */
import { createLogger } from '@/Common/logging/logger';
import type { Season } from '@/Common/utils/date';
import type { AvatarState } from '@/application/ports/AvatarRepository';
import { earnedLeagueRewardIdsOf } from '@/application/usecases/competition/leagueAwards';
import { leagueRewardHintOf } from '@/application/usecases/competition/leagueRewards';
import { lockedItemHintOf } from '@/application/usecases/town/itemHints';
import { DEFAULT_PART_IDS } from '@/domain/avatar/AvatarCatalog';
import type { AvatarUnlock } from '@/domain/avatar/AvatarCatalog';
import { avatarProgressOf, normalizeOutfit, ownedPartIdsOf } from '@/domain/avatar/AvatarUnlockPolicy';
import type { AvatarProgress } from '@/domain/avatar/AvatarUnlockPolicy';
import type { LeagueRecords } from '@/domain/competition/League';
import type { Clock } from '@/domain/ports/Clock';
import { cardsOf } from '@/domain/reward/CardPolicy';
import { RANK_THRESHOLDS } from '@/domain/reward/constants';
import { ITEM_DEFINITIONS, itemsOf } from '@/domain/reward/ItemPolicy';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/avatar/avatarWardrobe');

/** 旧来の「手に持つアイテム」→ 持ち物の部品 */
const LEGACY_HELD: Readonly<Record<string, string>> = { i_chochin: 'held.chochin', i_nobori: 'held.nobori', i_matsu: 'held.matsu' };

/** 通った実績と、持っている部品 */
export interface Wardrobe {
  readonly progress: AvatarProgress;
  readonly owned: ReadonlySet<string>;
}

/**
 * 旅人の記録から、通った実績と持っている部品を求める。
 * @param records 旅人の記録（訪問・発見）
 * @param spots マスタ参照（地区・スポット・イベント）
 * @param clock 時計（月間リーグの報酬は、締めた月の順位といままでのキープで決まる）
 * @param exp 累計 EXP（台帳の残高。EXP の特典＝ランク画面の「特典」の判定に使う）
 * @returns 実績と持っている部品
 */
export function wardrobeOf(records: LeagueRecords, spots: SpotRepository, clock: Pick<Clock, 'today' | 'now'>, exp: number): Wardrobe {
  const { visits } = records;
  const log = logger.fn('wardrobeOf', { visits: visits.length, exp });
  const cards = spots.allDistricts().flatMap((d) => cardsOf(visits, d.id));
  const items = itemsOf({ visits, spots: spots.allSpots(), shopEvents: spots.allShopEvents() });
  const progress = avatarProgressOf({
    visits,
    silverCards: cards.filter((c) => c.rank === 'silver').length,
    goldCards: cards.filter((c) => c.rank === 'gold').length,
    itemIds: items.map((i) => i.itemId),
    leagueRewardIds: [...earnedLeagueRewardIdsOf(records, clock.today(), clock.now())],
    exp,
  });
  return log.exit({ progress, owned: ownedPartIdsOf(progress) });
}

/**
 * 保存された装いを、持っている部品だけの装いにする（未保存なら既定＋旧来の持ち物）。
 * @param state 保存された装い
 * @param owned 持っている部品
 * @returns 正規化した装い
 */
export function outfitOfState(state: AvatarState, owned: ReadonlySet<string>): readonly string[] {
  const log = logger.fn('outfitOfState', { saved: state.partIds?.length, heldItemId: state.heldItemId });
  if (state.partIds !== undefined) return log.exit(normalizeOutfit(state.partIds, owned));
  const legacy = state.heldItemId === undefined ? undefined : LEGACY_HELD[state.heldItemId];
  return log.exit(normalizeOutfit(legacy === undefined ? DEFAULT_PART_IDS : [...DEFAULT_PART_IDS, legacy], owned));
}

/** 季節の名前 */
export const SEASON_NAME: Readonly<Record<Season, string>> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

/** 手に入れ方 → 進み具合の単位 */
const UNIT_OF: Readonly<Record<AvatarUnlock['kind'], string>> = {
  free: '', seasonVisits: '回', totalVisits: '回', visitDays: '日', districtVisits: '回', districts: '地区', shops: '軒', landmarks: 'か所', silverCards: '枚', goldCards: '枚', item: '', league: '', exp: 'EXP',
};

/**
 * 進み具合の単位を返す。
 * @param unlock 手に入れ方
 * @returns 単位（数えないものは ''）
 */
export function unlockUnitOf(unlock: AvatarUnlock): string {
  return UNIT_OF[unlock.kind];
}

/**
 * 手に入れ方の文言を作る。
 * @param unlock 手に入れ方
 * @param districtName 地区ID → 地区の短い名前
 * @returns 文言
 */
export function unlockHintOf(unlock: AvatarUnlock, districtName: (id: string) => string): string {
  const log = logger.fn('unlockHintOf', { kind: unlock.kind });
  switch (unlock.kind) {
    case 'free': return log.exit('はじめから持っている');
    case 'totalVisits': return log.exit(`どこかに合計${unlock.count}回通う`);
    case 'visitDays': return log.exit(`ちがう日に${unlock.count}日、街に通う`);
    case 'districtVisits': return log.exit(`${districtName(unlock.districtId)}に${unlock.count}回通う`);
    case 'districts': return log.exit(`${unlock.count}つの地区を訪れる`);
    case 'shops': return log.exit(`ちがうお店を${unlock.count}軒訪れる`);
    case 'landmarks': return log.exit(`ちがう名所を${unlock.count}か所訪れる`);
    case 'silverCards': return log.exit(`銀カードを${unlock.count}枚あつめる`);
    case 'goldCards': return log.exit(`金カードを${unlock.count}枚あつめる`);
    case 'seasonVisits': {
      const where = unlock.districtId === undefined ? '' : `${districtName(unlock.districtId)}に`;
      return log.exit(`${SEASON_NAME[unlock.season]}に${where}${unlock.count}回${unlock.districtId === undefined ? '通う' : '訪れる'}`);
    }
    case 'league': return log.exit(leagueRewardHintOf(unlock.rewardId));
    case 'exp': {
      const rank = RANK_THRESHOLDS.find((t) => t.min === unlock.points);
      return log.exit(rank === undefined ? `EXPを${unlock.points}ためる` : `ランク「${rank.name}」になる`);
    }
    case 'item': {
      const key = ITEM_DEFINITIONS.find((d) => d.rawId === unlock.itemId)?.key;
      return log.exit(key === undefined ? '訪問で手に入るアイテム' : lockedItemHintOf(key));
    }
  }
}
