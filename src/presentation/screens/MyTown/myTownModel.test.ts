import { describe, expect, it } from 'vitest';
import type { DistrictCardDto, FadeDto, MyTownDto } from '@/application/dto/Dto';
import { FADE_START_DAYS, MAX_BUILDINGS } from '@/domain/town/constants';
import {
  avatarLookOf,
  builtSlotsOf,
  centerDistrictIndexOf,
  clampScrollX,
  fadeFilterOf,
  fadeMeterOf,
  headlineOf,
  memoriesOf,
  rewardGoalsOf,
  heldOf,
  initialDistrictIndexOf,
  lordTextOf,
  profileStatsOf,
  rankProgressOf,
  SCENE_SLOT_COUNT,
  sceneKindOf,
  scrollXForDistrict,
  stageTextOf,
} from '@/presentation/screens/MyTown/myTownModel';

/** テスト用の地区カード */
function card(id: string, over: Partial<DistrictCardDto> = {}): DistrictCardDto {
  return {
    id,
    name: `${id}地区`,
    shortName: id,
    color: '#7a5ea8',
    level: 1,
    score: 1,
    buildings: 1,
    visitCount: 1,
    fade: { kind: 'fresh', daysSinceVisit: 3 },
    isLordMe: false,
    lordLost: false,
    nextGoalText: '次の目標',
    ...over,
  };
}

describe('sceneKindOf', () => {
  it('今のマスタ（実在の5地区）のテーマから街並みの絵を選ぶ', () => {
    expect(sceneKindOf('門前町')).toBe('shrine');
    expect(sceneKindOf('市場と食')).toBe('market');
    expect(sceneKindOf('暮らし')).toBe('plain');
    expect(sceneKindOf('公園と路地')).toBe('park');
    expect(sceneKindOf('川辺と桜')).toBe('riverside');
  });
  it('旧マスタのテーマからも街並みの絵を選ぶ', () => {
    expect(sceneKindOf('歴史')).toBe('castle');
    expect(sceneKindOf('港')).toBe('harbor');
    expect(sceneKindOf('商店街')).toBe('arcade');
    expect(sceneKindOf('里山')).toBe('satoyama');
    expect(sceneKindOf('温泉')).toBe('onsen');
  });
  it('知らないテーマは駅前風の絵にする', () => {
    expect(sceneKindOf('未知')).toBe('plain');
  });
});

describe('builtSlotsOf', () => {
  it('建物が無ければ何も描かない', () => {
    expect(builtSlotsOf(0)).toBe(0);
  });
  it('1軒でも建っていれば最低1つは描く', () => {
    expect(builtSlotsOf(1)).toBe(1);
  });
  it('最大まで建てば絵の置き場所がすべて埋まり、それ以上は増えない', () => {
    expect(builtSlotsOf(MAX_BUILDINGS)).toBe(SCENE_SLOT_COUNT);
    expect(builtSlotsOf(MAX_BUILDINGS * 3)).toBe(SCENE_SLOT_COUNT);
  });
  it('建物が増えるほど描く数は減らない（単調増加）', () => {
    let prev = 0;
    for (let b = 0; b <= MAX_BUILDINGS; b++) {
      const now = builtSlotsOf(b);
      expect(now).toBeGreaterThanOrEqual(prev);
      prev = now;
    }
  });
});

describe('fadeFilterOf', () => {
  it('色あせていない地区はそのまま描く', () => {
    expect(fadeFilterOf({ kind: 'fresh', daysSinceVisit: 1 })).toBe('none');
  });
  it('未訪問の地区は無彩色にする', () => {
    expect(fadeFilterOf({ kind: 'never' })).toBe('saturate(0)');
  });
  it('色あせが進むほど彩度を下げる', () => {
    expect(fadeFilterOf({ kind: 'fading', progress: 0 })).toContain('saturate(1.00)');
    expect(fadeFilterOf({ kind: 'fading', progress: 1 })).toContain('saturate(0.10)');
  });
});

describe('fadeMeterOf', () => {
  it('色あせ前は、色あせ開始までの残り日数を出す', () => {
    const meter = fadeMeterOf({ kind: 'fresh', daysSinceVisit: 10 });
    expect(meter.value).toBe(`あと${FADE_START_DAYS - 10}日`);
    expect(meter.isWarn).toBe(false);
  });
  it('色あせ間近は注意色にする', () => {
    const fade: FadeDto = { kind: 'soon', daysSinceVisit: 25, daysUntilFade: 5 };
    expect(fadeMeterOf(fade)).toMatchObject({ value: 'あと5日', isWarn: true });
  });
  it('色あせ中でも「成長はそのまま」と伝える（罰にしない）', () => {
    expect(fadeMeterOf({ kind: 'fading', progress: 0.5 }).label).toContain('成長はそのまま');
  });
});

describe('stageTextOf / lordTextOf', () => {
  it('取り返し中は色あせより優先して注意を出す', () => {
    expect(stageTextOf(card('a', { lordLost: true, fade: { kind: 'soon', daysUntilFade: 3 } }))).toEqual({ text: '取り返し中', isWarn: true });
  });
  it('自分が主なら「あなたが主」', () => {
    expect(lordTextOf(card('a', { isLordMe: true }))).toBe('あなたが主');
  });
  it('主がいなければ表示しない', () => {
    expect(lordTextOf(card('a'))).toBeUndefined();
  });
});

