/**
 * @file ステージのキラキラ演出（presentation/screens/Avatar 層。Canvas 描画の純粋関数）
 * デザイン仕様（キラキラ系アバターデザイナー §3）に合わせた、背景の上・アバターの下の演出と、着替えたときの「キラッ」。
 * - 光のボケ7個／漂うグリッター14個（4点星8・ハート3・点3）
 * - 頭上からのスポットライト／4層の台座（外光・円盤・グラデの縁・縁を回る白い点）
 * - 「キラッ」: 光の円・放射する粒・十字星。SSR は虹の輪・光の柱・降る粉を足す
 * 粒の位置・大きさは番号から決まる（乱数・時刻は使わない＝同じ t なら同じ絵）。t は経過秒、unit はアバターの拡大率（約 2.5）。
 */

/** レア度 */
export type SparkleRarity = 'N' | 'R' | 'SR' | 'SSR';

/** 色（デザイン仕様の値） */
const COLORS = {
  bokeh: ['#FFB6D9', '#C4B5FD', '#A5F3FC', '#FFE58A'],
  glitter: ['#FFFFFF', '#FFD6EC', '#FFE58A', '#D9C8FF', '#BDEBFF'],
  heart: '#FF8FC2',
  rim: ['#FF9AC8', '#C9A2FF', '#9ADFFF'],
  rainbow: ['#FF6FB5', '#FFC94D', '#7CE38B', '#5CC8FF', '#A98BFF'],
  burst: { N: ['#FFFFFF', '#FFD6EC'], R: ['#7DD3FC', '#FFFFFF'], SR: ['#C084FC', '#FFFFFF'], SSR: ['#FF6FB5', '#FFC94D', '#7CE38B', '#5CC8FF', '#A98BFF'] },
} as const;

/** 「キラッ」の長さ（秒） */
const BURST_SEC = 0.65;
const BURST_SSR_SEC = 1.2;

/** 着替えたときの「キラッ」 */
export interface SparkleBurst {
  /** 始まった経過秒 */
  readonly start: number;
  /** 頭の中心（CSS px） */
  readonly x: number;
  readonly y: number;
  /** 足元（SSR の虹の輪） */
  readonly footY: number;
  readonly rarity: SparkleRarity;
}

/**
 * 番号から 0〜1 の決まった値を作る（乱数の代わり）。
 * @param i 番号
 * @param salt 種
 * @returns 0 以上 1 未満
 */
function hash01(i: number, salt: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で粒ごとに呼ぶ純粋な算術
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * 番号の色を選ぶ。
 * @param list 色の並び
 * @param i 番号
 * @returns 色
 */
function pick(list: readonly string[], i: number): string { // audit-ignore: fnlog-missing 毎フレーム描画で粒ごとに呼ぶ
  return list[i % list.length] ?? '#FFFFFF';
}

/**
 * 4つの角のきらめき（4点星）を塗る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 大きさ
 * @param color 色
 */
export function paintTwinkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const k = r * 0.24;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + k, y - k); ctx.lineTo(x + r, y); ctx.lineTo(x + k, y + k);
  ctx.lineTo(x, y + r); ctx.lineTo(x - k, y + k); ctx.lineTo(x - r, y); ctx.lineTo(x - k, y - k);
  ctx.closePath();
  ctx.fill();
}

/**
 * ハートを塗る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 大きさ
 * @param color 色
 */
export function paintHeart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.3, y - r * 0.1, x - r * 0.6, y - r * 1.1, x, y - r * 0.4);
  ctx.bezierCurveTo(x + r * 0.6, y - r * 1.1, x + r * 1.3, y - r * 0.1, x, y + r * 0.9);
  ctx.fill();
}

/**
 * 光のボケ（7個、ゆっくり上へ漂い、透明度が揺れる）を描く。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function paintBokeh(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < 7; i += 1) {
    const r = 12 + hash01(i, 3) * 18;
    const x = hash01(i, 1) * w;
    const y = (((hash01(i, 2) * (h + 2 * r) - t * 4) % (h + 2 * r)) + h + 2 * r) % (h + 2 * r) - r;
    const a = 0.32 + 0.08 * Math.sin((t * Math.PI * 2) / 4 + i);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, pick(COLORS.bokeh, i)); g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * 漂うグリッター（4点星8・ハート3・点3。上へのぼり、横に揺れ、明滅する）を描く。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒（0 なら止まった絵）
 */
