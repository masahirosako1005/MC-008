import { describe, expect, it } from 'vitest';
import { addDays, compareInstant, daysBetween } from '@/Common/utils/date';
import { must, TEST_TODAY, TestSpotRepository } from '@/application/testing/fakes';
import { buildScenarioCatalog } from '@/application/testing/scenarioCatalog';
import {
  buildDemoSeed, buildFirstSeed, buildRegularSeed, demoSeedOperationId, isRegularSeedOutdated, REGULAR_SEED_DISCOVERED_ONLY, REGULAR_SEED_VISITS,
} from '@/application/usecases/demo/demoSeeds';
import { initialLordshipBoard } from '@/application/usecases/session/TravelerSetup';
import { holderKey } from '@/domain/competition/LordHolder';
import { districtStatusOf } from '@/domain/town/DistrictStatus';

/** docs/08 §4.5 の表（回数・Lv・score・色あせ）を §9.3 の新しい地区ID で（天満・大川・扇町は 2026-11-09 に図鑑の獲得を増やした後の値） */
const EXPECTED_TABLE: Readonly<Record<string, { visitCount: number; level: number; score: number; fade: string }>> = {
  d_minamimori: { visitCount: 6, level: 2, score: 9, fade: 'fresh' },
  d_tenma: { visitCount: 9, level: 3, score: 16, fade: 'fresh' },
  d_tenroku: { visitCount: 0, level: 0, score: 0, fade: 'never' },
  d_ogimachi: { visitCount: 15, level: 3, score: 28, fade: 'fading' },
  d_okawa: { visitCount: 15, level: 3, score: 28, fade: 'soon' },
};

/** docs/08 §4.5 の表の「主」列（7人のライバルで D7 を計算した結果。§9.3 の新しい地区ID で） */
const EXPECTED_LORDS = { d_minamimori: 'rival:r_taro', d_tenma: 'traveler', d_tenroku: 'rival:r_ken', d_ogimachi: 'rival:r_sora', d_okawa: 'rival:r_hana' };

