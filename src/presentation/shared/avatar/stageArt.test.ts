/**
 * @file アバターのステージの絵（stageArt）のテスト
 * DOM の無い環境なので、呼び出しを数えるだけの偽の 2D コンテキストで、全種類が例外なく描け、
 * 数値の引数に NaN・Infinity が混ざらず、save/restore が釣り合うことを確かめる。
 */
import { describe, expect, it } from 'vitest';
import { BACKGROUND_STYLES, OBJECT_STYLES, STAGE_FLOOR_RATIO, paintBackground, paintObject } from '@/presentation/shared/avatar/stageArt';
import type { BackgroundStyle, ObjectStyle } from '@/presentation/shared/avatar/avatarLook';

/** 偽の 2D コンテキストと、その記録 */
interface FakeContext {
  readonly ctx: CanvasRenderingContext2D;
  /** save の深さ（終わったら 0） */
  depth(): number;
  /** 呼ばれた描画メソッドの回数 */
  calls(): number;
  /** NaN・Infinity を受け取ったメソッド名 */
  readonly badCalls: string[];
  /** 楕円（ellipse）と放射グラデーション（createRadialGradient）の中心と大きさ [メソッド名, x, y, 横半径または外側の半径] */
  readonly centers: (readonly [string, number, number, number])[];
}

/**
 * 呼び出しを記録する偽の 2D コンテキストを作る。
 * @returns 偽のコンテキストと記録
 */
function fakeContext(): FakeContext {
  let depth = 0;
  let calls = 0;
  const badCalls: string[] = [];
  const centers: (readonly [string, number, number, number])[] = [];
  const gradient = { addColorStop: (): void => undefined };
  const special: Record<string, (...args: unknown[]) => unknown> = {
    save: () => { depth++; },
    restore: () => { depth--; },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  const props: Record<string, unknown> = {};
  const ctx = new Proxy({}, {
    get(_target, key: string | symbol): unknown {
      if (typeof key !== 'string') return undefined;
      if (key in props) return props[key];
      return (...args: unknown[]): unknown => {
        calls++;
        if (args.some((a) => typeof a === 'number' && !Number.isFinite(a))) badCalls.push(key);
        const size = key === 'ellipse' ? args[2] : args[5];
        if ((key === 'ellipse' || key === 'createRadialGradient') && typeof args[0] === 'number' && typeof args[1] === 'number' && typeof size === 'number') centers.push([key, args[0], args[1], size]);
        return special[key]?.(...args);
      };
    },
    set(_target, key: string | symbol, value: unknown): boolean {
      if (typeof key === 'string') props[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, depth: () => depth, calls: () => calls, badCalls, centers };
}

/** 契約（avatarLook）の背景の種類すべて */
const ALL_BACKGROUNDS: readonly BackgroundStyle[] = ['plain', 'room', 'minamimori', 'tenma', 'tenroku', 'ogimachi', 'okawa', 'sunset', 'night', 'starry', 'dreamy', 'idol',
  'aquarium', 'yozakura', 'snowlight', 'candy', 'beach', 'castle', 'cafe', 'galaxy',
  'edo', 'nakazaki', 'tenjinMatsuri', 'momiji'];
/** 契約（avatarLook）の置くものの種類すべて */
const ALL_OBJECTS: readonly ObjectStyle[] = [
  'bench', 'plant', 'bicycle', 'vending', 'lamp', 'signboard', 'stall', 'torii', 'sakura',
  'lantern', 'postbox', 'maneki', 'tanuki', 'fountain', 'gacha', 'fireworks', 'trophy', 'heartballoon', 'dresser', 'winnerFlag', 'gojinto', 'moyooshiDaiko',
];

describe('stageArt の種類の一覧', () => {
  it('背景・置くものとも、契約のすべての種類を描ける', () => {
    expect([...BACKGROUND_STYLES].sort()).toEqual([...ALL_BACKGROUNDS].sort());
    expect([...OBJECT_STYLES].sort()).toEqual([...ALL_OBJECTS].sort());
  });

  it('地面の線はステージの高さの 0.8', () => {
    expect(STAGE_FLOOR_RATIO).toBe(0.8);
  });
});

describe('paintBackground', () => {
  const sizes: readonly (readonly [number, number])[] = [[358, 280], [72, 72]];
  for (const style of ALL_BACKGROUNDS) {
    it(`${style} をステージと見本の大きさ・t=0／3.7 で描ける`, () => {
      for (const [w, h] of sizes) {
        for (const t of [0, 3.7]) {
          const fake = fakeContext();
          expect(() => paintBackground(fake.ctx, style, w, h, t)).not.toThrow();
          expect(fake.depth()).toBe(0);
          expect(fake.calls()).toBeGreaterThan(5);
          expect(fake.badCalls).toEqual([]);
        }
      }
    });
  }

  it('中央の足元に輪・楕円・光だまりを描かない（台座とスポットライトは画面側が描く）', () => {
    const [w, h] = [358, 280];
    for (const style of ALL_BACKGROUNDS) {
      const fake = fakeContext();
      paintBackground(fake.ctx, style, w, h, 0);
      const underAvatar = fake.centers.filter(([, x, y, size]) => size > w * 0.06 && Math.abs(x - w / 2) < w * 0.08 && Math.abs(y - h * STAGE_FLOOR_RATIO) < h * 0.08);
      expect(underAvatar, style).toEqual([]);
    }
  });

  it('知らない種類はシンプルで描き、大きさ 0 は何も描かない', () => {
    const unknown = fakeContext();
    paintBackground(unknown.ctx, 'nope' as BackgroundStyle, 100, 80, 1);
    expect(unknown.calls()).toBeGreaterThan(5);
    expect(unknown.depth()).toBe(0);
    const empty = fakeContext();
    paintBackground(empty.ctx, 'plain', 0, 80, 1);
    expect(empty.calls()).toBe(0);
  });
});

describe('paintObject', () => {
  for (const style of ALL_OBJECTS) {
    it(`${style} を拡大率 1／0.6・t=0／3.7 で描ける`, () => {
      for (const scale of [1, 0.6]) {
        for (const t of [0, 3.7]) {
          const fake = fakeContext();
          expect(() => paintObject(fake.ctx, style, 100, 200, scale, t)).not.toThrow();
          expect(fake.depth()).toBe(0);
          expect(fake.calls()).toBeGreaterThan(3);
          expect(fake.badCalls).toEqual([]);
        }
      }
    });
  }

  it('知らない種類・拡大率 0 は何も描かない', () => {
    const unknown = fakeContext();
    paintObject(unknown.ctx, 'nope' as ObjectStyle, 0, 0, 1, 0);
    expect(unknown.calls()).toBe(0);
    const zero = fakeContext();
    paintObject(zero.ctx, 'bench', 0, 0, 0, 0);
    expect(zero.calls()).toBe(0);
  });
});