function paintFloaters(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < 14; i += 1) {
    const speed = 10 + hash01(i, 4) * 8;
    const y = (((hash01(i, 5) * h - t * speed) % h) + h) % h;
    const x = hash01(i, 6) * w + Math.sin((t * Math.PI * 2) / 3 + i * 1.7) * 6;
    const period = 1.4 + hash01(i, 7) * 0.8;
    const s = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((t * Math.PI * 2) / period + i * 2.1));
    const size = 3 + hash01(i, 8) * 5;
    ctx.globalAlpha = 0.5 + 0.5 * s;
    if (i < 8) paintTwinkle(ctx, x, y, size * s, pick(COLORS.glitter, i));
    else if (i < 11) paintHeart(ctx, x, y, size * 0.8 * s, COLORS.heart);
    else { ctx.fillStyle = pick(COLORS.glitter, i); ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}

/**
 * 光のボケとグリッターを描く（背景の上・アバターの下）。
 * @param ctx 描画先
 * @param w 幅（CSS px）
 * @param h 高さ（CSS px）
 * @param t 経過秒（0 なら止まった絵）
 */
export function paintGlitter(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  paintBokeh(ctx, w, h, t);
  paintFloaters(ctx, w, h, t);
  ctx.restore();
}

/**
 * 頭上からのスポットライト（台形の光。ゆっくり揺れる）を描く。
 * @param ctx 描画先
 * @param x 足元の X
 * @param y 足元の Y
 * @param unit アバターの拡大率
 * @param t 経過秒
 */
function paintBeam(ctx: CanvasRenderingContext2D, x: number, y: number, unit: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const sway = Math.sin((t * Math.PI * 2) / 6) * 4;
  const top = y - 92 * unit;
  const g = ctx.createLinearGradient(0, top, 0, y);
  g.addColorStop(0, 'rgba(255, 255, 255, 0)'); g.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x + sway - 7 * unit, top); ctx.lineTo(x + sway + 7 * unit, top); ctx.lineTo(x + 32 * unit, y); ctx.lineTo(x - 32 * unit, y);
  ctx.closePath(); ctx.fill();
}

/**
 * 4層の台座（外光・円盤・グラデの縁・縁を回る白い点）を描く。
 * @param ctx 描画先
 * @param x 足元の X
 * @param y 足元の Y
 * @param unit アバターの拡大率
 * @param t 経過秒
 */
