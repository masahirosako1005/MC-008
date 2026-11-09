/**
 * @file オーラ（アバターのまわりにまとう演出）（presentation/screens/Avatar 層。Canvas 描画の純粋関数）
 * 奥（back＝アバターの後ろ）と手前（front＝アバターの前）の2回に分けて描く。回るものは「奥にある半分」を back、「手前の半分」を front に描く。
 * 粒の位置・大きさは番号から決まる（乱数・時刻は使わない）。x, y は足元、unit はアバターの拡大率、t は経過秒（0 でも完成した絵）。
 */
import type { AuraStyle } from '@/presentation/shared/avatar/avatarLook';
import { paintNote } from '@/presentation/screens/Avatar/stageEmotes';
import { paintHeart, paintTwinkle } from '@/presentation/screens/Avatar/stageSparkle';

/** 奥か手前か */
export type AuraLayer = 'back' | 'front';

/** 描く場所 */
export interface AuraFrame {
  readonly x: number;
  readonly y: number;
  readonly unit: number;
  readonly t: number;
  readonly layer: AuraLayer;
}

/** 虹の色 */
const RAINBOW = ['#ff6fb5', '#ffc94d', '#7ce38b', '#5cc8ff', '#a98bff'];

/**
 * 番号から 0〜1 の決まった値を作る（乱数の代わり）。
 * @param i 番号
 * @param salt 種
 * @returns 0 以上 1 未満
 */
function hash01(i: number, salt: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で粒ごとに呼ぶ純粋な算術
  const v = Math.sin(i * 57.3 + salt * 197.1) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * やわらかい光（体の後ろ）を塗る。
 * @param ctx 描画先
 * @param f 描く場所
 * @param color 中心の色（rgba）
 */
function paintGlow(ctx: CanvasRenderingContext2D, f: AuraFrame, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const cx = f.x;
  const cy = f.y - 36 * f.unit;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 46 * f.unit);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, cy, 40 * f.unit, 48 * f.unit, 0, 0, Math.PI * 2); ctx.fill();
}

/**
 * 体のまわりを楕円で回る粒を描く（奥・手前で振り分ける）。
 * @param ctx 描画先
 * @param f 描く場所
 * @param n 数
 * @param paint 1つを描く関数（位置・大きさ・番号）
 */
function paintOrbit(ctx: CanvasRenderingContext2D, f: AuraFrame, n: number, paint: (x: number, y: number, s: number, i: number) => void): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < n; i += 1) {
    const a = f.t * 1.2 + (i * Math.PI * 2) / n;
    const front = Math.sin(a) > 0;
    if ((f.layer === 'front') !== front) continue;
    const yLift = (i % 3) * 14 + Math.sin(f.t * 2 + i) * 3;
    const s = (0.75 + 0.35 * Math.sin(a)) * f.unit;
    ctx.globalAlpha = front ? 1 : 0.7;
    paint(f.x + Math.cos(a) * 32 * f.unit, f.y - (20 + yLift) * f.unit + Math.sin(a) * 6 * f.unit, s, i);
  }
  ctx.globalAlpha = 1;
}

/**
 * まわりを漂う粒（降る・のぼる）を描く（番号の偶奇で奥・手前に振り分ける）。
 * @param ctx 描画先
 * @param f 描く場所
 * @param opts 数・向き（1 で降る、-1 でのぼる）・速さ
 * @param paint 1つを描く関数（位置・大きさ・番号・進み 0..1）
 */
function paintDrift(ctx: CanvasRenderingContext2D, f: AuraFrame, opts: { readonly n: number; readonly dir: 1 | -1; readonly speed: number }, paint: (x: number, y: number, s: number, i: number, p: number) => void): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < opts.n; i += 1) {
    if ((i % 2 === 0) !== (f.layer === 'front')) continue;
    const p = ((f.t * opts.speed + hash01(i, 1)) % 1);
    const yy = opts.dir === 1 ? -84 + p * 88 : -2 - p * 84;
    const x = f.x + (hash01(i, 2) - 0.5) * 84 * f.unit + Math.sin(p * Math.PI * 2 + i) * 5 * f.unit;
    ctx.globalAlpha = Math.sin(p * Math.PI);
    paint(x, f.y + yy * f.unit, (0.7 + hash01(i, 3) * 0.5) * f.unit, i, p);
  }
  ctx.globalAlpha = 1;
}

