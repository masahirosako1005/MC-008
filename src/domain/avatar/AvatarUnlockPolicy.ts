/**
 * @file アバターの部品の手に入れ方の判定と、装いの正規化（domain/avatar 層の純粋関数）
 * 実績（AvatarProgress）は追記専用の訪問記録から毎回求めるので、一度手に入れた部品は失われない（CLAUDE.md 5 章）。
 * 装いは「持っている部品だけ・1枠1つ・置くものは最大3つ・必須の枠は既定で埋める」にそろえる（保存データや入力を信用しない＝DI-01, SEC-16）。
 */
import { createLogger } from '@/Common/logging/logger';
import { spotKindOfId } from '@/Common/types/Id';
import { seasonOf } from '@/Common/utils/date';
import type { Season } from '@/Common/utils/date';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { AVATAR_CATALOG, AVATAR_SLOTS, DEFAULT_PART_IDS, MAX_OBJECTS, OPTIONAL_SLOTS, avatarPartOf } from '@/domain/avatar/AvatarCatalog';
import type { AvatarPartDef, AvatarSlot, AvatarUnlock } from '@/domain/avatar/AvatarCatalog';

const logger = createLogger('domain/avatar/AvatarUnlockPolicy');

/** 通った実績（部品の手に入れ方の判定に使う。どれも減らない） */
export interface AvatarProgress {
  readonly totalVisits: number;
  /** 通った日数（同じ暦日の訪問は1日） */
  readonly visitDays: number;
  /** 地区ID → 通った回数 */
  readonly districtVisits: ReadonlyMap<string, number>;
  /** 訪れた地区の数 */
  readonly districts: number;
  /** 訪れたちがうお店の数 */
  readonly shops: number;
  /** 訪れたちがう名所の数 */
  readonly landmarks: number;
  readonly silverCards: number;
  readonly goldCards: number;
  /** 手に入れたアイテムID（domain/reward/ItemPolicy） */
  readonly itemIds: ReadonlySet<string>;
  /** 季節（と地区）ごとに通った回数。キーは 'spring' や 'spring:d_okawa' */
  readonly seasonVisits: ReadonlyMap<string, number>;
  /** 手に入れた月間リーグの報酬ID（domain/competition/LeagueReward） */
  readonly leagueRewardIds: ReadonlySet<string>;
  /** 累計 EXP（台帳の残高。0 以上の整数） */
  readonly exp: number;
}

/**
 * 季節ごとの回数のキーを作る。
 * @param season 季節
 * @param districtId 地区ID（省略で全地区）
 * @returns キー
 */
export function seasonKeyOf(season: Season, districtId?: string): string {
  return districtId === undefined ? season : `${season}:${districtId}`;
}

/** avatarProgressOf の入力 */
export interface AvatarProgressInput {
  readonly visits: readonly VisitRecord[];
  readonly silverCards: number;
  readonly goldCards: number;
  readonly itemIds: readonly string[];
  /** 手に入れた月間リーグの報酬ID（省略時はなし） */
  readonly leagueRewardIds?: readonly string[];
  /** 累計 EXP（台帳の残高。省略・非数・負値は 0、小数は切り捨て） */
  readonly exp?: number;
}

/** 部品1つの進み具合 */
export interface PartProgress {
  readonly unlocked: boolean;
  /** いまの値（目標を超えたら目標で止める） */
  readonly current: number;
  /** 目標の値（はじめから持っている部品は 0） */
  readonly target: number;
}

/**
 * 訪問記録とカード・アイテムの数・累計 EXP から、通った実績を求める。
 * @param input 訪問記録・カードの枚数・アイテム・月間リーグの報酬・累計 EXP
 * @returns 実績（凍結済み）
 */
export function avatarProgressOf(input: AvatarProgressInput): AvatarProgress {
  const log = logger.fn('avatarProgressOf', { visits: input.visits.length });
  const districtVisits = new Map<string, number>();
  const days = new Set<string>();
  const shops = new Set<string>();
  const landmarks = new Set<string>();
  const seasonVisits = new Map<string, number>();
  for (const v of input.visits) {
    districtVisits.set(v.districtId, (districtVisits.get(v.districtId) ?? 0) + 1);
    const season = seasonOf(v.localDate);
    for (const key of [seasonKeyOf(season), seasonKeyOf(season, v.districtId)]) seasonVisits.set(key, (seasonVisits.get(key) ?? 0) + 1);
    days.add(v.localDate);
    (spotKindOfId(v.spotId) === 'landmark' ? landmarks : shops).add(v.spotId);
  }
  return log.exit(Object.freeze({
    totalVisits: input.visits.length,
    visitDays: days.size,
    districtVisits,
    districts: districtVisits.size,
    shops: shops.size,
    landmarks: landmarks.size,
    silverCards: input.silverCards,
    goldCards: input.goldCards,
    itemIds: new Set(input.itemIds),
    seasonVisits,
    leagueRewardIds: new Set(input.leagueRewardIds ?? []),
    exp: input.exp !== undefined && Number.isFinite(input.exp) && input.exp > 0 ? Math.floor(input.exp) : 0,
  }));
}

