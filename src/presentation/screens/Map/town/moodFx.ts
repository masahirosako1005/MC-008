/**
 * @file 街の雰囲気が変わったときの演出（presentation/screens/Map/town 層。毎フレーム描く）
 * 2026-11-10 ユーザー指示「陣取りで街の活性とともに、陣地がとられていくと街が廃れていくような感じにしてほしい。演出も追加してほしい」。
 * - 奪われた（down）: 黒い雲が流れてきて小雨、色が抜けるセピアの波、カラスが飛び立つ、「{地区}が奪われた…」の札
 * - にぎわいが戻った（up）: 金色の光の筋、暖かい色の波、花びらと紙吹雪、花がぽんぽん咲く、「{地区}ににぎわいが戻った！」の札
 * 見た目だけで、Lv・カード・図鑑・EXP は減らない（CLAUDE.md 4.3）。乱数は使わず決定論的に。prefers-reduced-motion では粒を減らす。座標はログに出さない。
 */
import { clamp01, easeOutCubic as easeOut } from '@/Common/ui/canvas/easing';
import { createLogger } from '@/Common/logging/logger';
import { toRgba } from '@/Common/ui/canvas/colorUtils';
import { canvasFont } from '@/Common/ui/canvas/drawUtils';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { PALETTE } from '@/Common/ui/theme/palette';
import type { LatLng } from '@/presentation/screens/Map/MapViewModel';
import { TERRITORY_RIVAL_COLOR } from '@/presentation/screens/Map/town/townTypes';

const logger = createLogger('presentation/screens/Map/town/moodFx');

/** 演出の長さ（ミリ秒） */
export const MOOD_FX_MS = 2800;
/** 雲・カラスの色（絵の部品） */
const CLOUD = { body: '#5d5566', light: '#7a7184', rain: 'rgba(120, 130, 160, 0.7)' } as const;
const CROW = '#2b2630';
/** 花の色（絵の部品） */
const PETALS: readonly string[] = ['#f08aa6', '#f5c24a', '#ffffff', '#e8794a', '#a8d596'];

/** 雰囲気の変化の演出1つ */
interface MoodEffect {
  readonly at: LatLng;
  readonly direction: 'up' | 'down';
  readonly label: string;
  readonly startedAt: number;
  readonly seed: number;
}

/**
 * 粒を減らす設定か。
 * @returns 減らすなら true
 */