/**
 * 雪の結晶を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 大きさ
 * @param rot 回転
 */
function paintSnowflake(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, r * 0.22);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let k = 0; k < 6; k += 1) {
    const a = rot + (k * Math.PI) / 3;
    ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.stroke();
  ctx.fillStyle = '#bdebff';
  ctx.beginPath(); ctx.arc(x, y, r * 0.25, 0, Math.PI * 2); ctx.fill();
}

/**
 * ちょうちょを描く（羽ばたく）。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param s 大きさ
 * @param flap 羽の開き 0..1
 * @param color 羽の色
 */
function paintButterfly(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flap: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  for (const side of [-1, 1]) {
    ctx.save(); ctx.scale(side * (0.35 + 0.65 * flap), 1);
    ctx.beginPath(); ctx.ellipse(3 * s, -2.2 * s, 3.2 * s, 2.6 * s, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(2.4 * s, 2 * s, 2.2 * s, 1.8 * s, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#4a2350';
  ctx.fillRect(-0.4 * s, -3 * s, 0.8 * s, 6 * s);
  ctx.restore();
}

/**
 * 三日月を塗る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 大きさ
 */
function paintMoon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = '#ffe58a';
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI * 0.25, Math.PI * 1.75, false);
  ctx.arc(x + r * 0.55, y - r * 0.15, r * 0.82, Math.PI * 1.6, Math.PI * 0.4, true);
  ctx.closePath();
  ctx.fill();
}

/**
 * シャボン玉を描く（虹色のふちと光）。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 半径
 * @param i 番号（色）
 */
function paintBubble(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, i: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = RAINBOW[i % RAINBOW.length] ?? '#ffffff';
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2); ctx.fill();
}

/**
 * 足元からのぼる虹の輪（3本。奥の半分と手前の半分を分けて描く）。
 * @param ctx 描画先
 * @param f 描く場所
 */
function paintRainbowRings(ctx: CanvasRenderingContext2D, f: AuraFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let k = 0; k < 3; k += 1) {
    const p = ((f.t * 0.35 + k / 3) % 1);
    const rx = (28 - p * 6) * f.unit;
    const cy = f.y - p * 74 * f.unit;
    ctx.globalAlpha = Math.sin(p * Math.PI) * 0.9;
    ctx.lineWidth = 2.2;
    RAINBOW.forEach((c, i) => {
      ctx.strokeStyle = c;
      ctx.beginPath();
      if (f.layer === 'back') ctx.ellipse(f.x, cy, rx + i * 1.6, (rx + i * 1.6) * 0.22, 0, Math.PI, Math.PI * 2);
      else ctx.ellipse(f.x, cy, rx + i * 1.6, (rx + i * 1.6) * 0.22, 0, 0, Math.PI);
      ctx.stroke();
    });
  }
  ctx.globalAlpha = 1;
}

