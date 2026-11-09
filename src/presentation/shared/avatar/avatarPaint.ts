/**
 * @file アバターの描画（presentation/shared/avatar。Canvas 描画の純粋関数）
 * キラキラ系の着せかえアバター（モバゲー風）を、部品ごとの描き方の表で重ねて描く。
 * - 大きな目（虹彩の縦グラデーション＋光3つ＋まつげ）、天使の輪のあるつやつやの髪、パステルの頬
 * - 黒い線は使わず、塗った部品を同じ形で「塗り色を暗くした色つき細線」で縁どる。服には斜めのつやと下端の影
 * - 頭（顔・髪・帽子）は (0, -31.5) を中心に 1.04 倍（体と脚はそのまま。約2.4頭身）
 * - 拡大率 0.6 未満（地図・小さいサムネ）では、副ハイライト・まつげの跳ね・頬の斜線・毛束・服のつや・部品の輪郭を省き、
 *   髪と顔の輪郭だけ太め（1.2）に描く
 * 重ね順: 影 → 相棒 → 背中のもの（羽）→ 後ろ髪 → 脚・ボトムス・くつ → トップス → 首まわり → 腕と持ち物 → 顔 → 前髪 → 髪かざり → 帽子。
 * 足元を原点に、上が負の y。拡大率1で高さ約70px。止まった絵（動き無し）は、拡大率1で x∈[-38, 30]、y∈[-76, 6] に収める
 * （地図のスプライト AVATAR_BOX と同じ範囲。相棒は左、持ち物は右手）。
 * 状態・タイマー・乱数は持たない。動きは呼び出し側が渡す経過秒から決める（docs/03 §7）。
 */
import { mixColors, parseHexColor } from '@/Common/ui/canvas/colorUtils';
import { DEFAULT_HAIR_COLOR, DEFAULT_OUTFIT_COLOR, DEFAULT_SKIN } from '@/presentation/shared/avatar/avatarLook';
import type {
  AccessoryStyle, AvatarHat, AvatarHeld, AvatarLook, AvatarMotion, AvatarPose, BottomStyle, EyeStyle, HairStyle, PetStyle, ShoeStyle, TopStyle,
} from '@/presentation/shared/avatar/avatarLook';
import { paintGear } from '@/presentation/shared/shopIcons';

/** アバターの位置と大きさ */
export interface AvatarPlacement {
  /** 足元の中心 X（CSS px） */
  readonly x: number;
  /** 足元の Y（CSS px） */
  readonly y: number;
  /** 拡大率（1 で高さ約 70px。0.6 未満は細かい飾りを省く） */
  readonly scale: number;
  /** 旧来の輪郭線の太さ（今の絵では使わない。互換のため残す） */
  readonly lineWidthPx?: number;
}

/** 切り抜きの範囲（アバター座標。拡大率1・足元が原点・上が負） */
interface FocusRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** アイテムの見本を切り抜く範囲（頭＝髪・顔・帽子（1.04倍込み）、体＝上半身と腕、脚＝腰から足元、全体＝相棒と持ち物を含む） */
export const AVATAR_FOCUS: Readonly<Record<'head' | 'body' | 'legs' | 'full', FocusRect>> = Object.freeze({
  head: Object.freeze({ x: -24, y: -77, w: 48, h: 46 }),
  body: Object.freeze({ x: -19, y: -41, w: 38, h: 33 }),
  legs: Object.freeze({ x: -14, y: -21, w: 28, h: 25 }),
  full: Object.freeze({ x: -38, y: -77, w: 69, h: 83 }),
});

type Ctx = CanvasRenderingContext2D;
/** 塗り（色かグラデーション） */
type Fill = string | CanvasGradient;
/** パスを作る関数（塗らない） */
type PathBuilder = (ctx: Ctx) => void;
/** 角丸矩形（x・y・幅・高さ・角丸） */
type R5 = readonly [number, number, number, number, number];
/** 楕円（中心 X・中心 Y・横半径・縦半径） */
type E4 = readonly [number, number, number, number];

/** 既定値を埋めた装い */
interface Wear {
  readonly hair: HairStyle;
  readonly hairColor: string;
  readonly eyes: EyeStyle;
  readonly skin: string;
  readonly top: TopStyle;
  readonly outfit: string;
  readonly bottom: BottomStyle;
  readonly shoes: ShoeStyle;
  readonly held: AvatarHeld;
  readonly hat?: AvatarHat;
  readonly accessory?: AccessoryStyle;
  readonly pet?: PetStyle;
}

/** 1コマの動きと描き込みの細かさ */
interface Frame {
  readonly pose: AvatarPose;
  readonly t: number;
  /** 動きあり（ステージ）。false なら止まった絵 */
  readonly animated: boolean;
  /** 呼吸の上下（アバター座標） */
  readonly bob: number;
  /** ジャンプの高さ（0 以上） */
  readonly lift: number;
  /** まばたき中 */
  readonly blink: boolean;
  /** 細かい飾りを描く（拡大率 0.6 以上） */
  readonly fine: boolean;
  /** 部品の輪郭の太さ（縮小時は 0） */
  readonly ol: number;
  /** 髪の輪郭の太さ */
  readonly hairOl: number;
  /** 顔の輪郭の太さ */
  readonly faceOl: number;
}

/** 色（黒は使わない。線は濃いプラム系か、塗り色を暗くした色） */
const INK = '#111827';
const LASH = '#3A2340';
const FACE_LINE = 'rgba(201, 133, 121, 0.85)';
const MOUTH_OPEN = '#D9466F';
const TONGUE = '#FF9BB5';
const MOUTH_LINE = '#C24E6E';
const CHEEK_SLASH = 'rgba(255, 127, 168, 0.7)';
const WHITE = '#ffffff';
const OFF_WHITE = '#fbfaf7';
const CREAM = '#f3ead7';
const PINK = '#FF5FA2';
const LAVENDER = '#C9A2FF';
const SKY = '#9ADFFF';
const LEMON = '#FFE58A';
const GOLD = '#F6C64F';
const GOLD_DEEP = '#D9A23A';
const RED = '#e0453a';
const GLITTER = ['#FFFFFF', '#FFD6EC', '#FFE58A', '#D9C8FF', '#BDEBFF'];
const RAINBOW = ['#FF6FB5', '#FFC94D', '#7CE38B', '#5CC8FF', '#A98BFF'];
/** 服のつや・影 */
const SHEEN = 'rgba(255, 255, 255, 0.35)';
const SHEEN_END = 'rgba(255, 255, 255, 0)';
const SHADE_SOFT = 'rgba(74, 35, 80, 0.12)';
/** つやの向き（CSS の 160deg） */
const SHEEN_ANGLE = (160 * Math.PI) / 180;

/** 頭（中心と半径） */
const HEAD_Y = -46;
const HEAD_RX = 15.5;
const HEAD_RY = 14.6;
/** 頭のまとまり（顔・髪・帽子）の拡大の中心と倍率 */
const HEAD_PIVOT_Y = -31.5;
const HEAD_SCALE = 1.04;
/** 目の位置 */
const EYE_X = 6.2;
const EYE_Y = -44.6;
/** 肩と右手（持ち物を持つ手） */
const SHOULDER_L: readonly [number, number] = [-8.6, -30.5];
const SHOULDER_R: readonly [number, number] = [8.6, -30.5];
const HAND_R: readonly [number, number] = [12.8, -17.5];
/** 相棒の位置（足元の X） */
const PET_X = -27;
/** まばたきの周期と閉じている長さ（秒） */
const BLINK_PERIOD_S = 3.2;
const BLINK_CLOSED_S = 0.12;
/** 止まった絵で、いちばん上が超えてはいけない高さ（拡大後） */
const TOP_LIMIT = -76;
/** 頭のまとまりの中（拡大前）での上限 */
const HAT_LIMIT = HEAD_PIVOT_Y + (TOP_LIMIT - HEAD_PIVOT_Y) / HEAD_SCALE;
/** これ未満の拡大率では細かい飾りを省く */
const DETAIL_MIN_SCALE = 0.6;

// ---------------------------------------------------------------------------
// 基本の図形
// ---------------------------------------------------------------------------

/**
 * 暗い色に寄せる（面の影・輪郭線）。
 * @param c 元の色
 * @param t 寄せる割合 0..1
 * @returns 色
 */
function shade(c: string, t: number): string {
  return mixColors(c, INK, t);
}

/**
 * 白に寄せる（面のハイライト）。
 * @param c 元の色
 * @param t 寄せる割合 0..1
 * @returns 色
 */
function tint(c: string, t: number): string {
  return mixColors(c, WHITE, t);
}

/**
 * 暗い色か（輝度 0.3 未満）。天使の輪の色を変えるのに使う。
 * @param c 色 '#rrggbb'
 * @returns 暗ければ true
 */
function isDark(c: string): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
  const rgb = parseHexColor(c);
  if (rgb === undefined) return false;
  return (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) / 255 < 0.3;
}

/**
 * 点の並び（x0, y0, x1, y1, …）をなぞる（moveTo → lineTo）。
 * @param ctx 描画先
 * @param pts 点の並び
 */
function tracePoints(ctx: Ctx, pts: readonly number[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i] ?? 0;
    const y = pts[i + 1] ?? 0;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/**
 * 区間の並びをなぞる（2つは lineTo、4つは quadraticCurveTo の制御点と終点）。
 * @param ctx 描画先（パスの途中）
 * @param segs 区間の並び
 */
function traceSegs(ctx: Ctx, segs: readonly (readonly number[])[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (const s of segs) {
    if (s.length >= 4) ctx.quadraticCurveTo(s[0] ?? 0, s[1] ?? 0, s[2] ?? 0, s[3] ?? 0);
    else ctx.lineTo(s[0] ?? 0, s[1] ?? 0);
  }
}

/**
 * 角丸矩形のパスを作る。
 * @param ctx 描画先
 * @param r 角丸矩形
 */
function boxPath(ctx: Ctx, r: R5): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  ctx.roundRect(r[0], r[1], r[2], r[3], Math.max(0, Math.min(r[4], r[2] / 2, r[3] / 2)));
}

/**
 * 楕円のパスを作る。
 * @param ctx 描画先
 * @param e 楕円
 * @param rot 回転（ラジアン）
 */
function ovalPath(ctx: Ctx, e: E4, rot = 0): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  ctx.ellipse(e[0], e[1], e[2], e[3], rot, 0, Math.PI * 2);
}

/**
 * 円のパスを作る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 半径
 */
