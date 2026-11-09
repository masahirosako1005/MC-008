/**
 * @file townArt のテスト（全体図の画素、チャンク描画が全種類のセル・建物で例外なく描けること）
 * node 環境には canvas が無いので、fillRect だけを記録する偽のコンテキストで描画を確かめる。
 */
import { describe, expect, it } from 'vitest';
import { ROOF_COLORS, paintChunk, paintOverview } from '@/presentation/screens/Map/town/townArt';
import { CHUNK_PX, Cell, OVERLAY_STATION, OVERLAY_VIADUCT, OVERVIEW_PX_PER_CELL, TERRITORY_MINE, TERRITORY_RIVAL } from '@/presentation/screens/Map/town/townTypes';
import type { BuildingStyle, TownBuilding, TownGrid, TownPaintState } from '@/presentation/screens/Map/town/townTypes';

/** 建物の種類（全部） */
const STYLES: readonly BuildingStyle[] = ['house', 'kawaraHouse', 'nagaya', 'apartment', 'mansion', 'office', 'shophouse', 'stall', 'cafe', 'warehouse', 'station'];

/**
 * すべてのセルの種類・建物・高架・テーマを含む小さな街を作る（40×24 セル）。
 * @returns 街
 */
function sampleGrid(): TownGrid {
  const cols = 40;
  const rows = 24;
  const n = cols * rows;
  const kinds = new Uint8Array(n);
  const district = new Uint8Array(n);
  const variant = new Uint8Array(n);
  const overlay = new Uint8Array(n);
  const buildingAt = new Int32Array(n).fill(-1);
  const buildings: TownBuilding[] = [];
  for (let i = 0; i < n; i++) {
    variant[i] = (i * 37) & 255;
    district[i] = Math.floor((i % cols) / 7) % 6;
  }
  const allKinds = Object.values(Cell);
  for (let c = 0; c < cols; c++) {
    kinds[c] = allKinds[c % allKinds.length] ?? Cell.GRASS;
    kinds[cols + c] = Cell.ROAD;
    kinds[2 * cols + c] = Cell.ROAD;
    kinds[3 * cols + c] = c % 2 === 0 ? Cell.AVENUE : Cell.ARCADE;
    overlay[5 * cols + c] = OVERLAY_VIADUCT | (c > 20 ? OVERLAY_STATION : 0);
    overlay[6 * cols + c] = OVERLAY_VIADUCT;
  }
  for (let r = 0; r < rows; r++) kinds[r * cols + 10] = Cell.ROAD;
  placeAllStyles(cols, kinds, buildingAt, buildings);
  return {
    cols,
    rows,
    originLat: 34.7,
    originLng: 135.5,
    metersPerDegLng: 91_000,
    kinds,
    district,
    variant,
    overlay,
    buildingAt,
    buildings,
    districtIds: ['d1', 'd2', 'd3', 'd4', 'd5'],
    themes: ['city', 'monzen', 'market', 'living', 'alley', 'river'],
    anchors: new Map(),
  };
}

/**
 * すべての建物の種類を1棟ずつ並べる。
 * @param cols 列数
 * @param kinds セルの種類（書き換える）
 * @param buildingAt セル → 建物（書き換える）
 * @param buildings 建物の一覧（追加する）
 */
function placeAllStyles(cols: number, kinds: Uint8Array, buildingAt: Int32Array, buildings: TownBuilding[]): void {
  let col = 0;
  STYLES.forEach((style, k) => {
    const w = style === 'station' ? 6 : 3;
    const row = 8 + (k % 2) * 6;
    if (col + w > cols) col = 0;
    const b: TownBuilding = { col, row, w, h: 4, style, roof: k % ROOF_COLORS.length, seed: k * 977 + 13, district: k % 6 };
    for (let r = row; r < row + b.h; r++) for (let c = col; c < col + w; c++) {
      kinds[r * cols + c] = Cell.BUILDING;
      buildingAt[r * cols + c] = buildings.length;
    }
    buildings.push(b);
    col += w + 1;
  });
}

/**
 * 陣地・成長・色あせの状態を作る。
 * @param grid 街
 * @returns 状態
 */
