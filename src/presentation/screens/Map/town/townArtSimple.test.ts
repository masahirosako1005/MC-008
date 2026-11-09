/**
 * @file townArtSimple のテスト（本物の街で、チャンクと全体図が例外なく描け、建物は1枚の四角で描くことを確かめる）
 */
import { describe, expect, it } from 'vitest';
import { SIMPLE_BUILDING_COLORS, paintChunk, paintOverview } from '@/presentation/screens/Map/town/townArtSimple';
import { generateTown } from '@/presentation/screens/Map/town/townGenerator';
import { realTownInput } from '@/presentation/screens/Map/town/townGenerator.test';
import { OVERVIEW_PX_PER_CELL } from '@/presentation/screens/Map/town/townTypes';
import type { TownPaintState } from '@/presentation/screens/Map/town/townTypes';

/**
 * fillRect の回数と色だけ数える、最小限の 2D コンテキスト。
 * @returns コンテキストと記録
 */
function recordingContext(): { ctx: CanvasRenderingContext2D; rects: number; styles: Set<string> } {
  const rec = { rects: 0, styles: new Set<string>() };
  const ctx = {
    fillStyle: '',
    fillRect(): void {
      rec.rects += 1;
      rec.styles.add(String(ctx.fillStyle));
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, get rects() { return rec.rects; }, styles: rec.styles };
}

describe('townArtSimple', () => {
  const grid = generateTown(realTownInput());
  const state: TownPaintState = { levels: grid.districtIds.map(() => 1).concat(0), fades: [0, 0, 0.5, 0, 0, 0], territory: new Uint8Array(grid.cols * grid.rows) };

  it('街の中央のチャンクを例外なく描き、建物は淡い色の四角で描く', () => {
    const rec = recordingContext();
    expect(() => paintChunk(rec.ctx, grid, 10, 12, state)).not.toThrow();
    expect(rec.rects).toBeGreaterThan(100);
    expect(SIMPLE_BUILDING_COLORS.some((c) => rec.styles.has(c))).toBe(true);
  });

  it('範囲外のチャンクも例外なく描く（空き地として）', () => {
    const rec = recordingContext();
    expect(() => paintChunk(rec.ctx, grid, 999, 999, state)).not.toThrow();
  });

  it('全体図は 幅×高さ×4 の画素で、すべて不透明', () => {
    const px = paintOverview(grid, state);
    expect(px.length).toBe(grid.cols * OVERVIEW_PX_PER_CELL * grid.rows * OVERVIEW_PX_PER_CELL * 4);
    expect(px[3]).toBe(255);
    expect(px[px.length - 1]).toBe(255);
  });
});
