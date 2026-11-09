/**
 * @file ドメインイベントにメタ情報（eventId・occurredAt・sequence・travelerId）を付けて作る工場（application 層）
 * ユースケース・イベントハンドラは中身（PayloadOfType）だけを書き、メタはここで一律に付ける（DI-19）。
 * eventId は IdGenerator、occurredAt は Clock から得る（domain・application は Date.now を使わない＝DI-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { parseEventId } from '@/Common/types/Id';
import type { TravelerId } from '@/Common/types/Id';
import { invariant } from '@/Common/utils/assert';
import type { DomainEventType, EventMeta, EventOfType, PayloadOfType } from '@/domain/events/DomainEvent';
import type { Clock } from '@/domain/ports/Clock';
import type { IdGenerator } from '@/domain/ports/IdGenerator';

const logger = createLogger('application/events/EventFactory');

/** EventFactory の依存 */
export interface EventFactoryDeps {
  /** eventId の発行元（newId('ev') が ^ev_[0-9a-z]{4,64}$ を返すこと） */
  readonly ids: IdGenerator;
  /** occurredAt の時計 */
  readonly clock: Clock;
}

/** ドメインイベントの工場（sequence はインスタンス内で 1 から単調増加） */
export class EventFactory {
  private sequence = 0;

  /**
   * 依存を受け取って工場を作る。container で1つだけ作り、全ユースケースで共有する（sequence を通し番号にするため）。
   * @param deps IdGenerator と Clock
   */
  constructor(private readonly deps: EventFactoryDeps) {}

  /**
   * 中身にメタ情報を付けた凍結済みのドメインイベントを作る。
   * 型引数 T は payload.type から推論される（例: create(id, { type: 'SpotVisited', ... }) → SpotVisited）。
   * @param travelerId イベントの持ち主の旅人ID（セッションから解決済みのもの＝SEC-01）
   * @param payload メタ情報を除いた中身（type を含む）
   * @returns メタ付きの凍結済みイベント
   * @throws Error IdGenerator が EventId の形式を満たさない ID を返した（実装のバグ）
   * @sideEffect インスタンス内の sequence を1進める。IdGenerator・Clock を呼ぶ
   * @see docs/06_data_integrity_checklist.md DI-19
   */
  create<T extends DomainEventType>(travelerId: TravelerId, payload: PayloadOfType<T> & { readonly type: T }): EventOfType<T> {
    const log = logger.fn('create', { type: payload.type, travelerId });
    const eventId = parseEventId(this.deps.ids.newId('ev'));
    invariant(eventId.ok, 'EventFactory.create: IdGenerator.newId("ev") が EventId の形式を満たしません');
    this.sequence += 1;
    const meta: EventMeta = { eventId: eventId.value, occurredAt: this.deps.clock.now(), sequence: this.sequence, travelerId };
    // ジェネリックな T について「中身＋メタ＝EventOfType<T>」を TypeScript が証明できないため、ここだけ型を合わせる
    const event = Object.freeze({ ...payload, ...meta }) as unknown as EventOfType<T>;
    log.debug('イベントを作成', { eventId: meta.eventId, sequence: meta.sequence });
    return log.exit(event);
  }

  /**
   * これまでに作ったイベントの数（最後の sequence）を返す。
   * @returns 最後に払い出した sequence（未作成なら 0）
   */
  lastSequence(): number {
    return this.sequence;
  }
}
