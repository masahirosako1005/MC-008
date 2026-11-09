/**
 * @file 気持ちいいチェックインの演出（presentation/screens/Map/town 層。毎フレーム描く）
 * 2026-11-09 ユーザー指示「チェックインをもっと快感ある気持ちいいチェックインにしてほしい」。
 * ため（ピンが縮む）→ 衝撃（ピンが伸びて弾み、画面が白く光る・星がはじける）→ ごほうび（上から帯が降りて EXP・領地のマス・連続を数え上げる）。
 * スタンプ・紙吹雪・コインは mapEffects、音は mapSound、揺れは MapEffects.shake。色はブランドの色（PALETTE）。座標はログに出さない。
 */
import { createLogger } from '@/Common/logging/logger';
import { canvasFont } from '@/Common/ui/canvas/drawUtils';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { createSeededRandom, hashString } from '@/Common/ui/canvas/seededHash';
import { PALETTE } from '@/Common/ui/theme/palette';
import type { LatLng, Viewport } from '@/presentation/screens/Map/MapViewModel';

const logger = createLogger('presentation/screens/Map/town/checkinShow');

/** スタンプが押される瞬間（ミリ秒。mapEffects の STAMP_IMPACT_MS と同じ） */
export const IMPACT_MS = 170;
/** ピンの弾みが落ち着くまで（ミリ秒） */
const BOUNCE_MS = 900;
/** 白い光の長さ（ミリ秒） */
const FLASH_MS = 180;
/** 星がはじける長さ（ミリ秒） */
const BURST_MS = 850;
/** 帯が出ている長さ（ミリ秒） */
export const BANNER_MS = 2600;
/** 帯が降りる・上がる時間（ミリ秒） */
const BANNER_SLIDE_MS = 280;

/** 帯に出す内容 */
export interface BannerContent {
  /** 帯の見出し（既定「クエスト達成！」） */
  readonly title?: string;
  /** 見出しの下の1行（購入のときの「お買い物スタンプ n個目」など。exp が 0 のとき EXP の代わりに出す） */
  readonly note?: string;
  readonly exp: number;
  readonly gained: number;
  /** 今日何軒目か（2以上で「n軒目！」） */
  readonly combo: number;
  /** 地区が育ったとき（例「南森町 Lv3」） */
  readonly levelUp?: string;
}

/**
 * 0..1 の進みを、勢いよく出て止まる形にする。
 * @param k 進み
 * @returns なめらかにした進み
 */
function easeOutCubic(k: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const c = Math.min(1, Math.max(0, k));
  return 1 - (1 - c) ** 3;
}

/**
 * はねる形（少し行き過ぎて戻る）。
 * @param k 進み
 * @returns なめらかにした進み
 */
function easeOutBack(k: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const c = Math.min(1, Math.max(0, k));
  const s = 1.9;
  return 1 + (s + 1) * (c - 1) ** 3 + s * (c - 1) ** 2;
}

/**
 * ピンの伸び縮み（ため → 伸び → 着地の潰れ → ばねで戻る）。
 * @param elapsed チェックインを押してからの時間（ミリ秒）
 * @returns 横・縦の倍率
 */
export function pinSquash(elapsed: number): readonly [number, number] { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  if (elapsed < 0 || elapsed > BOUNCE_MS) return [1, 1];
  if (elapsed < 110) {
    const k = elapsed / 110;
    return [1 + 0.16 * k, 1 - 0.16 * k];
  }
  if (elapsed < IMPACT_MS) {
    const k = (elapsed - 110) / (IMPACT_MS - 110);
    return [1.16 - 0.28 * k, 0.84 + 0.4 * k];
  }
  const k = (elapsed - IMPACT_MS) / (BOUNCE_MS - IMPACT_MS);
  const wobble = Math.exp(-k * 5) * Math.cos(k * 18);
  return [1 + 0.22 * wobble, 1 - 0.22 * wobble];
}

/** 演出の状態 */
interface Shot {
  readonly spotId: string;
  readonly at: LatLng;
  readonly startedAt: number;
  readonly seed: number;
}

/** チェックインの演出（ピンの弾み・光・星・帯） */
export class CheckInShow {
  private shot: Shot | undefined;
  private banner: { readonly content: BannerContent; readonly startedAt: number } | undefined;

  /**
   * チェックインを押した瞬間に始める（ため → 衝撃）。
   * @param spotId お店
   * @param at お店の位置
   * @param now 押した時刻
   * @sideEffect 演出を始める
   */
  start(spotId: string, at: LatLng, now: number): void {
    const log = logger.fn('start', { spotId });
    this.shot = { spotId, at, startedAt: now, seed: hashString(`${spotId}:${Math.round(now)}`) };
    log.exit(undefined);
  }

  /**
   * ごほうびの帯を出す。
   * @param content 帯に出す内容
   * @param now 出し始める時刻
   * @sideEffect 帯を出す
   */
  showBanner(content: BannerContent, now: number): void {
    const log = logger.fn('showBanner', { exp: content.exp, gained: content.gained, combo: content.combo });
    this.banner = { content, startedAt: now };
    log.exit(undefined);
  }

