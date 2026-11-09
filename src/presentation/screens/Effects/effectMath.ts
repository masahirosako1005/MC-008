/**
 * @file 演出アニメーションの計算（presentation/screens/Effects 層。純粋関数）
 * 進み具合（0〜1）からのイージング・カードの回転・復活のワイプ・小さな街並みの配置・紙吹雪の動きを求める。
 * requestAnimationFrame の描画ループから毎フレーム呼ばれるため関数ログは出さない（呼び出し側の start/stop でまとめてログ）。
 * 装飾の乱数は ID から作る決定論的な乱数（Math.random は使わない）。
 */
import { seededRandomFor } from '@/Common/ui/canvas/seededHash';

/** 演出1つを自動で送るまでの時間（ミリ秒。docs/08 §6「各 2.5 秒で自動送り」） */
export const EFFECT_AUTO_ADVANCE_MS = 2500;

/** Canvas アニメーションの長さ（ミリ秒。自動送りより短くして、止まった完成形を見せる時間を残す） */
export const EFFECT_ANIMATION_MS = 1600;

/** 復活の演出で、色あせた見た目の開始値（Common の fadeStyle の最も薄い値に合わせる） */
export const REVIVAL_FROM = { saturation: 0.1, alpha: 0.45 } as const;

/** 復活の演出の小さな街並みの部品（x・w は幅に対する割合、h は地面の高さに対する割合） */
export interface RevivalPiece {
  readonly kind: 'tower' | 'midrise' | 'shop' | 'tree';
  readonly x: number;
  readonly w: number;
  readonly h: number;
  /** 模様の種（窓の並び・日よけの柄） */
  readonly seed: number;
}

/** 紙吹雪の1片（動きは confettiPose で求める） */
export interface ConfettiPiece {
  /** 飛ぶ向き（ラジアン） */
  readonly angle: number;
  /** 飛ぶ距離（半径に対する割合） */
  readonly speed: number;
  /** 回転の速さ（1 で 1 回転） */
  readonly spin: number;
  /** 大きさ（CSS px） */
  readonly size: number;
  readonly shape: 'rect' | 'tri' | 'dot' | 'bar';
  /** 色の番号（描画側の色の配列に対する添字） */
  readonly color: number;
  /** 出始めの遅れ（0〜0.25） */
  readonly delay: number;
}

/** 紙吹雪の1片のその時の姿（dx・dy は半径に対する割合） */
export interface ConfettiPose {
  readonly dx: number;
  readonly dy: number;
  readonly rotation: number;
  readonly alpha: number;
}

/** 紙吹雪の形の並び（決定論的に選ぶ） */
const CONFETTI_SHAPES: readonly ConfettiPiece['shape'][] = ['rect', 'tri', 'dot', 'bar'];

/**
 * 値を 0〜1 に丸める（NaN は 0）。
 * @param t 値
 * @returns 0〜1
 */
export function clamp01(t: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
}

/**
 * 線形補間。
 * @param a 始点
 * @param b 終点
 * @param t 0〜1
 * @returns a + (b − a)·t
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/**
 * 減速するイージング（3次）。
 * @param t 0〜1
 * @returns 0〜1
 */
export function easeOutCubic(t: number): number {
  return 1 - (1 - clamp01(t)) ** 3;
}

/**
 * 少し行き過ぎて戻るイージング（王冠が「ぽん」と出る動き）。
 * @param t 0〜1
 * @returns 0 から始まり 1 で終わる値（途中で 1 を少し超える）
 */
export function easeOutBack(t: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const c1 = 1.70158;
  const x = clamp01(t) - 1;
  return 1 + (c1 + 1) * x ** 3 + c1 * x ** 2;
}

/**
 * 経過時間から進み具合を求める。
 * @param elapsedMs 開始からの経過（ミリ秒）
 * @param durationMs 全体の長さ（ミリ秒。0 以下なら即完了）
 * @returns 0〜1
 */
export function animationProgress(elapsedMs: number, durationMs: number): number {
  return durationMs <= 0 ? 1 : clamp01(elapsedMs / durationMs);
}

/**
 * カードの回転（裏から表へ半回転）の見た目。前半 60% で回り、残りは表のまま。
 * @param progress 0〜1
 * @returns 横方向の縮尺（0〜1）と表が見えているか
 */
