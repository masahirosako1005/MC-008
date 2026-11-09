/**
 * @file エモートの演出（presentation/screens/Avatar 層。Canvas 描画の純粋関数）
 * エモート＝アバターの動き（avatarPaint のエモートのポーズ）＋頭の右上の吹き出し＋まわりの粒。
 * 吹き出しは「ぽん」と出て、終わりにふわっと消える。粒の位置・大きさは番号から決まる（乱数・時刻は使わない）。
 * 座標は足元（x, y）とアバターの拡大率 unit で決める（拡大率1でアバターの高さ約70px）。e はエモートが始まってからの秒。
 */
import type { AvatarPose, EmoteStyle } from '@/presentation/shared/avatar/avatarLook';
import { paintHeart, paintTwinkle } from '@/presentation/screens/Avatar/stageSparkle';

/** 吹き出しの中身 */
type BubbleKind = 'heart' | 'note' | 'question' | 'smile' | 'exclaim' | 'zzz' | 'drop' | 'anger' | 'flower' | 'star' | 'sparkle';

/** まわりの粒 */
type ParticleKind = 'hearts' | 'notes' | 'none' | 'sparkles' | 'shock' | 'zzz' | 'tears' | 'puffs' | 'petals' | 'confetti' | 'swirl' | 'stars' | 'idol';

/** エモートの定義 */
export interface EmoteDef {
  readonly pose: AvatarPose;
  /** 長さ（秒） */
  readonly sec: number;
  readonly bubble: BubbleKind;
  readonly particles: ParticleKind;
}

/** エモートごとの動き・吹き出し・粒 */
export const EMOTES: Readonly<Record<EmoteStyle, EmoteDef>> = {
  love: { pose: 'love', sec: 2.6, bubble: 'heart', particles: 'hearts' },
  note: { pose: 'dance', sec: 2.8, bubble: 'note', particles: 'notes' },
  question: { pose: 'tilt', sec: 2.2, bubble: 'question', particles: 'none' },
  laugh: { pose: 'laugh', sec: 2.4, bubble: 'smile', particles: 'sparkles' },
  surprise: { pose: 'surprise', sec: 2, bubble: 'exclaim', particles: 'shock' },
  sleepy: { pose: 'sleepy', sec: 3, bubble: 'zzz', particles: 'zzz' },
  cry: { pose: 'cry', sec: 2.6, bubble: 'drop', particles: 'tears' },
  angry: { pose: 'angry', sec: 2.2, bubble: 'anger', particles: 'puffs' },
  bow: { pose: 'bow', sec: 2.2, bubble: 'flower', particles: 'petals' },
  cheer: { pose: 'cheer', sec: 2.6, bubble: 'star', particles: 'confetti' },
  spin: { pose: 'spin', sec: 2.4, bubble: 'sparkle', particles: 'swirl' },
  star: { pose: 'peace', sec: 2.2, bubble: 'star', particles: 'stars' },
  idol: { pose: 'dance', sec: 3.4, bubble: 'note', particles: 'idol' },
};

/** 色 */
const PINK = '#ff5fa2';
const LAVENDER = '#a98bff';
const CONFETTI = ['#ff6fb5', '#ffc94d', '#7ce38b', '#5cc8ff', '#a98bff', '#ffffff'];

/** 終わりぎわに粒を薄くする係数（paintEmoteParticles が毎回設定する） */
let fadeK = 1;

/**
 * 透明度を設定する（終わりぎわの係数をかける）。
 * @param ctx 描画先
 * @param a 透明度
 */
function setAlpha(ctx: CanvasRenderingContext2D, a: number): void { // audit-ignore: fnlog-missing 毎フレーム描画で粒ごとに呼ぶ
  ctx.globalAlpha = a * fadeK;
}

/** 描く場所（足元・拡大率・始まってからの秒） */
export interface EmoteFrame {
  readonly x: number;
  readonly y: number;
  readonly unit: number;
  readonly e: number;
}

/**
 * 番号から 0〜1 の決まった値を作る（乱数の代わり）。
 * @param i 番号
 * @param salt 種
 * @returns 0 以上 1 未満
 */
function hash01(i: number, salt: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で粒ごとに呼ぶ純粋な算術
  const v = Math.sin(i * 91.7 + salt * 271.3) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * 音符（♪）を塗る。
 * @param ctx 描画先
 * @param x 玉の中心 X
 * @param y 玉の中心 Y
 * @param r 大きさ
 * @param color 色
 */
export function paintNote(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.35;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.75, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + r * 0.85, y - r * 0.2); ctx.lineTo(x + r * 0.85, y - r * 3); ctx.quadraticCurveTo(x + r * 2.2, y - r * 2.4, x + r * 1.9, y - r * 1.3); ctx.stroke();
}

