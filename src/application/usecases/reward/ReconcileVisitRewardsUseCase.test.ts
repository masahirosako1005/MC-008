import { describe, expect, it } from 'vitest';
import { createTestWorld, must, seedTraveler, TEST_TRAVELER_ID, testOperationId } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { saveVisit } from '@/application/testing/scenarioCatalog';
import { AwardVisitRewardsUseCase } from '@/application/usecases/reward/AwardVisitRewardsUseCase';
import { ReconcileVisitRewardsUseCase } from '@/application/usecases/reward/ReconcileVisitRewardsUseCase';

/** テスト用: 付け直しのユースケースを作る */
function reconcilerOf(tw: TestWorld): ReconcileVisitRewardsUseCase {
  return new ReconcileVisitRewardsUseCase({ ...tw, award: new AwardVisitRewardsUseCase(tw) });
}

/** テスト用: 台帳の残高 */
async function balanceOf(tw: TestWorld): Promise<number> {
  return must(await tw.ledgers.find(TEST_TRAVELER_ID)).balance();
}

describe('ReconcileVisitRewardsUseCase', () => {
  it('訪問だけ保存されて加点が抜けた訪問に、あとから EXP を付ける（DI-11）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    await saveVisit(tw, 'l_jo01', testOperationId(1)); // 訪問は保存したが、加点のハンドラは走っていない
    expect(await balanceOf(tw)).toBe(0);
    expect(must(await reconcilerOf(tw).execute())).toEqual({ missing: 1, recovered: 1 });
    expect(await balanceOf(tw)).toBe(10);
  });

  it('もう一度呼んでも二重には付かない（DI-07）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    await saveVisit(tw, 'l_jo01', testOperationId(1));
    must(await reconcilerOf(tw).execute());
    expect(must(await reconcilerOf(tw).execute())).toEqual({ missing: 0, recovered: 0 });
    expect(await balanceOf(tw)).toBe(10);
  });

  it('加点済みの訪問には何もしない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    must(await new AwardVisitRewardsUseCase(tw).handle(await saveVisit(tw, 's_jo01', testOperationId(1))));
    expect(must(await reconcilerOf(tw).execute())).toEqual({ missing: 0, recovered: 0 });
    expect(await balanceOf(tw)).toBe(15);
  });
});
