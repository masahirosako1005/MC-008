import { describe, expect, it } from 'vitest';
import { AVATAR_CATALOG, avatarPartOf } from '@/domain/avatar/AvatarCatalog';
import { avatarProgressOf, ownedPartIdsOf, partProgressOf } from '@/domain/avatar/AvatarUnlockPolicy';

/** EXP だけを変えた実績 */
const withExp = (exp?: number): ReturnType<typeof avatarProgressOf> => avatarProgressOf({ visits: [], silverCards: 0, goldCards: 0, itemIds: [], ...(exp === undefined ? {} : { exp }) });

/** EXP の特典の部品 */
const EXP_PARTS = AVATAR_CATALOG.filter((p) => p.unlock.kind === 'exp');

describe('累計 EXP で手に入る部品（ランク画面の特典）', () => {
  it('カタログに EXP の特典がある', () => {
    expect(EXP_PARTS.length).toBeGreaterThan(0);
  });

  it('累計 EXP が閾値に届くと持っている部品になり、届かなければ進み具合を返す', () => {
    const platinum = avatarPartOf('topColor.platinum');
    if (platinum === undefined) throw new Error('fixture');
    expect(partProgressOf(platinum, withExp(649))).toEqual({ unlocked: false, current: 649, target: 650 });
    expect(partProgressOf(platinum, withExp(650))).toEqual({ unlocked: true, current: 650, target: 650 });
    expect(ownedPartIdsOf(withExp(650)).has('topColor.platinum')).toBe(true);
    expect(ownedPartIdsOf(withExp(650)).has('title.mythic')).toBe(false);
  });

  it('EXP を渡さない・非数・負値は 0、小数は切り捨て', () => {
    expect(withExp().exp).toBe(0);
    expect(withExp(Number.NaN).exp).toBe(0);
    expect(withExp(-5).exp).toBe(0);
    expect(withExp(24.9).exp).toBe(24);
    expect([...ownedPartIdsOf(withExp())].some((id) => EXP_PARTS.some((p) => p.id === id))).toBe(false);
  });
});
