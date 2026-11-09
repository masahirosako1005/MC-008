/**
 * @file townGenerator のテスト（本物のマスタで街を作り、敷地・入口・道のつながりを確かめる）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateTown, hash01, themeOfDistrict } from '@/presentation/screens/Map/town/townGenerator';
import type { TownGenInput } from '@/presentation/screens/Map/town/townGenerator';
import { Cell, cellIndex, isWalkable } from '@/presentation/screens/Map/town/townTypes';
import type { TownGrid } from '@/presentation/screens/Map/town/townTypes';

interface RawSpot {
  id: string;
  lat: number;
  lng: number;
  category?: string;
}

/**
 * public/master の JSON を読む。
 * @param name ファイル名
 * @returns 中身
 */
function master<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(__dirname, '../../../../../public/master', name), 'utf8')) as T;
}

/**
 * 本物のマスタから生成の入力を作る。
 * @returns 入力
 */
export function realTownInput(): TownGenInput {
  const districts = master<{ city: { bounds: TownGenInput['bounds'] }; districts: { id: string; polygon: { lat: number; lng: number }[] }[] }>('districts.json');
  const landmarks = master<{ landmarks: RawSpot[] }>('landmarks.json').landmarks;
  const shops = master<{ shops: RawSpot[] }>('shops.json').shops;
  const points = master<{ points: { id: string; lat: number; lng: number }[] }>('amenityPoints.json').points;
  return {
    bounds: districts.city.bounds,
    districts: districts.districts.map((d) => ({ id: d.id, polygon: d.polygon })),
    spots: [...landmarks.map((s) => ({ ...s, kind: 'landmark' as const })), ...shops.map((s) => ({ ...s, kind: 'shop' as const }))],
    amenities: points,
  };
}

/**
 * 歩けるセルだけを通って、start から届くセルの数を数える（幅優先）。
 * @param grid 街
 * @param start 始点の添字
 * @returns 届いたセル（添字の集合）
 */
function reachable(grid: TownGrid, start: number): Set<number> {
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] ?? 0;
    const c = i % grid.cols;
    const r = Math.floor(i / grid.cols);
    for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]] as const) {
      const j = cellIndex(grid, nc, nr);
      if (j < 0 || seen.has(j) || !isWalkable(grid.kinds[j] ?? -1)) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return seen;
}

describe('generateTown', () => {
  const input = realTownInput();
  const started = performance.now();
  const grid = generateTown(input);
  const elapsed = performance.now() - started;

  it('市域の外側まで続く街を、現実的な時間で作る', () => {
    expect(grid.cols).toBeGreaterThan(600);
    expect(grid.rows).toBeGreaterThan(700);
    expect(grid.buildings.length).toBeGreaterThan(3000);
    expect(elapsed).toBeLessThan(4000);
  });

  it('すべてのスポットと便利施設に敷地があり、敷地は LOT、入口は歩ける', () => {
    expect(grid.anchors.size).toBe(input.spots.length + input.amenities.length);
    for (const [id, a] of grid.anchors) {
      expect(grid.kinds[cellIndex(grid, a.col, a.row)], id).toBe(Cell.LOT);
      expect(isWalkable(grid.kinds[cellIndex(grid, a.doorCol, a.doorRow)] ?? -1), id).toBe(true);
    }
  });

  it('すべての店・名所の入口が1つの道路網でつながっている（どこからでも歩いて行ける）', () => {
    const first = [...grid.anchors.values()][0];
    expect(first).toBeDefined();
    const net = reachable(grid, cellIndex(grid, first?.doorCol ?? 0, first?.doorRow ?? 0));
    const unreachable = [...grid.anchors.entries()].filter(([, a]) => !net.has(cellIndex(grid, a.doorCol, a.doorRow))).map(([id]) => id);
    expect(unreachable).toEqual([]);
  });

  it('同じ入力なら同じ街になる（決定論的）', () => {
    const again = generateTown(input);
    expect(again.buildings.length).toBe(grid.buildings.length);
    expect(Buffer.from(again.kinds).equals(Buffer.from(grid.kinds))).toBe(true);
  });

  it('hash01 は 0..1、テーマは表どおり', () => {
    for (let i = 0; i < 100; i++) {
      const v = hash01(i, i * 7, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(themeOfDistrict('d_tenma', 1)).toBe('market');
    expect(themeOfDistrict('d_unknown', 0)).toBe('monzen');
  });
});
