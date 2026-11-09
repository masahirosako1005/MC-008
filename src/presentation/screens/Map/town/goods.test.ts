import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { awningColorOf, goodsOf, landmarkSpriteOf, todaySpecialOf } from '@/presentation/screens/Map/town/goods';
import { ALL_BADGE_SPRITES, ALL_GOODS_ICONS, ALL_LANDMARK_SPRITES, drawGoods, spritePixels } from '@/presentation/screens/Map/town/pixelSprites';

interface MasterSpot {
  readonly id: string;
  readonly category: string;
}

const shops = (JSON.parse(readFileSync('public/master/shops.json', 'utf8')) as { shops: MasterSpot[] }).shops;
const landmarks = (JSON.parse(readFileSync('public/master/landmarks.json', 'utf8')) as { landmarks: MasterSpot[] }).landmarks;

describe('goodsOf', () => {
  it('全66店が店ごとのおすすめ（既定以外）を持つ', () => {
    expect(shops).toHaveLength(66);
    for (const shop of shops) {
      const goods = goodsOf({ id: shop.id, kind: 'shop', category: shop.category });
      expect(goods.label, shop.id).not.toBe('おすすめ');
      expect(ALL_GOODS_ICONS).toContain(goods.icon);
    }
  });

  it('名所14件にも見どころがある', () => {
    for (const landmark of landmarks) expect(goodsOf({ id: landmark.id, kind: 'landmark', category: landmark.category }).label).not.toBe('おすすめ');
  });

  it('表に無い店はカテゴリの既定、カテゴリも知らなければ gift / おすすめ', () => {
    expect(goodsOf({ id: 's_new', kind: 'shop', category: 'パン' })).toEqual({ icon: 'bread', label: '焼きたてパン' });
    expect(goodsOf({ id: 's_new', kind: 'shop', category: '謎' })).toEqual({ icon: 'gift', label: 'おすすめ' });
    expect(goodsOf({ id: 's_new', kind: 'shop' })).toEqual({ icon: 'gift', label: 'おすすめ' });
  });
});

describe('landmarkSpriteOf / awningColorOf', () => {
  it('名所のカテゴリを建物の絵にする（知らなければ museum）', () => {
    expect(landmarkSpriteOf('神社')).toBe('shrine');
    expect(landmarkSpriteOf('建築')).toBe('western');
    expect(landmarkSpriteOf(undefined)).toBe('museum');
    for (const landmark of landmarks) expect(ALL_LANDMARK_SPRITES).toContain(landmarkSpriteOf(landmark.category));
  });

  it('ひさしの色は #rrggbb で、全店のカテゴリに既定以外の色がある', () => {
    for (const shop of shops) expect(awningColorOf(shop.category)).toMatch(/^#[0-9a-f]{6}$/);
    expect(awningColorOf('たこ焼き')).not.toBe(awningColorOf('古書'));
  });
});

describe('todaySpecialOf', () => {
  it('同じ店・同じ日なら同じ結果（決定論的）', () => {
    for (const shop of shops) {
      const label = goodsOf({ id: shop.id, kind: 'shop', category: shop.category }).label;
      expect(todaySpecialOf(shop.id, 'shop', label, '2026-11-09')).toEqual(todaySpecialOf(shop.id, 'shop', label, '2026-11-09'));
    }
  });

  it('ある日付で店の5〜25%に出て、日付が変わると顔ぶれが変わる', () => {
    const pick = (today: string): string[] =>
      shops.filter((shop) => todaySpecialOf(shop.id, 'shop', goodsOf({ id: shop.id, kind: 'shop', category: shop.category }).label, today) !== undefined).map((s) => s.id);
    for (const today of ['2026-11-09', '2026-11-10', '2026-12-09', '2027-02-11']) {
      const ratio = pick(today).length / shops.length;
      expect(ratio, today).toBeGreaterThanOrEqual(0.05);
      expect(ratio, today).toBeLessThanOrEqual(0.25);
    }
    expect(pick('2026-11-09')).not.toEqual(pick('2026-11-10'));
  });

  it('名所には出さない／文言に商品名が入る', () => {
    for (const landmark of landmarks) expect(todaySpecialOf(landmark.id, 'landmark', '見どころ', '2026-11-09')).toBeUndefined();
    const shop = shops.find((s) => todaySpecialOf(s.id, 'shop', 'テスト品', '2026-11-09') !== undefined);
    expect(shop).toBeDefined();
    expect(todaySpecialOf(shop?.id ?? '', 'shop', 'テスト品', '2026-11-09')?.title).toContain('テスト品');
  });
});

describe('pixelSprites の定義', () => {
  it('商品アイコンはすべて 12x12 で、定義の不備が無く、色のついたドットがある', () => {
    for (const icon of ALL_GOODS_ICONS) {
      const sprite = spritePixels('goods', icon);
      expect(sprite.issues, icon).toEqual([]);
      expect([sprite.w, sprite.h], icon).toEqual([12, 12]);
      expect(sprite.pixels.filter((c) => c !== undefined).length, icon).toBeGreaterThan(30);
    }
  });

  it('名所・バッジ・店・トイレも不備なく作れる', () => {
    for (const id of ALL_LANDMARK_SPRITES) {
      const sprite = spritePixels('landmark', id);
      expect(sprite.issues, id).toEqual([]);
      expect(sprite.w, id).toBeGreaterThanOrEqual(28);
    }
    for (const id of ALL_BADGE_SPRITES) {
      const sprite = spritePixels('badge', id);
      expect(sprite.issues, id).toEqual([]);
      expect(sprite.w, id).toBe(sprite.h);
    }
    expect(spritePixels('shop', '#e2574c')).toMatchObject({ w: 24, h: 24, issues: [] });
    expect(spritePixels('toilet', 'wc')).toMatchObject({ w: 16, h: 16, issues: [] });
    expect(spritePixels('toilet', 'nursing')).toMatchObject({ w: 16, h: 16, issues: [] });
  });

  it('canvas の無い環境（node）では描画しても例外を出さない', () => {
    const calls: string[] = [];
    const ctx = { drawImage: (): void => void calls.push('draw'), imageSmoothingEnabled: true, globalAlpha: 1 } as unknown as CanvasRenderingContext2D;
    expect(() => drawGoods(ctx, 'coffee', 10, 10, 2)).not.toThrow();
    expect(calls).toEqual([]);
  });
});
