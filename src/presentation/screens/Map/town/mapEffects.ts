/**
 * @file 地図の上の演出（presentation/screens/Map/town 層。毎フレーム描く）
 * 2026-11-09 ユーザー指示「エフェクトや演出を追加してほしい（チェックインなど）」。
 * - チェックイン: 朱のスタンプがドンと押され（画面が少し揺れる）、衝撃波・紙吹雪・きらめき、コインが陣地の札へ飛ぶ、「+n pt」が浮かぶ
 * - 発見: スポットの後ろに光の筋が回り、「発見！」がはねる
 * - 到着: 足もとに輪が広がる
 * - 地区の成長: 地区の札の上に花火
 * - 歩行: 足もとに小さな土ぼこり
 * 乱数は演出ごとの種から作る（Math.random は使わない）。動きを減らす設定（prefers-reduced-motion）では紙吹雪・揺れを省く。座標はログに出さない。
 */
import { easeOutBack, easeOutCubic } from '@/Common/ui/canvas/easing';
import { createLogger } from '@/Common/logging/logger';
import { canvasFont } from '@/Common/ui/canvas/drawUtils';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { createSeededRandom, hashString } from '@/Common/ui/canvas/seededHash';
import { PALETTE } from '@/Common/ui/theme/palette';
import type { LatLng } from '@/presentation/screens/Map/MapViewModel';

const logger = createLogger('presentation/screens/Map/town/mapEffects');

/** 演出の種類 */
export type MapEffectKind = 'checkin' | 'points' | 'coins' | 'discover' | 'arrive' | 'levelup' | 'dust';

/** 演出ごとの長さ（ミリ秒） */
export const EFFECT_MS: Readonly<Record<MapEffectKind, number>> = {
  checkin: 1700,
  points: 1500,
  coins: 1200,
  discover: 1300,
  arrive: 700,
  levelup: 2200,
  dust: 450,
};
/** スタンプが押される瞬間（ミリ秒） */
const STAMP_IMPACT_MS = 170;
/** 揺れの大きさ（CSS px）と長さ（ミリ秒） */
const SHAKE_PX = 6;
const SHAKE_MS = 320;
/** 土ぼこりを出す間隔（ミリ秒） */
const DUST_EVERY_MS = 230;
/** 紙吹雪の色 */
const CONFETTI_COLORS: readonly string[] = [...PALETTE.confetti, '#ff8fab', PALETTE.gold];
/** 朱（スタンプ・強調） */
const VERMILION = PALETTE.brand;
/** インク */
const INK = '#2b2a3a';

/** 1つの演出 */
interface MapEffect {
  readonly kind: MapEffectKind;
  /** 起きた場所（地図に貼りつく） */
  readonly at: LatLng;
  readonly startedAt: number;
  readonly seed: number;
  /** 添える文字（「+15pt」「Lv3」など） */
  readonly text?: string;
  /** 飛んでいく先（画面座標。コイン） */
  readonly target?: Point2D;
}

/** 演出を足すときの追加の情報 */
export interface MapEffectOptions {
  readonly text?: string;
  readonly target?: Point2D;
  /** 始める時刻（performance.now()。省略時は今） */
  readonly startAt?: number;
}

/**
 * 動きを減らす設定か（OS の「視差効果を減らす」）。
 * @returns 減らすなら true
 */
