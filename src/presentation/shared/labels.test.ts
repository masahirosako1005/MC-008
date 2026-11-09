import { describe, expect, it } from 'vitest';
import { AMENITY_LABELS, AMENITY_ORDER, amenityLabel, distanceLabel, fadeLabel, KIND_LABELS, lastVisitLabel, levelLabel, visitCountLabel } from '@/presentation/shared/labels';

describe('便利情報のラベル', () => {
  it('6種の表示名を持つ（CLAUDE.md 4.7）', () => {
    expect(AMENITY_ORDER.map((a) => AMENITY_LABELS[a])).toEqual(['子連れ歓迎', 'トイレ', '授乳室', 'ベビーカーOK', '雨の日OK', '駐車場']);
  });
  it('未知の値は undefined', () => {
    expect(amenityLabel('rainOk')).toBe('雨の日OK');
    expect(amenityLabel('pool')).toBeUndefined();
    expect(amenityLabel('constructor')).toBeUndefined();
  });
});

describe('種別と成長段階', () => {
  it('種別は 名所／店舗（「施設」は使わない）', () => {
    expect(KIND_LABELS).toEqual({ landmark: '名所', shop: '店舗' });
    expect(Object.values(KIND_LABELS).join('')).not.toContain('施設');
  });
  it('Lv は 0〜3 に丸める', () => {
    expect(levelLabel(2)).toBe('Lv2');
    expect(levelLabel(7)).toBe('Lv3');
    expect(levelLabel(-1)).toBe('Lv0');
    expect(levelLabel(Number.NaN)).toBe('Lv0');
  });
});

describe('色あせのラベル', () => {
  it('soon は「あと n 日で色あせ」、fading は「色あせ中」、それ以外は出さない', () => {
    expect(fadeLabel({ kind: 'soon', daysUntilFade: 5 })).toBe('あと5日で色あせ');
    expect(fadeLabel({ kind: 'soon' })).toBe('そろそろ色あせ');
    expect(fadeLabel({ kind: 'fading', progress: 0.2 })).toBe('色あせ中');
    expect(fadeLabel({ kind: 'fresh', daysSinceVisit: 3 })).toBeUndefined();
    expect(fadeLabel({ kind: 'never' })).toBeUndefined();
  });
  it('最終訪問の表示', () => {
    expect(lastVisitLabel({ kind: 'soon', daysSinceVisit: 25 })).toBe('最終訪問 25日前');
    expect(lastVisitLabel({ kind: 'fresh', daysSinceVisit: 0 })).toBe('今日訪問');
    expect(lastVisitLabel({ kind: 'never' })).toBe('まだ訪れていない');
  });
});

describe('回数と距離', () => {
  it('通った回数（網羅率ではなく回数を出す）', () => {
    expect(visitCountLabel(3)).toBe('通った回数 3回');
    expect(visitCountLabel(0)).toBe('まだ訪れていない');
    expect(visitCountLabel(3)).not.toMatch(/%|件中/);
  });
  it('距離は m／km 表記', () => {
    expect(distanceLabel(62)).toBe('62m');
    expect(distanceLabel(1200)).toBe('1.2km');
  });
});
