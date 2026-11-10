/**
 * @file vitality のテスト（地区の活気・雰囲気、お店単位の陣取り、奪われた／奪還の変化の検出）
 */
import { describe, expect, it } from 'vitest';
import { computeVitality, moodOf, vitalityChanges, vitalityOf } from '@/presentation/screens/Map/town/vitality';
import type { VitalityDistrictInput, VitalitySpotInput } from '@/presentation/screens/Map/town/vitality';

const fresh = { kind: 'fresh' } as const;

/**
 * 地区を作る。
 * @param over 上書きする項目
 * @returns 地区
 */
function district(over: Partial<VitalityDistrictInput>): VitalityDistrictInput {
  return { id: 'd1', level: 1, isLordMe: false, fade: fresh, ...over };
}

/**
 * 地区 d1 のお店を n 軒作る（先頭から visits の回数だけ達成済み）。
 * @param n 軒数
 * @param visits 先頭から順の達成回数
 * @returns スポット
 */
function shops(n: number, visits: readonly number[]): VitalitySpotInput[] {
  return Array.from({ length: n }, (_, i) => ({ id: `s${i}`, kind: 'shop', districtId: 'd1', visitCount: visits[i] ?? 0 }));
}

describe('vitalityOf / moodOf', () => {
  it('自分が領主ならにぎやか、成長段階が高いほど活気がある', () => {
    const low = vitalityOf(district({ isLordMe: true, level: 0 }), true);
    const high = vitalityOf(district({ isLordMe: true, level: 3 }), true);
    expect(high).toBeGreaterThan(low);
    expect(moodOf(low, false)).toBe('lively');
  });

  it('ライバルが領主で自分の回数が少ないほど廃れる', () => {
    const near = vitalityOf(district({ lordName: '番長', lordCount: 10, myCount: 9 }), true);
    const far = vitalityOf(district({ lordName: '番長', lordCount: 10, myCount: 1 }), true);
    expect(far).toBeLessThan(near);
    expect(moodOf(far, true)).toBe('decaying');
  });

  it('まだ行ったことのないライバルの地区は「ふつう」（初めての人の地図を暗くしない）', () => {
    const v = vitalityOf(district({ lordName: '番長', lordCount: 10, myCount: 0 }), false);
    expect(moodOf(v, true)).toBe('calm');
  });

  it('奪われた地区は廃れる', () => {
    const v = vitalityOf(district({ lordName: '番長', lordCount: 10, myCount: 5, lordLost: true }), true);
    expect(moodOf(v, true)).toBe('decaying');
  });

  it('色あせ中は活気が下がる（見た目だけ）', () => {
    const base = vitalityOf(district({ isLordMe: true }), true);
    const faded = vitalityOf(district({ isLordMe: true, fade: { kind: 'fading', progress: 1 } }), true);
    expect(faded).toBeLessThan(base);
  });
});

describe('computeVitality', () => {
  it('自分が領主の地区では、達成済みのお店がすべて自分のもの', () => {
    const model = computeVitality([district({ isLordMe: true })], shops(6, [2, 1]));
    expect(model.byDistrict.get('d1')?.mineSpotIds).toEqual(['s0', 's1']);
    expect(model.byDistrict.get('d1')?.rivalSpotIds).toEqual([]);
  });

  it('奪われた地区では、通った回数の少ないお店から奪われる', () => {
    const model = computeVitality([district({ lordName: '番長', lordCount: 12, myCount: 2, lordLost: true })], shops(8, [5, 1, 3]));
    const d = model.byDistrict.get('d1');
    expect(d?.rivalSpotIds).toContain('s1');
    expect(d?.mineSpotIds).toContain('s0');
    expect(model.ownerOf.get('s1')).toBe('rival');
  });

  it('同じ入力なら同じ結果（乱数を使わない）', () => {
    const input = [district({ lordName: '番長', lordCount: 6, myCount: 1 })];
    expect(computeVitality(input, shops(10, [])).byDistrict.get('d1')?.rivalSpotIds).toEqual(computeVitality(input, shops(10, [])).byDistrict.get('d1')?.rivalSpotIds);
  });
});

describe('vitalityChanges', () => {
  it('奪われると down、奪還すると up', () => {
    const mine = computeVitality([district({ isLordMe: true })], shops(6, [2, 1]));
    const lost = computeVitality([district({ lordName: '番長', lordCount: 9, myCount: 1, lordLost: true })], shops(6, [2, 1]));
    expect(vitalityChanges(mine, lost)).toEqual([{ districtId: 'd1', direction: 'down' }]);
    expect(vitalityChanges(lost, mine)).toEqual([{ districtId: 'd1', direction: 'up' }]);
    expect(vitalityChanges(undefined, mine)).toEqual([]);
  });
});
