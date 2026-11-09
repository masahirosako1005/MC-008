import { describe, expect, it } from 'vitest';
import { parseTravelerId } from '@/Common/types/Id';
import { must, testDistrictId } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { createDemoUseCases, createScenarioWorld, reasonsOf, recordVisit, scenarioOperationId, wireVisitHandlers } from '@/application/testing/scenarioCatalog';
import type { RevisitReason } from '@/domain/revisit/RevisitReason';

/**
 * 再訪理由のうち、種別と地区が一致する最初の1件を返す。
 * @param tw テスト用の世界
 * @param kind 種別
 * @param districtId 地区ID
 * @returns 理由（無ければ undefined）
 */
async function reasonFor(tw: TestWorld, kind: RevisitReason['kind'], districtId: string): Promise<RevisitReason | undefined> {
  return (await reasonsOf(tw)).find((reason) => reason.kind === kind && reason.districtId === districtId);
}

describe('実演シナリオ（CLAUDE.md 7.2、通い慣れた人・ライバル7人。docs/08 §9.3 の新しい ID）', () => {
  it('南森町 Lv3 → +30日で天満が色あせ → ライバル行動で取り返し理由 → 天満再訪で復活・おかえり・金カード → もう1スポットで主を取り返す', async () => {
    const tw = createScenarioWorld({ allRivals: true });
    const handlers = wireVisitHandlers(tw);
    const demo = createDemoUseCases(tw, { enabled: true, lords: handlers.lords });
    must(await demo.switchTraveler.execute({ profile: 'regular' }));
    expect(await reasonFor(tw, 'fade', 'd_okawa')).toMatchObject({ state: 'soon', daysUntilFade: 5 });

    // 手順3: 南森町・天満宮の未訪問スポット（s_mm02）を訪問 → Lv2 → Lv3。主はおまいり番長のまま
    await recordVisit(tw, 's_mm02', scenarioOperationId(1));
    expect(tw.events.ofType('DistrictGrown')).toEqual([expect.objectContaining({ districtId: 'd_minamimori', from: 2, to: 3 })]);
    expect(tw.events.ofType('DistrictLordChanged')).toEqual([]);
    tw.events.clearPublished();

    // 手順4: +30日 → 天満（最終訪問 T−2）が色あせ中になり「色」の理由が出る
    must(await demo.advanceDate.execute({ days: 30 }));
    expect(await reasonFor(tw, 'fade', 'd_tenma')).toMatchObject({ state: 'fading', daysSinceVisit: 32 });
    expect(tw.events.ofType('DistrictLordChanged')).toEqual([]);

    // 手順5: ライバル行動 → 天満の主がおまいり番長に移り「取り返し」の理由（あと2回）
    expect(must(await demo.simulateRival.execute({ operationId: scenarioOperationId(2) }))).toMatchObject({ districtId: 'd_tenma', rivalName: 'おまいり番長', changed: true });
    expect(await reasonFor(tw, 'reclaim', 'd_tenma')).toMatchObject({ lordName: 'おまいり番長', lordCount: 1, myCount: 0, needed: 2 });
    tw.events.clearPublished();

    // 手順6: 天満を再訪 → 復活＋おかえりボーナス（10→15）＋金カード（10回目）。同数なので主はおまいり番長のまま
    await recordVisit(tw, 'l_tm01', scenarioOperationId(3));
    expect(tw.events.ofType('DistrictRevived')).toEqual([expect.objectContaining({ districtId: 'd_tenma', daysSinceLastVisit: 32, level: 3 })]);
    expect(tw.events.ofType('WelcomeBackBonusGranted')).toEqual([expect.objectContaining({ districtId: 'd_tenma', multiplier: 1.5, bonusPoints: 5 })]);
    expect(tw.events.ofType('CardAwarded')).toEqual([expect.objectContaining({ districtId: 'd_tenma', rank: 'gold', reason: 'visits', visitCount: 10 })]);
    expect(tw.events.ofType('DistrictLordChanged')).toEqual([]);
    expect(await reasonFor(tw, 'fade', 'd_tenma')).toBeUndefined();
    tw.events.clearPublished();

    // 続き: 天満の別スポットを訪問 → 1回上回って主を取り返す（おかえりの倍率は当日中有効、復活は出ない）
    await recordVisit(tw, 'l_tm02', scenarioOperationId(4));
    expect(tw.events.ofType('DistrictLordChanged')).toEqual([
      expect.objectContaining({ districtId: 'd_tenma', to: { type: 'traveler' }, fromName: 'おまいり番長', toName: 'あなた', travelerCount: 2, lordCount: 2 }),
    ]);
    expect(tw.events.ofType('DistrictRevived')).toEqual([]);
    expect(tw.events.ofType('PointsAwarded')[0]).toMatchObject({ basePoints: 10, bonusPoints: 5 });
    expect(await reasonFor(tw, 'reclaim', 'd_tenma')).toBeUndefined();
    const board = must(await tw.lordships.find(must(parseTravelerId('t_demoregular'))));
    expect(board.isLostByTraveler(testDistrictId('d_tenma'))).toBe(false);
    expect(must(await tw.ledgers.find(must(parseTravelerId('t_demoregular')))).balance()).toBe(600 + 15 + 15 + 15);
  });
});