function circlePath(ctx: Ctx, x: number, y: number, r: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/**
 * 多角形のパスを作る。
 * @param ctx 描画先
 * @param pts 点の並び
 */
function polyPath(ctx: Ctx, pts: readonly number[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  tracePoints(ctx, pts);
  ctx.closePath();
}

/**
 * 今のパスを塗る。
 * @param ctx 描画先
 * @param fill 塗り
 */
function fillWith(ctx: Ctx, fill: Fill): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * 角丸矩形を塗る。
 * @param ctx 描画先
 * @param r 角丸矩形
 * @param fill 塗り
 */
function box(ctx: Ctx, r: R5, fill: Fill): void { // audit-ignore: fnlog-missing 毎フレーム描画
  boxPath(ctx, r);
  fillWith(ctx, fill);
}

/**
 * 円を塗る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 半径
 * @param fill 塗り
 */
function dot(ctx: Ctx, x: number, y: number, r: number, fill: Fill): void { // audit-ignore: fnlog-missing 毎フレーム描画
  circlePath(ctx, x, y, r);
  fillWith(ctx, fill);
}

/**
 * 楕円を塗る。
 * @param ctx 描画先
 * @param e 楕円
 * @param fill 塗り
 * @param rot 回転（ラジアン）
 */
function oval(ctx: Ctx, e: E4, fill: Fill, rot = 0): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ovalPath(ctx, e, rot);
  fillWith(ctx, fill);
}

/**
 * 多角形を塗る。
 * @param ctx 描画先
 * @param pts 点の並び
 * @param fill 塗り
 */
function poly(ctx: Ctx, pts: readonly number[], fill: Fill): void { // audit-ignore: fnlog-missing 毎フレーム描画
  polyPath(ctx, pts);
  fillWith(ctx, fill);
}

/**
 * 今のパスに色つきの細い輪郭を引く（太さ 0 なら引かない）。
 * @param ctx 描画先
 * @param color 線の色
 * @param width 線の太さ
 */
function edge(ctx: Ctx, color: string, width: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (width <= 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * 角丸矩形を塗って縁どる（部品用。縮小時は縁どらない）。
 * @param ctx 描画先
 * @param r 角丸矩形
 * @param fill 塗り色
 * @param f 描き込みの細かさ
 */
function boxO(ctx: Ctx, r: R5, fill: string, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  box(ctx, r, fill);
  edge(ctx, shade(fill, 0.4), f.ol);
}

/**
 * 円を塗って縁どる（部品用）。
 * @param ctx 描画先
 * @param c 中心 X・中心 Y・半径
 * @param fill 塗り色
 * @param f 描き込みの細かさ
 */
function dotO(ctx: Ctx, c: readonly [number, number, number], fill: string, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  dot(ctx, c[0], c[1], c[2], fill);
  edge(ctx, shade(fill, 0.4), f.ol);
}

/**
 * 楕円を塗って縁どる（部品用）。
 * @param ctx 描画先
 * @param e 楕円
 * @param fill 塗り色
 * @param f 描き込みの細かさ
 * @param rot 回転（ラジアン）
 */
function ovalO(ctx: Ctx, e: E4, fill: string, f: Frame, rot = 0): void { // audit-ignore: fnlog-missing 毎フレーム描画
  oval(ctx, e, fill, rot);
  edge(ctx, shade(fill, 0.4), f.ol);
}

/**
 * 多角形を塗って縁どる（部品用）。
 * @param ctx 描画先
 * @param pts 点の並び
 * @param fill 塗り色
 * @param f 描き込みの細かさ
 */
function polyO(ctx: Ctx, pts: readonly number[], fill: string, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  poly(ctx, pts, fill);
  edge(ctx, shade(fill, 0.4), f.ol);
}

/**
 * 折れ線を引く（端は丸）。
 * @param ctx 描画先
 * @param pts 点の並び（x0, y0, x1, y1, …）
 * @param color 線の色
 * @param width 線の太さ
 */
function line(ctx: Ctx, pts: readonly number[], color: string, width: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  tracePoints(ctx, pts);
  ctx.stroke();
}

/**
 * 太い線（腕・柄・棒）を縁どりつきで引く（縁の線を先に太く引き、その上に本体を引く）。
 * @param ctx 描画先
 * @param pts 点の並び
 * @param color 線の色
 * @param width 線の太さ
 * @param f 描き込みの細かさ
 * @param lineColor 縁の色（省略で線の色を暗くした色）
 */
function lineO(ctx: Ctx, pts: readonly number[], color: string, width: number, f: Frame, lineColor?: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (f.ol > 0) line(ctx, pts, lineColor ?? shade(color, 0.4), width + f.ol * 2);
  line(ctx, pts, color, width);
}

/**
 * いくつかの形をひとつのシルエットとして塗る（外側だけ縁どる。まず全部を太い線でなぞり、その上を全部塗る）。
 * @param ctx 描画先
 * @param pieces 形のパスを作る関数の並び
 * @param fill 塗り
 * @param lineColor 縁の色
 * @param width 縁の太さ（0 なら縁どらない）
 */
function paintPieces(ctx: Ctx, pieces: readonly PathBuilder[], fill: Fill, lineColor: string, width: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (width > 0) {
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = width * 2;
    ctx.lineJoin = 'round';
    for (const p of pieces) { p(ctx); ctx.stroke(); }
  }
  ctx.fillStyle = fill;
  for (const p of pieces) { p(ctx); ctx.fill(); }
}

/**
 * パスで切り抜いて描く。
 * @param ctx 描画先
 * @param build 切り抜きのパスを作る関数
 * @param paint 切り抜きの中で描く処理
 */
function clipped(ctx: Ctx, build: PathBuilder, paint: () => void): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  build(ctx);
  ctx.clip();
  paint();
  ctx.restore();
}

/**
 * 服のつや（160度の白いグラデーション、45% まで）と下端30%の影を、矩形に描く（呼び出し側で切り抜いておく）。
 * @param ctx 描画先
 * @param r x・y・幅・高さ
 * @param f 描き込みの細かさ（縮小時は描かない）
 */
function sheenIn(ctx: Ctx, r: readonly [number, number, number, number], f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (!f.fine) return;
  const dx = Math.sin(SHEEN_ANGLE);
  const dy = -Math.cos(SHEEN_ANGLE);
  const half = (Math.abs(r[2] * dx) + Math.abs(r[3] * dy)) / 2;
  const cx = r[0] + r[2] / 2;
  const cy = r[1] + r[3] / 2;
  const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  g.addColorStop(0, SHEEN);
  g.addColorStop(0.45, SHEEN_END);
  ctx.fillStyle = g;
  ctx.fillRect(r[0], r[1], r[2], r[3]);
  ctx.fillStyle = SHADE_SOFT;
  ctx.fillRect(r[0], r[1] + r[3] * 0.7, r[2], r[3] * 0.3);
}

/**
 * 角丸矩形の服（ズボンの脚など）につやを描く。
 * @param ctx 描画先
 * @param r 角丸矩形
 * @param f 描き込みの細かさ
 */
function sheenBox(ctx: Ctx, r: R5, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (!f.fine) return;
  clipped(ctx, (c) => boxPath(c, r), () => sheenIn(ctx, [r[0], r[1], r[2], r[3]], f));
}

/**
 * 多角形の服（スカートなど）につやを描く。
 * @param ctx 描画先
 * @param pts 点の並び
 * @param r つやを描く範囲
 * @param f 描き込みの細かさ
 */
function sheenPoly(ctx: Ctx, pts: readonly number[], r: readonly [number, number, number, number], f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (!f.fine) return;
  clipped(ctx, (c) => polyPath(c, pts), () => sheenIn(ctx, r, f));
}

/**
 * 5つの角の星形を塗る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 外側の半径
 * @param fill 塗り色
 */
function star(ctx: Ctx, x: number, y: number, r: number, fill: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  fillWith(ctx, fill);
}

/**
 * 4点の星（きらめき）を塗る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 半径
 * @param fill 塗り色
 */
function sparkle4(ctx: Ctx, x: number, y: number, r: number, fill: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const k = r * 0.24;
  poly(ctx, [x, y - r, x + k, y - k, x + r, y, x + k, y + k, x, y + r, x - k, y + k, x - r, y, x - k, y - k], fill);
}

/**
 * 小さな花（花びら5枚＋芯）を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 花びらの半径
 * @param petal 花びらの色
 */
function flower(ctx: Ctx, x: number, y: number, r: number, petal: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    dot(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.85, petal);
  }
  dot(ctx, x, y, r * 0.6, LEMON);
}

/**
 * ハートのパスを作る。
 * @param ctx 描画先
 * @param cx 中心 X
 * @param cy 中心 Y
 * @param s 大きさ
 */
function heartPath(ctx: Ctx, cx: number, cy: number, s: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.3, cy + s * 0.1, cx - s * 0.9, cy - s * 1.05, cx, cy - s * 0.35);
  ctx.bezierCurveTo(cx + s * 0.9, cy - s * 1.05, cx + s * 1.3, cy + s * 0.1, cx, cy + s * 0.9);
  ctx.closePath();
}

/**
 * またたき（動きがあれば明滅、止まった絵なら 1）。
 * @param f 動き
 * @param phase 位相
 * @returns 大きさの倍率 0.55..1
 */
function twinkle(f: Frame, phase: number): number {
  return f.animated ? 0.55 + 0.45 * Math.abs(Math.sin(f.t * 3 + phase)) : 1;
}

/**
 * 円のパスを作る関数を返す（表の定義用）。
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 半径
 * @returns パスを作る関数
 */
function circ(x: number, y: number, r: number): PathBuilder {
  return (ctx) => circlePath(ctx, x, y, r);
}

/**
 * 楕円のパスを作る関数を返す（表の定義用）。
 * @param e 楕円
 * @param rot 回転
 * @returns パスを作る関数
 */
function ell(e: E4, rot = 0): PathBuilder {
  return (ctx) => ovalPath(ctx, e, rot);
}

/**
 * 多角形のパスを作る関数を返す（表の定義用）。
 * @param pts 点の並び
 * @returns パスを作る関数
 */
function pg(pts: readonly number[]): PathBuilder {
  return (ctx) => polyPath(ctx, pts);
}

/**
 * 角丸矩形のパスを作る関数を返す（表の定義用）。
 * @param r 角丸矩形
 * @returns パスを作る関数
 */
function rr(r: R5): PathBuilder {
  return (ctx) => boxPath(ctx, r);
}

/**
 * 頭のまとまり（顔・髪・帽子）を (0, -31.5) 中心に 1.04 倍して描く。
 * @param ctx 描画先
 * @param paint 描く処理
 */
function withHeadScale(ctx: Ctx, paint: () => void): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.translate(0, HEAD_PIVOT_Y);
  ctx.scale(HEAD_SCALE, HEAD_SCALE);
  ctx.translate(0, -HEAD_PIVOT_Y);
  paint();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 髪
// ---------------------------------------------------------------------------

/**
 * 頭の上半分を覆う髪の外形を始める（左のこめかみ → 頭頂 → 右のこめかみ）。続けて前髪の線を右から左へなぞる。
 * @param ctx 描画先
 * @param side こめかみの高さ
 * @param top 頭頂の高さ
 * @param width こめかみの横位置（左右対称）
 */
function capOutline(ctx: Ctx, side = -42, top = -63.5, width = 16.6): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  ctx.moveTo(-width, side);
  ctx.bezierCurveTo(-width - 1.4, -57, -9.5, top, 0, top);
  ctx.bezierCurveTo(9.5, top, width + 1.4, -57, width, side);
}

/**
 * 頭頂＋前髪のパスを作る関数を返す（表の定義用）。
 * @param segs 前髪の線（右のこめかみから左へ）
 * @returns パスを作る関数
 */
function cap(segs: readonly (readonly number[])[]): PathBuilder {
  return (ctx) => { capOutline(ctx); traceSegs(ctx, segs); ctx.closePath(); };
}

/**
 * ポニーテールの房のパスを作る。
 * @param ctx 描画先
 */
function ponytailPath(ctx: Ctx): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  ctx.moveTo(9, -60);
  ctx.quadraticCurveTo(26, -58, 23, -44);
  ctx.quadraticCurveTo(21, -32, 16, -24);
  ctx.quadraticCurveTo(18, -36, 12, -46);
  ctx.closePath();
}

/**
 * ツインテールの片方の房のパスを作る関数を返す。
 * @param s 左 -1 ／右 1
 * @returns パスを作る関数
 */
function twinTail(s: number): PathBuilder { // audit-ignore: fnlog-missing 毎フレーム描画
  return (ctx) => {
    ctx.beginPath(); ctx.moveTo(s * 12, -56); ctx.quadraticCurveTo(s * 25, -52, s * 22, -38); ctx.quadraticCurveTo(s * 20, -28, s * 16, -23);
    ctx.quadraticCurveTo(s * 19, -35, s * 14, -46); ctx.closePath();
  };
}

/**
 * アフロの頭頂＋前髪のパスを作る。
 * @param ctx 描画先
 */
function afroCapPath(ctx: Ctx): void { // audit-ignore: fnlog-missing 毎フレーム描画
  capOutline(ctx, -44, -66, 18);
  traceSegs(ctx, [[16, -55, 12.6, -51.6], [9, -55, 6, -51.6], [3, -55, -0.5, -51.6], [-4, -55, -7, -51.6], [-10.5, -55, -13.4, -51.6], [-17, -54, -18, -44]]);
  ctx.closePath();
}

/** 後ろ髪の基本（頭より少し大きい楕円） */
const BACK_BASE = ell([0, -47.4, 17, 16.2]);
/** くせ毛の後ろの房の位置 */
const CURLY_BACK = [[-17, -38], [-18.6, -45], [-17, -53], [-12, -59.6], [-4.6, -63], [4.6, -63], [12, -59.6], [17, -53], [18.6, -45], [17, -38]] as const;
/** みつあみの最初の編み目の Y */
const BRAID_TOP_Y = -40;
/** アフロのまわりの房（12個） */
const AFRO_BUMPS: readonly PathBuilder[] = Array.from({ length: 12 }, (_, i) => circ(Math.cos((i * Math.PI) / 6) * 18.6, -51 + Math.sin((i * Math.PI) / 6) * 18.6, 4.6));

/** 後ろ髪（体より奥に描く。形の並び） */
const HAIR_BACK: Readonly<Record<HairStyle, readonly PathBuilder[]>> = {
  short: [BACK_BASE],
  bob: [rr([-18.6, -63.6, 37.2, 29.4, 16])],
  long: [rr([-18.6, -63.6, 37.2, 44, 14])],
  ponytail: [BACK_BASE, ponytailPath],
  bun: [BACK_BASE, circ(0, -64.6, 6.2)],
  twintail: [BACK_BASE, twinTail(-1), twinTail(1)],
  curly: [BACK_BASE, ...CURLY_BACK.map(([x, y]) => circ(x, y, 4.8))],
  spiky: [BACK_BASE],
  sidepart: [ell([0, -47.6, 16.6, 16])],
  wolf: [BACK_BASE, pg([-17.5, -50, -18.6, -37, -16, -39.6, -15.6, -32, -12.6, -35.6, 12.6, -35.6, 15.6, -32, 16, -39.6, 18.6, -37, 17.5, -50])],
  braid: [BACK_BASE],
  afro: [circ(0, -51, 19.6), ...AFRO_BUMPS],
};

/** とがった髪（つんつん）の外形 */
const SPIKY_PATH = [
  -16.6, -42, -18, -55, -15.5, -59, -16.5, -66, -10, -62.5, -6.5, -70, -1.5, -64, 3.5, -70.5, 6.5, -63.5, 12, -67.5, 12, -60.5, 17.8, -59.5,
  16.6, -42, 13, -49.4, 10, -52.5, 7, -49, 3, -52.8, -1, -49, -5, -52.8, -9, -49.2, -12.2, -52.2, -15, -48,
];

/** 前髪（顔より手前に描く。最初の形が天使の輪の切り抜きになる） */
const HAIR_FRONT: Readonly<Record<HairStyle, readonly PathBuilder[]>> = {
  short: [cap([[15.6, -48, 12, -50.5], [8, -54, 3, -50], [-1, -53.6, -6, -50.6], [-11, -53.4, -14.6, -49], [-16.4, -46, -16.6, -42]])],
  bob: [cap([[16.8, -35.5], [13.4, -35.5], [13.4, -49.6], [0, -47.6, -13.4, -49.6], [-13.4, -35.5], [-16.8, -35.5]])],
  long: [cap([[17.2, -30], [13.2, -30], [12.6, -46, 1.2, -58], [-12.6, -46, -13.2, -30], [-17.2, -30]])],
  ponytail: [cap([[14, -49, 9, -51], [4, -56, -2, -51.5], [-8, -55.5, -14, -49], [-16.5, -46, -16.6, -42]])],
  bun: [cap([[15.4, -51, 10, -53.6], [0, -57.6, -10, -53.6], [-15.4, -51, -16.6, -42]])],
  twintail: [cap([[15.8, -48], [0, -50, -15.8, -48]])],
  curly: [cap([[15.8, -50], [-15.8, -50]]), ...[-12, -6, 0, 6, 12].map((x) => circ(x, -52, 3.6))],
  spiky: [pg(SPIKY_PATH)],
  sidepart: [cap([[16.4, -46], [10, -49.6, 3, -52], [-2, -54.6, -5, -59], [-9, -54, -13, -52], [-16, -48, -16.6, -42]])],
  wolf: [cap([[15.6, -47], [12.6, -46.6], [11, -51], [7.6, -48.8], [5, -52], [1, -48.6], [-2, -52], [-5.6, -48.8], [-8, -52], [-11.6, -47.8], [-13, -51], [-16, -44.5]])],
  braid: [
    cap([[16.8, -38], [13.4, -52, 1, -58.4], [-13.4, -52, -16.8, -38]]),
    ...Array.from({ length: 6 }, (_, i) => ell([-14.6 + (i % 2 === 0 ? 0.7 : -0.7), BRAID_TOP_Y + i * 3.3, 2.8, 2.2], i % 2 === 0 ? 0.5 : -0.5)),
    pg([-16.2, -20, -13.4, -20, -14.8, -16.6]),
  ],
  afro: [afroCapPath, circ(-12, -63, 4.2), circ(-4, -66.4, 4.2), circ(4, -66.4, 4.2), circ(12, -63, 4.2)],
};