function reducedMotion(): boolean { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶ読み取りヘルパー
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 地図の上の演出の集まり */
export class MapEffects {
  private effects: MapEffect[] = [];
  private shakeAt: number | undefined;
  private lastDustAt = Number.NEGATIVE_INFINITY;
  private count = 0;

  /**
   * 演出を足す。
   * @param kind 種類
   * @param at 場所
   * @param opts 文字・飛ぶ先・開始時刻
   * @sideEffect 演出を登録する（チェックインは揺れも始める）
   */
  add(kind: MapEffectKind, at: LatLng, opts: MapEffectOptions = {}): void {
    const log = logger.fn('add', { kind });
    const startedAt = opts.startAt ?? performance.now();
    this.count += 1;
    this.effects.push({ kind, at, startedAt, seed: hashString(`${kind}:${this.count}`), ...(opts.text === undefined ? {} : { text: opts.text }), ...(opts.target === undefined ? {} : { target: opts.target }) });
    if (kind === 'checkin' && !reducedMotion()) this.shakeAt = startedAt + STAMP_IMPACT_MS;
    log.exit(undefined, `${this.effects.length} 件`);
  }

  /**
   * 歩いている足もとに土ぼこりを足す（前回から間が空いていれば）。
   * @param at 場所
   * @param now 現在時刻
   * @sideEffect 演出を登録する
   */
  addDust(at: LatLng, now: number): void { // audit-ignore: fnlog-missing 歩行の毎フレームで呼ぶ（間引いて登録するだけ）
    if (now - this.lastDustAt < DUST_EVERY_MS) return;
    this.lastDustAt = now;
    this.count += 1;
    this.effects.push({ kind: 'dust', at, startedAt: now, seed: this.count });
  }

  /**
   * 演出が残っているか。
   * @returns 残っていれば true
   */
  active(): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
    return this.effects.length > 0;
  }

  /**
   * 画面の揺れ（スタンプが押された直後だけ）。
   * @param now 現在時刻
   * @returns ずらす量（CSS px）
   */
  shake(now: number): Point2D { // audit-ignore: fnlog-missing 毎フレーム描画
    const at = this.shakeAt;
    if (at === undefined || now < at) return { x: 0, y: 0 };
    const k = (now - at) / SHAKE_MS;
    if (k >= 1) {
      this.shakeAt = undefined;
      return { x: 0, y: 0 };
    }
    const amp = SHAKE_PX * (1 - k) ** 2;
    return { x: Math.sin(k * 38) * amp, y: Math.cos(k * 31) * amp * 0.6 };
  }

  /**
   * 足もとの演出（土ぼこり・到着の輪）を描く。スポットより下に描く。
   * @param ctx 2D コンテキスト
   * @param project 緯度経度 → 画面座標
   * @param now 現在時刻
   * @sideEffect canvas に描く。終わった演出を捨てる
   */
  drawUnder(ctx: CanvasRenderingContext2D, project: (ll: LatLng) => Point2D, now: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    this.prune(now);
    for (const e of this.effects) {
      const k = (now - e.startedAt) / EFFECT_MS[e.kind];
      if (k < 0) continue;
      if (e.kind === 'dust') drawDust(ctx, project(e.at), k, e.seed);
      else if (e.kind === 'arrive') drawArrive(ctx, project(e.at), k);
    }
  }

  /**
   * 上に重ねる演出（スタンプ・紙吹雪・コイン・発見・花火・ポイント）を描く。スポット・人より上に描く。
   * @param ctx 2D コンテキスト
   * @param project 緯度経度 → 画面座標
   * @param now 現在時刻
   * @param textScale 文字の拡大率
   * @sideEffect canvas に描く
   */
  drawOver(ctx: CanvasRenderingContext2D, project: (ll: LatLng) => Point2D, now: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const calm = reducedMotion();
    for (const e of this.effects) {
      const elapsed = now - e.startedAt;
      if (elapsed < 0) continue;
      const k = elapsed / EFFECT_MS[e.kind];
      const p = project(e.at);
      if (e.kind === 'checkin') drawCheckIn(ctx, p, elapsed, e.seed, calm, textScale, e.text);
      else if (e.kind === 'points') drawPoints(ctx, p, k, e.text ?? '', textScale);
      else if (e.kind === 'coins' && e.target !== undefined) drawCoins(ctx, p, e.target, k, e.seed);
      else if (e.kind === 'discover') drawDiscover(ctx, p, k, elapsed, e.seed, textScale);
      else if (e.kind === 'levelup') drawLevelUp(ctx, p, k, elapsed, e.seed, e.text ?? '', textScale, calm);
    }
  }

  /**
   * 終わった演出を捨てる。
   * @param now 現在時刻
   * @sideEffect 演出の一覧を減らす
   */
  private prune(now: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    if (this.effects.length === 0) return;
    this.effects = this.effects.filter((e) => now - e.startedAt < EFFECT_MS[e.kind]);
  }
}

