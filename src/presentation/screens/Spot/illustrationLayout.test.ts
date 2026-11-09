/**
 * @file スポットの街なみ絵レイアウトの単体テスト（presentation/screens/Spot 層）
 */
import { describe, expect, it } from 'vitest';
import { illustrationLayout, mainStyleOf } from '@/presentation/screens/Spot/illustrationLayout';
import type { IllustrationShape } from '@/presentation/screens/Spot/illustrationLayout';

/** 図形の外接矩形（はみ出し判定用） */
function boundsOf(shape: IllustrationShape): { minX: number; maxX: number; minY: number; maxY: number } {
  if (shape.kind === 'rect') return { minX: shape.x, maxX: shape.x + shape.w, minY: shape.y, maxY: shape.y + shape.h };
  if (shape.kind === 'circle') return { minX: shape.x - shape.r, maxX: shape.x + shape.r, minY: shape.y - shape.r, maxY: shape.y + shape.r };
  const xs = shape.points.map((p) => p.x);
  const ys = shape.points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('mainStyleOf', () => {
  it('名所の史跡は城、展望は塔になる', () => {
    expect(mainStyleOf('landmark', '史跡')).toBe('castle');
    expect(mainStyleOf('landmark', '展望')).toBe('tower');
  });
  it('店舗は既定で店先、銭湯は温泉になる', () => {
    expect(mainStyleOf('shop', 'カフェ')).toBe('shopfront');
    expect(mainStyleOf('shop', '銭湯')).toBe('onsen');
  });
  it('未知のカテゴリでも形が決まる（名所は館）', () => {
    expect(mainStyleOf('landmark', '未知')).toBe('hall');
  });
});

describe('illustrationLayout', () => {
  const base = { seed: 's_jo02', kind: 'shop' as const, category: '和菓子', width: 358, height: 152 };

  it('同じ入力なら毎回同じ図形になる（Math.random を使わない）', () => {
    expect(illustrationLayout(base)).toEqual(illustrationLayout(base));
  });

  it('スポットID が違えば背景の家並みが変わる', () => {
    expect(illustrationLayout({ ...base, seed: 's_jo03' })).not.toEqual(illustrationLayout(base));
  });

  it('最初の図形は地面で、主役の建物（main）を必ず含む', () => {
    const shapes = illustrationLayout(base);
    expect(shapes[0]?.role).toBe('ground');
    expect(shapes.some((s) => s.role === 'main')).toBe(true);
  });

  it.each(['史跡', '展望', '建築', '公園', '温泉', '商店街'])('名所「%s」の図形は描画領域からはみ出さない', (category) => {
    const shapes = illustrationLayout({ ...base, kind: 'landmark', category });
    for (const shape of shapes) {
      const b = boundsOf(shape);
      expect(b.minX).toBeGreaterThanOrEqual(-0.5);
      expect(b.maxX).toBeLessThanOrEqual(base.width + 0.5);
      expect(b.minY).toBeGreaterThanOrEqual(-0.5);
      expect(b.maxY).toBeLessThanOrEqual(base.height + 0.5);
    }
  });

  it('幅・高さが 0 でも例外にならない', () => {
    expect(() => illustrationLayout({ ...base, width: 0, height: 0 })).not.toThrow();
  });
});
