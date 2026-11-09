import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseEventId, parseItemId, parseOperationId, parseSpotId, parseTravelerId } from '@/Common/types/Id';
import { parseInstant, parseLocalDate } from '@/Common/utils/date';
import type { DomainEvent, ItemAcquired, SpotVisited } from '@/domain/events/DomainEvent';
import { InMemoryEventBus } from '@/infrastructure/events/InMemoryEventBus';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const META = {
  occurredAt: must(parseInstant('2026-11-09T01:00:00.000Z')),
  travelerId: must(parseTravelerId('t_demoregular')),
};

/** テスト用: SpotVisited イベント */
function spotVisited(eventId: string, sequence = 1): SpotVisited {
  return {
    ...META,
    type: 'SpotVisited',
    eventId: must(parseEventId(eventId)),
    sequence,
    spotId: must(parseSpotId('l_jo01')),
    districtId: must(parseDistrictId('d_joka')),
    localDate: must(parseLocalDate('2026-11-09')),
    operationId: must(parseOperationId('0f8fad5b-d9cb-469f-a165-70867728950e')),
  };
}

/** テスト用: ItemAcquired イベント */
function itemAcquired(eventId: string): ItemAcquired {
  return { ...META, type: 'ItemAcquired', eventId: must(parseEventId(eventId)), sequence: 9, itemId: must(parseItemId('i_matsu')), name: '松' };
}

describe('InMemoryEventBus', () => {
  it('種別ごとの購読ハンドラを登録順に await し、別種別のハンドラは呼ばない', async () => {
    const bus = new InMemoryEventBus();
    const calls: string[] = [];
    bus.subscribe('SpotVisited', async (e) => {
      await Promise.resolve();
      calls.push(`first:${e.spotId}`);
    });
    bus.subscribe('SpotVisited', (e) => {
      calls.push(`second:${e.districtId}`);
    });
    bus.subscribe('ItemAcquired', () => {
      calls.push('item');
    });
    await bus.publish([spotVisited('ev_0001')]);
    expect(calls).toEqual(['first:l_jo01', 'second:d_joka']);
  });

  it('同じ eventId のイベントは2回目以降を無視する（DI-19）', async () => {
    const bus = new InMemoryEventBus();
    let count = 0;
    bus.subscribe('SpotVisited', () => {
      count += 1;
    });
    await bus.publish([spotVisited('ev_0001'), spotVisited('ev_0001')]);
    await bus.publish([spotVisited('ev_0001')]);
    await bus.publish([spotVisited('ev_0002')]);
    expect(count).toBe(2);
  });

  it('ハンドラが例外を投げても次のハンドラ・次のイベントへ進み、publish は reject しない', async () => {
    const bus = new InMemoryEventBus();
    const calls: string[] = [];
    bus.subscribe('SpotVisited', () => {
      throw new Error('boom');
    });
    bus.subscribe('SpotVisited', async () => {
      await Promise.reject(new Error('async boom'));
    });
    bus.subscribe('SpotVisited', (e) => {
      calls.push(e.eventId);
    });
    await expect(bus.publish([spotVisited('ev_0001'), spotVisited('ev_0002', 2)])).resolves.toBeUndefined();
    expect(calls).toEqual(['ev_0001', 'ev_0002']);
  });

  it('ハンドラの中で発行したイベントも配送する（イベント連鎖＝docs/08 §4.2）', async () => {
    const bus = new InMemoryEventBus();
    const order: string[] = [];
    bus.subscribe('SpotVisited', async () => {
      order.push('visited');
      await bus.publish([itemAcquired('ev_item1')]);
      order.push('visited-done');
    });
    bus.subscribe('ItemAcquired', (e) => {
      order.push(`item:${e.name}`);
    });
    await bus.publish([spotVisited('ev_0001')]);
    expect(order).toEqual(['visited', 'item:松', 'visited-done']);
  });

  it('購読解除したハンドラは呼ばれない（2回解除しても安全）', async () => {
    const bus = new InMemoryEventBus();
    let count = 0;
    const unsubscribe = bus.subscribe('SpotVisited', () => {
      count += 1;
    });
    unsubscribe();
    unsubscribe();
    await bus.publish([spotVisited('ev_0001')]);
    expect(count).toBe(0);
  });

  it('覚えておく件数を超えた古い eventId は忘れる（既定は 1,000 件）', async () => {
    const bus = new InMemoryEventBus({ maxRemembered: 2 });
    const seen: string[] = [];
    bus.subscribe('SpotVisited', (e) => {
      seen.push(e.eventId);
    });
    const events: DomainEvent[] = [spotVisited('ev_0001'), spotVisited('ev_0002'), spotVisited('ev_0003')];
    await bus.publish(events);
    await bus.publish([spotVisited('ev_0003'), spotVisited('ev_0001')]);
    expect(seen).toEqual(['ev_0001', 'ev_0002', 'ev_0003', 'ev_0001']);
  });

  it('既定では 1,000 件まで重複を覚えている', async () => {
    const bus = new InMemoryEventBus();
    let count = 0;
    bus.subscribe('SpotVisited', () => {
      count += 1;
    });
    const ids = Array.from({ length: 1000 }, (_, i) => `ev_${String(i).padStart(4, '0')}`);
    await bus.publish(ids.map((id) => spotVisited(id)));
    await bus.publish([spotVisited('ev_0000')]);
    expect(count).toBe(1000);
    await bus.publish([spotVisited('ev_1000')]);
    await bus.publish([spotVisited('ev_0000')]);
    expect(count).toBe(1002);
  });
});