/** オーラごとの描き方 */
const AURA_PAINTERS: Readonly<Record<AuraStyle, (ctx: CanvasRenderingContext2D, f: AuraFrame) => void>> = {
  hearts: (ctx, f) => {
    if (f.layer === 'back') paintGlow(ctx, f, 'rgba(255, 143, 194, 0.35)');
    paintOrbit(ctx, f, 8, (x, y, s, i) => paintHeart(ctx, x, y, 4.2 * s, i % 2 === 0 ? '#ff5fa2' : '#ff9ac8'));
  },
  stars: (ctx, f) => {
    if (f.layer === 'back') paintGlow(ctx, f, 'rgba(255, 229, 138, 0.35)');
    paintOrbit(ctx, f, 9, (x, y, s, i) => paintTwinkle(ctx, x, y, (3.5 + (i % 3)) * s, i % 2 === 0 ? '#ffc94d' : '#ffffff'));
  },
  sakura: (ctx, f) => paintDrift(ctx, f, { n: 14, dir: 1, speed: 0.22 }, (x, y, s, i, p) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(p * 6 + i);
    ctx.fillStyle = i % 3 === 0 ? '#ffffff' : '#ffb6d9';
    ctx.beginPath(); ctx.ellipse(0, 0, 3.2 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }),
  bubbles: (ctx, f) => paintDrift(ctx, f, { n: 12, dir: -1, speed: 0.18 }, (x, y, s, i) => paintBubble(ctx, x, y, (3.5 + (i % 3) * 1.6) * s, i)),
  notes: (ctx, f) => paintDrift(ctx, f, { n: 10, dir: -1, speed: 0.25 }, (x, y, s, i) => paintNote(ctx, x, y, 2.4 * s, i % 2 === 0 ? '#a98bff' : '#ff6fb5')),
  snow: (ctx, f) => {
    if (f.layer === 'back') paintGlow(ctx, f, 'rgba(189, 235, 255, 0.4)');
    paintDrift(ctx, f, { n: 14, dir: 1, speed: 0.15 }, (x, y, s, i, p) => paintSnowflake(ctx, x, y, (3 + (i % 3)) * s, p * 3 + i));
  },
  butterfly: (ctx, f) => {
    for (let i = 0; i < 3; i += 1) {
      const a = f.t * 0.9 + (i * Math.PI * 2) / 3;
      if ((Math.cos(a * 2) > 0) !== (f.layer === 'front')) continue;
      const x = f.x + Math.sin(a) * 34 * f.unit;
      const y = f.y - (40 + Math.sin(a * 2) * 18) * f.unit;
      paintButterfly(ctx, x, y, f.unit * 0.9, 0.5 + 0.5 * Math.sin(f.t * 14 + i), RAINBOW[i * 2 % RAINBOW.length] ?? '#ff9ac8');
    }
  },
  moon: (ctx, f) => {
    if (f.layer === 'back') { paintGlow(ctx, f, 'rgba(169, 139, 255, 0.35)'); paintMoon(ctx, f.x - 26 * f.unit, f.y - 70 * f.unit, 7 * f.unit); }
    paintOrbit(ctx, f, 7, (x, y, s, i) => paintTwinkle(ctx, x, y, (2.5 + (i % 2) * 1.5) * s, i % 2 === 0 ? '#ffe58a' : '#d9ccff'));
  },
  rainbow: (ctx, f) => {
    if (f.layer === 'back') paintGlow(ctx, f, 'rgba(255, 214, 236, 0.4)');
    paintRainbowRings(ctx, f);
  },
  gold: (ctx, f) => {
    if (f.layer === 'back') {
      paintGlow(ctx, f, 'rgba(255, 201, 77, 0.45)');
      const g = ctx.createLinearGradient(0, f.y - 96 * f.unit, 0, f.y);
      g.addColorStop(0, 'rgba(255, 229, 138, 0)'); g.addColorStop(1, 'rgba(255, 229, 138, 0.45)');
      ctx.fillStyle = g; ctx.fillRect(f.x - 24 * f.unit, f.y - 96 * f.unit, 48 * f.unit, 96 * f.unit);
    }
    paintDrift(ctx, f, { n: 16, dir: -1, speed: 0.35 }, (x, y, s, i) => paintTwinkle(ctx, x, y, (2.2 + (i % 3)) * s, i % 3 === 0 ? '#ffffff' : '#ffc94d'));
  },
};

/**
 * オーラを描く（奥・手前のどちらか）。
 * @param ctx 描画先
 * @param style オーラ
 * @param f 描く場所
 */
export function paintAura(ctx: CanvasRenderingContext2D, style: AuraStyle, f: AuraFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const painter = AURA_PAINTERS[style];
  if (painter === undefined) return;
  ctx.save();
  painter(ctx, f);
  ctx.restore();
}