/** 髪かざり（結び目など。後ろ髪を塗ったあとに描く） */
const HAIR_BACK_DECOR: Readonly<Partial<Record<HairStyle, (ctx: Ctx, c: string, f: Frame) => void>>> = {
  ponytail: (ctx, c, f) => dotO(ctx, [15, -56.4, 2.1], PINK, f),
  bun: (ctx, c, f) => {
    dot(ctx, -1.6, -66.6, 1.6, tint(c, 0.35));
    boxO(ctx, [-4.4, -60.4, 8.8, 2, 1], PINK, f);
  },
  twintail: (ctx, c, f) => {
    dotO(ctx, [-14.6, -55, 2.2], PINK, f);
    dotO(ctx, [14.6, -55, 2.2], PINK, f);
  },
};

/** 前髪のかざり */
const HAIR_FRONT_DECOR: Readonly<Partial<Record<HairStyle, (ctx: Ctx, c: string, f: Frame) => void>>> = {
  sidepart: (ctx, c) => line(ctx, [-5, -59, -4, -62.6], shade(c, 0.3), 0.9),
  braid: (ctx, c, f) => {
    for (let i = 1; i < 6; i++) line(ctx, [-16.6, -41.6 + i * 3.3, -12.6, -40.2 + i * 3.3], shade(c, 0.25), 0.5);
    dotO(ctx, [-14.8, -20.8, 1.5], PINK, f);
  },
};

/**
 * 前髪の縦グラデーション（上が明るく、毛先が暗い）を作る。
 * @param ctx 描画先
 * @param c 髪の色
 * @returns グラデーション
 */
function hairGradient(ctx: Ctx, c: string): CanvasGradient { // audit-ignore: fnlog-missing 毎フレーム描画
  const g = ctx.createLinearGradient(0, -64, 0, -36);
  g.addColorStop(0, tint(c, 0.1));
  g.addColorStop(1, shade(c, 0.18));
  return g;
}

/**
 * 天使の輪（破線の明るい帯＋白い細線＋4点の星）を描く。前髪の形で切り抜いてから呼ぶ。
 * @param ctx 描画先
 * @param c 髪の色（暗い髪は青白い輪）
 */
function angelRing(ctx: Ctx, c: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const dark = isDark(c);
  ctx.save();
  ctx.setLineDash([6, 1.5, 3, 1.5]);
  ctx.lineCap = 'butt';
  ctx.globalAlpha = dark ? 0.7 : 0.8;
  ctx.strokeStyle = dark ? '#B9C3FF' : tint(c, 0.6);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(0, -52, 12.5, 5, 0, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();
  sparkle4(ctx, -7, -56, 1.2, WHITE);
}

/**
 * 毛束の線（頭頂から前髪の先へ）を描く。
 * @param ctx 描画先
 * @param c 髪の色
 */
function strands(ctx: Ctx, c: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const col = shade(c, 0.3);
  line(ctx, [-2, -62.5, -5, -51.5], col, 0.6);
  line(ctx, [4, -62.5, 4.5, -51], col, 0.6);
  line(ctx, [9.5, -60, 11.5, -50.5], col, 0.6);
}

/**
 * 後ろ髪を描く（単色 shade(c, .22)、外側だけ縁どる）。
 * @param ctx 描画先
 * @param w 装い
 * @param f 描き込みの細かさ
 */
function paintBackHair(ctx: Ctx, w: Wear, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const c = w.hairColor;
  paintPieces(ctx, HAIR_BACK[w.hair], shade(c, 0.22), shade(c, 0.45), f.hairOl);
  HAIR_BACK_DECOR[w.hair]?.(ctx, c, f);
}

/**
 * 前髪を描く（縦グラデーション・外側の縁・天使の輪・毛束・かざり）。
 * @param ctx 描画先
 * @param w 装い
 * @param f 描き込みの細かさ
 */
function paintFrontHair(ctx: Ctx, w: Wear, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const c = w.hairColor;
  const pieces = HAIR_FRONT[w.hair];
  paintPieces(ctx, pieces, hairGradient(ctx, c), shade(c, 0.45), f.hairOl);
  const main = pieces[0];
  if (main !== undefined) {
    clipped(ctx, main, () => {
      angelRing(ctx, c);
      if (f.fine) strands(ctx, c);
    });
  }
  HAIR_FRONT_DECOR[w.hair]?.(ctx, c, f);
}

// ---------------------------------------------------------------------------
// 顔
// ---------------------------------------------------------------------------

/** 開いた目の形と虹彩の色 */
interface EyeSpec {
  readonly rx: number;
  readonly ry: number;
  readonly iris: string;
  /** 瞳孔の代わりに星を描く */
  readonly starPupil?: boolean;
}

/** 目を描く関数（描画先・目の X・左右・描き込み） */
type EyePainter = (ctx: Ctx, x: number, side: -1 | 1, f: Frame) => void;

/** 目の種類ごとの形（開いた目） */
const ROUND_EYE: EyeSpec = { rx: 2.9, ry: 3.6, iris: '#6B3F2A' };
const CALM_EYE: EyeSpec = { rx: 2.84, ry: 2.16, iris: '#3F5E8C' };
const SHARP_EYE: EyeSpec = { rx: 2.84, ry: 2.6, iris: '#7A2E3B' };
const SLEEPY_EYE: EyeSpec = { rx: 2.97, ry: 2.97, iris: '#6B3F2A' };
const SPARKLE_EYE: EyeSpec = { rx: 3, ry: 3.8, iris: '#7C5CC4' };
const STAR_EYE: EyeSpec = { rx: 2.9, ry: 3.6, iris: '#B7791F', starPupil: true };

/**
 * 目じりの跳ね（外側上向き35°）を描く。
 * @param ctx 描画先
 * @param x 目じりの X
 * @param y 目じりの Y
 * @param side 左 -1 ／右 1
 */
function lashFlick(ctx: Ctx, x: number, y: number, side: -1 | 1): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const a = (35 * Math.PI) / 180;
  line(ctx, [x, y, x + side * Math.cos(a) * 1.6, y - Math.sin(a) * 1.6], LASH, 0.9);
}

/**
 * 上まつげ（楕円の弧）と目じりの跳ね・下の点を描く。
 * @param ctx 描画先
 * @param x 目の X
 * @param side 左 -1 ／右 1
 * @param e 目の形
 * @param f 描き込みの細かさ
 */
function upperLash(ctx: Ctx, x: number, side: -1 | 1, e: EyeSpec, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const rx = e.rx + 0.25;
  const ry = e.ry + 0.25;
  ctx.strokeStyle = LASH; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(x, EYE_Y, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  const a = side < 0 ? Math.PI * 1.05 : Math.PI * 1.95;
  if (f.fine) lashFlick(ctx, x + Math.cos(a) * rx, EYE_Y + Math.sin(a) * ry, side);
  dot(ctx, x + side * e.rx * 0.95, EYE_Y + e.ry * 0.45, 0.5, LASH);
}

/**
 * キラキラの開いた目（虹彩の縦グラデーション・瞳孔・照り返し・光3つ・まつげ）を描く。
 * @param ctx 描画先
 * @param x 目の X
 * @param side 左 -1 ／右 1
 * @param e 目の形と虹彩の色
 * @param f 描き込みの細かさ
 */
function kiraEye(ctx: Ctx, x: number, side: -1 | 1, e: EyeSpec, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const y = EYE_Y;
  const g = ctx.createLinearGradient(0, y - e.ry, 0, y + e.ry);
  g.addColorStop(0, shade(e.iris, 0.55));
  g.addColorStop(0.5, e.iris);
  g.addColorStop(1, tint(e.iris, 0.5));
  oval(ctx, [x, y, e.rx, e.ry], g);
  if (e.starPupil === true) star(ctx, x, y + 0.3, e.rx * 0.7, LEMON);
  else oval(ctx, [x, y, e.rx * 0.45, e.ry * 0.55], shade(e.iris, 0.7));
  ctx.strokeStyle = tint(e.iris, 0.75); ctx.lineWidth = 0.7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(x, y, e.rx * 0.72, e.ry * 0.72, 0, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  oval(ctx, [x + e.rx * 0.32, y - e.ry * 0.36, e.rx * 0.4, e.ry * 0.3], WHITE);
  if (f.fine) dot(ctx, x - e.rx * 0.38, y + e.ry * 0.42, e.rx * 0.16, WHITE);
  upperLash(ctx, x, side, e, f);
}

/**
 * 閉じた目（笑い目＝上向きの弧、まばたき＝下向きの弧）を、目じりの跳ねつきで描く。
 * @param ctx 描画先
 * @param x 目の X
 * @param side 左 -1 ／右 1
 * @param up true なら笑い目
 * @param f 描き込みの細かさ
 */
function closedEye(ctx: Ctx, x: number, side: -1 | 1, up: boolean, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const cy = up ? EYE_Y + 1.4 : EYE_Y - 1;
  const r = up ? 2.9 : 2.8;
  const a0 = up ? Math.PI * 1.15 : Math.PI * 0.15;
  const a1 = up ? Math.PI * 1.85 : Math.PI * 0.85;
  ctx.strokeStyle = LASH; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, cy, r, a0, a1); ctx.stroke();
  const outer = (side < 0) === up ? a0 : a1;
  if (f.fine) lashFlick(ctx, x + Math.cos(outer) * r, cy + Math.sin(outer) * r, side);
}

/** 目の種類ごとの描き方 */
const EYES: Readonly<Record<EyeStyle, EyePainter>> = {
  smile: (ctx, x, side, f) => closedEye(ctx, x, side, true, f),
  round: (ctx, x, side, f) => kiraEye(ctx, x, side, ROUND_EYE, f),
  calm: (ctx, x, side, f) => kiraEye(ctx, x, side, CALM_EYE, f),
  sharp: (ctx, x, side, f) => {
    kiraEye(ctx, x, side, SHARP_EYE, f);
    line(ctx, [x - side * 3, EYE_Y - 2.4, x + side * 3.1, EYE_Y - 3.6], LASH, 1.3);
    line(ctx, [x + side * 3.2, EYE_Y - 6.2, x - side * 3, EYE_Y - 4.8], shade('#7A2E3B', 0.2), 1);
  },
  sleepy: (ctx, x, side, f) => {
    ctx.save(); ctx.beginPath(); ctx.rect(x - 4, EYE_Y - 0.6, 8, 5); ctx.clip();
    kiraEye(ctx, x, side, SLEEPY_EYE, f);
    ctx.restore();
    line(ctx, [x - 3.3, EYE_Y - 0.6, x + 3.3, EYE_Y - 0.6], LASH, 1.4);
    if (f.fine) lashFlick(ctx, x + side * 3.3, EYE_Y - 0.6, side);
  },
  wink: (ctx, x, side, f) => {
    if (side < 0) kiraEye(ctx, x, side, ROUND_EYE, f);
    else line(ctx, [x - 2.8, EYE_Y - 2, x + 2, EYE_Y, x - 2.8, EYE_Y + 2], LASH, 1.5);
  },
  sparkle: (ctx, x, side, f) => {
    kiraEye(ctx, x, side, SPARKLE_EYE, f);
    sparkle4(ctx, x + 3.4, EYE_Y - 4, 1.3 * twinkle(f, x), LEMON);
  },
  star: (ctx, x, side, f) => kiraEye(ctx, x, side, STAR_EYE, f),
};

/** 口の種類 */
type MouthKind = 'small' | 'open' | 'smirk' | 'o';

/** 目の種類ごとの口 */
const MOUTH_OF: Readonly<Record<EyeStyle, MouthKind>> = {
  smile: 'open', round: 'small', calm: 'small', sharp: 'smirk', sleepy: 'o', wink: 'open', sparkle: 'open', star: 'small',
};

/**
 * 口を描く（開いた口は濃いピンク＋舌、線の口はローズ）。
 * @param ctx 描画先
 * @param kind 口の種類
 */
function paintMouth(ctx: Ctx, kind: MouthKind): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (kind === 'open') {
    ctx.beginPath(); ctx.arc(0, -39.2, 2.4, 0, Math.PI); ctx.closePath(); fillWith(ctx, MOUTH_OPEN);
    dot(ctx, 0, -37.7, 1.05, TONGUE);
    return;
  }
  if (kind === 'o') {
    oval(ctx, [0, -38.4, 1.1, 1.3], MOUTH_OPEN);
    return;
  }
  ctx.strokeStyle = MOUTH_LINE;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (kind === 'smirk') { ctx.moveTo(-1.8, -38.6); ctx.quadraticCurveTo(0.6, -37.6, 2.2, -39.4); }
  else ctx.arc(0, -39.8, 1.8, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
}

/**
 * 頬（ぼかしたピンクの楕円＋斜線3本）を描く。
 * @param ctx 描画先
 * @param x 頬の中心 X
 * @param f 描き込みの細かさ（縮小時は斜線を省く）
 */
function paintCheek(ctx: Ctx, x: number, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.translate(x, -39.4);
  ctx.scale(1, 1.7 / 3);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 3);
  g.addColorStop(0, 'rgba(255, 110, 150, 0.55)');
  g.addColorStop(1, 'rgba(255, 110, 150, 0)');
  dot(ctx, 0, 0, 3, g);
  ctx.restore();
  if (!f.fine) return;
  for (let i = 0; i < 3; i++) line(ctx, [x - 1.4 + i * 1.1, -38.9, x - 0.8 + i * 1.1, -39.95], CHEEK_SLASH, 0.45);
}

/** 顔の形（耳と頭） */
const EAR_L = circ(-15, -44.6, 2.8);
const EAR_R = circ(15, -44.6, 2.8);
const HEAD_SHAPE = ell([0, HEAD_Y, HEAD_RX, HEAD_RY]);

/**
 * 顔（耳・頭・前髪の下の影・頬・目・口）を描く。まばたき中は目を閉じる。ピースのポーズでは片目をつむる。
 * @param ctx 描画先
 * @param w 装い
 * @param f 動き
 */
function paintFace(ctx: Ctx, w: Wear, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  paintPieces(ctx, [EAR_L, EAR_R, HEAD_SHAPE], w.skin, FACE_LINE, f.faceOl);
  dot(ctx, -15.3, -44.6, 1.2, shade(w.skin, 0.08));
  dot(ctx, 15.3, -44.6, 1.2, shade(w.skin, 0.08));
  clipped(ctx, HEAD_SHAPE, () => {
    ctx.globalAlpha = 0.6;
    box(ctx, [-16, -55, 32, 4, 0], shade(w.skin, 0.08));
    ctx.globalAlpha = 1;
    oval(ctx, [0, -33.6, 6, 1.6], shade(w.skin, 0.06));
  });
  paintCheek(ctx, -10.4, f);
  paintCheek(ctx, 10.4, f);
  const eyes: EyeStyle = f.pose === 'peace' ? 'wink' : w.eyes;
  for (const side of [-1, 1] as const) {
    if (f.blink && eyes !== 'smile') closedEye(ctx, side * EYE_X, side, false, f);
    else EYES[eyes](ctx, side * EYE_X, side, f);
  }
  paintMouth(ctx, MOUTH_OF[eyes]);
}

