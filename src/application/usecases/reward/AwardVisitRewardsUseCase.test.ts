import { describe, expect, it } from 'vitest';
import { createTestWorld, must, seedTraveler, TEST_TRAVELER_ID, testOperationId } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { saveVisit } from '@/application/testing/scenarioCatalog';
import { AwardVisitRewardsUseCase } from '@/application/usecases/reward/AwardVisitRewardsUseCase';

/** 台帳の残高と行ID を返す */
async function ledgerOf(tw: TestWorld): Promise<{ balance: number; entryIds: string[] }> {
  const ledger = must(await tw.ledgers.find(TEST_TRAVELER_ID));
  return { balance: ledger.balance(), entryIds: ledger.entries.map((e) => e.entryId) };
}

describe('AwardVisitRewardsUseCase.handle（ポイント）', () => {
  it('名所は基本点 10 を台帳に追記して PointsAwarded を出す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 'l_jo01', testOperationId(1));
    must(await new AwardVisitRewardsUseCase(tw).handle(event));
    expect(await ledgerOf(tw)).toEqual({ balance: 10, entryIds: [`${testOperationId(1)}:visit`] });
    expect(tw.events.ofType('PointsAwarded')[0]).toMatchObject({ districtId: 'd_joka', spotId: 'l_jo01', basePoints: 10, bonusPoints: 0, operationId: testOperationId(1) });
    expect(tw.events.ofType('WelcomeBackBonusGranted')).toEqual([]);
  });

  it('店舗は基本点 15', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    must(await new AwardVisitRewardsUseCase(tw).handle(await saveVisit(tw, 's_jo01', testOperationId(1))));
    expect((await ledgerOf(tw)).balance).toBe(15);
  });
});

describe('AwardVisitRewardsUseCase.handle（おかえりボーナス）', () => {
  it('30日空けて再訪すると1.5倍（差分をボーナス行で追記）し WelcomeBackBonusGranted を出す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -30]] });
    must(await new AwardVisitRewardsUseCase(tw).handle(await saveVisit(tw, 'l_jo01', testOperationId(1))));
    expect(await ledgerOf(tw)).toEqual({ balance: 15, entryIds: [`${testOperationId(1)}:visit`, `${testOperationId(1)}:bonus`] });
    expect(tw.events.types().slice(0, 2)).toEqual(['PointsAwarded', 'WelcomeBackBonusGranted']);
    expect(tw.events.ofType('PointsAwarded')[0]).toMatchObject({ basePoints: 10, bonusPoints: 5 });
    expect(tw.events.ofType('WelcomeBackBonusGranted')[0]).toMatchObject({ districtId: 'd_joka', multiplier: 1.5, bonusPoints: 5 });
  });

  it('同じ日の2回目は復活ではないので WelcomeBackBonusGranted は出ないが、倍率は効く（15→22）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -45]] });
    const handler = new AwardVisitRewardsUseCase(tw);
    must(await handler.handle(await saveVisit(tw, 'l_jo01', testOperationId(1))));
    tw.events.clearPublished();
    must(await handler.handle(await saveVisit(tw, 's_jo01', testOperationId(2))));
    expect(tw.events.ofType('WelcomeBackBonusGranted')).toEqual([]);
    expect(tw.events.ofType('PointsAwarded')[0]).toMatchObject({ basePoints: 15, bonusPoints: 7 });
    expect((await ledgerOf(tw)).balance).toBe(15 + 22);
  });

  it('別の地区の訪問にはおかえりボーナスが付かない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -45], ['l_hm01', -3]] });
    must(await new AwardVisitRewardsUseCase(tw).handle(await saveVisit(tw, 'l_hm02', testOperationId(1))));
    expect(tw.events.ofType('PointsAwarded')[0]).toMatchObject({ basePoints: 10, bonusPoints: 0 });
  });
});

