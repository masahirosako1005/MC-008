import { describe, expect, it } from 'vitest';
import { RANK_THRESHOLDS } from '@/domain/reward/constants';
import { TravelerRank, rankOf } from '@/domain/reward/TravelerRank';

describe('冒険者ランク（累計ポイントで判定＝D11）', () => {
  it.each([
    [0, '見習い冒険者', 0, 50, 50],
    [49, '見習い冒険者', 0, 50, 1],
    [50, '冒険者', 1, 150, 100],
    [149, '冒険者', 1, 150, 1],
    [150, 'ベテラン冒険者', 2, 400, 250],
    [399, 'ベテラン冒険者', 2, 400, 1],
    [400, '街の英雄', 3, 800, 400],
    [799, '街の英雄', 3, 800, 1],
  ])('%i ポイントは %s（段 %i、次は %i、あと %i）', (points, name, index, nextAt, remaining) => {
    expect(rankOf(points)).toEqual({ name, index, nextAt, remaining });
  });

  it.each([800, 801, 100000])('%i ポイントは最上位「街の伝説」で次の段は無い', (points) => {
    expect(rankOf(points)).toEqual({ name: '街の伝説', index: RANK_THRESHOLDS.length - 1 });
  });

  it.each([
    ['負数', -10],
    ['NaN', Number.NaN],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('不正な値（%s）は 0 として最下段にする', (_label, points) => {
    expect(rankOf(points)).toEqual({ name: '見習い冒険者', index: 0, nextAt: 50, remaining: 50 });
  });

  it('Infinity は数値として扱えないので 0 として扱う', () => {
    expect(rankOf(Number.POSITIVE_INFINITY).index).toBe(0);
  });

  it('小数は切り捨てて判定する（49.9 はまだ 50 未満）', () => {
    expect(rankOf(49.9)).toEqual({ name: '見習い冒険者', index: 0, nextAt: 50, remaining: 1 });
  });

  it('ポイントが増えてもランクは下がらない', () => {
    let prev = rankOf(0).index;
    for (let p = 0; p <= 1000; p += 7) {
      const current = rankOf(p).index;
      expect(current).toBeGreaterThanOrEqual(prev);
      prev = current;
    }
  });

  it('TravelerRank 名前空間から呼べる', () => {
    expect(TravelerRank.rankOf(150).name).toBe('ベテラン冒険者');
  });
});
