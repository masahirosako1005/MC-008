import { describe, expect, it } from 'vitest';
import type { MyTownDto } from '@/application/dto/Dto';
import { AVATAR_BOX, avatarLookOfTown, avatarSpriteFor, spriteDotsOf } from '@/presentation/shared/avatarSprite';

/**
 * avatarLookOfTown が使う項目（身につけている部品）だけを持つ旅人のまとめを作る。
 * @param avatarPartIds 身につけている部品
 * @returns 旅人のまとめ
 */
function town(avatarPartIds: readonly string[]): MyTownDto {
  return { avatarPartIds } as unknown as MyTownDto;
}

describe('avatarLookOfTown', () => {
  it('アバター画面で着せ替えた部品から装いを作る（未指定の項目は既定）', () => {
    const plain = avatarLookOfTown(town([]));
    expect(plain.hat).toBeUndefined();
    expect(plain.held).toBe('camera');
    const look = avatarLookOfTown(town(['hat.crown', 'hair.bob', 'pet.shiba', 'held.matsu', 'topColor.coral']));
    expect(look.hat).toBe('crown');
    expect(look.hair).toBe('bob');
    expect(look.pet).toBe('shiba');
    expect(look.held).toBe('matsu');
    expect(look.outfitColor).toBe('#ff7a5c');
  });
});

describe('spriteDotsOf', () => {
  it('絵の範囲＋ふち1ドットを含み、足元は左上から範囲の左・上の分だけ離れる', () => {
    const dots = spriteDotsOf(0.6, 2);
    expect(dots.footX).toBe(Math.ceil(AVATAR_BOX.left * 0.3) + 1);
    expect(dots.footY).toBe(Math.ceil(AVATAR_BOX.top * 0.3) + 1);
    expect(dots.width).toBe(dots.footX + Math.ceil(AVATAR_BOX.right * 0.3) + 1);
    expect(dots.height).toBe(dots.footY + Math.ceil(AVATAR_BOX.bottom * 0.3) + 1);
  });

  it('拡大率が大きいほどドット数が増える', () => {
    expect(spriteDotsOf(0.7, 2).height).toBeGreaterThan(spriteDotsOf(0.46, 2).height);
  });
});

describe('avatarSpriteFor', () => {
  it('DOM の無い環境では作らず undefined を返す（地図は人型のバッジで描く）', () => {
    expect(avatarSpriteFor({ outfitColor: '#6a9bcc', held: 'camera', hasCat: false }, { scale: 0.6, dotPx: 2, dpr: 1 })).toBeUndefined();
  });
});