  /**
   * 演出が続いているか。
   * @param now 現在時刻
   * @returns 続いていれば true
   */
  active(now: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
    const shotOn = this.shot !== undefined && now - this.shot.startedAt < Math.max(BOUNCE_MS, IMPACT_MS + BURST_MS);
    const bannerOn = this.banner !== undefined && now - this.banner.startedAt < BANNER_MS;
    if (!shotOn) this.shot = undefined;
    if (!bannerOn) this.banner = undefined;
    return shotOn || bannerOn;
  }

  /**
   * お店のピンの伸び縮み（townScene の写真ピンに掛ける）。
   * @param spotId お店
   * @param now 現在時刻
   * @returns 横・縦の倍率（演出中でなければ 1, 1）
   */
  pinScale(spotId: string, now: number): readonly [number, number] { // audit-ignore: fnlog-missing 毎フレーム描画
    const shot = this.shot;
    if (shot === undefined || shot.spotId !== spotId) return [1, 1];
    return pinSquash(now - shot.startedAt);
  }

  /**
   * 地図に貼りつく演出（光の輪・はじける星）を描く。スポットより上、人より下に描く。
   * @param ctx 2D コンテキスト
   * @param project 緯度経度 → 画面座標
   * @param now 現在時刻
   * @sideEffect canvas に描く
   */
  drawOnMap(ctx: CanvasRenderingContext2D, project: (ll: LatLng) => Point2D, now: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const shot = this.shot;
    if (shot === undefined) return;
    const after = now - shot.startedAt - IMPACT_MS;
    const p = project(shot.at);
    const c = { x: p.x, y: p.y - 34 };
    if (after < 0) {
      // ため: ピンのまわりに光が集まる
      const k = (now - shot.startedAt) / IMPACT_MS;
      ctx.save();
      ctx.globalAlpha = 0.5 * k;
      ctx.strokeStyle = PALETTE.glow;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 54 - 30 * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (after < BURST_MS) drawStarBurst(ctx, c, after / BURST_MS, shot.seed);
  }

  /**
   * 画面に重ねる演出（白い光・ごほうびの帯）を描く。いちばん上に描く。
   * @param ctx 2D コンテキスト
   * @param vp 描画領域
   * @param now 現在時刻
   * @param textScale 文字の拡大率
   * @sideEffect canvas に描く
   */
  drawOnScreen(ctx: CanvasRenderingContext2D, vp: Viewport, now: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const shot = this.shot;
    if (shot !== undefined) {
      const after = now - shot.startedAt - IMPACT_MS;
      if (after >= 0 && after < FLASH_MS) {
        ctx.save();
        ctx.globalAlpha = 0.55 * (1 - after / FLASH_MS);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, vp.width, vp.height);
        ctx.restore();
      }
    }
    const banner = this.banner;
    if (banner !== undefined) drawBanner(ctx, vp, banner.content, now - banner.startedAt, textScale);
  }
}

/**
 * はじける星（大小の星が放射状に飛び、少し落ちながら回って消える）。
 * @param ctx 2D コンテキスト
 * @param c 中心
 * @param k 進み 0..1
 * @param seed 種
 * @sideEffect canvas に描く
 */
function drawStarBurst(ctx: CanvasRenderingContext2D, c: Point2D, k: number, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const rnd = createSeededRandom(seed);
  const e = easeOutCubic(k);
  ctx.save();
  // 光の輪
  ctx.globalAlpha = 0.6 * (1 - k);
  const ring = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 30 + e * 80);
  ring.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  ring.addColorStop(0.5, 'rgba(94, 224, 255, 0.35)');
  ring.addColorStop(1, 'rgba(94, 224, 255, 0)');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(c.x, c.y, 30 + e * 80, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.3;
    const dist = (50 + rnd() * 70) * e;
    const size = (4 + rnd() * 6) * (1 - k * 0.7);
    const x = c.x + Math.cos(a) * dist;
    const y = c.y + Math.sin(a) * dist + k * k * 26;
    ctx.globalAlpha = Math.max(0, 1 - k) ** 0.7;
    star(ctx, x, y, size, i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? PALETTE.gold : PALETTE.glow, k * 6 + i);
  }
  ctx.restore();
}

