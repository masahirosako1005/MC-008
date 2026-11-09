import { describe, expect, it } from 'vitest';
import { InMemoryAvatarRepository } from '@/application/testing/InMemoryAvatarRepository';
import { TEST_TRAVELER_ID, createTestWorld, must, seedTraveler } from '@/application/testing/fakes';
import { GetAvatarClosetUseCase } from '@/application/usecases/avatar/GetAvatarClosetUseCase';
import { SaveAvatarUseCase } from '@/application/usecases/avatar/SaveAvatarUseCase';
import { parseItemId } from '@/Common/types/Id';
import { AVATAR_CATALOG } from '@/domain/avatar/AvatarCatalog';

/** 5回通った旅人（l_jo01 に3回＝銀カード、名所3地区＝松、イベント中の l_jo01＝提灯） */
const VISITS: readonly (readonly [string, number])[] = [['l_jo01', -6], ['l_jo01', -4], ['l_jo01', -2], ['l_mi01', -3], ['l_yu01', -1]];

/**
 * テスト用の世界とユースケースを作る。
 * @returns 世界・装いのリポジトリ・取得・保存
 */
function setup(): { tw: ReturnType<typeof createTestWorld>; avatars: InMemoryAvatarRepository; get: GetAvatarClosetUseCase; save: SaveAvatarUseCase } {
  const tw = createTestWorld();
  const avatars = new InMemoryAvatarRepository();
  const deps = { ...tw, avatars };
  return { tw, avatars, get: new GetAvatarClosetUseCase(deps), save: new SaveAvatarUseCase(deps) };
}

describe('GetAvatarClosetUseCase', () => {
  it('すべての部品を、持っているか・手に入れ方・進み具合つきで返す', async () => {
    const { tw, get } = setup();
    await seedTraveler(tw, { visits: VISITS });
    const closet = must(await get.execute());
    expect(closet.parts).toHaveLength(AVATAR_CATALOG.length);
    expect(closet.totalVisits).toBe(5);
    const bun = closet.parts.find((p) => p.id === 'hair.bun');
    expect(bun).toMatchObject({ owned: true, isNew: false, current: 3, target: 3 });
    expect(closet.needsSeenBaseline).toBe(true);
    const afro = closet.parts.find((p) => p.id === 'hair.afro');
    expect(afro).toMatchObject({ owned: false, isNew: false, current: 5, target: 30 });
    expect(afro?.hint).toContain('30回');
    expect(closet.parts.find((p) => p.id === 'held.matsu')?.owned).toBe(true);
    expect(closet.parts.find((p) => p.id === 'top.happi')?.districtId).toBe('d_tenma');
    expect(closet.parts.find((p) => p.id === 'hair.short')?.isNew).toBe(false);
    expect(closet.coords.map((c) => c.partIds)).toEqual([undefined, undefined, undefined]);
  });

  it('見た部品を保存したあとに手に入れた部品だけが NEW になる', async () => {
    const { tw, avatars, get } = setup();
    await seedTraveler(tw, { visits: VISITS });
    must(await avatars.save(TEST_TRAVELER_ID, { seenPartIds: ['hair.short'] }));
    const closet = must(await get.execute());
    expect(closet.needsSeenBaseline).toBe(false);
    expect(closet.parts.find((p) => p.id === 'hair.bun')?.isNew).toBe(true);
    expect(closet.parts.find((p) => p.id === 'hair.afro')?.isNew).toBe(false);
  });

  it('旧来の「手に持つアイテム」だけの保存データは、持ち物の初期値として引き継ぐ', async () => {
    const { tw, avatars, get } = setup();
    await seedTraveler(tw, { visits: VISITS });
    must(await avatars.save(TEST_TRAVELER_ID, { heldItemId: must(parseItemId('i_matsu')) }));
    const closet = must(await get.execute());
    expect(closet.outfit).toContain('held.matsu');
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const result = await setup().get.execute();
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });
});

describe('SaveAvatarUseCase', () => {
  it('持っている部品は保存し、持っていない・知らない部品は外す（入力を信用しない）', async () => {
    const { tw, get, save } = setup();
    await seedTraveler(tw, { visits: VISITS });
    const saved = must(await save.execute({ outfit: ['hair.bun', 'hat.crown', 'object.bench', '<script>', 'top.kimono'] }));
    expect(saved.outfit).toContain('hair.bun');
    expect(saved.outfit).toContain('object.bench');
    expect(saved.outfit).not.toContain('hat.crown');
    expect(saved.outfit).toContain('top.tee');
    expect(must(await get.execute()).outfit).toEqual(saved.outfit);
  });

  it('同じ内容を何度送っても結果は同じ（冪等）', async () => {
    const { tw, save } = setup();
    await seedTraveler(tw, { visits: VISITS });
    const first = must(await save.execute({ outfit: ['hair.bob'] }));
    expect(must(await save.execute({ outfit: ['hair.bob'] }))).toEqual(first);
  });

  it('マイコーデを保存・削除でき、見た部品は NEW でなくなる', async () => {
    const { tw, get, save } = setup();
    await seedTraveler(tw, { visits: VISITS });
    must(await save.execute({ coord: { index: 1, partIds: ['hair.long', 'pet.hiyoko'] }, seenPartIds: ['hair.bun', 'nope.x'] }));
    let closet = must(await get.execute());
    expect(closet.coords[1]?.partIds).toContain('hair.long');
    expect(closet.coords[1]?.partIds).toContain('pet.hiyoko');
    expect(closet.parts.find((p) => p.id === 'hair.bun')?.isNew).toBe(false);
    must(await save.execute({ coord: { index: 1, partIds: null } }));
    closet = must(await get.execute());
    expect(closet.coords[1]?.partIds).toBeUndefined();
  });

  it('形の違う入力（枠番号の範囲外・長すぎる配列）は INVALID_INPUT', async () => {
    const { tw, save } = setup();
    await seedTraveler(tw, { visits: VISITS });
    for (const input of [{ coord: { index: 3, partIds: [] } }, { coord: { index: -1, partIds: null } }, { outfit: Array.from({ length: 40 }, () => 'hair.bob') }]) {
      const result = await save.execute(input);
      expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    }
  });
});

describe('GetAvatarClosetUseCase（ご当地・季節）', () => {
  it('いまの季節とコレクションを返し、季節の部品には季節、ご当地の部品には地区の札が付く', async () => {
    const { tw, get } = setup();
    await seedTraveler(tw, { visits: VISITS });
    const closet = must(await get.execute());
    expect(['spring', 'summer', 'autumn', 'winter']).toContain(closet.season);
    expect(closet.sets.length).toBeGreaterThanOrEqual(9);
    expect(closet.sets.find((s) => s.id === 'set.winter')).toMatchObject({ kind: 'season', label: '冬' });
    const uso = closet.parts.find((p) => p.id === 'pet.uso');
    expect(uso).toMatchObject({ season: 'winter', districtId: 'd_minamimori' });
    expect(uso?.hint).toMatch(/^冬に.+に1回訪れる$/);
    expect(closet.parts.find((p) => p.id === 'held.dango')?.hint).toBe('春に1回通う');
    expect(closet.parts.find((p) => p.id === 'body.girl')?.owned).toBe(true);
  });
});
