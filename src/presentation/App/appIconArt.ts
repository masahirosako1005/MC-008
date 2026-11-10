/**
 * @file アプリのシェルのオリジナルアイコン（presentation/App 層。Canvas 描画）
 * 下部タブ（地図・図鑑・アバター・ランキング・ランク）と右上の歯車を、アイコン素材を使わず canvas で描く（2026-11-09 ユーザー指示）。
 * 2026-11-10 から下部タブは Common/ui/icons の線だけのアイコンを使う（ユーザー指示「色を排除してラインだけ」）。歯車も同日の UI/UX 改善で線のアイコンにそろえた（GearMenu）。
 * audit-ignore: orphan-file 色つきの絵（タブ・歯車）は、線だけの方針を見直すときに戻せるよう残している（いまは未使用）
 * 絵は 24×24 の座標で描き、表示の大きさと端末の解像度に合わせて拡大する。面の明暗だけのフラットなイラスト（docs/08 §10.5）。
 * 選んでいないタブの淡い表示は CSS（filter）で行い、絵は1種類だけ持つ。
 */
import { createLogger } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { h, setStyle } from '@/Common/ui/dom';
import { DEFAULT_LOOK } from '@/presentation/shared/avatar/avatarLook';
import { AVATAR_FOCUS, drawAvatar } from '@/presentation/shared/avatar/avatarPaint';

const logger = createLogger('presentation/App/appIconArt');

/** アイコンの名前 */
export type AppIconName = 'map' | 'zukan' | 'avatar' | 'ranking' | 'rank' | 'gear';

/** 色 */
const C = {
  ink: '#2b2b33', white: '#ffffff', accent: '#d07534', accentDeep: '#a54c14', gold: '#f5b700', goldDeep: '#d97706', goldLight: '#ffe082',
  silver: '#cfd6df', silverDeep: '#9aa5b4', bronze: '#e0a46e', bronzeDeep: '#b9773f', navy: '#334a7a', sky: '#8ccaf0', skyDeep: '#5aa7dc',
  mint: '#cdebd5', mintDeep: '#9fd8b2', paper: '#f8f3ea', blue: '#4a6fa5', blueDeep: '#36557f', slate: '#5a4e44', gray: '#c7ccd4',
} as const;

/**
 * 角丸の四角を塗る。
 * @param ctx 描画先
 * @param r x・y・幅・高さ・角丸
 * @param color 色
 */
function box(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number, number], color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(r[0], r[1], r[2], r[3], r[4]);
  ctx.fill();
}

/**
 * 円を塗る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 半径
 * @param color 色
 */
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 多角形を塗る。
 * @param ctx 描画先
 * @param pts 頂点 [x, y, x, y, …]
 * @param color 色
 */
function poly(ctx: CanvasRenderingContext2D, pts: readonly number[], color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (i === 0) ctx.moveTo(pts[i] ?? 0, pts[i + 1] ?? 0);
    else ctx.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * 線を引く（丸い端）。
 * @param ctx 描画先
 * @param pts 点 [x, y, x, y, …]
 * @param color 色
 * @param width 太さ
 */
function line(ctx: CanvasRenderingContext2D, pts: readonly number[], color: string, width: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (i === 0) ctx.moveTo(pts[i] ?? 0, pts[i + 1] ?? 0);
    else ctx.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0);
  }
  ctx.stroke();
}

/**
 * 4つの角のきらめき（星）を塗る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 大きさ
 * @param color 色
 */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const k = r * 0.28;
  poly(ctx, [x, y - r, x + k, y - k, x + r, y, x + k, y + k, x, y + r, x - k, y + k, x - r, y, x - k, y - k], color);
}

