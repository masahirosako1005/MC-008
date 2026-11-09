import { describe, expect, it } from 'vitest';
import { DEFAULT_PATH, MAX_HASH_LENGTH, normalizeHashPath, resolveRoute } from '@/presentation/App/AppRouter';

describe('normalizeHashPath', () => {
  it('# や / の有無・末尾の / ・クエリをそろえる', () => {
    expect(normalizeHashPath('#/map')).toBe('#/map');
    expect(normalizeHashPath('/map/')).toBe('#/map');
    expect(normalizeHashPath('map')).toBe('#/map');
    expect(normalizeHashPath('#/spot/l_jo01?x=1')).toBe('#/spot/l_jo01');
  });
  it('空なら空文字', () => {
    expect(normalizeHashPath('')).toBe('');
    expect(normalizeHashPath('#')).toBe('');
    expect(normalizeHashPath('#/')).toBe('');
  });
});

describe('resolveRoute', () => {
  it('各画面のルートを解決する', () => {
    expect(resolveRoute('#/map', false).match).toEqual({ name: 'map', params: {}, path: '#/map' });
    expect(resolveRoute('#/map/d_joka', false).match).toEqual({ name: 'map', params: { districtId: 'd_joka' }, path: '#/map/d_joka' });
    expect(resolveRoute('#/spot/s_hm01', false).match).toEqual({ name: 'spot', params: { spotId: 's_hm01' }, path: '#/spot/s_hm01' });
    for (const name of ['zukan', 'avatar', 'rank', 'ranking', 'settings'] as const) {
      expect(resolveRoute(`#/${name}`, false)).toEqual({ match: { name, params: {}, path: `#/${name}` }, redirected: false });
    }
    expect(resolveRoute('#/zukan/d_minato', false).match.params).toEqual({ districtId: 'd_minato' });
  });
  it('空の hash は地図へ（理由 empty）', () => {
    expect(resolveRoute('', false)).toEqual({ match: { name: 'map', params: {}, path: DEFAULT_PATH }, redirected: true, reason: 'empty' });
  });
  it('ID 形式を満たさないパラメータは地図へ戻す（SEC-16）', () => {
    for (const bad of ['#/spot/d_joka', '#/spot/<script>', '#/spot/l_JO01', '#/map/s_hm01', '#/map/d_', '#/spot/%6c_jo01']) {
      const r = resolveRoute(bad, true);
      expect(r.redirected).toBe(true);
      expect(r.reason).toBe('invalid-param');
      expect(r.match.path).toBe(DEFAULT_PATH);
    }
  });
  it('未知のルートは地図へ戻す', () => {
    for (const bad of ['#/unknown', '#/spot', '#/spot/l_jo01/extra', '#/map/d_joka/x']) {
      expect(resolveRoute(bad, true)).toMatchObject({ redirected: true, reason: 'unknown' });
    }
  });
  it('#/demo はデモビルドのときだけ有効（SEC-02）', () => {
    expect(resolveRoute('#/demo', true)).toEqual({ match: { name: 'demo', params: {}, path: '#/demo' }, redirected: false });
    expect(resolveRoute('#/demo', false)).toMatchObject({ redirected: true, reason: 'demo-disabled', match: { name: 'map' } });
  });
  it('長すぎる hash は検証せずに地図へ戻す', () => {
    expect(resolveRoute(`#/spot/${'a'.repeat(MAX_HASH_LENGTH)}`, true)).toMatchObject({ redirected: true, reason: 'too-long' });
  });
});
