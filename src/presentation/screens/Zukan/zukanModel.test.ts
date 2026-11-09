import { describe, expect, it } from 'vitest';
import type { ZukanDistrictDto, ZukanTileDto } from '@/application/dto/Dto';
import {
  familiarityStars,
  groupTiles,
  levelDescription,
  seasonMarks,
  shortLastVisit,
  tileAriaLabel,
  tileCaption,
  tileName,
} from '@/presentation/screens/Zukan/zukanModel';

const visited: ZukanTileDto = {
  id: 'l_jo01', name: 'N西城跡', kind: 'landmark', category: '城跡', status: 'visited', visitCount: 3,
  familiarity: 2, familiarityLabel: 'なじみ', nextFamiliarityText: 'あと2回で常連', seasons: ['autumn', 'winter'], visitedToday: false,
};
const regular: ZukanTileDto = { ...visited, visitCount: 6, familiarity: 3, familiarityLabel: '常連', nextFamiliarityText: undefined };
const discovered: ZukanTileDto = { id: 's_jo02', name: '丸岡和菓子店', kind: 'shop', category: '和菓子', status: 'discovered', visitCount: 0 };
const unknown: ZukanTileDto = { kind: 'shop', status: 'unknown', visitCount: 0 };

/** 見出しのテスト用地区 */
function district(over: Partial<ZukanDistrictDto> = {}): ZukanDistrictDto {
  return {
    id: 'd_joka', name: '城下地区', theme: '歴史', color: '#7a5ea8', level: 2, visitCount: 12,
    lastVisitLabel: '2026/11/02（月）', fade: { kind: 'fresh' }, nextGoalText: 'あと1回で銀カード', ...over,
  };
}

describe('zukanModel', () => {
  it('タイルの名前・補足は状態ごとに変わり、未発見は名前も種別も伏せる', () => {
    expect([tileName(visited), tileCaption(visited)]).toEqual(['N西城跡', 'あと2回で常連']);
    expect(tileCaption(regular)).toBe('常連になりました');
    expect([tileName(discovered), tileCaption(discovered)]).toEqual(['丸岡和菓子店', 'まだ行っていない']);
    expect([tileName(unknown), tileCaption(unknown)]).toEqual(['？？？', '未発見']);
    expect(tileAriaLabel(unknown)).not.toContain('店舗');
  });

  it('なじみ度の星は訪問済みだけに出る', () => {
    expect(familiarityStars(visited)).toBe('★★☆');
    expect(familiarityStars(regular)).toBe('★★★');
    expect(familiarityStars(discovered)).toBe('');
  });

  it('季節の印は春→冬の4つで、訪れた季節だけ visited', () => {
    expect(seasonMarks(visited)).toEqual([
      { label: '春', visited: false }, { label: '夏', visited: false }, { label: '秋', visited: true }, { label: '冬', visited: true },
    ]);
  });

  it('読み上げ名は色に頼らず、なじみ度・回数・季節を言葉で伝える', () => {
    expect(tileAriaLabel(visited)).toBe('N西城跡（名所）なじみ、通った 3回、訪れた季節 秋・冬、あと2回で常連');
    expect(tileAriaLabel(discovered)).toBe('丸岡和菓子店（店舗）発見済み、まだ行っていない');
  });

  it('見出しの日付は年を省き、未訪問は「—」。成長段階の説明を返す', () => {
    expect(shortLastVisit(district())).toBe('11/02（月）');
    expect(shortLastVisit(district({ lastVisitLabel: undefined }))).toBe('—');
    expect(levelDescription(2)).toBe('建物が増える');
  });

  it('タイルは名所→店舗の区分に分け、空の区分は出さない', () => {
    expect(groupTiles([discovered, visited, unknown]).map((g) => [g.title, g.tiles.length])).toEqual([['名所', 1], ['店舗', 2]]);
    expect(groupTiles([discovered]).map((g) => g.title)).toEqual(['店舗']);
  });
});