/** アイコンごとの絵（24×24 の座標） */
const PAINTERS: Readonly<Record<AppIconName, (ctx: CanvasRenderingContext2D) => void>> = {
  /** 地図: 三つ折りの地図に川と道、コーラルのピン */
  map: (ctx) => {
    poly(ctx, [2.5, 7, 8.5, 5, 8.5, 20, 2.5, 22], C.mint); poly(ctx, [8.5, 5, 15.5, 7, 15.5, 22, 8.5, 20], C.paper); poly(ctx, [15.5, 7, 21.5, 5, 21.5, 20, 15.5, 22], C.mintDeep);
    line(ctx, [3, 17, 8, 15, 13, 17.5, 21, 14], C.skyDeep, 1.6); line(ctx, [5.5, 9, 11, 21], C.white, 1.1);
    dot(ctx, 13.5, 7.6, 4, C.accent); poly(ctx, [10.2, 9.4, 16.8, 9.4, 13.5, 14.5], C.accent); dot(ctx, 13.5, 7.6, 1.6, C.white);
  },
  /** 図鑑: ひらいた本にカードとしおり */
  zukan: (ctx) => {
    box(ctx, [2, 6, 20, 15.5, 2.2], C.blueDeep); box(ctx, [3.4, 4.5, 8.2, 15.5, 1.4], C.white); box(ctx, [12.4, 4.5, 8.2, 15.5, 1.4], C.white);
    box(ctx, [4.8, 6.4, 5.4, 7, 1], C.gold); sparkle(ctx, 7.5, 9.9, 2.2, C.white); line(ctx, [5, 16, 10, 16], C.gray, 1); line(ctx, [5, 18, 8.5, 18], C.gray, 1);
    line(ctx, [14, 8, 19, 8], C.gray, 1); line(ctx, [14, 10.5, 19, 10.5], C.gray, 1); line(ctx, [14, 13, 17.5, 13], C.gray, 1);
    poly(ctx, [16.5, 3, 19.5, 3, 19.5, 9, 18, 7.6, 16.5, 9], C.accent);
  },
  /** アバター: アバター画面と同じ絵の顔（既定の装い） */
  avatar: (ctx) => {
    const head = AVATAR_FOCUS.head;
    const s = 24 / Math.max(head.w, head.h);
    dot(ctx, 12, 13, 11, '#fbeee0');
    drawAvatar(ctx, { ...DEFAULT_LOOK, outfitColor: C.accent }, { x: 12 - (head.x + head.w / 2) * s, y: 12.5 - (head.y + head.h / 2) * s, scale: s });
  },
  /** ランキング: 金・銀・銅の表彰台と王冠 */
  ranking: (ctx) => {
    box(ctx, [2, 13, 6.6, 9, 1.2], C.silver); box(ctx, [8.7, 9.5, 6.6, 12.5, 1.2], C.gold); box(ctx, [15.4, 15, 6.6, 7, 1.2], C.bronze);
    box(ctx, [2, 13, 6.6, 1.8, 0.8], C.silverDeep); box(ctx, [8.7, 9.5, 6.6, 1.8, 0.8], C.goldDeep); box(ctx, [15.4, 15, 6.6, 1.8, 0.8], C.bronzeDeep);
    sparkle(ctx, 12, 15.5, 2.4, C.white); poly(ctx, [8.6, 7.6, 8.2, 2.6, 10.4, 4.6, 12, 1.8, 13.6, 4.6, 15.8, 2.6, 15.4, 7.6], C.gold);
  },
  /** ランク: リボンつきの金メダル */
  rank: (ctx) => {
    poly(ctx, [6.5, 1.5, 10.5, 1.5, 13.4, 10, 9.4, 10], C.accent); poly(ctx, [17.5, 1.5, 13.5, 1.5, 10.6, 10, 14.6, 10], C.navy);
    dot(ctx, 12, 15.2, 7, C.goldDeep); dot(ctx, 12, 14.8, 6.6, C.gold); dot(ctx, 12, 14.8, 4.6, C.goldLight); sparkle(ctx, 12, 14.8, 3.4, C.goldDeep);
  },
  /** 歯車: 8枚歯のスレートの歯車 */
  gear: (ctx) => {
    ctx.save();
    ctx.translate(12, 12);
    for (let i = 0; i < 8; i += 1) { ctx.rotate(Math.PI / 4); box(ctx, [-2.1, -10.2, 4.2, 5, 1.2], C.slate); }
    ctx.restore();
    dot(ctx, 12, 12, 7.4, C.slate); dot(ctx, 12, 12, 3.3, C.white); dot(ctx, 12, 12, 1.4, C.accent);
  },
};

/**
 * アイコンを描いた canvas を作る。
 * @param name アイコンの名前
 * @param size 一辺（CSS px）
 * @returns canvas（読み上げは隠す。意味はラベル・aria-label で伝える）
 */
export function createAppIcon(name: AppIconName, size: number): HTMLCanvasElement {
  const log = logger.fn('createAppIcon', { name, size });
  const dpr = normalizeDpr(window.devicePixelRatio);
  const canvas = h('canvas', { class: ['app-icon', `app-icon--${name}`], attrs: { width: Math.round(size * dpr), height: Math.round(size * dpr), 'aria-hidden': 'true' } });
  setStyle(canvas, 'width', `${size}px`);
  setStyle(canvas, 'height', `${size}px`);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.fail(canvas, '2D コンテキストを取得できません');
  ctx.setTransform((size * dpr) / 24, 0, 0, (size * dpr) / 24, 0, 0);
  PAINTERS[name](ctx);
  return log.exit(canvas);
}
