/**
 * @file 広域のイラストの街のテスト（決めごと＝段・見え方・波・川と高架・家と飾りの場所、雰囲気の切り替わり、全体図）
 */
import { describe, expect, it } from 'vitest';
import { generateTown } from '@/presentation/screens/Map/town/townGenerator';
import { realTownInput } from '@/presentation/screens/Map/town/townGenerator.test';
import { CELL_M, Cell, OVERLAY_STATION, OVERLAY_VIADUCT, latLngToCell } from '@/presentation/screens/Map/town/townTypes';
import type { DistrictMood, DistrictVitality, VitalityModel } from '@/presentation/screens/Map/town/vitality';
import { WideIllustration, alongPath } from '@/presentation/screens/Map/town/wideIllustration';
import { PAPER, paintLanduse } from '@/presentation/screens/Map/town/wideIllustrationArt';
import {
  DECOR_CENTER_CLEARANCE_M,
  LEVELS_PX_PER_CELL,
  TRANSITION_MS,
  chooseLevel,
  decorOf,
  houseSlotsOf,
  isUplift,
  lookOf,
  mixLook,
  polygonToCells,
  riverPathsOf,
  viaductLineOf,
  waveProgress,
} from '@/presentation/screens/Map/town/wideIllustrationModel';

/**
 * 雰囲気だけを決めた活気のモデルを作る。
 * @param ids 地区ID
 * @param mood 雰囲気
 * @returns モデル
 */
function modelOf(ids: readonly string[], mood: DistrictMood): VitalityModel {
  const byDistrict = new Map<string, DistrictVitality>();
  for (const id of ids) byDistrict.set(id, { districtId: id, vitality: mood === 'lively' ? 0.9 : mood === 'calm' ? 0.5 : 0.2, mood, rivalSpotIds: [], mineSpotIds: [] });
  return { byDistrict, ownerOf: new Map() };
}

/**
 * 小さな作りものの街（川・高架だけを調べる）。
 * @param cols 列
 * @param rows 行
 * @returns kinds・overlay を持つ街
 */
function tinyGrid(cols: number, rows: number): { cols: number; rows: number; kinds: Uint8Array; overlay: Uint8Array } {
  return { cols, rows, kinds: new Uint8Array(cols * rows).fill(Cell.GRASS), overlay: new Uint8Array(cols * rows) };
}

describe('wideIllustrationModel', () => {
  it('画面の密度が上がるほど細かい段を選び、上限を超えたら最も細かい段にする', () => {
    expect(chooseLevel(0.5)).toBe(0);
    expect(chooseLevel(3)).toBeGreaterThan(chooseLevel(1.5));
    expect(chooseLevel(100)).toBe(LEVELS_PX_PER_CELL.length - 1);
  });

  it('にぎやか＝飾りと光、廃れ＝くすみと廃れの飾り、ふつうはその間', () => {
    const lively = lookOf('lively', 0.9);
    const calm = lookOf('calm', 0.5);
    const decaying = lookOf('decaying', 0.2);
    expect(lively.decay).toBe(0);
    expect(lively.lively).toBeGreaterThan(calm.lively);
    expect(lively.glow).toBeGreaterThan(0);
    expect(decaying.decay).toBeGreaterThan(0.5);
    expect(decaying.desat).toBeGreaterThan(calm.desat);
    expect(decaying.lively).toBe(0);
    expect(isUplift(decaying, lively)).toBe(true);
    expect(isUplift(lively, decaying)).toBe(false);
    expect(mixLook(decaying, lively, 0)).toEqual(decaying);
    expect(mixLook(decaying, lively, 1).decay).toBeCloseTo(lively.decay);
  });

  it('切り替わりの波は始まる前 0・終われば 1 で、途中は増えていく', () => {
    expect(waveProgress(1000, 500)).toBe(0);
    expect(waveProgress(1000, 1000 + TRANSITION_MS)).toBe(1);
    expect(waveProgress(1000, 1300)).toBeLessThan(waveProgress(1000, 1800));
  });

  it('細い水の帯の真ん中を、川の中心線として取り出す', () => {
    const g = tinyGrid(40, 60);
    for (let r = 0; r < 60; r++) for (let c = 10; c < 15; c++) g.kinds[r * 40 + c] = Cell.WATER;
    const paths = riverPathsOf(g, 30, 4);
    expect(paths).toHaveLength(1);
    const path = paths[0] ?? [];
    expect(path.length).toBeGreaterThanOrEqual(10);
    for (const p of path) expect(p.col).toBeCloseTo(12.5);
    expect(path.every((p, i) => i === 0 || p.row > (path[i - 1]?.row ?? 0))).toBe(true);
  });

  it('高架の中心の行・両端・駅の範囲を返し、高架が無ければ undefined', () => {
    const g = tinyGrid(30, 10);
    expect(viaductLineOf(g)).toBeUndefined();
    for (let c = 3; c < 21; c++) g.overlay[5 * 30 + c] = OVERLAY_VIADUCT | (c >= 8 && c < 12 ? OVERLAY_STATION : 0);
    expect(viaductLineOf(g)).toEqual({ row: 5.5, col0: 3, col1: 21, station: { col0: 8, col1: 12 } });
  });
});

