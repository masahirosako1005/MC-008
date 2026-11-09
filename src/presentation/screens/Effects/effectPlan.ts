/**
 * @file 演出の並べ方と訪問結果のまとめ（presentation/screens/Effects 層。純粋関数）
 * 訪問操作中にためたドメインイベントから、全画面演出の順番（復活（おかえりボーナス込み）→ カード → 主交代 → アイテム）と
 * 地図・トースト用のまとめ（基本ポイント・おかえりボーナス・成長した地区）を作る（docs/08 §6）。
 * 主交代は自分が主になったときだけ演出する。奪われたときは演出しない（失う体験を作らない＝CLAUDE.md 5章、wireframes/08）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { EffectSummary } from '@/presentation/App/AppContext';

const logger = createLogger('presentation/screens/Effects/effectPlan');

/** 全イベント共通で使うメタ情報 */
interface SourceMeta {
  readonly eventId: string;
  /** 発行順 */
  readonly sequence: number;
}

/** 主（旅人かライバルか） */
interface HolderLike {
  readonly type: 'traveler' | 'rival';
}

/**
 * 演出の材料になるイベント。domain のイベント型（DomainEvent）の構造的な部分集合で、ID は文字列として扱う。
 * domain のイベントはそのまま代入できる（テストでは素のオブジェクトで作れる）。
 */
export type EffectSourceEvent =
  | (SourceMeta & { readonly type: 'DistrictRevived'; readonly districtId: string; readonly daysSinceLastVisit: number; readonly level: number })
  | (SourceMeta & { readonly type: 'WelcomeBackBonusGranted'; readonly districtId: string; readonly multiplier: number; readonly bonusPoints: number })
  | (SourceMeta & {
      readonly type: 'CardAwarded';
      readonly districtId: string;
      readonly rank: 'silver' | 'gold';
      readonly reason: 'visits' | 'seasons';
      readonly visitCount: number;
    })
  | (SourceMeta & {
      readonly type: 'DistrictLordChanged';
      readonly districtId: string;
      readonly from?: HolderLike;
      readonly to: HolderLike;
      readonly fromName?: string;
      readonly toName: string;
      readonly travelerCount: number;
      readonly lordCount: number;
    })
  | (SourceMeta & { readonly type: 'ItemAcquired'; readonly itemId: string; readonly name: string })
  | (SourceMeta & { readonly type: 'PointsAwarded'; readonly districtId: string; readonly spotId: string; readonly basePoints: number; readonly bonusPoints: number })
  | (SourceMeta & { readonly type: 'DistrictGrown'; readonly districtId: string; readonly from: number; readonly to: number });

/** 材料になるイベントの種別名 */
export type EffectSourceType = EffectSourceEvent['type'];

/** 種別名から材料イベントの型を取り出す */
export type EffectSourceOf<T extends EffectSourceType> = Extract<EffectSourceEvent, { readonly type: T }>;

/** EffectHost が購読するイベント種別（docs/08 §6） */
export const EFFECT_SOURCE_TYPES = [
  'DistrictRevived',
  'WelcomeBackBonusGranted',
  'CardAwarded',
  'DistrictLordChanged',
  'ItemAcquired',
  'PointsAwarded',
  'DistrictGrown',
] as const satisfies readonly EffectSourceType[];

/** 演出1つ分の内容 */
export type EffectPlanItem =
  | {
      readonly kind: 'revival';
      readonly districtId: string;
      readonly daysSinceLastVisit: number;
      readonly level: number;
      /** おかえりボーナスの倍率（同じ地区の WelcomeBackBonusGranted が無ければ undefined） */
      readonly multiplier?: number;
      readonly bonusPoints: number;
    }
  | { readonly kind: 'card'; readonly districtId: string; readonly rank: 'silver' | 'gold'; readonly reason: 'visits' | 'seasons'; readonly visitCount: number }
  | { readonly kind: 'lord'; readonly districtId: string; readonly fromName?: string; readonly reclaimed: boolean; readonly travelerCount: number }
  | { readonly kind: 'item'; readonly itemId: string; readonly name: string };

/** 演出の種類 */
export type EffectKind = EffectPlanItem['kind'];

/**
 * 種別でイベントを絞り込む（型も絞る）。
 * @param events イベント
 * @param type 種別名
 * @returns 該当するイベント（順序は保つ）
 */
