/**
 * @file mapEffects のテスト（演出の寿命・揺れ・どの種類も例外なく描けること）
 */
import { describe, expect, it } from 'vitest';
import { EFFECT_MS, MapEffects } from '@/presentation/screens/Map/town/mapEffects';
import type { MapEffectKind } from '@/presentation/screens/Map/town/mapEffects';

/**
 * どのメソッドを呼んでも何もしない 2D コンテキスト（measureText・グラデーションだけ形を返す）。
 * @returns コンテキスト
 */
function stubContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: (): void => undefined }),
  };
  return new Proxy(target, {
    get: (obj, key: string) => (key in obj ? obj[key] : (): void => undefined),
    set: (obj, key: string, value: unknown) => {
      obj[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const AT = { lat: 34.7, lng: 135.51 };
const project = (): { x: number; y: number } => ({ x: 100, y: 200 });

describe('MapEffects', () => {
  it('足した演出は長さの間だけ残り、過ぎたら消える', () => {
    const fx = new MapEffects();
    fx.add('arrive', AT, { startAt: 0 });
    expect(fx.active()).toBe(true);
    fx.drawUnder(stubContext(), project, EFFECT_MS.arrive - 1);
    expect(fx.active()).toBe(true);
    fx.drawUnder(stubContext(), project, EFFECT_MS.arrive + 1);
    expect(fx.active()).toBe(false);
  });

  it('チェックインはスタンプが押された後だけ画面が揺れ、しばらくで止まる', () => {
    const fx = new MapEffects();
    fx.add('checkin', AT, { startAt: 1000 });
    expect(fx.shake(1050)).toEqual({ x: 0, y: 0 });
    const s = fx.shake(1230);
    expect(Math.abs(s.x) + Math.abs(s.y)).toBeGreaterThan(0);
    expect(fx.shake(5000)).toEqual({ x: 0, y: 0 });
  });

  it('土ぼこりは間を空けて出す（毎フレームは足さない）', () => {
    const fx = new MapEffects();
    fx.addDust(AT, 0);
    fx.addDust(AT, 50);
    fx.drawUnder(stubContext(), project, EFFECT_MS.dust + 10);
    expect(fx.active()).toBe(false);
  });

  it('すべての種類を、途中のどの時点でも例外なく描ける', () => {
    const kinds: MapEffectKind[] = ['checkin', 'points', 'coins', 'discover', 'arrive', 'levelup', 'dust'];
    const fx = new MapEffects();
    for (const kind of kinds) fx.add(kind, AT, { startAt: 0, text: '+15pt', target: { x: 20, y: 300 } });
    for (const t of [0, 100, 300, 700, 1200, 1800, 2100]) {
      expect(() => {
        fx.drawUnder(stubContext(), project, t);
        fx.drawOver(stubContext(), project, t, 1);
      }).not.toThrow();
    }
  });
});