describe('initialDistrictIndexOf', () => {
  const cards = [card('a', { fade: { kind: 'fresh', daysSinceVisit: 9 } }), card('b', { fade: { kind: 'fresh', daysSinceVisit: 2 } }), card('c', { fade: { kind: 'never' } })];
  it('おすすめの地区があればそこを最初に見せる', () => {
    expect(initialDistrictIndexOf(cards, { kind: 'unvisited', title: 't', subtitle: 's', districtId: 'c' })).toBe(2);
  });
  it('おすすめが無ければ最後に訪れた地区を見せる', () => {
    expect(initialDistrictIndexOf(cards, undefined)).toBe(1);
  });
});

describe('profileStatsOf / avatarLookOf', () => {
  it('通った回数の合計と主の地区数を数える', () => {
    const stats = profileStatsOf([card('a', { visitCount: 4, isLordMe: true }), card('b', { visitCount: 0, fade: { kind: 'never' } })]);
    expect(stats).toEqual({ totalVisits: 4, lordCount: 1, visitedDistricts: 1 });
  });
  it('主の地区があれば冠をかぶる', () => {
    expect(avatarLookOf({ totalVisits: 3, lordCount: 1 }).hat).toBe('crown');
  });
  it('まだ一度も通っていなければ帽子なし', () => {
    expect(avatarLookOf({ totalVisits: 0, lordCount: 0 }).hat).toBeUndefined();
  });
});

describe('スクロール位置の計算', () => {
  it('地区を中央に置く位置を求め、範囲内に収める', () => {
    expect(scrollXForDistrict(0, 360, 200)).toBe(-80);
    expect(clampScrollX(-80, 360, 1000)).toBe(0);
    expect(clampScrollX(5000, 360, 1000)).toBe(640);
  });
  it('表示の中央にある地区を返す', () => {
    expect(centerDistrictIndexOf(0, 360, 200, 5)).toBe(0);
    expect(centerDistrictIndexOf(640, 360, 200, 5)).toBe(4);
  });
});

describe('heldOf / rankProgressOf', () => {
  it('手に入れたアイテムを手に持つものにし、無い・知らない ID はカメラ', () => {
    expect(heldOf('i_chochin')).toBe('chochin');
    expect(heldOf('i_nobori')).toBe('nobori');
    expect(heldOf('i_matsu')).toBe('matsu');
    expect(heldOf(undefined)).toBe('camera');
    expect(heldOf('i_unknown')).toBe('camera');
  });
  it('着せ替えの選択がアバターの見た目に反映される', () => {
    expect(avatarLookOf({ totalVisits: 3, lordCount: 0 }, 'i_matsu').held).toBe('matsu');
  });
  it('次のランクまでの割合（最上位は 1）', () => {
    expect(rankProgressOf({ nextAt: 50, remaining: 50 })).toBe(0);
    expect(rankProgressOf({ nextAt: 50, remaining: 10 })).toBeCloseTo(0.8);
    expect(rankProgressOf({})).toBe(1);
  });
});

describe('headlineOf（街のひと言）', () => {
  it('取り返しがあれば最優先で知らせる', () => {
    const h = headlineOf([card('a', { fade: { kind: 'soon', daysUntilFade: 2 } }), card('b', { lordLost: true })]);
    expect(h).toMatchObject({ districtId: 'b', isUrgent: true });
  });
  it('色あせ間近は残り日数の少ない地区を出す', () => {
    const h = headlineOf([card('a', { fade: { kind: 'soon', daysUntilFade: 5 } }), card('b', { fade: { kind: 'soon', daysUntilFade: 2 } })]);
    expect(h.districtId).toBe('b');
    expect(h.text).toContain('あと2日');
  });
  it('色あせ中は罰ではなく「待っています」と伝える', () => {
    expect(headlineOf([card('a', { fade: { kind: 'fading', progress: 0.5 } })]).text).toContain('待っています');
  });
  it('どこも元気なら、いちばん通った地区をほめる', () => {
    const h = headlineOf([card('a', { visitCount: 2 }), card('b', { visitCount: 9 })]);
    expect(h).toMatchObject({ districtId: 'b', isUrgent: false });
  });
});

describe('rewardGoalsOf / memoriesOf', () => {
  /** テスト用のマイ街 */
  const dto: MyTownDto = {
    nickname: 'たびと', rank: { name: '常連', nextAt: 400, remaining: 100 }, points: 300, totalVisits: 12,
    districts: [card('a')],
    cards: [{ districtId: 'a', districtName: 'A地区', rank: 'silver', earnedOn: '2026/10/01（木）' }],
    nextCards: [{ districtId: 'a', districtName: 'A地区', rank: 'gold', remainingVisits: 1 }, { districtId: 'b', districtName: 'B地区', rank: 'silver', remainingVisits: 2 }, { districtId: 'c', districtName: 'C地区', rank: 'silver', remainingVisits: 3 }],
    items: [{ itemId: 'i_matsu', name: '松', earnedOn: '2026/10/20（火）', isHeld: false }],
    lockedItems: [{ itemId: 'i_nobori', name: 'のぼり', hint: 'ちがうお店を3軒訪れる' }],
  };
  it('近いカード2枚 → ランク → 未入手のアイテムの順に並べ、進み具合を出す', () => {
    const goals = rewardGoalsOf(dto);
    expect(goals.map((g) => g.kind)).toEqual(['card', 'card', 'rank', 'item']);
    expect(goals[0]).toMatchObject({ tone: 'gold', remainText: 'あと1回', districtId: 'a' });
    expect(goals[0]?.progress).toBeCloseTo(0.9);
    expect(goals[2]?.progress).toBeCloseTo(0.75);
    expect(goals[3]?.progress).toBeUndefined();
  });
  it('思い出は新しい順', () => {
    expect(memoriesOf(dto).map((m) => m.kind)).toEqual(['item', 'silver']);
  });
});