// ---------------------------------------------------------------------------
// トップス
// ---------------------------------------------------------------------------

/**
 * 胴の外形のパスを作る。
 * @param ctx 描画先
 */
function torsoPath(ctx: Ctx): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  ctx.roundRect(-9.6, -33.5, 19.2, 21, [6.5, 6.5, 3, 3]);
}

/**
 * 胴を塗る（つやと縁は finishTorso で最後に入れる）。
 * @param ctx 描画先
 * @param fill 服の色
 */
function torso(ctx: Ctx, fill: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  torsoPath(ctx);
  fillWith(ctx, fill);
}

/**
 * 胴の形で切り抜いて描く（しま・前身ごろが胴からはみ出さないように）。
 * @param ctx 描画先
 * @param paint 切り抜きの中で描く処理
 */
function clipTorso(ctx: Ctx, paint: () => void): void {
  clipped(ctx, torsoPath, paint);
}

/**
 * 胴の仕上げ（斜めのつや・下端の影・色つきの縁）。
 * @param ctx 描画先
 * @param w 装い
 * @param f 描き込みの細かさ
 */
function finishTorso(ctx: Ctx, w: Wear, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  clipTorso(ctx, () => sheenIn(ctx, [-9.6, -33.5, 19.2, 21], f));
  torsoPath(ctx);
  edge(ctx, shade(w.outfit, 0.4), f.ol);
}

/**
 * 首元の肌（丸い襟ぐり）を描く。
 * @param ctx 描画先
 * @param skin 肌の色
 */
function neckNotch(ctx: Ctx, skin: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  ctx.arc(0, -33.5, 3.1, 0, Math.PI);
  fillWith(ctx, skin);
}

/**
 * 首元の肌（V の襟ぐり）を描く。
 * @param ctx 描画先
 * @param skin 肌の色
 * @param depth V の深さ
 */
function neckV(ctx: Ctx, skin: string, depth: number): void {
  poly(ctx, [-3.6, -33.5, 3.6, -33.5, 0, -33.5 + depth], skin);
}

/** トップスを描く関数（描画先・装い・描き込み） */
type TopPainter = (ctx: Ctx, w: Wear, f: Frame) => void;

/** エプロンの色 */
const APRON = '#4a6a9a';
/** ゆかたの水玉の位置 */
const YUKATA_DOTS = [-6, -29, -1, -26, 5, -28, -4, -20, 2, -18, 7, -22, -7, -15.5, 4.6, -15];
/** 晴れ着の花の位置 */
const KIMONO_FLOWERS = [-5.6, -27, 5.2, -19.6, -3.6, -16.6, 6, -29.6];

/** トップスの種類ごとの描き方 */
const TOPS: Readonly<Record<TopStyle, TopPainter>> = {
  tee: (ctx, w) => {
    torso(ctx, w.outfit);
    neckNotch(ctx, w.skin);
    star(ctx, 3.6, -24, 2.2, tint(w.outfit, 0.5));
  },
  hoodie: (ctx, w, f) => {
    ovalO(ctx, [0, -33, 11.2, 4.2], shade(w.outfit, 0.24), f);
    torso(ctx, w.outfit);
    neckNotch(ctx, w.skin);
    line(ctx, [-2.4, -31.6, -2.8, -25], WHITE, 0.9);
    line(ctx, [2.4, -31.6, 2.8, -25], WHITE, 0.9);
    box(ctx, [-6.2, -21.4, 12.4, 6.2, 2.2], shade(w.outfit, 0.1));
  },
  shirt: (ctx, w) => {
    torso(ctx, w.outfit);
    neckV(ctx, w.skin, 4.4);
    poly(ctx, [-4.8, -33.6, -0.4, -29, -1.2, -33.6], OFF_WHITE);
    poly(ctx, [4.8, -33.6, 0.4, -29, 1.2, -33.6], OFF_WHITE);
    line(ctx, [0, -29, 0, -13.4], shade(w.outfit, 0.18), 0.8);
    for (const y of [-26, -21.6, -17.2]) dot(ctx, 0.9, y, 0.7, OFF_WHITE);
  },
  border: (ctx, w) => {
    torso(ctx, OFF_WHITE);
    clipTorso(ctx, () => { for (const y of [-31, -27, -23, -19, -15]) box(ctx, [-10, y, 20, 1.9, 0], w.outfit); });
    neckNotch(ctx, w.skin);
  },
  knit: (ctx, w) => {
    torso(ctx, w.outfit);
    for (const x of [-4.8, 0, 4.8]) line(ctx, [x, -31, x + 1, -28.5, x, -26, x + 1, -23.5, x, -21, x + 1, -18.5, x, -16], tint(w.outfit, 0.28), 0.8);
    box(ctx, [-9.6, -15.4, 19.2, 2.8, 1.2], shade(w.outfit, 0.14));
    box(ctx, [-4.6, -34.4, 9.2, 2.6, 1.3], shade(w.outfit, 0.14));
    neckNotch(ctx, w.skin);
  },
  cardigan: (ctx, w) => {
    torso(ctx, OFF_WHITE);
    neckNotch(ctx, w.skin);
    clipTorso(ctx, () => {
      poly(ctx, [-10, -34, -2.6, -34, -1, -12, -10, -12], w.outfit);
      poly(ctx, [10, -34, 2.6, -34, 1, -12, 10, -12], w.outfit);
    });
    for (const y of [-26.6, -22, -17.4]) dot(ctx, -2.4, y, 0.8, shade(w.outfit, 0.3));
  },
  sailor: (ctx, w, f) => {
    torso(ctx, '#fbfbfd');
    neckV(ctx, w.skin, 5);
    polyO(ctx, [-9.4, -33.5, -3.6, -33.5, 0, -28.5, 3.6, -33.5, 9.4, -33.5, 7.6, -27.4, 0, -22.6, -7.6, -27.4], w.outfit, f);
    line(ctx, [-7, -28.6, 0, -24, 7, -28.6], WHITE, 0.7);
    polyO(ctx, [-2.6, -25.4, 2.6, -25.4, 0, -19.6], '#e2453c', f);
    dot(ctx, 0, -25.4, 1.3, shade('#e2453c', 0.15));
  },
  happi: (ctx, w) => {
    torso(ctx, w.outfit);
    neckV(ctx, w.skin, 5);
    clipTorso(ctx, () => {
      line(ctx, [-3.6, -34, -1.6, -11], '#1f2a4d', 3);
      line(ctx, [3.6, -34, 1.6, -11], '#1f2a4d', 3);
      for (const x of [-8, -4.4, 4.4, 8]) { ctx.strokeStyle = WHITE; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(x, -12.6, 1.8, Math.PI, 0); ctx.stroke(); }
    });
    for (const y of [-30, -25.6]) box(ctx, [-3.4, y, 1.2, 2.4, 0.4], WHITE);
  },
  yukata: (ctx, w, f) => {
    torso(ctx, w.outfit);
    for (let i = 0; i + 1 < YUKATA_DOTS.length; i += 2) dot(ctx, YUKATA_DOTS[i] ?? 0, YUKATA_DOTS[i + 1] ?? 0, 1, tint(w.outfit, 0.55));
    neckV(ctx, w.skin, 6.4);
    line(ctx, [-4.4, -33.6, 1.4, -24.6], OFF_WHITE, 1.6);
    line(ctx, [4.4, -33.6, -0.4, -27.6], OFF_WHITE, 1.6);
    boxO(ctx, [-9.7, -22.6, 19.4, 5, 1], '#d9465f', f);
    line(ctx, [-9.4, -20.1, 9.4, -20.1], '#ffe08a', 0.7);
  },
  jacket: (ctx, w) => {
    torso(ctx, w.outfit);
    poly(ctx, [-3.6, -33.6, 3.6, -33.6, 0, -24.4], OFF_WHITE);
    poly(ctx, [-3.6, -33.6, -6.6, -33, -2.2, -24.4, 0, -24.4], shade(w.outfit, 0.2));
    poly(ctx, [3.6, -33.6, 6.6, -33, 2.2, -24.4, 0, -24.4], shade(w.outfit, 0.2));
    dot(ctx, 0.9, -20, 0.9, shade(w.outfit, 0.35));
    line(ctx, [3.6, -18.4, 7, -18.4], shade(w.outfit, 0.25), 0.8);
  },
  stadium: (ctx, w) => {
    torso(ctx, w.outfit);
    neckNotch(ctx, w.skin);
    ctx.strokeStyle = CREAM; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(0, -33.5, 4.4, 0, Math.PI); ctx.stroke();
    box(ctx, [-9.6, -15.6, 19.2, 3, 1], CREAM);
    line(ctx, [-9.4, -14.1, 9.4, -14.1], w.outfit, 0.7);
    for (const y of [-27.6, -23.4, -19.2]) dot(ctx, 0, y, 0.7, CREAM);
    box(ctx, [-7.8, -29.4, 5.2, 5.8, 1.2], CREAM);
    line(ctx, [-6.2, -28.2, -6.2, -24.8, -4.2, -24.8], w.outfit, 0.9);
  },
  apron: (ctx, w, f) => {
    torso(ctx, w.outfit);
    neckNotch(ctx, w.skin);
    boxO(ctx, [-6.4, -30, 12.8, 17.4, 2.2], APRON, f);
    line(ctx, [-5.4, -30, -7, -33.6], APRON, 1.2);
    line(ctx, [5.4, -30, 7, -33.6], APRON, 1.2);
    box(ctx, [-3.8, -21.4, 7.6, 4.2, 1], shade(APRON, 0.14));
    line(ctx, [-3.8, -19.3, 3.8, -19.3], tint(APRON, 0.4), 0.5);
  },
  kimono: (ctx, w, f) => {
    torso(ctx, w.outfit);
    for (let i = 0; i + 1 < KIMONO_FLOWERS.length; i += 2) flower(ctx, KIMONO_FLOWERS[i] ?? 0, KIMONO_FLOWERS[i + 1] ?? 0, 1.2, tint(w.outfit, 0.6));
    neckV(ctx, w.skin, 6.4);
    line(ctx, [-4.6, -33.6, 1.4, -23.6], OFF_WHITE, 2.2);
    line(ctx, [-3.4, -33.6, 1.6, -25.2], '#d9465f', 0.8);
    line(ctx, [4.6, -33.6, -0.4, -27.6], OFF_WHITE, 2.2);
    boxO(ctx, [-9.7, -23.6, 19.4, 6, 1], GOLD, f);
    line(ctx, [-9.4, -20.6, 9.4, -20.6], '#d9465f', 0.9);
    dot(ctx, 3, -20.6, 1.1, '#d9465f');
  },
};

/** 袖（腕に対する長さの割合・幅広か・色） */
interface Sleeve {
  readonly len: number;
  readonly wide?: boolean;
  readonly color?: string;
}

/** トップスの種類ごとの袖 */
const SLEEVES: Readonly<Record<TopStyle, Sleeve>> = {
  tee: { len: 0.42 }, hoodie: { len: 0.9 }, shirt: { len: 0.9 }, border: { len: 0.9, color: OFF_WHITE }, knit: { len: 0.92 },
  cardigan: { len: 0.92 }, sailor: { len: 0.5, color: '#fbfbfd' }, happi: { len: 0.55, wide: true }, yukata: { len: 0.78, wide: true },
  jacket: { len: 0.92 }, stadium: { len: 0.92, color: CREAM }, apron: { len: 0.9 }, kimono: { len: 0.82, wide: true },
};

// ---------------------------------------------------------------------------
// 脚・ボトムス・くつ
// ---------------------------------------------------------------------------

/**
 * 素肌の脚を描く。
 * @param ctx 描画先
 * @param w 装い
 * @param footY 足元の Y（ジャンプで脚を曲げると上がる）
 * @param f 描き込みの細かさ
 */
function bareLegs(ctx: Ctx, w: Wear, footY: number, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const h = footY - 1.5 + 15.5;
  for (const x of [-6.2, 1.4]) {
    box(ctx, [x, -15.5, 4.8, h, 2.2], w.skin);
    edge(ctx, FACE_LINE, f.ol);
  }
}

/**
 * ズボン（腰回り＋両脚をひとつのシルエットで縁どり、脚につや）を描く。
 * @param ctx 描画先
 * @param color 色
 * @param footY 足元の Y
 * @param f 描き込みの細かさ
 * @param hemY 裾の Y（省略で足首まで）
 */
function pants(ctx: Ctx, color: string, footY: number, f: Frame, hemY?: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const bottomY = hemY ?? footY - 1.2;
  const legs: readonly R5[] = [[-6.8, -15.6, 5.8, bottomY + 15.6, 1.6], [1, -15.6, 5.8, bottomY + 15.6, 1.6]];
  paintPieces(ctx, [rr([-9.2, -16.6, 18.4, 4, 1.4]), ...legs.map((r) => rr(r))], color, shade(color, 0.4), f.ol);
  for (const r of legs) sheenBox(ctx, r, f);
}

/**
 * 多角形のボトムス（スカート・はかま）を塗って縁どり、つやを入れる。
 * @param ctx 描画先
 * @param pts 点の並び
 * @param color 色
 * @param f 描き込みの細かさ
 */
function skirtShape(ctx: Ctx, pts: readonly number[], color: string, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  polyO(ctx, pts, color, f);
  sheenPoly(ctx, pts, [-13, -17.4, 26, 18], f);
}

/** ボトムスを描く関数（描画先・装い・足元の Y・描き込み） */
type BottomPainter = (ctx: Ctx, w: Wear, footY: number, f: Frame) => void;

/** ボトムスの色（種類ごとに固定） */
const BOTTOM_COLOR: Readonly<Record<BottomStyle, string>> = {
  denim: '#3d5f95', shorts: '#c9b48a', skirt: '#4b5c8f', longskirt: '#8fb39a', cargo: '#6f7b4d', check: '#b8433f', hakama: '#2f3b6b', overall: '#5577aa',
};