function paintPedestal(ctx: CanvasRenderingContext2D, x: number, y: number, unit: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 32 * unit);
  glow.addColorStop(0, 'rgba(255, 182, 217, 0.55)'); glow.addColorStop(1, 'rgba(255, 182, 217, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.ellipse(x, y, 32 * unit, 8 * unit, 0, 0, Math.PI * 2); ctx.fill();
  const rx = 23 * unit;
  const ry = 5.2 * unit;
  const disc = ctx.createLinearGradient(0, y - ry, 0, y + ry);
  disc.addColorStop(0, '#FFFFFF'); disc.addColorStop(1, '#FFE6F3');
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  const rim = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
  COLORS.rim.forEach((c, i) => rim.addColorStop(i / (COLORS.rim.length - 1), c));
  ctx.strokeStyle = rim; ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < 8; i += 1) {
    const a = (t * Math.PI * 2) / 6 + (i * Math.PI * 2) / 8;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * rx, y + Math.sin(a) * ry, 1.6, 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * スポットライトと台座を描く（アバターの下）。
 * @param ctx 描画先
 * @param x 足元の X
 * @param y 足元の Y
 * @param unit アバターの拡大率
 * @param t 経過秒
 */
export function paintSpotlight(ctx: CanvasRenderingContext2D, x: number, y: number, unit: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  paintBeam(ctx, x, y, unit, t);
  paintPedestal(ctx, x, y, unit, t);
  ctx.restore();
}

/**
 * SSR を身につけているときの、アバターのまわりで交互に点滅する星2つ。
 * @param ctx 描画先
 * @param x 足元の X
 * @param y 足元の Y
 * @param unit アバターの拡大率
 * @param t 経過秒
 */
export function paintSsrTwinkles(ctx: CanvasRenderingContext2D, x: number, y: number, unit: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  const phase = (t % 1.8) / 1.8;
  const a = Math.sin(phase * Math.PI);
  const b = Math.sin(((phase + 0.5) % 1) * Math.PI);
  paintTwinkle(ctx, x + 14 * unit, y - 66 * unit, 1.6 * unit * (0.4 + 0.6 * a), '#FFE58A');
  paintTwinkle(ctx, x - 16 * unit, y - 24 * unit, 1.6 * unit * (0.4 + 0.6 * b), '#FFFFFF');
  ctx.restore();
}

/**
 * 放射する粒（4点星とハート。減速・回転・縮小）を描く。
 * @param ctx 描画先
 * @param burst キラッ
 * @param e 始まってからの秒
 */
function paintBurstParticles(ctx: CanvasRenderingContext2D, burst: SparkleBurst, e: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const p = Math.min(1, e / BURST_SEC);
  if (p >= 1) return;
  const n = burst.rarity === 'SSR' ? 24 : 12;
  const colors = COLORS.burst[burst.rarity];
  for (let i = 0; i < n; i += 1) {
    const a = (i * Math.PI * 2) / n + hash01(i, 9) * 0.5;
    const v = 120 + hash01(i, 10) * 60;
    const d = v * BURST_SEC * (1 - (1 - p) * (1 - p)) * 0.55;
    const x = burst.x + Math.cos(a) * d;
    const y = burst.y + Math.sin(a) * d;
    const r = (i % 3 === 2 ? 5 : 6) * (1 - p * 0.7);
    ctx.globalAlpha = 1 - p;
    ctx.save(); ctx.translate(x, y); ctx.rotate(p * 2 + i);
    if (i % 3 === 2) paintHeart(ctx, 0, 0, r, COLORS.heart); else paintTwinkle(ctx, 0, 0, r * 1.3, pick(colors, i));
    ctx.restore();
  }
}

/**
 * 光の円（0〜250ms）と、頭の右上の大きな十字星（0〜400ms）を描く。
 * @param ctx 描画先
 * @param burst キラッ
 * @param e 始まってからの秒
 */
function paintBurstFlash(ctx: CanvasRenderingContext2D, burst: SparkleBurst, e: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (e < 0.25) {
    const p = e / 0.25;
    ctx.globalAlpha = 0.8 * (1 - p);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(burst.x, burst.y, 70 * p, 0, Math.PI * 2); ctx.fill();
  }
  if (e < 0.4) {
    const p = e / 0.4;
    ctx.globalAlpha = Math.sin(p * Math.PI);
    ctx.save(); ctx.translate(burst.x + 26, burst.y - 22); ctx.rotate((p * Math.PI) / 4);
    paintTwinkle(ctx, 0, 0, 22 * Math.sin(p * Math.PI), '#FFFFFF');
    ctx.restore();
  }
}

/**
 * SSR の追加演出（虹の輪・光の柱・降る金と虹の粉）を描く。
 * @param ctx 描画先
 * @param burst キラッ
 * @param e 始まってからの秒
 */
function paintSsrExtra(ctx: CanvasRenderingContext2D, burst: SparkleBurst, e: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (e < 0.9) {
    ctx.globalAlpha = 0.5 * Math.sin((e / 0.9) * Math.PI);
    const g = ctx.createLinearGradient(0, burst.footY - 220, 0, burst.footY);
    g.addColorStop(0, 'rgba(255, 255, 255, 0)'); g.addColorStop(1, '#FFFFFF');
    ctx.fillStyle = g;
    ctx.fillRect(burst.x - 35, burst.footY - 220, 70, 220);
  }
  if (e < 0.7) {
    const p = e / 0.7;
    ctx.globalAlpha = 1 - p;
    ctx.lineWidth = 3;
    COLORS.rainbow.forEach((c, i) => {
      ctx.strokeStyle = c;
      ctx.beginPath(); ctx.ellipse(burst.x, burst.footY, 20 + 90 * p + i * 3, (20 + 90 * p + i * 3) * 0.25, 0, 0, Math.PI * 2); ctx.stroke();
    });
  }
  for (let i = 0; i < 20; i += 1) {
    const p = e / BURST_SSR_SEC;
    ctx.globalAlpha = 1 - p;
    paintTwinkle(ctx, burst.x + (hash01(i, 11) - 0.5) * 220, burst.footY - 230 + p * 200 + hash01(i, 12) * 60, 2.5, i % 2 === 0 ? '#FFC94D' : pick(COLORS.rainbow, i));
  }
}

/**
 * 着替えたときの「キラッ」を描く（終わっていれば何もしない）。
 * @param ctx 描画先
 * @param burst キラッ
 * @param t 経過秒
 * @returns まだ続いていれば true
 */
export function paintBurst(ctx: CanvasRenderingContext2D, burst: SparkleBurst, t: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
  const e = t - burst.start;
  const life = burst.rarity === 'SSR' ? BURST_SSR_SEC : BURST_SEC;
  if (e < 0 || e >= life) return false;
  ctx.save();
  if (burst.rarity === 'SSR') paintSsrExtra(ctx, burst, e);
  paintBurstFlash(ctx, burst, e);
  paintBurstParticles(ctx, burst, e);
  ctx.restore();
  return true;
}
