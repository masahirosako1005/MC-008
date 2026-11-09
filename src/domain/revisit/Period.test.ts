import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseShopEventId, parseSpotId } from '@/Common/types/Id';
import { parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { Period } from '@/domain/revisit/Period';
import { isActive, isShopEventKind } from '@/domain/revisit/ShopEvent';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';

/** テスト用: 日付 */
function d(text: string): LocalDate {
  const r = parseLocalDate(text);
  if (!r.ok) throw new Error(text);
  return r.value;
}

/** テスト用: 期間 */
function period(start: string, end: string): Period {
  const r = Period.of(d(start), d(end));
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

describe('Period.of', () => {
  it('開始 ≦ 終了なら作れる（同日も可）', () => {
    expect(Period.of(d('2026-11-01'), d('2026-11-12')).ok).toBe(true);
    expect(Period.of(d('2026-11-12'), d('2026-11-12')).ok).toBe(true);
  });
  it('開始 > 終了は INVALID_INPUT で拒否する（DI-02）', () => {
    const r = Period.of(d('2026-11-13'), d('2026-11-12'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
  });
  it('fromUnknown は書式不正も拒否する', () => {
    expect(Period.fromUnknown('2026-11-01', '2026-11-12').ok).toBe(true);
    expect(Period.fromUnknown('2026-11-01', '2026-02-30').ok).toBe(false);
    expect(Period.fromUnknown(20261101, '2026-11-12').ok).toBe(false);
  });
  it('作った値は変更できない', () => {
    expect(Object.isFrozen(period('2026-11-01', '2026-11-12'))).toBe(true);
  });
});

describe('contains / daysUntilEnd', () => {
  const p = period('2026-11-01', '2026-11-12');

  it('開始日・終了日を含む', () => {
    expect(p.contains(d('2026-10-31'))).toBe(false);
    expect(p.contains(d('2026-11-01'))).toBe(true);
    expect(p.contains(d('2026-11-12'))).toBe(true);
    expect(p.contains(d('2026-11-13'))).toBe(false);
  });
  it('当日終了なら 0、前日なら 1、終了後は負', () => {
    expect(p.daysUntilEnd(d('2026-11-12'))).toBe(0);
    expect(p.daysUntilEnd(d('2026-11-11'))).toBe(1);
    expect(p.daysUntilEnd(d('2026-11-09'))).toBe(3);
    expect(p.daysUntilEnd(d('2026-11-13'))).toBe(-1);
  });
  it('開始前か判定できる', () => {
    expect(p.hasNotStarted(d('2026-10-31'))).toBe(true);
    expect(p.hasNotStarted(d('2026-11-01'))).toBe(false);
  });
  it('JSON にすると start/end だけになる', () => {
    expect(JSON.parse(JSON.stringify(p))).toEqual({ start: '2026-11-01', end: '2026-11-12' });
  });
});

describe('ShopEvent.isActive', () => {
  it('期間内なら true', () => {
    const id = parseShopEventId('c_jo01');
    const spotId = parseSpotId('s_jo01');
    const districtId = parseDistrictId('d_joka');
    if (!id.ok || !spotId.ok || !districtId.ok) throw new Error('fixture');
    const ev: ShopEvent = { id: id.value, spotId: spotId.value, districtId: districtId.value, kind: 'coupon', title: 'どら焼き', description: '', period: period('2026-11-01', '2026-11-12') };
    expect(isActive(ev, d('2026-11-12'))).toBe(true);
    expect(isActive(ev, d('2026-11-13'))).toBe(false);
    expect(isShopEventKind('coupon')).toBe(true);
    expect(isShopEventKind('sale')).toBe(false);
  });
});