/**
 * 手に入れ方に対する、いまの値と目標の値。
 * @param unlock 手に入れ方
 * @param p 実績
 * @returns [いまの値, 目標の値]
 */
function valuesOf(unlock: AvatarUnlock, p: AvatarProgress): readonly [number, number] { // audit-ignore: fnlog-missing 部品の数だけ呼ぶ純粋な対応表
  switch (unlock.kind) {
    case 'free': return [0, 0];
    case 'totalVisits': return [p.totalVisits, unlock.count];
    case 'visitDays': return [p.visitDays, unlock.count];
    case 'districtVisits': return [p.districtVisits.get(unlock.districtId) ?? 0, unlock.count];
    case 'districts': return [p.districts, unlock.count];
    case 'shops': return [p.shops, unlock.count];
    case 'landmarks': return [p.landmarks, unlock.count];
    case 'silverCards': return [p.silverCards, unlock.count];
    case 'goldCards': return [p.goldCards, unlock.count];
    case 'item': return [p.itemIds.has(unlock.itemId) ? 1 : 0, 1];
    case 'seasonVisits': return [p.seasonVisits.get(seasonKeyOf(unlock.season, unlock.districtId)) ?? 0, unlock.count];
    case 'league': return [p.leagueRewardIds.has(unlock.rewardId) ? 1 : 0, 1];
    case 'exp': return [p.exp, unlock.points];
  }
}

/**
 * 部品1つの進み具合を求める。
 * @param part 部品
 * @param progress 実績
 * @returns 進み具合
 */
export function partProgressOf(part: AvatarPartDef, progress: AvatarProgress): PartProgress { // audit-ignore: fnlog-missing 部品の数だけ呼ぶ純粋な算術
  const [current, target] = valuesOf(part.unlock, progress);
  return { unlocked: current >= target, current: Math.min(current, target), target };
}

/**
 * 持っている部品の ID を求める。
 * @param progress 実績
 * @returns 持っている部品ID
 */
export function ownedPartIdsOf(progress: AvatarProgress): ReadonlySet<string> {
  const log = logger.fn('ownedPartIdsOf', { totalVisits: progress.totalVisits });
  const owned = new Set(AVATAR_CATALOG.filter((p) => partProgressOf(p, progress).unlocked).map((p) => p.id));
  return log.exit(owned);
}

/**
 * 装いを正規化する。知らない・持っていない部品を外し、1枠1つ（後の方を優先）、置くものは最大 MAX_OBJECTS（先の方を優先）にして、
 * 必須の枠が空なら既定の部品で埋める。並びは枠の表示順。
 * @param partIds 装いの部品ID（保存データ・入力。信用しない）
 * @param owned 持っている部品ID
 * @returns 正規化した部品ID（凍結済み）
 */
export function normalizeOutfit(partIds: readonly unknown[], owned: ReadonlySet<string>): readonly string[] {
  const log = logger.fn('normalizeOutfit', { count: partIds.length });
  const single = new Map<AvatarSlot, string>();
  const objects: string[] = [];
  for (const raw of partIds) {
    const part = typeof raw === 'string' ? avatarPartOf(raw) : undefined;
    if (part === undefined || !owned.has(part.id)) continue;
    if (part.slot !== 'object') single.set(part.slot, part.id);
    else if (!objects.includes(part.id) && objects.length < MAX_OBJECTS) objects.push(part.id);
  }
  for (const id of DEFAULT_PART_IDS) {
    const part = avatarPartOf(id);
    if (part !== undefined && !OPTIONAL_SLOTS.has(part.slot) && !single.has(part.slot)) single.set(part.slot, id);
  }
  const ordered = AVATAR_SLOTS.flatMap((slot) => (slot === 'object' ? objects : [single.get(slot)].filter((x): x is string => x !== undefined)));
  return log.exit(Object.freeze(ordered));
}