describe('AwardVisitRewardsUseCase.handle（カード・アイテム）', () => {
  it('同じ地区の3回目で銀カード（CardAwarded silver, visitCount 3）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -2], ['s_jo01', -1]] });
    must(await new AwardVisitRewardsUseCase(tw).handle(await saveVisit(tw, 'l_jo02', testOperationId(1))));
    expect(tw.events.ofType('CardAwarded').map((e) => [e.rank, e.reason, e.visitCount, e.districtId])).toEqual([['silver', 'visits', 3, 'd_joka']]);
  });

  it('同じ地区の10回目で金カード（銀は獲得済みなので出ない）', async () => {
    const tw = createTestWorld();
    const visits = [-9, -8, -7, -6, -5, -4, -3, -2, -1].map((day): readonly [string, number] => ['l_hm01', day]);
    await seedTraveler(tw, { visits });
    must(await new AwardVisitRewardsUseCase(tw).handle(await saveVisit(tw, 'l_hm02', testOperationId(1))));
    expect(tw.events.ofType('CardAwarded').map((e) => [e.rank, e.reason, e.visitCount])).toEqual([['gold', 'visits', 10]]);
  });

  it('4回目ではカードは出ない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -3], ['l_jo01', -2], ['l_jo01', -1]] });
    must(await new AwardVisitRewardsUseCase(tw).handle(await saveVisit(tw, 'l_jo01', testOperationId(1))));
    expect(tw.events.ofType('CardAwarded')).toEqual([]);
  });

  it('イベント期間中にそのスポットを訪問するとアイテム「提灯」（ItemAcquired）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    must(await new AwardVisitRewardsUseCase(tw).handle(await saveVisit(tw, 'l_jo01', testOperationId(1))));
    expect(tw.events.ofType('ItemAcquired').map((e) => [e.itemId, e.name])).toEqual([['i_chochin', '提灯']]);
  });

  it('異なる店舗3軒目でアイテム「のぼり」（ItemAcquired）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['s_jo01', -2], ['s_hm01', -1]] });
    must(await new AwardVisitRewardsUseCase(tw).handle(await saveVisit(tw, 's_mi01', testOperationId(1))));
    expect(tw.events.ofType('ItemAcquired').map((e) => [e.itemId, e.name])).toEqual([['i_nobori', 'のぼり']]);
  });
});

describe('AwardVisitRewardsUseCase.handle（冪等・失敗）', () => {
  it('同じイベントで2回呼んでも台帳は増えず、イベントも1回だけ（DI-07）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -30]] });
    const event = await saveVisit(tw, 'l_jo01', testOperationId(1));
    const handler = new AwardVisitRewardsUseCase(tw);
    must(await handler.handle(event));
    must(await handler.handle(event));
    must(await new AwardVisitRewardsUseCase(tw).handle(event));
    expect(await ledgerOf(tw)).toEqual({ balance: 15, entryIds: [`${testOperationId(1)}:visit`, `${testOperationId(1)}:bonus`] });
    expect(tw.ledgers.saveCount).toBe(1);
    // l_jo01 は城下 秋まつり（c_jo03）の期間中なので提灯も1回だけ出る
    expect(tw.events.types()).toEqual(['PointsAwarded', 'WelcomeBackBonusGranted', 'ItemAcquired']);
  });

  it('台帳の保存に失敗したら STORAGE_FAILED でイベントを出さず、再実行で加点できる（DI-12）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 's_jo01', testOperationId(1));
    const handler = new AwardVisitRewardsUseCase(tw);
    tw.ledgers.failures.failNext('save');
    const failed = await handler.handle(event);
    expect(failed.ok ? undefined : failed.error.code).toBe('STORAGE_FAILED');
    expect(tw.events.published).toEqual([]);
    must(await handler.handle(event));
    expect((await ledgerOf(tw)).balance).toBe(15);
  });

  it('台帳の保存が1回競合しても、読み直してやり直し、加点は1回だけ付く（DI-10・DI-11）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 's_jo01', testOperationId(1));
    tw.ledgers.failures.failNext('save', 'CONFLICT');
    must(await new AwardVisitRewardsUseCase(tw).handle(event));
    expect(await ledgerOf(tw)).toEqual({ balance: 15, entryIds: [`${testOperationId(1)}:visit`] });
  });

  it('やり直しても競合したら CONFLICT を返し、加点しない（DI-10）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 's_jo01', testOperationId(1));
    tw.ledgers.failures.failNext('save', 'CONFLICT');
    const handler = new AwardVisitRewardsUseCase(tw);
    const find = tw.ledgers.find.bind(tw.ledgers);
    let finds = 0;
    // 2回目の読込の直後にもう一度競合させる
    tw.ledgers.find = async (id) => {
      finds += 1;
      if (finds === 2) tw.ledgers.failures.failNext('save', 'CONFLICT');
      return find(id);
    };
    const result = await handler.handle(event);
    expect(result.ok ? undefined : result.error.code).toBe('CONFLICT');
    expect((await ledgerOf(tw)).balance).toBe(0);
  });

  it('台帳の読込に失敗したら STORAGE_FAILED', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 's_jo01', testOperationId(1));
    tw.ledgers.failures.failNext('find');
    const result = await new AwardVisitRewardsUseCase(tw).handle(event);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });
});