function reducedMotion(): boolean { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ設定の参照
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 雰囲気の変化の演出をまとめて持つ */
export class MoodFx {
  private effects: MoodEffect[] = [];

  /**
   * 演出を足す。
   * @param at 地区の中心
   * @param direction 良くなった（up）か悪くなった（down）か
   * @param label 札の文言
   * @param now 始める時刻
   * @sideEffect 演出を登録する
   */
  add(at: LatLng, direction: 'up' | 'down', label: string, now: number): void {
    const log = logger.fn('add', { direction });
    this.effects.push({ at, direction, label, startedAt: now, seed: this.effects.length * 7 + (direction === 'up' ? 3 : 11) });
    log.exit(undefined);
  }

  /**
   * まだ演出が続いているか。
   * @param now 現在時刻
   * @returns 続いていれば true
   */
  active(now: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
    return this.effects.some((e) => now - e.startedAt < MOOD_FX_MS);
  }

  /**
   * 演出を描く（終わったものは捨てる）。
   * @param ctx 2D コンテキスト
   * @param toScreen 緯度経度 → 画面
   * @param vp 描画領域（地区の中心が画面の外なら、画面の中に寄せて見せる）
   * @param t 現在時刻
   * @param textScale 文字の拡大率
   * @sideEffect canvas に描く
   */
  draw(ctx: CanvasRenderingContext2D, toScreen: (ll: LatLng) => Point2D, vp: { readonly width: number; readonly height: number }, t: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    this.effects = this.effects.filter((e) => t - e.startedAt < MOOD_FX_MS);
    const reduced = reducedMotion();
    for (const e of this.effects) {
      const elapsed = t - e.startedAt;
      if (elapsed < 0) continue;
      const raw = toScreen(e.at);
      const p = { x: Math.min(vp.width - 90, Math.max(90, raw.x)), y: Math.min(vp.height - 170, Math.max(150, raw.y)) };
      ctx.save();
      if (e.direction === 'down') drawDown(ctx, p, elapsed, e.seed, reduced);
      else drawUp(ctx, p, elapsed, e.seed, reduced);
      drawLabel(ctx, p, e, elapsed, textScale);
      ctx.restore();
    }
  }
}

/**
 * 奪われた演出（雲・小雨・セピアの波・カラス）。
 * @param ctx 2D コンテキスト
 * @param p 地区の中心
 * @param ms 経過（ミリ秒）
 * @param seed 種
 * @param reduced 粒を減らすか
 * @sideEffect canvas に描く
 */
function drawDown(ctx: CanvasRenderingContext2D, p: Point2D, ms: number, seed: number, reduced: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const out = 1 - clamp01((ms - 2200) / 600);
  // セピアの波（色が抜けていく）
  const wave = easeOut((ms - 150) / 1200);
  if (wave > 0) {
    ctx.globalAlpha = 0.55 * (1 - wave) * out;
    ctx.fillStyle = 'rgba(110, 86, 60, 0.5)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 20 + wave * 140, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.8 * (1 - wave) * out;
    ctx.strokeStyle = TERRITORY_RIVAL_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  drawRainCloud(ctx, p, ms, seed, reduced, out);
  // カラスが飛び立つ
  if (!reduced) {
    for (let i = 0; i < 4; i++) {
      const k = clamp01((ms - 300 - i * 140) / 1900);
      if (k <= 0 || k >= 1) continue;
      const a = -Math.PI / 2 + (i - 1.5) * 0.7;
      const dist = 20 + easeOut(k) * 120;
      const x = p.x + Math.cos(a) * dist;
      const y = p.y - 10 + Math.sin(a) * dist * 0.7;
      ctx.globalAlpha = (1 - k) * out;
      drawCrow(ctx, x, y, ms / 90 + i, 1 - k * 0.3);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * 黒い雲が上から流れてきて止まり、小雨を降らせる。
 * @param ctx 2D コンテキスト
 * @param p 地区の中心
 * @param ms 経過（ミリ秒）
 * @param seed 種
 * @param reduced 粒を減らすか
 * @param out 消えていく度合い（1 で見える）
 * @sideEffect canvas に描く
 */
function drawRainCloud(ctx: CanvasRenderingContext2D, p: Point2D, ms: number, seed: number, reduced: boolean, out: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const come = easeOut(ms / 650);
  const cy = p.y - 70 - (1 - come) * 60;
  ctx.globalAlpha = 0.92 * out;
  for (const [dx, dy, r] of [[-22, 4, 15], [0, -4, 19], [22, 3, 14], [10, 9, 13], [-10, 9, 12]] as const) {
    ctx.fillStyle = CLOUD.body;
    ctx.beginPath();
    ctx.arc(p.x + dx, cy + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = CLOUD.light;
  ctx.beginPath();
  ctx.arc(p.x - 4, cy - 8, 9, 0, Math.PI * 2);
  ctx.fill();
  if (ms <= 500) return;
  ctx.strokeStyle = CLOUD.rain;
  ctx.lineWidth = 1.5;
  const drops = reduced ? 6 : 16;
  for (let i = 0; i < drops; i++) {
    const x = p.x - 30 + ((i * 37 + seed * 13) % 60);
    const fall = ((ms / 420 + i * 0.37) % 1) * 52;
    ctx.beginPath();
    ctx.moveTo(x, cy + 14 + fall);
    ctx.lineTo(x - 2, cy + 22 + fall);
    ctx.stroke();
  }
}

/**
 * カラス（羽ばたく「へ」の字の黒い鳥）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param phase 羽ばたきの位相
 * @param s 大きさ
 * @sideEffect canvas に描く
 */
function drawCrow(ctx: CanvasRenderingContext2D, x: number, y: number, phase: number, s: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const flap = Math.sin(phase) * 5 * s;
  ctx.strokeStyle = CROW;
  ctx.lineWidth = 2.4 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 9 * s, y - flap);
  ctx.quadraticCurveTo(x - 4 * s, y - 4 * s, x, y);
  ctx.quadraticCurveTo(x + 4 * s, y - 4 * s, x + 9 * s, y - flap);
  ctx.stroke();
  ctx.fillStyle = CROW;
  ctx.beginPath();
  ctx.ellipse(x, y + 1 * s, 2.6 * s, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * にぎわいが戻った演出（光の筋・暖かい色の波・花びら・花）。
 * @param ctx 2D コンテキスト
 * @param p 地区の中心
 * @param ms 経過（ミリ秒）
 * @param seed 種
 * @param reduced 粒を減らすか
 * @sideEffect canvas に描く
 */
function drawUp(ctx: CanvasRenderingContext2D, p: Point2D, ms: number, seed: number, reduced: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const out = 1 - clamp01((ms - 2100) / 700);
  drawSunRays(ctx, p, ms, clamp01(ms / 300) * out);
  // 暖かい色の波（色が戻る）
  const wave = easeOut((ms - 100) / 1100);
  if (wave > 0 && wave < 1) {
    ctx.globalAlpha = 0.5 * (1 - wave);
    ctx.fillStyle = toRgba(PALETTE.glow, 0.6);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16 + wave * 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9 * (1 - wave);
    ctx.strokeStyle = PALETTE.brand;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  // 花がぽんぽん咲く
  for (let i = 0; i < 8; i++) {
    const k = easeOut((ms - 250 - i * 70) / 380);
    if (k <= 0) continue;
    const a = (i / 8) * Math.PI * 2 + seed;
    const r = 46 + (i % 2) * 18;
    drawFlower(ctx, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.6, 5.5 * k * (1 + 0.25 * Math.sin(k * Math.PI)), PETALS[i % PETALS.length] ?? PALETTE.white, out);
  }
  // 花びら・紙吹雪
  const count = reduced ? 0 : 26;
  for (let i = 0; i < count; i++) {
    const k = clamp01((ms - 120) / 2200);
    const a = ((i * 137.5 + seed * 31) % 360) * (Math.PI / 180);
    const speed = 70 + ((i * 53) % 60);
    const x = p.x + Math.cos(a) * speed * easeOut(k) * 1.4;
    const y = p.y - 20 + Math.sin(a) * speed * easeOut(k) - 30 * k + 120 * k * k;
    ctx.globalAlpha = (1 - k) * out;
    ctx.fillStyle = PALETTE.confetti[i % PALETTE.confetti.length] ?? PALETTE.brand;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ms / 180 + i);
    ctx.fillRect(-3, -1.5, 6, 3);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/**
 * 回る金色の光の筋。
 * @param ctx 2D コンテキスト
 * @param p 中心
 * @param ms 経過（ミリ秒）
 * @param alpha 不透明度
 * @sideEffect canvas に描く
 */
function drawSunRays(ctx: CanvasRenderingContext2D, p: Point2D, ms: number, alpha: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (alpha <= 0) return;
  ctx.save();
  ctx.translate(p.x, p.y - 10);
  ctx.rotate(ms / 2600);
  ctx.globalAlpha = 0.45 * alpha;
  ctx.fillStyle = PALETTE.glow;
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-7, -110);
    ctx.lineTo(7, -110);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 5枚の花びらの花。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param r 大きさ
 * @param color 花びらの色
 * @param alpha 不透明度
 * @sideEffect canvas に描く
 */
function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = PALETTE.metalGold;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 札（奪われた＝暗い紫の縁の紙、戻った＝オレンジの布）。下から弾んで出て、少し置いて消える。
 * @param ctx 2D コンテキスト
 * @param p 地区の中心
 * @param e 演出
 * @param ms 経過
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawLabel(ctx: CanvasRenderingContext2D, p: Point2D, e: MoodEffect, ms: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const k = ms - 380;
  if (k < 0) return;
  const pop = Math.min(1, k / 260);
  const s = pop < 1 ? 0.6 + 0.55 * Math.sin((pop * Math.PI) / 1.3) : 1;
  const alpha = 1 - clamp01((ms - 2300) / 450);
  ctx.globalAlpha = alpha;
  ctx.font = canvasFont(14, 800, textScale);
  const w = ctx.measureText(e.label).width + 30;
  const h = 30 * textScale;
  ctx.save();
  ctx.translate(p.x, p.y + 54);
  ctx.scale(s, s);
  const up = e.direction === 'up';
  ctx.fillStyle = toRgba(PALETTE.ink, 0.22);
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2 + 3, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = up ? PALETTE.brand : PALETTE.night800;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = up ? PALETTE.glow : TERRITORY_RIVAL_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = PALETTE.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(e.label, 0, 1);
  ctx.restore();
  ctx.globalAlpha = 1;
}