/** ボトムスの種類ごとの描き方（脚から描く） */
const BOTTOMS: Readonly<Record<BottomStyle, BottomPainter>> = {
  denim: (ctx, w, footY, f) => {
    pants(ctx, BOTTOM_COLOR.denim, footY, f);
    line(ctx, [-4, -12.6, -4, footY - 2], tint(BOTTOM_COLOR.denim, 0.25), 0.5);
    line(ctx, [4, -12.6, 4, footY - 2], tint(BOTTOM_COLOR.denim, 0.25), 0.5);
  },
  shorts: (ctx, w, footY, f) => {
    bareLegs(ctx, w, footY, f);
    pants(ctx, BOTTOM_COLOR.shorts, footY, f, -9.4);
    box(ctx, [-7, -10.4, 6.2, 1.4, 0.6], shade(BOTTOM_COLOR.shorts, 0.15));
    box(ctx, [0.8, -10.4, 6.2, 1.4, 0.6], shade(BOTTOM_COLOR.shorts, 0.15));
  },
  skirt: (ctx, w, footY, f) => {
    bareLegs(ctx, w, footY, f);
    skirtShape(ctx, [-9.4, -16.6, 9.4, -16.6, 11.6, -7.4, -11.6, -7.4], BOTTOM_COLOR.skirt, f);
    for (const x of [-5, 0, 5]) line(ctx, [x * 0.9, -15, x * 1.15, -7.8], shade(BOTTOM_COLOR.skirt, 0.2), 0.6);
  },
  longskirt: (ctx, w, footY, f) => {
    bareLegs(ctx, w, footY, f);
    const c = BOTTOM_COLOR.longskirt;
    ctx.beginPath(); ctx.moveTo(-9.4, -16.6); ctx.lineTo(9.4, -16.6); ctx.lineTo(12.4, footY - 3.4);
    ctx.quadraticCurveTo(6, footY - 1.8, 0, footY - 3.4); ctx.quadraticCurveTo(-6, footY - 1.8, -12.4, footY - 3.4); ctx.closePath();
    fillWith(ctx, c);
    edge(ctx, shade(c, 0.4), f.ol);
    line(ctx, [-3, -14, -4, footY - 4], shade(c, 0.15), 0.6);
  },
  cargo: (ctx, w, footY, f) => {
    pants(ctx, BOTTOM_COLOR.cargo, footY, f);
    box(ctx, [-8, -10.6, 2.8, 3.6, 0.6], shade(BOTTOM_COLOR.cargo, 0.16));
    box(ctx, [5.2, -10.6, 2.8, 3.6, 0.6], shade(BOTTOM_COLOR.cargo, 0.16));
    box(ctx, [-6.8, footY - 3.4, 5.8, 1.6, 0.6], shade(BOTTOM_COLOR.cargo, 0.2));
    box(ctx, [1, footY - 3.4, 5.8, 1.6, 0.6], shade(BOTTOM_COLOR.cargo, 0.2));
  },
  check: (ctx, w, footY, f) => {
    pants(ctx, BOTTOM_COLOR.check, footY, f);
    for (const x of [-5.4, -2.6, 2.6, 5.4]) line(ctx, [x, -15, x, footY - 1.6], shade(BOTTOM_COLOR.check, 0.3), 0.5);
    for (let y = -13; y < footY - 1.6; y += 3) { line(ctx, [-6.6, y, -1.2, y], tint(BOTTOM_COLOR.check, 0.35), 0.5); line(ctx, [1.2, y, 6.6, y], tint(BOTTOM_COLOR.check, 0.35), 0.5); }
  },
  hakama: (ctx, w, footY, f) => {
    bareLegs(ctx, w, footY, f);
    skirtShape(ctx, [-9.4, -17, 9.4, -17, 11.6, footY - 2.6, 0.8, footY - 2.6, 0, -8, -0.8, footY - 2.6, -11.6, footY - 2.6], BOTTOM_COLOR.hakama, f);
    for (const x of [-7, -3.6, 3.6, 7]) line(ctx, [x * 0.85, -15, x * 1.2, footY - 3], tint(BOTTOM_COLOR.hakama, 0.18), 0.6);
    box(ctx, [-9.4, -17.4, 18.8, 1.8, 0.6], CREAM);
  },
  overall: (ctx, w, footY, f) => {
    pants(ctx, BOTTOM_COLOR.overall, footY, f);
    line(ctx, [-4, -12.6, -4, footY - 2], tint(BOTTOM_COLOR.overall, 0.25), 0.5);
    line(ctx, [4, -12.6, 4, footY - 2], tint(BOTTOM_COLOR.overall, 0.25), 0.5);
  },
};

/**
 * オーバーオールの胸当てと肩ひもを描く（トップスより手前）。
 * @param ctx 描画先
 * @param f 描き込みの細かさ
 */
function paintOverallBib(ctx: Ctx, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const c = BOTTOM_COLOR.overall;
  boxO(ctx, [-6, -27.6, 12, 13.6, 1.8], c, f);
  sheenBox(ctx, [-6, -27.6, 12, 13.6, 1.8], f);
  box(ctx, [-3.2, -24.4, 6.4, 4, 1], shade(c, 0.14));
  lineO(ctx, [-5.2, -27, -6.6, -33.6], c, 1.6, f);
  lineO(ctx, [5.2, -27, 6.6, -33.6], c, 1.6, f);
  dot(ctx, -4.6, -26.4, 0.8, GOLD);
  dot(ctx, 4.6, -26.4, 0.8, GOLD);
}

/** くつを描く関数（描画先・中心 X・足元 Y・描き込み） */
type ShoePainter = (ctx: Ctx, x: number, y: number, f: Frame) => void;

/** くつの種類ごとの描き方 */
const SHOES: Readonly<Record<ShoeStyle, ShoePainter>> = {
  sneaker: (ctx, x, y, f) => {
    boxO(ctx, [x - 4, y - 3.6, 8, 4, 2], WHITE, f);
    box(ctx, [x - 4, y - 0.8, 8, 1.4, 0.7], '#e7d9f0');
    line(ctx, [x - 2.2, y - 1.8, x + 1.8, y - 2.4], PINK, 0.8);
  },
  loafer: (ctx, x, y, f) => {
    boxO(ctx, [x - 4, y - 3.2, 8, 3.8, 1.9], '#6b3f2a', f);
    line(ctx, [x - 1.6, y - 2.4, x + 1.6, y - 2.4], tint('#6b3f2a', 0.35), 0.6);
  },
  boots: (ctx, x, y, f) => {
    paintPieces(ctx, [rr([x - 3.2, y - 9.4, 6.4, 9, 1.4]), rr([x - 4, y - 3.4, 8, 4, 1.8])], '#8a5a3c', shade('#8a5a3c', 0.4), f.ol);
    box(ctx, [x - 3.4, y - 9.6, 6.8, 1.8, 0.8], tint('#8a5a3c', 0.25));
  },
  sandal: (ctx, x, y, f) => {
    boxO(ctx, [x - 4, y - 0.8, 8, 1.4, 0.7], '#c08a52', f);
    line(ctx, [x - 2.6, y - 2.2, x + 2.6, y - 2.2], '#e8a23a', 1.1);
  },
  geta: (ctx, x, y, f) => {
    boxO(ctx, [x - 4, y - 1.8, 8, 1.6, 0.4], '#c99a62', f);
    box(ctx, [x - 3.2, y - 0.4, 1.4, 1, 0.2], shade('#c99a62', 0.2));
    box(ctx, [x + 1.8, y - 0.4, 1.4, 1, 0.2], shade('#c99a62', 0.2));
    line(ctx, [x - 2.4, y - 2, x, y - 3.4, x + 2.4, y - 2], '#d33f49', 0.9);
  },
  rain: (ctx, x, y, f) => {
    paintPieces(ctx, [rr([x - 3.4, y - 8.8, 6.8, 8.4, 1.4]), rr([x - 4, y - 3.2, 8, 3.8, 1.8])], '#f6c445', shade('#f6c445', 0.4), f.ol);
    box(ctx, [x - 4, y - 0.6, 8, 1.2, 0.6], '#9a6b13');
  },
  highcut: (ctx, x, y, f) => {
    paintPieces(ctx, [rr([x - 3.4, y - 6.6, 6.8, 6.4, 1.6]), rr([x - 4, y - 3.2, 8, 3.8, 1.8])], '#3b3550', shade('#3b3550', 0.4), f.ol);
    box(ctx, [x - 4, y - 0.9, 8, 1.5, 0.7], WHITE);
    line(ctx, [x - 1, y - 5.6, x + 1, y - 4.6, x - 1, y - 3.6], WHITE, 0.5);
  },
};

/**
 * 脚・ボトムス・くつ（照りの白点つき）を描く。
 * @param ctx 描画先
 * @param w 装い
 * @param footY 足元の Y
 * @param f 描き込みの細かさ
 */
function paintLegs(ctx: Ctx, w: Wear, footY: number, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  BOTTOMS[w.bottom](ctx, w, footY, f);
  for (const x of [-3.8, 3.8]) {
    SHOES[w.shoes](ctx, x, footY, f);
    dot(ctx, x - 1.8, footY - 2.4, 0.8, WHITE);
  }
}

// ---------------------------------------------------------------------------
// 腕と持ち物
// ---------------------------------------------------------------------------

/**
 * 左手（持ち物を持たない手）の位置。ポーズで変わる。
 * @param f 動き
 * @returns 手の位置
 */
function leftHandOf(f: Frame): readonly [number, number] { // audit-ignore: fnlog-missing 毎フレーム描画
  if (f.pose === 'wave') return [-15.6 - Math.sin(f.t * 9) * 2.6, -44];
  if (f.pose === 'peace') return [-11, -39];
  if (f.pose === 'jump') return [-16.6, -37];
  return [-12.8, -17.5 + f.bob * 0.4];
}

/**
 * 左手を上げるポーズか（上げた手は顔より手前に描く）。
 * @param pose ポーズ
 * @returns 上げるなら true
 */
function raisesLeftArm(pose: AvatarPose): boolean {
  return pose === 'wave' || pose === 'peace';
}

/**
 * 腕（肌＋袖。縁どりと袖のつや）を描く。手は描かない。
 * @param ctx 描画先
 * @param w 装い
 * @param f 描き込みの細かさ
 * @param arm 肩と手
 */
function paintArm(ctx: Ctx, w: Wear, f: Frame, arm: readonly [readonly [number, number], readonly [number, number]]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [s, hand] = arm;
  lineO(ctx, [s[0], s[1], hand[0], hand[1]], w.skin, 5.2, f, FACE_LINE);
  const sleeve = SLEEVES[w.top];
  const color = sleeve.color ?? w.outfit;
  const end: readonly [number, number] = [s[0] + (hand[0] - s[0]) * sleeve.len, s[1] + (hand[1] - s[1]) * sleeve.len];
  const width = sleeve.wide === true ? 7.6 : 6;
  lineO(ctx, [s[0], s[1], end[0], end[1]], color, width, f);
  if (sleeve.wide === true) ovalO(ctx, [end[0], end[1] + 1.6, 3.8, 3.2], color, f);
  if (f.fine) line(ctx, [s[0] - 0.6, s[1] - 0.6, end[0] - 0.6, end[1] - 0.4], 'rgba(255, 255, 255, 0.3)', width * 0.35);
}

/**
 * 左腕と左手（ポーズ・ピースの指）を描く。
 * @param ctx 描画先
 * @param w 装い
 * @param f 動き
 */
function paintLeftArm(ctx: Ctx, w: Wear, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const hand = leftHandOf(f);
  paintArm(ctx, w, f, [SHOULDER_L, hand]);
  if (f.pose === 'peace') {
    lineO(ctx, [hand[0] - 0.6, hand[1] - 1, hand[0] - 1.8, hand[1] - 5.4], w.skin, 1.5, f, FACE_LINE);
    lineO(ctx, [hand[0] + 0.6, hand[1] - 1, hand[0] + 1.4, hand[1] - 5.6], w.skin, 1.5, f, FACE_LINE);
  }
  dot(ctx, hand[0], hand[1], f.pose === 'wave' ? 3.1 : 2.8, w.skin);
  edge(ctx, FACE_LINE, f.ol);
}

/**
 * 右腕・持ち物・右手を描く（持ち物は手の位置を原点に描く）。
 * @param ctx 描画先
 * @param w 装い
 * @param f 動き
 */
function paintRightArm(ctx: Ctx, w: Wear, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  paintArm(ctx, w, f, [SHOULDER_R, HAND_R]);
  ctx.save();
  ctx.translate(HAND_R[0], HAND_R[1]);
  HELD[w.held](ctx, f);
  ctx.restore();
  dot(ctx, HAND_R[0], HAND_R[1], 2.8, w.skin);
  edge(ctx, FACE_LINE, f.ol);
}

/** 持ち物を描く関数（手の位置が原点） */
type HeldPainter = (ctx: Ctx, f: Frame) => void;

/** たこ焼きの位置 */
const TAKOYAKI = [2, -4.4, 5.4, -4.4, 8.8, -4.4, 3.7, -7, 7.1, -7, 10.5, -5];
/** 花束の花（x, y, 色） */
const BOUQUET: readonly (readonly [number, number, string])[] = [[-1.2, -8.4, '#ff8fab'], [2.6, -9.8, LEMON], [5.4, -7.2, '#ff6f61'], [0.8, -5.8, WHITE], [3.8, -5.6, '#b8a4ff']];
/** 魔法のステッキのまわりのきらめき（x, y, 半径） */
const WAND_SPARKS: readonly (readonly [number, number, number])[] = [[12, -22.6, 1.3], [2.4, -23.4, 1], [12.6, -15, 0.9]];

