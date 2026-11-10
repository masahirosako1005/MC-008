/**
 * @file 中間の表示の吹き出し（middleBubbles）のテスト
 * 文字の選び方・置く順・重ならない配置・トイレの出し分けを確かめる。
 */
import { describe, expect, it } from 'vitest';
import { clipText, estimateTextWidth, layoutMiddleBubbles, middlePriority, middleTextOf } from '@/presentation/screens/Map/town/middleBubbles';
import type { SceneInput, SceneSpot } from '@/presentation/screens/Map/town/townScene';

const CENTER = { lat: 34.7, lng: 135.51 };

/**
 * テスト用のスポットを作る。
 * @param over 上書きする項目
 * @returns スポット
 */
function spot(over: Partial<SceneSpot> & { id: string }): SceneSpot {
  return {
    kind: 'shop',
    status: 'discovered',
    name: `店${over.id}`,
    ll: CENTER,
    goods: { icon: 'bread', label: '塩パン' },
    awning: '#c0392b',
    amenities: [],
    visitCount: 0,
    want: false,
    liked: false,
    fade: 0,
    seed: 1,
    ...over,
  };
}

/**
 * テスト用の描画の入力を作る（中間・390×700）。
 * @param over 上書きする項目
 * @returns 入力
 */
function input(over: Partial<SceneInput> = {}): SceneInput {
  return {
    camera: { centerLat: CENTER.lat, centerLng: CENTER.lng, metersPerPx: 1.5 },
    vp: { width: 390, height: 700, bottomInset: 0 },
    tier: 'district',
    t: 1000,
    textScale: 1,
    highlight: '#bc5b1b',
    inRange: new Set(),
    ...over,
  };
}

describe('middleTextOf', () => {
  it('未発見のお店は「？」だけ（名前も商品も出さない）', () => {
    expect(middleTextOf(spot({ id: 'a', status: 'unknown' }), false)).toBe('？');
  });
  it('お店は看板商品、今日だけは「！」付き、選択中は名前', () => {
    expect(middleTextOf(spot({ id: 'a', seed: 1 }), false)).toBe('塩パン');
    expect(middleTextOf(spot({ id: 'a', today: { tag: '今日だけ', title: 'x', hot: true } }), false)).toBe('塩パン！');
    expect(middleTextOf(spot({ id: 'a' }), true)).toBe('店a');
  });
  it('名所は名前、長い文字は … で切る', () => {
    expect(middleTextOf(spot({ id: 'l', kind: 'landmark', name: '天満天神繁昌亭の前の広場' }), false)).toBe('天満天神繁昌亭の前…');
    expect(clipText('あいうえおかきくけこさ', 9)).toBe('あいうえおかきく…');
  });
});

describe('middlePriority', () => {
  it('選択中 > 今日だけ > 行きたい > フィルタに合う、合わないものは最後', () => {
    const hot = middlePriority(spot({ id: 'h', today: { tag: '今日だけ', title: 'x', hot: true } }), undefined, undefined);
    const want = middlePriority(spot({ id: 'w', want: true }), undefined, undefined);
    const match = middlePriority(spot({ id: 'm' }), true, undefined);
    const off = middlePriority(spot({ id: 'o' }), false, undefined);
    expect(middlePriority(spot({ id: 's' }), undefined, 's')).toBeGreaterThan(hot);
    expect(hot).toBeGreaterThan(want);
    expect(want).toBeGreaterThan(match);
    expect(off).toBeLessThan(0);
  });
});

describe('estimateTextWidth', () => {
  it('全角は 1em、半角は 0.58em で数える', () => {
    expect(estimateTextWidth('あい', 10)).toBe(20);
    expect(estimateTextWidth('ab', 10)).toBeCloseTo(11.6);
  });
});

describe('layoutMiddleBubbles', () => {
  it('吹き出しどうしは重ならず、置けないものは点だけになる', () => {
    const spots = Array.from({ length: 30 }, (_, k) => spot({ id: `s${k}`, ll: { lat: CENTER.lat + (k % 5) * 0.00008, lng: CENTER.lng + Math.floor(k / 5) * 0.0001 } }));
    const placed = layoutMiddleBubbles(spots, input());
    const boxes = placed.flatMap((p) => (p.callout === undefined ? [] : [p.callout]));
    expect(boxes.length).toBeGreaterThan(0);
    expect(placed.some((p) => p.callout === undefined)).toBe(true);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a === undefined || b === undefined) continue;
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlap).toBe(false);
      }
    }
    // ピン（写真）は置かない
    expect(placed.every((p) => p.pin === 0)).toBe(true);
  });

  it('同じ場所に重なっても、選択中のお店はいちばん良い場所に吹き出しが出る', () => {
    const spots = [spot({ id: 'a' }), spot({ id: 'b' }), spot({ id: 'c' })];
    const placed = layoutMiddleBubbles(spots, input({ selectedId: 'c' }));
    const c = placed.find((p) => p.spot.id === 'c');
    expect(c?.callout?.selected).toBe(true);
    expect(c?.callout?.text).toBe('店c');
  });

  it('トイレはフィルタに合うとき・行きたいのときだけ置く', () => {
    const toilet = spot({ id: 't', kind: 'toilet', name: 'トイレ', ll: { lat: CENTER.lat + 0.0005, lng: CENTER.lng } });
    expect(layoutMiddleBubbles([toilet], input()).length).toBe(0);
    expect(layoutMiddleBubbles([toilet], input({ matches: (s) => s.kind === 'toilet' })).length).toBe(1);
    expect(layoutMiddleBubbles([{ ...toilet, want: true }], input()).length).toBe(1);
  });

  it('当たり判定は吹き出しと点を両方含む', () => {
    const placed = layoutMiddleBubbles([spot({ id: 'a' })], input());
    const p = placed[0];
    const c = p?.callout;
    expect(p).toBeDefined();
    expect(c).toBeDefined();
    if (p === undefined || c === undefined) return;
    expect(p.hit.x).toBeLessThanOrEqual(c.x);
    expect(p.hit.y).toBeLessThanOrEqual(c.y);
    expect(p.hit.y + p.hit.h).toBeGreaterThanOrEqual(p.y);
  });
});

describe('お店の声の当たり判定（registerOverlayHits → hitTestScene）', () => {
  it('吹き出しの上をタップすると、その吹き出しのお店を返す', async () => {
    const { hitTestScene, registerOverlayHits } = await import('@/presentation/screens/Map/town/townScene');
    const a = spot({ id: 'a' });
    const b = spot({ id: 'b' });
    const placed = [
      { spot: a, x: 100, y: 300, scale: 1.5, bubble: false, label: true, pin: 46, hit: { x: 70, y: 240, w: 60, h: 70 } },
      { spot: b, x: 200, y: 300, scale: 1.5, bubble: false, label: true, pin: 46, hit: { x: 170, y: 240, w: 60, h: 70 } },
    ];
    registerOverlayHits(placed, [{ spotId: 'b', x: 40, y: 150, w: 180, h: 40 }]);
    expect(hitTestScene(placed, { x: 60, y: 170 })?.id).toBe('b');
    expect(hitTestScene(placed, { x: 100, y: 280 })?.id).toBe('a');
    expect(hitTestScene([...placed], { x: 60, y: 170 })).toBeUndefined();
  });
});
