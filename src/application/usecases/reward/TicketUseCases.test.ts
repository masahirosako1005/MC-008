import { describe, expect, it } from 'vitest';
import type { Result } from '@/Common/result/Result';
import { createTestWorld, must, offsetPoint, seedTraveler, spotOf, TEST_TRAVELER_ID, testOperationId } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { GetTicketsUseCase } from '@/application/usecases/reward/GetTicketsUseCase';
import { UseTicketUseCase } from '@/application/usecases/reward/UseTicketUseCase';
import { TICKET_CODE_PATTERN, TICKET_PAYLOAD_PREFIX, ticketCodeOf } from '@/application/usecases/reward/tickets';
import type { TravelerId } from '@/Common/types/Id';

/** 失敗コードを取り出す（成功なら undefined） */
function codeOf(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

/** スポットから東へ eastM の位置に立つ */
function standNear(tw: TestWorld, spotId: string, eastM: number): void {
  tw.geo.setPoint(offsetPoint(spotOf(tw.spots, spotId).point, { eastM }));
}

describe('GetTicketsUseCase', () => {
  it('クーポンの期間中にそのお店でクエスト達成していればチケットを持つ（期間前の訪問・イベント・未訪問は持たない）', async () => {
    const tw = createTestWorld();
    // s_jo01（c_jo02 11/01〜11/15）は期間中の 11/05 に訪問。s_jo02（c_jo01 11/01〜11/12）は期間前の 10/20 だけ。
    await seedTraveler(tw, { visits: [['s_jo01', -4], ['s_jo02', -20]] });
    const tickets = must(await new GetTicketsUseCase(tw).execute());
    expect(tickets.map((t) => t.id)).toEqual(['c_jo02']);
    const ticket = tickets[0];
    expect(ticket).toMatchObject({ spotId: 's_jo01', status: 'ready', validUntil: '2026-11-15', daysLeft: 6, earnedOn: '2026-11-05', title: 'ドリンク50円引き' });
    expect(ticket?.code).toMatch(TICKET_CODE_PATTERN);
    expect(ticket?.payload).toBe(`${TICKET_PAYLOAD_PREFIX}:c_jo02:${ticket?.code}`);
    expect(ticket?.payload).not.toContain(TEST_TRAVELER_ID);
  });

  it('期限（クーポン期間の終わり）を過ぎたチケットは出さない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['s_jo01', -4]] });
    tw.clock.setToday('2026-11-16');
    expect(must(await new GetTicketsUseCase(tw).execute())).toEqual([]);
  });

  it('使えるもの（期限の近い順）→ 使用済みの順に並ぶ', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['s_jo01', -4], ['s_jo02', -1]] });
    const before = must(await new GetTicketsUseCase(tw).execute());
    expect(before.map((t) => t.id)).toEqual(['c_jo01', 'c_jo02']);
    standNear(tw, 's_jo02', 10);
    must(await new UseTicketUseCase(tw).execute({ operationId: testOperationId(1), ticketId: 'c_jo01' }));
    const after = must(await new GetTicketsUseCase(tw).execute());
    expect(after.map((t) => [t.id, t.status])).toEqual([['c_jo02', 'ready'], ['c_jo01', 'used']]);
    expect(after[1]?.usedOn).toBe('2026-11-09');
  });

  it('コードは旅人とクーポンで決まる（同じなら同じ、違えば違う）', () => {
    const a = ticketCodeOf(TEST_TRAVELER_ID, 'c_jo02');
    expect(ticketCodeOf(TEST_TRAVELER_ID, 'c_jo02')).toBe(a);
    expect(ticketCodeOf(TEST_TRAVELER_ID, 'c_jo01')).not.toBe(a);
    expect(ticketCodeOf('t_other01' as TravelerId, 'c_jo02')).not.toBe(a);
    expect(a).toMatch(TICKET_CODE_PATTERN);
  });
});

describe('UseTicketUseCase', () => {
  it('お店から80m以内なら使用済みにして保存する。同じ operationId の再実行は duplicate=true（DI-07）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['s_jo01', -4]] });
    standNear(tw, 's_jo01', 30);
    const useCase = new UseTicketUseCase(tw);
    const first = must(await useCase.execute({ operationId: testOperationId(1), ticketId: 'c_jo02' }));
    expect(first).toEqual({ ticketId: 'c_jo02', usedOn: '2026-11-09', duplicate: false });
    standNear(tw, 's_jo01', 5000);
    const second = must(await useCase.execute({ operationId: testOperationId(1), ticketId: 'c_jo02' }));
    expect(second.duplicate).toBe(true);
    const stored = must(await tw.travelers.findById(TEST_TRAVELER_ID));
    expect(stored?.redemptions.map((r) => r.shopEventId)).toEqual(['c_jo02']);
  });

  it('別の操作でもう一度使おうとすると ALREADY_REDEEMED', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['s_jo01', -4]] });
    standNear(tw, 's_jo01', 10);
    const useCase = new UseTicketUseCase(tw);
    must(await useCase.execute({ operationId: testOperationId(1), ticketId: 'c_jo02' }));
    expect(codeOf(await useCase.execute({ operationId: testOperationId(2), ticketId: 'c_jo02' }))).toBe('ALREADY_REDEEMED');
  });

  it('お店から遠いと OUT_OF_RANGE（何も保存しない）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['s_jo01', -4]] });
    standNear(tw, 's_jo01', 300);
    const saves = tw.travelers.saveCount;
    expect(codeOf(await new UseTicketUseCase(tw).execute({ operationId: testOperationId(1), ticketId: 'c_jo02' }))).toBe('OUT_OF_RANGE');
    expect(tw.travelers.saveCount).toBe(saves);
  });

  it('まだ獲得していない・無いチケット・形の違う入力は使えない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['s_jo02', -20]] });
    standNear(tw, 's_jo02', 10);
    const useCase = new UseTicketUseCase(tw);
    expect(codeOf(await useCase.execute({ operationId: testOperationId(1), ticketId: 'c_jo01' }))).toBe('TICKET_NOT_FOUND');
    expect(codeOf(await useCase.execute({ operationId: testOperationId(2), ticketId: 'c_zz99' }))).toBe('TICKET_NOT_FOUND');
    expect(codeOf(await useCase.execute({ operationId: 'bad', ticketId: 'c_jo01' }))).toBe('INVALID_INPUT');
    expect(codeOf(await useCase.execute({ operationId: testOperationId(3), ticketId: '<script>' }))).toBe('INVALID_INPUT');
  });
});