describe('広域の家と飾りの場所（本物の街）', () => {
  const input = realTownInput();
  const grid = generateTown(input);

  it('家は建物の上だけに、奥から手前の順で、毎回同じ場所に置く。地区の中は外より密', () => {
    const slots = houseSlotsOf(grid);
    expect(slots.length).toBeGreaterThan(500);
    expect(houseSlotsOf(grid)).toEqual(slots);
    expect(slots.every((s, i) => i === 0 || s.row >= (slots[i - 1]?.row ?? 0))).toBe(true);
    expect(slots.every((s) => (grid.buildingAt[s.row * grid.cols + s.col] ?? -1) >= 0)).toBe(true);
    let insideCells = 0;
    for (let i = 0; i < grid.district.length; i++) if ((grid.district[i] ?? 0) > 0) insideCells++;
    const inside = slots.filter((s) => s.district > 0).length;
    const outside = slots.length - inside;
    expect(inside / insideCells).toBeGreaterThan(outside / (grid.district.length - insideCells));
    const outsideTall = slots.filter((s) => s.district === 0 && (s.style === 'office' || s.style === 'mansion' || s.style === 'apartment')).length;
    expect(outsideTall / Math.max(1, outside)).toBeLessThan(0.5);
  });

  it('飾りは地区の中心（王者の台座）のまわりを空けて置き、雨雲は地区の中に浮かべる', () => {
    input.districts.forEach((d, i) => {
      const center = latLngToCell(grid, { lat: d.polygon.reduce((s, p) => s + p.lat, 0) / d.polygon.length, lng: d.polygon.reduce((s, p) => s + p.lng, 0) / d.polygon.length });
      const decor = decorOf(grid, i + 1, polygonToCells(grid, d.polygon), center);
      expect(decor.items.length).toBeGreaterThan(10);
      for (const item of decor.items) expect(item.dist).toBeGreaterThan(DECOR_CENTER_CLEARANCE_M / CELL_M);
      expect(new Set(decor.items.map((x) => x.kind)).size).toBeGreaterThanOrEqual(5);
      expect(decor.reachCells).toBeGreaterThan(10);
    });
  });

  it('雰囲気を初めて渡したときは波を出さず、変わったときだけ約1.6秒の波で切り替わる', () => {
    const districts = (realTownInput().districts as { id: string; polygon: { lat: number; lng: number }[] }[]).map((d) => ({
      id: d.id,
      color: '#888888',
      theme: '暮らし',
      polygon: d.polygon,
      center: d.polygon[0] ?? { lat: 0, lng: 0 },
      level: 1,
    }));
    const wide = new WideIllustration(grid, districts);
    const ids = districts.map((d) => d.id);
    wide.setVitality(modelOf(ids, 'lively'), 1000);
    expect(wide.isTransitioning(1000)).toBe(false);
    wide.setVitality(modelOf(ids, 'lively'), 2000);
    expect(wide.isTransitioning(2000)).toBe(false);
    wide.setVitality(modelOf(ids, 'decaying'), 3000);
    expect(wide.isTransitioning(3100)).toBe(true);
    expect(wide.isTransitioning(3000 + TRANSITION_MS + 1)).toBe(false);
  });
});

describe('wideIllustration の小さな部品', () => {
  it('小舟は川の折れ線を行って戻る（戻りは向きが逆）', () => {
    const path = [{ col: 0, row: 0 }, { col: 10, row: 0 }, { col: 10, row: 10 }];
    expect(alongPath(path, 0)).toMatchObject({ col: 0, row: 0 });
    expect(alongPath(path, 15)).toMatchObject({ col: 10, row: 5 });
    const back = alongPath(path, 35);
    expect(back.col).toBeCloseTo(5);
    expect(back.row).toBeCloseTo(0);
    expect(Math.cos(back.angle)).toBeLessThan(0);
  });

  it('焼けるまでの全体図は、川を水の色、建物と何も無い所を紙の色で塗る（家は描かない）', () => {
    const grid = { cols: 3, rows: 1, kinds: Uint8Array.from([Cell.WATER, Cell.BUILDING, Cell.GRASS]), buildingAt: Int32Array.from([-1, 0, -1]) };
    const px = paintLanduse(grid);
    const hex = (i: number): string => `#${[px[i * 4], px[i * 4 + 1], px[i * 4 + 2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
    expect(hex(0)).toBe('#a7d6df');
    expect(hex(1)).toBe(PAPER);
    expect(hex(2)).toBe(PAPER);
  });
});
