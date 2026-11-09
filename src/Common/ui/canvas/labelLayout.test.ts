/**
 * @file ラベルの重なり回避（labelLayout）の単体テスト（Common/ui/canvas 層）
 */
import { describe, expect, it } from 'vitest';
import { createLabelLayout, inflateRect } from '@/Common/ui/canvas/labelLayout';

const AREA = { x: 0, y: 0, width: 100, height: 100 };

describe('createLabelLayout', () => {
  it('置いたラベルと重なる候補は飛ばし、空いている次の候補に置く', () => {
    const layout = createLabelLayout(AREA);
    layout.reserve({ x: 10, y: 10, width: 30, height: 10 });
    const placed = layout.place([
      { x: 20, y: 12, width: 20, height: 10 },
      { x: 50, y: 12, width: 20, height: 10 },
    ]);
    expect(placed).toEqual({ x: 50, y: 12, width: 20, height: 10 });
  });
  it('どの候補も置けなければ省略（undefined）', () => {
    const layout = createLabelLayout(AREA);
    layout.reserve({ x: 0, y: 0, width: 100, height: 50 });
    expect(layout.place([{ x: 10, y: 10, width: 10, height: 10 }])).toBeUndefined();
  });
  it('表示範囲からはみ出す候補は採らない', () => {
    const layout = createLabelLayout(AREA);
    expect(layout.place([{ x: 95, y: 10, width: 10, height: 10 }])).toBeUndefined();
    expect(createLabelLayout().place([{ x: 95, y: 10, width: 10, height: 10 }])).toBeDefined();
  });
  it('avoid の矩形（マーカー）とも重ならない候補を選ぶが、avoid は登録しない', () => {
    const layout = createLabelLayout(AREA);
    const marker = { x: 0, y: 0, width: 20, height: 20 };
    const first = { x: 5, y: 5, width: 10, height: 10 };
    const second = { x: 30, y: 5, width: 10, height: 10 };
    expect(layout.place([first, second], [marker])).toEqual(second);
    expect(layout.isFree(first)).toBe(true);
  });
  it('辺が接するだけなら重ならない', () => {
    const layout = createLabelLayout(AREA);
    layout.reserve({ x: 0, y: 0, width: 10, height: 10 });
    expect(layout.isFree({ x: 10, y: 0, width: 10, height: 10 })).toBe(true);
  });
});

describe('inflateRect', () => {
  it('四方に広げる', () => {
    expect(inflateRect({ x: 10, y: 10, width: 5, height: 5 }, 2)).toEqual({ x: 8, y: 8, width: 9, height: 9 });
  });
});
