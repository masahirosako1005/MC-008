import { describe, expect, it } from 'vitest';
import { photoCreditText, spotPhotoOf } from '@/presentation/shared/spotPhotos';

describe('spotPhotos', () => {
  it('名所は ID で実写の写真を引く（イメージではない）', () => {
    const photo = spotPhotoOf({ id: 'l_mm01', kind: 'landmark', category: '神社' });
    expect(photo).toMatchObject({ isImage: false });
    expect(photo?.src).toMatch(/photos\/landmarks\/l_mm01\.jpg$/);
    expect(photo?.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
  });

  it('店舗はカテゴリでイメージ写真を引く（店の ID によらない）', () => {
    const a = spotPhotoOf({ id: 's_mm01', kind: 'shop', category: '喫茶' });
    const b = spotPhotoOf({ id: 's_tm15', kind: 'shop', category: '喫茶' });
    expect(a).toMatchObject({ isImage: true });
    expect(a?.src).toBe(b?.src);
  });

  it('写真が無い名所・カテゴリは undefined（イラストを出す）', () => {
    expect(spotPhotoOf({ id: 'l_jo01', kind: 'landmark', category: '史跡' })).toBeUndefined();
    expect(spotPhotoOf({ id: 's_x', kind: 'shop', category: '存在しないカテゴリ' })).toBeUndefined();
    expect(spotPhotoOf({ kind: 'shop' })).toBeUndefined();
  });

  it('クレジットは作者・ライセンス・出典元を含み、イメージ写真はそう書く', () => {
    const real = spotPhotoOf({ id: 'l_mm01', kind: 'landmark' });
    const image = spotPhotoOf({ kind: 'shop', category: 'たこ焼き' });
    expect(real && photoCreditText(real)).toMatch(/^写真: .+ \/ .+（Wikimedia Commons）$/);
    expect(image && photoCreditText(image)).toMatch(/^イメージ写真: /);
  });
});
