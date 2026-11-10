import { describe, expect, it } from 'vitest';
import { unlockHintOf, unlockUnitOf } from '@/application/usecases/avatar/avatarWardrobe';
import { RANK_THRESHOLDS } from '@/domain/reward/constants';

describe('EXP の特典の手に入れ方の文言', () => {
  const name = (): string => '';

  it('ランクの閾値ちょうどは「ランク「○○」になる」、それ以外は「EXPを○ためる」', () => {
    const rank = RANK_THRESHOLDS[2];
    if (rank === undefined) throw new Error('fixture');
    expect(unlockHintOf({ kind: 'exp', points: rank.min }, name)).toBe(`ランク「${rank.name}」になる`);
    expect(unlockHintOf({ kind: 'exp', points: 650 }, name)).toBe('EXPを650ためる');
    expect(unlockUnitOf({ kind: 'exp', points: 650 })).toBe('EXP');
  });
});
