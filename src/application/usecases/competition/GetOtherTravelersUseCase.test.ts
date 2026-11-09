import { describe, expect, it } from 'vitest';
import { createTestWorld, must, seedLordship, seedTraveler } from '@/application/testing/fakes';
import { GetOtherTravelersUseCase, initialOf } from '@/application/usecases/competition/GetOtherTravelersUseCase';

describe('GetOtherTravelersUseCase', () => {
  it('ライバルごとに、背景活動のある地区へ1件ずつ並べる（主がいなければ isLord は false）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const travelers = must(await new GetOtherTravelersUseCase(tw).execute());
    expect(travelers.map((t) => [t.key, t.name, t.initial, t.districtId, t.isLord])).toEqual([
      ['r_taro:d_joka', 'おまいり番長', 'お', 'd_joka', false],
      ['r_hana:d_minato', '花見は毎日派', '花', 'd_minato', false],
      ['r_hana:d_joka', '花見は毎日派', '花', 'd_joka', false],
    ]);
  });

  it('地区の主のライバルは、背景活動の無い地区にも出て isLord が true になる（旅人が主の地区は false）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    await seedLordship(tw, [
      { districtId: 'd_honmachi', holder: 'r_taro' },
      { districtId: 'd_joka', holder: 'traveler' },
    ]);
    const travelers = must(await new GetOtherTravelersUseCase(tw).execute());
    const taro = travelers.filter((t) => t.name === 'おまいり番長');
    expect(taro.map((t) => [t.districtId, t.isLord])).toEqual([
      ['d_joka', false],
      ['d_honmachi', true],
    ]);
  });

  it('旅人がいないときは世界の読み込みエラーをそのまま返す', async () => {
    const tw = createTestWorld();
    const result = await new GetOtherTravelersUseCase(tw).execute();
    expect(result.ok).toBe(false);
  });
});

describe('initialOf', () => {
  it('最初の1文字を返す（「旅人」の接頭辞があれば除く）', () => {
    expect(initialOf('親子でてくてく')).toBe('親');
    expect(initialOf('旅人アオイ')).toBe('ア');
    expect(initialOf('みなと')).toBe('み');
    expect(initialOf('旅人')).toBe('旅');
    expect(initialOf('')).toBe('？');
  });
});
