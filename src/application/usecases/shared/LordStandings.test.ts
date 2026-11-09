import { describe, expect, it } from 'vitest';
import { addDays } from '@/Common/utils/date';
import {
  createTestWorld,
  must,
  seedLordship,
  seedTraveler,
  TEST_TRAVELER_ID,
  testDistrictId,
  testOperationId,
  testRivalId,
} from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import {
  lordNameOf,
  lordshipSnapshotsOf,
  standingOf,
  standingsByDistrict,
  standingsOf,
  toLordshipSnapshot,
  TRAVELER_LORD_NAME,
} from '@/application/usecases/shared/LordStandings';
import { loadWorld } from '@/application/usecases/shared/World';
import type { World } from '@/application/usecases/shared/World';
import { rivalHolder, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';
import { lordWindow } from '@/domain/competition/LordPolicy';
import { RivalActionVisit } from '@/domain/competition/Rival';
import { countRivalVisits } from '@/domain/competition/RivalActivity';
import { collect } from '@/domain/revisit/RevisitReasonPolicy';

const HONMACHI = testDistrictId('d_honmachi');
const JOKA = testDistrictId('d_joka');

/** テスト用: 世界を読む */
async function load(tw: TestWorld): Promise<World> {
  return must(await loadWorld(tw));
}

/** テスト用: ライバル行動を今日付で追記する */
async function addRivalAction(tw: TestWorld, input: { rivalId: string; districtId: string; count: number }): Promise<void> {
  const action = must(
    RivalActionVisit.of({
      rivalId: testRivalId(input.rivalId),
      districtId: testDistrictId(input.districtId),
      localDate: tw.clock.today(),
      count: input.count,
      operationId: testOperationId(input.count),
    }),
  );
  must(await tw.rivalActions.append(TEST_TRAVELER_ID, action));
}

describe('standingOf（地区の主の状況）', () => {
  it('自分が主なら「あなた」・isMe・必要回数 0 で、回数は直近30日の訪問記録の件数', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_hm01', -5], ['l_hm02', -3], ['s_hm01', -1]] });
    await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'traveler' }]);
    const standing = standingOf(await load(tw), HONMACHI);
    expect(standing).toMatchObject({ districtId: HONMACHI, lordName: TRAVELER_LORD_NAME, isMe: true, lostByTraveler: false, lordCount: 3, myCount: 3, needed: 0 });
    expect(standing.holder).toEqual(TRAVELER_HOLDER);
  });

  it('奪われて取り返し中なら、ライバル名・ライバルの回数・必要回数（主−自分+1）を返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_hm01', -5], ['l_hm02', -3], ['s_hm01', -1]] });
    await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'r_taro', lost: true }]);
    await addRivalAction(tw, { rivalId: 'r_taro', districtId: 'd_honmachi', count: 4 });
    const standing = standingOf(await load(tw), HONMACHI);
    expect(standing).toMatchObject({ lordName: '旅人タロウ', isMe: false, lostByTraveler: true, lordCount: 4, myCount: 3, needed: 2 });
    expect(standing.holder).toEqual(rivalHolder(testRivalId('r_taro')));
  });

  it('集計期間は今日を含む30暦日（30日前の訪問は数えず、29日前は数える）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_hm01', -30], ['l_hm02', -29], ['s_hm01', 0]] });
    await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'traveler' }]);
    const world = await load(tw);
    expect(lordWindow(world.today).from).toBe(addDays(world.today, -29));
    expect(standingOf(world, HONMACHI).myCount).toBe(2);
  });

  it('主がいない地区は lordName なし・主の回数 0・必要回数 1', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const standing = standingOf(await load(tw), HONMACHI);
    expect(standing.holder).toBeUndefined();
    expect(standing.lordName).toBeUndefined();
    expect(standing).toMatchObject({ isMe: false, lostByTraveler: false, lordCount: 0, myCount: 0, needed: 1 });
  });

  it('ライバルの回数は背景活動（日付から計算）を含む', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    await seedLordship(tw, [{ districtId: 'd_joka', holder: 'r_taro' }]);
    const world = await load(tw);
    const taro = tw.rivals.findRival(testRivalId('r_taro'));
    if (taro === undefined) throw new Error('fixture');
    const expected = countRivalVisits({ rival: taro, actions: [], districtId: JOKA, ...lordWindow(world.today) });
    const standing = standingOf(world, JOKA);
    expect(expected).toBeGreaterThan(0);
    expect(standing).toMatchObject({ lordName: '旅人タロウ', lordCount: expected, lostByTraveler: false, needed: expected + 1 });
  });
});

describe('standingsOf / lordshipSnapshotsOf', () => {
  it('全地区を地区の表示順で返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const world = await load(tw);
    expect(standingsOf(world).map((s) => s.districtId)).toEqual(world.spots.allDistricts().map((d) => d.id));
    expect(standingsByDistrict(standingsOf(world)).get(HONMACHI)?.districtId).toBe(HONMACHI);
  });

  it('LordshipSnapshot に変換すると RevisitReasonPolicy が同じ必要回数の「取り返し」理由を作る', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_hm01', -5], ['l_hm02', -3]] });
    await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'r_taro', lost: true }]);
    await addRivalAction(tw, { rivalId: 'r_taro', districtId: 'd_honmachi', count: 5 });
    const world = await load(tw);
    const snapshot = toLordshipSnapshot(standingOf(world, HONMACHI));
    expect(snapshot).toEqual({ districtId: HONMACHI, lordName: '旅人タロウ', isMe: false, lostByTraveler: true, lordCount: 5, myCount: 2 });
    const reasons = collect({
      today: world.today,
      spots: world.spots.allSpots(),
      districts: world.spots.allDistricts(),
      shopEvents: [],
      visits: world.traveler.visits,
      discoveredSpotIds: new Set(),
      lordships: lordshipSnapshotsOf(world),
    });
    const reclaim = reasons.find((r) => r.kind === 'reclaim');
    expect(reclaim).toMatchObject({ districtId: HONMACHI, lordName: '旅人タロウ', lordCount: 5, myCount: 2, needed: standingOf(world, HONMACHI).needed });
  });

  it('自分が主の地区のスナップショットは isMe=true で「取り返し」理由にならない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_hm01', -5]] });
    await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'traveler' }]);
    const snapshots = lordshipSnapshotsOf(await load(tw));
    expect(snapshots.find((s) => s.districtId === HONMACHI)).toMatchObject({ isMe: true, lostByTraveler: false, lordName: TRAVELER_LORD_NAME });
  });
});

describe('lordNameOf', () => {
  it('旅人は「あなた」、ライバルはマスタの名前、主なし・マスタに無いライバルは undefined', () => {
    const tw = createTestWorld();
    const rivals = tw.rivals.allRivals();
    expect(lordNameOf(TRAVELER_HOLDER, rivals)).toBe('あなた');
    expect(lordNameOf(rivalHolder(testRivalId('r_hana')), rivals)).toBe('旅人ハナ');
    expect(lordNameOf(undefined, rivals)).toBeUndefined();
    expect(lordNameOf(rivalHolder(testRivalId('r_nobody')), rivals)).toBeUndefined();
  });
});
