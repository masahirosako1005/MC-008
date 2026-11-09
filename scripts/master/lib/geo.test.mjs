/**
 * @file マスタ用幾何ユーティリティ（lib/geo.mjs）のテスト（scripts 層）
 */
import { describe, expect, it } from 'vitest';
import {
  CITY_ORIGIN, distanceBounds, distanceToBoundary, distanceToPolyline, distanceToSegment, flatMeters, haversineMeters,
  isSimplePolygon, latLngOf, pointInPolygon, polygonGap, polygonsOverlap, roundCoord, samplePath, segmentsIntersect,
  toLatLng, toMeters,
} from './geo.mjs';

/** 一辺 100m の正方形（原点が南西角） */
const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('座標変換', () => {
  it('原点は舞台の原点（南森町駅）の緯度経度になる', () => {
    expect(CITY_ORIGIN).toEqual({ lat: 34.6977, lng: 135.51102 });
    expect(toLatLng({ x: 0, y: 0 })).toEqual({ lat: CITY_ORIGIN.lat, lng: CITY_ORIGIN.lng });
    expect(toMeters(CITY_ORIGIN)).toEqual({ x: 0, y: 0 });
  });

  it('原データの [緯度, 経度] を小数6桁の {lat, lng} にする', () => {
    expect(latLngOf([34.69609, 135.51277])).toEqual({ lat: 34.69609, lng: 135.51277 });
    expect(latLngOf([34.71575021, 135.52107249])).toEqual({ lat: 34.71575, lng: 135.521072 });
  });

  it('メートル→緯度経度→メートルの往復誤差は0.2m未満', () => {
    for (const p of [{ x: -850, y: 1300 }, { x: 850, y: -1100 }, { x: 123.4, y: -56.7 }]) {
      const back = toMeters(toLatLng(p));
      expect(Math.abs(back.x - p.x)).toBeLessThan(0.2);
      expect(Math.abs(back.y - p.y)).toBeLessThan(0.2);
    }
  });

  it('緯度経度は小数6桁に丸める', () => {
    expect(roundCoord(34.69123456)).toBe(34.691235);
    expect(String(toLatLng({ x: 333.3, y: 777.7 }).lat).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6);
  });
});

describe('距離', () => {
  it('北へ111,000分の1度×100 は平面近似で100m・ハーサインでも約100m', () => {
    const a = { lat: 34.69, lng: 135.195 };
    const b = { lat: 34.69 + 100 / 111000, lng: 135.195 };
    expect(flatMeters(a, b)).toBeCloseTo(100, 6);
    expect(haversineMeters(a, b)).toBeGreaterThan(100);
    expect(haversineMeters(a, b)).toBeLessThan(100.3);
  });

  it('distanceBounds は2つの計算法の小さい方と大きい方を返す', () => {
    const a = { lat: CITY_ORIGIN.lat, lng: CITY_ORIGIN.lng };
    const b = toLatLng({ x: 60, y: 80 });
    const { min, max } = distanceBounds(a, b);
    expect(min).toBeLessThanOrEqual(max);
    expect(min).toBeGreaterThan(99);
    expect(max).toBeLessThan(101);
  });

  it('同じ点どうしの距離は0', () => {
    const a = { lat: 34.7, lng: 135.2 };
    expect(distanceBounds(a, a)).toEqual({ min: 0, max: 0 });
  });

  it('長さ0の線分との距離は端点との距離になる', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe('多角形', () => {
  it('内側の点は true、外側の点は false', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, SQUARE)).toBe(false);
    expect(pointInPolygon({ x: -0.01, y: 50 }, SQUARE)).toBe(false);
  });

  it('頂点が3未満の多角形には何も含まれない（不正値）', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
  });

  it('境界までの最短距離を求める（境界上は0）', () => {
    expect(distanceToBoundary({ x: 50, y: 15 }, SQUARE)).toBeCloseTo(15, 9);
    expect(distanceToBoundary({ x: 100, y: 40 }, SQUARE)).toBe(0);
  });

  it('蝶ネクタイ形（自己交差）は単純多角形ではない', () => {
    const bowTie = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
    expect(isSimplePolygon(SQUARE)).toBe(true);
    expect(isSimplePolygon(bowTie)).toBe(false);
    expect(isSimplePolygon([{ x: 0, y: 0 }])).toBe(false);
  });

  it('線分の交差・接触・非交差を判定する', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(false);
  });

  it('離れた多角形は重ならず、隙間を返す。重なる多角形の隙間は0', () => {
    const east = SQUARE.map((p) => ({ x: p.x + 160, y: p.y }));
    const overlapping = SQUARE.map((p) => ({ x: p.x + 50, y: p.y + 50 }));
    const inner = [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }];
    expect(polygonsOverlap(SQUARE, east)).toBe(false);
    expect(polygonGap(SQUARE, east)).toBeCloseTo(60, 9);
    expect(polygonsOverlap(SQUARE, overlapping)).toBe(true);
    expect(polygonGap(SQUARE, overlapping)).toBe(0);
    expect(polygonsOverlap(SQUARE, inner)).toBe(true);
  });
});

describe('折れ線までの距離（川の中心線）', () => {
  /** 東西に 0→100m、そこから北へ 100m 折れる線 */
  const LINE = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

  it('最も近い線分までの距離を返す', () => {
    expect(distanceToPolyline({ x: 50, y: 60 }, LINE)).toBeCloseTo(50, 9);
    expect(distanceToPolyline({ x: 50, y: -30 }, LINE)).toBeCloseTo(30, 9);
    expect(distanceToPolyline({ x: 130, y: 50 }, LINE)).toBeCloseTo(30, 9);
    expect(distanceToPolyline({ x: 100, y: 0 }, LINE)).toBe(0);
  });

  it('端点より先の点は端点までの距離になる', () => {
    expect(distanceToPolyline({ x: -30, y: -40 }, LINE)).toBeCloseTo(50, 9);
  });

  it('頂点1つなら点との距離、空なら Infinity（不正値）', () => {
    expect(distanceToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBe(5);
    expect(distanceToPolyline({ x: 3, y: 4 }, [])).toBe(Infinity);
  });
});

describe('歩行経路のサンプリング', () => {
  it('始点と終点を含み、間隔ごとに点を置く', () => {
    const points = samplePath({ x: 0, y: 0 }, { x: 50, y: 0 }, 20);
    expect(points.map((p) => p.x)).toEqual([0, 20, 40, 50]);
  });

  it('長さ0の経路は始点1つだけ', () => {
    expect(samplePath({ x: 5, y: 5 }, { x: 5, y: 5 }, 20)).toEqual([{ x: 5, y: 5 }]);
  });

  it('間隔が0以下・NaN なら始点と終点だけ（不正値）', () => {
    expect(samplePath({ x: 0, y: 0 }, { x: 50, y: 0 }, 0)).toHaveLength(2);
    expect(samplePath({ x: 0, y: 0 }, { x: 50, y: 0 }, Number.NaN)).toHaveLength(2);
  });
});