function eventsOf<T extends EffectSourceType>(events: readonly EffectSourceEvent[], type: T): EffectSourceOf<T>[] {
  return events.filter((event): event is EffectSourceOf<T> => event.type === type);
}

/**
 * 数の合計（空なら 0）。
 * @param values 数の列
 * @returns 合計
 */
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * 復活の演出を作る（同じ地区のおかえりボーナスを統合。同じ地区の復活は1回だけ）。
 * @param events 発行順に並べたイベント
 * @returns 復活の演出
 */
function revivalItems(events: readonly EffectSourceEvent[]): EffectPlanItem[] {
  const log = logger.fn('revivalItems');
  const bonuses = eventsOf(events, 'WelcomeBackBonusGranted');
  const seen = new Set<string>();
  const items: EffectPlanItem[] = [];
  for (const revived of eventsOf(events, 'DistrictRevived')) {
    if (seen.has(revived.districtId)) continue;
    seen.add(revived.districtId);
    const same = bonuses.filter((bonus) => bonus.districtId === revived.districtId);
    items.push({
      kind: 'revival',
      districtId: revived.districtId,
      daysSinceLastVisit: revived.daysSinceLastVisit,
      level: revived.level,
      multiplier: same[0]?.multiplier,
      bonusPoints: sum(same.map((bonus) => bonus.bonusPoints)),
    });
  }
  return log.exit(items);
}

/**
 * 主交代の演出を作る（自分＝旅人が主になったときだけ。ライバルから取り返したかを添える）。
 * @param events 発行順に並べたイベント
 * @returns 主交代の演出
 */
function lordItems(events: readonly EffectSourceEvent[]): EffectPlanItem[] {
  const log = logger.fn('lordItems');
  const items = eventsOf(events, 'DistrictLordChanged')
    .filter((event) => event.to.type === 'traveler')
    .map((event): EffectPlanItem => {
      const reclaimed = event.from?.type === 'rival';
      return { kind: 'lord', districtId: event.districtId, fromName: reclaimed ? event.fromName : undefined, reclaimed, travelerCount: event.travelerCount };
    });
  return log.exit(items);
}

/**
 * ためたイベントから演出の順番を決める: 復活 → カード → 主交代 → アイテム（各グループ内は発行順）。
 * @param events 訪問操作中に届いたイベント（順不同でよい）
 * @returns 演出の列（空なら演出なし）
 */
export function planEffects(events: readonly EffectSourceEvent[]): EffectPlanItem[] {
  const log = logger.fn('planEffects', { count: events.length });
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const cards = eventsOf(ordered, 'CardAwarded').map((event): EffectPlanItem => ({
    kind: 'card',
    districtId: event.districtId,
    rank: event.rank,
    reason: event.reason,
    visitCount: event.visitCount,
  }));
  const items = eventsOf(ordered, 'ItemAcquired').map((event): EffectPlanItem => ({ kind: 'item', itemId: event.itemId, name: event.name }));
  const plan = [...revivalItems(ordered), ...cards, ...lordItems(ordered), ...items];
  return log.exit(plan);
}

/**
 * 訪問結果のまとめを作る（基本ポイント合計・おかえりボーナス・成長した地区）。
 * おかえりボーナスは PointsAwarded.bonusPoints と WelcomeBackBonusGranted.bonusPoints が同じ加点を指しうるので、
 * 二重に数えないよう大きい方を採る。
 * @param events 訪問操作中に届いたイベント
 * @returns まとめ
 */
export function summarizeEffects(events: readonly EffectSourceEvent[]): EffectSummary {
  const log = logger.fn('summarizeEffects', { count: events.length });
  const awarded = eventsOf(events, 'PointsAwarded');
  const awardedBonus = sum(awarded.map((event) => event.bonusPoints));
  const welcomeBonus = sum(eventsOf(events, 'WelcomeBackBonusGranted').map((event) => event.bonusPoints));
  const grown = [...new Set(eventsOf(events, 'DistrictGrown').map((event) => event.districtId))];
  return log.exit({ points: sum(awarded.map((event) => event.basePoints)), bonusPoints: Math.max(awardedBonus, welcomeBonus), grownDistrictIds: grown });
}
