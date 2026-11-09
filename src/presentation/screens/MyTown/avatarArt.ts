/**
 * @file アバターのイラスト（presentation/screens/MyTown 層。Canvas 描画の純粋関数）
 * フラットなモダンの人物アイコン（墨の輪郭線なし・面の明暗だけ）でアバターを描く（docs/08 §10.5）。
 * 帽子の王冠は金の線で控えめに描く。手に持つものは現代の道具（カメラ・LED ランタン・小旗・鉢植え）にする（提灯・のぼり・松の絵柄は使わない）。
 * 状態・タイマーは持たない。呼び出し側が足元の位置と拡大率を渡す（docs/03 §7）。
 */
import { mixColors } from '@/Common/ui/canvas/colorUtils';
import { paintGear } from '@/presentation/shared/shopIcons';
import type { GearIcon } from '@/presentation/shared/shopIcons';

/** 帽子 */
export type AvatarHat = 'beret' | 'straw' | 'crown';

/** 手に持つもの（カメラが既定。ほかは訪問で手に入るアイテム） */
export type AvatarHeld = 'camera' | 'chochin' | 'nobori' | 'matsu';

/** アバターの装い。帽子・ねこは通った実績から、手に持つものは着せ替えの選択から決まる */
export interface AvatarLook {
  readonly hat?: AvatarHat;
  /** 服の色 '#rrggbb' */
  readonly outfitColor: string;
  readonly held: AvatarHeld;
  readonly hasCat: boolean;
}

/** アバターの位置と大きさ */
export interface AvatarPlacement {
  /** 足元の中心 X（CSS px） */
  readonly x: number;
  /** 足元の Y（CSS px） */
  readonly y: number;
  /** 拡大率（1 で高さ約 70px） */
  readonly scale: number;
  /** 旧来の輪郭線の太さ（フラットな絵では王冠の線だけに使う。省略時 1.5） */
  readonly lineWidthPx?: number;
}

/** 肌・髪・脚などアバター固有の色 */
const SKIN = '#f5d0b5';
const HAIR = '#1f2937';
const LEG = '#334155';
const SHOE = '#111827';
const CAT = '#f4b183';
const CAT_DEEP = '#e08e5a';
const CROWN = '#f5b700';
const HAT_COLOR: Readonly<Record<Exclude<AvatarHat, 'crown'>, string>> = { beret: '#ff5a36', straw: '#e7d7b9' };

/** 手に持つもの → 道具の絵 */
const GEAR_OF: Readonly<Record<AvatarHeld, GearIcon>> = { camera: 'camera', chochin: 'lantern', nobori: 'pennant', matsu: 'plant' };

/**
 * 角丸矩形を塗る。
 * @param ctx 描画先
 * @param r x・y・幅・高さ・角丸
 * @param fill 塗り色
 */
function box(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number, number], fill: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(r[0], r[1], r[2], r[3], Math.min(r[4], r[2] / 2, r[3] / 2));
  ctx.fill();
}

/**
 * 円を塗る。
 * @param ctx 描画先
 * @param c 中心 X・Y・半径
 * @param fill 塗り色
 */
function dot(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], fill: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(c[0], c[1], c[2], 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 相棒のねこ（座った横向きのシルエット）を描く（アバター座標系）。
 * @param ctx 描画先
 */
function drawCat(ctx: CanvasRenderingContext2D): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const x = -26;
  ctx.fillStyle = CAT;
  ctx.beginPath(); ctx.ellipse(x, -7, 7.5, 7, 0, 0, Math.PI * 2); ctx.fill();
  dot(ctx, [x - 4, -16, 5.2], CAT);
  ctx.beginPath(); ctx.moveTo(x - 9, -18); ctx.lineTo(x - 8.2, -24.5); ctx.lineTo(x - 4.8, -20); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 3.2, -20.5); ctx.lineTo(x + 0.2, -24.5); ctx.lineTo(x + 0.8, -17.5); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = CAT_DEEP; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x + 6, -3); ctx.quadraticCurveTo(x + 13, -6, x + 11, -14); ctx.stroke();
  box(ctx, [x - 4, -9, 8, 2.4, 1.2], CAT_DEEP);
  dot(ctx, [x - 6, -16.5, 0.9], HAIR);
  dot(ctx, [x - 2.2, -16.5, 0.9], HAIR);
}

/**
 * 帽子を描く（アバター座標系）。王冠は金の線だけで控えめに描く。
 * @param ctx 描画先
 * @param hat 帽子
 * @param line 王冠の線の太さ（アバター座標）
 */