/** 持ち物の種類ごとの描き方（傘の上の部分は帽子のあとに paintUmbrellaTop で描く） */
const HELD: Readonly<Record<AvatarHeld, HeldPainter>> = {
  camera: (ctx) => paintGear(ctx, 'camera', { x: 2.2, y: 3.5 }, 11),
  chochin: (ctx) => paintGear(ctx, 'lantern', { x: 2.2, y: 3.5 }, 14),
  nobori: (ctx) => paintGear(ctx, 'pennant', { x: 2.2, y: 3.5 }, 14),
  matsu: (ctx) => paintGear(ctx, 'plant', { x: 2.2, y: 3.5 }, 14),
  map: (ctx, f) => {
    polyO(ctx, [-1, -9, 5, -11, 5, 1, -1, 3], '#f4ecd8', f);
    polyO(ctx, [5, -11, 11, -9, 11, 3, 5, 1], '#e6d8b8', f);
    polyO(ctx, [11, -9, 16, -11, 16, 1, 11, 3], '#f4ecd8', f);
    box(ctx, [6.4, -6, 3, 2.6, 0.6], '#9bd3a8');
    ctx.setLineDash([1.2, 1.2]);
    line(ctx, [0.5, -4, 6, -6.6, 9, -2, 14.5, -5], PINK, 0.9);
    ctx.setLineDash([]);
    dot(ctx, 14.5, -5.6, 1.3, PINK);
  },
  guidebook: (ctx, f) => {
    boxO(ctx, [-1.5, -10, 10, 12.5, 1.4], '#2e7d6b', f);
    box(ctx, [7.2, -9.6, 1.4, 11.7, 0.5], '#f4f1ea');
    box(ctx, [-0.2, -7.6, 7, 2.6, 0.6], LEMON);
    sparkle4(ctx, 3, -1.8, 1.8, '#f4f1ea');
  },
  softcream: (ctx, f) => {
    polyO(ctx, [-2.6, -3, 2.6, -3, 0, 5], '#e2a85a', f);
    line(ctx, [-1.4, -1.6, 1.2, 1.6], shade('#e2a85a', 0.2), 0.5);
    paintPieces(ctx, [ell([0, -4.6, 3.6, 1.8]), ell([0, -7.4, 3, 1.7]), ell([0.2, -9.9, 2.2, 1.5]), circ(0.5, -11.6, 0.9)], '#fff4fa', '#F4A6C8', f.ol);
    line(ctx, [-2.4, -6.2, 2, -5.6], '#FFD6EC', 0.5);
  },
  takoyaki: (ctx, f) => {
    polyO(ctx, [-1, -3, 13, -3, 11.5, 1.6, 0.5, 1.6], '#d8b27a', f);
    for (let i = 0; i + 1 < TAKOYAKI.length; i += 2) {
      dotO(ctx, [TAKOYAKI[i] ?? 0, TAKOYAKI[i + 1] ?? 0, 2], '#c97a3c', f);
      oval(ctx, [TAKOYAKI[i] ?? 0, (TAKOYAKI[i + 1] ?? 0) - 0.8, 1.6, 0.9], '#6b3a1f');
    }
    line(ctx, [1, -5.8, 3, -5, 5, -6, 7, -5, 9, -6, 11, -5.2], WHITE, 0.45);
    line(ctx, [9.6, -7.6, 12.6, -13.6], '#e8d4a8', 0.6);
  },
  balloon: (ctx, f) => {
    const sway = f.animated ? Math.sin(f.t * 1.6) * 0.8 : 0;
    ctx.strokeStyle = '#c4b5d6'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(14, -14, 11 + sway, -31.6); ctx.stroke();
    ovalO(ctx, [11 + sway, -38.6, 5.6, 6.8], '#ff7fb0', f);
    oval(ctx, [9.4 + sway, -41, 1.4, 2.2], 'rgba(255, 255, 255, 0.6)');
    poly(ctx, [10 + sway, -31.2, 12 + sway, -31.2, 11 + sway, -32.4], shade('#ff7fb0', 0.2));
  },
  umbrella: (ctx, f) => lineO(ctx, [0, 2, 1.2, -41], '#7a5134', 1.1, f),
  bouquet: (ctx, f) => {
    oval(ctx, [-1.6, -6.6, 1.6, 3], '#5bbf7a', -0.6);
    oval(ctx, [6.4, -6.2, 1.6, 3], '#5bbf7a', 0.6);
    for (const [x, y, c] of BOUQUET) { dotO(ctx, [x, y, 2.2], c, f); dot(ctx, x, y, 0.8, LEMON); }
    polyO(ctx, [-3, -5, 6, -5, 1.4, 4], '#f7e1ee', f);
    line(ctx, [-0.6, -1.6, 3.4, -1.6], PINK, 1);
  },
  fishing: (ctx, f) => {
    lineO(ctx, [0, 1, 15.4, -48], '#6b4f3a', 1.2, f);
    line(ctx, [15.4, -48, 15.4, -24.4], '#cbd5e1', 0.5);
    dot(ctx, 15.4, -23, 1.5, RED);
    oval(ctx, [15.4, -22.4, 1.5, 0.9], WHITE);
    dot(ctx, 1.6, -3.4, 1.6, '#6b6380');
  },
  uchiwa: (ctx, f) => {
    lineO(ctx, [0, 2, 4.4, -5.6], '#8a5a3c', 1.4, f);
    dotO(ctx, [7.4, -11.6, 6.4], '#f6f1e4', f);
    dot(ctx, 9, -13.2, 2.2, RED);
    ctx.strokeStyle = '#5CC8FF'; ctx.lineWidth = 0.8;
    for (const x of [3.4, 7, 10.6]) { ctx.beginPath(); ctx.arc(x, -7.8, 1.8, Math.PI, 0); ctx.stroke(); }
  },
  croquette: (ctx, f) => {
    ovalO(ctx, [4, -4.6, 5.2, 3.6], '#d99a3e', f);
    for (const [x, y] of [[1.6, -5.6], [4.2, -6.6], [6.6, -5], [3.2, -3.8], [5.8, -3.2]] as const) dot(ctx, x, y, 0.55, '#b8742a');
    polyO(ctx, [-1.5, -2.2, 9.5, -2.2, 8.5, 3, -0.5, 3], '#f3ecdc', f);
    line(ctx, [-0.6, 0.2, 8.6, 0.2], '#e2d6bd', 0.5);
  },
  sparkler: (ctx, f) => {
    line(ctx, [0, 1, 8.6, -17], '#8a8299', 0.8);
    dot(ctx, 8.6, -17.4, 4, 'rgba(255, 229, 138, 0.4)');
    const spin = f.animated ? f.t * 3 : 0;
    for (let k = 0; k < 10; k++) {
      const a = spin + (k * Math.PI) / 5;
      const len = 4 + (k % 3) * 1.2;
      line(ctx, [8.6 + Math.cos(a) * 1.6, -17.4 + Math.sin(a) * 1.6, 8.6 + Math.cos(a) * len, -17.4 + Math.sin(a) * len], GLITTER[k % GLITTER.length] ?? LEMON, 0.5);
    }
    dot(ctx, 8.6, -17.4, 1.2, '#fff3b0');
  },
  wand: (ctx, f) => {
    lineO(ctx, [0, 2, 6.4, -15], '#FFD6EC', 1.5, f, '#F4A6C8');
    poly(ctx, [5.6, -12.4, 2.6, -14.6, 3, -10.6], PINK);
    poly(ctx, [5.6, -12.4, 8.4, -10, 8.8, -13.4], PINK);
    star(ctx, 7.2, -18.6, 4.4, LEMON);
    edge(ctx, GOLD_DEEP, f.ol);
    star(ctx, 7.2, -18.4, 2, WHITE);
    WAND_SPARKS.forEach(([x, y, r], i) => sparkle4(ctx, x, y, r * twinkle(f, i * 2), GLITTER[(i + 1) % GLITTER.length] ?? WHITE));
  },
};

/**
 * 和傘の上の部分（頭より手前・上）を描く。
 * @param ctx 描画先
 * @param f 描き込みの細かさ
 */
function paintUmbrellaTop(ctx: Ctx, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const cx = 14;
  const cy = -60.2;
  const c = '#ff7fa8';
  ctx.beginPath(); ctx.arc(cx, cy, 15, Math.PI, 0); ctx.closePath();
  fillWith(ctx, c);
  edge(ctx, shade(c, 0.4), f.ol);
  for (let i = 1; i < 6; i++) {
    const a = Math.PI + (i * Math.PI) / 6;
    line(ctx, [cx, cy - 14.6, cx + Math.cos(a) * 14.6, cy + Math.sin(a) * 14.6 * 0.15], tint(c, 0.35), 0.5);
  }
  ctx.strokeStyle = OFF_WHITE; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx, cy, 9, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
  dot(ctx, cx, cy - 15, 0.7, '#7a5134');
}

// ---------------------------------------------------------------------------
// 帽子
// ---------------------------------------------------------------------------

/** 帽子を描く関数（描画先・装い・動き） */
type HatPainter = (ctx: Ctx, w: Wear, f: Frame) => void;

/** 帽子の色 */
const BERET = '#ff7a8a';
const STRAW = '#e8d3a2';
const CAP = '#5b7fd1';
const KNIT = '#ff8fab';
const BUCKET = '#d9c9a8';
const TIARA = '#F7D98B';
const FLOWER_COLORS = ['#ff8fab', LEMON, WHITE, '#b8a4ff'];

/**
 * 丸い帽子の山（ベジェのドーム）のパスを作る関数を返す。
 * @param half 裾の半幅
 * @param baseY 裾の Y
 * @param cpX 制御点の半幅
 * @param cpY 制御点の Y
 * @returns パスを作る関数
 */
function dome(half: number, baseY: number, cpX: number, cpY: number): PathBuilder {
  return (ctx) => { ctx.beginPath(); ctx.moveTo(-half, baseY); ctx.bezierCurveTo(-cpX, cpY, cpX, cpY, half, baseY); ctx.closePath(); };
}

/**
 * ベレー帽の山（上半分の楕円）のパスを作る。
 * @param ctx 描画先
 */
function beretDome(ctx: Ctx): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  ctx.ellipse(0, -1, 14.4, 6.6, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
}

/** 帽子の種類ごとの描き方（頭頂 -63.5 にかぶせる） */
const HATS: Readonly<Record<AvatarHat, HatPainter>> = {
  beret: (ctx, w, f) => {
    ctx.save(); ctx.translate(2, -60.6); ctx.rotate(-0.14);
    paintPieces(ctx, [beretDome, ell([0, -0.6, 15, 2.6])], BERET, shade(BERET, 0.4), f.ol);
    box(ctx, [-13.6, 0.4, 27.2, 2.6, 1.3], shade(BERET, 0.18));
    dot(ctx, 0, -7.4, 1.3, shade(BERET, 0.18));
    ctx.restore();
  },
  straw: (ctx, w, f) => {
    ovalO(ctx, [0, -57.6, 21, 4.4], STRAW, f);
    paintPieces(ctx, [dome(10.6, -58, 10.6, -69)], tint(STRAW, 0.12), shade(STRAW, 0.4), f.ol);
    box(ctx, [-10.6, -61.4, 21.2, 3, 1], PINK);
    line(ctx, [-17, -57.2, -12, -56.4], shade(STRAW, 0.15), 0.6);
  },
  crown: (ctx, w, f) => {
    polyO(ctx, [-9.6, -59.6, -9.6, -69, -4.8, -64.6, 0, -72, 4.8, -64.6, 9.6, -69, 9.6, -59.6], GOLD, f);
    box(ctx, [-9.6, -62.2, 19.2, 2.6, 0.8], GOLD_DEEP);
    dot(ctx, 0, -66.2, 1.3, PINK);
    dot(ctx, -5.6, -60.9, 0.9, SKY);
    dot(ctx, 5.6, -60.9, 0.9, SKY);
    for (const [x, y] of [[-9.6, -69], [0, -72], [9.6, -69]] as const) dot(ctx, x, y, 1.1, tint(GOLD, 0.5));
  },
  cap: (ctx, w, f) => {
    paintPieces(ctx, [dome(15.4, -54, 16, -69)], CAP, shade(CAP, 0.4), f.ol);
    dot(ctx, 0, -65, 1.4, shade(CAP, 0.2));
    sparkle4(ctx, 0, -59.6, 2.4, WHITE);
    ctx.beginPath(); ctx.ellipse(3.4, -54.2, 13.6, 3.4, 0, 0, Math.PI); ctx.closePath();
    fillWith(ctx, shade(CAP, 0.2));
    edge(ctx, shade(CAP, 0.45), f.ol);
  },
  knit: (ctx, w, f) => {
    paintPieces(ctx, [dome(16.2, -52, 17, -71)], KNIT, shade(KNIT, 0.4), f.ol);
    box(ctx, [-16.8, -56.2, 33.6, 5.2, 2.4], shade(KNIT, 0.12));
    for (let x = -14; x <= 14; x += 3.5) line(ctx, [x, -55.4, x, -51.8], tint(KNIT, 0.25), 0.6);
    dotO(ctx, [0, -67.4, 3.8], '#fff4fa', f);
  },
  hachimaki: (ctx, w, f) => {
    boxO(ctx, [-16.4, -56.6, 32.8, 4, 1.6], WHITE, f);
    dot(ctx, 0, -54.6, 1.6, RED);
    polyO(ctx, [15.4, -55.6, 24, -60.6, 22.6, -55.2], WHITE, f);
    polyO(ctx, [15.4, -54, 23.6, -50.2, 21.4, -48.6], WHITE, f);
    dot(ctx, 15.8, -54.6, 2, shade(WHITE, 0.08));
  },
  flower: (ctx) => {
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (1.12 + i * 0.127);
      const x = Math.cos(a) * 15.2;
      const y = -47 + Math.sin(a) * 15.2;
      oval(ctx, [x + 1.6, y + 1.2, 1.6, 0.9], '#5bbf7a', a);
      flower(ctx, x, y, 1.8, FLOWER_COLORS[i % FLOWER_COLORS.length] ?? WHITE);
    }
  },
  catEars: (ctx, w, f) => {
    for (const s of [-1, 1]) {
      polyO(ctx, [s * 14.6, -55, s * 12, -70.6, s * 4, -60.2], w.hairColor, f);
      poly(ctx, [s * 12.6, -57.4, s * 11.6, -66.6, s * 7, -60.6], '#f6a5b8');
    }
  },
  bucket: (ctx, w, f) => {
    polyO(ctx, [-18, -52.6, -12.4, -58, 12.4, -58, 18, -52.6], shade(BUCKET, 0.1), f);
    paintPieces(ctx, [dome(11.6, -57, 11.6, -69.4)], BUCKET, shade(BUCKET, 0.4), f.ol);
    box(ctx, [-11.8, -59.6, 23.6, 2.4, 0.8], '#b58fa8');
  },
  silk: (ctx, w, f) => {
    paintPieces(ctx, [ell([0, -58.4, 16.4, 3.2]), rr([-9.6, -74.4, 19.2, 16.6, 2])], '#4a3f66', shade('#4a3f66', 0.45), f.ol);
    box(ctx, [-9.6, -62, 19.2, 3.2, 0.6], PINK);
    oval(ctx, [0, -74.2, 9.6, 1.6], '#5d5180');
    line(ctx, [-6.6, -71.6, -6.6, -64], 'rgba(255, 255, 255, 0.25)', 1.2);
  },
  halo: (ctx, w, f) => {
    const y = -70.6 + (f.animated ? Math.sin(f.t * 2.4) * 0.7 : 0);
    ctx.strokeStyle = 'rgba(255, 229, 138, 0.5)'; ctx.lineWidth = 3.6;
    ctx.beginPath(); ctx.ellipse(0, y, 10.4, 2.6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.ellipse(0, y, 10.4, 2.6, 0, 0, Math.PI * 2); ctx.stroke();
    sparkle4(ctx, 8.6, y - 1.4, 1.3 * twinkle(f, 1), WHITE);
  },
  tiara: (ctx, w, f) => {
    paintPieces(ctx, [pg([-9.4, -59.6, -9, -64.2, -5, -62, 0, -69.4, 5, -62, 9, -64.2, 9.4, -59.6]), rr([-9.8, -61.2, 19.6, 2.4, 1.2])], TIARA, shade(TIARA, 0.4), f.ol);
    dotO(ctx, [0, -64.6, 1.9], PINK, f);
    dot(ctx, 0.6, -65.2, 0.6, WHITE);
    dot(ctx, -5.4, -60, 1.1, SKY);
    dot(ctx, 5.4, -60, 1.1, SKY);
    dot(ctx, -9, -64.2, 0.9, '#FFB6D9');
    dot(ctx, 9, -64.2, 0.9, '#FFB6D9');
    dot(ctx, 0, -69.4, 1, WHITE);
    sparkle4(ctx, 6.4, -68.4, 1.5 * twinkle(f, 0.5), WHITE);
  },
};

