import { describe, expect, it } from 'vitest';
import { avoidShortTail, longestPhrase, partNamePhrases, splitPhrases } from '@/presentation/screens/Avatar/phraseBreak';

describe('avoidShortTail', () => {
  it('短い最後のまとまりは、手前の区切りで折る', () => {
    expect(avoidShortTail(['扇町の', 'おさんぽ', '好き'])).toEqual(['扇町の', 'おさんぽ好き']);
    expect(avoidShortTail(['まち', '歩き', '見習い'])).toEqual(['まち', '歩き見習い']);
  });

  it('手前に区切りが無ければ、前の方の語の切れ目で折る', () => {
    expect(avoidShortTail(splitPhrases('金魚すくいの金魚'))).toEqual(['金魚', 'すくいの金魚']);
    expect(avoidShortTail(splitPhrases('天満切子のグラス'))).toEqual(['天満', '切子のグラス']);
  });

  it('折れる所が無い名前・最後が長い名前はそのまま', () => {
    expect(avoidShortTail(['ふわふわ', 'パーマ'])).toEqual(['ふわふわ', 'パーマ']);
    expect(avoidShortTail(splitPhrases('天神さんの常連王'))).toEqual(['天神さんの', '常連王']);
    expect(avoidShortTail(['雪の', 'イルミネーション'])).toEqual(['雪の', 'イルミネーション']);
    expect(avoidShortTail(['手ぬぐい'])).toEqual(['手ぬぐい']);
  });

  it('いちばん長いまとまりの文字数を返す', () => {
    expect(longestPhrase('雪のイルミネーション')).toBe(8);
    expect(longestPhrase('ショート')).toBe(4);
  });
});

describe('partNamePhrases', () => {
  it('区切りが1つだけの短い名前は、一続きの言葉を割らずにその区切りのまま', () => {
    expect(partNamePhrases('金魚すくいの金魚')).toEqual(['金魚すくいの', '金魚']);
    expect(partNamePhrases('天満切子のグラス')).toEqual(['天満切子の', 'グラス']);
    expect(partNamePhrases('ふわふわパーマ')).toEqual(['ふわふわ', 'パーマ']);
  });

  it('それ以外は avoidShortTail と同じ', () => {
    expect(partNamePhrases('雪のイルミネーション')).toEqual(['雪の', 'イルミネーション']);
    expect(partNamePhrases('扇町のおさんぽ好き')).toEqual(['扇町の', 'おさんぽ好き']);
    expect(partNamePhrases('手ぬぐい')).toEqual(['手ぬぐい']);
  });
});

describe('splitPhrases', () => {
  it('文字の種類の変わり目で分ける（漢字→ひらがなでは切らない）', () => {
    expect(splitPhrases('ふわふわパーマ')).toEqual(['ふわふわ', 'パーマ']);
    expect(splitPhrases('もこもこアフロ')).toEqual(['もこもこ', 'アフロ']);
    expect(splitPhrases('まち歩き見習い')).toEqual(['まち', '歩き', '見習い']);
    expect(splitPhrases('手ぬぐい')).toEqual(['手ぬぐい']);
  });

  it('名詞に付いた「の」の後ろで分ける', () => {
    expect(splitPhrases('天満の食いしんぼう')).toEqual(['天満の', '食いしんぼう']);
    expect(splitPhrases('扇町のおさんぽ好き')).toEqual(['扇町の', 'おさんぽ', '好き']);
    expect(splitPhrases('雪のイルミネーション')).toEqual(['雪の', 'イルミネーション']);
  });

  it('1文字だけのまとまりは隣に付ける', () => {
    expect(splitPhrases('通いなれた人')).toEqual(['通いなれた人']);
    expect(splitPhrases('天六のご近所さん')).toEqual(['天六の', 'ご近所さん']);
    expect(splitPhrases('まちクエ王')).toEqual(['まち', 'クエ王']);
    expect(splitPhrases('お月見うさぎ')).toEqual(['お月見うさぎ']);
    expect(splitPhrases('今昔館の江戸の町')).toEqual(['今昔館の', '江戸の町']);
    expect(splitPhrases('桜の木')).toEqual(['桜の木']);
  });

  it('長いカタカナは単語で分け、つなげると元に戻る', () => {
    expect(splitPhrases('テーラードジャケット').join('')).toBe('テーラードジャケット');
    expect(splitPhrases('テーラードジャケット').every((p) => [...p].length >= 2)).toBe(true);
    expect(splitPhrases('ポニーテール')).toEqual(['ポニーテール']);
  });

  it('空白や記号はそのまま残す', () => {
    expect(splitPhrases('うどん こしまる')).toEqual(['うどん こしまる']);
    expect(splitPhrases('')).toEqual(['']);
  });
});
