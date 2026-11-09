import { describe, expect, it } from 'vitest';
import type { MyTownDto } from '@/application/dto/Dto';
import { AVATAR_BOX, avatarLookOfTown, avatarSpriteFor, spriteDotsOf } from '@/presentation/shared/avatarSprite';

/**
 * avatarLookOfTown が使う項目（地区ごとの訪問回数・主か・色あせの種類・持ち物）だけを持つマイ街のデータを作る。
 * @param districts 地区ごとの訪問回数と主か
 * @param heldItemId 持ち物
 * @returns マイ街のデータ
 */
function town(districts: readonly { readonly visitCount: number; readonly isLordMe: boolean }[], heldItemId?: string): MyTownDto {
  return { districts: districts.map((d) => ({ ...d, fade: { kind: d.visitCount > 0 ? 'fresh' : 'never' } })), heldItemId } as unknown as MyTownDto;
}

describe('avatarLookOfTown', () => {
  it('マイ街と同じ規則で装いを決める（主なら王冠、通っていればベレー、10回以上でねこ）', () => {
    expect(avatarLookOfTown(town([{ visitCount: 0, isLordMe: false }])).hat).toBeUndefined();
    expect(avatarLookOfTown(town([{ visitCount: 3, isLordMe: false }])).hat).toBe('beret');
    const lord = avatarLookOfTown(town([{ visitCount: 8, isLordMe: true }, { visitCount: 4, isLordMe: false }]));
    expect(lord.hat).toBe('crown');
    expect(lord.hasCat).toBe(true);
    expect(lord.held).toBe('camera');
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