export function cardFlip(progress: number): { readonly scaleX: number; readonly showFront: boolean } { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const angle = Math.PI * (1 - easeOutCubic(clamp01(progress / 0.6)));
  const cos = Math.cos(angle);
  return { scaleX: Math.max(0.02, Math.abs(cos)), showFront: cos >= 0 };
}

/**
 * カードの光の帯の位置（回転が終わってから左から右へ流れる）。
 * @param progress 0〜1
 * @returns 帯の中心（カード幅に対する割合。-0.5〜1.5）。回転中は undefined
 */
export function cardShinePosition(progress: number): number | undefined { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  if (progress < 0.6) return undefined;
  return lerp(-0.5, 1.5, (progress - 0.6) / 0.4);
}

/**
 * 復活の色の戻り具合（色あせ → 元の色）。前半でゆっくり戻り、最後は元の色。
 * @param progress 0〜1
 * @returns 彩度と不透明度の係数
 */
export function revivalVisual(progress: number): { readonly saturation: number; readonly alpha: number; readonly dashed: boolean } { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const t = easeOutCubic(clamp01((progress - 0.15) / 0.7));
  return { saturation: lerp(REVIVAL_FROM.saturation, 1, t), alpha: lerp(REVIVAL_FROM.alpha, 1, t), dashed: t < 0.5 };
}

/**
 * 復活のワイプ（灰色 → 色）の位置。少し待ってから左から右へ流れ、最後は全面が色になる。
 * @param progress 0〜1
 * @returns ワイプの位置（幅に対する割合 0〜1）
 */
export function revivalWipe(progress: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const t = clamp01((progress - 0.12) / 0.66);
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * 地区ID から復活の演出の小さな街並みを決定論的に並べる（奥の高いビル → 手前の店・木の順＝描く順）。
 * @param seed 地区ID
 * @returns 部品の列（x・w は幅に対する割合、h は地面の高さに対する割合）
 */
export function revivalStreetFor(seed: string): RevivalPiece[] { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な配置ヘルパー
  const random = seededRandomFor(seed);
  const plan: readonly (readonly [RevivalPiece['kind'], number, number, number])[] = [
    ['tower', 0.05, 0.15, 0.8], ['midrise', 0.42, 0.16, 0.58], ['tower', 0.79, 0.15, 0.72],
    ['shop', 0.17, 0.24, 0.4], ['shop', 0.58, 0.23, 0.42], ['tree', 0.38, 0.07, 0.3], ['tree', 0.86, 0.08, 0.32],
  ];
  return plan.map(([kind, x, w, h]) => ({ kind, x, w, h: Math.min(0.92, h * (0.9 + random() * 0.2)), seed: Math.floor(random() * 1000) }));
}

/**
 * 紙吹雪の小片を決定論的に作る（Math.random は使わない）。
 * @param seed 種（演出の種類と地区名など）
 * @param count 片の数
 * @returns 小片の列
 */
export function confettiFor(seed: string, count: number): ConfettiPiece[] { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な配置ヘルパー
  const random = seededRandomFor(`confetti:${seed}`);
  const pieces: ConfettiPiece[] = [];
  for (let i = 0; i < count; i++) {
    pieces.push({
      angle: (Math.PI * 2 * i) / Math.max(1, count) + (random() - 0.5) * 0.6,
      speed: 0.55 + random() * 0.45,
      spin: (random() - 0.5) * 3,
      size: 4 + random() * 4.5,
      shape: CONFETTI_SHAPES[i % CONFETTI_SHAPES.length] ?? 'rect',
      color: Math.floor(random() * 4),
      delay: random() * 0.25,
    });
  }
  return pieces;
}

/**
 * 紙吹雪の1片の姿を求める。中心から勢いよく広がり、少し落ちながら回り、最後は消える。
 * @param piece 小片
 * @param progress 0〜1
 * @returns 位置（半径に対する割合）・回転（ラジアン）・不透明度
 */
export function confettiPose(piece: ConfettiPiece, progress: number): ConfettiPose { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const t = clamp01((progress - piece.delay) / (1 - piece.delay));
  const burst = easeOutCubic(clamp01(t / 0.55));
  return {
    dx: Math.cos(piece.angle) * piece.speed * burst,
    dy: Math.sin(piece.angle) * piece.speed * burst + 0.35 * t * t,
    rotation: piece.spin * Math.PI * 2 * t,
    alpha: t <= 0 ? 0 : 1 - clamp01((t - 0.7) / 0.3),
  };
}
