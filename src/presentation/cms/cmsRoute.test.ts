/**
 * @file 店舗CMS のルートのテスト（presentation/cms 層）
 */
import { describe, expect, it } from 'vitest';
import { cmsHashOf, parseCmsHash } from '@/presentation/cms/cmsRoute';

describe('parseCmsHash', () => {
  it('店とページを読み、往復できる', () => {
    expect(parseCmsHash('#/s_mm04/events')).toEqual({ spotId: 's_mm04', page: 'events' });
    expect(parseCmsHash(cmsHashOf('s_tm01', 'data'))).toEqual({ spotId: 's_tm01', page: 'data' });
  });

  it('不正なページはホーム、不正な店は捨てる（SEC-16）', () => {
    expect(parseCmsHash('#/s_mm04/admin')).toEqual({ spotId: 's_mm04', page: 'home' });
    expect(parseCmsHash('#/<script>/info')).toEqual({ page: 'info' });
    expect(parseCmsHash('')).toEqual({ page: 'home' });
    expect(parseCmsHash('#/')).toEqual({ page: 'home' });
  });
});