/** 帽子のいちばん上の高さ（頭のまとまりの中＝拡大前・持ち上げ無し） */
const HAT_TOP: Readonly<Record<AvatarHat, number>> = {
  beret: -69.3, straw: -67, crown: -73.2, cap: -66, knit: -71.4, hachimaki: -61, flower: -66, catEars: -71, bucket: -67, silk: -76, halo: -75.9, tiara: -70.6,
};

/** 髪型ごとの帽子の持ち上げ（盛った髪の上にかぶせる） */
const HAIR_LIFT: Readonly<Record<HairStyle, number>> = {
  short: 0, bob: 0, long: 0, ponytail: 0, bun: -1.6, twintail: 0, curly: -1, spiky: -3, sidepart: 0, wolf: 0, braid: 0, afro: -4.6,
};

/**
 * 帽子を描く（髪型で持ち上げる。拡大後の上限を超える帽子は少し下げる）。
 * @param ctx 描画先
 * @param w 装い
 * @param f 動き
 */
function paintHat(ctx: Ctx, w: Wear, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (w.hat === undefined) return;
  const lift = Math.max(HAIR_LIFT[w.hair], HAT_LIMIT - HAT_TOP[w.hat]);
  ctx.save();
  ctx.translate(0, lift);
  HATS[w.hat](ctx, w, f);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// アクセサリー
// ---------------------------------------------------------------------------

/** アクセサリーを描く重ね順（羽＝背中、首まわり、顔、髪かざり） */
type AccessoryLayer = 'back' | 'neck' | 'face' | 'hair';

/** アクセサリーの描き方（重ね順と描く関数） */
interface AccessoryDef {
  readonly layer: AccessoryLayer;
  readonly paint: (ctx: Ctx, w: Wear, f: Frame) => void;
}

/**
 * 天使の羽（左右3枚ずつの羽根＋きらめき）を描く。
 * @param ctx 描画先
 * @param f 動き
 */
function paintWings(ctx: Ctx, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const flap = f.animated ? Math.sin(f.t * 4) * 0.08 : 0;
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * 5, -30);
    ctx.rotate(s * (0.15 + flap));
    for (let i = 0; i < 3; i++) ovalO(ctx, [s * (8 + i * 2.4), -6 + i * 4, 9 - i * 1.6, 3.2], i === 0 ? WHITE : '#f1ecff', f, s * (-0.5 + i * 0.25));
    ctx.restore();
  }
  if (f.fine) {
    sparkle4(ctx, -19, -40, 1.1 * twinkle(f, 0), '#D9C8FF');
    sparkle4(ctx, 19, -38, 1 * twinkle(f, 2), '#BDEBFF');
  }
}

/** アクセサリーの種類ごとの描き方 */
const ACCESSORIES: Readonly<Record<AccessoryStyle, AccessoryDef>> = {
  glasses: { layer: 'face', paint: (ctx) => {
    for (const x of [-EYE_X, EYE_X]) { dot(ctx, x, EYE_Y, 4.2, 'rgba(200, 230, 255, 0.22)'); edge(ctx, '#7A4B6E', 1); }
    line(ctx, [-2, EYE_Y - 0.6, 2, EYE_Y - 0.6], '#7A4B6E', 0.9);
  } },
  sunglasses: { layer: 'face', paint: (ctx) => {
    box(ctx, [-10.6, EYE_Y - 3, 8.6, 6, 2.4], LASH);
    box(ctx, [2, EYE_Y - 3, 8.6, 6, 2.4], LASH);
    line(ctx, [-2, EYE_Y - 1.6, 2, EYE_Y - 1.6], LASH, 1);
    line(ctx, [-8.8, EYE_Y - 1.4, -6.2, EYE_Y - 2], 'rgba(255, 255, 255, 0.45)', 0.7);
    line(ctx, [3.8, EYE_Y - 1.4, 6.4, EYE_Y - 2], 'rgba(255, 255, 255, 0.45)', 0.7);
  } },
  scarf: { layer: 'neck', paint: (ctx, w, f) => {
    boxO(ctx, [-9.2, -34.4, 18.4, 4.6, 2.2], '#ff7a8a', f);
    polyO(ctx, [3, -31, 7, -31, 7.6, -20.6, 4.2, -21.6], shade('#ff7a8a', 0.08), f);
    line(ctx, [4.4, -24, 7, -24], tint('#ff7a8a', 0.45), 0.6);
  } },
  headphones: { layer: 'hair', paint: (ctx, w, f) => {
    ctx.strokeStyle = '#6b5b8a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -46, 17.4, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
    boxO(ctx, [-19.6, -50.6, 4.6, 9.4, 2.2], '#6b5b8a', f);
    boxO(ctx, [15, -50.6, 4.6, 9.4, 2.2], '#6b5b8a', f);
    box(ctx, [-18.6, -48.6, 2.4, 5.4, 1.2], PINK);
    box(ctx, [16.2, -48.6, 2.4, 5.4, 1.2], PINK);
  } },
  ribbon: { layer: 'hair', paint: (ctx, w, f) => {
    polyO(ctx, [10.4, -58.6, 4.6, -63, 5, -54.4], '#FF8FC8', f);
    polyO(ctx, [10.4, -58.6, 16.2, -63, 15.8, -54.4], '#FF8FC8', f);
    dotO(ctx, [10.4, -58.6, 1.8], PINK, f);
  } },
  muffler: { layer: 'neck', paint: (ctx, w, f) => {
    boxO(ctx, [-10, -35.2, 20, 6, 3], '#7c9cf0', f);
    for (const x of [-6, -1, 4]) box(ctx, [x, -35.2, 1.6, 6, 0], tint('#7c9cf0', 0.75));
    boxO(ctx, [-7.6, -31, 4.6, 12, 1.6], '#7c9cf0', f);
    line(ctx, [-7.2, -18.6, -7.2, -17.2], '#7c9cf0', 0.6);
    line(ctx, [-3.4, -18.6, -3.4, -17.2], '#7c9cf0', 0.6);
  } },
  bandaid: { layer: 'face', paint: (ctx) => {
    ctx.save(); ctx.translate(10.6, -41.8); ctx.rotate(-0.4);
    box(ctx, [-3.2, -1.3, 6.4, 2.6, 1.2], '#f6cfe0');
    box(ctx, [-1, -1.3, 2, 2.6, 0.4], '#fbe3ee');
    ctx.restore();
  } },
  pochette: { layer: 'neck', paint: (ctx, w, f) => {
    line(ctx, [-7.6, -32, 6, -18.6], '#b0708f', 1.2);
    boxO(ctx, [2.2, -19.8, 8, 6.6, 2], '#ff9bc2', f);
    box(ctx, [2.2, -19.8, 8, 2.8, 1.2], shade('#ff9bc2', 0.12));
    sparkle4(ctx, 6.2, -16.6, 1.1, GOLD);
  } },
  medal: { layer: 'neck', paint: (ctx, w, f) => {
    poly(ctx, [-5, -33.4, -2.6, -33.4, 0.6, -24.4, -1, -24.4], PINK);
    poly(ctx, [5, -33.4, 2.6, -33.4, -0.6, -24.4, 1, -24.4], '#5CC8FF');
    dotO(ctx, [0, -21.6, 3.6], GOLD, f);
    star(ctx, 0, -21.6, 2.2, tint(GOLD, 0.5));
  } },
  wings: { layer: 'back', paint: (ctx, w, f) => paintWings(ctx, f) },
  heartglasses: { layer: 'face', paint: (ctx, w, f) => {
    for (const x of [-EYE_X, EYE_X]) {
      heartPath(ctx, x, EYE_Y + 0.4, 3.6);
      fillWith(ctx, 'rgba(255, 95, 162, 0.55)');
      edge(ctx, PINK, 1.1);
      if (f.fine) line(ctx, [x - 2.2, EYE_Y - 0.6, x - 1, EYE_Y - 2], 'rgba(255, 255, 255, 0.8)', 0.7);
    }
    line(ctx, [-2.6, EYE_Y - 1.2, 2.6, EYE_Y - 1.2], PINK, 1);
    line(ctx, [-10.6, EYE_Y - 1.4, -14.6, EYE_Y - 1.8], PINK, 0.9);
    line(ctx, [10.6, EYE_Y - 1.4, 14.6, EYE_Y - 1.8], PINK, 0.9);
  } },
};

/**
 * 指定の重ね順のアクセサリーを描く。
 * @param ctx 描画先
 * @param w 装い
 * @param f 動き
 * @param layer 重ね順
 */
function paintAccessory(ctx: Ctx, w: Wear, f: Frame, layer: AccessoryLayer): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (w.accessory === undefined) return;
  const def = ACCESSORIES[w.accessory];
  if (def.layer === layer) def.paint(ctx, w, f);
}

// ---------------------------------------------------------------------------
// 相棒（左に座る。右＝アバターのほうを向く）
// ---------------------------------------------------------------------------

/** 相棒を描く関数（足元が原点・しっぽを振る角度・描き込み） */
type PetPainter = (ctx: Ctx, wag: number, f: Frame) => void;

/**
 * 小さなキラキラの目（黒目＋光2つ）を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 半径
 */
function petEye(ctx: Ctx, x: number, y: number, r: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  dot(ctx, x, y, r, LASH);
  dot(ctx, x + r * 0.35, y - r * 0.35, r * 0.42, WHITE);
  dot(ctx, x - r * 0.4, y + r * 0.4, r * 0.18, WHITE);
}

/**
 * 座った四つ足の動物の基本（耳・胴・頭をひとつのシルエットで縁どる）を描く。
 * @param ctx 描画先
 * @param c 体の色
 * @param ears 耳の三角形（左右）
 * @param f 描き込みの細かさ
 */
function sittingBody(ctx: Ctx, c: string, ears: readonly (readonly number[])[], f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  paintPieces(ctx, [...ears.map((e) => pg(e)), ell([0, -6, 6.8, 6.2]), ell([3.2, -14.4, 5.4, 4.9])], c, shade(c, 0.4), f.ol);
  oval(ctx, [1, -0.8, 1.8, 1], shade(c, 0.08));
  oval(ctx, [4.6, -0.8, 1.8, 1], shade(c, 0.08));
}

/**
 * しっぽなどの曲線を縁どりつきで引く。
 * @param ctx 描画先
 * @param build 曲線のパスを作る関数
 * @param color 色
 * @param width 太さ
 * @param f 描き込みの細かさ
 */
