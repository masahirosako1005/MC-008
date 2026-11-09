/**
 * @file ドメインイベント配送のインターフェース（application 層）
 * 実装は infrastructure/events/InMemoryEventBus。publish は購読ハンドラを登録順に await し、eventId で重複を無視する（DI-19）。
 * presentation は subscribe だけを使える（EventSubscriber）。
 */
import type { DomainEvent, DomainEventType, EventOfType } from '@/domain/events/DomainEvent';

/** 種別ごとのイベントハンドラ */
export type DomainEventHandler<T extends DomainEventType> = (event: EventOfType<T>) => Promise<void> | void;

/** 購読だけを公開する IF（presentation 向け） */
export interface EventSubscriber {
  /** 種別を指定して購読する。戻り値を呼ぶと購読解除 */
  subscribe<T extends DomainEventType>(type: T, handler: DomainEventHandler<T>): () => void;
}

/** 発行と購読の IF（application / infrastructure 向け） */
export interface EventBus extends EventSubscriber {
  /** イベントを順に配送する。各ハンドラの例外はログに残して次へ進む */
  publish(events: readonly DomainEvent[]): Promise<void>;
}
