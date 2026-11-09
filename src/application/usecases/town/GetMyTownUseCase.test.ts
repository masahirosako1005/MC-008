import { describe, expect, it } from 'vitest';
import { InMemoryAvatarRepository } from '@/application/testing/InMemoryAvatarRepository';
import { createTestWorld, must, seedTraveler } from '@/application/testing/fakes';
import { EquipAvatarItemUseCase } from '@/application/usecases/town/EquipAvatarItemUseCase';
import { GetMyTownUseCase } from '@/application/usecases/town/GetMyTownUseCase';

/** 名所を3地区で訪れ（松）、イベント中の l_jo01 を訪れ（提灯）、同じ地区に3回通った（銀カード）旅人の訪問 */
const VISITS: readonly (readonly [string, number])[] = [['l_jo01', -6], ['l_jo01', -4], ['l_jo01', -2], ['l_mi01', -3], ['l_yu01', -1]];

/**
 * テスト用の世界と2つのユースケースを作る。
 * @returns 世界・取得・着せ替え
 */
function setup(): { tw: ReturnType<typeof createTestWorld>; get: GetMyTownUseCase; equip: EquipAvatarItemUseCase } {
  const tw = createTestWorld();
  const deps = { ...tw, avatars: new InMemoryAvatarRepository() };
  return { tw, get: new GetMyTownUseCase(deps), equip: new EquipAvatarItemUseCase(deps) };
}

describe('GetMyTownUseCase', () => {
  it('5地区・カード・次のカード・アイテム・ランクをまとめて返す（網羅率は返さない）', async () => {
    const { tw, get } = setup();
    await seedTraveler(tw, { visits: VISITS });
    const town = must(await get.execute());
    expect(town.totalVisits).toBe(VISITS.length);
    expect(town.districts.map((d) => d.id)).toEqual(['d_joka', 'd_minato', 'd_honmachi', 'd_satoyama', 'd_yunosato']);
    expect(town.cards).toEqual([expect.objectContaining({ districtId: 'd_joka', rank: 'silver' })]);
    expect(town.nextCards).toContainEqual(expect.objectContaining({ districtId: 'd_joka', rank: 'gold', remainingVisits: 7 }));
    expect(town.nextCards.map((c) => c.remainingVisits)).toEqual([...town.nextCards.map((c) => c.remainingVisits)].sort((a, b) => a - b));
    expect(town.items.map((i) => i.itemId)).toEqual(['i_chochin', 'i_matsu']);
    expect(town.lockedItems.map((i) => i.itemId)).toEqual(['i_nobori']);
    expect(town.lockedItems[0]?.hint).toContain('お店');
    expect(town.rank.name.length).toBeGreaterThan(0);
    expect(town.heldItemId).toBeUndefined();
    expect(Object.keys(town)).not.toContain('rate');
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const result = await setup().get.execute();
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });
});

describe('EquipAvatarItemUseCase', () => {
  it('持っているアイテムを持たせると、マイ街の heldItemId と isHeld に反映される', async () => {
    const { tw, get, equip } = setup();
    await seedTraveler(tw, { visits: VISITS });
    expect(must(await equip.execute({ itemId: 'i_matsu' }))).toEqual({ heldItemId: 'i_matsu' });
    const town = must(await get.execute());
    expect(town.heldItemId).toBe('i_matsu');
    expect(town.items.find((i) => i.itemId === 'i_matsu')?.isHeld).toBe(true);
    expect(town.items.find((i) => i.itemId === 'i_chochin')?.isHeld).toBe(false);
  });

  it('同じ選択を何度送っても結果は同じ（冪等）', async () => {
    const { tw, equip } = setup();
    await seedTraveler(tw, { visits: VISITS });
    must(await equip.execute({ itemId: 'i_matsu' }));
    expect(must(await equip.execute({ itemId: 'i_matsu' }))).toEqual({ heldItemId: 'i_matsu' });
  });

  it('itemId を省略するとカメラ（既定の姿）に戻す', async () => {
    const { tw, get, equip } = setup();
    await seedTraveler(tw, { visits: VISITS });
    must(await equip.execute({ itemId: 'i_matsu' }));
    must(await equip.execute({}));
    expect(must(await get.execute()).heldItemId).toBeUndefined();
  });

  it('持っていないアイテムは INVALID_INPUT で、装いは変わらない', async () => {
    const { tw, get, equip } = setup();
    await seedTraveler(tw, { visits: VISITS });
    const result = await equip.execute({ itemId: 'i_nobori' });
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    expect(must(await get.execute()).heldItemId).toBeUndefined();
  });

  it('形式が不正な ID は INVALID_INPUT（入力を信用しない）', async () => {
    const { tw, equip } = setup();
    await seedTraveler(tw, { visits: VISITS });
    const result = await equip.execute({ itemId: '<script>' });
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
  });
});
