import { describe, expect, it } from 'vitest';
import { GROWTH_LV1_SCORE, GROWTH_LV2_SCORE, GROWTH_LV3_SCORE, MAX_BUILDINGS } from '@/domain/town/constants';
import { buildingsFor, growthScore, GrowthPolicy, levelFor, nextGoal } from '@/domain/town/GrowthPolicy';

/** テスト用: 再現可能な擬似乱数（線形合同法。Math.random を使わず毎回同じ列にする） */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('growthScore', () => {
  it('種類数と訪問回数の和を返す（D3）', () => {
    expect(growthScore(0, 0)).toBe(0);
    expect(growthScore(1, 1)).toBe(2);
    expect(growthScore(3, 7)).toBe(10);
  });
  it('同じスポットに通い続けるだけでもスコアが増える（網羅しなくても育つ）', () => {
    expect(growthScore(1, 1)).toBeLessThan(growthScore(1, 2));
    expect(growthScore(1, 2)).toBeLessThan(growthScore(1, 9));
  });
  it('不正な件数（負数・非数・無限大）は 0 として扱う', () => {
    expect(growthScore(-1, 3)).toBe(3);
    expect(growthScore(2, -5)).toBe(2);
    expect(growthScore(Number.NaN, 4)).toBe(4);
    expect(growthScore(1, Number.POSITIVE_INFINITY)).toBe(1);
    expect(growthScore(Number.NEGATIVE_INFINITY, Number.NaN)).toBe(0);
  });
  it('小数は切り捨てる', () => {
    expect(growthScore(1.9, 2.5)).toBe(3);
  });
});

describe('levelFor', () => {
  it.each([
    [0, 0],
    [1, 1],
    [4, 1],
    [5, 2],
    [9, 2],
    [10, 3],
    [11, 3],
    [1000, 3],
  ])('スコア %i は Lv%i（境界値）', (score, level) => {
    expect(levelFor(score)).toBe(level);
  });
  it('境界値は constants.ts の定数どおり', () => {
    expect(levelFor(GROWTH_LV1_SCORE - 1)).toBe(0);
    expect(levelFor(GROWTH_LV1_SCORE)).toBe(1);
    expect(levelFor(GROWTH_LV2_SCORE - 1)).toBe(1);
    expect(levelFor(GROWTH_LV2_SCORE)).toBe(2);
    expect(levelFor(GROWTH_LV3_SCORE - 1)).toBe(2);
    expect(levelFor(GROWTH_LV3_SCORE)).toBe(3);
  });
  it('不正なスコア（負数・非数・無限大）は Lv0', () => {
    expect(levelFor(-1)).toBe(0);
    expect(levelFor(Number.NaN)).toBe(0);
    expect(levelFor(Number.POSITIVE_INFINITY)).toBe(0);
  });
  it('小数は切り捨ててから判定する（4.9 は Lv1）', () => {
    expect(levelFor(4.9)).toBe(1);
  });
});

describe('buildingsFor', () => {
  it('スコアと同じ数だけ建物を描く', () => {
    expect(buildingsFor(0)).toBe(0);
    expect(buildingsFor(1)).toBe(1);
    expect(buildingsFor(5)).toBe(5);
  });
  it('MAX_BUILDINGS で頭打ちになる（上限）', () => {
    expect(buildingsFor(MAX_BUILDINGS - 1)).toBe(MAX_BUILDINGS - 1);
    expect(buildingsFor(MAX_BUILDINGS)).toBe(MAX_BUILDINGS);
    expect(buildingsFor(MAX_BUILDINGS + 1)).toBe(MAX_BUILDINGS);
    expect(buildingsFor(10_000)).toBe(MAX_BUILDINGS);
  });
  it('不正なスコアは 0 棟', () => {
    expect(buildingsFor(-3)).toBe(0);
    expect(buildingsFor(Number.NaN)).toBe(0);
  });
});

describe('nextGoal', () => {
  it('次の段階と残りスコアを返す', () => {
    expect(nextGoal(0)).toEqual({ nextLevel: 1, remainingScore: 1 });
    expect(nextGoal(1)).toEqual({ nextLevel: 2, remainingScore: 4 });
    expect(nextGoal(4)).toEqual({ nextLevel: 2, remainingScore: 1 });
    expect(nextGoal(5)).toEqual({ nextLevel: 3, remainingScore: 5 });
    expect(nextGoal(9)).toEqual({ nextLevel: 3, remainingScore: 1 });
  });
  it('Lv3 では次の目標が無い', () => {
    expect(nextGoal(10)).toBeUndefined();
    expect(nextGoal(500)).toBeUndefined();
  });
  it('不正なスコアは 0 として扱う', () => {
    expect(nextGoal(-7)).toEqual({ nextLevel: 1, remainingScore: 1 });
    expect(nextGoal(Number.NaN)).toEqual({ nextLevel: 1, remainingScore: 1 });
  });
  it('残りスコアは常に 1 以上', () => {
    for (let score = 0; score < GROWTH_LV3_SCORE; score += 1) {
      expect(nextGoal(score)?.remainingScore).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('成長の単調性（成長は下がらない＝CLAUDE.md 4.3）', () => {
  it('訪問を1件ずつ追加しても score・Lv・建物数は減らない（ランダムな訪問列 200 通り）', () => {
    const random = seededRandom(20261109);
    for (let trial = 0; trial < 200; trial += 1) {
      const visitedSpots = new Set<number>();
      let visitCount = 0;
      let previous = { score: 0, level: 0, buildings: 0 };
      const length = 1 + Math.floor(random() * 30);
      for (let step = 0; step < length; step += 1) {
        visitedSpots.add(Math.floor(random() * 8));
        visitCount += 1;
        const score = growthScore(visitedSpots.size, visitCount);
        const current = { score, level: levelFor(score), buildings: buildingsFor(score) };
        expect(current.score).toBeGreaterThan(previous.score);
        expect(current.level).toBeGreaterThanOrEqual(previous.level);
        expect(current.buildings).toBeGreaterThanOrEqual(previous.buildings);
        previous = current;
      }
    }
  });
  it('levelFor・buildingsFor はスコアについて単調非減少', () => {
    for (let score = 0; score < 50; score += 1) {
      expect(levelFor(score + 1)).toBeGreaterThanOrEqual(levelFor(score));
      expect(buildingsFor(score + 1)).toBeGreaterThanOrEqual(buildingsFor(score));
    }
  });
});

describe('決定論（DI-05）', () => {
  it('同じ入力には同じ出力を返す', () => {
    expect(growthScore(2, 6)).toBe(growthScore(2, 6));
    expect(nextGoal(3)).toEqual(nextGoal(3));
  });
  it('名前空間 GrowthPolicy は名前付き export と同じ関数を指す', () => {
    expect(GrowthPolicy.growthScore).toBe(growthScore);
    expect(GrowthPolicy.levelFor).toBe(levelFor);
    expect(GrowthPolicy.buildingsFor).toBe(buildingsFor);
    expect(GrowthPolicy.nextGoal).toBe(nextGoal);
  });
});
