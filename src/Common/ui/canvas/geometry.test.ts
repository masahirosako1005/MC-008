import { describe, expect, it } from 'vitest';
import {
  distance2D,
  distanceToPolyline,
  distanceToSegment,
  fitRectInto,
  horizontalSpans,
  interiorPoint,
  pointInPolygon,
  polygonBounds,
  polygonCentroid,
  rectsOverlap,
  topLabelSlot,
} from '@/Common/ui/canvas/geometry';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('distance2D', () => {
  it('2点間の距離を返す', () => {
    expect(distance2D({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('pointInPolygon', () => {
  it('内側の点は true、外側の点は false', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: -1 }, square)).toBe(false);
  });
  it('凹んだ多角形のくぼみは外側と判定する', () => {
    const concave = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 4 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 8 }, concave)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 2 }, concave)).toBe(true);
  });
  it('3点未満は常に false', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, square.slice(0, 2))).toBe(false);
  });
});

describe('polygonBounds', () => {
  it('外接矩形を返す', () => {
    expect(polygonBounds([{ x: 2, y: 3 }, { x: -1, y: 8 }, { x: 5, y: 0 }])).toEqual({ x: -1, y: 0, width: 6, height: 8 });
  });
  it('空なら幅高さ 0', () => {
    expect(polygonBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('polygonCentroid', () => {
  it('正方形の重心は中心', () => {
    const c = polygonCentroid(square);
    expect(c.x).toBeCloseTo(5);
    expect(c.y).toBeCloseTo(5);
  });
  it('頂点の向き（時計回り）に依らない', () => {
    const c = polygonCentroid([...square].reverse());
    expect(c.x).toBeCloseTo(5);
    expect(c.y).toBeCloseTo(5);
  });
  it('面積 0（一直線）なら頂点の平均', () => {
    expect(polygonCentroid([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }])).toEqual({ x: 2, y: 0 });
  });
});

describe('fitRectInto', () => {
  it('余白を残して中央に収める', () => {
    const t = fitRectInto({ x: 0, y: 0, width: 100, height: 50 }, { width: 220, height: 220 }, 10);
    expect(t.scale).toBeCloseTo(2);
    expect(0 * t.scale + t.offsetX).toBeCloseTo(10);
    expect(100 * t.scale + t.offsetX).toBeCloseTo(210);
    expect(25 * t.scale + t.offsetY).toBeCloseTo(110);
  });
  it('内容が点のときは拡大せず中央に置く', () => {
    const t = fitRectInto({ x: 5, y: 5, width: 0, height: 0 }, { width: 100, height: 100 });
    expect(t.scale).toBe(1);
    expect(5 + t.offsetX).toBe(50);
  });
});

/** L 字の多角形（左の縦棒 x0〜10・y0〜40 と、下の横棒 x0〜40・y30〜40） */
const lShape = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 30 },
  { x: 40, y: 30 },
  { x: 40, y: 40 },
  { x: 0, y: 40 },
];

describe('distanceToSegment / distanceToPolyline', () => {
  it('線分への垂線の長さ、端の外側なら端点までの距離', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
  it('折れ線ではいちばん近い線分との距離。空なら Infinity', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(distanceToPolyline({ x: 12, y: 5 }, line)).toBe(2);
    expect(distanceToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBe(5);
    expect(distanceToPolyline({ x: 0, y: 0 }, [])).toBe(Infinity);
  });
});

describe('horizontalSpans', () => {
  it('水平線と多角形が重なる区間を左から返す', () => {
    expect(horizontalSpans(square, 5)).toEqual([{ x0: 0, x1: 10 }]);
    expect(horizontalSpans(lShape, 35)).toEqual([{ x0: 0, x1: 40 }]);
    expect(horizontalSpans(lShape, 50)).toEqual([]);
  });
  it('凹んだ多角形では複数区間になる', () => {
    const u = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }];
    expect(horizontalSpans(u, 5)).toEqual([{ x0: 0, x1: 10 }, { x0: 20, x1: 30 }]);
  });
});

describe('topLabelSlot', () => {
  it('上辺寄りで、箱が内側に収まる行の中央を返す', () => {
    const slot = topLabelSlot(square, { width: 6, height: 4, inset: 1 });
    expect(slot?.x).toBeCloseTo(5);
    expect(slot?.y).toBeCloseTo(3);
  });
  it('L 字では幅が足りる下の横棒に置く（重心が外に出る形でも内側）', () => {
    const slot = topLabelSlot(lShape, { width: 30, height: 6, inset: 0 });
    expect(slot).toBeDefined();
    if (slot === undefined) return;
    expect(slot.y).toBeGreaterThanOrEqual(30);
    expect(pointInPolygon(slot, lShape)).toBe(true);
  });
  it('どこにも収まらなければ undefined', () => {
    expect(topLabelSlot(square, { width: 20, height: 4, inset: 0 })).toBeUndefined();
  });
});

describe('interiorPoint', () => {
  it('重心が内側ならそのまま、外側（L 字）なら内側の点を返す', () => {
    expect(interiorPoint(square)).toEqual(polygonCentroid(square));
    const p = interiorPoint([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 40 }, { x: 0, y: 40 }]);
    expect(pointInPolygon(p, [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 40 }, { x: 0, y: 40 }])).toBe(true);
  });
});

describe('rectsOverlap', () => {
  it('重なれば true、辺が接するだけなら false', () => {
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });
});
