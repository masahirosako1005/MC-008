/**
 * @file 地図下シートの表示用純粋関数の単体テスト（presentation/screens/Map/Sheet 層）
 */
import { describe, expect, it } from 'vitest';
import type { NearbySpotDto, RevisitReasonDto } from '@/application/dto/Dto';
import {
  districtSubText,
  lordLabelOf,
  nearbySubtitle,
  nearestSpot,
  nearestSpotLines,
  reasonTarget,
  sortReasons,
  spotDisplayName,
  strongestReason,
} from '@/presentation/screens/Map/Sheet/sheetModel';

/** 再訪理由を作る */
function reason(kind: RevisitReasonDto['kind'], extra: Partial<RevisitReasonDto> = {}): RevisitReasonDto {
  return { kind, title: kind, subtitle: '', districtId: 'd_joka', ...extra };
}

/** 近隣スポットを作る */
function spot(extra: Partial<NearbySpotDto>): NearbySpotDto {
  return { id: 's_jo01', name: '城下カフェ', kind: 'shop', districtId: 'd_joka', districtName: '城下地区', meters: 50, status: 'discovered', visitCount: 0, canVisit: false, hasActiveShopEvent: false, ...extra };
}

describe('再訪理由の並びとタップ先', () => {
  it('期限＞取り返し＞色あせ＞未訪問＞新着 の順に並べ、同じ種別は元の順を保つ', () => {
    const sorted = sortReasons([reason('new'), reason('fade', { title: 'a' }), reason('deadline'), reason('fade', { title: 'b' }), reason('reclaim'), reason('unvisited')]);
    expect(sorted.map((r) => `${r.kind}${r.kind === 'fade' ? r.title : ''}`)).toEqual(['deadline', 'reclaim', 'fadea', 'fadeb', 'unvisited', 'new']);
  });
  it('いちばん強い理由は優先順の先頭（無ければ undefined）', () => {
    expect(strongestReason([reason('fade'), reason('reclaim')])?.kind).toBe('reclaim');
    expect(strongestReason([])).toBeUndefined();
  });
  it('期限・未訪問でスポットが分かればスポット、それ以外は地区へ', () => {
    expect(reasonTarget(reason('deadline', { spotId: 's_jo01' }))).toEqual({ kind: 'spot', id: 's_jo01' });
    expect(reasonTarget(reason('unvisited', { spotId: 's_jo02' }))).toEqual({ kind: 'spot', id: 's_jo02' });
    expect(reasonTarget(reason('unvisited'))).toEqual({ kind: 'district', id: 'd_joka' });
    expect(reasonTarget(reason('reclaim', { districtId: 'd_honmachi', spotId: 's_hm01' }))).toEqual({ kind: 'district', id: 'd_honmachi' });
  });
});

describe('近隣スポットの表示', () => {
  it('いちばん近いスポットを選ぶ', () => {
    expect(nearestSpot([spot({ id: 'a', meters: 90 }), spot({ id: 'b', meters: 20 }), spot({ id: 'c', meters: 20 })])?.id).toBe('b');
    expect(nearestSpot([])).toBeUndefined();
  });
  it('未発見のスポットは名前を出さない', () => {
    expect(spotDisplayName({ status: 'unknown', name: '秘密の店' })).toBe('？？？');
    expect(nearestSpotLines(spot({ status: 'unknown', name: undefined, meters: 97 }))).toEqual({ title: '近くに未発見のスポット', sub: 'あと17mで発見 ・ 城下地区' });
    expect(nearestSpotLines(spot({ status: 'unknown', name: undefined, meters: 62 })).title).not.toContain('秘密');
  });
  it('補足は訪問回数とクーポンの有無（未発見はクーポンを出さない）', () => {
    expect(nearbySubtitle(spot({ status: 'visited', visitCount: 2, hasActiveShopEvent: true }))).toBe('訪問2回 ・ クーポン・イベントあり');
    expect(nearbySubtitle(spot({ status: 'discovered' }))).toBe('まだ行っていない');
    expect(nearbySubtitle(spot({ status: 'unknown', hasActiveShopEvent: true }))).toBe('未発見');
  });
});

describe('地区カードの文言', () => {
  it('主は自分なら「あなた」、いなければ出さない', () => {
    expect(lordLabelOf({ isLordMe: true, lordName: '旅人' })).toBe('領主：あなた');
    expect(lordLabelOf({ isLordMe: false, lordName: 'おまいり番長' })).toBe('領主：おまいり番長');
    expect(lordLabelOf({ isLordMe: false })).toBeUndefined();
  });
  it('2行目は最終訪問と次の目標（達成率は出さない）', () => {
    expect(districtSubText({ fade: { kind: 'soon', daysSinceVisit: 25, daysUntilFade: 5 }, nextGoalText: '次の目標：あと1回で銀カード' })).toBe(
      '最終訪問 25日前 ・ 次の目標：あと1回で銀カード',
    );
    expect(districtSubText({ fade: { kind: 'never' }, nextGoalText: '' })).toBe('まだ訪れていない');
  });
});
