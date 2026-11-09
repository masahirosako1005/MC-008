import { describe, expect, it } from 'vitest';
import { parseRivalId } from '@/Common/types/Id';
import { holderKey, isTravelerHolder, parseLordHolder, rivalHolder, sameHolder, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';

const taro = parseRivalId('r_taro');
const hana = parseRivalId('r_hana');
if (!taro.ok || !hana.ok) throw new Error('fixture');
const TARO = rivalHolder(taro.value);
const HANA = rivalHolder(hana.value);

describe('LordHolder', () => {
  it('sameHolder は旅人どうし・同じライバルどうしを同じとみなす', () => {
    expect(sameHolder(TRAVELER_HOLDER, { type: 'traveler' })).toBe(true);
    expect(sameHolder(TARO, rivalHolder(taro.value))).toBe(true);
    expect(sameHolder(TARO, HANA)).toBe(false);
    expect(sameHolder(TRAVELER_HOLDER, TARO)).toBe(false);
  });
  it('主なし（undefined）どうしは同じ、片方だけなら違う', () => {
    expect(sameHolder(undefined, undefined)).toBe(true);
    expect(sameHolder(undefined, TARO)).toBe(false);
    expect(sameHolder(TRAVELER_HOLDER, undefined)).toBe(false);
  });
  it('holderKey は一意な文字列', () => {
    expect(holderKey(TRAVELER_HOLDER)).toBe('traveler');
    expect(holderKey(TARO)).toBe('rival:r_taro');
    expect(isTravelerHolder(TRAVELER_HOLDER)).toBe(true);
    expect(isTravelerHolder(TARO)).toBe(false);
    expect(isTravelerHolder(undefined)).toBe(false);
  });
  it('保存データから復元し、不正な値を拒否する', () => {
    expect(parseLordHolder({ type: 'traveler' }).ok).toBe(true);
    const r = parseLordHolder({ type: 'rival', rivalId: 'r_taro' });
    expect(r.ok && sameHolder(r.value, TARO)).toBe(true);
    for (const bad of [{ type: 'rival', rivalId: 'x' }, { type: 'admin' }, null, 'traveler']) {
      expect(parseLordHolder(bad).ok).toBe(false);
    }
  });
});
