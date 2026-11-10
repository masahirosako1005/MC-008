import { describe, expect, it } from 'vitest';
import { addDays, jstInstantOf } from '@/Common/utils/date';
import { createTestWorld, districtOf, must, seedLordship, seedTraveler, spotOf, TEST_TODAY, TEST_TRAVELER_ID, testOperationId } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { GetRankStatusUseCase, RANK_HISTORY_LIMIT, rankPerksOf } from '@/application/usecases/reward/GetRankStatusUseCase';
import { avatarPartOf } from '@/domain/avatar/AvatarCatalog';
import { RANK_THRESHOLDS } from '@/domain/reward/constants';
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
    expect(status.rules).toEqual({ landmarkPoints: 10, shopPoints: 15, welcomeBackMultiplier: 1.5, purchasePoints: 10 });
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

describe('EXP の特典（rankPerksOf）', () => {
  it('手に入る EXP の小さい順に並べ、届いたものは獲得済み・まだのうち最小が次の特典・残りはまだ', () => {
    const perks = rankPerksOf(600);
    const ats = perks.map((p) => p.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(perks.filter((p) => p.at <= 600).every((p) => p.state === 'earned')).toBe(true);
    expect(perks.filter((p) => p.state === 'next')).toHaveLength(1);
    expect(perks.find((p) => p.state === 'next')?.at).toBe(Math.min(...ats.filter((at) => at > 600)));
    expect(perks.filter((p) => p.at > 600 && p.state !== 'next').every((p) => p.state === 'locked')).toBe(true);
  });

  it('閾値ちょうどで獲得済みになり、ランクの閾値の特典には段の添字が付く', () => {
    const perks = rankPerksOf(RANK_THRESHOLDS[1]?.min ?? 0);
    const rankUp = perks.find((p) => p.at === RANK_THRESHOLDS[1]?.min);
    expect(rankUp).toMatchObject({ state: 'earned', rankIndex: 1 });
    expect(perks.filter((p) => p.rankIndex !== undefined).map((p) => p.rankIndex)).toEqual(RANK_THRESHOLDS.slice(1).map((_, i) => i + 1));
  });

  it('すべてのランクアップ（最初の段を除く）に特典があり、部品はアバターのカタログにある', () => {
    const perks = rankPerksOf(0);
    for (const threshold of RANK_THRESHOLDS.slice(1)) expect(perks.some((p) => p.at === threshold.min)).toBe(true);
    for (const part of perks.flatMap((p) => p.parts)) expect(avatarPartOf(part.id)?.unlock).toEqual({ kind: 'exp', points: perks.find((p) => p.parts.includes(part))?.at });
    expect(perks[0]?.state).toBe('next');
  });

  it('全部手に入れたら次の特典は無い', () => {
    const perks = rankPerksOf(1_000_000);
    expect(perks.every((p) => p.state === 'earned')).toBe(true);
  });

  it('ランク画面の中身に特典が入る', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    await seedLedger(tw, [[1, 'visit', 30, 'l_jo01', -1]]);
    const dto = must(await new GetRankStatusUseCase(tw).execute());
    expect(dto.perks?.find((p) => p.state === 'next')?.at).toBe(rankPerksOf(30).find((p) => p.state === 'next')?.at);
    expect(dto.perks?.filter((p) => p.state === 'earned').every((p) => p.at <= 30)).toBe(true);
  });
});