describe('buildRegularSeed（通い慣れた人）', () => {
  const { spots } = buildScenarioCatalog();

  it('旅人ID t_demoregular・profile regular で、訪問45件を時系列に作り、操作ID は接頭辞＋16進の連番', () => {
    const { traveler } = must(buildRegularSeed({ today: TEST_TODAY, spots }));
    expect(traveler.id).toBe('t_demoregular');
    expect(traveler.profile).toBe('regular');
    expect(traveler.nickname).toBe('通い慣れた人');
    expect(traveler.version).toBe(0);
    expect(traveler.visits).toHaveLength(45);
    const times = traveler.visits.map((v) => v.visitedAt);
    expect([...times].sort(compareInstant)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
    expect(traveler.visits.map((v) => v.operationId)).toEqual(REGULAR_SEED_VISITS.map((_, i) => must(demoSeedOperationId(i + 1))));
    expect(must(demoSeedOperationId(10))).toBe('00000000-0000-4000-8000-00000000000a');
  });

  it('スポット×日の配置は REGULAR_SEED_VISITS（＝scripts の SEED_VISITS）と同じ', () => {
    const { traveler } = must(buildRegularSeed({ today: TEST_TODAY, spots }));
    const placed = traveler.visits.map((v) => `${v.spotId}@${daysBetween(TEST_TODAY, v.localDate)}`).sort();
    expect(placed).toEqual(REGULAR_SEED_VISITS.map(([spotId, day]) => `${spotId}@${day}`).sort());
    const tenma = traveler.visits.filter((v) => v.districtId === 'd_tenma');
    expect(new Set(tenma.map((v) => v.spotId)).size).toBe(7);
    expect(tenma.map((v) => daysBetween(TEST_TODAY, v.localDate))).toEqual([-28, -26, -22, -18, -15, -12, -9, -5, -2]);
  });

  it('地区ごとの回数・Lv・色あせは §4.5／§9.3 の表どおり（大川は あと5日、扇町・中崎町は45日）', () => {
    const { traveler } = must(buildRegularSeed({ today: TEST_TODAY, spots }));
    for (const district of spots.allDistricts()) {
      const status = districtStatusOf({ district, visits: traveler.visits, today: TEST_TODAY });
      expect({ visitCount: status.visitCount, level: status.level, score: status.score, fade: status.fade.kind }, district.id).toEqual(EXPECTED_TABLE[district.id]);
    }
    const fadeOf = (id: string): unknown => {
      const district = spots.allDistricts().find((d) => d.id === id);
      return district === undefined ? undefined : districtStatusOf({ district, visits: traveler.visits, today: TEST_TODAY }).fade;
    };
    expect(fadeOf('d_okawa')).toMatchObject({ kind: 'soon', daysUntilFade: 5 });
    expect(fadeOf('d_ogimachi')).toMatchObject({ kind: 'fading', daysSinceVisit: 45 });
  });

  it('南森町は l_mm02・s_mm02・s_mm04 だけが発見のみ（手順2のため）で、天満・大川にも発見のみがあり、天六には無い（訪問なし）', () => {
    expect(REGULAR_SEED_DISCOVERED_ONLY.filter((id) => id.startsWith('l_mm') || id.startsWith('s_mm'))).toEqual(['l_mm02', 's_mm02', 's_mm04']);
    expect(REGULAR_SEED_DISCOVERED_ONLY.some((id) => id.includes('_tr'))).toBe(false);
    for (const prefix of ['_tm', '_ok']) expect(REGULAR_SEED_DISCOVERED_ONLY.some((id) => id.includes(prefix)), prefix).toBe(true);
    const { traveler } = must(buildRegularSeed({ today: TEST_TODAY, spots }));
    for (const rawId of REGULAR_SEED_DISCOVERED_ONLY) {
      const spot = spots.allSpots().find((s) => s.id === rawId);
      expect(spot && traveler.hasDiscovered(spot.id), rawId).toBe(true);
      expect(spot && traveler.hasVisited(spot.id), rawId).toBe(false);
    }
  });

  it('台帳は訪問ごとの基本点（おかえりの日は無いのでボーナスなし）で残高 600', () => {
    const { traveler, ledger } = must(buildRegularSeed({ today: TEST_TODAY, spots }));
    expect(ledger.travelerId).toBe('t_demoregular');
    expect(ledger.version).toBe(0);
    expect(ledger.entries.map((e) => e.entryId)).toEqual(traveler.visits.map((v) => `${v.operationId}:visit`));
    expect(ledger.balance()).toBe(600);
  });

  it('作りたてのシードは古くない。初回の人は判定しない', () => {
    expect(isRegularSeedOutdated(must(buildRegularSeed({ today: TEST_TODAY, spots })).traveler)).toBe(false);
    expect(isRegularSeedOutdated(must(buildFirstSeed({ today: TEST_TODAY, spots })).traveler)).toBe(false);
  });

  it('同じ今日からは同じシードができる（決定論＝DI-05）', () => {
    const a = must(buildRegularSeed({ today: TEST_TODAY, spots }));
    const b = must(buildRegularSeed({ today: TEST_TODAY, spots }));
    expect(a.traveler.toState()).toEqual(b.traveler.toState());
    expect(a.ledger.toState()).toEqual(b.ledger.toState());
  });

  it('主の初期状態（7人のライバル・現職なしで D7）は §4.5／§9.3 の表どおり（30日間どの日に作っても）', () => {
    const catalog = buildScenarioCatalog({ allRivals: true });
    for (let day = 0; day < 30; day += 1) {
      const today = addDays(TEST_TODAY, day);
      const { traveler } = must(buildRegularSeed({ today, spots: catalog.spots }));
      const board = initialLordshipBoard({ travelerId: traveler.id, today, visits: traveler.visits, rivals: catalog.rivals.allRivals(), districts: catalog.spots.allDistricts() });
      const lords = Object.fromEntries(board.entries.map((e) => [e.districtId, e.holder === undefined ? undefined : holderKey(e.holder)]));
      expect(lords, today).toEqual(EXPECTED_LORDS);
      expect(board.entries.some((e) => e.lostByTraveler)).toBe(false);
    }
  });

  it('マスタにシードのスポットが無ければ SPOT_NOT_FOUND', () => {
    const base = buildScenarioCatalog().spots;
    const missing = new TestSpotRepository({ districts: base.allDistricts(), spots: base.allSpots().filter((s) => s.id !== 'l_tm01'), shopEvents: [] });
    const result = buildRegularSeed({ today: TEST_TODAY, spots: missing });
    expect(result.ok ? undefined : result.error.code).toBe('SPOT_NOT_FOUND');
  });
});

describe('buildFirstSeed（初回の人）', () => {
  it('旅人ID t_demofirst・profile first・記録なし・台帳は空', () => {
    const { spots } = buildScenarioCatalog();
    const { traveler, ledger } = must(buildFirstSeed({ today: TEST_TODAY, spots }));
    expect([traveler.id, traveler.profile, traveler.nickname]).toEqual(['t_demofirst', 'first', '初回の人']);
    expect(traveler.visits).toEqual([]);
    expect(traveler.discoveries).toEqual([]);
    expect(ledger.entries).toEqual([]);
  });

  it('buildDemoSeed はプロフィールで振り分ける', () => {
    const { spots } = buildScenarioCatalog();
    expect(must(buildDemoSeed('first', { today: TEST_TODAY, spots })).traveler.id).toBe('t_demofirst');
    expect(must(buildDemoSeed('regular', { today: TEST_TODAY, spots })).traveler.id).toBe('t_demoregular');
  });
});
