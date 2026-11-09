import { describe, expect, it } from 'vitest';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId } from '@/Common/types/Id';
import { createTestWorld, must, seedTraveler } from '@/application/testing/fakes';
import { familiarityOf, GetZukanUseCase, nextFamiliarityText } from '@/application/usecases/spot/GetZukanUseCase';
import { GetTownStateUseCase } from '@/application/usecases/town/GetTownStateUseCase';

/** 失敗コードを取り出す（成功なら undefined） */
function codeOf(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

describe('GetZukanUseCase', () => {
  it('地区を省略すると表示順の先頭の地区を返し、タブは全地区を表示順で返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const zukan = must(await new GetZukanUseCase(tw).execute({}));
    const ordered = [...tw.spots.allDistricts()].sort((a, b) => a.order - b.order);
    expect(zukan.district.id).toBe(ordered[0]?.id);
    expect(zukan.districts.map((d) => d.id)).toEqual(ordered.map((d) => d.id));
  });

  it('未発見は id・名前を含めず、発見済みはシルエット（回数0）、訪問済みは通った回数を返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['s_jo02'], visits: [['l_jo01', -10], ['l_jo01', -3]] });
    const zukan = must(await new GetZukanUseCase(tw).execute({ districtId: 'd_joka' }));
    expect(zukan.tiles.find((t) => t.id === 'l_jo01')).toMatchObject({ id: 'l_jo01', name: 'N西城跡', kind: 'landmark', status: 'visited', visitCount: 2 });
    const discovered = zukan.tiles.find((t) => t.id === 's_jo02');
    expect(discovered).toMatchObject({ name: '丸岡和菓子店', status: 'discovered', visitCount: 0 });
    expect(discovered?.familiarity).toBeUndefined();
    expect(discovered?.category).toBeDefined();
    const unknown = zukan.tiles.filter((t) => t.status === 'unknown');
    expect(unknown.length).toBeGreaterThan(0);
    for (const tile of unknown) {
      for (const hidden of ['id', 'name', 'category', 'familiarity', 'seasons']) expect(tile).not.toHaveProperty(hidden);
      expect(tile.rarity).toBeDefined();
    }
    expect(zukan.tiles).toHaveLength(tw.spots.spotsInDistrict(must(parseDistrictId('d_joka'))).length);
  });

  it('未発見スポットの名前は結果のどこにも含まない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const zukan = must(await new GetZukanUseCase(tw).execute({ districtId: 'd_joka' }));
    expect(JSON.stringify(zukan)).not.toContain('丸岡和菓子店');
    expect(JSON.stringify(zukan)).not.toContain('l_jo01');
  });

  it('タイルは名所→店舗の順で、状態によって並べ替えない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['s_jo01', -1]] });
    const zukan = must(await new GetZukanUseCase(tw).execute({ districtId: 'd_joka' }));
    const kinds = zukan.tiles.map((t) => t.kind);
    expect(kinds.indexOf('shop')).toBeGreaterThan(kinds.lastIndexOf('landmark'));
  });

  it('ヘッダーは通った回数・最近いつ・成長段階を返し、達成率を含まない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -9], ['s_jo01', -7]] });
    const zukan = must(await new GetZukanUseCase(tw).execute({ districtId: 'd_joka' }));
    expect(zukan.district).toMatchObject({ id: 'd_joka', name: '城下地区', visitCount: 2, lastVisitLabel: '2026/11/02（月）' });
    expect(zukan.district.level).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(zukan)).not.toMatch(/rate|percent|total|%/i);
  });

  it('なじみ度は通った回数で 1回=訪問／3回=なじみ／5回=常連 になり、次の段階までの文言を返す', () => {
    expect([1, 2, 3, 4, 5, 9].map(familiarityOf)).toEqual([1, 1, 2, 2, 3, 3]);
    expect([1, 2, 3, 4, 5].map(nextFamiliarityText)).toEqual(['あと2回でなじみ', 'あと1回でなじみ', 'あと2回で常連', 'あと1回で常連', undefined]);
  });

  it('訪問済みタイルはなじみ度・訪れた季節（春→冬の順）・今日訪問したかを返す', async () => {
    const tw = createTestWorld();
    // 今日=2026-11-09（秋）。-120日=7月（夏）、-300日=1月（冬）
    await seedTraveler(tw, { visits: [['l_jo01', 0], ['l_jo01', -120], ['l_jo01', -300], ['s_jo01', -2]] });
    const zukan = must(await new GetZukanUseCase(tw).execute({ districtId: 'd_joka' }));
    expect(zukan.tiles.find((t) => t.id === 'l_jo01')).toMatchObject({
      visitCount: 3, familiarity: 2, familiarityLabel: 'なじみ', nextFamiliarityText: 'あと2回で常連', seasons: ['summer', 'autumn', 'winter'], visitedToday: true,
    });
    expect(zukan.tiles.find((t) => t.id === 's_jo01')).toMatchObject({ familiarity: 1, familiarityLabel: '訪問', seasons: ['autumn'], visitedToday: false });
  });

  it('ヘッダーは地区の色と、地区カードと同じ「次の目標」を返し、タブは色あせ状態を持つ', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -5]] });
    const zukan = must(await new GetZukanUseCase(tw).execute({ districtId: 'd_joka' }));
    const card = must(await new GetTownStateUseCase(tw).execute()).districts.find((d) => d.id === 'd_joka');
    expect(zukan.district.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(zukan.district.nextGoalText).toBe(card?.nextGoalText);
    expect(zukan.districts.find((d) => d.id === 'd_joka')?.fadeKind).toBe('fresh');
    expect(zukan.districts.find((d) => d.id === 'd_satoyama')?.fadeKind).toBe('never');
  });

  it('一度も訪れていない地区は lastVisitLabel なし・色あせは never', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const zukan = must(await new GetZukanUseCase(tw).execute({ districtId: 'd_satoyama' }));
    expect(zukan.district.lastVisitLabel).toBeUndefined();
    expect(zukan.district).toMatchObject({ visitCount: 0, level: 0, fade: { kind: 'never' } });
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
