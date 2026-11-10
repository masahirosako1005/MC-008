import { describe, expect, it } from 'vitest';
import type { Result } from '@/Common/result/Result';
import { createTestWorld, must, offsetPoint, seedTraveler, spotOf, TEST_TRAVELER_ID, testOperationId } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { RecordPurchaseUseCase } from '@/application/usecases/reward/RecordPurchaseUseCase';
import { VISIT_RADIUS_M } from '@/domain/exploration/constants';
import { PURCHASE_POINTS } from '@/domain/reward/constants';

/** 失敗コードを取り出す（成功なら undefined） */
function codeOf(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

/** スポットから東へ eastM の位置に立つ */
function standNear(tw: TestWorld, spotId: string, eastM: number): void {
  tw.geo.setPoint(offsetPoint(spotOf(tw.spots, spotId).point, { eastM }));
}

/** 保存済みの台帳の購入の行 */
async function purchaseRows(tw: TestWorld) {
  return must(await tw.ledgers.find(TEST_TRAVELER_ID)).entries.filter((e) => e.kind === 'purchase');
}

describe('RecordPurchaseUseCase', () => {
  it('お店の中なら購入の行を台帳に1行追記し、EXP と累計を返す（イベントは出さない）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    standNear(tw, 's_jo01', 10);
    const out = must(await new RecordPurchaseUseCase(tw).execute({ operationId: testOperationId(1), spotId: 's_jo01' }));
    expect(out).toEqual({ spotId: 's_jo01', districtId: 'd_joka', localDate: '2026-11-09', points: PURCHASE_POINTS, limited: false, duplicate: false, purchasesAtSpot: 1, totalPoints: PURCHASE_POINTS });
    const rows = await purchaseRows(tw);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entryId).toBe(`${testOperationId(1)}:purchase`);
    expect(tw.ledgers.saveCount).toBe(1);
    expect(tw.events.ofType('PointsAwarded')).toHaveLength(0);
  });

  it('同じ operationId の再実行は duplicate=true で、台帳は1行のまま（DI-07）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    standNear(tw, 's_jo01', 10);
    const useCase = new RecordPurchaseUseCase(tw);
    must(await useCase.execute({ operationId: testOperationId(1), spotId: 's_jo01' }));
    standNear(tw, 's_jo01', 5000);
    const again = must(await useCase.execute({ operationId: testOperationId(1), spotId: 's_jo01' }));
    expect(again).toMatchObject({ points: PURCHASE_POINTS, duplicate: true, purchasesAtSpot: 1, totalPoints: PURCHASE_POINTS });
    expect(await purchaseRows(tw)).toHaveLength(1);
    expect(tw.ledgers.saveCount).toBe(1);
  });

  it('同じお店・同じ日の2回目は 0 EXP（limited）で台帳に載せない。次の日はまた付く', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    standNear(tw, 's_jo01', 10);
    const useCase = new RecordPurchaseUseCase(tw);
    must(await useCase.execute({ operationId: testOperationId(1), spotId: 's_jo01' }));
    const second = must(await useCase.execute({ operationId: testOperationId(2), spotId: 's_jo01' }));
    expect(second).toMatchObject({ points: 0, limited: true, duplicate: false, purchasesAtSpot: 1, totalPoints: PURCHASE_POINTS });
    expect(await purchaseRows(tw)).toHaveLength(1);
    tw.clock.setToday('2026-11-10');
    const nextDay = must(await useCase.execute({ operationId: testOperationId(3), spotId: 's_jo01' }));
    expect(nextDay).toMatchObject({ points: PURCHASE_POINTS, limited: false, localDate: '2026-11-10', purchasesAtSpot: 2, totalPoints: PURCHASE_POINTS * 2 });
  });

  it('名所・遠すぎ・精度不足・不正な入力・無いスポットは記録しない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const useCase = new RecordPurchaseUseCase(tw);
    standNear(tw, 'l_jo01', 5);
    expect(codeOf(await useCase.execute({ operationId: testOperationId(1), spotId: 'l_jo01' }))).toBe('NOT_SHOP');
    standNear(tw, 's_jo01', VISIT_RADIUS_M + 20);
    expect(codeOf(await useCase.execute({ operationId: testOperationId(2), spotId: 's_jo01' }))).toBe('OUT_OF_RANGE');
    standNear(tw, 's_jo01', 5);
    tw.geo.setAccuracy(500);
    expect(codeOf(await useCase.execute({ operationId: testOperationId(3), spotId: 's_jo01' }))).toBe('LOW_ACCURACY');
    tw.geo.setAccuracy(10);
    expect(codeOf(await useCase.execute({ operationId: 'not-a-uuid', spotId: 's_jo01' }))).toBe('INVALID_INPUT');
    expect(codeOf(await useCase.execute({ operationId: testOperationId(4), spotId: 's_zz99' }))).toBe('SPOT_NOT_FOUND');
    expect(await purchaseRows(tw)).toHaveLength(0);
    expect(tw.ledgers.saveCount).toBe(0);
  });

  it('台帳の保存が1回競合しても、読み直して1回だけやり直す（DI-10）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    standNear(tw, 's_jo01', 10);
    tw.ledgers.failures.failNext('save', 'CONFLICT');
    const out = must(await new RecordPurchaseUseCase(tw).execute({ operationId: testOperationId(1), spotId: 's_jo01' }));
    expect(out).toMatchObject({ points: PURCHASE_POINTS, duplicate: false });
    expect(await purchaseRows(tw)).toHaveLength(1);
  });

  it('保存に失敗したら STORAGE_FAILED を返し、行は載らない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    standNear(tw, 's_jo01', 10);
    tw.ledgers.failures.failNext('save');
    expect(codeOf(await new RecordPurchaseUseCase(tw).execute({ operationId: testOperationId(1), spotId: 's_jo01' }))).toBe('STORAGE_FAILED');
    expect(await purchaseRows(tw)).toHaveLength(0);
  });
});
