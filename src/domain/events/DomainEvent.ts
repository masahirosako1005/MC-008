/**
 * @file ドメインイベントの型（domain/events 層）
 * 全画面演出・地区更新・加点はイベント購読でつなぐ（docs/01 §2.2、docs/08 §3.1・§4.2）。
 * すべてのイベントは共通メタ（eventId・occurredAt・sequence・travelerId）を持ち、購読側は eventId で重複を無視する（DI-19）。
 */
import type { DistrictId, EventId, ItemId, OperationId, SpotId, TravelerId } from '@/Common/types/Id';
import type { Instant, LocalDate } from '@/Common/utils/date';
import type { LordHolder } from '@/domain/competition/LordHolder';
import type { CardRank, CardReason } from '@/domain/reward/Card';
import type { GrowthLevel } from '@/domain/town/GrowthLevel';

/** 全イベント共通のメタ情報 */
export interface EventMeta {
  readonly eventId: EventId;
  readonly occurredAt: Instant;
  /** 発行順（EventFactory のインスタンス内で単調増加） */
  readonly sequence: number;
  readonly travelerId: TravelerId;
}

/** スポットを発見した（80m 以内に入り図鑑にシルエット登録） */
export interface SpotDiscovered extends EventMeta {
  readonly type: 'SpotDiscovered';
  readonly spotId: SpotId;
  readonly districtId: DistrictId;
}

/** スポットを訪問した（40m 以内で訪問操作。訪問記録は保存済み） */
export interface SpotVisited extends EventMeta {
  readonly type: 'SpotVisited';
  readonly spotId: SpotId;
  readonly districtId: DistrictId;
  readonly localDate: LocalDate;
  readonly operationId: OperationId;
}

/** 訪問ポイントを台帳に追記した */
export interface PointsAwarded extends EventMeta {
  readonly type: 'PointsAwarded';
  readonly districtId: DistrictId;
  readonly spotId: SpotId;
  readonly basePoints: number;
  readonly bonusPoints: number;
  readonly operationId: OperationId;
}

/** 地区の成長段階が上がった */
export interface DistrictGrown extends EventMeta {
  readonly type: 'DistrictGrown';
  readonly districtId: DistrictId;
  readonly from: GrowthLevel;
  readonly to: GrowthLevel;
}

/** 色あせ中の地区に戻ってきて復活した（おかえり） */
export interface DistrictRevived extends EventMeta {
  readonly type: 'DistrictRevived';
  readonly districtId: DistrictId;
  readonly daysSinceLastVisit: number;
  readonly level: GrowthLevel;
}

/** おかえりボーナス（当日その地区の基本点×倍率）を付与した */
export interface WelcomeBackBonusGranted extends EventMeta {
  readonly type: 'WelcomeBackBonusGranted';
  readonly districtId: DistrictId;
  readonly multiplier: number;
  readonly bonusPoints: number;
}

/** 銀・金カードを獲得した */
export interface CardAwarded extends EventMeta {
  readonly type: 'CardAwarded';
  readonly districtId: DistrictId;
  readonly rank: CardRank;
  readonly reason: CardReason;
  readonly visitCount: number;
}

/** 地区の主が交代した（from が無ければ初めて主が決まった） */
export interface DistrictLordChanged extends EventMeta {
  readonly type: 'DistrictLordChanged';
  readonly districtId: DistrictId;
  readonly from?: LordHolder;
  readonly to: LordHolder;
  readonly fromName?: string;
  readonly toName: string;
  /** 旅人（自分）の直近30日の訪問回数 */
  readonly travelerCount: number;
  /** 新しい主の直近30日の訪問回数 */
  readonly lordCount: number;
}

/** アイテムを獲得した */
export interface ItemAcquired extends EventMeta {
  readonly type: 'ItemAcquired';
  readonly itemId: ItemId;
  readonly name: string;
}

/** すべてのドメインイベント（type で判別） */
export type DomainEvent =
  | SpotDiscovered
  | SpotVisited
  | PointsAwarded
  | DistrictGrown
  | DistrictRevived
  | WelcomeBackBonusGranted
  | CardAwarded
  | DistrictLordChanged
  | ItemAcquired;

/** イベント種別名 */
export type DomainEventType = DomainEvent['type'];

/** 種別名から該当イベント型を取り出す */
export type EventOfType<T extends DomainEventType> = Extract<DomainEvent, { readonly type: T }>;

/** ユニオンの各要素から K を除く（Omit をユニオンに分配する） */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** メタ情報を除いた中身（EventFactory.create に渡す形） */
export type DomainEventPayload = DistributiveOmit<DomainEvent, keyof EventMeta>;

/** 種別名から該当イベントの中身の型を取り出す */
export type PayloadOfType<T extends DomainEventType> = Extract<DomainEventPayload, { readonly type: T }>;

/** イベント種別名の一覧（ログ・検証用） */
export const DOMAIN_EVENT_TYPES: readonly DomainEventType[] = [
  'SpotDiscovered',
  'SpotVisited',
  'PointsAwarded',
  'DistrictGrown',
  'DistrictRevived',
  'WelcomeBackBonusGranted',
  'CardAwarded',
  'DistrictLordChanged',
  'ItemAcquired',
];

/**
 * 未検証の値がイベント種別名か判定する型ガード。
 * @param value 判定する値
 * @returns DOMAIN_EVENT_TYPES のいずれかなら true
 */
export function isDomainEventType(value: unknown): value is DomainEventType {
  return typeof value === 'string' && (DOMAIN_EVENT_TYPES as readonly string[]).includes(value);
}