/**
 * 文字1つを描く（? ! Z など。太い丸い字）。
 * @param ctx 描画先
 * @param text 文字
 * @param x 中心 X
 * @param y 中心 Y
 * @param size 大きさ（px）
 * @param color 色
 */
function paintGlyph(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.font = `900 ${size}px "M PLUS Rounded 1c", "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size * 0.18;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * 吹き出しの中身を描く（中心 0,0・半径 r の中）。
 * @param ctx 描画先
 * @param kind 中身
 * @param r 吹き出しの半径
 * @param e 始まってからの秒
 */
function paintBubbleIcon(ctx: CanvasRenderingContext2D, kind: BubbleKind, r: number, e: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const beat = 1 + Math.sin(e * 8) * 0.06;
  switch (kind) {
    case 'heart': paintHeart(ctx, 0, 1, r * 0.55 * beat, PINK); break;
    case 'note': paintNote(ctx, -r * 0.2, r * 0.3, r * 0.28, LAVENDER); break;
    case 'question': paintGlyph(ctx, '?', 0, 1, r * 1.2, LAVENDER); break;
    case 'smile': ctx.strokeStyle = PINK; ctx.lineWidth = r * 0.16; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.45, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); break;
    case 'exclaim': paintGlyph(ctx, '!', 0, 1, r * 1.3, PINK); break;
    case 'zzz': paintGlyph(ctx, 'Z', -r * 0.15, r * 0.15, r * 0.9, LAVENDER); paintGlyph(ctx, 'z', r * 0.35, -r * 0.35, r * 0.55, LAVENDER); break;
    case 'drop': ctx.fillStyle = '#5cc8ff'; ctx.beginPath(); ctx.moveTo(0, -r * 0.55); ctx.quadraticCurveTo(r * 0.45, r * 0.05, 0, r * 0.45); ctx.quadraticCurveTo(-r * 0.45, r * 0.05, 0, -r * 0.55); ctx.fill(); break;
    case 'anger': paintAngerMark(ctx, 0, 0, r * 0.5); break;
    case 'flower': paintFlower(ctx, 0, 0, r * 0.5, e); break;
    case 'star': paintTwinkle(ctx, 0, 0, r * 0.62 * beat, '#ffc94d'); break;
    case 'sparkle': paintTwinkle(ctx, -r * 0.12, r * 0.08, r * 0.5, '#ff9ac8'); paintTwinkle(ctx, r * 0.38, -r * 0.32, r * 0.26, LAVENDER); break;
  }
}

/**
 * 怒りマーク（十字の血管マーク）を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 大きさ
 */
function paintAngerMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.strokeStyle = '#ff4d6d';
  ctx.lineWidth = r * 0.32;
  ctx.lineCap = 'round';
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    ctx.beginPath();
    ctx.arc(x + sx * r * 0.62, y + sy * r * 0.62, r * 0.42, Math.atan2(-sy, -sx) - 0.9, Math.atan2(-sy, -sx) + 0.9);
    ctx.stroke();
  }
}

/**
 * 花（5枚の花びら）を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 大きさ
 * @param rot 回転
 */
function paintFlower(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = '#ffb6d9';
  for (let i = 0; i < 5; i += 1) {
    const a = rot + (i * Math.PI * 2) / 5;
    ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.45, r * 0.3, a, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#ffe58a';
  ctx.beginPath(); ctx.arc(x, y, r * 0.3, 0, Math.PI * 2); ctx.fill();
}

/**
 * 頭の右上の吹き出しを描く（ぽんと出て、終わりに消える）。
 * @param ctx 描画先
 * @param def エモート
 * @param f 描く場所
 */
export function paintEmoteBubble(ctx: CanvasRenderingContext2D, def: EmoteDef, f: EmoteFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const pop = f.e < 0.25 ? (f.e / 0.25) * 1.15 : f.e < 0.4 ? 1.15 - ((f.e - 0.25) / 0.15) * 0.15 : 1;
  const fade = Math.max(0, Math.min(1, (def.sec - f.e) / 0.3));
  const r = 12 * Math.max(1, f.unit * 0.55);
  const bx = f.x + 24 * f.unit;
  const by = f.y - 70 * f.unit + Math.sin(f.e * 3) * 1.5;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(bx, by);
  ctx.scale(pop, pop);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffb3d6';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-r * 0.55, r * 0.7); ctx.lineTo(-r * 1.05, r * 1.35); ctx.lineTo(-r * 0.15, r * 0.95); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-r * 0.55, r * 0.78); ctx.lineTo(-r * 1.05, r * 1.35); ctx.lineTo(-r * 0.2, r * 0.98); ctx.stroke();
  paintBubbleIcon(ctx, def.bubble, r, f.e);
  ctx.restore();
}

/**
 * 立ちのぼる粒（ハート・音符・Z・花びら）を描く。
 * @param ctx 描画先
 * @param kind 粒
 * @param f 描く場所
 */
function paintRising(ctx: CanvasRenderingContext2D, kind: 'hearts' | 'notes' | 'zzz' | 'petals', f: EmoteFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const n = kind === 'zzz' ? 3 : 7;
  for (let i = 0; i < n; i += 1) {
    const life = 1.4;
    const local = f.e - i * (kind === 'zzz' ? 0.7 : 0.28);
    if (local < 0) continue;
    const p = (local % life) / life;
    const side = hash01(i, 1) - 0.5;
    const x = f.x + side * 50 * f.unit + Math.sin(p * Math.PI * 2 + i) * 5 * f.unit;
    const y = f.y - (28 + p * 50) * f.unit;
    const s = (0.6 + hash01(i, 2) * 0.6) * f.unit;
    setAlpha(ctx, Math.sin(p * Math.PI));
    if (kind === 'hearts') paintHeart(ctx, x, y, 4 * s, i % 2 === 0 ? PINK : '#ff9ac8');
    else if (kind === 'notes') paintNote(ctx, x, y, 2.6 * s, i % 2 === 0 ? LAVENDER : '#5cc8ff');
    else if (kind === 'zzz') paintGlyph(ctx, 'Z', f.x + 18 * f.unit + p * 16 * f.unit, f.y - (66 + p * 26) * f.unit, (6 + p * 6) * f.unit, LAVENDER);
    else paintFlower(ctx, x, y, 3 * s, p * 6 + i);
  }
}

/**
 * 頭のまわりにはじける粒（きらめき・星・びっくりの線）を描く。
 * @param ctx 描画先
 * @param kind 粒
 * @param f 描く場所
 */
function paintPops(ctx: CanvasRenderingContext2D, kind: 'sparkles' | 'stars' | 'shock', f: EmoteFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const hx = f.x;
  const hy = f.y - 52 * f.unit;
  if (kind === 'shock') {
    ctx.strokeStyle = PINK; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    const k = Math.min(1, f.e / 0.25);
    for (const a of [-2.4, -1.9, -1.2]) {
      ctx.beginPath(); ctx.moveTo(hx + Math.cos(a) * 18 * f.unit, hy + Math.sin(a) * 18 * f.unit);
      ctx.lineTo(hx + Math.cos(a) * (18 + 8 * k) * f.unit, hy + Math.sin(a) * (18 + 8 * k) * f.unit); ctx.stroke();
    }
    return;
  }
  for (let i = 0; i < 6; i += 1) {
    const p = ((f.e * 1.2 + i / 6) % 1);
    const a = (i * Math.PI * 2) / 6 + f.e;
    const d = (16 + p * 14) * f.unit;
    setAlpha(ctx, Math.sin(p * Math.PI));
    const color = kind === 'stars' ? (i % 2 === 0 ? '#ffc94d' : '#ffffff') : (i % 2 === 0 ? '#ffffff' : '#ffd6ec');
    paintTwinkle(ctx, hx + Math.cos(a) * d, hy + Math.sin(a) * d * 0.8, (kind === 'stars' ? 5 : 3.5) * f.unit * (1 - p * 0.5), color);
  }
}

/**
 * 涙（目からこぼれて落ちる粒）と、怒りのけむりを描く。
 * @param ctx 描画先
 * @param kind 粒
 * @param f 描く場所
 */
function paintFaceFx(ctx: CanvasRenderingContext2D, kind: 'tears' | 'puffs', f: EmoteFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < 4; i += 1) {
    const p = ((f.e * 1.4 + i * 0.25) % 1);
    const side = i % 2 === 0 ? -1 : 1;
    setAlpha(ctx, 1 - p);
    if (kind === 'tears') {
      ctx.fillStyle = '#7dd3fc';
      const x = f.x + side * (8 + p * 10) * f.unit;
      const y = f.y - (44 - p * 26) * f.unit;
      ctx.beginPath(); ctx.ellipse(x, y, 1.6 * f.unit, 2.2 * f.unit, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255, 140, 170, 0.75)';
      const x = f.x + side * (16 + p * 8) * f.unit;
      const y = f.y - (60 + p * 10) * f.unit;
      for (const [dx, dy, rr] of [[0, 0, 3], [2.5, -1.5, 2.4], [-2.2, -1.2, 2.2]] as const) {
        ctx.beginPath(); ctx.arc(x + dx * f.unit, y + dy * f.unit, rr * f.unit * (0.6 + p * 0.6), 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

/**
 * 上から降る紙吹雪を描く。
 * @param ctx 描画先
 * @param f 描く場所
 * @param count 枚数
 */
function paintConfetti(ctx: CanvasRenderingContext2D, f: EmoteFrame, count: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < count; i += 1) {
    const p = ((f.e * 0.6 + hash01(i, 3)) % 1);
    const x = f.x + (hash01(i, 4) - 0.5) * 140 * f.unit * 0.5 + Math.sin(p * 9 + i) * 6;
    const y = f.y - 95 * f.unit + p * 100 * f.unit;
    setAlpha(ctx, Math.min(1, (1 - p) * 2));
    ctx.save(); ctx.translate(x, y); ctx.rotate(p * 8 + i);
    ctx.fillStyle = CONFETTI[i % CONFETTI.length] ?? '#ffffff';
    ctx.fillRect(-2.2 * f.unit * 0.5, -1.2 * f.unit * 0.5, 4.4 * f.unit * 0.5, 2.4 * f.unit * 0.5);
    ctx.restore();
  }
}

/**
 * アバターのまわりを回るきらめき（くるくる）を描く。
 * @param ctx 描画先
 * @param f 描く場所
 */
function paintSwirl(ctx: CanvasRenderingContext2D, f: EmoteFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < 10; i += 1) {
    const a = f.e * 5 + (i * Math.PI * 2) / 10;
    const h = ((i / 10 + f.e * 0.5) % 1) * 70;
    setAlpha(ctx, 0.5 + 0.5 * Math.sin(a));
    paintTwinkle(ctx, f.x + Math.cos(a) * 30 * f.unit, f.y - (6 + h) * f.unit, 3.5 * f.unit * 0.5 + 2, CONFETTI[i % 5] ?? '#ffffff');
  }
}

/**
 * アイドルダンスの虹色の光（左右から振られるビーム）を描く。
 * @param ctx 描画先
 * @param f 描く場所
 */
function paintIdolBeams(ctx: CanvasRenderingContext2D, f: EmoteFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < 4; i += 1) {
    const a = Math.sin(f.e * 2.4 + i * 1.3) * 0.5 + (i < 2 ? 0.6 : -0.6);
    const ox = f.x + (i < 2 ? -1 : 1) * 70 * f.unit;
    ctx.save();
    ctx.translate(ox, f.y - 100 * f.unit);
    ctx.rotate(a);
    const g = ctx.createLinearGradient(0, 0, 0, 120 * f.unit);
    g.addColorStop(0, CONFETTI[i] ?? '#ffffff'); g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    setAlpha(ctx, 0.35);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(3, 0); ctx.lineTo(14 * f.unit, 120 * f.unit); ctx.lineTo(-14 * f.unit, 120 * f.unit); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

/**
 * エモートの粒を描く（アバターより手前）。
 * @param ctx 描画先
 * @param def エモート
 * @param f 描く場所
 */
export function paintEmoteParticles(ctx: CanvasRenderingContext2D, def: EmoteDef, f: EmoteFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  fadeK = Math.max(0, Math.min(1, (def.sec - f.e) / 0.4));
  switch (def.particles) {
    case 'hearts': case 'notes': case 'zzz': case 'petals': paintRising(ctx, def.particles, f); break;
    case 'sparkles': case 'stars': case 'shock': paintPops(ctx, def.particles, f); break;
    case 'tears': case 'puffs': paintFaceFx(ctx, def.particles, f); break;
    case 'confetti': paintConfetti(ctx, f, 24); break;
    case 'swirl': paintSwirl(ctx, f); break;
    case 'idol': paintIdolBeams(ctx, f); paintRising(ctx, 'notes', f); paintConfetti(ctx, f, 16); break;
    case 'none': break;
  }
  ctx.restore();
}
