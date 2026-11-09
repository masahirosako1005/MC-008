import { describe, expect, it } from 'vitest';
import type { ZukanTileDto } from '@/application/dto/Dto';
import {
  familiarityStars,
  filterTiles,
  groupTiles,
  seasonMarks,
  tileAriaLabel,
  tileCaption,
  tileName,
  validDistrictFilter,
} from '@/presentation/screens/Zukan/zukanModel';

const visited: ZukanTileDto = {
  id: 'l_jo01', name: 'N西城跡', kind: 'landmark', districtId: 'd_joka', category: '城跡', status: 'visited', visitCount: 3,
  familiarity: 2, familiarityLabel: 'なじみ', nextFamiliarityText: 'あと2回で常連', seasons: ['autumn', 'winter'], visitedToday: false,
};
const regular: ZukanTileDto = { ...visited, visitCount: 6, familiarity: 3, familiarityLabel: '常連', nextFamiliarityText: undefined };
const discovered: ZukanTileDto = { id: 's_jo02', name: '丸岡和菓子店', kind: 'shop', districtId: 'd_joka', category: '和菓子', status: 'discovered', visitCount: 0 };
const unknown: ZukanTileDto = { id: 's_mi01', name: '港の食堂', kind: 'shop', districtId: 'd_minato', category: '食堂', status: 'unknown', visitCount: 0 };

describe('zukanModel', () => {
  it('タイルの名前・補足は状態ごとに変わり、未発見も名前を出す（名前が無いときだけ「？？？」）', () => {
    expect([tileName(visited), tileCaption(visited)]).toEqual(['N西城跡', 'あと2回で常連']);
    expect(tileCaption(regular)).toBe('常連になりました');
    expect([tileName(discovered), tileCaption(discovered)]).toEqual(['丸岡和菓子店', 'まだ行っていない']);
    expect([tileName(unknown), tileCaption(unknown)]).toEqual(['港の食堂', '未発見']);
    expect(tileName({ kind: 'shop', districtId: 'd_minato', status: 'unknown', visitCount: 0 })).toBe('？？？');
    expect(tileAriaLabel(unknown)).toBe('港の食堂（店舗）未発見。80m以内に近づくと見つかります');
  });

  it('地区と状態で絞り込める（順番は保つ）', () => {
    const tiles = [visited, discovered, unknown];
    expect(filterTiles(tiles, { status: 'all' })).toEqual(tiles);
    expect(filterTiles(tiles, { districtId: 'd_joka', status: 'all' })).toEqual([visited, discovered]);
    expect(filterTiles(tiles, { status: 'unknown' })).toEqual([unknown]);
    expect(filterTiles(tiles, { districtId: 'd_joka', status: 'unknown' })).toEqual([]);
  });

  it('地区の絞り込みは一覧にある地区だけ（無い地区はすべての地区に戻す）', () => {
    expect(validDistrictFilter('d_joka', ['d_joka', 'd_minato'])).toBe('d_joka');
    expect(validDistrictFilter('d_nowhere', ['d_joka'])).toBeUndefined();
    expect(validDistrictFilter(undefined, ['d_joka'])).toBeUndefined();
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

  it('タイルは名所→店舗の区分に分け、空の区分は出さない', () => {
    expect(groupTiles([discovered, visited, unknown]).map((g) => [g.title, g.tiles.length])).toEqual([['名所', 1], ['店舗', 2]]);
    expect(groupTiles([discovered]).map((g) => g.title)).toEqual(['店舗']);
  });
});
