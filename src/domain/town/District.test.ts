import { describe, expect, it } from 'vitest';
import { parseDistrictId } from '@/Common/types/Id';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';
import { distanceToPolygonEdgeM, findDistrictAt, isHexColor, isPointInPolygon, sortDistrictsByOrder } from '@/domain/town/District';
import type { District } from '@/domain/town/District';

/** 約 220m 四方の正方形（北緯34.69°付近） */
const SQUARE: readonly GeoPoint[] = [
  { lat: 34.69, lng: 135.195 },
  { lat: 34.69, lng: 135.1974 },
  { lat: 34.692, lng: 135.1974 },
  { lat: 34.692, lng: 135.195 },
];

/** テスト用: 地区 */
function district(id: string, order: number, polygon: readonly GeoPoint[]): District {
  const parsed = parseDistrictId(id);
  if (!parsed.ok) throw new Error(id);
  return { id: parsed.value, name: id, shortName: id, theme: 't', order, color: '#7a5ea8', center: SQUARE[0]!, entrance: SQUARE[0]!, polygon };
}

describe('isPointInPolygon', () => {
  it('内側は true、外側は false', () => {
    expect(isPointInPolygon({ lat: 34.691, lng: 135.196 }, SQUARE)).toBe(true);
    expect(isPointInPolygon({ lat: 34.693, lng: 135.196 }, SQUARE)).toBe(false);
    expect(isPointInPolygon({ lat: 34.691, lng: 135.19 }, SQUARE)).toBe(false);
  });
  it('凹多角形でも正しく判定する', () => {
    const concave: GeoPoint[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 4 },
      { lat: 4, lng: 4 },
      { lat: 4, lng: 3 },
      { lat: 1, lng: 2 },
      { lat: 4, lng: 1 },
      { lat: 4, lng: 0 },
    ];
    expect(isPointInPolygon({ lat: 3, lng: 2 }, concave)).toBe(false);
    expect(isPointInPolygon({ lat: 0.5, lng: 2 }, concave)).toBe(true);
  });
  it('頂点が3未満なら常に false', () => {
    expect(isPointInPolygon({ lat: 34.69, lng: 135.195 }, SQUARE.slice(0, 2))).toBe(false);
  });
});

describe('distanceToPolygonEdgeM', () => {
  it('辺までの最短距離（m・整数）を返す', () => {
    const inside = { lat: 34.69 + 15 / 111_195, lng: 135.196 };
    expect(distanceToPolygonEdgeM(inside, SQUARE)).toBe(15);
  });
  it('頂点が2未満なら Infinity', () => {
    expect(distanceToPolygonEdgeM(SQUARE[0]!, [])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('地区の補助関数', () => {
  it('点を含む地区を探す', () => {
    const a = district('d_joka', 1, SQUARE);
    expect(findDistrictAt({ lat: 34.691, lng: 135.196 }, [a])?.id).toBe('d_joka');
    expect(findDistrictAt({ lat: 35, lng: 135 }, [a])).toBeUndefined();
  });
  it('表示順に並べ替える（元の配列は変えない）', () => {
    const list = [district('d_minato', 2, SQUARE), district('d_joka', 1, SQUARE)];
    expect(sortDistrictsByOrder(list).map((x) => x.id)).toEqual(['d_joka', 'd_minato']);
    expect(list[0]?.id).toBe('d_minato');
  });
  it('地区色は #rrggbb のみ', () => {
    expect(isHexColor('#7a5ea8')).toBe(true);
    expect(isHexColor('#7a5ea')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor(123)).toBe(false);
  });
});
