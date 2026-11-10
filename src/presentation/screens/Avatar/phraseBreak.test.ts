import { describe, expect, it } from 'vitest';
import { splitPhrases } from '@/presentation/screens/Avatar/phraseBreak';

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
