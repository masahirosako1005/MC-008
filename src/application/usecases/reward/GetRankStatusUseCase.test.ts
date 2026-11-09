import { describe, expect, it } from 'vitest';
import { addDays, jstInstantOf } from '@/Common/utils/date';
import { createTestWorld, districtOf, must, seedLordship, seedTraveler, spotOf, TEST_TODAY, TEST_TRAVELER_ID, testOperationId } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { GetRankStatusUseCase, RANK_HISTORY_LIMIT } from '@/application/usecases/reward/GetRankStatusUseCase';
import { createLedgerEntry } from '@/domain/reward/LedgerEntry';
import type { LedgerEntry, LedgerEntryKind } from '@/domain/reward/LedgerEntry';
import { PointLedger } from '@/domain/reward/PointLedger';

/** 城下に3回（銀カード）、みなと・湯の里に1回ずつ通った旅人の訪問 */
const VISITS: readonly (readonly [string, number])[] = [['l_jo01', -6], ['l_jo01', -4], ['l_jo01', -2], ['l_mi01', -3], ['l_yu01', -1]];

/** 台帳の行の指定: [番号, 種別, ポイント, スポットID, 今日からの日数] */
type EntrySeed = readonly [number, LedgerEntryKind, number, string, number];

/**
 * 台帳の行を作る。
 * @param tw テスト用の世界
 * @param seed 指定
 * @returns 台帳の行
 */
function entryOf(tw: TestWorld, [n, kind, points, spotId, offset]: EntrySeed): LedgerEntry {
  const spot = spotOf(tw.spots, spotId);
  const localDate = addDays(TEST_TODAY, offset);
  return must(createLedgerEntry({ operationId: testOperationId(n), kind, points, districtId: spot.districtId, spotId: spot.id, at: jstInstantOf(localDate, 10), localDate }));
}

/**
 * 台帳を指定どおりに保存する。
 * @param tw テスト用の世界
 * @param seeds 行の指定（古い順）
 */
async function seedLedger(tw: TestWorld, seeds: readonly EntrySeed[]): Promise<void> {
  const ledger = must(PointLedger.empty(TEST_TRAVELER_ID).append(seeds.map((s) => entryOf(tw, s))));
  must(await tw.ledgers.save(ledger, 0));
}

describe('GetRankStatusUseCase', () => {
  it('累計ポイントからいまの段・次の段・すべての段と、通いの実績・旅の日数を返す（網羅率は返さない）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: VISITS });
    await seedLordship(tw, [{ districtId: 'd_joka', holder: 'traveler' }]);
    await seedLedger(tw, [
      [1, 'visit', 10, 'l_jo01', -6],
      [2, 'visit', 10, 'l_jo01', -4],
      [3, 'visit', 10, 'l_mi01', -3],
      [4, 'visit', 10, 'l_jo01', -2],
      [4, 'welcomeBack', 5, 'l_jo01', -2],
      [5, 'visit', 15, 'l_yu01', -1],
    ]);
    const status = must(await new GetRankStatusUseCase(tw).execute());
    expect(status.points).toBe(60);
    expect(status.rank).toMatchObject({ name: '冒険者', index: 1, nextName: 'ベテラン冒険者', nextAt: 150, remaining: 90 });
    expect(status.steps.map((s) => s.state)).toEqual(['reached', 'current', 'locked', 'locked', 'locked']);
    expect(status.steps.map((s) => s.min)).toEqual([...status.steps.map((s) => s.min)].sort((a, b) => a - b));
    expect(status).toMatchObject({ totalVisits: 5, visitedSpots: 3, silverCards: 1, goldCards: 0 });
    expect(status.lordDistricts).toEqual([districtOf(tw.spots, 'd_joka').shortName]);
    expect(status.travelDays).toBe(7);
    expect(status.rules).toEqual({ landmarkPoints: 10, shopPoints: 15, welcomeBackMultiplier: 1.5 });
    expect(Object.keys(status)).not.toContain('rate');
  });

  it('最近のポイントは新しい順に最大5件。同じ訪問ではボーナスを先に出す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: VISITS });
    await seedLedger(tw, [
      [1, 'visit', 10, 'l_jo01', -6],
      [2, 'visit', 10, 'l_jo01', -4],
      [3, 'visit', 10, 'l_mi01', -3],
      [4, 'visit', 10, 'l_jo01', -2],
      [4, 'welcomeBack', 5, 'l_jo01', -2],
      [5, 'visit', 15, 'l_yu01', -1],
    ]);
    const { recent } = must(await new GetRankStatusUseCase(tw).execute());
    expect(recent).toHaveLength(RANK_HISTORY_LIMIT);
    expect(recent.map((r) => [r.kind, r.points])).toEqual([
      ['visit', 15],
      ['welcomeBack', 5],
      ['visit', 10],
      ['visit', 10],
      ['visit', 10],
    ]);
    expect(recent[0]).toMatchObject({ spotName: spotOf(tw.spots, 'l_yu01').name, spotKind: 'landmark', date: '2026-11-08' });
    expect(recent[0]?.districtName.length).toBeGreaterThan(0);
  });

  it('まだ訪れていない旅人は最初の段で、最近のポイント・旅の日数は空', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const status = must(await new GetRankStatusUseCase(tw).execute());
    expect(status.rank).toMatchObject({ index: 0, nextAt: 50, remaining: 50 });
    expect(status.steps[0]?.state).toBe('current');
    expect(status).toMatchObject({ points: 0, totalVisits: 0, visitedSpots: 0, recent: [], lordDistricts: [] });
    expect(status.travelDays).toBeUndefined();
  });

  it('最上段では次の段を返さない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: VISITS });
    await seedLedger(tw, [[1, 'visit', 900, 'l_jo01', -6]]);
    const status = must(await new GetRankStatusUseCase(tw).execute());
    expect(status.rank.index).toBe(status.steps.length - 1);
    expect(status.rank.nextName).toBeUndefined();
    expect(status.rank.remaining).toBeUndefined();
    expect(status.steps.every((s, i) => s.state === (i === status.steps.length - 1 ? 'current' : 'reached'))).toBe(true);
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const result = await new GetRankStatusUseCase(createTestWorld()).execute();
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });
});
