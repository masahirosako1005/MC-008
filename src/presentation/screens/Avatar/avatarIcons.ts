/**
 * @file アバター画面のオリジナルアイコン（presentation/screens/Avatar 層。Canvas 描画）
 * 絵文字・アイコンフォントを使わず、カテゴリのタブ・操作・鍵・NEW まわりの印をすべて canvas で描く（2026-11-09 ユーザー指示）。
 * 絵は 24×24 の座標で描き、表示の大きさと端末の解像度に合わせて拡大する。色は面の明暗だけのフラットなイラスト（docs/08 §10.5）。
 */
import { createLogger } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { h, setStyle } from '@/Common/ui/dom';
import { PALETTE } from '@/Common/ui/theme/palette';

const logger = createLogger('presentation/screens/Avatar/avatarIcons');

/** アイコンの名前 */
export type AvatarIconName =
  | 'pickup' | 'hair' | 'face' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory' | 'held' | 'pet' | 'background' | 'object' | 'title' | 'coord'
  | 'aura' | 'emote' | 'collection' | 'spring' | 'summer' | 'autumn' | 'winter'
  | 'undo' | 'random' | 'photo' | 'bag' | 'lock' | 'key' | 'party' | 'none' | 'check' | 'tag';

/** 色 */
const C = {
  ink: '#2b2b33', white: '#ffffff', coral: '#ff7a5c', coralDeep: '#e8553a', gold: '#f5b700', goldDeep: '#d97706', goldLight: '#ffe082',
  sky: '#8ccaf0', skyDeep: '#5aa7dc', leaf: '#4cbf8a', leafDeep: '#2f9c6c', denim: '#4a6fa5', denimDeep: '#36557f', pink: '#f78fb3', pinkDeep: '#e0628f',
  skin: '#f6d3b8', skinDeep: '#e9b996', hair: '#4a3328', hairLight: '#7a5543', brown: '#b07a4a', brownDeep: '#8a5a33', gray: '#9ca3af', grayLight: '#e5e7eb', cheek: 'rgba(255, 110, 90, 0.35)',
} as const;

/** 描く関数（24×24 の座標） */
type Painter = (ctx: CanvasRenderingContext2D) => void;

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

/**
 * にっこり目（弧）を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 */
function smileEye(ctx: CanvasRenderingContext2D, x: number, y: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y + 0.6, 1.4, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
}

