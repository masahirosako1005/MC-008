import { describe, expect, it } from 'vitest';
import { WIDE_ZOOM, backLabelOf, initialZoomState, nextZoomState, showsShops } from '@/presentation/screens/Map/ZoomState';
import type { ZoomState } from '@/presentation/screens/Map/ZoomState';

const district: ZoomState = { zoom: 'district', districtId: 'd_joka' };
const near: ZoomState = { zoom: 'near', districtId: 'd_joka' };

describe('nextZoomState', () => {
  it('広域で地区を選ぶと地区ズームになる', () => {
    expect(nextZoomState(WIDE_ZOOM, { type: 'selectDistrict', districtId: 'd_joka' })).toEqual(district);
  });
  it('歩き始めると近接になり、目的地の地区が分からなければ今の地区を保つ', () => {
    expect(nextZoomState(district, { type: 'walk', districtId: 'd_honmachi' })).toEqual({ zoom: 'near', districtId: 'd_honmachi' });
    expect(nextZoomState(district, { type: 'walk' })).toEqual(near);
    expect(nextZoomState(WIDE_ZOOM, { type: 'walk' })).toEqual({ zoom: 'near' });
  });
  it('戻るは 近接→地区→広域 の順', () => {
    expect(nextZoomState(near, { type: 'back' })).toEqual(district);
    expect(nextZoomState(district, { type: 'back' })).toEqual(WIDE_ZOOM);
    expect(nextZoomState(WIDE_ZOOM, { type: 'back' })).toEqual(WIDE_ZOOM);
  });
  it('地区の無い近接から戻ると広域', () => {
    expect(nextZoomState({ zoom: 'near' }, { type: 'back' })).toEqual(WIDE_ZOOM);
  });
  it('現在地の地区の更新は近接のときだけ反映し、地区外では前の地区を保つ', () => {
    expect(nextZoomState(near, { type: 'locate', districtId: 'd_minato' })).toEqual({ zoom: 'near', districtId: 'd_minato' });
    expect(nextZoomState(near, { type: 'locate' })).toBe(near);
    expect(nextZoomState(district, { type: 'locate', districtId: 'd_minato' })).toBe(district);
  });
  it('変化がなければ同じオブジェクトを返す', () => {
    expect(nextZoomState(near, { type: 'locate', districtId: 'd_joka' })).toBe(near);
  });
  it('reset は広域へ', () => {
    expect(nextZoomState(near, { type: 'reset' })).toEqual(WIDE_ZOOM);
  });
});

describe('backLabelOf', () => {
  it('広域は戻るボタンなし、地区は「市全体」、近接は「地区全体」', () => {
    expect(backLabelOf(WIDE_ZOOM)).toBeUndefined();
    expect(backLabelOf(district)).toBe('市全体');
    expect(backLabelOf(near)).toBe('地区全体');
    expect(backLabelOf({ zoom: 'near' })).toBe('市全体');
  });
});

describe('initialZoomState', () => {
  it('ルートに地区ID があれば地区ズームで開く', () => {
    expect(initialZoomState('d_minato', WIDE_ZOOM)).toEqual({ zoom: 'district', districtId: 'd_minato' });
  });
  it('同じ地区の近接を表示中だったなら近接を保つ', () => {
    expect(initialZoomState('d_joka', near)).toEqual(near);
  });
  it('ルートに地区ID が無ければ保存済みの状態を復元する（初回は広域）', () => {
    expect(initialZoomState(undefined, WIDE_ZOOM)).toEqual(WIDE_ZOOM);
    expect(initialZoomState(undefined, near)).toEqual(near);
    expect(initialZoomState(undefined, district)).toEqual(district);
  });
  it('地区ID の無い地区ズームは広域に直す', () => {
    expect(initialZoomState(undefined, { zoom: 'district' })).toEqual(WIDE_ZOOM);
  });
});

describe('showsShops', () => {
  it('広域では店舗を描かず、地区・近接では描く', () => {
    expect(showsShops('wide')).toBe(false);
    expect(showsShops('district')).toBe(true);
    expect(showsShops('near')).toBe(true);
  });
});

describe('nextZoomState（「広域／詳細」切替）', () => {
  it('detail は広域・地区のどこからでも現在地の地区の近接へ。地区が分からなければ今の地区を保つ', () => {
    expect(nextZoomState(WIDE_ZOOM, { type: 'detail', districtId: 'd_joka' })).toEqual({ zoom: 'near', districtId: 'd_joka' });
    expect(nextZoomState({ zoom: 'district', districtId: 'd_minato' }, { type: 'detail' })).toEqual({ zoom: 'near', districtId: 'd_minato' });
    expect(nextZoomState(WIDE_ZOOM, { type: 'detail' })).toEqual({ zoom: 'near' });
  });
});
