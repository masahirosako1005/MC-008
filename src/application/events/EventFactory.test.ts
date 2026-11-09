import { describe, expect, it } from 'vitest';
import { parseItemId } from '@/Common/types/Id';
import { EventFactory } from '@/application/events/EventFactory';
import { FixedClock, must, SequentialIdGenerator, TEST_TRAVELER_ID, testDate, testDistrictId, testOperationId, testSpotId } from '@/application/testing/fakes';
import type { SpotVisited } from '@/domain/events/DomainEvent';
import type { IdGenerator } from '@/domain/ports/IdGenerator';

/** テスト用: 工場と依存を作る */
function setup(): { factory: EventFactory; clock: FixedClock; ids: SequentialIdGenerator } {
  const clock = new FixedClock('2026-11-09');
  const ids = new SequentialIdGenerator();
  return { factory: new EventFactory({ ids, clock }), clock, ids };
}

describe('EventFactory.create', () => {
  it('中身に eventId・occurredAt・sequence・travelerId のメタ情報を付ける', () => {
    const { factory, clock } = setup();
    const event: SpotVisited = factory.create(TEST_TRAVELER_ID, {
      type: 'SpotVisited',
      spotId: testSpotId('l_jo01'),
      districtId: testDistrictId('d_joka'),
      localDate: testDate('2026-11-09'),
      operationId: testOperationId(1),
    });
    expect(event.type).toBe('SpotVisited');
    expect(event.eventId).toBe('ev_000001');
    expect(event.occurredAt).toBe(clock.now());
    expect(event.sequence).toBe(1);
    expect(event.travelerId).toBe(TEST_TRAVELER_ID);
    expect(event.spotId).toBe('l_jo01');
    expect(event.operationId).toBe(testOperationId(1));
  });

  it('sequence はインスタンス内で 1 から単調増加し、eventId は毎回変わる', () => {
    const { factory } = setup();
    const a = factory.create(TEST_TRAVELER_ID, { type: 'ItemAcquired', itemId: must(parseItemId('i_matsu')), name: '松' });
    const b = factory.create(TEST_TRAVELER_ID, { type: 'DistrictGrown', districtId: testDistrictId('d_joka'), from: 1, to: 2 });
    expect([a.sequence, b.sequence]).toEqual([1, 2]);
    expect(a.eventId).not.toBe(b.eventId);
    expect(factory.lastSequence()).toBe(2);
  });

  it('occurredAt は作成時点の Clock.now() になる', () => {
    const { factory, clock } = setup();
    const first = factory.create(TEST_TRAVELER_ID, { type: 'DistrictGrown', districtId: testDistrictId('d_joka'), from: 0, to: 1 });
    clock.advanceDays(30);
    const second = factory.create(TEST_TRAVELER_ID, { type: 'DistrictGrown', districtId: testDistrictId('d_joka'), from: 1, to: 2 });
    expect(second.occurredAt > first.occurredAt).toBe(true);
    expect(second.occurredAt).toBe(clock.now());
  });

  it('作ったイベントは凍結されている', () => {
    const { factory } = setup();
    const event = factory.create(TEST_TRAVELER_ID, { type: 'DistrictGrown', districtId: testDistrictId('d_joka'), from: 0, to: 1 });
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('IdGenerator が EventId の形式を満たさない ID を返したらバグとして例外を投げる', () => {
    const broken: IdGenerator = { newId: () => 'EV-NG' };
    const factory = new EventFactory({ ids: broken, clock: new FixedClock() });
    expect(() => factory.create(TEST_TRAVELER_ID, { type: 'DistrictGrown', districtId: testDistrictId('d_joka'), from: 0, to: 1 })).toThrow();
    expect(factory.lastSequence()).toBe(0);
  });
});
