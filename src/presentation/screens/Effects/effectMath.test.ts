/**
 * @file 演出アニメーション計算の単体テスト（presentation/screens/Effects 層）
 */
import { describe, expect, it } from 'vitest';
import {
  animationProgress,
  cardFlip,
  cardShinePosition,
  clamp01,
  confettiFor,
  confettiPose,
  easeOutBack,
  easeOutCubic,
  revivalStreetFor,
  revivalVisual,
  revivalWipe,
} from '@/presentation/screens/Effects/effectMath';

describe('イージングと進み具合', () => {
  it('0〜1 の外は丸め、NaN は 0 にする', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
  it('イージングは 0 で始まり 1 で終わる', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
  });
  it('長さ 0 のアニメーションは即完了', () => {
    expect(animationProgress(100, 0)).toBe(1);
    expect(animationProgress(800, 1600)).toBe(0.5);
  });
});

describe('カードの回転と光', () => {
  it('最初は裏、最後は表で縮尺 1', () => {
    expect(cardFlip(0).showFront).toBe(false);
    expect(cardFlip(1)).toEqual({ scaleX: 1, showFront: true });
  });
  it('回転中は光らず、回転後に左から右へ流れる', () => {
    expect(cardShinePosition(0.3)).toBeUndefined();
    expect(cardShinePosition(0.6)).toBeCloseTo(-0.5);
    expect(cardShinePosition(1)).toBeCloseTo(1.5);
  });
});

describe('復活の色の戻り方', () => {
  it('始めは色あせ（薄く破線）、終わりは元の色（実線）', () => {
    expect(revivalVisual(0)).toEqual({ saturation: 0.1, alpha: 0.45, dashed: true });
    expect(revivalVisual(1)).toEqual({ saturation: 1, alpha: 1, dashed: false });
  });
});

describe('復活のワイプ', () => {
  it('始めは灰色のまま、終わりは全面が色になり、途中で戻らない', () => {
    expect(revivalWipe(0)).toBe(0);
    expect(revivalWipe(1)).toBe(1);
    let prev = 0;
    for (let p = 0; p <= 1; p += 0.05) {
      expect(revivalWipe(p)).toBeGreaterThanOrEqual(prev);
      prev = revivalWipe(p);
    }
  });
});

describe('revivalStreetFor', () => {
  it('同じ地区なら同じ並び（決定論的）で、幅と高さの中に収まる', () => {
    const a = revivalStreetFor('d_tenma');
    expect(a).toEqual(revivalStreetFor('d_tenma'));
    expect(a.some((p) => p.kind === 'shop')).toBe(true);
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(1);
      expect(p.h).toBeGreaterThan(0);
      expect(p.h).toBeLessThanOrEqual(0.92);
    }
  });
});

describe('紙吹雪', () => {
  it('同じ種なら同じ小片になり、最初は見えず、広がってから消える', () => {
    const pieces = confettiFor('card:天満', 12);
    expect(pieces).toEqual(confettiFor('card:天満', 12));
    expect(pieces).toHaveLength(12);
    for (const piece of pieces) {
      expect(confettiPose(piece, 0).alpha).toBe(0);
      expect(confettiPose(piece, 1).alpha).toBe(0);
      const mid = confettiPose(piece, 0.5);
      expect(Math.hypot(mid.dx, mid.dy)).toBeGreaterThan(0.2);
    }
  });
});