/**
 * 5つの角の星を描く。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param r 半径
 * @param color 色
 * @param rot 回転（ラジアン）
 * @sideEffect canvas に描く
 */
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, rot: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (r <= 0.3) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * ごほうびの帯（上から降りてきて、EXP・領地のマス・連続を数え上げ、少し置いて上へ戻る）。
 * @param ctx 2D コンテキスト
 * @param vp 描画領域
 * @param content 内容
 * @param age 出してからの時間（ミリ秒）
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawBanner(ctx: CanvasRenderingContext2D, vp: Viewport, content: BannerContent, age: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (age < 0 || age > BANNER_MS) return;
  const inK = easeOutBack(age / BANNER_SLIDE_MS);
  const outK = age > BANNER_MS - BANNER_SLIDE_MS ? easeOutCubic((age - (BANNER_MS - BANNER_SLIDE_MS)) / BANNER_SLIDE_MS) : 0;
  const lines = 1 + (content.gained > 0 ? 1 : 0) + (content.levelUp !== undefined ? 1 : 0);
  const w = Math.min(vp.width - 32, 290);
  const h = (58 + lines * 22) * textScale;
  const x = (vp.width - w) / 2;
  const y = 62 - (1 - inK) * (h + 70) - outK * (h + 80);
  ctx.save();
  ctx.fillStyle = 'rgba(11, 42, 102, 0.25)';
  ctx.beginPath();
  ctx.roundRect(x, y + 5, w, h, 18);
  ctx.fill();
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, PALETTE.brandBright);
  grad.addColorStop(1, PALETTE.brandDeep);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 18);
  ctx.fill();
  // 光が走る
  const sweep = ((age - 200) / 700) * (w + 80) - 40;
  if (sweep > -40 && sweep < w + 40) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.clip();
    const shine = ctx.createLinearGradient(x + sweep - 40, 0, x + sweep + 40, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0)');
    shine.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = canvasFont(21, 900, textScale);
  ctx.fillText(content.title ?? 'クエスト達成！', vp.width / 2, y + 24 * textScale);
  star(ctx, x + 22, y + 24 * textScale, 7, PALETTE.gold, age / 300);
  star(ctx, x + w - 22, y + 24 * textScale, 7, PALETTE.gold, -age / 300);
  drawBannerLines(ctx, vp, content, age, y + 52 * textScale, textScale);
  ctx.restore();
}

/**
 * 帯の下の段（EXP・領地・地区の成長・連続）を、数え上げながら描く。
 * @param ctx 2D コンテキスト
 * @param vp 描画領域
 * @param content 内容
 * @param age 出してからの時間（ミリ秒）
 * @param top 1段目の中心の高さ
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawBannerLines(ctx: CanvasRenderingContext2D, vp: Viewport, content: BannerContent, age: number, top: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  /**
   * 数え上げの途中の値（from ミリ秒から ms ミリ秒かけて 0 → value）。
   * @param value 最後の値
   * @param from 数え始める時刻（帯を出してからのミリ秒）
   * @param ms 数え上げる時間
   * @returns 途中の値
   */
  const count = (value: number, from: number, ms: number): number => Math.round(value * easeOutCubic((age - from) / ms)); // audit-ignore: fnlog-missing 数え上げの小さな計算
  const cx = vp.width / 2;
  let y = top;
  ctx.font = canvasFont(17, 900, textScale);
  ctx.fillStyle = PALETTE.gold;
  const exp = count(content.exp, 160, 520);
  const expText = content.exp <= 0 && content.note !== undefined ? content.note : `+${exp} EXP`;
  const pulse = age > 160 && age < 700 ? 1 + 0.08 * Math.sin(((age - 160) / 540) * Math.PI) : 1;
  ctx.save();
  ctx.translate(cx, y);
  ctx.scale(pulse, pulse);
  ctx.fillText(expText, content.combo >= 2 ? -34 : 0, 0);
  ctx.restore();
  if (content.combo >= 2 && age > 380) {
    const pop = easeOutBack((age - 380) / 260);
    ctx.save();
    ctx.translate(cx + 64, y);
    ctx.scale(pop, pop);
    ctx.font = canvasFont(11, 900, textScale);
    const label = `今日${content.combo}軒目！`;
    const lw = ctx.measureText(label).width + 14;
    ctx.fillStyle = PALETTE.gold;
    ctx.beginPath();
    ctx.roundRect(-lw / 2, -10, lw, 20, 10);
    ctx.fill();
    ctx.fillStyle = PALETTE.brandNight;
    ctx.fillText(label, 0, 1);
    ctx.restore();
  }
  ctx.font = canvasFont(13, 800, textScale);
  ctx.fillStyle = '#ffffff';
  if (content.gained > 0) {
    y += 22 * textScale;
    ctx.globalAlpha = Math.min(1, Math.max(0, (age - 450) / 200));
    ctx.fillText(`領地 +${count(content.gained, 450, 800).toLocaleString('ja-JP')}マス`, cx, y);
  }
  if (content.levelUp !== undefined) {
    y += 22 * textScale;
    ctx.globalAlpha = Math.min(1, Math.max(0, (age - 900) / 200));
    ctx.fillText(`${content.levelUp} に成長！`, cx, y);
  }
  ctx.globalAlpha = 1;
}

/**
 * 端末の「動きを減らす」設定か（帯・光を控えめにするかの判断に使う）。
 * @returns 減らすなら true
 */
export function prefersCalm(): boolean {
  const log = logger.fn('prefersCalm');
  return log.exit(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
