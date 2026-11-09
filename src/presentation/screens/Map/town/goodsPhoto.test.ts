/**
 * @file goodsPhoto のテスト（全アイコンに写真があり、canvas の無い環境でも例外を出さず、どのアイコンも描き切れること）
 */
import { describe, expect, it } from 'vitest';
import { GOODS_PHOTO_ICONS, clearGoodsPhotoCache, drawGoodsPhoto, renderGoodsPhoto } from '@/presentation/screens/Map/town/goodsPhoto';
import { ALL_GOODS_ICONS } from '@/presentation/screens/Map/town/pixelSprites';

/**
 * どのメソッドを呼んでも何もしない、数だけ数える 2D コンテキスト（グラデーションも作れる）。
 * @returns コンテキストと呼び出し回数
 */
function fakeContext(): { ctx: CanvasRenderingContext2D; calls: () => number } {
  let calls = 0;
  const gradient = { addColorStop: (): void => undefined };
  const target: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(target, {
    get(obj, key) {
      if (key in obj) return obj[key];
      return (): unknown => {
        calls += 1;
        return key === 'createLinearGradient' || key === 'createRadialGradient' ? gradient : undefined;
      };
    },
    set(obj, key, value) {
      obj[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls: () => calls };
}

describe('goodsPhoto', () => {
  it('ドット絵の看板商品アイコンと同じ45種すべてに写真がある', () => {
    expect([...GOODS_PHOTO_ICONS].sort()).toEqual([...ALL_GOODS_ICONS].sort());
  });

  it('どのアイコンも例外なく描き切る（背景・被写体・仕上げ）', () => {
    for (const icon of GOODS_PHOTO_ICONS) {
      const fake = fakeContext();
      expect(() => renderGoodsPhoto(fake.ctx, icon), icon).not.toThrow();
      expect(fake.calls(), icon).toBeGreaterThan(50);
    }
  });

  it('document が無い環境では drawGoodsPhoto は何もしない（例外を出さない）', () => {
    clearGoodsPhotoCache();
    const fake = fakeContext();
    expect(() => drawGoodsPhoto(fake.ctx, 'coffee', 0, 0, 48)).not.toThrow();
    expect(() => drawGoodsPhoto(fake.ctx, 'ramen', 0, 0, 48, { silhouette: true, alpha: 0.5 })).not.toThrow();
    expect(fake.calls()).toBe(0);
  });
});