function drawHat(ctx: CanvasRenderingContext2D, hat: AvatarHat, line: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (hat === 'crown') {
    ctx.strokeStyle = CROWN; ctx.lineWidth = line; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, -62); ctx.lineTo(-8, -70); ctx.lineTo(-4, -66); ctx.lineTo(0, -72); ctx.lineTo(4, -66); ctx.lineTo(8, -70); ctx.lineTo(8, -62); ctx.closePath();
    ctx.stroke();
    return;
  }
  const color = HAT_COLOR[hat];
  if (hat === 'beret') {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, -58, 12.5, Math.PI, 0); ctx.closePath(); ctx.fill();
    box(ctx, [-13, -60, 26, 4.5, 2], mixColors(color, '#111827', 0.18));
    return;
  }
  box(ctx, [-17, -60, 34, 3.5, 1.75], color);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(-10, -59); ctx.lineTo(-8, -68); ctx.lineTo(8, -68); ctx.lineTo(10, -59); ctx.closePath(); ctx.fill();
  box(ctx, [-9.5, -62, 19, 2.4, 1], mixColors(color, '#111827', 0.25));
}

/**
 * 頭・髪・顔を描く（アバター座標系）。
 * @param ctx 描画先
 */
function drawHead(ctx: CanvasRenderingContext2D): void { // audit-ignore: fnlog-missing 毎フレーム描画
  dot(ctx, [0, -50, 12], SKIN);
  ctx.fillStyle = HAIR;
  ctx.beginPath(); ctx.arc(0, -50, 12.6, Math.PI * 1.02, Math.PI * 1.98); ctx.quadraticCurveTo(4, -53, -2, -52.5); ctx.quadraticCurveTo(-8, -52, -12.4, -49); ctx.closePath(); ctx.fill();
  dot(ctx, [-4.2, -47.5, 1.3], HAIR);
  dot(ctx, [4.2, -47.5, 1.3], HAIR);
  ctx.strokeStyle = HAIR; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, -44.5, 2.4, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
  dot(ctx, [-8, -44, 2], 'rgba(255, 90, 54, 0.18)');
  dot(ctx, [8, -44, 2], 'rgba(255, 90, 54, 0.18)');
}

/**
 * 体（脚・靴・胴・腕・手）と手に持つものを描く（アバター座標系）。
 * @param ctx 描画先
 * @param look 装い
 */
function drawBody(ctx: CanvasRenderingContext2D, look: AvatarLook): void { // audit-ignore: fnlog-missing 毎フレーム描画
  box(ctx, [-6.5, -17, 5.5, 16, 2.5], LEG);
  box(ctx, [1, -17, 5.5, 16, 2.5], LEG);
  box(ctx, [-8, -3, 7.5, 3.5, 1.75], SHOE);
  box(ctx, [0.5, -3, 7.5, 3.5, 1.75], SHOE);
  const deep = mixColors(look.outfitColor, '#111827', 0.22);
  box(ctx, [-15, -36, 6, 18, 3], deep);
  box(ctx, [-11.5, -38, 23, 24, 8], look.outfitColor);
  ctx.fillStyle = mixColors(look.outfitColor, '#ffffff', 0.35);
  ctx.beginPath(); ctx.moveTo(-4.5, -38); ctx.lineTo(0, -33); ctx.lineTo(4.5, -38); ctx.closePath(); ctx.fill();
  box(ctx, [9, -36, 6, 14, 3], deep);
  dot(ctx, [-12, -18, 3], SKIN);
  paintGear(ctx, GEAR_OF[look.held], { x: 15, y: -14 }, look.held === 'camera' ? 11 : 14);
  dot(ctx, [12.5, -21, 3], SKIN);
}

/**
 * アバターを描く（足元基準）。
 * @param ctx 描画先（dpr 変換済み・CSS px 座標）
 * @param look 装い
 * @param at 足元の位置と拡大率
 * @sideEffect ctx に描画する（状態は save/restore で戻す）
 */
export function drawAvatar(ctx: CanvasRenderingContext2D, look: AvatarLook, at: AvatarPlacement): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.scale(at.scale, at.scale);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(17, 24, 39, 0.12)';
  ctx.beginPath(); ctx.ellipse(0, 0, 15, 3.2, 0, 0, Math.PI * 2); ctx.fill();
  if (look.hasCat) drawCat(ctx);
  drawBody(ctx, look);
  drawHead(ctx);
  if (look.hat !== undefined) drawHat(ctx, look.hat, Math.max(1.8, (at.lineWidthPx ?? 1.5) * 1.2) / Math.max(0.3, at.scale));
  ctx.restore();
}
