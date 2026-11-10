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
  reasonCardText,
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

describe('クエストのカードの題と補足', () => {
  it('期限は題＝お店の名前、補足＝残り日数と特典', () => {
    expect(reasonCardText(reason('deadline', { title: '福まるどら焼き本舗のクーポン、あと2日', subtitle: 'どら焼き1個サービス' }))).toEqual({
      title: '福まるどら焼き本舗',
      subtitle: 'あと2日 ・ どら焼き1個サービス',
    });
  });
  it('色あせ・未達成は題＝地区の名前。「訪問」の語は出さない', () => {
    expect(reasonCardText(reason('fade', { title: 'そろそろ色あせ：大川沿い地区 あと5日', subtitle: '最終訪問 25日前' }))).toEqual({ title: '大川沿い地区', subtitle: 'あと5日 ・ 25日前' });
    expect(reasonCardText(reason('fade', { title: '色あせ中：扇町・中崎町地区', subtitle: '最終訪問 45日前・再訪で復活＋おかえりボーナス' }))).toEqual({
      title: '扇町・中崎町地区',
      subtitle: '45日前・再訪で復活＋おかえりボーナス',
    });
    expect(reasonCardText(reason('unvisited', { title: '天満地区にまだ行っていないスポットが9件', subtitle: 'お好み焼き てんご' }))).toEqual({ title: '天満地区 9件', subtitle: 'お好み焼き てんご' });
  });
  it('想定の形でない文言はそのまま返す', () => {
    expect(reasonCardText(reason('reclaim', { title: '天満地区の領主を奪われた', subtitle: 'あと2回' }))).toEqual({ title: '天満地区の領主を奪われた', subtitle: 'あと2回' });
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
    expect(nearbySubtitle(spot({ status: 'visited', visitCount: 2, hasActiveShopEvent: true }))).toBe('2回達成 ・ クーポン・イベントあり');
    expect(nearbySubtitle(spot({ status: 'discovered' }))).toBe('未達成');
    expect(nearbySubtitle(spot({ status: 'unknown', hasActiveShopEvent: true }))).toBe('未発見');
  });
});

describe('地区カードの文言', () => {
  it('主は自分なら「あなた」、いなければ出さない', () => {
    expect(lordLabelOf({ isLordMe: true, lordName: '旅人' })).toBe('領主：あなた');
    expect(lordLabelOf({ isLordMe: false, lordName: 'おまいり番長' })).toBe('領主：おまいり番長');
    expect(lordLabelOf({ isLordMe: false })).toBeUndefined();
  });
  it('2行目は最後に達成してからの日数と次の目標（達成率は出さない。色あせの札と同じ文言は重ねない）', () => {
    expect(districtSubText({ fade: { kind: 'soon', daysSinceVisit: 25, daysUntilFade: 5 }, nextGoalText: '次の目標：あと1回で銀カード' })).toBe(
      '25日前 ・ 次の目標：あと1回で銀カード',
    );
    expect(districtSubText({ fade: { kind: 'soon', daysSinceVisit: 25, daysUntilFade: 5 }, nextGoalText: 'あと5日で色あせ' })).toBe('25日前');
    expect(districtSubText({ fade: { kind: 'fresh', daysSinceVisit: 0 }, nextGoalText: '' })).toBe('今日');
    expect(districtSubText({ fade: { kind: 'never' }, nextGoalText: 'まずクエストを1つ達成しよう' })).toBe('未達成');
  });
});
