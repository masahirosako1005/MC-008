import { describe, expect, it } from 'vitest';
import type { Result } from '@/Common/result/Result';
import { createTestWorld, must, seedTraveler } from '@/application/testing/fakes';
import { familiarityOf, GetZukanUseCase, nextFamiliarityText } from '@/application/usecases/spot/GetZukanUseCase';

/** 失敗コードを取り出す（成功なら undefined） */
function codeOf(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

describe('GetZukanUseCase', () => {
  it('地区を省略するとすべての地区のタイルを返し（最初の絞り込みなし）、地区は全地区を表示順で返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const zukan = must(await new GetZukanUseCase(tw).execute({}));
    const ordered = [...tw.spots.allDistricts()].sort((a, b) => a.order - b.order);
    expect(zukan.selectedDistrictId).toBeUndefined();
    expect(zukan.districts.map((d) => d.id)).toEqual(ordered.map((d) => d.id));
    expect(zukan.tiles).toHaveLength(tw.spots.allSpots().length);
    expect(new Set(zukan.tiles.map((t) => t.districtId))).toEqual(new Set(ordered.map((d) => String(d.id))));
  });

  it('地区を指定すると最初の絞り込みとして返し、タイルはすべての地区のまま', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const zukan = must(await new GetZukanUseCase(tw).execute({ districtId: 'd_joka' }));
    expect(zukan.selectedDistrictId).toBe('d_joka');
    expect(zukan.tiles).toHaveLength(tw.spots.allSpots().length);
  });

  it('発見済みはシルエット（回数0）、訪問済みは通った回数を返し、未発見も名前・カテゴリ・地区を返す（座標は返さない）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['s_jo02'], visits: [['l_jo01', -10], ['l_jo01', -3]] });
    const zukan = must(await new GetZukanUseCase(tw).execute({}));
    expect(zukan.tiles.find((t) => t.id === 'l_jo01')).toMatchObject({ id: 'l_jo01', name: 'N西城跡', kind: 'landmark', districtId: 'd_joka', status: 'visited', visitCount: 2 });
    const discovered = zukan.tiles.find((t) => t.id === 's_jo02');
    expect(discovered).toMatchObject({ name: '丸岡和菓子店', status: 'discovered', visitCount: 0 });
    expect(discovered?.familiarity).toBeUndefined();
    expect(discovered?.category).toBeDefined();
    const unknown = zukan.tiles.filter((t) => t.status === 'unknown');
    expect(unknown.length).toBeGreaterThan(0);
    for (const tile of unknown) {
      expect(tile.id).toBeDefined();
      expect(tile.name).toBeDefined();
      expect(tile.category).toBeDefined();
      expect(tile.districtId).toMatch(/^d_/);
      expect(tile.rarity).toBeDefined();
      for (const hidden of ['familiarity', 'seasons', 'point', 'lat', 'lng']) expect(tile).not.toHaveProperty(hidden);
    }
  });

  it('タイルは名所→店舗の順、同種は 訪問済み→発見済み→未発見、同じ状態は地区の表示順', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['s_jo02'], visits: [['s_jo01', -1], ['l_jo01', -2]] });
    const zukan = must(await new GetZukanUseCase(tw).execute({}));
    const kinds = zukan.tiles.map((t) => t.kind);
    expect(kinds.indexOf('shop')).toBeGreaterThan(kinds.lastIndexOf('landmark'));
    const rank = { visited: 0, discovered: 1, unknown: 2 } as const;
    for (const kind of ['landmark', 'shop'] as const) {
      const ranks = zukan.tiles.filter((t) => t.kind === kind).map((t) => rank[t.status]);
      expect(ranks, kind).toEqual([...ranks].sort((a, b) => a - b));
    }
    expect(zukan.tiles.find((t) => t.kind === 'shop')?.id).toBe('s_jo01');
    expect(zukan.tiles.filter((t) => t.kind === 'shop')[1]?.id).toBe('s_jo02');
    const order = new Map(tw.spots.allDistricts().map((d) => [String(d.id), d.order]));
    const unknownLandmarks = zukan.tiles.filter((t) => t.kind === 'landmark' && t.status === 'unknown').map((t) => order.get(t.districtId) ?? 0);
    expect(unknownLandmarks).toEqual([...unknownLandmarks].sort((a, b) => a - b));
  });

  it('なじみ度は通った回数で 1回=訪問／3回=なじみ／5回=常連 になり、次の段階までの文言を返す', () => {
    expect([1, 2, 3, 4, 5, 9].map(familiarityOf)).toEqual([1, 1, 2, 2, 3, 3]);
    expect([1, 2, 3, 4, 5].map(nextFamiliarityText)).toEqual(['あと2回でなじみ', 'あと1回でなじみ', 'あと2回で常連', 'あと1回で常連', undefined]);
  });

  it('訪問済みタイルはなじみ度・訪れた季節（春→冬の順）・今日訪問したかを返す', async () => {
    const tw = createTestWorld();
    // 今日=2026-11-09（秋）。-120日=7月（夏）、-300日=1月（冬）
    await seedTraveler(tw, { visits: [['l_jo01', 0], ['l_jo01', -120], ['l_jo01', -300], ['s_jo01', -2]] });
    const zukan = must(await new GetZukanUseCase(tw).execute({}));
    expect(zukan.tiles.find((t) => t.id === 'l_jo01')).toMatchObject({
      visitCount: 3, familiarity: 2, familiarityLabel: 'なじみ', nextFamiliarityText: 'あと2回で常連', seasons: ['summer', 'autumn', 'winter'], visitedToday: true,
    });
    expect(zukan.tiles.find((t) => t.id === 's_jo01')).toMatchObject({ familiarity: 1, familiarityLabel: '訪問', seasons: ['autumn'], visitedToday: false });
  });

  it('地区は色と色あせ状態を持ち、結果に達成率を含まない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -5]] });
    const zukan = must(await new GetZukanUseCase(tw).execute({}));
    expect(zukan.districts.find((d) => d.id === 'd_joka')?.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(zukan.districts.find((d) => d.id === 'd_joka')?.fadeKind).toBe('fresh');
    expect(zukan.districts.find((d) => d.id === 'd_satoyama')?.fadeKind).toBe('never');
    expect(JSON.stringify(zukan)).not.toMatch(/rate|percent|total|%/i);
  });

  it('districtId の形式が不正なら INVALID_INPUT、存在しない地区なら DISTRICT_NOT_FOUND', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const useCase = new GetZukanUseCase(tw);
    expect(codeOf(await useCase.execute({ districtId: '../x' }))).toBe('INVALID_INPUT');
    expect(codeOf(await useCase.execute({ districtId: 'd_nowhere' }))).toBe('DISTRICT_NOT_FOUND');
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const tw = createTestWorld();
    expect(codeOf(await new GetZukanUseCase(tw).execute({}))).toBe('TRAVELER_NOT_FOUND');
  });
});
