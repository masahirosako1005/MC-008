import { describe, expect, it } from 'vitest';
import { parseItemId } from '@/Common/types/Id';
import { addDays } from '@/Common/utils/date';
import {
  buildTestCatalog,
  buildTraveler,
  createTestWorld,
  districtOf,
  must,
  offsetPoint,
  RecordingEventBus,
  seedLordship,
  seedTraveler,
  spotOf,
  TEST_ORIGIN,
  TEST_TODAY,
  TEST_TRAVELER_ID,
  testDistrictId,
  testOperationId,
  testRivalId,
} from '@/application/testing/fakes';
import { holderKey } from '@/domain/competition/LordHolder';
import { collectLordCounts, decide, lordWindow } from '@/domain/competition/LordPolicy';
import { LordshipBoard } from '@/domain/competition/LordshipBoard';
import { RivalActionVisit } from '@/domain/competition/Rival';
import type { DomainEvent } from '@/domain/events/DomainEvent';
import { isWithinDiscoveryRadius } from '@/domain/exploration/DiscoveryRule';
import { Distance } from '@/domain/exploration/Distance';
import { PointLedger } from '@/domain/reward/PointLedger';
import { isPointInPolygon } from '@/domain/town/District';

describe('buildTestCatalog（テスト用マスタ）', () => {
  const { spots, rivals } = buildTestCatalog();

  it('5地区・20スポット・ライバル2人（allRivals で7人）', () => {
    expect(spots.allDistricts().map((d) => d.id)).toEqual(['d_joka', 'd_minato', 'd_honmachi', 'd_satoyama', 'd_yunosato']);
    expect(spots.allSpots()).toHaveLength(20);
    expect(rivals.allRivals().map((r) => r.id)).toEqual(['r_taro', 'r_hana']);
    expect(buildTestCatalog({ allRivals: true }).rivals.allRivals()).toHaveLength(7);
  });

  it('スポットは所属地区のポリゴン内にあり、同じ地区のスポット同士は60m以上離れている', () => {
    for (const district of spots.allDistricts()) {
      const inDistrict = spots.spotsInDistrict(district.id);
      for (const spot of inDistrict) {
        expect(isPointInPolygon(spot.point, district.polygon)).toBe(true);
        for (const other of inDistrict) if (other.id !== spot.id) expect(Distance.between(spot.point, other.point).meters).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('地区の入口はポリゴン内で、どのスポットからも85m以上離れている（入口では何も発見しない）', () => {
    for (const district of spots.allDistricts()) {
      expect(isPointInPolygon(district.entrance, district.polygon)).toBe(true);
      for (const spot of spots.allSpots()) expect(Distance.between(district.entrance, spot.point).meters).toBeGreaterThanOrEqual(85);
    }
  });

  it('城下の入口から地区中心へ歩くと、途中で未発見スポットが80m円に入る', () => {
    const joka = districtOf(spots, 'd_joka');
    const near = spots.spotsInDistrict(joka.id).filter((spot) => isWithinDiscoveryRadius(Distance.between(joka.center, spot.point).meters));
    expect(near.length).toBeGreaterThan(0);
  });

  it('offsetPoint でずらした距離は Distance.between とほぼ一致する', () => {
    const spot = spotOf(spots, 'l_jo01');
    expect(Distance.between(spot.point, offsetPoint(spot.point, { northM: 39 })).meters).toBe(39);
    expect(Distance.between(spot.point, offsetPoint(spot.point, { eastM: 41 })).meters).toBe(41);
    expect(Distance.between(TEST_ORIGIN, offsetPoint(TEST_ORIGIN, { eastM: 30, northM: 40 })).meters).toBe(50);
  });

  it('allRivals のカタログでデモシード（docs/08 §4.5）の訪問を組むと、主は表のとおりになる', () => {
    const full = buildTestCatalog({ allRivals: true });
    const seed: readonly (readonly [string, number])[] = [
      ['l_jo01', -20], ['l_jo01', -12], ['l_jo01', -5], ['s_jo01', -12], ['s_jo01', -5], ['s_jo03', -5],
      ['l_hm01', -28], ['l_hm02', -26], ['s_hm01', -22], ['s_hm02', -18], ['s_hm03', -15], ['l_hm01', -12], ['l_hm02', -9], ['s_hm01', -5], ['s_hm02', -2],
      ['l_mi01', -25], ['l_mi02', -25], ['l_yu01', -60], ['l_yu01', -45], ['l_yu02', -45], ['s_yu01', -45],
    ];
    const expected = { d_joka: 'rival:r_taro', d_minato: 'rival:r_hana', d_honmachi: 'traveler', d_satoyama: 'rival:r_ken', d_yunosato: 'rival:r_sora' };
    for (let offset = 0; offset < 30; offset += 1) {
      const today = addDays(TEST_TODAY, offset);
      const visits = buildTraveler(full.spots, today, { visits: seed, discovered: ['l_jo02', 's_jo02', 's_jo04'] }).visits;
      for (const [districtId, lord] of Object.entries(expected)) {
        const counts = collectLordCounts({ districtId: testDistrictId(districtId), visits, rivals: full.rivals.allRivals(), actions: [], window: lordWindow(today) });
        const decided = decide({ counts });
        expect(decided === undefined ? undefined : holderKey(decided), `${today} ${districtId}`).toBe(lord);
      }
    }
  });

  it('クーポン・イベントはスポットから引ける', () => {
    expect(spots.shopEventsForSpot(spotOf(spots, 's_jo02').id).map((e) => e.id)).toEqual(['c_jo01']);
    expect(spots.allShopEvents().length).toBe(7);
  });
});

describe('InMemory リポジトリ（楽観ロック＝DI-10）', () => {
  it('旅人: 期待版数が違えば CONFLICT、合えば version+1 を返す', async () => {
    const tw = createTestWorld();
    const traveler = buildTraveler(tw.spots, TEST_TODAY);
    const first = must(await tw.travelers.save(traveler, 0));
    expect(first.version).toBe(1);
    const stale = await tw.travelers.save(traveler, 0);
    expect(stale.ok ? undefined : stale.error.code).toBe('CONFLICT');
    const second = must(await tw.travelers.save(first, 1));
    expect(second.version).toBe(2);
    expect(must(await tw.travelers.findById(TEST_TRAVELER_ID))?.version).toBe(2);
  });

  it('台帳・盤: 未保存なら空を返し、期待版数が違えば CONFLICT', async () => {
    const tw = createTestWorld();
    const ledger = must(await tw.ledgers.find(TEST_TRAVELER_ID));
    expect(ledger.version).toBe(0);
    expect(ledger.balance()).toBe(0);
    must(await tw.ledgers.save(PointLedger.empty(TEST_TRAVELER_ID), 0));
    const ledgerConflict = await tw.ledgers.save(PointLedger.empty(TEST_TRAVELER_ID), 0);
    expect(ledgerConflict.ok ? undefined : ledgerConflict.error.code).toBe('CONFLICT');
    must(await tw.lordships.save(LordshipBoard.empty(TEST_TRAVELER_ID), 0));
    const boardConflict = await tw.lordships.save(LordshipBoard.empty(TEST_TRAVELER_ID), 5);
    expect(boardConflict.ok ? undefined : boardConflict.error.code).toBe('CONFLICT');
  });

  it('failNext で次の1回だけ失敗する', async () => {
    const tw = createTestWorld();
    tw.travelers.failures.failNext('save');
    const failed = await tw.travelers.save(buildTraveler(tw.spots, TEST_TODAY), 0);
    expect(failed.ok ? undefined : failed.error.code).toBe('STORAGE_FAILED');
    expect((await tw.travelers.save(buildTraveler(tw.spots, TEST_TODAY), 0)).ok).toBe(true);
  });

  it('ライバル行動: 同じ operationId は二重に追記しない（DI-07）・clear で消える', async () => {
    const tw = createTestWorld();
    const action = must(RivalActionVisit.of({ rivalId: testRivalId('r_taro'), districtId: testDistrictId('d_honmachi'), localDate: TEST_TODAY, count: 2, operationId: testOperationId(1) }));
    must(await tw.rivalActions.append(TEST_TRAVELER_ID, action));
    must(await tw.rivalActions.append(TEST_TRAVELER_ID, action));
    expect(must(await tw.rivalActions.list(TEST_TRAVELER_ID))).toHaveLength(1);
    must(await tw.rivalActions.clear(TEST_TRAVELER_ID));
    expect(must(await tw.rivalActions.list(TEST_TRAVELER_ID))).toEqual([]);
  });
});

describe('RecordingEventBus', () => {
  it('登録順に配送し、同じ eventId は1回だけ（DI-19）、購読解除できる', async () => {
    const tw = createTestWorld();
    const bus = new RecordingEventBus();
    const calls: string[] = [];
    bus.subscribe('DistrictGrown', () => {
      calls.push('a');
    });
    const off = bus.subscribe('DistrictGrown', () => {
      calls.push('b');
    });
    const event = tw.eventFactory.create(TEST_TRAVELER_ID, { type: 'DistrictGrown', districtId: testDistrictId('d_joka'), from: 0, to: 1 });
    await bus.publish([event, event]);
    expect(calls).toEqual(['a', 'b']);
    expect(bus.published).toHaveLength(1);
    off();
    await bus.publish([tw.eventFactory.create(TEST_TRAVELER_ID, { type: 'DistrictGrown', districtId: testDistrictId('d_joka'), from: 1, to: 2 })]);
    expect(calls).toEqual(['a', 'b', 'a']);
    expect(bus.ofType('DistrictGrown').map((e) => e.to)).toEqual([1, 2]);
  });

  it('ハンドラの中で発行したイベントも記録する（イベント連鎖）', async () => {
    const tw = createTestWorld();
    const bus = tw.events;
    bus.subscribe('DistrictGrown', async (e) => {
      const next: DomainEvent = tw.eventFactory.create(e.travelerId, { type: 'ItemAcquired', itemId: must(parseItemId('i_matsu')), name: '松' });
      await bus.publish([next]);
    });
    await bus.publish([tw.eventFactory.create(TEST_TRAVELER_ID, { type: 'DistrictGrown', districtId: testDistrictId('d_joka'), from: 0, to: 1 })]);
    expect(bus.types()).toEqual(['DistrictGrown', 'ItemAcquired']);
  });
});

describe('createTestWorld / seedTraveler / FakeDemoControl', () => {
  it('seedTraveler は訪問を日付どおりに記録し、セッションのアクティブな旅人にする', async () => {
    const tw = createTestWorld();
    const traveler = await seedTraveler(tw, { visits: [['l_jo01', -5], ['l_jo01', -12]], discovered: ['s_jo02'], profile: 'regular' });
    expect(traveler.visits.map((v) => v.localDate)).toEqual([addDays(TEST_TODAY, -12), addDays(TEST_TODAY, -5)]);
    expect(traveler.hasDiscovered(spotOf(tw.spots, 's_jo02').id)).toBe(true);
    expect(traveler.profile).toBe('regular');
    expect(tw.session.current.activeTravelerId).toBe(TEST_TRAVELER_ID);
  });

  it('seedLordship の lost=true は取り返し中（lostByTraveler）になる', async () => {
    const tw = createTestWorld();
    const board = await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'r_taro', lost: true }, { districtId: 'd_joka', holder: 'r_taro' }]);
    expect(board.isLostByTraveler(testDistrictId('d_honmachi'))).toBe(true);
    expect(board.isLostByTraveler(testDistrictId('d_joka'))).toBe(false);
  });

  it('デモ操作は時計と位置の偽物を動かす', async () => {
    const tw = createTestWorld();
    expect(must(tw.demo.advanceDays(30))).toBe(30);
    expect(tw.clock.today()).toBe(addDays(TEST_TODAY, 30));
    must(tw.demo.resetOffset());
    expect(tw.clock.today()).toBe(TEST_TODAY);
    const target = spotOf(tw.spots, 'l_jo01').point;
    tw.demo.setPosition(target);
    const fix = must(await tw.geo.current());
    expect(fix.point).toEqual(target);
    expect(fix.at).toBe(tw.clock.now());
    tw.geo.setError('GEO_DENIED');
    const denied = await tw.geo.current();
    expect(denied.ok ? undefined : denied.error.code).toBe('GEO_DENIED');
  });

  it('初期位置は城下地区の入口', () => {
    const tw = createTestWorld();
    expect(tw.geo.currentPoint).toEqual(districtOf(tw.spots, 'd_joka').entrance);
  });
});
