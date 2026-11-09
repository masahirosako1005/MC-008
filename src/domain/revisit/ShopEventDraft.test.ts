/**
 * @file 店舗CMS のクーポン・イベント登録規則のテスト（domain/revisit 層）
 */
import { describe, expect, it } from 'vitest';
import type { DistrictId, SpotId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import { GeoPoint } from '@/domain/exploration/GeoPoint';
import { Period } from '@/domain/revisit/Period';
import { countOpenEvents, normalizeCmsText, periodAfterWithdrawal, validateShopEventDraft } from '@/domain/revisit/ShopEventDraft';
import type { ShopEventDraftInput } from '@/domain/revisit/ShopEventDraft';
import type { Spot } from '@/domain/spot/Spot';

const TODAY = '2026-11-09' as LocalDate;

/** テスト用の店舗 */
function shop(partner: boolean, kind: Spot['kind'] = 'shop'): Spot {
  const point = GeoPoint.of(34.7, 135.5);
  if (!point.ok) throw new Error('point');
  return { id: (kind === 'shop' ? 's_mm04' : 'l_mm01') as SpotId, kind, districtId: 'd_minamimori' as DistrictId, name: '南森町ベーカリー', point: point.value, category: 'パン', description: 'x', amenities: [], hours: '7:00–19:00（日休）', partner };
}

/** テスト用の期間 */
function period(start: string, end: string): Period {
  const p = Period.of(start as LocalDate, end as LocalDate);
  if (!p.ok) throw new Error('period');
  return p.value;
}

/** テスト用の入力 */
function input(overrides: Partial<ShopEventDraftInput> = {}): ShopEventDraftInput {
  return { spot: shop(true), kind: 'coupon', title: 'パン1個おまけ', description: 'レジで画面を見せてください', start: TODAY, end: '2026-11-14', today: TODAY, existing: [], ...overrides };
}

describe('validateShopEventDraft', () => {
  it('協力店の正しい入力は通り、文字は NFC 正規化・前後の空白を除く', () => {
    const result = validateShopEventDraft(input({ title: '  がっこうパン  ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('がっこうパン');
      expect(result.value.period.start).toBe(TODAY);
    }
  });

  it('協力店でない店・名所は NOT_PARTNER', () => {
    expect(validateShopEventDraft(input({ spot: shop(false) })).ok ? '' : 'NOT_PARTNER').toBe('NOT_PARTNER');
    const landmark = validateShopEventDraft(input({ spot: shop(false, 'landmark') }));
    expect(!landmark.ok && landmark.error.code).toBe('NOT_PARTNER');
  });

  it('題名 31字・説明 81字・空・制御文字は INVALID_INPUT（field 付き）', () => {
    const longTitle = validateShopEventDraft(input({ title: 'あ'.repeat(31) }));
    expect(!longTitle.ok && longTitle.error.details?.['field']).toBe('title');
    const longDesc = validateShopEventDraft(input({ description: 'い'.repeat(81) }));
    expect(!longDesc.ok && longDesc.error.details?.['field']).toBe('description');
    expect(validateShopEventDraft(input({ title: '   ' })).ok).toBe(false);
    expect(validateShopEventDraft(input({ title: 'a\u0007b' })).ok).toBe(false);
    expect(validateShopEventDraft(input({ title: 'あ'.repeat(30), description: 'い'.repeat(80) })).ok).toBe(true);
  });

  it('過去の開始日・開始より前の終了日・91日以上は INVALID_INPUT、90日ちょうどは通る', () => {
    expect(validateShopEventDraft(input({ start: '2026-11-08' })).ok).toBe(false);
    expect(validateShopEventDraft(input({ end: '2026-11-08' })).ok).toBe(false);
    expect(validateShopEventDraft(input({ end: '2027-02-06' })).ok).toBe(true);
    expect(validateShopEventDraft(input({ end: '2027-02-07' })).ok).toBe(false);
    expect(validateShopEventDraft(input({ start: 'あした' })).ok).toBe(false);
  });

  it('まだ終わっていないものが3件あると LIMIT_REACHED（終わったものは数えない）', () => {
    const open = [period('2026-11-01', '2026-11-20'), period('2026-11-10', '2026-11-30'), period('2026-12-01', '2026-12-31')];
    const full = validateShopEventDraft(input({ existing: open.map((p) => ({ period: p })) }));
    expect(!full.ok && full.error.code).toBe('LIMIT_REACHED');
    const withEnded = [...open.slice(0, 2), period('2026-10-01', '2026-11-08')].map((p) => ({ period: p }));
    expect(countOpenEvents(withEnded, TODAY)).toBe(2);
    expect(validateShopEventDraft(input({ existing: withEnded })).ok).toBe(true);
  });
});

describe('periodAfterWithdrawal', () => {
  it('期間中に取り下げると前日までに短縮、開始日以前の取り下げは配らない', () => {
    const p = period('2026-11-05', '2026-11-20');
    expect(periodAfterWithdrawal(p, '2026-11-09' as LocalDate)?.toJSON()).toEqual({ start: '2026-11-05', end: '2026-11-08' });
    expect(periodAfterWithdrawal(p, '2026-11-05' as LocalDate)).toBeUndefined();
    expect(periodAfterWithdrawal(p, '2026-11-01' as LocalDate)).toBeUndefined();
    expect(periodAfterWithdrawal(p, '2026-11-30' as LocalDate)?.toJSON()).toEqual({ start: '2026-11-05', end: '2026-11-20' });
  });
});

describe('normalizeCmsText', () => {
  it('文字列以外・空白だけ・上限超えは undefined', () => {
    expect(normalizeCmsText(3, 10)).toBeUndefined();
    expect(normalizeCmsText(' \n ', 10)).toBeUndefined();
    expect(normalizeCmsText('🍞'.repeat(11), 10)).toBeUndefined();
    expect(normalizeCmsText('🍞'.repeat(10), 10)).toBe('🍞'.repeat(10));
  });
});
