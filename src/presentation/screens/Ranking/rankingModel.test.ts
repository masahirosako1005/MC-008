import { describe, expect, it } from 'vitest';
import type { RankingEntryDto, RankingLordDto } from '@/application/dto/Dto';
import { chaserTextOf, gaugePercentOf, listEntriesOf, lordGoalText, podiumSlotsOf, rankChangeOf, rivalMarkOf } from '@/presentation/screens/Ranking/rankingModel';

/** テスト用の行 */
function entry(rank: number, name: string, isMe = false): RankingEntryDto {
  return { rank, name, isMe, count: 10 - rank, lordOf: [] };
}

describe('rankingModel', () => {
  it('表彰台は左から 2位・1位・3位 に並べ、4人目以降はリストへ', () => {
    const entries = [entry(1, 'A'), entry(2, 'B'), entry(3, 'C'), entry(4, 'D')];
    expect(podiumSlotsOf(entries).map((s) => [s.entry.name, s.place])).toEqual([['B', 'second'], ['A', 'first'], ['C', 'third']]);
    expect(listEntriesOf(entries).map((e) => e.name)).toEqual(['D']);
  });

  it('同順位は同じ高さの台にする', () => {
    const slots = podiumSlotsOf([entry(1, 'A'), entry(1, 'B'), entry(3, 'C')]);
    expect(slots.map((s) => s.place)).toEqual(['first', 'first', 'third']);
  });

  it('地区の主カードの文言（自分が主／取り返し中／主になれる）', () => {
    const base: RankingLordDto = { districtId: 'd_honmachi', districtName: '本町地区', lordName: '旅人タロウ', isMe: false, lost: true, lordCount: 12, myCount: 9, needed: 4 };
    expect(lordGoalText(base)).toBe('あなた 9回・取り返しまで あと4回');
    expect(lordGoalText({ ...base, lost: false })).toBe('あなた 9回・あと4回で主に');
    expect(lordGoalText({ ...base, isMe: true, lordName: 'あなた', needed: 0 })).toBe('あなたが主です（9回）');
  });
});

describe('rankingModel 競り合い', () => {
  const league = {
    id: 'kayoi', name: 'かよいリーグ', shortName: 'かよい', icon: '♛', tagline: '', rule: '', unit: '回', joined: true,
    entries: [entry(1, 'A'), entry(2, 'B'), entry(6, 'リク'), entry(7, 'あなた', true), entry(9, 'チヒロ')],
    myRank: 7, myCount: 5, nextStepText: '', myRankYesterday: 10,
    rivalAbove: { name: 'リク', rank: 6, count: 7, gap: 2 }, rivalBelow: { name: 'チヒロ', rank: 9, count: 4, gap: 1 }, podiumGap: 6,
  } as const;

  it('昨日より順位が上がると up と上がった数を返す', () => {
    expect(rankChangeOf(league)).toEqual({ kind: 'up', diff: 3 });
    expect(rankChangeOf({ ...league, myRankYesterday: 7 }).kind).toBe('same');
    expect(rankChangeOf({ ...league, myRankYesterday: undefined }).kind).toBe('none');
  });

  it('ゲージはすぐ上のライバルの数に対する割合。1位なら100', () => {
    expect(gaugePercentOf(league)).toBe(71);
    expect(gaugePercentOf({ ...league, rivalAbove: undefined })).toBe(100);
  });

  it('すぐ上は「ねらい目」、すぐ下は「追ってくる」', () => {
    expect(rivalMarkOf(entry(6, 'リク'), league)).toBe('target');
    expect(rivalMarkOf(entry(9, 'チヒロ'), league)).toBe('chaser');
    expect(rivalMarkOf(entry(1, 'A'), league)).toBeUndefined();
  });

  it('すぐ下との差が1なら「迫っています」', () => {
    expect(chaserTextOf(league)).toBe('チヒロが1回差まで迫っています');
    expect(chaserTextOf({ ...league, rivalBelow: { name: 'チヒロ', rank: 8, count: 5, gap: 0 } })).toContain('同点');
  });
});