function curveO(ctx: Ctx, build: PathBuilder, color: string, width: number, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.lineCap = 'round';
  if (f.ol > 0) { build(ctx); ctx.strokeStyle = shade(color, 0.4); ctx.lineWidth = width + f.ol * 2; ctx.stroke(); }
  build(ctx);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** ユニコーンのたてがみ（x, y） */
const UNICORN_MANE = [[-0.4, -18], [-1.8, -15.4], [-2.6, -12.6], [-2.4, -9.8], [0.8, -19.6]] as const;

/** 相棒の種類ごとの描き方 */
const PETS: Readonly<Record<PetStyle, PetPainter>> = {
  cat: (ctx, wag, f) => {
    curveO(ctx, (c) => { c.beginPath(); c.moveTo(-5, -3); c.quadraticCurveTo(-10.4, -6, -8.6 + wag * 4, -13); }, '#e08e5a', 2.4, f);
    sittingBody(ctx, '#f4b183', [[-0.4, -17.6, 0, -23, 3, -19], [4.2, -19.4, 7.6, -23, 7.8, -16.4]], f);
    poly(ctx, [0.4, -18.6, 0.6, -21.4, 2.2, -19.4], '#f6a5b8');
    box(ctx, [1.2, -19.6, 4, 1.2, 0.6], '#e08e5a');
    oval(ctx, [3.2, -7, 3, 3.4], tint('#f4b183', 0.4));
    petEye(ctx, 2, -14.8, 0.9); petEye(ctx, 5.4, -14.8, 0.9);
    dot(ctx, 3.8, -13, 0.7, '#f08a8a');
  },
  shiba: (ctx, wag, f) => {
    curveO(ctx, (c) => { c.beginPath(); c.arc(-5, -10.6, 3, wag, wag + Math.PI * 1.6); }, '#e3a15a', 2.6, f);
    sittingBody(ctx, '#e3a15a', [[-0.6, -17, 0.2, -22.6, 3.2, -18.6], [4.2, -18.8, 7.8, -22, 7.6, -15.8]], f);
    oval(ctx, [3.2, -6, 3.4, 4.4], '#fff6ea');
    oval(ctx, [4.8, -12.6, 3.6, 2.4], '#fff6ea');
    petEye(ctx, 2.2, -15, 0.9); petEye(ctx, 5.6, -15, 0.9);
    dot(ctx, 8, -13, 0.8, LASH);
    dot(ctx, 4.2, -12, 0.9, 'rgba(255, 110, 150, 0.35)');
  },
  rabbit: (ctx, wag, f) => {
    ovalO(ctx, [1.4, -21, 1.8, 5.6], '#fbfbfb', f, -0.15 + wag * 0.3);
    ovalO(ctx, [4.8, -21.4, 1.8, 5.6], '#fbfbfb', f, 0.2);
    oval(ctx, [1.4, -21, 0.8, 4], '#f6b8c6', -0.15 + wag * 0.3);
    oval(ctx, [4.8, -21.4, 0.8, 4], '#f6b8c6', 0.2);
    paintPieces(ctx, [ell([0, -5.6, 6.6, 5.8]), circ(-6, -4, 2.2), ell([3, -12.6, 5, 4.6])], '#fbfbfb', '#D9C8FF', f.ol);
    petEye(ctx, 5, -13.2, 1);
    dot(ctx, 7.4, -11.6, 0.6, '#f08a8a');
    dot(ctx, 4.4, -10.8, 1, 'rgba(255, 110, 150, 0.35)');
  },
  hiyoko: (ctx, wag, f) => {
    ctx.save(); ctx.translate(0, f.animated ? -Math.abs(Math.sin(f.t * 4)) * 1.6 : 0);
    dotO(ctx, [1, -5.6, 5.6], '#ffe066', f);
    oval(ctx, [-1, -5, 2.6, 1.8], '#f3c22e', -0.3 + wag);
    petEye(ctx, 3.4, -7.4, 0.9);
    poly(ctx, [5.8, -6.6, 8.6, -5.8, 5.8, -5], '#ff9f1c');
    dot(ctx, 3.6, -5, 0.9, 'rgba(255, 110, 150, 0.4)');
    line(ctx, [0.4, -11, 0.8, -12.6], '#f3c22e', 0.8);
    ctx.restore();
    line(ctx, [-0.4, -0.2, 0.4, -1.2], '#ff9f1c', 0.8);
    line(ctx, [2.4, -0.2, 2.8, -1.2], '#ff9f1c', 0.8);
  },
  tanuki: (ctx, wag, f) => {
    ovalO(ctx, [-6, -6, 3.4, 5.6], '#9b7350', f, -0.5 + wag);
    oval(ctx, [-6.6, -7.4, 3, 1], '#4a3a2c', -0.5 + wag);
    paintPieces(ctx, [circ(-1, -19.2, 1.8), circ(5.8, -19.4, 1.8), ell([0, -6.6, 7, 6.8]), ell([2.6, -15, 5.6, 5])], '#9b7350', shade('#9b7350', 0.4), f.ol);
    oval(ctx, [1.6, -5.6, 4, 4.6], '#ead7b7');
    oval(ctx, [1, -15, 1.9, 1.5], '#4a3a2c'); oval(ctx, [4.6, -15, 1.9, 1.5], '#4a3a2c');
    dot(ctx, 1.3, -15.3, 0.5, WHITE); dot(ctx, 4.9, -15.3, 0.5, WHITE);
    oval(ctx, [3, -12.8, 2.4, 1.6], '#ead7b7');
    dot(ctx, 3.6, -13.2, 0.7, LASH);
    oval(ctx, [3, -21.4, 1.6, 0.8], '#5bbf7a', -0.4);
  },
  penguin: (ctx, wag, f) => {
    ovalO(ctx, [-5.6, -9, 1.6, 4.4], '#3d4766', f, 0.35 + wag * 0.5);
    ovalO(ctx, [0, -9.6, 6.4, 9.2], '#3d4766', f);
    oval(ctx, [1, -8.6, 4.3, 7.4], WHITE);
    petEye(ctx, 2.6, -14, 0.9);
    poly(ctx, [3.6, -13, 7.2, -12.2, 3.6, -11.2], '#ff9f1c');
    dot(ctx, 3.4, -10.6, 0.9, 'rgba(255, 110, 150, 0.4)');
    oval(ctx, [-1.6, -0.5, 2.2, 0.9], '#ff9f1c');
    oval(ctx, [2.6, -0.5, 2.2, 0.9], '#ff9f1c');
  },
  pigeon: (ctx, wag, f) => {
    const peck = f.animated ? Math.max(0, Math.sin(f.t * 3)) * 1.2 : 0;
    poly(ctx, [-5, -5, -9.6, -3, -9, -7], '#6f7b95');
    ovalO(ctx, [0, -5, 6, 4.2], '#9aa6c4', f, -0.15);
    oval(ctx, [-1, -5.4, 4, 2.6], '#b6bfd6', -0.2);
    line(ctx, [-3, -4.6, -0.6, -4.2], '#5a6584', 0.6);
    oval(ctx, [3.4, -8.8 + peck * 0.5, 2.6, 2.8], '#7fd1b9');
    dotO(ctx, [4.6 + peck * 0.4, -11.2 + peck, 2.6], '#9aa6c4', f);
    dot(ctx, 5.4 + peck * 0.4, -11.6 + peck, 0.6, '#ff9f1c');
    poly(ctx, [6.8 + peck * 0.4, -11.6 + peck, 8.6 + peck * 0.4, -10.8 + peck, 6.8 + peck * 0.4, -10.4 + peck], '#b3aec4');
    line(ctx, [-0.6, -1, -0.6, 0], '#f08a8a', 0.8);
    line(ctx, [1.6, -1, 1.6, 0], '#f08a8a', 0.8);
  },
  dragon: (ctx, wag, f) => {
    curveO(ctx, (c) => { c.beginPath(); c.moveTo(-4, -3); c.quadraticCurveTo(-9.6, -3, -9 + wag * 3, -9); }, '#5fc79a', 2.6, f);
    poly(ctx, [-7.6, -4.4, -6.6, -6.6, -5.8, -4], '#3fa57c');
    const flap = f.animated ? Math.sin(f.t * 5) * 0.2 : 0;
    ctx.save(); ctx.translate(-1, -11); ctx.rotate(-flap);
    polyO(ctx, [0, 0, -7, -9, -5.4, -3.6, -8.6, -4, -3, 1], '#7fd8b0', f);
    ctx.restore();
    paintPieces(ctx, [ell([0, -6.6, 6.4, 6.4]), ell([3.4, -15, 5.2, 4.6])], '#5fc79a', shade('#5fc79a', 0.4), f.ol);
    oval(ctx, [1.8, -5.8, 3.4, 4.4], '#fff3c4');
    poly(ctx, [0.6, -18.4, 0.4, -21.6, 2.6, -19], '#fff3c4');
    poly(ctx, [4.6, -19.2, 5.6, -22.2, 6.6, -18.8], '#fff3c4');
    petEye(ctx, 4.6, -15.4, 1.2);
    dot(ctx, 7.6, -13.4, 0.45, shade('#5fc79a', 0.4));
    dot(ctx, 5.2, -12.6, 0.9, 'rgba(255, 110, 150, 0.4)');
  },
  fox: (ctx, wag, f) => {
    ovalO(ctx, [-4.8, -9.6, 3.6, 6.8], '#fbfaf6', f, -0.4 + wag);
    dot(ctx, -7.2 + wag * 3, -15, 2.4, GOLD);
    paintPieces(ctx, [pg([0, -17, 0.6, -24, 3.4, -18.6]), pg([4, -18.6, 7.2, -23.6, 6.8, -16.6]), ell([0, -6.6, 6, 6.6]), ell([3, -14.6, 4.8, 4.4]), pg([6.6, -15.6, 9.4, -13, 6.6, -12])], '#fbfaf6', '#D9C8FF', f.ol);
    poly(ctx, [0.8, -18.4, 1.1, -22, 2.6, -18.8], RED);
    poly(ctx, [4.8, -18.6, 6.6, -21.8, 6.4, -17.4], RED);
    closedFoxEyes(ctx);
    box(ctx, [-1.6, -10.6, 8, 1.6, 0.8], RED);
    dot(ctx, 3.6, -9, 1.2, GOLD);
  },
  unicorn: (ctx, wag, f) => {
    for (let i = 0; i < 4; i++) {
      curveO(ctx, (c) => { c.beginPath(); c.moveTo(-5, -4 - i * 0.6); c.quadraticCurveTo(-10, -6 + i * 1.2, -8.6 + wag * 3, -11 + i * 2); }, RAINBOW[i] ?? PINK, 1.5, f);
    }
    paintPieces(ctx, [pg([1.4, -18, 2.2, -22.4, 4, -18.6]), ell([0, -6, 6.8, 6.2]), ell([3.4, -14.6, 5.4, 4.8]), ell([7.2, -12.8, 2.6, 2.2])], WHITE, '#D9C8FF', f.ol);
    UNICORN_MANE.forEach(([x, y], i) => dot(ctx, x, y, 2.1, RAINBOW[i % RAINBOW.length] ?? PINK));
    polyO(ctx, [3.4, -18.6, 5.6, -26.4, 6.2, -18.2], GOLD, f);
    line(ctx, [4, -20, 5.8, -20.6], GOLD_DEEP, 0.5);
    line(ctx, [4.6, -22.6, 5.8, -23], GOLD_DEEP, 0.5);
    closedEye(ctx, 4.8, 1, true, f);
    dot(ctx, 6.6, -12, 1, 'rgba(255, 110, 150, 0.45)');
    oval(ctx, [1, -0.8, 1.8, 1], LAVENDER);
    oval(ctx, [4.6, -0.8, 1.8, 1], LAVENDER);
    sparkle4(ctx, 8.6, -22, 1.2 * twinkle(f, 3), LEMON);
  },
};

/**
 * きつねの細い目（赤い隈取りつき）を描く。
 * @param ctx 描画先
 */
function closedFoxEyes(ctx: Ctx): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (const x of [1.8, 5.2]) {
    line(ctx, [x - 1, -15, x + 1, -15.4], LASH, 0.7);
    line(ctx, [x - 0.6, -16.2, x + 1.2, -16.8], RED, 0.6);
  }
}

/**
 * 相棒を描く（足元・左。しっぽを振る）。
 * @param ctx 描画先
 * @param pet 相棒
 * @param f 動き
 */
function paintPet(ctx: Ctx, pet: PetStyle, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const wag = f.animated ? Math.sin(f.t * 3) * 0.25 : 0;
  ctx.save();
  ctx.translate(PET_X, 0);
  oval(ctx, [0.6, 0, 7.4, 1.6], 'rgba(74, 35, 80, 0.1)');
  PETS[pet](ctx, wag, f);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 全体
// ---------------------------------------------------------------------------

/**
 * 装いの省略した項目を既定で埋める。
 * @param look 装い
 * @returns 既定値を埋めた装い
 */
function wearOf(look: AvatarLook): Wear { // audit-ignore: fnlog-missing 毎フレーム描画
  return {
    hair: look.hair ?? 'short',
    hairColor: look.hairColor ?? DEFAULT_HAIR_COLOR,
    eyes: look.eyes ?? 'smile',
    skin: look.skin ?? DEFAULT_SKIN,
    top: look.top ?? 'tee',
    outfit: look.outfitColor.length > 0 ? look.outfitColor : DEFAULT_OUTFIT_COLOR,
    bottom: look.bottom ?? 'denim',
    shoes: look.shoes ?? 'sneaker',
    held: look.held,
    hat: look.hat,
    accessory: look.accessory,
    pet: look.pet ?? (look.hasCat ? 'cat' : undefined),
  };
}

/**
 * 動きと拡大率から1コマの状態（呼吸・ジャンプの高さ・まばたき・描き込みの細かさ）を決める。
 * @param motion 動き（省略で止まった絵）
 * @param scale 拡大率（0.6 未満は細かい飾りを省く）
 * @returns 1コマの状態
 */
function frameOf(motion: AvatarMotion | undefined, scale: number): Frame { // audit-ignore: fnlog-missing 毎フレーム描画
  const fine = scale >= DETAIL_MIN_SCALE;
  const lines = { fine, ol: fine ? 0.8 : 0, hairOl: fine ? 0.9 : 1.2, faceOl: fine ? 0.8 : 1.2 };
  if (motion === undefined) return { pose: 'stand', t: 0, animated: false, bob: 0, lift: 0, blink: false, ...lines };
  const t = Number.isFinite(motion.t) ? Math.max(0, motion.t) : 0;
  const jumping = motion.pose === 'jump';
  return {
    pose: motion.pose,
    t,
    animated: true,
    bob: jumping ? 0 : Math.sin((t * Math.PI * 2) / 2.6) * 0.6,
    lift: jumping ? Math.abs(Math.sin((t * Math.PI) / 0.9)) * 7 : 0,
    blink: t % BLINK_PERIOD_S > BLINK_PERIOD_S - BLINK_CLOSED_S,
    ...lines,
  };
}

/**
 * 足元の影を描く（ジャンプ中は小さく）。
 * @param ctx 描画先
 * @param f 動き
 */
function paintShadow(ctx: Ctx, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const k = 1 - f.lift / 14;
  oval(ctx, [0, 0, 14 * k, 3.2 * k], 'rgba(74, 35, 80, 0.12)');
}

/**
 * 体（背中のもの・後ろ髪・脚・トップス・首まわり・腕と持ち物）を描く。
 * @param ctx 描画先
 * @param w 装い
 * @param f 動き
 */
function paintBody(ctx: Ctx, w: Wear, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  paintAccessory(ctx, w, f, 'back');
  withHeadScale(ctx, () => paintBackHair(ctx, w, f));
  paintLegs(ctx, w, -(f.lift / 7) * 3.2, f);
  TOPS[w.top](ctx, w, f);
  finishTorso(ctx, w, f);
  if (w.bottom === 'overall') paintOverallBib(ctx, f);
  paintAccessory(ctx, w, f, 'neck');
  if (!raisesLeftArm(f.pose)) paintLeftArm(ctx, w, f);
  paintRightArm(ctx, w, f);
}

/**
 * 頭（顔・顔のアクセサリー・前髪・髪かざり・帽子を 1.04 倍で）と、傘・上げた手を描く。
 * @param ctx 描画先
 * @param w 装い
 * @param f 動き
 */
function paintHead(ctx: Ctx, w: Wear, f: Frame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  withHeadScale(ctx, () => {
    paintFace(ctx, w, f);
    paintAccessory(ctx, w, f, 'face');
    paintFrontHair(ctx, w, f);
    paintAccessory(ctx, w, f, 'hair');
    paintHat(ctx, w, f);
  });
  if (w.held === 'umbrella') paintUmbrellaTop(ctx, f);
  if (raisesLeftArm(f.pose)) paintLeftArm(ctx, w, f);
}

/**
 * アバターを描く（足元基準）。
 * @param ctx 描画先（dpr 変換済み・CSS px 座標）
 * @param look 装い（省略した項目は既定で描く）
 * @param at 足元の位置と拡大率（0.6 未満は細かい飾りを省く）
 * @param motion 動き（ポーズと経過秒。省略で止まった絵＝立ちポーズ・目を開ける）
 * @sideEffect ctx に描画する（状態は save/restore で戻す）
 */
export function drawAvatar(ctx: Ctx, look: AvatarLook, at: AvatarPlacement, motion?: AvatarMotion): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const w = wearOf(look);
  const f = frameOf(motion, at.scale);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.scale(at.scale, at.scale);
  ctx.setLineDash([]);
  paintShadow(ctx, f);
  if (w.pet !== undefined) paintPet(ctx, w.pet, f);
  ctx.translate(0, f.bob - f.lift);
  paintBody(ctx, w, f);
  paintHead(ctx, w, f);
  ctx.restore();
}