/** アイコンごとの絵 */
const PAINTERS: Readonly<Record<AvatarIconName, Painter>> = {
  /** ピックアップ: 金と桃色のきらめき */
  pickup: (ctx) => { sparkle(ctx, 10, 11, 8, C.gold); sparkle(ctx, 10, 11, 3.6, C.goldLight); sparkle(ctx, 18.5, 5.5, 3.6, C.pink); dot(ctx, 19, 18, 1.6, C.coral); },
  /** 髪型: ボブの髪をかぶった頭 */
  hair: (ctx) => {
    dot(ctx, 12, 13, 8.5, C.hair); box(ctx, [4, 12, 16, 9, 3], C.hair); dot(ctx, 12, 14, 6, C.skin); box(ctx, [6, 6.5, 12, 5, 3], C.hair);
    line(ctx, [8, 7.5, 11, 6.2], C.hairLight, 1.4); dot(ctx, 9.2, 16.8, 1.1, C.cheek); dot(ctx, 14.8, 16.8, 1.1, C.cheek);
  },
  /** 顔: にっこり笑う顔 */
  face: (ctx) => {
    dot(ctx, 12, 12.5, 9, C.skin); smileEye(ctx, 8.8, 11.5); smileEye(ctx, 15.2, 11.5);
    dot(ctx, 7.2, 15, 1.6, C.cheek); dot(ctx, 16.8, 15, 1.6, C.cheek); line(ctx, [10.4, 15.6, 12, 16.8, 13.6, 15.6], C.coralDeep, 1.2);
  },
  /** トップス: コーラルのTシャツ */
  top: (ctx) => {
    poly(ctx, [8, 4, 3, 7, 5, 11.5, 7.5, 10.5, 7.5, 20.5, 16.5, 20.5, 16.5, 10.5, 19, 11.5, 21, 7, 16, 4, 14, 5.6, 10, 5.6], C.coral);
    poly(ctx, [7.5, 10.5, 16.5, 10.5, 16.5, 12, 7.5, 12], C.coralDeep); sparkle(ctx, 12, 15.5, 2.6, C.white);
  },
  /** ボトムス: デニム */
  bottom: (ctx) => {
    poly(ctx, [6, 3.5, 18, 3.5, 19.5, 21, 14, 21, 12, 9.5, 10, 21, 4.5, 21], C.denim); box(ctx, [6, 3.5, 12, 2.6, 0.8], C.denimDeep);
    line(ctx, [8.3, 7.5, 8.8, 10], C.goldLight, 0.9); line(ctx, [15.7, 7.5, 15.2, 10], C.goldLight, 0.9);
  },
  /** くつ: スニーカー */
  shoes: (ctx) => {
    poly(ctx, [3, 16.5, 3.2, 7.6, 9.2, 7.6, 12, 11.4, 18, 12.4, 21.2, 14.8, 21.2, 16.5], C.coral); poly(ctx, [15, 12.1, 18, 12.4, 21.2, 14.8, 21.2, 16.5, 15, 16.5], C.white);
    box(ctx, [3.2, 7, 6, 1.8, 0.9], C.ink); line(ctx, [9.6, 10.2, 11.4, 9.4], C.white, 1.1); line(ctx, [10.6, 12, 12.6, 11.2], C.white, 1.1);
    box(ctx, [2.5, 16, 19.2, 4.2, 1.8], C.ink); line(ctx, [4.5, 18.1, 19.5, 18.1], C.grayLight, 0.8);
  },
  /** 帽子: 赤いベレー帽 */
  hat: (ctx) => {
    ctx.fillStyle = C.coralDeep; ctx.beginPath(); ctx.ellipse(12, 13, 9.5, 6, -0.12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.coral; ctx.beginPath(); ctx.ellipse(11.5, 12, 8.5, 5, -0.12, 0, Math.PI * 2); ctx.fill();
    box(ctx, [4.5, 15, 15, 3.2, 1.6], C.ink); line(ctx, [12, 7.2, 13, 4.5], C.coralDeep, 1.8);
  },
  /** アクセ: 大きなリボン */
  accessory: (ctx) => {
    poly(ctx, [12, 12, 3, 6.5, 3, 17.5], C.pink); poly(ctx, [12, 12, 21, 6.5, 21, 17.5], C.pink);
    poly(ctx, [12, 12, 4.5, 15.5, 3, 17.5], C.pinkDeep); poly(ctx, [12, 12, 19.5, 15.5, 21, 17.5], C.pinkDeep);
    poly(ctx, [11, 13, 8.5, 21, 11, 19.5], C.pinkDeep); poly(ctx, [13, 13, 15.5, 21, 13, 19.5], C.pinkDeep); box(ctx, [9.6, 9.6, 4.8, 4.8, 1.6], C.pinkDeep);
  },
  /** 持ち物: カメラ */
  held: (ctx) => {
    box(ctx, [3, 8, 18, 12, 2.6], C.ink); box(ctx, [7.5, 5.5, 5.5, 3.5, 1], C.ink); dot(ctx, 12.5, 14, 4.3, C.grayLight);
    dot(ctx, 12.5, 14, 2.8, C.skyDeep); dot(ctx, 11.6, 13.1, 0.9, C.white); dot(ctx, 18, 10.6, 1.1, C.coral);
  },
  /** 相棒: ねこの顔 */
  pet: (ctx) => {
    poly(ctx, [4.5, 4, 10, 8.5, 5, 12], '#f4a261'); poly(ctx, [19.5, 4, 14, 8.5, 19, 12], '#f4a261'); dot(ctx, 12, 14, 8, '#f4b183');
    poly(ctx, [5.8, 6.4, 8.6, 8.8, 6.2, 10.4], C.pink); poly(ctx, [18.2, 6.4, 15.4, 8.8, 17.8, 10.4], C.pink);
    dot(ctx, 9, 13.5, 1.2, C.ink); dot(ctx, 15, 13.5, 1.2, C.ink); poly(ctx, [11, 15.6, 13, 15.6, 12, 16.8], C.pinkDeep);
  },
  /** コレクション: 台に立つマネキンと星 */
  collection: (ctx) => {
    dot(ctx, 12, 6, 3.2, C.skin); poly(ctx, [7, 9.5, 17, 9.5, 18.5, 16, 5.5, 16], C.pink); box(ctx, [11.2, 15.5, 1.6, 4, 0.6], C.gray);
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.ellipse(12, 20.5, 7, 1.8, 0, 0, Math.PI * 2); ctx.fill(); sparkle(ctx, 19.5, 5, 2.8, C.gold); sparkle(ctx, 4.5, 8, 1.8, '#9adfff');
  },
  /** 春: 桜の花 */
  spring: (ctx) => {
    for (let i = 0; i < 5; i += 1) { const a = -Math.PI / 2 + (i * Math.PI * 2) / 5; ctx.fillStyle = '#ffb6d9'; ctx.beginPath(); ctx.ellipse(12 + Math.cos(a) * 5, 12 + Math.sin(a) * 5, 4.4, 3.4, a, 0, Math.PI * 2); ctx.fill(); }
    dot(ctx, 12, 12, 2.6, '#ffe58a'); dot(ctx, 12, 12, 1.2, '#ff8fb8');
  },
  /** 夏: ひまわり */
  summer: (ctx) => {
    for (let i = 0; i < 10; i += 1) { const a = (i * Math.PI * 2) / 10; ctx.fillStyle = '#ffc94d'; ctx.beginPath(); ctx.ellipse(12 + Math.cos(a) * 6.4, 12 + Math.sin(a) * 6.4, 3.2, 1.7, a, 0, Math.PI * 2); ctx.fill(); }
    dot(ctx, 12, 12, 4.4, '#a0673f'); dot(ctx, 11, 11, 1.2, '#c98a5a');
  },
  /** 秋: もみじ */
  autumn: (ctx) => {
    ctx.fillStyle = '#f97316'; ctx.beginPath();
    for (let i = 0; i <= 10; i += 1) { const a = -Math.PI / 2 + (i * Math.PI * 2) / 10 - Math.PI / 10; const r = i % 2 === 0 ? 9.5 : 4; ctx.lineTo(12 + Math.cos(a) * r, 11 + Math.sin(a) * r); }
    ctx.closePath(); ctx.fill(); line(ctx, [12, 12, 12, 21.5], '#b45309', 1.4);
  },
  /** 冬: 雪の結晶 */
  winter: (ctx) => {
    for (let k = 0; k < 6; k += 1) { const a = (k * Math.PI) / 3; line(ctx, [12, 12, 12 + Math.cos(a) * 9, 12 + Math.sin(a) * 9], '#7dd3fc', 1.8); line(ctx, [12 + Math.cos(a) * 5.5, 12 + Math.sin(a) * 5.5, 12 + Math.cos(a + 0.5) * 7.5, 12 + Math.sin(a + 0.5) * 7.5], '#7dd3fc', 1.2); }
    dot(ctx, 12, 12, 2, '#bae6fd');
  },
  /** オーラ: 光の輪ときらめき */
  aura: (ctx) => {
    ctx.strokeStyle = C.pink; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.ellipse(12, 15, 9, 3.6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#c9a2ff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(12, 9.5, 7, 2.8, 0, 0, Math.PI * 2); ctx.stroke();
    sparkle(ctx, 12, 12, 4, C.gold); sparkle(ctx, 4.5, 6, 2.2, '#9adfff'); sparkle(ctx, 19.5, 5, 2.6, C.pink);
  },
  /** エモート: ハートの入った吹き出し */
  emote: (ctx) => {
    poly(ctx, [6, 17, 4, 22, 10, 18.5], '#ffb3d6'); dot(ctx, 12, 11, 9, '#ffb3d6'); dot(ctx, 12, 11, 7.6, C.white);
    ctx.fillStyle = '#ff5fa2'; ctx.beginPath(); ctx.moveTo(12, 15.2); ctx.bezierCurveTo(6.5, 11.5, 8.5, 6.4, 12, 9.2); ctx.bezierCurveTo(15.5, 6.4, 17.5, 11.5, 12, 15.2); ctx.fill();
  },
  /** 背景: 空と丘と太陽の額 */
  background: (ctx) => {
    box(ctx, [2.5, 4, 19, 16, 3], C.sky); dot(ctx, 16.5, 8.8, 2.4, C.gold);
    ctx.save(); ctx.beginPath(); ctx.roundRect(2.5, 4, 19, 16, 3); ctx.clip();
    dot(ctx, 7, 22, 9, C.leaf); dot(ctx, 18, 24, 9, C.leafDeep); ctx.restore(); line(ctx, [6, 8, 9, 8], C.white, 1.6);
  },
  /** オブジェ: 木のベンチ */
  object: (ctx) => {
    box(ctx, [4, 6, 16, 3, 1], C.brown); box(ctx, [4, 10, 16, 3, 1], C.brown); box(ctx, [3, 14, 18, 3, 1], C.brownDeep);
    box(ctx, [5, 17, 2, 4.5, 0.6], C.ink); box(ctx, [17, 17, 2, 4.5, 0.6], C.ink);
  },
  /** 称号: 金の札と星 */
  title: (ctx) => {
    poly(ctx, [4, 15, 2, 20, 6.5, 18.5, 7.5, 15], C.coralDeep); poly(ctx, [20, 15, 22, 20, 17.5, 18.5, 16.5, 15], C.coralDeep);
    box(ctx, [3.5, 6, 17, 10.5, 2.4], C.goldDeep); box(ctx, [3.5, 5, 17, 10.5, 2.4], C.gold); sparkle(ctx, 12, 10.2, 3.4, C.white);
  },
  /** マイコーデ: ハンガーとシャツ */
  coord: (ctx) => {
    line(ctx, [12, 6, 12, 4.2, 13.6, 3, 14.5, 4.4], C.gray, 1.4); line(ctx, [3, 10.5, 12, 6, 21, 10.5, 3, 10.5], C.gray, 1.6);
    poly(ctx, [7, 11.5, 4.5, 14, 6, 16, 7.5, 15.4, 7.5, 21, 16.5, 21, 16.5, 15.4, 18, 16, 19.5, 14, 17, 11.5], C.leaf); sparkle(ctx, 12, 16.5, 2.2, C.white);
  },
  /** 元に戻す: 回る矢印 */
  undo: (ctx) => {
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(12.5, 13, 6.5, Math.PI * 1.05, Math.PI * 2.75); ctx.stroke();
    poly(ctx, [2.8, 12.6, 8.8, 12.6, 5.8, 8.2], C.ink);
  },
  /** おまかせ: サイコロ */
  random: (ctx) => {
    ctx.save(); ctx.translate(12, 12); ctx.rotate(-0.22); box(ctx, [-8, -7, 16, 16, 3.6], C.coralDeep); box(ctx, [-8, -8, 16, 16, 3.6], C.coral);
    for (const [x, y] of [[-3.8, -3.8], [3.8, -3.8], [0, 0], [-3.8, 3.8], [3.8, 3.8]] as const) dot(ctx, x, y, 1.5, C.white);
    ctx.restore();
  },
  /** 撮影: フラッシュの光るカメラ */
  photo: (ctx) => {
    box(ctx, [2.5, 8, 19, 12.5, 3], PALETTE.brand); box(ctx, [7, 5.5, 6, 3.5, 1.2], PALETTE.brand); dot(ctx, 12, 14.2, 4.6, C.white);
    dot(ctx, 12, 14.2, 3.2, PALETTE.brandLight); dot(ctx, 11, 13.2, 1, C.white); sparkle(ctx, 19, 4.5, 3.2, C.gold);
  },
  /** 持っている数: 紙袋 */
  bag: (ctx) => {
    line(ctx, [8.5, 9, 8.5, 6, 12, 3.5, 15.5, 6, 15.5, 9], C.coralDeep, 1.6); poly(ctx, [4.5, 8, 19.5, 8, 21, 21, 3, 21], C.coral);
    box(ctx, [3, 18.5, 18, 2.5, 0.8], C.coralDeep); sparkle(ctx, 12, 13.8, 2.6, C.white);
  },
  /** 鍵がかかっている: 金の南京錠 */
  lock: (ctx) => {
    ctx.strokeStyle = C.grayLight; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(12, 9.5, 4.6, Math.PI, 0); ctx.lineTo(16.6, 11); ctx.moveTo(7.4, 9.5); ctx.lineTo(7.4, 11); ctx.stroke();
    box(ctx, [4.5, 10.5, 15, 11, 2.6], C.goldDeep); box(ctx, [4.5, 10, 15, 10.4, 2.6], C.gold); dot(ctx, 12, 14.4, 1.7, C.ink); box(ctx, [11.3, 14.6, 1.4, 3.2, 0.6], C.ink);
  },
  /** 手に入れ方: 金の鍵 */
  key: (ctx) => {
    dot(ctx, 7.5, 12, 5, C.gold); dot(ctx, 7.5, 12, 2, C.white); box(ctx, [11, 10.8, 10.5, 2.6, 1], C.gold);
    box(ctx, [17, 13, 2, 3.6, 0.6], C.goldDeep); box(ctx, [13.8, 13, 2, 2.6, 0.6], C.goldDeep);
  },
  /** 手に入れたばかり: クラッカーと紙吹雪 */
  party: (ctx) => {
    poly(ctx, [3, 21, 8, 7.5, 16.5, 16], C.coral); poly(ctx, [5.2, 15, 7, 10, 9.8, 13], C.gold); line(ctx, [11.5, 6.5, 13, 3.5], C.pink, 1.6);
    line(ctx, [16, 9, 20, 7], C.leaf, 1.6); line(ctx, [17.5, 13.5, 21, 14.5], C.sky, 1.6); dot(ctx, 14.5, 5.5, 1.1, C.gold); dot(ctx, 19.5, 11, 1.1, C.pink);
  },
  /** なし: 斜線の丸 */
  none: (ctx) => { ctx.strokeStyle = C.gray; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(12, 12, 7.5, 0, Math.PI * 2); ctx.stroke(); line(ctx, [6.8, 17.2, 17.2, 6.8], C.gray, 2); },
  /** 身につけている: 黒丸に白いチェック */
  check: (ctx) => {
    const g = ctx.createLinearGradient(0, 2, 0, 22); g.addColorStop(0, PALETTE.brand); g.addColorStop(1, PALETTE.brandInk);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(12, 12, 10, 0, Math.PI * 2); ctx.fill(); line(ctx, [7, 12.4, 10.6, 16, 17.2, 8.6], C.white, 2.6);
  },
  /** 称号の札（ピックアップ） */
  tag: (ctx) => {
    poly(ctx, [3, 12, 9, 5, 21, 5, 21, 19, 9, 19], C.gold); dot(ctx, 8.5, 12, 1.8, C.white); box(ctx, [12, 9.5, 6.5, 1.8, 0.9], C.goldDeep); box(ctx, [12, 12.7, 4.5, 1.8, 0.9], C.goldDeep);
  },
};

/**
 * アイコンを描いた canvas を作る。
 * @param name アイコンの名前
 * @param size 一辺（CSS px）
 * @param className 追加のクラス名
 * @returns canvas（読み上げは隠す。意味は隣の文字で伝える）
 */
export function createAvatarIcon(name: AvatarIconName, size: number, className?: string): HTMLCanvasElement {
  const log = logger.fn('createAvatarIcon', { name, size });
  const dpr = normalizeDpr(window.devicePixelRatio);
  const canvas = h('canvas', { class: ['avatar-icon', `avatar-icon--${name}`, className], attrs: { width: Math.round(size * dpr), height: Math.round(size * dpr), 'aria-hidden': 'true' } });
  setStyle(canvas, 'width', `${size}px`);
  setStyle(canvas, 'height', `${size}px`);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.fail(canvas, '2D コンテキストを取得できません');
  ctx.setTransform((size * dpr) / 24, 0, 0, (size * dpr) / 24, 0, 0);
  PAINTERS[name](ctx);
  return log.exit(canvas);
}

/**
 * 小さなアイコンと文字を並べた行を作る（見出し・手に入れ方など）。
 * @param name アイコンの名前
 * @param text 文字
 * @param size アイコンの一辺（CSS px）
 * @returns 要素
 */
export function iconText(name: AvatarIconName, text: string, size = 16): HTMLElement {
  return h('span', { class: 'avatar-icon-text' }, [createAvatarIcon(name, size), h('span', { text })]);
}
