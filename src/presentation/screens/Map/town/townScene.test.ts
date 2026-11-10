/**
 * @file 詳細の表示の写真ピンのよけ方（townScene の liftPins）のテスト
 * 自分のアバターが写真ピンの手前に立ったとき、ピンを頭の上へ持ち上げる・場所が無ければ横へずらす・離れていれば動かさないことを確かめる。
 */
import { describe, expect, it } from 'vitest';
import { liftPins, liftedPinBoxes } from '@/presentation/screens/Map/town/townScene';
import type { PinLiftState, PlacedSpot, SceneInput, SceneSpot } from '@/presentation/screens/Map/town/townScene';

const CENTER = { lat: 34.7, lng: 135.51 };

/**
 * テスト用のスポットを作る。
 * @param id スポットID
 * @returns スポット
 */
function spot(id: string): SceneSpot {
  return { id, kind: 'shop', status: 'discovered', name: `店${id}`, ll: CENTER, goods: { icon: 'bread', label: '塩パン' }, awning: '#c0392b', amenities: [], visitCount: 0, want: false, liked: false, fade: 0, seed: 1 };
}

/**
 * テスト用の写真ピン（一辺 46px）を画面に置く。
 * @param id スポットID
 * @param x 足もとの x
 * @param y 足もとの y
 * @returns 置いたスポット
 */
function pin(id: string, x: number, y: number): PlacedSpot {
  return { spot: spot(id), x, y, scale: 1, bubble: false, label: true, pin: 46, hit: { x: x - 29, y: y - 63, w: 58, h: 69 } };
}

/**
 * テスト用の描画の入力を作る（詳細・390×600）。
 * @returns 入力
 */
function input(): SceneInput {
  return { camera: { centerLat: CENTER.lat, centerLng: CENTER.lng, metersPerPx: 0.6 }, vp: { width: 390, height: 600, bottomInset: 0 }, tier: 'near', t: 1000, textScale: 1, highlight: '#bc5b1b', inRange: new Set() };
}

/**
 * 足もとが (x, y) のアバターの矩形（MapScreen の SELF_BODY と同じ寸法）。
 * @param x 足もとの x
 * @param y 足もとの y
 * @returns 矩形
 */
function body(x: number, y: number): { x: number; y: number; w: number; h: number } {
  return { x: x - 20, y: y - 64, w: 40, h: 76 };
}

/**
 * 動きが落ち着くまで liftPins を繰り返す。
 * @param placed 置いたスポット
 * @param at アバターの矩形
 * @param walk 歩行の状態
 * @param state よけている状態
 * @returns 最後の並び
 */
function settle(placed: PlacedSpot[], at: { x: number; y: number; w: number; h: number }, walk: { walking: boolean; targetId?: string; minTop: number }, state: PinLiftState): PlacedSpot[] {
  let out = placed;
  for (let k = 0; k < 60; k++) out = liftPins(placed, input(), at, walk, state);
  return out;
}

describe('liftPins', () => {
  it('ピンの根もとに立つと、しっぽの先が頭の上に来るまで持ち上げる（名前の札の位置は変えない）', () => {
    const state: PinLiftState = new Map();
    const out = settle([pin('a', 200, 300)], body(200, 300), { walking: false, minTop: 56 }, state);
    expect(out[0]?.lift).toBe(66);
    expect(out[0]?.y).toBe(300);
    expect(out[0]?.hit.y).toBe(300 - 63 - 66);
    expect(liftedPinBoxes(out)).toHaveLength(1);
  });

  it('1回では動かしきらない（少しずつ寄せる）', () => {
    const out = liftPins([pin('a', 200, 300)], input(), body(200, 300), { walking: false, minTop: 56 }, new Map());
    expect(out[0]?.lift).toBeGreaterThan(0);
    expect(out[0]?.lift).toBeLessThan(66);
  });

  it('持ち上げる場所が無ければ、空いている横へずらす（右がふさがっていれば左）', () => {
    const state: PinLiftState = new Map();
    const right = settle([pin('a', 200, 150)], body(200, 150), { walking: false, minTop: 56 }, state);
    expect(right[0]?.lift).toBe(0);
    expect(right[0]?.pinDx).toBeGreaterThan(40);
    const left = settle([pin('a', 200, 150), pin('b', 262, 150)], body(200, 150), { walking: false, minTop: 56 }, new Map());
    expect(left[0]?.pinDx).toBeLessThan(-40);
  });

  it('離れているピン・歩いている間の行き先でないピンは動かさない', () => {
    const placed = [pin('a', 200, 300)];
    expect(liftPins(placed, input(), body(320, 300), { walking: false, minTop: 56 }, new Map())).toBe(placed);
    expect(liftPins(placed, input(), body(200, 300), { walking: true, targetId: 'b', minTop: 56 }, new Map())).toBe(placed);
    expect(liftPins(placed, input(), body(200, 300), { walking: true, targetId: 'a', minTop: 56 }, new Map())[0]?.lift).toBeGreaterThan(0);
  });

  it('離れると元の位置へ戻り、状態も消える', () => {
    const state: PinLiftState = new Map();
    const placed = [pin('a', 200, 300)];
    settle(placed, body(200, 300), { walking: false, minTop: 56 }, state);
    expect(state.size).toBe(1);
    const back = settle(placed, body(320, 300), { walking: false, minTop: 56 }, state);
    expect(back).toBe(placed);
    expect(state.size).toBe(0);
  });

  it('詳細の表示でなければ何もしない', () => {
    const placed = [pin('a', 200, 300)];
    expect(liftPins(placed, { ...input(), tier: 'district' }, body(200, 300), { walking: false, minTop: 56 }, new Map())).toBe(placed);
  });
});
