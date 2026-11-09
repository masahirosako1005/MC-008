/**
 * @file メモリ上のドメインイベント配送（infrastructure/events 層。application の EventBus の実装）
 * - publish はイベントを渡された順に、種別ごとの購読ハンドラを登録順に await する（docs/08 §4.2 のイベント連鎖）
 * - ハンドラの例外は log.error に残して次のハンドラへ進む（1つの失敗で連鎖全体を止めない＝DI-11）
 * - 処理済み eventId を直近 maxRemembered 件（既定 1,000）覚え、同じイベントの再配送を無視する（DI-19）
 */
import { createLogger } from '@/Common/logging/logger';
import type { EventId } from '@/Common/types/Id';
import type { DomainEventHandler, EventBus } from '@/application/events/EventBus';
import type { DomainEvent, DomainEventType, EventOfType } from '@/domain/events/DomainEvent';

const logger = createLogger('infrastructure/events/InMemoryEventBus');

/** 覚えておく処理済み eventId の既定件数 */
export const DEFAULT_MAX_REMEMBERED_EVENTS = 1_000;

/** 種別を問わずに呼べる形に包んだハンドラ */
type AnyHandler = (event: DomainEvent) => Promise<void> | void;

/** 登録済みの購読 */
interface Subscription {
  readonly type: DomainEventType;
  readonly handler: AnyHandler;
}

/** InMemoryEventBus の設定 */
export interface InMemoryEventBusOptions {
  /** 覚えておく処理済み eventId の件数（1 以上。既定 DEFAULT_MAX_REMEMBERED_EVENTS） */
  readonly maxRemembered?: number;
}

/**
 * イベントが指定の種別か判定する型ガード。
 * @param event イベント
 * @param type 種別名
 * @returns 一致すれば true（event を EventOfType<T> として扱える）
 */
function isEventOfType<T extends DomainEventType>(event: DomainEvent, type: T): event is EventOfType<T> {
  return event.type === type;
}

/** メモリ上のドメインイベント配送 */
export class InMemoryEventBus implements EventBus {
  private readonly subscriptions: Subscription[] = [];
  private readonly processedIds = new Set<EventId>();
  private readonly processedOrder: EventId[] = [];
  private readonly maxRemembered: number;

  /**
   * 配送を作る。
   * @param options 処理済み eventId を覚える件数
   */
  constructor(options: InMemoryEventBusOptions = {}) {
    const requested = options.maxRemembered ?? DEFAULT_MAX_REMEMBERED_EVENTS;
    this.maxRemembered = Number.isSafeInteger(requested) && requested >= 1 ? requested : DEFAULT_MAX_REMEMBERED_EVENTS;
  }

  /**
   * 種別を指定して購読する。
   * @param type イベント種別
   * @param handler ハンドラ（Promise を返せば await される）
   * @returns 購読解除の関数（2回呼んでも安全）
   * @sideEffect 購読一覧に追加する
   */
  subscribe<T extends DomainEventType>(type: T, handler: DomainEventHandler<T>): () => void {
    const log = logger.fn('subscribe', { type });
    const subscription: Subscription = {
      type,
      handler: (event: DomainEvent): Promise<void> | void => (isEventOfType(event, type) ? handler(event) : undefined),
    };
    this.subscriptions.push(subscription);
    return log.exit((): void => this.unsubscribe(subscription));
  }

  /**
   * 購読を外す。
   * @param subscription 外す購読
   * @sideEffect 購読一覧から削除する
   */
  private unsubscribe(subscription: Subscription): void {
    const log = logger.fn('unsubscribe', { type: subscription.type });
    const index = this.subscriptions.indexOf(subscription);
    if (index >= 0) this.subscriptions.splice(index, 1);
    log.exit(undefined, `removed=${index >= 0}`);
  }

  /**
   * イベントを順に配送する。処理済みの eventId は無視する。
   * @param events 配送するイベント（発行順）
   * @returns すべてのハンドラが終わったら解決する（ハンドラの例外では reject しない）
   * @sideEffect 購読ハンドラを呼ぶ。処理済み eventId を記録する
   * @see docs/06 DI-19
   */
  async publish(events: readonly DomainEvent[]): Promise<void> {
    const log = logger.fn('publish', { count: events.length });
    for (const event of events) {
      if (!this.markProcessed(event.eventId)) {
        log.debug('処理済みのイベントを無視', { type: event.type, eventId: event.eventId });
        continue;
      }
      log.info('イベント発行', { type: event.type, eventId: event.eventId, sequence: event.sequence });
      await this.deliver(event);
    }
    log.exit(undefined);
  }

  /**
   * 1件のイベントを、その種別の購読ハンドラへ登録順に渡す。
   * @param event 配送するイベント
   * @returns すべてのハンドラが終わったら解決する
   * @sideEffect 購読ハンドラを呼ぶ
   */
  private async deliver(event: DomainEvent): Promise<void> {
    const log = logger.fn('deliver', { type: event.type, eventId: event.eventId });
    const targets = this.subscriptions.filter((s) => s.type === event.type);
    for (const [index, subscription] of targets.entries()) {
      try {
        await subscription.handler(event);
      } catch (error) {
        log.error('イベントハンドラで例外', { type: event.type, eventId: event.eventId, index, error });
      }
    }
    log.exit(undefined, `handlers=${targets.length}`);
  }

  /**
   * eventId を処理済みにする。古いものから忘れて maxRemembered 件に保つ。
   * @param eventId イベントID
   * @returns 新たに記録したら true、処理済みなら false
   * @sideEffect 処理済み eventId の記録を更新する
   */
  private markProcessed(eventId: EventId): boolean {
    const log = logger.fn('markProcessed', { eventId });
    if (this.processedIds.has(eventId)) return log.exit(false);
    this.processedIds.add(eventId);
    this.processedOrder.push(eventId);
    while (this.processedOrder.length > this.maxRemembered) {
      const oldest = this.processedOrder.shift();
      if (oldest !== undefined) this.processedIds.delete(oldest);
    }
    return log.exit(true);
  }
}