function sampleState(grid: TownGrid): TownPaintState {
  const territory = new Uint8Array(grid.cols * grid.rows);
  for (let i = 0; i < territory.length; i++) territory[i] = i % 5 === 0 ? TERRITORY_MINE : i % 7 === 0 ? TERRITORY_RIVAL : 0;
  return { levels: [0, 1, 2, 3, 3, 2], fades: [0, 0, 0.5, 0, 1, 0], territory };
}

/** fillRect の呼び出しを数える偽の 2D コンテキスト */
interface FakeCtx {
  fillStyle: string | CanvasPattern;
  globalAlpha: number;
  globalCompositeOperation: string;
  rects: number;
  outside: number;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/**
 * 偽の 2D コンテキストを作る（チャンクの外にはみ出す塗りも数える）。
 * @returns 偽のコンテキスト
 */
function fakeCtx(): FakeCtx {
  return {
    fillStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    rects: 0,
    outside: 0,
    fillRect(x: number, y: number, w: number, h: number): void {
      this.rects++;
      if (x >= CHUNK_PX || y >= CHUNK_PX || x + w <= 0 || y + h <= 0) this.outside++;
    },
  };
}

describe('ROOF_COLORS', () => {
  it('0..7 の順に 赤・橙・青緑・青・紫・こげ茶・瓦の青灰・明るい灰', () => {
    expect(ROOF_COLORS).toEqual(['#e2574c', '#f08c3a', '#2fa39a', '#3e6fb5', '#8c6bc8', '#9a6b4f', '#5d6b85', '#c9ccd6']);
  });
});

describe('paintOverview', () => {
  it('幅・高さはセル数×OVERVIEW_PX_PER_CELL で、すべて不透明', () => {
    const grid = sampleGrid();
    const px = paintOverview(grid, { levels: [], fades: [], territory: new Uint8Array(grid.cols * grid.rows) });
    expect(px.length).toBe(grid.cols * OVERVIEW_PX_PER_CELL * grid.rows * OVERVIEW_PX_PER_CELL * 4);
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255);
  });

  it('自分の陣地は朱が混ざり、色あせは明るく（灰色に）なる', () => {
    const grid = sampleGrid();
    const empty = new Uint8Array(grid.cols * grid.rows);
    const base = paintOverview(grid, { levels: [], fades: [], territory: empty });
    const mine = new Uint8Array(empty.length).fill(TERRITORY_MINE);
    const tinted = paintOverview(grid, { levels: [], fades: [], territory: mine });
    const faded = paintOverview(grid, { levels: [], fades: [1, 1, 1, 1, 1, 1], territory: empty });
    // 1行目・列0 は芝（Cell.GRASS）。赤が増え、緑が減る
    expect(tinted[0]).toBeGreaterThan(base[0] ?? 0);
    expect(tinted[1]).toBeLessThan(base[1] ?? 0);
    const sat = (a: Uint8ClampedArray): number => Math.max(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0) - Math.min(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
    expect(sat(faded)).toBeLessThan(sat(base));
  });
});

describe('paintChunk', () => {
  it('全種類のセル・建物・高架・陣地・色あせを例外なく描く', () => {
    const grid = sampleGrid();
    const ctx = fakeCtx();
    expect(() => paintChunk(ctx as unknown as CanvasRenderingContext2D, grid, 0, 0, sampleState(grid))).not.toThrow();
    expect(ctx.rects).toBeGreaterThan(1000);
  });

  it('同じ入力なら同じ回数だけ塗る（乱数を使わない）', () => {
    const grid = sampleGrid();
    const a = fakeCtx();
    const b = fakeCtx();
    paintChunk(a as unknown as CanvasRenderingContext2D, grid, 0, 0, sampleState(grid));
    paintChunk(b as unknown as CanvasRenderingContext2D, grid, 0, 0, sampleState(grid));
    expect(a.rects).toBe(b.rects);
  });

  it('範囲外のチャンクも芝として描ける', () => {
    const grid = sampleGrid();
    const ctx = fakeCtx();
    paintChunk(ctx as unknown as CanvasRenderingContext2D, grid, 5, -3, sampleState(grid));
    expect(ctx.rects).toBeGreaterThanOrEqual(32 * 32);
  });
});
