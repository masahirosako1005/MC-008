import { describe, expect, it } from 'vitest';
import type { ZukanTileDto } from '@/application/dto/Dto';
import { stepStatesOf } from '@/presentation/screens/Zukan/CardPreview';
import { categoryIconOf, mysteryTeaserOf, rarityViewOf } from '@/presentation/screens/Zukan/cardFace';
import { ownedByRarity } from '@/presentation/screens/Zukan/RarityLegend';

const base: ZukanTileDto = { id: 'l_jo01', name: 'N西城跡', kind: 'landmark', category: '史跡', status: 'visited', visitCount: 2, rarity: 4, rarityName: 'レジェンド' };

describe('cardFace', () => {
  it('カテゴリごとにピクトグラムが変わり、未発見は出さない', () => {
    expect(categoryIconOf(base)).toBe('🏯');
    expect(categoryIconOf({ ...base, category: 'カフェ' })).toBe('☕');
    expect(categoryIconOf({ ...base, category: '未知のカテゴリ', kind: 'shop' })).toBe('🏪');
    expect(categoryIconOf({ kind: 'landmark', status: 'unknown', visitCount: 0, rarity: 4 })).toBeUndefined();
  });

  it('レア度は ★の数・略号・名前で示し、覚醒は「極」', () => {
    expect(rarityViewOf(base)).toEqual({ rarity: 4, stars: '★★★★', code: 'LG', name: 'レジェンド' });
    expect(rarityViewOf({ ...base, awakened: true })).toMatchObject({ code: '極', name: '極・レジェンド' });
    expect(rarityViewOf({ ...base, rarity: undefined, rarityName: undefined })).toMatchObject({ rarity: 1, code: 'N' });
  });

  it('未発見のレジェンドは象徴が眠っていると煽る', () => {
    expect(mysteryTeaserOf(4)).toContain('象徴');
  });

  it('取得方法の手順は 発見済み→訪問が次、訪問済み→特別な条件が次', () => {
    expect(stepStatesOf({ ...base, status: 'unknown' }, 3)).toEqual(['next', 'todo', 'todo']);
    expect(stepStatesOf({ ...base, status: 'discovered' }, 3)).toEqual(['done', 'next', 'todo']);
    expect(stepStatesOf(base, 3)).toEqual(['done', 'done', 'next']);
    expect(stepStatesOf({ ...base, familiarity: 3 }, 3)).toEqual(['done', 'done', 'next']);
    expect(stepStatesOf({ ...base, rarity: 3, familiarity: 3 }, 3)).toEqual(['done', 'done', 'done']);
    expect(stepStatesOf({ ...base, awakened: true }, 3)).toEqual(['done', 'done', 'done']);
  });

  it('手持ちは訪問済みだけをレア度ごとに数える', () => {
    expect(ownedByRarity([base, { ...base, status: 'discovered' }, { ...base, rarity: 2 }])).toEqual({ 1: 0, 2: 1, 3: 0, 4: 1 });
  });
});
