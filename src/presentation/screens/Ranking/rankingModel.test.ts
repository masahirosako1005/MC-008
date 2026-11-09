import { describe, expect, it } from 'vitest';
import type { KeepRewardDto, LeagueDto, RankingEntryDto, RankingLordDto } from '@/application/dto/Dto';
import {
  chaserTextOf,
  districtShortOf,
  focusKeepOf,
  hotLabelOf,
  keepGoalTextOf,
  keepChipOf,
  myEmoteOf,
  podiumEmoteOf,
  raceLabelOf,
  gaugePercentOf,
  keepPercentOf,
  keepTextOf,
  listEntriesOf,
  lordStatusOf,
  lordGoalText,
  metricShortOf,
  myRewardTierOf,
  podiumSlotsOf,
  prizeNamesOf,
  rankChangeOf,
  rivalMarkOf,
  tierPrizeTextOf,
} from '@/presentation/screens/Ranking/rankingModel';

/** テスト用の行 */
function entry(rank: number, name: string, isMe = false): RankingEntryDto {
  return { rank, name, isMe, count: 10 - rank, lordOf: [], avatarKey: name };
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
    const base: RankingLordDto = { districtId: 'd_honmachi', districtName: '本町地区', lordName: 'おまいり番長', isMe: false, lost: true, lordCount: 12, myCount: 9, needed: 4 };
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

describe('rankingModel 報酬', () => {
  /**
   * テスト用のキープ報酬を作る。
   * @param over 上書き
   * @returns キープ報酬
   */
  function keep(over: Partial<KeepRewardDto> = {}): KeepRewardDto {
    return { id: 'podium', goalLabel: '表彰台（3位以内）', hours: 24, prize: { kind: 'flag', name: '表彰台の旗' }, state: 'not-yet', heldHours: 0, remainingHours: 24, ...over };
  }

  /**
   * テスト用のリーグを作る。
   * @param over 上書き
   * @returns リーグ
   */
  function league(over: Partial<LeagueDto> = {}): LeagueDto {
    return {
      id: 'kayoi', name: 'かよいリーグ', shortName: 'かよい', icon: '♛', tagline: '', rule: '今月通った回数で順位を決めます', unit: '回', joined: true,
      metric: '今月 通った回数（同じ場所も毎回数える）', entries: [], myRank: 5, myCount: 4, nextStepText: '',
      rewards: {
        tiers: [
          { label: '1位', prizes: [{ kind: 'gold', name: '金メダル' }, { kind: 'item', name: '金の提灯' }], isMine: false },
          { label: '4位〜', condition: '今月1回以上', prizes: [{ kind: 'stamp', name: '参加スタンプ' }], isMine: true },
        ],
        keeps: [keep(), keep({ id: 'top', goalLabel: '1位', hours: 72, prize: { kind: 'trophy', name: 'トロフィー' }, remainingHours: 72 })],
      },
      ...over,
    };
  }

  it('競うものは「今月」と（）の補足を外した短い言い方。無ければ順位の決め方', () => {
    expect(metricShortOf(league())).toBe('通った回数');
    expect(metricShortOf(league({ metric: undefined }))).toBe('今月通った回数で順位を決めます');
  });

  it('いまの順位でもらえる段と、景品の名前のつなぎ方', () => {
    expect(myRewardTierOf(league())?.label).toBe('4位〜');
    expect(myRewardTierOf(league({ rewards: undefined }))).toBeUndefined();
    expect(prizeNamesOf([{ kind: 'bronze', name: '銅メダル' }, { kind: 'item', name: '銅の提灯' }])).toBe('銅メダル・銅の提灯');
  });

  it('キープ報酬の文言は「○時間キープすると」→「キープ中！あと○時間」→「獲得しました」', () => {
    expect(keepTextOf(keep())).toBe('表彰台（3位以内）を24時間キープすると「表彰台の旗」がもらえます');
    expect(keepTextOf(keep({ state: 'keeping', heldHours: 18, remainingHours: 6 }))).toBe('表彰台（3位以内）をキープ中！ あと6時間で「表彰台の旗」');
    expect(keepTextOf(keep({ state: 'achieved', heldHours: 24, remainingHours: 0 }))).toContain('を獲得しました');
  });

  it('キープの進み具合は 0〜100（まだは 0、獲得済みは 100）', () => {
    expect(keepPercentOf(keep())).toBe(0);
    expect(keepPercentOf(keep({ state: 'keeping', heldHours: 12, remainingHours: 12 }))).toBe(50);
    expect(keepPercentOf(keep({ state: 'achieved', heldHours: 24, remainingHours: 0 }))).toBe(100);
  });

  it('バトルカードには獲得に一番近いキープ中の報酬、無ければ次にねらえる報酬を出す（不参加は出さない）', () => {
    const keeping = league({
      rewards: { tiers: [], keeps: [keep({ state: 'achieved' }), keep({ id: 'top', state: 'keeping', heldHours: 10, remainingHours: 62 })] },
    });
    expect(focusKeepOf(keeping)?.id).toBe('top');
    expect(focusKeepOf(league())?.id).toBe('podium');
    expect(focusKeepOf(league({ myRank: undefined }))).toBeUndefined();
  });
});

describe('rankingModel 上部のステージ（エモートと短い札）', () => {
  const base: LeagueDto = {
    id: 'kayoi', name: 'かよいリーグ', shortName: 'かよい', icon: '♛', tagline: '', rule: '', unit: '回', joined: true,
    entries: [entry(1, 'A'), entry(6, 'リク'), entry(7, 'あなた', true), entry(9, 'チヒロ')],
    myRank: 7, myCount: 5, nextStepText: '', myRankYesterday: 7,
    rivalAbove: { name: 'リク', rank: 6, count: 7, gap: 2 }, rivalBelow: { name: 'チヒロ', rank: 9, count: 4, gap: 3 },
  };

  it('あなたのエモートは 順位アップ→キラキラ／後ろが1差以内→汗／1位→♪／ほか→闘志／不参加→ハート', () => {
    expect(myEmoteOf({ ...base, myRankYesterday: 9 })).toBe('sparkle');
    expect(myEmoteOf({ ...base, rivalBelow: { name: 'チヒロ', rank: 8, count: 4, gap: 1 } })).toBe('sweat');
    expect(myEmoteOf({ ...base, myRank: 1, myRankYesterday: 1, rivalAbove: undefined })).toBe('note');
    expect(myEmoteOf(base)).toBe('fire');
    expect(myEmoteOf({ ...base, myRank: undefined })).toBe('heart');
  });

  it('表彰台の人は すぐ上→「！」／すぐ後ろ→闘志／1位→♪／ほか→キラキラ', () => {
    expect(podiumEmoteOf(entry(6, 'リク'), base)).toBe('exclaim');
    expect(podiumEmoteOf(entry(9, 'チヒロ'), base)).toBe('fire');
    expect(podiumEmoteOf(entry(1, 'A'), base)).toBe('note');
    expect(podiumEmoteOf(entry(2, 'B'), base)).toBe('sparkle');
  });

  it('レースの一言・迫られ札・キープ札', () => {
    expect(raceLabelOf(base)).toBe('あと2回で6位');
    expect(raceLabelOf({ ...base, rivalAbove: undefined })).toBe('独走中！');
    expect(raceLabelOf({ ...base, myRank: undefined })).toBe('見学中');
    expect(hotLabelOf(base)).toBeUndefined();
    expect(hotLabelOf({ ...base, rivalBelow: { name: 'チヒロ', rank: 7, count: 5, gap: 0 } })).toBe('同点！');
    expect(hotLabelOf({ ...base, rivalBelow: { name: 'チヒロ', rank: 8, count: 4, gap: 1 } })).toBe('1回差！');
    const keeping: KeepRewardDto = { id: 'podium', goalLabel: '表彰台（3位以内）', hours: 24, prize: { kind: 'flag', name: '表彰台の旗' }, state: 'keeping', heldHours: 18, remainingHours: 6 };
    expect(keepChipOf({ ...base, rewards: { tiers: [], keeps: [keeping] } })).toBe('キープ あと6時間');
    expect(keepChipOf(base)).toBeUndefined();
  });
});

describe('rankingModel 下の段の短い表示（報酬・地区の主）', () => {
  it('順位報酬の段はメダルを名前から外す（メダルしか無ければメダル名）', () => {
    expect(tierPrizeTextOf({ label: '1位', isMine: false, prizes: [{ kind: 'gold', name: '金メダル' }, { kind: 'title', name: '称号「11月の常連王」' }, { kind: 'item', name: '金の提灯' }] })).toBe('称号「11月の常連王」・金の提灯');
    expect(tierPrizeTextOf({ label: '2位', isMine: false, prizes: [{ kind: 'silver', name: '銀メダル' }] })).toBe('銀メダル');
  });

  it('キープ報酬の条件は（）の補足を外して「○を○時間キープ」', () => {
    const keep: KeepRewardDto = { id: 'podium', goalLabel: '表彰台（3位以内）', hours: 24, prize: { kind: 'flag', name: '表彰台の旗' }, state: 'not-yet', heldHours: 0, remainingHours: 24 };
    expect(keepGoalTextOf(keep)).toBe('表彰台を24時間キープ');
    expect(keepGoalTextOf({ ...keep, id: 'top', goalLabel: '1位', hours: 72 })).toBe('1位を72時間キープ');
  });

  it('地区の主タイルの札と短い地区名', () => {
    const lord: RankingLordDto = { districtId: 'd_a', districtName: '南森町・天満宮地区', lordName: 'おまいり番長', isMe: false, lost: false, lordCount: 7, myCount: 6, needed: 2 };
    expect(lordStatusOf(lord)).toEqual({ text: 'あと2回', tone: 'chase' });
    expect(lordStatusOf({ ...lord, lost: true }).tone).toBe('lost');
    expect(lordStatusOf({ ...lord, lordName: undefined }).tone).toBe('open');
    expect(lordStatusOf({ ...lord, isMe: true })).toEqual({ text: 'あなた', tone: 'me' });
    expect(districtShortOf(lord)).toBe('南森町');
    expect(districtShortOf({ ...lord, districtShortName: '天満' })).toBe('天満');
  });
});
