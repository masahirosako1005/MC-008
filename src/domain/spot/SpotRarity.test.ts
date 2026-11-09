import { describe, expect, it } from 'vitest';
import type { Spot } from '@/domain/spot/Spot';
import { isAwakened, legendSpotIdsOf, rarityOf } from '@/domain/spot/SpotRarity';

/** レア度の判定に使う項目だけを持つスポット */
function spot(id: string, kind: 'landmark' | 'shop', districtId: string, partner = false): Spot {
  return { id, kind, districtId, partner } as unknown as Spot;
}

describe('SpotRarity', () => {
  const spots = [spot('l_jo02', 'landmark', 'd_joka'), spot('l_jo01', 'landmark', 'd_joka'), spot('l_mi01', 'landmark', 'd_minato'), spot('s_jo01', 'shop', 'd_joka', true), spot('s_jo02', 'shop', 'd_joka')];
  const legends = legendSpotIdsOf(spots);

  it('地区ごとに ID 順で先頭の名所がレジェンド', () => {
    expect([...legends].sort()).toEqual(['l_jo01', 'l_mi01']);
  });

  it('レジェンド4・名所3・協力店2・店舗1', () => {
    expect(spots.map((s) => rarityOf(s, legends))).toEqual([3, 4, 4, 2, 1]);
  });

  it('レジェンドは四季すべてで覚醒。それ以外のレア度や3季では覚醒しない', () => {
    expect(isAwakened(4, ['spring', 'summer', 'autumn', 'winter'])).toBe(true);
    expect(isAwakened(4, ['spring', 'summer', 'autumn'])).toBe(false);
    expect(isAwakened(3, ['spring', 'summer', 'autumn', 'winter'])).toBe(false);
  });
});
