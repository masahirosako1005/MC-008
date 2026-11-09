import { describe, expect, it } from 'vitest';
import { createTestWorld, must, seedTraveler } from '@/application/testing/fakes';
import { GetAppStatusUseCase } from '@/application/usecases/session/GetAppStatusUseCase';

describe('GetAppStatusUseCase', () => {
  it('今日・日付と時刻の表示・旅人のプロフィールを返す（デモ操作が無ければ isDemo=false・dayOffset なし）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { profile: 'regular' });
    tw.clock.setTime(9, 41);
    const status = must(await new GetAppStatusUseCase({ session: tw.session, travelers: tw.travelers, clock: tw.clock }).execute());
    expect(status).toEqual({ today: '2026-11-09', dateLabel: '2026/11/09（月）', timeLabel: '9:41', isDemo: false, travelerProfile: 'regular' });
    expect('dayOffset' in status).toBe(false);
  });

  it('デモ操作が渡されていれば isDemo=true とずらし日数を返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { profile: 'first' });
    must(tw.demo.advanceDays(30));
    const status = must(await new GetAppStatusUseCase({ session: tw.session, travelers: tw.travelers, clock: tw.clock, demoControl: tw.demo }).execute());
    expect(status).toMatchObject({ today: '2026-12-09', isDemo: true, dayOffset: 30, travelerProfile: 'first' });
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const tw = createTestWorld();
    const result = await new GetAppStatusUseCase({ session: tw.session, travelers: tw.travelers, clock: tw.clock }).execute();
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });
});
