import { describe, expect, it } from 'vitest';
import type { TicketDto } from '@/application/dto/Dto';
import { newTicketIds, readyCountOf } from '@/presentation/screens/Map/town/TicketWallet';

/** テスト用のチケット */
function ticket(id: string, status: 'ready' | 'used' = 'ready'): TicketDto {
  return { id, spotId: 's_x01', spotName: 'お店', districtId: 'd_x', title: 't', description: '', validUntil: '2026-11-15', daysLeft: 5, earnedOn: '2026-11-05', status, code: 'MQ-2222-2222', payload: 'p' };
}

describe('TicketWallet', () => {
  it('newTicketIds: チェックインで増えたチケットだけを返す', () => {
    expect(newTicketIds([ticket('c_a01')], [ticket('c_a01'), ticket('c_b01')])).toEqual(['c_b01']);
    expect(newTicketIds([ticket('c_a01')], [ticket('c_a01', 'used')])).toEqual([]);
    expect(newTicketIds([], [])).toEqual([]);
  });

  it('readyCountOf: 使えるチケットだけ数える', () => {
    expect(readyCountOf([ticket('c_a01'), ticket('c_b01', 'used'), ticket('c_c01')])).toBe(2);
  });
});
