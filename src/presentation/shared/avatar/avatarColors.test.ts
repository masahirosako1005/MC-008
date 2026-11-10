import { describe, expect, it } from 'vitest';
import { AVATAR_CATALOG } from '@/domain/avatar/AvatarCatalog';
import { HAIR_COLORS, TOP_COLORS, splitPartId } from '@/presentation/shared/avatar/avatarLook';

describe('色の部品の色表', () => {
  it('カタログの髪の色・トップスの色はすべて色表にある（無いと既定の色で描かれてしまう）', () => {
    const tables: Readonly<Record<string, Readonly<Record<string, string>>>> = { hairColor: HAIR_COLORS, topColor: TOP_COLORS };
    for (const part of AVATAR_CATALOG) {
      const table = tables[part.slot];
      if (table === undefined) continue;
      expect(table[splitPartId(part.id)?.style ?? ''], part.id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
