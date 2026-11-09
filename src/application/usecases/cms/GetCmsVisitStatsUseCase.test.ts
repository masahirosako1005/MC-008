/**
 * @file 来店データ（ダミー）の合計のテスト（application/usecases/cms 層）
 * 曜日別・時間帯別の合計が来店数と同じになることを確かめる（合わないと数字全体が信用されない）。
 */
import { describe, expect, it } from 'vitest';
import type { CmsCountDto } from '@/application/dto/CmsDto';
import { apportion, dummyVisitStats } from '@/application/usecases/cms/GetCmsVisitStatsUseCase';
import { parseBusinessHoursText } from '@/domain/spot/BusinessHours';
import type { Spot } from '@/domain/spot/Spot';

/** テスト用の店（ダミーの計算に使うのは ID と協力店かどうかだけ） */
const SHOP = { id: 's_mm04', partner: true } as unknown as Spot;

/** 項目の値の合計（定休日・秘匿は 0 として数える） */
function sumOf(counts: readonly CmsCountDto[]): number {
  return counts.reduce((acc, c) => acc + (c.value ?? 0), 0);
}

describe('apportion', () => {
  it('合計を重みで整数に分け、合計は元と同じ（最大剰余法）', () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(224, [0.8, 0.7, 0.8, 0.9, 1.1, 1.7, 1.6]).reduce((a, n) => a + n, 0)).toBe(224);
  });

  it('重みが 0 の項目には配らない。重みの合計が 0 なら全部 0', () => {
    expect(apportion(7, [0, 1, 0])).toEqual([0, 7, 0]);
    expect(apportion(7, [0, 0])).toEqual([0, 0]);
  });
});

describe('dummyVisitStats', () => {
  it('曜日別・時間帯別の合計は来店数と同じ（定休日・営業時間があっても）', () => {
    for (const hours of [undefined, parseBusinessHoursText('7:00–19:00（月休）'), parseBusinessHoursText('11:00–17:00（日休）')]) {
      const stats = dummyVisitStats({ shop: SHOP, hours, hasCoupon: false }, '2026-11-09');
      const total = stats.visits30d.value ?? 0;
      expect(total).toBeGreaterThan(0);
      expect(sumOf(stats.byWeekday)).toBe(total);
      expect(sumOf(stats.byTimeBand)).toBe(total);
    }
  });
});
