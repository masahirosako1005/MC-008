import { describe, expect, it } from 'vitest';
import { parseShopEventId } from '@/Common/types/Id';
import { buildTestCatalog, createTestWorld, must, seedLordship, seedTraveler, testDate, testDistrictId, testSpotId } from '@/application/testing/fakes';
import { lordshipSnapshotsOf } from '@/application/usecases/shared/LordStandings';
import { reasonDtoOf, reasonDtosOf } from '@/application/usecases/shared/ReasonText';
import { discoveredSpotIdsOf, loadWorld } from '@/application/usecases/shared/World';
import type { RevisitReason } from '@/domain/revisit/RevisitReason';
import { collect } from '@/domain/revisit/RevisitReasonPolicy';

const { spots } = buildTestCatalog();
const JOKA = testDistrictId('d_joka');
const START = testDate('2026-11-14');

describe('reasonDtoOf（再訪理由の日本語化）', () => {
  it('期限（クーポン）:「{スポット名}のクーポン、あと{n}日」・サブタイトルは題名', () => {
    const reason: RevisitReason = { kind: 'deadline', shopEventId: must(parseShopEventId('c_jo01')), spotId: testSpotId('s_jo02'), districtId: JOKA, title: 'どら焼き1個サービス', daysLeft: 3 };
    expect(reasonDtoOf(reason, spots)).toEqual({
      kind: 'deadline',
      title: '丸岡和菓子店のクーポン、あと3日',
      subtitle: 'どら焼き1個サービス',
      districtId: 'd_joka',
      spotId: 's_jo02',
      shopEventId: 'c_jo01',
    });
  });

  it('期限（イベント）で残り0日なら「今日まで」', () => {
    const reason: RevisitReason = { kind: 'deadline', shopEventId: must(parseShopEventId('c_jo03')), spotId: testSpotId('l_jo01'), districtId: JOKA, title: '城下 秋まつり', daysLeft: 0 };
    expect(reasonDtoOf(reason, spots)).toMatchObject({ title: 'N西城跡のイベント、今日まで', subtitle: '城下 秋まつり' });
  });

  it('取り返し:「{地区名}の主を{名前}に奪われた」と直近30日の回数・必要回数', () => {
    const reason: RevisitReason = { kind: 'reclaim', districtId: testDistrictId('d_honmachi'), lordName: 'おまいり番長', lordCount: 5, myCount: 3, needed: 3 };
    expect(reasonDtoOf(reason, spots)).toEqual({
      kind: 'reclaim',
      title: '本町地区の主をおまいり番長に奪われた',
      subtitle: '直近30日：おまいり番長 5回／あなた 3回・取り返しまであと3回',
      districtId: 'd_honmachi',
    });
  });

  it('色あせ間近（soon）:「そろそろ色あせ：{地区名} あと{d}日」とカレンダー追加', () => {
    const reason: RevisitReason = { kind: 'fade', districtId: testDistrictId('d_minato'), state: 'soon', daysSinceVisit: 25, daysUntilFade: 5, fadeStartDate: START };
    expect(reasonDtoOf(reason, spots)).toEqual({
      kind: 'fade',
      title: 'そろそろ色あせ：みなと地区 あと5日',
      subtitle: '最終訪問 25日前',
      districtId: 'd_minato',
      calendar: { districtName: 'みなと地区', fadeStartDate: '2026-11-14' },
    });
  });

  it('色あせ中（fading）:「色あせ中：{地区名}」と復活の案内（カレンダー追加なし）', () => {
    const reason: RevisitReason = { kind: 'fade', districtId: testDistrictId('d_yunosato'), state: 'fading', daysSinceVisit: 45, fadeStartDate: START };
    const dto = reasonDtoOf(reason, spots);
    expect(dto).toEqual({ kind: 'fade', title: '色あせ中：湯の里地区', subtitle: '最終訪問 45日前・再訪で復活＋おかえりボーナス', districtId: 'd_yunosato' });
    expect(dto.calendar).toBeUndefined();
  });

  it('未訪問: 件数と名前（3件以内は全部、「ほか」なし）', () => {
    const reason: RevisitReason = { kind: 'unvisited', districtId: JOKA, spotIds: [testSpotId('l_jo02'), testSpotId('s_jo02'), testSpotId('s_jo04')] };
    expect(reasonDtoOf(reason, spots)).toEqual({
      kind: 'unvisited',
      title: '城下地区にまだ行っていないスポットが3件',
      subtitle: '武家屋敷通り、丸岡和菓子店、御堀端ベーカリー',
      districtId: 'd_joka',
      spotId: 'l_jo02',
    });
  });

  it('未訪問: 4件以上は先頭3件の名前＋「ほか」', () => {
    const reason: RevisitReason = { kind: 'unvisited', districtId: JOKA, spotIds: ['l_jo02', 's_jo02', 's_jo03', 's_jo04'].map(testSpotId) };
    expect(reasonDtoOf(reason, spots)).toMatchObject({ title: '城下地区にまだ行っていないスポットが4件', subtitle: '武家屋敷通り、丸岡和菓子店、城下茶寮ほか' });
  });

  it('マスタに無い地区・スポットは汎用の名前にする（例外にしない）', () => {
    const reason: RevisitReason = { kind: 'unvisited', districtId: testDistrictId('d_nowhere'), spotIds: [testSpotId('l_zz99')] };
    expect(reasonDtoOf(reason, spots)).toMatchObject({ title: 'この地区にまだ行っていないスポットが1件', subtitle: 'スポット' });
  });

  it('作った DTO は凍結されている', () => {
    const reason: RevisitReason = { kind: 'reclaim', districtId: JOKA, lordName: '花見は毎日派', lordCount: 2, myCount: 1, needed: 2 };
    expect(Object.isFrozen(reasonDtoOf(reason, spots))).toBe(true);
  });
});

describe('reasonDtosOf（RevisitReasonPolicy.collect と組み合わせ）', () => {
  it('表示順（期限＞取り返し＞色あせ＞未訪問）を保ったまま文言にする', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, {
      visits: [['l_hm01', -5], ['l_mi01', -25], ['l_yu01', -45]],
      discovered: ['s_jo02', 'l_jo02'],
    });
    await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'r_taro', lost: true }]);
    const world = must(await loadWorld(tw));
    const reasons = collect({
      today: world.today,
      spots: world.spots.allSpots(),
      districts: world.spots.allDistricts(),
      shopEvents: world.spots.allShopEvents(),
      visits: world.traveler.visits,
      discoveredSpotIds: discoveredSpotIdsOf(world.traveler),
      lordships: lordshipSnapshotsOf(world),
    });
    const dtos = reasonDtosOf(reasons, world.spots);
    expect(dtos.map((d) => d.kind)).toEqual(['deadline', 'reclaim', 'fade', 'fade', 'unvisited']);
    expect(dtos[0]?.title).toBe('丸岡和菓子店のクーポン、あと3日');
    expect(dtos[1]?.title).toBe('本町地区の主をおまいり番長に奪われた');
    expect(dtos[2]?.title).toBe('色あせ中：湯の里地区');
    expect(dtos[3]?.title).toBe('そろそろ色あせ：みなと地区 あと5日');
    expect(dtos[4]).toMatchObject({ title: '城下地区にまだ行っていないスポットが2件', subtitle: '武家屋敷通り、丸岡和菓子店' });
  });
});