/**
 * 土ぼこり（小さな丸が3つ広がって消える）。
 * @param ctx 2D コンテキスト
 * @param p 足もと
 * @param k 進み 0..1
 * @param seed 種
 * @sideEffect canvas に描く
 */
function drawDust(ctx: CanvasRenderingContext2D, p: Point2D, k: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const rnd = createSeededRandom(seed);
  ctx.save();
  ctx.globalAlpha = 0.45 * (1 - k);
  ctx.fillStyle = '#d8cfbd';
  for (let i = 0; i < 3; i++) {
    const dx = (rnd() - 0.5) * 14 * (0.4 + k);
    const dy = -2 - rnd() * 4 * k;
    ctx.beginPath();
    ctx.arc(p.x + dx, p.y + dy, 2 + k * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 到着の輪（足もとに2重の輪が広がる）。
 * @param ctx 2D コンテキスト
 * @param p 足もと
 * @param k 進み 0..1
 * @sideEffect canvas に描く
 */
function drawArrive(ctx: CanvasRenderingContext2D, p: Point2D, k: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  for (const lag of [0, 0.25]) {
    const q = Math.max(0, (k - lag) / (1 - lag));
    if (q <= 0) continue;
    ctx.globalAlpha = 0.8 * (1 - q);
    ctx.strokeStyle = VERMILION;
    ctx.lineWidth = 3 * (1 - q) + 1;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 8 + q * 26, (8 + q * 26) * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * チェックインの演出（衝撃波・紙吹雪・きらめき・スタンプ）。
 * @param ctx 2D コンテキスト
 * @param p お店の足もと
 * @param elapsed 経過（ミリ秒）
 * @param seed 種
 * @param calm 動きを減らすか
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawCheckIn(ctx: CanvasRenderingContext2D, p: Point2D, elapsed: number, seed: number, calm: boolean, textScale: number, text?: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const center = { x: p.x, y: p.y - 34 };
  const afterImpact = elapsed - STAMP_IMPACT_MS;
  if (afterImpact >= 0) {
    drawShockwave(ctx, center, afterImpact / 650);
    if (!calm) drawConfetti(ctx, center, afterImpact, seed);
    drawSparkles(ctx, center, afterImpact / 900, seed);
  }
  drawStamp(ctx, center, elapsed, textScale, text);
}

/**
 * 衝撃波（白と朱の輪が広がる）。
 * @param ctx 2D コンテキスト
 * @param c 中心
 * @param k 進み 0..1
 * @sideEffect canvas に描く
 */
function drawShockwave(ctx: CanvasRenderingContext2D, c: Point2D, k: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (k >= 1) return;
  const e = easeOutCubic(k);
  ctx.save();
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10 * (1 - k) + 2;
  ctx.beginPath();
  ctx.arc(c.x, c.y, 20 + e * 90, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = VERMILION;
  ctx.lineWidth = 3 * (1 - k) + 1;
  ctx.beginPath();
  ctx.arc(c.x, c.y, 16 + e * 74, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * 紙吹雪（上へはじけて、くるくる回りながら落ちる）。
 * @param ctx 2D コンテキスト
 * @param c 出どころ
 * @param elapsed スタンプが押されてからの時間（ミリ秒）
 * @param seed 種
 * @sideEffect canvas に描く
 */
function drawConfetti(ctx: CanvasRenderingContext2D, c: Point2D, elapsed: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const life = EFFECT_MS.checkin - STAMP_IMPACT_MS;
  if (elapsed > life) return;
  const rnd = createSeededRandom(seed);
  const t = elapsed / 1000;
  ctx.save();
  for (let i = 0; i < 56; i++) {
    const angle = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.5;
    const speed = 150 + rnd() * 220;
    const spin = (rnd() - 0.5) * 18;
    const color = CONFETTI_COLORS[Math.floor(rnd() * CONFETTI_COLORS.length)] ?? VERMILION;
    const x = c.x + Math.cos(angle) * speed * t;
    const y = c.y + Math.sin(angle) * speed * t + 0.5 * 520 * t * t;
    const w = 5 + rnd() * 5;
    ctx.globalAlpha = Math.max(0, 1 - elapsed / life) ** 0.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin * t);
    ctx.scale(1, Math.abs(Math.cos(spin * t * 0.7)) * 0.8 + 0.2);
    ctx.fillStyle = color;
    ctx.fillRect(-w / 2, -w * 0.3, w, w * 0.6);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * きらめき（4方向に光る星が、まわりで順に瞬く）。
 * @param ctx 2D コンテキスト
 * @param c 中心
 * @param k 進み 0..1
 * @param seed 種
 * @sideEffect canvas に描く
 */
function drawSparkles(ctx: CanvasRenderingContext2D, c: Point2D, k: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (k >= 1) return;
  const rnd = createSeededRandom(seed ^ 0x5bd1);
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 30 + rnd() * 50;
    const delay = rnd() * 0.5;
    const q = (k - delay) / 0.5;
    if (q <= 0 || q >= 1) continue;
    const size = Math.sin(q * Math.PI) * (5 + rnd() * 5);
    drawStar(ctx, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.8, size, i % 3 === 0 ? '#ffffff' : '#ffd84d');
  }
  ctx.restore();
}

/**
 * 4方向の光の星を1つ描く。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param s 大きさ
 * @param color 色
 * @sideEffect canvas に描く
 */
function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (s <= 0.2) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
}

/**
 * 朱のスタンプ（大きく現れて「ドン」と押され、少し残って上へ消える）。
 * @param ctx 2D コンテキスト
 * @param c 中心
 * @param elapsed 経過（ミリ秒）
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawStamp(ctx: CanvasRenderingContext2D, c: Point2D, elapsed: number, textScale: number, text?: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const total = EFFECT_MS.checkin;
  const fadeFrom = total - 450;
  const scale = elapsed < STAMP_IMPACT_MS ? 2.4 - 1.4 * easeOutCubic(elapsed / STAMP_IMPACT_MS) : 1 + 0.06 * Math.max(0, 1 - (elapsed - STAMP_IMPACT_MS) / 160);
  const alpha = elapsed < STAMP_IMPACT_MS ? elapsed / STAMP_IMPACT_MS : elapsed > fadeFrom ? Math.max(0, 1 - (elapsed - fadeFrom) / 450) : 1;
  const rise = elapsed > fadeFrom ? ((elapsed - fadeFrom) / 450) * 18 : 0;
  const r = 34;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(c.x, c.y - rise);
  ctx.rotate(-0.16);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = VERMILION;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r - 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = VERMILION;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = canvasFont(13, 800, textScale);
  // 文字は「上の行|下の行」（既定はチェックイン。購入は「お買い|上げ！」など）
  const [top, bottom] = (text ?? 'チェック|イン！').split('|');
  ctx.fillText(top ?? '', 0, bottom === undefined ? 1 : -7);
  if (bottom !== undefined) ctx.fillText(bottom, 0, 9);
  ctx.restore();
}

/**
 * 「+n pt」がふわっと浮かんで消える。
 * @param ctx 2D コンテキスト
 * @param p 足もと
 * @param k 進み 0..1
 * @param text 文字
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawPoints(ctx: CanvasRenderingContext2D, p: Point2D, k: number, text: string, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (text === '' || k >= 1) return;
  const pop = easeOutBack(Math.min(1, k / 0.25));
  ctx.save();
  ctx.globalAlpha = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
  ctx.translate(p.x + 46, p.y - 104 - easeOutCubic(k) * 26);
  ctx.scale(pop, pop);
  ctx.font = canvasFont(17, 800, textScale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = '#f0a500';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * コインがお店から陣地の札へ弧を描いて飛ぶ。
 * @param ctx 2D コンテキスト
 * @param from お店の足もと
 * @param to 飛ぶ先
 * @param k 進み 0..1
 * @param seed 種
 * @sideEffect canvas に描く
 */
function drawCoins(ctx: CanvasRenderingContext2D, from: Point2D, to: Point2D, k: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const rnd = createSeededRandom(seed);
  ctx.save();
  for (let i = 0; i < 7; i++) {
    const delay = i * 0.06;
    const q = (k - delay) / (1 - 0.42);
    if (q <= 0 || q >= 1) continue;
    const e = easeOutCubic(q) ** 1.4;
    const lift = 60 + rnd() * 50;
    const sx = from.x + (rnd() - 0.5) * 30;
    const sy = from.y - 30;
    const x = sx + (to.x - sx) * e;
    const y = sy + (to.y - sy) * e - Math.sin(e * Math.PI) * lift;
    const flip = Math.abs(Math.cos((q + i) * 9));
    ctx.globalAlpha = q > 0.85 ? (1 - q) / 0.15 : 1;
    ctx.fillStyle = '#c98a00';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, 6 * flip + 1, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.ellipse(x, y, 5.5 * flip + 0.8, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3b0';
    ctx.fillRect(x - flip * 2, y - 3, Math.max(1, flip * 2), 2);
  }
  ctx.restore();
}

/**
 * 発見の演出（回る光の筋・はねる「発見！」の札）。
 * @param ctx 2D コンテキスト
 * @param p スポットの足もと
 * @param k 進み 0..1
 * @param elapsed 経過（ミリ秒）
 * @param seed 種
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawDiscover(ctx: CanvasRenderingContext2D, p: Point2D, k: number, elapsed: number, seed: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (k >= 1) return;
  const c = { x: p.x, y: p.y - 30 };
  const fade = k < 0.75 ? 1 : (1 - k) / 0.25;
  ctx.save();
  ctx.globalAlpha = 0.55 * fade;
  ctx.translate(c.x, c.y);
  ctx.rotate(elapsed / 900);
  const rays = 10;
  const len = 34 + easeOutCubic(Math.min(1, k * 3)) * 26;
  for (let i = 0; i < rays; i++) {
    ctx.rotate((Math.PI * 2) / rays);
    const grad = ctx.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, 'rgba(255,230,120,0.95)');
    grad.addColorStop(1, 'rgba(255,230,120,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, -5);
    ctx.lineTo(len, 5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  drawSparkles(ctx, c, k, seed);
  const pop = easeOutBack(Math.min(1, k / 0.22));
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(c.x, c.y - 44);
  ctx.scale(pop, pop);
  ctx.font = canvasFont(13, 800, textScale);
  const w = ctx.measureText('発見！').width + 18;
  ctx.fillStyle = '#ffb400';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -12, w, 24, 12);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('発見！', 0, 1);
  ctx.restore();
}

/**
 * 地区の成長の花火（3発が少しずつずれて開き、「Lvn」がはねる）。
 * @param ctx 2D コンテキスト
 * @param p 地区の札の位置
 * @param k 進み 0..1
 * @param elapsed 経過（ミリ秒）
 * @param seed 種
 * @param text 「Lv3」など
 * @param textScale 文字の拡大率
 * @param calm 動きを減らすか
 * @sideEffect canvas に描く
 */
function drawLevelUp(ctx: CanvasRenderingContext2D, p: Point2D, k: number, elapsed: number, seed: number, text: string, textScale: number, calm: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (k >= 1) return;
  const rnd = createSeededRandom(seed);
  if (!calm) {
    for (let burst = 0; burst < 3; burst++) {
      const start = burst * 320;
      const bx = p.x + (rnd() - 0.5) * 120;
      const by = p.y - 50 - rnd() * 50;
      const color = CONFETTI_COLORS[Math.floor(rnd() * 5)] ?? VERMILION;
      const q = (elapsed - start) / 1100;
      if (q <= 0 || q >= 1) continue;
      ctx.save();
      ctx.globalAlpha = 1 - q;
      ctx.fillStyle = color;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = easeOutCubic(q) * 42;
        ctx.beginPath();
        ctx.arc(bx + Math.cos(a) * r, by + Math.sin(a) * r + q * q * 14, 2.4 * (1 - q) + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  if (text === '') return;
  const pop = easeOutBack(Math.min(1, k / 0.18));
  ctx.save();
  ctx.globalAlpha = k < 0.8 ? 1 : (1 - k) / 0.2;
  ctx.translate(p.x, p.y - 34);
  ctx.scale(pop, pop);
  ctx.font = canvasFont(15, 800, textScale);
  const w = ctx.measureText(text).width + 22;
  ctx.fillStyle = VERMILION;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -14, w, 28, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 1);
  ctx.restore();
}
