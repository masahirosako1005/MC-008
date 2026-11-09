import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseSpotId } from '@/Common/types/Id';
import { jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { AVATAR_CATALOG, AVATAR_SLOTS, DEFAULT_PART_IDS, MAX_OBJECTS, avatarPartOf } from '@/domain/avatar/AvatarCatalog';
import { avatarProgressOf, normalizeOutfit, ownedPartIdsOf, partProgressOf } from '@/domain/avatar/AvatarUnlockPolicy';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

let seq = 0;
/** テスト用: 訪問記録 */
function visit(spot: string, district: string, date: string): VisitRecord {
  seq += 1;
  const localDate = must(parseLocalDate(date));
  return {
    spotId: must(parseSpotId(spot)),
    districtId: must(parseDistrictId(district)),
    visitedAt: jstInstantOf(localDate, 10),
    localDate,
    operationId: must(parseOperationId(`00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`)),
  };
}

const NONE = avatarProgressOf({ visits: [], silverCards: 0, goldCards: 0, itemIds: [] });

describe('AvatarCatalog', () => {
  it('部品ID は一意で、枠の名前で始まる', () => {
    const ids = AVATAR_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of AVATAR_CATALOG) expect(p.id.startsWith(`${p.slot}.`)).toBe(true);
  });

  it('どの枠にも部品があり、はじめから持っている部品が1つ以上ある（相棒・称号以外）', () => {
    for (const slot of AVATAR_SLOTS) {
      const parts = AVATAR_CATALOG.filter((p) => p.slot === slot);
      expect(parts.length).toBeGreaterThan(0);
      if (slot !== 'pet') expect(parts.some((p) => p.unlock.kind === 'free')).toBe(true);
    }
  });

  it('既定の部品はすべて定義があり、はじめから持っている', () => {
    for (const id of DEFAULT_PART_IDS) expect(avatarPartOf(id)?.unlock.kind).toBe('free');
  });
});

describe('avatarProgressOf', () => {
  it('回数・日数・地区・お店・名所を数える', () => {
    const p = avatarProgressOf({
      visits: [
        visit('l_tm01', 'd_tenma', '2026-11-01'), visit('s_tm01', 'd_tenma', '2026-11-01'), visit('s_tm01', 'd_tenma', '2026-11-03'),
        visit('l_ok01', 'd_okawa', '2026-11-04'),
      ],
      silverCards: 1,
      goldCards: 0,
      itemIds: ['i_nobori'],
    });
    expect(p.totalVisits).toBe(4);
    expect(p.visitDays).toBe(3);
    expect(p.districtVisits.get('d_tenma')).toBe(3);
    expect(p.districts).toBe(2);
    expect(p.shops).toBe(1);
    expect(p.landmarks).toBe(2);
    expect(p.itemIds.has('i_nobori')).toBe(true);
  });
});

describe('partProgressOf / ownedPartIdsOf', () => {
  it('はじめての人は、はじめから持っている部品だけを持つ', () => {
    const owned = ownedPartIdsOf(NONE);
    expect(owned.has('hair.short')).toBe(true);
    expect(owned.has('hair.bun')).toBe(false);
    expect([...owned].every((id) => avatarPartOf(id)?.unlock.kind === 'free')).toBe(true);
  });

  it('地区に通うと、その地区の部品が手に入る。いまの値は目標で止める', () => {
    const visits = Array.from({ length: 12 }, (_, i) => visit('s_tm01', 'd_tenma', `2026-10-${String(i + 1).padStart(2, '0')}`));
    const p = avatarProgressOf({ visits, silverCards: 1, goldCards: 1, itemIds: [] });
    const happi = avatarPartOf('top.happi');
    expect(happi).toBeDefined();
    if (happi === undefined) return;
    expect(partProgressOf(happi, p)).toEqual({ unlocked: true, current: 5, target: 5 });
    const owned = ownedPartIdsOf(p);
    expect(owned.has('background.tenma')).toBe(true);
    expect(owned.has('hat.crown')).toBe(true);
    expect(owned.has('background.okawa')).toBe(false);
  });
});

describe('normalizeOutfit', () => {
  const owned = ownedPartIdsOf(NONE);

  it('空なら必須の枠を既定で埋める（はずせる枠は空のまま）', () => {
    const outfit = normalizeOutfit([], owned);
    expect(outfit).toContain('hair.short');
    expect(outfit).toContain('background.dreamy');
    expect(outfit.some((id) => id.startsWith('hat.'))).toBe(false);
  });

  it('知らない・持っていない・形の違う部品を外し、1枠1つ（後を優先）にする', () => {
    const outfit = normalizeOutfit(['hair.bob', 'hair.long', 'hair.afro', 'nope.x', 42, '<script>'], owned);
    expect(outfit.filter((id) => id.startsWith('hair.'))).toEqual(['hair.long']);
  });

  it(`置くものは重複なしで最大 ${MAX_OBJECTS} つ`, () => {
    const all = ownedPartIdsOf(avatarProgressOf({ visits: Array.from({ length: 40 }, (_, i) => visit(`s_tm0${(i % 5) + 1}`, 'd_tenma', `2026-09-${String((i % 28) + 1).padStart(2, '0')}`)), silverCards: 5, goldCards: 5, itemIds: [] }));
    const outfit = normalizeOutfit(['object.bench', 'object.bench', 'object.plant', 'object.postbox', 'object.bicycle'], all);
    expect(outfit.filter((id) => id.startsWith('object.'))).toEqual(['object.bench', 'object.plant', 'object.postbox']);
  });
});
