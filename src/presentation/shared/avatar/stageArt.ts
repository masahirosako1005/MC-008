/**
 * @file アバターのステージの絵（presentation/shared/avatar。Canvas 描画の純粋関数）
 * アバター画面のステージ（と、その一覧の小さな見本）に敷く「背景」24種と、アバターの横に置く「置くもの」19種を描く。
 * キラキラ系（パステル地 #FFF5FB・ピンク／ラベンダー／空色／レモン／ミント・つやの照り・黒い線なし）の背景・置くものを含む。
 * - 背景は矩形 [0,0,w,h] を不透明に塗りきる。地面の線（アバターの足元）は h × STAGE_FLOOR_RATIO。
 *   中央の足元には輪や楕円を描かない（台座・スポットライト・粒子は画面側の stageSparkle が重ねる）。
 *   ステージ（約 358×280）でも見本（72×72）でも崩れないよう、位置は幅・高さの割合、細部は unitOf の倍率で決める。
 * - 置くものは足元の中心 (x, y) 基準。拡大率 1 で高さ約 70px・幅 ±40px（アバターと同じ縮尺）。足元に淡い影を敷く。
 * - t は経過秒。桜の花びら・星のまたたき・提灯の揺れ・湯気などの小さなループに使う。t=0 でも完成した絵になる（動きを減らす設定は t=0）。
 * 絵柄は街の絵（cityArt）と同じフラットなモダンのイラスト（墨の輪郭線なし・面の明暗だけ）。アバターの部屋なので、
 * 門前町の鳥居や夏祭りの提灯など、地区の雰囲気を伝える記号はここでは使う。乱数は使わず、模様は番号と種（hash2）から決める。
 * 毎フレーム描画から呼ばれるため関数ログは出さない（呼び出し側でまとめてログ）。
 */
import { mixColors, toRgba } from '@/Common/ui/canvas/colorUtils';
import type { BackgroundStyle, ObjectStyle } from '@/presentation/shared/avatar/avatarLook';
import { colorTone, fillBox, fillDisc, fillPoly, hash2, paintCloud, paintFarSkyline, paintShopfront, paintSky, paintStreetTree, paintStripedAwning } from '@/presentation/shared/cityArt';
import type { ArtBox } from '@/presentation/shared/cityArt';
import type { ShopIcon } from '@/presentation/shared/shopIcons';

/** 地面の線（アバターの足元）の高さの割合。足元の Y = h × STAGE_FLOOR_RATIO */
export const STAGE_FLOOR_RATIO = 0.8;

/** 背景を描く関数（矩形 [0,0,w,h]、経過秒 t） */
type BackgroundPainter = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
/** 置くものを描く関数（足元の中心が原点・上が負の座標。拡大率は呼び出し側で掛け済み） */
type ObjectPainter = (ctx: CanvasRenderingContext2D, t: number) => void;
/** 点（x, y） */
type Pt = readonly [number, number];

// ---------------------------------------------------------------------------
// 小さな部品
// ---------------------------------------------------------------------------

/**
 * ステージ基準（358×280）に対する倍率。細部（線の太さ・小物の大きさ）に掛ける。
 * @param w 幅
 * @param h 高さ
 * @returns 倍率（ステージで 1、72×72 の見本で約 0.2）
 */
function unitOf(w: number, h: number): number { // audit-ignore: fnlog-missing 毎フレーム描画
  return Math.min(w / 358, h / 280);
}

/**
 * 正の剰余（ループする位置に使う）。
 * @param v 値
 * @param m 周期（正）
 * @returns 0 以上 m 未満
 */
function wrap(v: number, m: number): number { // audit-ignore: fnlog-missing 毎フレーム描画
  return m <= 0 ? 0 : ((v % m) + m) % m;
}

/**
 * 番号と種から決まる [0,1) の値（模様の位置・大きさ。Math.random は使わない）。
 * @param i 番号
 * @param seed 種
 * @returns 0 以上 1 未満
 */
function rand01(i: number, seed: number): number { // audit-ignore: fnlog-missing 毎フレーム描画
  return (hash2(i, seed) % 10000) / 10000;
}

/**
 * 楕円を塗る（回転つき）。
 * @param ctx 描画先
 * @param c 中心 X・Y・半径 X・半径 Y
 * @param fill 塗り色
 * @param rot 回転（ラジアン。省略時 0）
 */
function fillOval(ctx: CanvasRenderingContext2D, c: readonly [number, number, number, number], fill: string, rot = 0): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (c[2] <= 0 || c[3] <= 0) return;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(c[0], c[1], c[2], c[3], rot, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 折れ線を引く（端は丸）。
 * @param ctx 描画先
 * @param pts 頂点
 * @param color 線の色
 * @param width 線の太さ
 */
function strokeLine(ctx: CanvasRenderingContext2D, pts: readonly Pt[], color: string, width: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.4, width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}

/**
 * 放射状のやわらかい光を置く。
 * @param ctx 描画先
 * @param c 中心 X・Y・半径
 * @param color 光の色 '#rrggbb'
 * @param alpha 中心の不透明度
 */
function paintGlow(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], color: string, alpha: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, r] = c;
  if (r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, toRgba(color, Math.max(0, Math.min(1, alpha))));
  g.addColorStop(1, toRgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/**
 * 4方向に光るきらめきを塗る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 半径
 * @param color 色
 */
function paintSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (r <= 0) return;
  const k = r * 0.26;
  fillPoly(ctx, [[x, y - r], [x + k, y - k], [x + r, y], [x + k, y + k], [x, y + r], [x - k, y + k], [x - r, y], [x - k, y - k]], color);
}

/**
 * 五芒星を塗る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 外側の半径
 * @param color 色
 */
function paintStar5(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  fillPoly(ctx, pts, color);
}

/**
 * 不透明度を変えて描く（save/restore で戻す）。
 * @param ctx 描画先
 * @param alpha 不透明度
 * @param paint 描く処理
 */
function withAlpha(ctx: CanvasRenderingContext2D, alpha: number, paint: () => void): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  paint();
  ctx.restore();
}

/**
 * 桜の花びらを1枚塗る。
 * @param ctx 描画先
 * @param c 中心 X・Y・大きさ
 * @param rot 回転
 * @param color 色
 */
function paintPetal(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], rot: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  fillOval(ctx, [c[0], c[1], c[2], c[2] * 0.6], color, rot);
}

/**
 * 範囲の中を舞い落ちる花びら（t で上から下へループ）。
 * @param ctx 描画先
 * @param area x・y・幅・高さ
 * @param t 経過秒
 * @param opts 枚数・大きさ・種
 */
function paintFallingPetals(ctx: CanvasRenderingContext2D, area: readonly [number, number, number, number], t: number, opts: { readonly count: number; readonly size: number; readonly seed: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [ax, ay, aw, ah] = area;
  for (let i = 0; i < opts.count; i++) {
    const speed = 0.18 + rand01(i, opts.seed + 1) * 0.16;
    const y = ay + wrap(rand01(i, opts.seed + 2) * ah + t * speed * ah, ah);
    const x = ax + rand01(i, opts.seed) * aw + Math.sin(t * 1.3 + i * 1.7) * opts.size * 3;
    paintPetal(ctx, [x, y, opts.size * (0.8 + rand01(i, opts.seed + 3) * 0.5)], t * 1.8 + i, i % 3 === 0 ? '#fbd3e3' : '#f7a8c8');
  }
}

/**
 * 立ちのぼる湯気（3つのふくらみが上へ消えていく）。
 * @param ctx 描画先
 * @param at 湯気の根元 X・Y
 * @param t 経過秒
 * @param s 大きさの倍率
 */
function paintSteam(ctx: CanvasRenderingContext2D, at: Pt, t: number, s: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < 3; i++) {
    const p = wrap(t * 0.55 + i / 3, 1);
    withAlpha(ctx, 0.7 * (1 - p), () => fillDisc(ctx, at[0] + Math.sin(p * 6 + i) * 3 * s, at[1] - p * 20 * s, (3 + p * 4.5) * s, '#ffffff'));
  }
}

/**
 * 吊り提灯（赤い胴・上下の黒い輪・金の房・まわりの灯り）を描く。
 * @param ctx 描画先
 * @param x 吊り元の X
 * @param top 吊り元の Y
 * @param s 大きさの倍率（1 で高さ約 29px）
 */
function paintChochin(ctx: CanvasRenderingContext2D, x: number, top: number, s: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const cy = top + 14 * s;
  paintGlow(ctx, [x, cy, 22 * s], '#ff9a6b', 0.38);
  fillBox(ctx, [x - 0.5 * s, top, 1 * s, 3 * s], '#3f3f46');
  fillBox(ctx, [x - 4 * s, top + 2.5 * s, 8 * s, 2.5 * s], '#2b2b33', s);
  fillOval(ctx, [x, cy, 8 * s, 10 * s], '#ef4a3c');
  fillOval(ctx, [x - 2.6 * s, cy - 2 * s, 3 * s, 6.5 * s], '#ff7a63');
  for (const dy of [-6, -2, 2, 6]) {
    const half = 8 * s * Math.sqrt(1 - (dy / 10) ** 2);
    fillBox(ctx, [x - half, cy + dy * s - 0.4 * s, half * 2, 0.8 * s], 'rgba(127, 29, 29, 0.4)');
  }
  fillBox(ctx, [x - 4 * s, top + 23 * s, 8 * s, 2.5 * s], '#2b2b33', s);
  fillBox(ctx, [x - 0.6 * s, top + 25.5 * s, 1.2 * s, 3 * s], '#f5b700');
}

/**
 * 鳥居（朱の柱・黒い笠木・額）を描く。背景（参道の奥）と置くもので共用する。
 * @param ctx 描画先
 * @param cx 中心 X
 * @param base 足元の Y
 * @param size 幅・高さ
 */
function paintTorii(ctx: CanvasRenderingContext2D, cx: number, base: number, size: { readonly w: number; readonly h: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  const red = '#e5533d';
  const black = '#2b2b33';
  const pw = w * 0.09;
  const px = w * 0.32;
  const ty = base - h;
  fillBox(ctx, [cx - px - pw / 2, ty + h * 0.12, pw, h * 0.88], red);
  fillBox(ctx, [cx + px - pw / 2, ty + h * 0.12, pw, h * 0.88], mixColors(red, '#111827', 0.16));
  fillBox(ctx, [cx - px - pw * 0.75, base - h * 0.1, pw * 1.5, h * 0.1], black);
  fillBox(ctx, [cx + px - pw * 0.75, base - h * 0.1, pw * 1.5, h * 0.1], black);
  fillBox(ctx, [cx - w * 0.44, ty + h * 0.3, w * 0.88, h * 0.07], red);
  fillPoly(ctx, [[cx - w * 0.54, ty - h * 0.05], [cx - w * 0.44, ty + h * 0.02], [cx + w * 0.44, ty + h * 0.02], [cx + w * 0.54, ty - h * 0.05], [cx + w * 0.46, ty + h * 0.09], [cx - w * 0.46, ty + h * 0.09]], black);
  fillBox(ctx, [cx - w * 0.44, ty + h * 0.09, w * 0.88, h * 0.06], red);
  fillBox(ctx, [cx - w * 0.07, ty + h * 0.13, w * 0.14, h * 0.17], '#f5b700', 1);
  fillBox(ctx, [cx - w * 0.05, ty + h * 0.15, w * 0.1, h * 0.13], black, 1);
}

// ---------------------------------------------------------------------------
// 背景
// ---------------------------------------------------------------------------

/** グリッターの色（キラキラ系の装飾。docs のデザイン仕様のパレット） */
const GLITTER_COLORS: readonly string[] = ['#ffffff', '#ffd6ec', '#ffe58a', '#d9c8ff', '#bdebff'];
/** ボケ（にじんだ光の丸）の色 */
const BOKEH_COLORS: readonly string[] = ['#ffb6d9', '#c4b5fd', '#a5f3fc', '#ffe58a'];
/** 虹の色（外側から） */
const RAINBOW_COLORS: readonly string[] = ['#ff6fb5', '#ffc94d', '#7ce38b', '#5cc8ff', '#a98bff'];

/**
 * 色の表から番号で1色を選ぶ（表は空でない前提。空なら白）。
 * @param colors 色の表
 * @param i 番号
 * @returns 色
 */
function pick(colors: readonly string[], i: number): string { // audit-ignore: fnlog-missing 毎フレーム描画
  return colors[Math.abs(i) % Math.max(1, colors.length)] ?? '#ffffff';
}

/**
 * ハートを塗る（中心 (x, y)。左右 ±s・上 -0.75s・下 +0.9s ほど）。
 * @param ctx 描画先
 * @param c 中心 X・Y・大きさ
 * @param fill 塗り色
 */
function fillHeart(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], fill: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, s] = c;
  if (s <= 0) return;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.25, y + s * 0.05, x - s * 0.9, y - s * 0.95, x, y - s * 0.38);
  ctx.bezierCurveTo(x + s * 0.9, y - s * 0.95, x + s * 1.25, y + s * 0.05, x, y + s * 0.9);
  ctx.closePath();
  ctx.fill();
}

/**
 * つやのあるハート（本体・右下の影・左上の白い照り）を描く。
 * @param ctx 描画先
 * @param c 中心 X・Y・大きさ
 * @param color 本体の色
 */
function paintGlossyHeart(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, s] = c;
  fillHeart(ctx, [x + s * 0.06, y + s * 0.06, s], mixColors(color, '#7a2e6e', 0.18));
  fillHeart(ctx, [x, y, s * 0.96], color);
  withAlpha(ctx, 0.85, () => fillOval(ctx, [x - s * 0.46, y - s * 0.3, s * 0.24, s * 0.13], '#ffffff', -0.7));
  fillDisc(ctx, x - s * 0.2, y - s * 0.46, s * 0.07, '#ffffff');
}

/**
 * にじんだ光の丸（ボケ）を散らす。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param t 経過秒
 * @param opts 個数・種・不透明度
 */
function paintBokeh(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, t: number, opts: { readonly count: number; readonly seed: number; readonly alpha: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  for (let i = 0; i < opts.count; i++) {
    const r = h * (0.04 + rand01(i, opts.seed + 2) * 0.09);
    const x = w * rand01(i, opts.seed);
    const y = h * 0.7 * rand01(i, opts.seed + 1) + Math.sin(t * 0.5 + i * 1.9) * r * 0.15;
    const color = pick(BOKEH_COLORS, i);
    withAlpha(ctx, opts.alpha, () => fillDisc(ctx, x, y, r, color));
    withAlpha(ctx, opts.alpha * 0.9, () => fillDisc(ctx, x - r * 0.18, y - r * 0.18, r * 0.55, mixColors(color, '#ffffff', 0.5)));
  }
}

/**
 * 浮かんでまたたく小さなハートと星を散らす。
 * @param ctx 描画先
 * @param area x・y・幅・高さ
 * @param t 経過秒
 * @param opts 個数・大きさ・種
 */
function paintFloatingCharms(ctx: CanvasRenderingContext2D, area: readonly [number, number, number, number], t: number, opts: { readonly count: number; readonly size: number; readonly seed: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [ax, ay, aw, ah] = area;
  for (let i = 0; i < opts.count; i++) {
    const x = ax + aw * rand01(i, opts.seed);
    const y = ay + ah * rand01(i, opts.seed + 1) + Math.sin(t * 0.9 + i * 1.3) * opts.size * 0.8;
    const s = opts.size * (0.7 + rand01(i, opts.seed + 2) * 0.6);
    withAlpha(ctx, 0.55 + 0.45 * Math.abs(Math.sin(t * 1.1 + i * 2.3)), () => {
      if (i % 3 === 0) fillHeart(ctx, [x, y, s * 0.8], pick(BOKEH_COLORS, i));
      else paintSparkle(ctx, x, y, s, pick(GLITTER_COLORS, i + 1));
    });
  }
}

/**
 * 背景「シンプル」：パステルの地に水玉・ボケ・きらめき（中央の床はあけておく。台座は画面側が描く）。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgPlain(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.72;
  paintSky(ctx, [0, 0, w, h], ['#fff5fb', '#ffe3f0']);
  const step = Math.max(6, 22 * u);
  for (let row = 0, y = step / 2; y < hor; row++, y += step) {
    for (let x = row % 2 === 0 ? step / 2 : step; x < w; x += step) fillDisc(ctx, x, y, Math.max(0.6, 2.2 * u), 'rgba(255, 182, 217, 0.35)');
  }
  paintBokeh(ctx, { w, h }, t, { count: 7, seed: 11, alpha: 0.3 });
  paintFloatingCharms(ctx, [0, 0, w, hor * 0.9], t, { count: 10, size: 4 * u, seed: 14 });
  paintSky(ctx, [0, hor, w, h - hor], ['#ffe9f4', '#ffd9eb']);
  fillBox(ctx, [0, hor, w, Math.max(1, 2 * u)], 'rgba(255, 255, 255, 0.8)');
}

/**
 * 部屋の窓（空と流れる雲・カーテン・窓台）を描く。
 * @param ctx 描画先
 * @param r 窓の x・y・幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintRoomWindow(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number], t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, ww, wh] = r;
  fillBox(ctx, [x - 4 * u, y - 4 * u, ww + 8 * u, wh + 8 * u], '#ffffff', 3 * u);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, ww, wh);
  ctx.clip();
  paintSky(ctx, [x, y, ww, wh], ['#9fd0f3', '#e3f2fc']);
  paintCloud(ctx, x + wrap(t * 5 * u + ww * 0.3, ww + 50 * u) - 30 * u, y + wh * 0.42, 30 * u);
  paintFarSkyline(ctx, { from: x, to: x + ww }, { base: y + wh, offset: 0, color: '#cfe0ee', minH: wh * 0.12, maxH: wh * 0.3, seed: 3, unit: Math.max(4, 14 * u) });
  ctx.restore();
  fillBox(ctx, [x + ww / 2 - 1.5 * u, y, 3 * u, wh], '#ffffff');
  fillBox(ctx, [x, y + wh / 2 - 1.5 * u, ww, 3 * u], '#ffffff');
  fillBox(ctx, [x - 10 * u, y - 9 * u, ww + 20 * u, 3 * u], '#b98a5e', 1.5 * u);
  fillPoly(ctx, [[x - 9 * u, y - 6 * u], [x + ww * 0.24, y - 6 * u], [x + ww * 0.06, y + wh + 6 * u], [x - 9 * u, y + wh + 6 * u]], '#ff9f86');
  fillPoly(ctx, [[x + ww + 9 * u, y - 6 * u], [x + ww * 0.76, y - 6 * u], [x + ww * 0.94, y + wh + 6 * u], [x + ww + 9 * u, y + wh + 6 * u]], '#ff9f86');
  fillBox(ctx, [x - 9 * u, y + wh * 0.62, ww * 0.16, 2.5 * u], '#e9785c');
  fillBox(ctx, [x - 6 * u, y + wh + 4 * u, ww + 12 * u, 4 * u], '#efe2d0', u);
}

/**
 * 部屋の壁の飾り（絵・時計・本棚・鉢植え・おもちゃ）を描く。
 * @param ctx 描画先
 * @param r 飾りの範囲 x・y・幅・高さ
 * @param u 細部の倍率
 */
function paintRoomShelf(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number], u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, sw, sh] = r;
  fillBox(ctx, [x + sw * 0.06, y, sw * 0.42, sh * 0.32], '#ffffff', 2 * u);
  fillBox(ctx, [x + sw * 0.1, y + sh * 0.04, sw * 0.34, sh * 0.24], '#bfe3f7');
  fillPoly(ctx, [[x + sw * 0.1, y + sh * 0.28], [x + sw * 0.22, y + sh * 0.12], [x + sw * 0.32, y + sh * 0.22], [x + sw * 0.38, y + sh * 0.16], [x + sw * 0.44, y + sh * 0.28]], '#7cc79a');
  fillDisc(ctx, x + sw * 0.36, y + sh * 0.09, sh * 0.035, '#ffd166');
  fillDisc(ctx, x + sw * 0.78, y + sh * 0.13, sh * 0.11, '#ffffff');
  fillDisc(ctx, x + sw * 0.78, y + sh * 0.13, sh * 0.085, '#fff7ed');
  strokeLine(ctx, [[x + sw * 0.78, y + sh * 0.13], [x + sw * 0.78, y + sh * 0.07]], '#475569', 1.4 * u);
  strokeLine(ctx, [[x + sw * 0.78, y + sh * 0.13], [x + sw * 0.83, y + sh * 0.15]], '#475569', 1.4 * u);
  const board = y + sh * 0.58;
  const books = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#0ea5e9'];
  books.forEach((color, i) => {
    const bh = sh * (0.16 + (i % 3) * 0.03);
    fillBox(ctx, [x + sw * 0.05 + i * sw * 0.09, board - bh, sw * 0.075, bh], color, 0.8 * u);
  });
  fillPoly(ctx, [[x + sw * 0.66, board - sh * 0.1], [x + sw * 0.84, board - sh * 0.1], [x + sw * 0.81, board], [x + sw * 0.69, board]], '#e58357');
  fillDisc(ctx, x + sw * 0.7, board - sh * 0.15, sh * 0.06, '#34c77b');
  fillDisc(ctx, x + sw * 0.8, board - sh * 0.16, sh * 0.065, '#22a565');
  fillDisc(ctx, x + sw * 0.75, board - sh * 0.21, sh * 0.06, '#3fd28a');
  fillBox(ctx, [x, board, sw, 4 * u], '#b07a4f', u);
  const board2 = y + sh * 0.95;
  fillBox(ctx, [x + sw * 0.08, board2 - sh * 0.12, sw * 0.16, sh * 0.12], '#fca5a5', u);
  fillBox(ctx, [x + sw * 0.26, board2 - sh * 0.08, sw * 0.12, sh * 0.08], '#93c5fd', u);
  fillDisc(ctx, x + sw * 0.6, board2 - sh * 0.07, sh * 0.07, '#fde68a');
  fillDisc(ctx, x + sw * 0.6, board2 - sh * 0.15, sh * 0.045, '#fde68a');
  fillBox(ctx, [x, board2, sw, 4 * u], '#b07a4f', u);
}

/**
 * 背景「マイルーム」：ストライプの壁・窓・本棚・木の床・まるいラグ。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgRoom(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const wallBottom = h * 0.66;
  fillBox(ctx, [0, 0, w, wallBottom], '#fbf3e8');
  const step = Math.max(4, 22 * u);
  for (let x = step / 2; x < w; x += step) fillBox(ctx, [x, 0, Math.max(1, 7 * u), wallBottom], '#f5e9da');
  fillBox(ctx, [0, wallBottom - 16 * u, w, 16 * u], '#ecdcc8');
  fillBox(ctx, [0, wallBottom - 16 * u, w, Math.max(1, 2 * u)], '#ffffff');
  paintRoomWindow(ctx, [w * 0.07, h * 0.12, w * 0.3, h * 0.34], t, u);
  paintRoomShelf(ctx, [w * 0.6, h * 0.07, w * 0.34, h * 0.48], u);
  paintSky(ctx, [0, wallBottom, w, h - wallBottom], ['#e2b483', '#cf9a68']);
  for (let i = 1; i <= 5; i++) {
    const y = wallBottom + (h - wallBottom) * Math.pow(i / 6, 1.25);
    fillBox(ctx, [0, y, w, Math.max(0.6, 1.2 * u)], '#c38d5c');
  }
  fillBox(ctx, [0, wallBottom, w, Math.max(1, 3 * u)], '#a87650');
}

/**
 * 石灯籠を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param base 足元の Y
 * @param s 大きさの倍率（1 で高さ約 54px）
 */
function paintStoneLantern(ctx: CanvasRenderingContext2D, x: number, base: number, s: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const stone = '#cdc7bc';
  const deep = '#aca596';
  fillBox(ctx, [x - 9 * s, base - 5 * s, 18 * s, 5 * s], deep, s);
  fillBox(ctx, [x - 3 * s, base - 26 * s, 6 * s, 21 * s], stone);
  fillBox(ctx, [x - 8 * s, base - 30 * s, 16 * s, 4 * s], deep);
  fillBox(ctx, [x - 6 * s, base - 42 * s, 12 * s, 12 * s], stone);
  fillBox(ctx, [x - 3 * s, base - 39 * s, 6 * s, 6 * s], '#ffe7a3');
  fillPoly(ctx, [[x - 11 * s, base - 42 * s], [x + 11 * s, base - 42 * s], [x + 4 * s, base - 50 * s], [x - 4 * s, base - 50 * s]], deep);
  fillDisc(ctx, x, base - 52 * s, 2.5 * s, deep);
}

/**
 * 奥の社殿（藤色の反った屋根・朱の柱）を描く。
 * @param ctx 描画先
 * @param cx 中心 X
 * @param base 足元の Y
 * @param size 幅・高さ
 */
function paintShrineHall(ctx: CanvasRenderingContext2D, cx: number, base: number, size: { readonly w: number; readonly h: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  const bodyTop = base - h * 0.45;
  fillBox(ctx, [cx - w * 0.36, bodyTop, w * 0.72, h * 0.45], '#f4eee6');
  for (let i = 0; i < 5; i++) fillBox(ctx, [cx - w * 0.34 + i * w * 0.165, bodyTop, Math.max(1, w * 0.025), h * 0.45], '#d9694b');
  ctx.fillStyle = '#6c70c6';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, bodyTop + h * 0.03);
  ctx.quadraticCurveTo(cx - w * 0.3, bodyTop - h * 0.06, cx - w * 0.2, base - h);
  ctx.lineTo(cx + w * 0.2, base - h);
  ctx.quadraticCurveTo(cx + w * 0.3, bodyTop - h * 0.06, cx + w / 2, bodyTop + h * 0.03);
  ctx.closePath();
  ctx.fill();
  fillBox(ctx, [cx - w * 0.22, base - h - h * 0.05, w * 0.44, h * 0.06], '#575bb0', 1);
  fillDisc(ctx, cx - w * 0.22, base - h - h * 0.02, h * 0.04, '#f5b700');
  fillDisc(ctx, cx + w * 0.22, base - h - h * 0.02, h * 0.04, '#f5b700');
  fillBox(ctx, [cx - w * 0.12, base - h * 0.08, w * 0.24, h * 0.08], '#e5ddd0');
}

/**
 * 上の藤棚（梁と、揺れる藤の房）を描く。
 * @param ctx 描画先
 * @param w 幅
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintWisteria(ctx: CanvasRenderingContext2D, w: number, t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  fillBox(ctx, [0, 0, w, Math.max(2, 6 * u)], '#9b7a5a');
  const n = 14;
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) * w) / n;
    const len = (18 + rand01(i, 41) * 24) * u;
    const sway = Math.sin(t * 1.1 + i * 0.9) * 2.4 * u;
    fillOval(ctx, [x - 4 * u, 7 * u, 7 * u, 3 * u], '#7cc79a', -0.3);
    for (let k = 0; k < 6; k++) {
      const p = k / 5;
      fillDisc(ctx, x + sway * p, 6 * u + len * p, (4.4 - p * 2.6) * u, k % 2 === 0 ? '#a98ff0' : '#c7b5f7');
    }
  }
}

/**
 * 背景「門前の参道」（南森町）：藤棚・社殿・鳥居・石畳の参道・石灯籠。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgMinamimori(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.62;
  paintSky(ctx, [0, 0, w, hor], ['#d9dafb', '#f6f4ff']);
  paintCloud(ctx, wrap(w * 0.2 + t * 4 * u, w + 90 * u) - 50 * u, h * 0.22, 50 * u);
  for (const [fx, fr] of [[0.02, 0.2], [0.14, 0.14], [0.86, 0.15], [0.98, 0.21]] as const) {
    fillDisc(ctx, w * fx, hor - h * fr * 0.55, h * fr, fx < 0.5 ? '#86c79f' : '#74bd92');
  }
  paintShrineHall(ctx, w / 2, hor, { w: w * 0.48, h: h * 0.3 });
  fillBox(ctx, [0, hor, w, h - hor], '#ece6dc');
  fillPoly(ctx, [[w * 0.43, hor], [w * 0.57, hor], [w * 0.9, h], [w * 0.1, h]], '#dad2c4');
  for (let i = 1; i <= 6; i++) {
    const p = Math.pow(i / 7, 1.4);
    const half = w * (0.07 + 0.33 * p);
    fillBox(ctx, [w / 2 - half, hor + (h - hor) * p, half * 2, Math.max(0.6, 1.2 * u)], '#c9bfae');
  }
  paintTorii(ctx, w / 2, hor + h * 0.05, { w: w * 0.4, h: h * 0.36 });
  paintStoneLantern(ctx, w * 0.33, hor + 8 * u, 0.5 * u);
  paintStoneLantern(ctx, w * 0.67, hor + 8 * u, 0.5 * u);
  paintStoneLantern(ctx, w * 0.1, h * 0.92, 1.05 * u);
  paintStoneLantern(ctx, w * 0.9, h * 0.92, 1.05 * u);
  paintWisteria(ctx, w, t, u);
}

/** 天満の店先（地区色・看板のアイコン） */
const TENMA_SHOPS: readonly { readonly accent: string; readonly icon: ShopIcon }[] = [
  { accent: '#f59e0b', icon: 'bowl' },
  { accent: '#ef4444', icon: 'fish' },
  { accent: '#10b981', icon: 'leaf' },
  { accent: '#6366f1', icon: 'cup' },
];

/**
 * アーケードの屋根（明かり取りの天窓・梁・揺れる垂れ幕）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintArcadeRoof(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  const roofH = h * 0.16;
  paintSky(ctx, [0, 0, w, roofH], ['#f5cf80', '#fbe7b8']);
  const step = Math.max(6, 30 * u);
  for (let x = 0; x < w + step; x += step) {
    fillBox(ctx, [x + 4 * u, roofH * 0.18, step - 8 * u, roofH * 0.46], 'rgba(255, 255, 255, 0.5)', 2 * u);
    fillBox(ctx, [x - 1.5 * u, 0, Math.max(1, 3 * u), roofH], '#e2ac4b');
  }
  fillBox(ctx, [0, roofH, w, Math.max(2, 5 * u)], '#c98a2c');
  const n = 5;
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.translate(((i + 0.5) * w) / n, roofH + 4 * u);
    ctx.rotate(Math.sin(t * 1.4 + i * 1.3) * 0.07);
    fillBox(ctx, [-0.5 * u, 0, Math.max(0.6, u), 6 * u], '#8a5a1f');
    fillBox(ctx, [-9 * u, 6 * u, 18 * u, 22 * u], i % 2 === 0 ? '#ff5a36' : '#3b82f6', 2 * u);
    fillBox(ctx, [-6 * u, 10 * u, 12 * u, 2 * u], '#ffffff');
    fillBox(ctx, [-6 * u, 15 * u, 9 * u, 2 * u], 'rgba(255, 255, 255, 0.8)');
    fillBox(ctx, [-6 * u, 20 * u, 11 * u, 2 * u], 'rgba(255, 255, 255, 0.8)');
    ctx.restore();
  }
}

/**
 * 背景「天満の市場」：アーケードの屋根・垂れ幕・店先の並び・湯気・タイルの床。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgTenma(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.66;
  paintSky(ctx, [0, 0, w, hor], ['#fff0cf', '#fffaf1']);
  const sw = w / TENMA_SHOPS.length;
  TENMA_SHOPS.forEach((shop, i) => {
    const box: ArtBox = { x: i * sw + sw * 0.05, base: hor, w: sw * 0.9, h: h * 0.46 };
    paintShopfront(ctx, box, colorTone(shop.accent, { lit: true }), { icon: shop.icon, floors: 1, seed: i + 2 });
  });
  paintSteam(ctx, [sw * 0.3, hor - h * 0.12], t, 1.4 * u);
  paintSteam(ctx, [sw * 0.6, hor - h * 0.12], t + 0.9, 1.2 * u);
  fillBox(ctx, [0, hor, w, h - hor], '#f3e6d0');
  for (let i = 1; i <= 6; i++) fillBox(ctx, [0, hor + (h - hor) * Math.pow(i / 7, 1.3), w, Math.max(0.6, u)], '#e3d0b2');
  for (let k = -7; k <= 7; k++) strokeLine(ctx, [[w / 2 + k * w * 0.06, hor], [w / 2 + k * w * 0.24, h]], '#e3d0b2', Math.max(0.6, u));
  paintArcadeRoof(ctx, { w, h }, t, u);
}

/** 天六の家（壁・屋根の色） */
const TENROKU_HOUSES: readonly { readonly wall: string; readonly roof: string }[] = [
  { wall: '#fff6ea', roof: '#3f8f6b' },
  { wall: '#eef2f7', roof: '#64748b' },
  { wall: '#fdf0f4', roof: '#b4533a' },
  { wall: '#effbf5', roof: '#2f6f8f' },
];

/**
 * 下町の家（切妻の屋根・窓・1階の店またはドア）を描く。
 * @param ctx 描画先
 * @param b 範囲
 * @param colors 壁・屋根の色
 * @param opts 細部の倍率と模様の種
 */
function paintTownHouse(ctx: CanvasRenderingContext2D, b: ArtBox, colors: { readonly wall: string; readonly roof: string }, opts: { readonly u: number; readonly seed: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { u } = opts;
  const bodyTop = b.base - b.h * 0.68;
  const bodyH = b.base - bodyTop;
  fillBox(ctx, [b.x, bodyTop, b.w, bodyH], colors.wall);
  fillBox(ctx, [b.x + b.w * 0.84, bodyTop, b.w * 0.16, bodyH], mixColors(colors.wall, '#111827', 0.06));
  fillPoly(ctx, [[b.x - 4 * u, bodyTop], [b.x + b.w + 4 * u, bodyTop], [b.x + b.w * 0.78, b.base - b.h], [b.x + b.w * 0.22, b.base - b.h]], colors.roof);
  fillBox(ctx, [b.x - 4 * u, bodyTop, b.w + 8 * u, Math.max(1, 2.5 * u)], mixColors(colors.roof, '#111827', 0.25));
  for (const fx of [0.14, 0.56]) {
    fillBox(ctx, [b.x + b.w * fx, bodyTop + bodyH * 0.12, b.w * 0.26, bodyH * 0.24], '#cfe4f6', u);
    fillBox(ctx, [b.x + b.w * (fx + 0.13) - 0.5 * u, bodyTop + bodyH * 0.12, Math.max(0.6, u), bodyH * 0.24], '#ffffff');
  }
  if (opts.seed % 2 === 0) {
    paintStripedAwning(ctx, [b.x + b.w * 0.08, b.base - bodyH * 0.48, b.w * 0.84, Math.max(2, 6 * u)], colorTone(colors.roof));
    fillBox(ctx, [b.x + b.w * 0.12, b.base - bodyH * 0.36, b.w * 0.52, bodyH * 0.36], '#cfe4f6', u);
    fillBox(ctx, [b.x + b.w * 0.7, b.base - bodyH * 0.36, b.w * 0.18, bodyH * 0.36], '#94a3b8', u);
    return;
  }
  fillBox(ctx, [b.x + b.w * 0.62, b.base - bodyH * 0.42, b.w * 0.22, bodyH * 0.42], '#9a7b62', u);
  fillBox(ctx, [b.x + b.w * 0.14, b.base - bodyH * 0.32, b.w * 0.26, bodyH * 0.15], '#e5e7eb', u);
  fillBox(ctx, [b.x + b.w * 0.16, b.base - bodyH * 0.29, b.w * 0.22, Math.max(0.6, u)], '#cbd5e1');
}

/**
 * 電柱と電線（電線にとまる鳥つき）を描く。
 * @param ctx 描画先
 * @param w 幅
 * @param hor 地面の線の Y
 * @param u 細部の倍率
 */
function paintPolesAndWires(ctx: CanvasRenderingContext2D, w: number, hor: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const top = hor * 0.16;
  const p0 = w * 0.2;
  const p1 = w * 0.8;
  for (const k of [0, 1]) {
    const y = top + (8 + k * 6) * u;
    ctx.strokeStyle = 'rgba(55, 65, 81, 0.55)';
    ctx.lineWidth = Math.max(0.5, 0.9 * u);
    ctx.beginPath();
    ctx.moveTo(-5, y + 8 * u);
    ctx.quadraticCurveTo(p0 / 2, y + 14 * u, p0, y);
    ctx.quadraticCurveTo(w / 2, y + 22 * u, p1, y);
    ctx.quadraticCurveTo((p1 + w) / 2, y + 14 * u, w + 5, y + 8 * u);
    ctx.stroke();
  }
  for (const x of [p0, p1]) {
    fillBox(ctx, [x - 2 * u, top, 4 * u, hor - top], '#9aa3ae');
    fillBox(ctx, [x - 11 * u, top + 7 * u, 22 * u, 2.4 * u], '#7c8591');
    fillBox(ctx, [x + 2 * u, top + 20 * u, 6 * u, 8 * u], '#b8c0ca', u);
  }
  const wy = top + 8 * u;
  for (const s of [0.42, 0.5]) {
    const bx = (1 - s) * (1 - s) * p0 + 2 * (1 - s) * s * (w / 2) + s * s * p1;
    const by = (1 - s) * (1 - s) * wy + 2 * (1 - s) * s * (wy + 22 * u) + s * s * wy;
    fillOval(ctx, [bx, by - 2 * u, 2.8 * u, 2.1 * u], '#475569');
    fillDisc(ctx, bx + 2.2 * u, by - 4 * u, 1.5 * u, '#475569');
  }
}

/**
 * 背景「天六の商店街」：下町の家並み・電柱と電線・歩道の鉢植え・道路。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgTenroku(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.64;
  paintSky(ctx, [0, 0, w, hor], ['#cdeafb', '#f2fbf6']);
  paintCloud(ctx, wrap(w * 0.55 + t * 5 * u, w + 90 * u) - 50 * u, h * 0.16, 44 * u);
  paintCloud(ctx, wrap(w * 0.05 + t * 3 * u, w + 70 * u) - 40 * u, h * 0.3, 30 * u);
  const hw = w / TENROKU_HOUSES.length;
  TENROKU_HOUSES.forEach((colors, i) => {
    paintTownHouse(ctx, { x: i * hw + hw * 0.06, base: hor, w: hw * 0.88, h: h * (0.32 + (i % 2) * 0.07) }, colors, { u, seed: i });
  });
  paintPolesAndWires(ctx, w, hor, u);
  fillBox(ctx, [0, hor, w, h * 0.05], '#d9d3c8');
  fillBox(ctx, [0, hor + h * 0.05, w, h - hor - h * 0.05], '#ebe7e0');
  fillBox(ctx, [0, hor + h * 0.05, w, Math.max(1, 2 * u)], '#c9c2b5');
  for (let x = w * 0.04; x < w; x += w * 0.22) fillBox(ctx, [x, h * 0.95, w * 0.1, Math.max(1, 2.5 * u)], '#ffffff');
  for (let i = 0; i < 5; i++) {
    const x = w * (0.08 + i * 0.21);
    const base = hor + h * 0.045;
    fillPoly(ctx, [[x - 5 * u, base - 8 * u], [x + 5 * u, base - 8 * u], [x + 3.5 * u, base], [x - 3.5 * u, base]], '#d9774b');
    fillDisc(ctx, x - 2 * u, base - 11 * u, 4 * u, '#34c77b');
    fillDisc(ctx, x + 2.5 * u, base - 12 * u, 3.6 * u, '#22a565');
    fillDisc(ctx, x, base - 14 * u, 1.6 * u, i % 2 === 0 ? '#f472b6' : '#facc15');
  }
}

/**
 * 空に揚がる凧（ひし形と尾）を描く。
 * @param ctx 描画先
 * @param at 中心 X・Y
 * @param u 細部の倍率
 * @param t 経過秒
 */
function paintKite(ctx: CanvasRenderingContext2D, at: Pt, u: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y] = at;
  const tail: Pt[] = [];
  for (let i = 0; i <= 5; i++) tail.push([x - i * 3 * u + Math.sin(t * 3 + i) * 2 * u, y + 10 * u + i * 5 * u]);
  strokeLine(ctx, tail, '#f472b6', 1.2 * u);
  fillPoly(ctx, [[x, y - 9 * u], [x + 7 * u, y], [x, y + 10 * u], [x - 7 * u, y]], '#ff6b8b');
  fillPoly(ctx, [[x, y - 9 * u], [x + 7 * u, y], [x, y + 10 * u]], '#ff9db3');
  strokeLine(ctx, [[x, y + 10 * u], [x - 40 * u, y + 70 * u]], 'rgba(71, 85, 105, 0.35)', 0.6 * u);
}

/**
 * 背景「扇町公園」：遠くのビル・芝生・小道・木・花壇・凧。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgOgimachi(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.6;
  paintSky(ctx, [0, 0, w, hor], ['#d4eafd', '#fdf1f7']);
  paintCloud(ctx, wrap(w * 0.3 + t * 4 * u, w + 90 * u) - 50 * u, h * 0.15, 46 * u);
  paintKite(ctx, [w * 0.7 + Math.sin(t * 0.8) * 6 * u, h * 0.2 + Math.sin(t * 1.3) * 4 * u], u, t);
  paintFarSkyline(ctx, { from: 0, to: w }, { base: hor, offset: 0, color: '#e3e8f2', minH: h * 0.08, maxH: h * 0.26, seed: 5, unit: Math.max(6, 24 * u) });
  paintSky(ctx, [0, hor, w, h - hor], ['#bfe8c6', '#a6dbb0']);
  ctx.fillStyle = '#f5e2d3';
  ctx.beginPath();
  ctx.moveTo(w * 0.55, hor);
  ctx.lineTo(w * 0.63, hor);
  ctx.quadraticCurveTo(w * 0.5, h * 0.74, w * 0.8, h);
  ctx.lineTo(w * 0.2, h);
  ctx.quadraticCurveTo(w * 0.36, h * 0.72, w * 0.55, hor);
  ctx.closePath();
  ctx.fill();
  const tone = colorTone('#ec4899');
  paintStreetTree(ctx, { x: w * 0.27, base: hor + 2 * u, w: w * 0.08, h: h * 0.17 }, tone);
  paintStreetTree(ctx, { x: w * 0.66, base: hor + 2 * u, w: w * 0.07, h: h * 0.15 }, tone, true);
  paintStreetTree(ctx, { x: -w * 0.05, base: hor + h * 0.14, w: w * 0.26, h: h * 0.52 }, tone);
  paintStreetTree(ctx, { x: w * 0.8, base: hor + h * 0.12, w: w * 0.24, h: h * 0.46 }, tone, true);
  fillOval(ctx, [w * 0.88, h * 0.92, w * 0.13, h * 0.045], '#8fd19e');
  for (let i = 0; i < 9; i++) {
    const colors = ['#f472b6', '#ffffff', '#facc15'];
    fillDisc(ctx, w * (0.77 + rand01(i, 51) * 0.22), h * (0.9 + rand01(i, 52) * 0.04), 2.2 * u, colors[i % colors.length] ?? '#ffffff');
  }
}

/**
 * 川面（流れるきらめき・ゆっくり進む水上バス）を描く。
 * @param ctx 描画先
 * @param r 川の x・y・幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintRiver(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number], t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, w, h] = r;
  paintSky(ctx, [x, y, w, h], ['#7cc0ea', '#a8d8f4']);
  const bx = wrap(t * 6 * u + w * 0.35, w + 70 * u) - 35 * u;
  fillBox(ctx, [bx - 18 * u, y + h * 0.32, 36 * u, h * 0.24], '#ffffff', 3 * u);
  fillBox(ctx, [bx - 12 * u, y + h * 0.12, 22 * u, h * 0.22], '#f59e0b', 2 * u);
  fillBox(ctx, [bx - 10 * u, y + h * 0.17, 18 * u, h * 0.08], '#cfe4f6');
  for (let i = 0; i < 14; i++) {
    const row = i % 4;
    const sx = wrap(rand01(i, 61) * w + t * (8 + row * 3) * u, w + 30 * u) - 15 * u;
    const len = (10 + rand01(i, 62) * 16) * u;
    fillBox(ctx, [x + sx, y + h * (0.12 + row * 0.24), len, Math.max(0.6, 1.4 * u)], 'rgba(255, 255, 255, 0.55)');
  }
}

/**
 * ふんわり重なる房の木（幹・房・照り）を描く。桜・紅葉で色だけ変えて使う。
 * @param ctx 描画先
 * @param at 幹の X・足元の Y
 * @param size 高さ（房の半径もここから決める）
 * @param colors 房の色（順に使う）と照りの色
 */
function paintCanopyTree(ctx: CanvasRenderingContext2D, at: Pt, size: number, colors: { readonly puffs: readonly string[]; readonly light: string }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, base] = at;
  const cy = base - size * 0.72;
  const r = size * 0.34;
  fillPoly(ctx, [[x - size * 0.04, base], [x + size * 0.04, base], [x + size * 0.02, cy + r * 0.3], [x + size * 0.1, cy], [x + size * 0.07, cy - r * 0.05], [x, cy + r * 0.2], [x - size * 0.08, cy - r * 0.02], [x - size * 0.03, cy + r * 0.4]], '#8c6d62');
  const puffs: readonly (readonly [number, number, number])[] = [[0, 0, 1], [-0.62, 0.22, 0.7], [0.62, 0.25, 0.72], [-0.32, -0.45, 0.66], [0.36, -0.42, 0.62], [0, 0.42, 0.6]];
  puffs.forEach(([dx, dy, k], i) => fillDisc(ctx, x + dx * r, cy + dy * r, r * k * 0.62, pick(colors.puffs, i)));
  fillDisc(ctx, x - r * 0.25, cy - r * 0.35, r * 0.18, colors.light);
  fillDisc(ctx, x + r * 0.35, cy - r * 0.1, r * 0.14, colors.light);
}

/**
 * 桜の木（幹と、ふんわり重なる花の房）を描く。
 * @param ctx 描画先
 * @param x 幹の X
 * @param base 足元の Y
 * @param size 高さ（花の房の半径もここから決める）
 */
function paintSakuraTree(ctx: CanvasRenderingContext2D, x: number, base: number, size: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  paintCanopyTree(ctx, [x, base], size, { puffs: ['#f9bfd6', '#f6a8c8'], light: '#fde1ec' });
}

/**
 * 背景「大川の桜並木」：向こう岸の街・川と水上バス・石積みの岸・遊歩道・桜の木・舞う花びら。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgOkawa(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const bank = h * 0.44;
  const shore = h * 0.66;
  paintSky(ctx, [0, 0, w, bank], ['#c9e6fb', '#f3f9ff']);
  paintCloud(ctx, wrap(w * 0.4 + t * 4 * u, w + 90 * u) - 50 * u, h * 0.14, 44 * u);
  paintFarSkyline(ctx, { from: 0, to: w }, { base: bank, offset: 0, color: '#d6e2ee', minH: h * 0.05, maxH: h * 0.18, seed: 9, unit: Math.max(6, 20 * u) });
  fillBox(ctx, [0, bank - h * 0.005, w, h * 0.03], '#a9d7b4');
  for (let i = 0; i < 12; i++) fillDisc(ctx, ((i + 0.5) * w) / 12, bank, (5 + (i % 3)) * u, i % 2 === 0 ? '#f9c4da' : '#f7b2cd');
  paintRiver(ctx, [0, bank + h * 0.025, w, shore - bank - h * 0.025], t, u);
  fillBox(ctx, [0, shore, w, h * 0.03], '#c9d3de');
  for (let x = 0; x < w; x += Math.max(4, 16 * u)) fillBox(ctx, [x, shore, Math.max(0.6, u), h * 0.03], '#b3bfcc');
  paintSky(ctx, [0, shore + h * 0.03, w, h - shore - h * 0.03], ['#f3e9df', '#eadccd']);
  paintSakuraTree(ctx, w * 0.06, h * 0.94, h * 0.92);
  paintSakuraTree(ctx, w * 0.95, h * 0.9, h * 0.8);
  paintFallingPetals(ctx, [0, 0, w, h], t, { count: 18, size: 2.6 * u, seed: 21 });
}

/**
 * 背景「夕焼けの川辺」：紫から橙の空・沈む太陽・街のシルエット・照り返す水面・手すり・鳥。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgSunset(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.52;
  const shore = h * 0.7;
  const sky = ctx.createLinearGradient(0, 0, 0, hor);
  sky.addColorStop(0, '#5b4bc4');
  sky.addColorStop(0.55, '#ef7f72');
  sky.addColorStop(1, '#ffd08a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, hor);
  const sunX = w * 0.64;
  paintGlow(ctx, [sunX, hor, h * 0.34], '#ffd59a', 0.75);
  fillDisc(ctx, sunX, hor - h * 0.03, h * 0.085, '#fff1c9');
  for (let i = 0; i < 3; i++) fillBox(ctx, [wrap(w * (0.1 + i * 0.35) + t * (3 + i) * u, w + 80 * u) - 60 * u, h * (0.12 + i * 0.09), (50 - i * 8) * u, 5 * u], 'rgba(255, 170, 150, 0.55)', 2.5 * u);
  paintFarSkyline(ctx, { from: 0, to: w }, { base: hor, offset: 0, color: '#6b4f8f', minH: h * 0.04, maxH: h * 0.16, seed: 13, unit: Math.max(6, 20 * u) });
  paintSky(ctx, [0, hor, w, shore - hor], ['#f0a07e', '#8a62a6']);
  for (let k = 0; k < 6; k++) {
    const width = (44 - k * 5) * u * (0.8 + 0.2 * Math.sin(t * 2 + k));
    fillBox(ctx, [sunX - width / 2, hor + ((k + 0.5) * (shore - hor)) / 6, width, Math.max(0.8, 1.8 * u)], 'rgba(255, 236, 190, 0.7)');
  }
  paintSky(ctx, [0, shore, w, h - shore], ['#e8a888', '#d68c72']);
  fillBox(ctx, [0, shore - 10 * u, w, Math.max(1, 2 * u)], '#4a3a6e');
  for (let x = 4 * u; x < w; x += Math.max(5, 26 * u)) fillBox(ctx, [x, shore - 10 * u, Math.max(1, 2 * u), 10 * u], '#4a3a6e');
  for (let i = 0; i < 3; i++) {
    const bx = wrap(t * 10 * u + i * w * 0.33, w + 40 * u) - 20 * u;
    const by = h * (0.18 + i * 0.06) + Math.sin(t * 3 + i) * 2 * u;
    const flap = (2 + Math.sin(t * 6 + i) * 1.2) * u;
    strokeLine(ctx, [[bx - 4 * u, by - flap], [bx, by], [bx + 4 * u, by - flap]], '#3e2f60', 1.1 * u);
  }
}

/**
 * 夜空にひらく打ち上げ花火（周期でひらいて消える）。
 * @param ctx 描画先
 * @param at 中心 X・Y
 * @param t 経過秒
 * @param opts 位相のずれ・色・細部の倍率
 */
function paintSkyBurst(ctx: CanvasRenderingContext2D, at: Pt, t: number, opts: { readonly offset: number; readonly color: string; readonly u: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const p = wrap(t / 2.8 + opts.offset, 1);
  const r = (10 + 28 * (1 - (1 - p) * (1 - p))) * opts.u;
  withAlpha(ctx, 1 - p * p, () => {
    paintGlow(ctx, [at[0], at[1], r * 1.4], opts.color, 0.28);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const drop = p * p * 6 * opts.u;
      const ex = at[0] + Math.cos(a) * r;
      const ey = at[1] + Math.sin(a) * r + drop;
      strokeLine(ctx, [[at[0] + Math.cos(a) * r * 0.55, at[1] + Math.sin(a) * r * 0.55 + drop], [ex, ey]], opts.color, 1.3 * opts.u);
      fillDisc(ctx, ex, ey, 1.4 * opts.u, '#ffffff');
    }
  });
}

/**
 * 夏まつりの屋台の並び（灯りのともったカウンター・縞の屋根・のれん）を描く。
 * @param ctx 描画先
 * @param w 幅
 * @param hor 地面の線の Y
 * @param h 高さ
 */
function paintYataiRow(ctx: CanvasRenderingContext2D, w: number, hor: number, h: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < 3; i++) {
    const bw = w * 0.26;
    const x = w * (0.03 + i * 0.35);
    const top = hor - h * 0.27;
    fillBox(ctx, [x + bw * 0.04, top + h * 0.06, bw * 0.92, h * 0.21], '#2b2350');
    paintGlow(ctx, [x + bw / 2, hor - h * 0.09, bw * 0.62], '#ffcf7a', 0.5);
    fillBox(ctx, [x + bw * 0.08, hor - h * 0.12, bw * 0.84, h * 0.07], '#ffd98f');
    for (let k = 0; k < 6; k++) fillBox(ctx, [x + (k * bw) / 6, top, bw / 6, h * 0.06], k % 2 === 0 ? '#e5483d' : '#fff1e6');
    const noren = ['#3b4a8a', '#e5483d', '#3b4a8a'];
    noren.forEach((color, k) => fillBox(ctx, [x + bw * 0.1 + k * bw * 0.28, top + h * 0.06, bw * 0.25, h * 0.07], color));
  }
}

/**
 * 上に張った提灯の列（たるんだ綱・揺れる提灯）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintLanternString(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  const y0 = h * 0.06;
  const sag = h * 0.1;
  /**
   * 綱の高さ。
   * @param x 横の位置
   * @returns 綱の Y
   */
  const ropeY = (x: number): number => y0 + sag * 4 * (x / w) * (1 - x / w);
  const rope: Pt[] = [];
  for (let i = 0; i <= 16; i++) rope.push([(i / 16) * w, ropeY((i / 16) * w)]);
  strokeLine(ctx, rope, '#1f1a33', Math.max(0.6, 1.2 * u));
  const n = 7;
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) * w) / n;
    ctx.save();
    ctx.translate(x, ropeY(x));
    ctx.rotate(Math.sin(t * 1.6 + i) * 0.12);
    paintChochin(ctx, 0, 0, 0.9 * u);
    ctx.restore();
  }
}

/**
 * 背景「夏まつりの夜」：紺の夜空・打ち上げ花火・屋台の灯り・提灯の列・足元の明かり。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgNight(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.64;
  paintSky(ctx, [0, 0, w, hor], ['#141a46', '#3b2c66']);
  for (let i = 0; i < 14; i++) {
    withAlpha(ctx, 0.4 + 0.5 * Math.abs(Math.sin(t * 1.1 + i)), () => fillDisc(ctx, rand01(i, 81) * w, rand01(i, 82) * hor * 0.7, (0.6 + rand01(i, 83)) * u, '#ffffff'));
  }
  paintSkyBurst(ctx, [w * 0.24, h * 0.26], t, { offset: 0.55, color: '#ff7ab6', u });
  paintSkyBurst(ctx, [w * 0.74, h * 0.2], t, { offset: 0.2, color: '#ffd166', u });
  paintSkyBurst(ctx, [w * 0.52, h * 0.34], t, { offset: 0.85, color: '#6ee7ff', u: u * 0.8 });
  paintYataiRow(ctx, w, hor, h);
  paintSky(ctx, [0, hor, w, h - hor], ['#3a2f55', '#2a2342']);
  paintLanternString(ctx, { w, h }, t, u);
}

/**
 * 流れ星（6秒に1回、空を斜めに横切る）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintShootingStar(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const p = wrap(t + 0.5, 6);
  if (p > 1) return;
  const { w, h } = size;
  const hx = w * 0.12 + w * 0.5 * p;
  const hy = h * 0.06 + w * 0.5 * p * 0.4;
  const tail = 46 * u;
  const g = ctx.createLinearGradient(hx, hy, hx - tail, hy - tail * 0.4);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = Math.max(0.6, 1.6 * u);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - tail, hy - tail * 0.4);
  ctx.stroke();
  fillDisc(ctx, hx, hy, 1.8 * u, '#ffffff');
}

/**
 * 星空の丘（2重の丘・灯りのともる小さな家）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param hor 地面の線の Y
 * @param u 細部の倍率
 */
function paintNightHills(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, hor: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  ctx.fillStyle = '#1f2d6b';
  ctx.beginPath();
  ctx.moveTo(0, hor - h * 0.06);
  ctx.quadraticCurveTo(w * 0.25, hor - h * 0.22, w * 0.55, hor - h * 0.04);
  ctx.quadraticCurveTo(w * 0.8, hor - h * 0.16, w, hor - h * 0.08);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  const hx = w * 0.26;
  const hy = hor - h * 0.135;
  fillBox(ctx, [hx - 7 * u, hy - 8 * u, 14 * u, 8 * u], '#16225a');
  fillPoly(ctx, [[hx - 9 * u, hy - 8 * u], [hx + 9 * u, hy - 8 * u], [hx, hy - 15 * u]], '#16225a');
  fillBox(ctx, [hx - 2 * u, hy - 6 * u, 4 * u, 3.5 * u], '#ffd98a');
  paintGlow(ctx, [hx, hy - 4 * u, 12 * u], '#ffd98a', 0.4);
  ctx.fillStyle = '#18245a';
  ctx.beginPath();
  ctx.moveTo(0, hor + h * 0.02);
  ctx.quadraticCurveTo(w * 0.5, hor - h * 0.06, w, hor + h * 0.03);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 10; i++) {
    const x = rand01(i, 91) * w;
    const y = hor + h * (0.06 + rand01(i, 92) * 0.3);
    fillPoly(ctx, [[x - 2.5 * u, y], [x, y - 5 * u], [x + 2.5 * u, y]], '#24357a');
  }
}

/**
 * 背景「星空」：深い夜空・天の川・またたく星・月・流れ星・丘。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgStarry(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.68;
  paintSky(ctx, [0, 0, w, h], ['#0a1238', '#2b3a7e']);
  withAlpha(ctx, 0.16, () => fillPoly(ctx, [[0, h * 0.5], [w * 0.22, h * 0.56], [w, h * 0.06], [w * 0.78, 0]], '#c7d2fe'));
  for (let i = 0; i < 46; i++) {
    const x = rand01(i, 71) * w;
    const y = rand01(i, 72) * hor * 0.95;
    const r = (0.5 + rand01(i, 73) * 1.3) * u;
    withAlpha(ctx, 0.35 + 0.65 * Math.abs(Math.sin(t * 1.2 + i * 2.1)), () => {
      if (rand01(i, 74) > 0.85) paintSparkle(ctx, x, y, r * 2.6, '#ffffff');
      else fillDisc(ctx, x, y, r, '#ffffff');
    });
  }
  paintGlow(ctx, [w * 0.8, h * 0.18, h * 0.24], '#fff3c4', 0.42);
  fillDisc(ctx, w * 0.8, h * 0.18, h * 0.075, '#fff6d8');
  fillDisc(ctx, w * 0.78, h * 0.16, h * 0.016, '#f1e3b4');
  fillDisc(ctx, w * 0.82, h * 0.21, h * 0.012, '#f1e3b4');
  paintShootingStar(ctx, { w, h }, t, u);
  paintNightHills(ctx, { w, h }, hor, u);
}

/**
 * やわらかい虹（5色の弧・半透明）を描く。
 * @param ctx 描画先
 * @param c 弧の中心 X・Y・外側の半径
 * @param band 1色の帯の太さ
 */
function paintSoftRainbow(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], band: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, r] = c;
  withAlpha(ctx, 0.42, () => {
    ctx.lineWidth = Math.max(0.6, band);
    ctx.lineCap = 'butt';
    RAINBOW_COLORS.forEach((color, i) => {
      const rr = r - band * (i + 0.5);
      if (rr <= 0) return;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, rr, Math.PI, Math.PI * 2);
      ctx.stroke();
    });
  });
}

/**
 * ふわふわのパステルの雲（下は淡い藤色の影・上は白・照り）を描く。
 * @param ctx 描画先
 * @param x 左端
 * @param y 下端
 * @param s 大きさ（1 で幅約 60px）
 */
function paintPuffyCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const puffs: readonly (readonly [number, number, number])[] = [[10, -9, 9], [24, -16, 13], [40, -12, 11], [52, -7, 7]];
  fillBox(ctx, [x + 2 * s, y - 9 * s, 56 * s, 9 * s], '#efe4ff', 4.5 * s);
  for (const [px, py, pr] of puffs) fillDisc(ctx, x + px * s, y + py * s + 1.5 * s, pr * s, '#efe4ff');
  for (const [px, py, pr] of puffs) fillDisc(ctx, x + px * s, y + py * s, pr * s * 0.92, '#ffffff');
  fillBox(ctx, [x + 4 * s, y - 10 * s, 50 * s, 6 * s], '#ffffff', 3 * s);
  withAlpha(ctx, 0.7, () => fillOval(ctx, [x + 21 * s, y - 22 * s, 5 * s, 2.2 * s], '#fff5fb', -0.3));
}

/**
 * 雲の床（手前に盛り上がる白とピンクの雲。中央の足元は平らにあけておく）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param hor 雲の床の上端の Y
 * @param u 細部の倍率
 */
function paintCloudFloor(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, hor: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  paintSky(ctx, [0, hor, w, h - hor], ['#fff3fa', '#ffe0f0']);
  const r = Math.max(4, 18 * u);
  for (let x = -r * 0.5, i = 0; x < w + r; x += r * 1.3, i++) {
    fillDisc(ctx, x, hor + r * 0.35, r * (0.9 + rand01(i, 33) * 0.3), i % 2 === 0 ? '#ffe6f3' : '#f1e8ff');
    fillDisc(ctx, x, hor + r * 0.2, r * (0.78 + rand01(i, 34) * 0.25), '#ffffff');
  }
  fillBox(ctx, [0, hor + r * 0.5, w, h - hor - r * 0.5], '#fff6fb');
  for (const fx of [0.06, 0.94]) {
    fillDisc(ctx, w * fx, h * 0.95, r * 1.6, '#ffe6f3');
    fillDisc(ctx, w * fx, h * 0.93, r * 1.35, '#ffffff');
  }
}

/**
 * 背景「ゆめかわの空」：ピンク→ラベンダー→空色の空・やわらかい虹・ふわふわの雲・浮かぶハートと星・雲の床。
 * 既定の背景なので、アバターの後ろ（中央）は明るく静かに保つ。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgDreamy(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.72;
  const sky = ctx.createLinearGradient(0, 0, 0, hor);
  sky.addColorStop(0, '#ffd3ea');
  sky.addColorStop(0.5, '#e6d6ff');
  sky.addColorStop(1, '#cdefff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, hor);
  paintSoftRainbow(ctx, [w * 0.5, hor + h * 0.06, Math.max(w, h) * 0.56], Math.max(1, 7 * u));
  paintBokeh(ctx, { w, h }, t, { count: 6, seed: 23, alpha: 0.22 });
  paintPuffyCloud(ctx, wrap(w * 0.04 + t * 3 * u, w + 80 * u) - 70 * u, h * 0.3, 1.05 * u);
  paintPuffyCloud(ctx, wrap(w * 0.62 + t * 2 * u, w + 80 * u) - 70 * u, h * 0.18, 0.8 * u);
  paintPuffyCloud(ctx, wrap(w * 0.78 + t * 4 * u, w + 80 * u) - 70 * u, h * 0.52, 0.7 * u);
  paintFloatingCharms(ctx, [0, h * 0.04, w, hor * 0.85], t, { count: 12, size: 4.5 * u, seed: 27 });
  paintCloudFloor(ctx, { w, h }, hor, u);
}

/**
 * アイドルのステージの幕（ひだのあるピンクの幕・金の留め紐）を片側描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param side 左なら -1、右なら 1
 * @param u 細部の倍率
 */
function paintIdolCurtain(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, side: -1 | 1, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  /**
   * 左側の X を、右側なら鏡に映した X にする。
   * @param x 左側の X
   * @returns 実際の X
   */
  const mx = (x: number): number => (side < 0 ? x : w - x);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(mx(0), 0);
  ctx.lineTo(mx(w * 0.2), 0);
  ctx.quadraticCurveTo(mx(w * 0.16), h * 0.35, mx(w * 0.075), h * 0.46);
  ctx.quadraticCurveTo(mx(w * 0.13), h * 0.62, mx(w * 0.15), h);
  ctx.lineTo(mx(0), h);
  ctx.closePath();
  ctx.fillStyle = '#ff8cc6';
  ctx.fill();
  ctx.clip();
  const fold = Math.max(3, 12 * u);
  for (let x = fold * 0.5; x < w * 0.22; x += fold) fillBox(ctx, [Math.min(mx(x), mx(x + fold * 0.45)), 0, fold * 0.45, h], '#f06aae');
  for (let x = fold * 0.2; x < w * 0.22; x += fold) fillBox(ctx, [Math.min(mx(x), mx(x + fold * 0.12)), 0, fold * 0.12, h], 'rgba(255, 255, 255, 0.35)');
  ctx.restore();
  fillOval(ctx, [mx(w * 0.085), h * 0.46, 6 * u, 3.2 * u], '#ffd86b');
  fillDisc(ctx, mx(w * 0.085), h * 0.46, 2.4 * u, '#fff3b0');
}

/**
 * ステージ上部の飾り幕（ラベンダーの波形と金の縁）を描く。
 * @param ctx 描画先
 * @param w 幅
 * @param u 細部の倍率
 */
function paintIdolValance(ctx: CanvasRenderingContext2D, w: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const vh = 16 * u;
  const r = Math.max(3, 12 * u);
  fillBox(ctx, [0, 0, w, vh], '#c9a2ff');
  for (let x = r, i = 0; x < w + r; x += r * 2, i++) {
    fillDisc(ctx, x, vh, r, i % 2 === 0 ? '#c9a2ff' : '#b58cf5');
    fillDisc(ctx, x, vh + r * 0.75, Math.max(0.8, 2 * u), '#ffd86b');
  }
  fillBox(ctx, [0, vh - 2 * u, w, Math.max(1, 2.4 * u)], '#ffd86b');
  fillBox(ctx, [0, 2 * u, w, Math.max(0.6, 1.2 * u)], 'rgba(255, 255, 255, 0.55)');
}

/**
 * 上から揺れながら差すライト（ピンク・ラベンダー・空色・レモンの光の帯）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintIdolBeams(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  for (let i = 0; i < 4; i++) {
    const color = pick(BOKEH_COLORS, i);
    ctx.save();
    ctx.translate(w * (0.14 + i * 0.24), 0);
    ctx.rotate((i < 2 ? 0.22 : -0.22) + Math.sin(t * 0.6 + i * 1.7) * 0.18);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, toRgba(color, 0.5));
    g.addColorStop(1, toRgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-3 * u, 0);
    ctx.lineTo(3 * u, 0);
    ctx.lineTo(w * 0.11, h);
    ctx.lineTo(-w * 0.11, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    fillDisc(ctx, w * (0.14 + i * 0.24), 18 * u, 4 * u, '#fff7d6');
  }
}

/**
 * 奥の壁の星の灯り（またたく星形のライト）と、アバターの後ろを囲む電球の弧（順に光る）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param hor 床の線の Y
 * @param t 経過秒
 */
function paintIdolLights(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, hor: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  const u = unitOf(w, h);
  for (let i = 0; i < 9; i++) {
    const x = w * (0.2 + rand01(i, 101) * 0.6);
    const y = hor * (0.15 + rand01(i, 102) * 0.55);
    const r = (4 + rand01(i, 103) * 4) * u;
    const a = 0.55 + 0.45 * Math.abs(Math.sin(t * 1.4 + i * 1.9));
    withAlpha(ctx, a, () => {
      paintGlow(ctx, [x, y, r * 2.6], pick(BOKEH_COLORS, i), 0.45);
      paintStar5(ctx, x, y, r, pick(GLITTER_COLORS, i + 2));
    });
  }
  const n = 15;
  const ar = Math.min(w, h) * 0.42;
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (Math.PI * (i + 0.5)) / n;
    const on = (Math.floor(t * 4) + i) % 3 === 0;
    const x = w / 2 + Math.cos(a) * ar * 1.15;
    const y = hor + Math.sin(a) * ar;
    if (on) paintGlow(ctx, [x, y, 6 * u], '#ffe58a', 0.7);
    fillDisc(ctx, x, y, Math.max(0.7, 2.2 * u), on ? '#fff7d6' : '#ffd6ec');
  }
}

/**
 * グリッターの床（つやのあるラベンダーの床・またたく粒。中央の足元はあけておく）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param hor 床の上端の Y
 * @param t 経過秒
 */
function paintGlitterFloor(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, hor: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  const u = unitOf(w, h);
  paintSky(ctx, [0, hor, w, h - hor], ['#f1d9ff', '#d8b4fe']);
  fillBox(ctx, [0, hor, w, Math.max(1, 3 * u)], '#ffd86b');
  for (let i = 1; i <= 4; i++) fillBox(ctx, [0, hor + (h - hor) * Math.pow(i / 5, 1.3), w, Math.max(0.6, u)], 'rgba(255, 255, 255, 0.45)');
  for (let i = 0; i < 30; i++) {
    const x = w * rand01(i, 111);
    if (Math.abs(x - w / 2) < w * 0.17) continue;
    const y = hor + (h - hor) * (0.12 + rand01(i, 112) * 0.85);
    const a = 0.3 + 0.7 * Math.abs(Math.sin(t * 2 + i * 1.7));
    withAlpha(ctx, a, () => paintSparkle(ctx, x, y, (1.5 + rand01(i, 113) * 2.5) * u, pick(GLITTER_COLORS, i)));
  }
}

/**
 * 背景「キラキラステージ」：アイドルのステージ（パステルの壁・星のライト・電球の弧・差し込む光・グリッターの床・幕）。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgIdol(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.7;
  paintSky(ctx, [0, 0, w, hor], ['#7b4bc4', '#e78bd0']);
  paintBokeh(ctx, { w, h }, t, { count: 6, seed: 121, alpha: 0.25 });
  paintIdolLights(ctx, { w, h }, hor, t);
  paintIdolBeams(ctx, { w, h }, t, u);
  paintGlitterFloor(ctx, { w, h }, hor, t);
  paintIdolCurtain(ctx, { w, h }, -1, u);
  paintIdolCurtain(ctx, { w, h }, 1, u);
  paintIdolValance(ctx, w, u);
}

// ---------------------------------------------------------------------------
// 背景（キラキラ系の追加 8種: 水族館・夜桜・雪のイルミネーション・おかしの国・夏の海・おとぎのお城・パステルカフェ・ゆめの銀河）
// ---------------------------------------------------------------------------

/**
 * またたく星を散らす（ときどき4方向のきらめき）。
 * @param ctx 描画先
 * @param area x・y・幅・高さ
 * @param t 経過秒
 * @param opts 個数・大きさ・種
 */
function paintStarField(ctx: CanvasRenderingContext2D, area: readonly [number, number, number, number], t: number, opts: { readonly count: number; readonly size: number; readonly seed: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [ax, ay, aw, ah] = area;
  for (let i = 0; i < opts.count; i++) {
    const x = ax + aw * rand01(i, opts.seed);
    const y = ay + ah * rand01(i, opts.seed + 1);
    const r = opts.size * (0.5 + rand01(i, opts.seed + 2));
    withAlpha(ctx, 0.35 + 0.65 * Math.abs(Math.sin(t * 1.2 + i * 2.1)), () => {
      if (rand01(i, opts.seed + 3) > 0.84) paintSparkle(ctx, x, y, r * 2.6, pick(GLITTER_COLORS, i));
      else fillDisc(ctx, x, y, r, '#ffffff');
    });
  }
}

/**
 * 流れ星（周期ごとに1回、指定の位置から斜めに流れる）を描く。
 * @param ctx 描画先
 * @param start 流れはじめの X・Y
 * @param t 経過秒
 * @param opts 位相・周期（秒）・流れる距離・細部の倍率
 */
function paintShootingStarAt(ctx: CanvasRenderingContext2D, start: Pt, t: number, opts: { readonly phase: number; readonly period: number; readonly dist: number; readonly u: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const p = wrap(t + opts.phase, opts.period);
  if (p > 1) return;
  const hx = start[0] + opts.dist * p;
  const hy = start[1] + opts.dist * p * 0.4;
  const tail = 40 * opts.u;
  const g = ctx.createLinearGradient(hx, hy, hx - tail, hy - tail * 0.4);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  g.addColorStop(1, 'rgba(201, 162, 255, 0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = Math.max(0.6, 1.6 * opts.u);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - tail, hy - tail * 0.4);
  ctx.stroke();
  paintSparkle(ctx, hx, hy, 3 * opts.u, '#ffffff');
}

/**
 * 空を飛ぶ鳥（V の字・羽ばたき）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param t 経過秒
 * @param opts 色・羽数・細部の倍率
 */
function paintFlyingBirds(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, t: number, opts: { readonly color: string; readonly count: number; readonly u: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  const { u } = opts;
  for (let i = 0; i < opts.count; i++) {
    const bx = wrap(t * 10 * u + i * w * 0.33, w + 40 * u) - 20 * u;
    const by = h * (0.14 + i * 0.06) + Math.sin(t * 3 + i) * 2 * u;
    const flap = (2.2 + Math.sin(t * 6 + i) * 1.3) * u;
    strokeLine(ctx, [[bx - 4.5 * u, by - flap], [bx, by], [bx + 4.5 * u, by - flap]], opts.color, 1.2 * u);
  }
}

/** 水族館の魚（色・高さの割合・大きさ・速さ。速さの符号が向き） */
const AQUA_FISH: readonly (readonly [string, number, number, number])[] = [
  ['#ffb6d9', 0.22, 9, 14], ['#ffe58a', 0.36, 7, -18], ['#a7f3d0', 0.5, 8, 11],
  ['#d9c8ff', 0.14, 6, -9], ['#bdebff', 0.44, 11, 8], ['#ffd6ec', 0.58, 6, -15],
];

/**
 * パステルの魚（しっぽを振る・つやのある体・目）を描く。
 * @param ctx 描画先
 * @param c 中心 X・Y・大きさ
 * @param color 体の色
 * @param dir 向き（正なら右向き、負なら左向き）
 * @param t 経過秒
 */
function paintFish(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], color: string, dir: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, s] = c;
  if (s <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir < 0 ? -1 : 1, 1);
  const wag = Math.sin(t * 6 + x * 0.05) * s * 0.18;
  fillPoly(ctx, [[-s * 0.8, 0], [-s * 1.55, -s * 0.55 + wag], [-s * 1.45, s * 0.55 + wag]], mixColors(color, '#7a3b8f', 0.12));
  fillOval(ctx, [0, 0, s, s * 0.58], color);
  fillPoly(ctx, [[-s * 0.1, -s * 0.5], [s * 0.3, -s * 0.95], [s * 0.45, -s * 0.45]], mixColors(color, '#ffffff', 0.3));
  fillOval(ctx, [-s * 0.05, -s * 0.24, s * 0.55, s * 0.13], 'rgba(255, 255, 255, 0.6)');
  fillDisc(ctx, s * 0.55, -s * 0.12, s * 0.17, '#ffffff');
  fillDisc(ctx, s * 0.59, -s * 0.12, s * 0.09, '#4a2350');
  ctx.restore();
}

/**
 * 上へのぼる泡（白い輪と照り）を描く。
 * @param ctx 描画先
 * @param area x・y・幅・高さ
 * @param t 経過秒
 * @param opts 個数・大きさ・種
 */
function paintBubbles(ctx: CanvasRenderingContext2D, area: readonly [number, number, number, number], t: number, opts: { readonly count: number; readonly size: number; readonly seed: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [ax, ay, aw, ah] = area;
  for (let i = 0; i < opts.count; i++) {
    const r = opts.size * (0.6 + rand01(i, opts.seed + 2) * 0.9);
    const y = ay + ah - wrap(rand01(i, opts.seed + 1) * ah + t * (0.12 + rand01(i, opts.seed + 3) * 0.1) * ah, ah);
    const x = ax + aw * rand01(i, opts.seed) + Math.sin(t * 2 + i) * r;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = Math.max(0.5, opts.size * 0.35);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    fillDisc(ctx, x - r * 0.35, y - r * 0.35, r * 0.28, 'rgba(255, 255, 255, 0.9)');
  }
}

/**
 * 水面から差す光のゆらめき（波打つ白い筋）を描く。
 * @param ctx 描画先
 * @param w 幅
 * @param bandH ゆらめきを描く上からの高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintCaustics(ctx: CanvasRenderingContext2D, w: number, bandH: number, t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let k = 0; k < 6; k++) {
    const y0 = bandH * (0.1 + k * 0.15);
    const pts: Pt[] = [];
    for (let i = 0; i <= 12; i++) pts.push([(i / 12) * w, y0 + Math.sin(i * 1.3 + t * 1.2 + k * 1.7) * 4 * u]);
    strokeLine(ctx, pts, 'rgba(255, 255, 255, 0.3)', 2.2 * u);
  }
}

/**
 * 水族館のトンネルの枠（アーチの骨組み・ガラスの継ぎ目・照り）を描く。
 * @param ctx 描画先
 * @param w 幅
 * @param hor 床の線の Y（アーチの中心）
 * @param u 細部の倍率
 */
function paintTunnelArch(ctx: CanvasRenderingContext2D, w: number, hor: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const cx = w / 2;
  ctx.lineCap = 'butt';
  for (const [r, lw, color] of [[w * 0.62, 14, '#eef7ff'], [w * 0.5, 7, 'rgba(230, 244, 255, 0.85)']] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, lw * u);
    ctx.beginPath();
    ctx.arc(cx, hor, r, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 1; i < 6; i++) {
    const a = Math.PI + (Math.PI * i) / 6;
    strokeLine(ctx, [[cx + Math.cos(a) * w * 0.5, hor + Math.sin(a) * w * 0.5], [cx + Math.cos(a) * w * 0.62, hor + Math.sin(a) * w * 0.62]], 'rgba(230, 244, 255, 0.7)', 2 * u);
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = Math.max(0.6, 3 * u);
  ctx.beginPath();
  ctx.arc(cx, hor, w * 0.56, Math.PI * 1.15, Math.PI * 1.4);
  ctx.stroke();
}

/**
 * ゆれる海藻（太い折れ線）を描く。
 * @param ctx 描画先
 * @param x 根元の X
 * @param base 根元の Y
 * @param height 高さ
 * @param opts 経過秒・細部の倍率・色
 */
function paintSeaweed(ctx: CanvasRenderingContext2D, x: number, base: number, height: number, opts: { readonly t: number; readonly u: number; readonly color: string }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const pts: Pt[] = [];
  for (let k = 0; k <= 6; k++) pts.push([x + Math.sin(opts.t * 1.4 + k * 0.8 + x) * k * 0.9 * opts.u, base - (k * height) / 6]);
  strokeLine(ctx, pts, opts.color, 4.5 * opts.u);
}

/**
 * 背景「水族館のトンネル」：青い水・ゆらめく光・泳ぐパステルの魚・のぼる泡・アーチの枠・海藻とサンゴ・光る床。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgAquarium(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.72;
  paintSky(ctx, [0, 0, w, hor], ['#5aaee8', '#c4ebff']);
  paintCaustics(ctx, w, h * 0.34, t, u);
  withAlpha(ctx, 0.16, () => paintFish(ctx, [wrap(w * 0.75 - t * 5 * u, w + 140 * u) - 70 * u, h * 0.3, 30 * u], '#2f6fb0', -1, t * 0.3));
  AQUA_FISH.forEach(([color, fy, s, speed], i) => {
    const span = w + 60 * u;
    const x = wrap(rand01(i, 131) * span + t * speed * u, span) - 30 * u;
    paintFish(ctx, [x, h * fy + Math.sin(t * 1.2 + i) * 3 * u, s * u], color, speed, t);
  });
  paintBubbles(ctx, [0, 0, w, hor], t, { count: 14, size: 2.6 * u, seed: 141 });
  paintTunnelArch(ctx, w, hor, u);
  paintSky(ctx, [0, hor, w, h - hor], ['#dcefff', '#c6dcff']);
  fillBox(ctx, [0, hor, w, Math.max(1, 2.5 * u)], '#ffffff');
  for (let i = 1; i <= 4; i++) fillBox(ctx, [0, hor + (h - hor) * Math.pow(i / 5, 1.3), w, Math.max(0.6, u)], 'rgba(255, 255, 255, 0.5)');
  for (const fx of [0.14, 0.86]) withAlpha(ctx, 0.4 + 0.2 * Math.sin(t * 1.5 + fx * 9), () => fillOval(ctx, [w * fx, h * 0.86, w * 0.08, h * 0.02], '#ffffff'));
  for (const [fx, color, hh] of [[0.04, '#a7f3d0', 0.3], [0.1, '#7fe0c0', 0.22], [0.92, '#a7f3d0', 0.26], [0.97, '#7fe0c0', 0.34]] as const) {
    paintSeaweed(ctx, w * fx, hor + 4 * u, h * hh, { t, u, color });
  }
  for (const [fx, color] of [[0.18, '#ffb6d9'], [0.8, '#d9c8ff']] as const) {
    fillDisc(ctx, w * fx, hor + 2 * u, 7 * u, color);
    fillDisc(ctx, w * fx + 6 * u, hor - 3 * u, 5 * u, mixColors(color, '#ffffff', 0.3));
    fillDisc(ctx, w * fx - 6 * u, hor - u, 4.5 * u, color);
  }
}

/**
 * ぼんぼり（灯りのともる紙の灯籠）を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param base 足元の Y
 * @param opts 細部の倍率・経過秒
 */
function paintBonbori(ctx: CanvasRenderingContext2D, x: number, base: number, opts: { readonly u: number; readonly t: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { u } = opts;
  paintGlow(ctx, [x, base - 26 * u, 18 * u], '#ffe58a', 0.45 + 0.08 * Math.sin(opts.t * 3 + x));
  fillBox(ctx, [x - 1.2 * u, base - 20 * u, 2.4 * u, 20 * u], '#c79a6b');
  fillBox(ctx, [x - 5 * u, base - 32 * u, 10 * u, 12 * u], '#fff4d6', 2 * u);
  fillBox(ctx, [x - 5 * u, base - 28 * u, 10 * u, u], '#ffb6d9');
  fillPoly(ctx, [[x - 7 * u, base - 32 * u], [x + 7 * u, base - 32 * u], [x, base - 37 * u]], '#8a5a8c');
}

/**
 * 背景「夜桜」：藍色の夜空・月と星・下から照らされた桜の木・ぼんぼり・提灯の列・舞う花びら。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgYozakura(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.7;
  paintSky(ctx, [0, 0, w, hor], ['#1e1b4b', '#5b3f95']);
  paintStarField(ctx, [0, 0, w, hor * 0.6], t, { count: 18, size: 1.1 * u, seed: 151 });
  paintGlow(ctx, [w * 0.74, h * 0.17, h * 0.22], '#fff3d6', 0.45);
  fillDisc(ctx, w * 0.74, h * 0.17, h * 0.062, '#fff8e6');
  fillDisc(ctx, w * 0.725, h * 0.155, h * 0.014, '#f6e9c8');
  for (let i = 0; i < 9; i++) fillDisc(ctx, ((i + 0.5) * w) / 9, hor - 2 * u, (14 + rand01(i, 152) * 10) * u, '#3a2c7a');
  paintSky(ctx, [0, hor, w, h - hor], ['#3d3170', '#2a2457']);
  for (const [fx, size] of [[0.3, 0.42], [0.68, 0.38], [0.07, 0.95], [0.94, 0.85]] as const) {
    const base = size > 0.5 ? h * 0.94 : hor + 4 * u;
    paintGlow(ctx, [w * fx, base - h * size * 0.62, h * size * 0.42], '#ff9ccc', 0.4);
    paintSakuraTree(ctx, w * fx, base, h * size);
  }
  for (const fx of [0.2, 0.8]) paintBonbori(ctx, w * fx, h * 0.9, { u, t });
  paintLanternString(ctx, { w, h }, t, u);
  paintFallingPetals(ctx, [0, 0, w, h], t, { count: 18, size: 2.4 * u, seed: 155 });
}

/**
 * 雪の積もった遠くの街並み（灯りのともる窓）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param hor 地面の線の Y
 * @param u 細部の倍率
 */
function paintSnowTown(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, hor: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  const n = 6;
  const bw = w / n;
  for (let i = 0; i < n; i++) {
    const bh = h * (0.16 + rand01(i, 171) * 0.16);
    const x = i * bw + bw * 0.06;
    const top = hor - bh;
    const ww = bw * 0.88;
    fillBox(ctx, [x, top, ww, bh], i % 2 === 0 ? '#4b5aa6' : '#5967b8');
    fillBox(ctx, [x - 1.5 * u, top - 2.5 * u, ww + 3 * u, 4 * u], '#f5f7ff', 2 * u);
    const rows = Math.max(1, Math.floor(bh / (14 * u + 1)));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        if (hash2(i * 31 + r, c) % 3 === 0) continue;
        fillBox(ctx, [x + ww * (0.12 + c * 0.29), top + 6 * u + r * 14 * u, ww * 0.18, 7 * u], '#ffe58a', u);
      }
    }
  }
}

/** イルミネーションの電球の色 */
const BULB_COLORS: readonly string[] = ['#ffe58a', '#ff8cc6', '#9adfff', '#a7f3d0', '#c9a2ff', '#ffffff'];

/**
 * イルミネーションの木（3段のミントの木・雪・またたく電球・てっぺんの星）を描く。
 * @param ctx 描画先
 * @param x 幹の X
 * @param base 足元の Y
 * @param height 高さ
 * @param opts 経過秒・細部の倍率
 */
function paintLitTree(ctx: CanvasRenderingContext2D, x: number, base: number, height: number, opts: { readonly t: number; readonly u: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { t, u } = opts;
  const tiers: readonly (readonly [number, number, number])[] = [[0.12, 0.55, 0.26], [0.4, 0.78, 0.2], [0.64, 0.98, 0.14]];
  fillBox(ctx, [x - 3 * u, base - height * 0.14, 6 * u, height * 0.14], '#a0785a');
  for (const [b, tp, hw] of tiers) {
    const by = base - height * b;
    const ty = base - height * tp;
    fillPoly(ctx, [[x - height * hw, by], [x + height * hw, by], [x, ty]], '#7fd6b4');
    fillPoly(ctx, [[x, ty], [x + height * hw, by], [x, by]], '#5fc29e');
    fillBox(ctx, [x - height * hw * 0.95, by - 2.5 * u, height * hw * 1.9, 3 * u], '#ffffff', 1.5 * u);
  }
  for (let i = 0; i < 16; i++) {
    const tier = tiers[i % 3] ?? [0.12, 0.55, 0.26];
    const by = base - height * tier[0];
    const ty = base - height * tier[1];
    const y = ty + (by - ty) * (0.3 + rand01(i, 181) * 0.65);
    const half = height * tier[2] * ((y - ty) / (by - ty));
    const lx = x + (rand01(i, 182) * 2 - 1) * half * 0.8;
    const color = pick(BULB_COLORS, i);
    withAlpha(ctx, 0.45 + 0.55 * Math.abs(Math.sin(t * 2.2 + i * 1.3)), () => {
      paintGlow(ctx, [lx, y, 6 * u], color, 0.7);
      fillDisc(ctx, lx, y, 1.8 * u, color);
    });
  }
  const top = base - height * 0.98;
  paintGlow(ctx, [x, top, 18 * u], '#ffe58a', 0.55 + 0.15 * Math.sin(t * 2));
  paintStar5(ctx, x, top, 7 * u, '#ffe58a');
}

/**
 * 上に張った電球の列（たるんだ線・またたく色とりどりの電球）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintTwinkleString(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  /**
   * 線の高さ。
   * @param x 横の位置
   * @returns 線の Y
   */
  const ropeY = (x: number): number => h * 0.07 + h * 0.09 * 4 * (x / w) * (1 - x / w);
  const rope: Pt[] = [];
  for (let i = 0; i <= 16; i++) rope.push([(i / 16) * w, ropeY((i / 16) * w)]);
  strokeLine(ctx, rope, 'rgba(255, 255, 255, 0.55)', Math.max(0.6, u));
  const n = 14;
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) * w) / n;
    const y = ropeY(x) + 2.5 * u;
    const color = pick(BULB_COLORS, i);
    withAlpha(ctx, 0.5 + 0.5 * Math.abs(Math.sin(t * 2 + i * 1.3)), () => {
      paintGlow(ctx, [x, y, 7 * u], color, 0.7);
      fillDisc(ctx, x, y, 2.2 * u, color);
    });
  }
}

/**
 * 舞い落ちる雪（白い粒・ときどききらめき）を描く。
 * @param ctx 描画先
 * @param area x・y・幅・高さ
 * @param t 経過秒
 * @param opts 個数・大きさ・種
 */
function paintSnowfall(ctx: CanvasRenderingContext2D, area: readonly [number, number, number, number], t: number, opts: { readonly count: number; readonly size: number; readonly seed: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [ax, ay, aw, ah] = area;
  for (let i = 0; i < opts.count; i++) {
    const speed = 0.08 + rand01(i, opts.seed + 1) * 0.08;
    const y = ay + wrap(rand01(i, opts.seed + 2) * ah + t * speed * ah, ah);
    const x = ax + aw * rand01(i, opts.seed) + Math.sin(t * 0.9 + i * 1.7) * opts.size * 4;
    const r = opts.size * (0.6 + rand01(i, opts.seed + 3) * 0.9);
    if (rand01(i, opts.seed + 4) > 0.86) paintSparkle(ctx, x, y, r * 2.4, '#ffffff');
    else withAlpha(ctx, 0.9, () => fillDisc(ctx, x, y, r, '#ffffff'));
  }
}

/**
 * 背景「雪のイルミネーション」：雪の夜の街・イルミネーションの木・電球の列・街灯・積もった雪・舞う雪。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgSnowlight(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.68;
  paintSky(ctx, [0, 0, w, hor], ['#2c3a86', '#93a3e6']);
  paintStarField(ctx, [0, 0, w, hor * 0.4], t, { count: 10, size: u, seed: 175 });
  paintSnowTown(ctx, { w, h }, hor, u);
  paintSky(ctx, [0, hor, w, h - hor], ['#f5f7ff', '#e2e8ff']);
  fillBox(ctx, [0, hor, w, Math.max(1, 2 * u)], '#ffffff');
  for (const [fx, r] of [[0.04, 26], [0.22, 15], [0.97, 22]] as const) {
    fillDisc(ctx, w * fx + r * 0.25 * u, h * 0.99 + 2 * u, r * u, '#e3e8ff');
    fillDisc(ctx, w * fx, h * 0.98, r * u, '#ffffff');
  }
  paintObject(ctx, 'lamp', w * 0.12, h * 0.92, 0.95 * u, t);
  paintLitTree(ctx, w * 0.84, h * 0.92, h * 0.62, { t, u });
  paintTwinkleString(ctx, { w, h }, t, u);
  paintSnowfall(ctx, [0, 0, w, h], t, { count: 40, size: 1.7 * u, seed: 177 });
}

/** トッピングのカラースプレーの色 */
const SPRINKLE_COLORS: readonly string[] = ['#ff5fa2', '#9adfff', '#ffe58a', '#a7f3d0', '#c9a2ff', '#ffffff'];

/**
 * カップケーキの丘（クリームの3段・たれ・さくらんぼ・カラースプレー）を描く。
 * @param ctx 描画先
 * @param c 丘の中心 X・地面の Y・半径
 * @param cream クリームの色
 */
function paintCupcakeHill(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], cream: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [cx, base, r] = c;
  const layers: readonly (readonly [number, number, number])[] = [[0, 1, 0], [0.35, 0.68, 0.18], [0.62, 0.4, 0.32]];
  for (const [dy, k, light] of layers) {
    ctx.fillStyle = mixColors(cream, '#ffffff', light);
    ctx.beginPath();
    ctx.arc(cx, base - r * dy, r * k, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  }
  for (let k = 0; k < 5; k++) fillBox(ctx, [cx - r * 0.8 + k * r * 0.36, base - r * 0.12, r * 0.14, r * (0.2 + (k % 2) * 0.12)], cream, r * 0.07);
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (1.1 + rand01(i, 191) * 0.8);
    const rr = r * (0.45 + rand01(i, 192) * 0.45);
    fillOval(ctx, [cx + Math.cos(a) * rr, base + Math.sin(a) * rr, r * 0.06, r * 0.022], pick(SPRINKLE_COLORS, i), a);
  }
  strokeLine(ctx, [[cx, base - r * 1.1], [cx + r * 0.08, base - r * 1.25]], '#7cbf6a', Math.max(0.6, r * 0.03));
  fillDisc(ctx, cx, base - r * 1.04, r * 0.12, '#ff5fa2');
  fillDisc(ctx, cx - r * 0.04, base - r * 1.08, r * 0.035, '#ffffff');
}

/**
 * ペロペロキャンディの木（白い棒・うずまき・つや・リボン）を描く。うずまきはゆっくり回る。
 * @param ctx 描画先
 * @param at 棒の根元 X・Y
 * @param height 高さ
 * @param opts 経過秒・本体と縞の色・細部の倍率
 */
function paintLollipop(ctx: CanvasRenderingContext2D, at: Pt, height: number, opts: { readonly t: number; readonly color: string; readonly stripe: string; readonly u: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, base] = at;
  const cy = base - height;
  const r = height * 0.28;
  fillBox(ctx, [x - 1.6 * opts.u, cy, 3.2 * opts.u, height], '#ffffff', 1.6 * opts.u);
  fillDisc(ctx, x, cy, r, opts.color);
  const pts: Pt[] = [];
  for (let i = 0; i <= 28; i++) {
    const a = opts.t * 0.5 + i * 0.45;
    pts.push([x + Math.cos(a) * r * (i / 28), cy + Math.sin(a) * r * (i / 28)]);
  }
  strokeLine(ctx, pts, opts.stripe, r * 0.16);
  fillOval(ctx, [x - r * 0.4, cy - r * 0.45, r * 0.28, r * 0.14], 'rgba(255, 255, 255, 0.75)', -0.6);
  fillPoly(ctx, [[x, cy + r * 1.1], [x - r * 0.4, cy + r * 0.9], [x - r * 0.4, cy + r * 1.3]], '#ff8cc6');
  fillPoly(ctx, [[x, cy + r * 1.1], [x + r * 0.4, cy + r * 0.9], [x + r * 0.4, cy + r * 1.3]], '#ff8cc6');
}

/**
 * 包み紙のキャンディ（両端のひねり・縞・つや）を描く。
 * @param ctx 描画先
 * @param c 中心 X・Y・大きさ
 * @param color 色
 * @param rot 回転
 */
function paintWrappedCandy(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], color: string, rot: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, s] = c;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const end = mixColors(color, '#ffffff', 0.35);
  fillPoly(ctx, [[-s * 0.9, 0], [-s * 1.6, -s * 0.55], [-s * 1.6, s * 0.55]], end);
  fillPoly(ctx, [[s * 0.9, 0], [s * 1.6, -s * 0.55], [s * 1.6, s * 0.55]], end);
  fillOval(ctx, [0, 0, s, s * 0.7], color);
  fillBox(ctx, [-s * 0.35, -s * 0.66, s * 0.22, s * 1.32], 'rgba(255, 255, 255, 0.55)');
  fillOval(ctx, [-s * 0.4, -s * 0.32, s * 0.3, s * 0.13], 'rgba(255, 255, 255, 0.85)', -0.4);
  ctx.restore();
}

/**
 * クッキーの飛び石（左手前から奥へ。中央の足元は通らない）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param hor 地面の線の Y
 * @param u 細部の倍率
 */
function paintCookiePath(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, hor: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  for (let i = 6; i >= 0; i--) {
    const p = i / 6;
    const x = w * (0.08 + 0.34 * p) + Math.sin(p * 3) * w * 0.04;
    const y = h * 0.95 - (h * 0.95 - hor - 6 * u) * p;
    const r = (13 - p * 8) * u;
    fillOval(ctx, [x, y + r * 0.12, r, r * 0.55], '#d39a5e');
    fillOval(ctx, [x, y, r, r * 0.52], '#efc184');
    for (let k = 0; k < 3; k++) {
      fillDisc(ctx, x + (rand01(i * 3 + k, 201) - 0.5) * r * 1.2, y + (rand01(i * 3 + k, 202) - 0.5) * r * 0.5, r * 0.12, '#8a5a3c');
    }
  }
}

/**
 * 地面に散らしたカラースプレー（中央の足元はあける）を描く。
 * @param ctx 描画先
 * @param area x・y・幅・高さ
 * @param opts 個数・大きさ・種
 */
function paintSprinkles(ctx: CanvasRenderingContext2D, area: readonly [number, number, number, number], opts: { readonly count: number; readonly size: number; readonly seed: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [ax, ay, aw, ah] = area;
  for (let i = 0; i < opts.count; i++) {
    const x = ax + aw * rand01(i, opts.seed);
    if (Math.abs(x - (ax + aw / 2)) < aw * 0.2) continue;
    const y = ay + ah * (0.1 + rand01(i, opts.seed + 1) * 0.85);
    fillOval(ctx, [x, y, opts.size, opts.size * 0.38], pick(SPRINKLE_COLORS, i), rand01(i, opts.seed + 2) * Math.PI);
  }
}

/**
 * 背景「おかしの国」：パステルの空・わたあめの雲・浮かぶキャンディ・カップケーキの丘・クリームの地面・クッキーの道・ペロペロキャンディの木。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgCandy(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.66;
  paintSky(ctx, [0, 0, w, hor], ['#ffe0f1', '#e0f4ff']);
  paintPuffyCloud(ctx, wrap(w * 0.1 + t * 3 * u, w + 80 * u) - 70 * u, h * 0.24, 0.9 * u);
  paintPuffyCloud(ctx, wrap(w * 0.66 + t * 2 * u, w + 80 * u) - 70 * u, h * 0.14, 0.7 * u);
  for (let i = 0; i < 3; i++) {
    const y = h * (0.12 + (i % 2) * 0.12) + Math.sin(t * 1.3 + i) * 3 * u;
    paintWrappedCandy(ctx, [w * (0.2 + i * 0.3), y, 5 * u], pick(BOKEH_COLORS, i), Math.sin(t * 0.8 + i) * 0.3);
  }
  paintCupcakeHill(ctx, [w * 0.22, hor, h * 0.2], '#ffb6d9');
  paintCupcakeHill(ctx, [w * 0.55, hor, h * 0.14], '#c4b5fd');
  paintCupcakeHill(ctx, [w * 0.86, hor, h * 0.23], '#a7f3d0');
  paintSky(ctx, [0, hor, w, h - hor], ['#ffd6ea', '#ffc4df']);
  const step = Math.max(4, 14 * u);
  for (let x = 0, i = 0; x < w + step; x += step, i++) {
    fillDisc(ctx, x, hor, step * 0.55, '#fff0f7');
    if (i % 3 === 0) fillBox(ctx, [x - step * 0.12, hor, step * 0.24, step * (0.6 + (i % 2) * 0.4)], '#fff0f7', step * 0.12);
  }
  paintCookiePath(ctx, { w, h }, hor, u);
  paintSprinkles(ctx, [0, hor, w, h - hor], { count: 30, size: 2.6 * u, seed: 205 });
  paintLollipop(ctx, [w * 0.7, hor + 6 * u], h * 0.22, { t, color: '#ffe58a', stripe: '#ff8cc6', u });
  paintLollipop(ctx, [w * 0.08, h * 0.98], h * 0.5, { t, color: '#ffb6d9', stripe: '#ffffff', u });
  paintLollipop(ctx, [w * 0.92, h * 0.96], h * 0.44, { t: t + 2, color: '#9adfff', stripe: '#fff5fb', u });
  paintFloatingCharms(ctx, [0, 0, w, hor * 0.8], t, { count: 6, size: 3.5 * u, seed: 209 });
}

/**
 * ビーチパラソル（ピンクと白の縞・波形のふち・金のつまみ）を描く。
 * @param ctx 描画先
 * @param at 柄の根元 X・Y
 * @param height 高さ
 * @param u 細部の倍率
 */
function paintParasol(ctx: CanvasRenderingContext2D, at: Pt, height: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, base] = at;
  const tx = x + height * 0.12;
  const ty = base - height * 0.72;
  const r = height * 0.42;
  strokeLine(ctx, [[x, base], [tx, ty - r * 0.9]], '#f4a6c8', 2.4 * u);
  for (let k = 0; k < 6; k++) {
    ctx.fillStyle = k % 2 === 0 ? '#ff8cc6' : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.arc(tx, ty, r, Math.PI + (k * Math.PI) / 6, Math.PI + ((k + 1) * Math.PI) / 6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(tx - r + (k + 0.5) * (r / 3), ty, r / 6, 0, Math.PI);
    ctx.fill();
  }
  fillPoly(ctx, [[tx - r * 0.5, ty - r * 0.6], [tx - r * 0.2, ty - r * 0.92], [tx - r * 0.1, ty - r * 0.85], [tx - r * 0.42, ty - r * 0.52]], 'rgba(255, 255, 255, 0.45)');
  fillDisc(ctx, tx, ty - r, 2.4 * u, '#ffe58a');
}

/**
 * ヤシの木（ふしのある幹・ゆれる葉・ココナッツ）を描く。
 * @param ctx 描画先
 * @param at 幹の根元 X・Y
 * @param height 高さ
 * @param opts 経過秒・細部の倍率
 */
function paintPalm(ctx: CanvasRenderingContext2D, at: Pt, height: number, opts: { readonly t: number; readonly u: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, base] = at;
  const { u } = opts;
  for (let k = 0; k < 8; k++) {
    const p = k / 8;
    fillOval(ctx, [x - Math.sin(p * 1.2) * height * 0.18, base - p * height, 5 * u * (1 - p * 0.3), 4.4 * u], k % 2 === 0 ? '#d7a97a' : '#c4935f');
  }
  const top: Pt = [x - Math.sin(1.2) * height * 0.18, base - height];
  const sway = Math.sin(opts.t * 1.1) * 0.06;
  const leaves = [-2.75, -2.2, -1.6, -0.95, -0.35, 0.2];
  leaves.forEach((a, i) => {
    const len = height * (0.36 + (i % 2) * 0.06);
    ctx.save();
    ctx.translate(top[0], top[1]);
    ctx.rotate(a + sway);
    fillPoly(ctx, [[0, 0], [len * 0.5, -len * 0.14], [len, len * 0.2], [len * 0.5, len * 0.05]], i % 2 === 0 ? '#5fd3a0' : '#7fe0b8');
    ctx.restore();
  });
  for (const dx of [-3, 2, 6]) fillDisc(ctx, top[0] + dx * u, top[1] + 4 * u, 3 * u, '#c79a7a');
}

/**
 * 砂浜の貝がら（扇の形・すじ）を描く。
 * @param ctx 描画先
 * @param c 中心 X・Y・大きさ
 * @param color 色
 */
function paintShell(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, s] = c;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.6);
  ctx.arc(x, y + s * 0.6, s * 1.2, Math.PI * 1.2, Math.PI * 1.8);
  ctx.closePath();
  ctx.fill();
  for (let k = 1; k < 5; k++) {
    const a = Math.PI * (1.2 + k * 0.12);
    strokeLine(ctx, [[x, y + s * 0.6], [x + Math.cos(a) * s * 1.1, y + s * 0.6 + Math.sin(a) * s * 1.1]], mixColors(color, '#8a4f7d', 0.25), s * 0.12);
  }
}

/**
 * 背景「夏の海」：明るい空と太陽・雲・ヨット・きらめく海・寄せる波・砂浜・パラソル・ヤシの木・貝とヒトデ・カモメ。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgBeach(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const seaTop = h * 0.42;
  const shore = h * 0.6;
  paintSky(ctx, [0, 0, w, seaTop], ['#7fd0ff', '#e8f8ff']);
  paintGlow(ctx, [w * 0.15, h * 0.12, h * 0.22], '#fff3b0', 0.65);
  fillDisc(ctx, w * 0.15, h * 0.12, h * 0.055, '#fff7c2');
  paintPuffyCloud(ctx, wrap(w * 0.45 + t * 3 * u, w + 80 * u) - 70 * u, h * 0.22, 0.8 * u);
  paintSky(ctx, [0, seaTop, w, shore - seaTop], ['#56c6f2', '#a6e9ff']);
  fillBox(ctx, [0, seaTop, w, Math.max(1, 1.5 * u)], 'rgba(255, 255, 255, 0.7)');
  const bx = wrap(w * 0.62 + t * 4 * u, w + 40 * u) - 20 * u;
  fillPoly(ctx, [[bx - 7 * u, seaTop + 3 * u], [bx + 7 * u, seaTop + 3 * u], [bx + 5 * u, seaTop + 6 * u], [bx - 5 * u, seaTop + 6 * u]], '#ffffff');
  fillPoly(ctx, [[bx, seaTop + 2 * u], [bx, seaTop - 12 * u], [bx + 7 * u, seaTop + 2 * u]], '#ffd6ec');
  for (let i = 0; i < 16; i++) {
    const sx = wrap(rand01(i, 221) * w + t * (4 + (i % 3) * 3) * u, w + 20 * u) - 10 * u;
    const sy = seaTop + (shore - seaTop) * (0.15 + rand01(i, 222) * 0.75);
    if (i % 2 === 0) fillBox(ctx, [sx, sy, (8 + rand01(i, 223) * 10) * u, Math.max(0.6, 1.4 * u)], 'rgba(255, 255, 255, 0.6)');
    else withAlpha(ctx, Math.abs(Math.sin(t * 2.5 + i)), () => paintSparkle(ctx, sx, sy, 3 * u, '#ffffff'));
  }
  paintSky(ctx, [0, shore, w, h - shore], ['#fff1c9', '#ffe0a3']);
  fillBox(ctx, [0, shore, w, h * 0.035], '#ffe7b8');
  const step = Math.max(3, 12 * u);
  for (let x = 0, i = 0; x < w + step; x += step, i++) fillDisc(ctx, x + Math.sin(t * 1.2 + i) * 2 * u, shore, step * 0.46, '#ffffff');
  paintParasol(ctx, [w * 0.12, h * 0.94], h * 0.5, u);
  paintPalm(ctx, [w * 0.9, h * 0.93], h * 0.62, { t, u });
  paintStar5(ctx, w * 0.27, h * 0.93, 6 * u, '#ff9eb5');
  fillDisc(ctx, w * 0.27, h * 0.93, 1.4 * u, '#ffd6ec');
  paintShell(ctx, [w * 0.75, h * 0.95, 5 * u], '#ffd6ec');
  paintShell(ctx, [w * 0.8, h * 0.88, 4 * u], '#d9c8ff');
  paintFlyingBirds(ctx, { w, h }, t, { color: '#8a4f7d', count: 3, u });
}

/**
 * おとぎのお城の塔（壁・窓・とんがり屋根・はためく旗）を描く。
 * @param ctx 描画先
 * @param b 塔の範囲
 * @param colors 壁・屋根・旗の色
 * @param opts 経過秒・細部の倍率
 */
function paintCastleTower(ctx: CanvasRenderingContext2D, b: ArtBox, colors: { readonly wall: string; readonly roof: string; readonly flag: string }, opts: { readonly t: number; readonly u: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { u } = opts;
  const top = b.base - b.h;
  fillBox(ctx, [b.x, top, b.w, b.h], colors.wall);
  fillBox(ctx, [b.x + b.w * 0.7, top, b.w * 0.3, b.h], mixColors(colors.wall, '#7a3b8f', 0.08));
  fillBox(ctx, [b.x + b.w * 0.33, top + b.h * 0.2, b.w * 0.34, b.h * 0.22], '#9adfff', b.w * 0.17);
  const tipX = b.x + b.w / 2;
  const tipY = top - b.w * 1.3;
  fillPoly(ctx, [[b.x - b.w * 0.15, top], [b.x + b.w * 1.15, top], [tipX, tipY]], colors.roof);
  fillPoly(ctx, [[tipX, tipY], [b.x + b.w * 1.15, top], [tipX, top]], mixColors(colors.roof, '#7a3b8f', 0.15));
  strokeLine(ctx, [[tipX, tipY], [tipX, tipY - 9 * u]], '#c9a2ff', Math.max(0.6, u));
  const wave = Math.sin(opts.t * 3 + b.x) * 1.5 * u;
  fillPoly(ctx, [[tipX, tipY - 9 * u], [tipX + 8 * u, tipY - 7 * u + wave], [tipX, tipY - 4.5 * u]], colors.flag);
}

/**
 * おとぎのお城（パステルの本丸・左右の塔・真ん中の高い塔・門・ハート）を描く。
 * @param ctx 描画先
 * @param cx 中心 X
 * @param base 足元の Y
 * @param opts 高さ・経過秒・細部の倍率
 */
function paintCastle(ctx: CanvasRenderingContext2D, cx: number, base: number, opts: { readonly height: number; readonly t: number; readonly u: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { height } = opts;
  const keepW = height * 0.42;
  const tw = height * 0.16;
  const side = { wall: '#efe6ff', roof: '#c9a2ff', flag: '#ffe58a' };
  paintCastleTower(ctx, { x: cx - keepW * 0.5 - tw * 0.7, base, w: tw, h: height * 0.55 }, side, opts);
  paintCastleTower(ctx, { x: cx + keepW * 0.5 - tw * 0.3, base, w: tw, h: height * 0.55 }, side, opts);
  const keepTop = base - height * 0.42;
  fillBox(ctx, [cx - keepW / 2, keepTop, keepW, height * 0.42], '#ffe3f1');
  for (let k = 0; k < 5; k++) fillBox(ctx, [cx - keepW / 2 + k * keepW * 0.22, keepTop - height * 0.04, keepW * 0.12, height * 0.045], '#ffe3f1');
  paintCastleTower(ctx, { x: cx - height * 0.1, base: keepTop + 1, w: height * 0.2, h: height * 0.3 }, { wall: '#fff0f7', roof: '#ff8cc6', flag: '#a7f3d0' }, opts);
  fillBox(ctx, [cx - keepW * 0.14, base - height * 0.2, keepW * 0.28, height * 0.2], '#f4a6c8', keepW * 0.14);
  fillBox(ctx, [cx - keepW * 0.36, keepTop + height * 0.08, keepW * 0.12, height * 0.09], '#9adfff', keepW * 0.06);
  fillBox(ctx, [cx + keepW * 0.24, keepTop + height * 0.08, keepW * 0.12, height * 0.09], '#9adfff', keepW * 0.06);
  fillHeart(ctx, [cx, base - height * 0.29, height * 0.035], '#ff8cc6');
}

/**
 * 背景「おとぎのお城」：パステルの空・虹・雲・丘の上のお城・きらめき・花の野原。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgCastle(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.7;
  paintSky(ctx, [0, 0, w, hor], ['#cde7ff', '#ffe6f3']);
  paintSoftRainbow(ctx, [w * 0.3, hor, Math.max(w, h) * 0.42], Math.max(1, 6 * u));
  paintPuffyCloud(ctx, wrap(w * 0.05 + t * 3 * u, w + 80 * u) - 70 * u, h * 0.2, 0.85 * u);
  paintPuffyCloud(ctx, wrap(w * 0.7 + t * 2 * u, w + 80 * u) - 70 * u, h * 0.12, 0.6 * u);
  ctx.fillStyle = '#d3f5e0';
  ctx.beginPath();
  ctx.moveTo(-w * 0.1, hor);
  ctx.quadraticCurveTo(w * 0.2, hor - h * 0.16, w * 0.5, hor);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#bfeccf';
  ctx.beginPath();
  ctx.moveTo(w * 0.3, hor);
  ctx.quadraticCurveTo(w * 0.72, hor - h * 0.3, w * 1.1, hor);
  ctx.closePath();
  ctx.fill();
  paintCastle(ctx, w * 0.72, hor - h * 0.13, { height: h * 0.42, t, u });
  for (let i = 0; i < 6; i++) {
    const a = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.8 + i * 1.7));
    withAlpha(ctx, a, () => paintSparkle(ctx, w * (0.56 + rand01(i, 231) * 0.36), h * (0.08 + rand01(i, 232) * 0.4), (2.5 + a * 2) * u, pick(GLITTER_COLORS, i)));
  }
  paintSky(ctx, [0, hor, w, h - hor], ['#ccf7df', '#b3eccb']);
  for (let i = 0; i < 18; i++) {
    const x = w * rand01(i, 233);
    if (Math.abs(x - w / 2) < w * 0.18) continue;
    fillDisc(ctx, x, hor + (h - hor) * (0.1 + rand01(i, 234) * 0.85), 2.2 * u, pick(['#ffb6d9', '#ffe58a', '#ffffff', '#c9a2ff'], i));
  }
  paintFloatingCharms(ctx, [0, 0, w * 0.5, hor * 0.7], t, { count: 5, size: 3.5 * u, seed: 239 });
}

/**
 * カフェの窓（空と雲・縞の日よけ・窓台の鉢植え）を描く。
 * @param ctx 描画先
 * @param r 窓の x・y・幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintCafeWindow(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number], t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, ww, wh] = r;
  fillBox(ctx, [x - 4 * u, y - 4 * u, ww + 8 * u, wh + 8 * u], '#ffffff', 4 * u);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, ww, wh);
  ctx.clip();
  paintSky(ctx, [x, y, ww, wh], ['#bfe8ff', '#fff0f7']);
  paintCloud(ctx, x + wrap(t * 5 * u + ww * 0.3, ww + 50 * u) - 30 * u, y + wh * 0.5, 26 * u);
  ctx.restore();
  fillBox(ctx, [x + ww / 2 - 1.5 * u, y, 3 * u, wh], '#ffffff');
  fillBox(ctx, [x, y + wh * 0.55, ww, 3 * u], '#ffffff');
  const n = 6;
  for (let k = 0; k < n; k++) {
    const color = k % 2 === 0 ? '#ff8cc6' : '#ffffff';
    fillBox(ctx, [x - 6 * u + (k * (ww + 12 * u)) / n, y - 12 * u, (ww + 12 * u) / n, 9 * u], color);
    fillDisc(ctx, x - 6 * u + ((k + 0.5) * (ww + 12 * u)) / n, y - 3 * u, (ww + 12 * u) / n / 2, color);
  }
  fillBox(ctx, [x - 6 * u, y + wh + 4 * u, ww + 12 * u, 4 * u], '#ffe3f0', u);
  for (const fx of [0.2, 0.7]) {
    fillBox(ctx, [x + ww * fx, y + wh - 4 * u, 8 * u, 8 * u], '#a7f3d0', 2 * u);
    fillDisc(ctx, x + ww * fx + 4 * u, y + wh - 7 * u, 4 * u, '#ffb6d9');
  }
}

/**
 * カフェの棚（カップ・ガラスのびん・ケーキスタンド）を描く。
 * @param ctx 描画先
 * @param r 棚の x・y・幅・高さ
 * @param u 細部の倍率
 */
function paintCafeShelf(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number], u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, sw, sh] = r;
  const boards = [y + sh * 0.45, y + sh];
  boards.forEach((by, row) => {
    for (let k = 0; k < 4; k++) {
      const cx = x + sw * (0.12 + k * 0.25);
      const color = pick(BOKEH_COLORS, k + row);
      if ((k + row) % 2 === 0) {
        fillBox(ctx, [cx - 5 * u, by - 8 * u, 10 * u, 8 * u], color, 2.5 * u);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(0.6, 1.6 * u);
        ctx.beginPath();
        ctx.arc(cx + 5.5 * u, by - 4 * u, 2.4 * u, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
      } else {
        fillBox(ctx, [cx - 4.5 * u, by - 13 * u, 9 * u, 13 * u], 'rgba(224, 244, 255, 0.9)', 2 * u);
        fillBox(ctx, [cx - 3.5 * u, by - 7 * u, 7 * u, 6 * u], color, u);
        fillBox(ctx, [cx - 5 * u, by - 15 * u, 10 * u, 3 * u], '#f4a6c8', u);
      }
    }
    fillBox(ctx, [x, by, sw, 4 * u], '#f4c9dd', u);
  });
}

/**
 * 吊り下げの照明（コード・パステルのかさ・灯り。ゆっくり揺れる）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintPendantLights(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  [0.26, 0.5, 0.74].forEach((fx, i) => {
    const len = h * (0.12 + (i % 2) * 0.04);
    ctx.save();
    ctx.translate(w * fx, 0);
    ctx.rotate(Math.sin(t * 0.9 + i * 1.4) * 0.04);
    strokeLine(ctx, [[0, 0], [0, len]], '#c9a2ff', Math.max(0.6, u));
    paintGlow(ctx, [0, len + 6 * u, 22 * u], '#ffe58a', 0.45);
    ctx.fillStyle = pick(['#ffb6d9', '#a7f3d0', '#c9a2ff'], i);
    ctx.beginPath();
    ctx.arc(0, len + 6 * u, 9 * u, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    fillDisc(ctx, 0, len + 7 * u, 3 * u, '#fff7d6');
    fillOval(ctx, [-4 * u, len + 2 * u, 2.4 * u, 1.2 * u], 'rgba(255, 255, 255, 0.7)', -0.5);
    ctx.restore();
  });
}

/**
 * 上に飾った三角の旗（ガーランド）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param u 細部の倍率
 */
function paintBunting(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  /**
   * ひもの高さ。
   * @param x 横の位置
   * @returns ひもの Y
   */
  const ropeY = (x: number): number => h * 0.03 + h * 0.05 * 4 * (x / w) * (1 - x / w);
  const rope: Pt[] = [];
  for (let i = 0; i <= 16; i++) rope.push([(i / 16) * w, ropeY((i / 16) * w)]);
  strokeLine(ctx, rope, '#f4a6c8', Math.max(0.6, u));
  const n = 11;
  for (let i = 0; i < n; i++) {
    const x0 = (i * w) / n + 2 * u;
    const x1 = ((i + 1) * w) / n - 2 * u;
    const xm = (x0 + x1) / 2;
    fillPoly(ctx, [[x0, ropeY(x0)], [x1, ropeY(x1)], [xm, ropeY(xm) + 12 * u]], pick(BOKEH_COLORS, i));
  }
}

/**
 * ケーキのショーケース（ミントの台・ガラスの棚・いちごのショートケーキ・つや）を描く。
 * @param ctx 描画先
 * @param at 左端の X・足元の Y
 * @param size 幅・高さ
 * @param u 細部の倍率
 */
function paintCakeCase(ctx: CanvasRenderingContext2D, at: Pt, size: { readonly w: number; readonly h: number }, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, base] = at;
  const { w: cw, h: ch } = size;
  fillBox(ctx, [x, base - ch * 0.45, cw, ch * 0.45], '#c9f2e3', 3 * u);
  for (let k = 1; k < 4; k++) fillBox(ctx, [x + (k * cw) / 4, base - ch * 0.4, Math.max(0.6, u), ch * 0.36], '#ffffff');
  fillBox(ctx, [x + cw * 0.05, base - ch, cw * 0.9, ch * 0.55], 'rgba(224, 244, 255, 0.9)', 4 * u);
  for (let k = 0; k < 3; k++) {
    const cx = x + cw * (0.22 + k * 0.28);
    const cy = base - ch * 0.5;
    const s = ch * 0.16;
    fillPoly(ctx, [[cx - s, cy], [cx + s, cy], [cx + s * 0.2, cy - s * 0.9], [cx - s * 0.2, cy - s * 0.9]], '#fff1c9');
    fillBox(ctx, [cx - s * 0.82, cy - s * 0.5, s * 1.64, s * 0.14], pick(['#ffb6d9', '#c9a2ff', '#a7f3d0'], k));
    fillBox(ctx, [cx - s * 0.3, cy - s * 1.02, s * 0.6, s * 0.16], '#ffffff', s * 0.08);
    fillDisc(ctx, cx, cy - s * 1.12, s * 0.2, '#ff5fa2');
  }
  fillBox(ctx, [x + cw * 0.05, base - ch * 0.47, cw * 0.9, 2 * u], '#ffffff');
  fillPoly(ctx, [[x + cw * 0.12, base - ch * 0.98], [x + cw * 0.24, base - ch * 0.98], [x + cw * 0.12, base - ch * 0.5], [x + cw * 0.06, base - ch * 0.5]], 'rgba(255, 255, 255, 0.55)');
  fillBox(ctx, [x + cw * 0.03, base - ch - 2 * u, cw * 0.94, 3 * u], '#f4a6c8', 1.5 * u);
}

/**
 * 背景「パステルカフェ」：ストライプの壁・腰板・窓と日よけ・棚・ガーランド・吊り照明・市松の床・ケーキのショーケース・鉢植え。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgCafe(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const wallBottom = h * 0.64;
  fillBox(ctx, [0, 0, w, wallBottom], '#fff0f6');
  const step = Math.max(4, 18 * u);
  for (let x = step / 2; x < w; x += step) fillBox(ctx, [x, 0, Math.max(1, 6 * u), wallBottom], '#ffe4ef');
  fillBox(ctx, [0, wallBottom - h * 0.12, w, h * 0.12], '#d3f3e6');
  fillBox(ctx, [0, wallBottom - h * 0.12, w, Math.max(1, 2.5 * u)], '#ffffff');
  for (let x = step; x < w; x += step * 2) fillBox(ctx, [x, wallBottom - h * 0.1, Math.max(0.6, u), h * 0.08], '#b9e9d6');
  paintCafeWindow(ctx, [w * 0.07, h * 0.16, w * 0.26, h * 0.28], t, u);
  paintCafeShelf(ctx, [w * 0.66, h * 0.14, w * 0.28, h * 0.32], u);
  paintBunting(ctx, { w, h }, u);
  paintPendantLights(ctx, { w, h }, t, u);
  const rows = 5;
  const cols = 9;
  for (let r = 0; r < rows; r++) {
    const y0 = wallBottom + (h - wallBottom) * Math.pow(r / rows, 1.2);
    const y1 = wallBottom + (h - wallBottom) * Math.pow((r + 1) / rows, 1.2);
    for (let c = 0; c < cols; c++) fillBox(ctx, [(c * w) / cols, y0, w / cols + 0.5, y1 - y0 + 0.5], (r + c) % 2 === 0 ? '#ffe3f0' : '#ffffff');
  }
  fillBox(ctx, [0, wallBottom, w, Math.max(1, 2.5 * u)], '#f4c9dd');
  paintCakeCase(ctx, [w * 0.02, h * 0.95], { w: w * 0.3, h: h * 0.32 }, u);
  paintObject(ctx, 'plant', w * 0.9, h * 0.95, 1.1 * u, t);
}

/**
 * 輪のある惑星（後ろの輪・本体と縞・つや・前の輪・まわる小さな月）を描く。
 * @param ctx 描画先
 * @param c 中心 X・Y・半径
 * @param colors 本体・縞・輪の色
 * @param t 経過秒
 */
function paintRingedPlanet(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], colors: { readonly body: string; readonly band: string; readonly ring: string }, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, r] = c;
  /**
   * 輪の半分を描く。
   * @param from 開始角
   * @param to 終了角
   */
  const ring = (from: number, to: number): void => { // audit-ignore: fnlog-missing 毎フレーム描画
    ctx.strokeStyle = colors.ring;
    ctx.lineWidth = Math.max(0.8, r * 0.2);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.75, r * 0.45, -0.3, from, to);
    ctx.stroke();
  };
  ring(Math.PI, Math.PI * 2);
  fillDisc(ctx, x, y, r, colors.body);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  fillBox(ctx, [x - r, y - r * 0.2, r * 2, r * 0.22], colors.band);
  fillBox(ctx, [x - r, y + r * 0.35, r * 2, r * 0.14], colors.band);
  fillDisc(ctx, x + r * 0.35, y + r * 0.35, r * 0.95, 'rgba(122, 59, 143, 0.16)');
  ctx.restore();
  fillOval(ctx, [x - r * 0.4, y - r * 0.45, r * 0.32, r * 0.16], 'rgba(255, 255, 255, 0.75)', -0.6);
  ring(0, Math.PI);
  const a = t * 0.6;
  fillDisc(ctx, x + Math.cos(a) * r * 2.3, y + Math.sin(a) * r * 0.8, r * 0.18, '#fff6d8');
}

/**
 * 背景「ゆめの銀河」：紫と青の星雲・天の川・たくさんの星・輪のある惑星と小さな惑星・流れ星・星くずの床。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgGalaxy(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.74;
  paintSky(ctx, [0, 0, w, hor], ['#140c3d', '#43309a']);
  const pulse = 0.04 * Math.sin(t * 0.7);
  paintGlow(ctx, [w * 0.22, h * 0.32, h * 0.38], '#ff8cc6', 0.36 + pulse);
  paintGlow(ctx, [w * 0.78, h * 0.26, h * 0.34], '#9adfff', 0.3 - pulse);
  paintGlow(ctx, [w * 0.5, h * 0.1, h * 0.3], '#c9a2ff', 0.38);
  withAlpha(ctx, 0.14, () => fillPoly(ctx, [[0, h * 0.56], [w * 0.2, h * 0.62], [w, h * 0.1], [w * 0.8, 0]], '#e9ddff'));
  paintStarField(ctx, [0, 0, w, hor], t, { count: 60, size: u, seed: 241 });
  paintRingedPlanet(ctx, [w * 0.8, h * 0.2, h * 0.075], { body: '#ffb6d9', band: '#ff8cc6', ring: '#d9c8ff' }, t);
  fillDisc(ctx, w * 0.14, h * 0.16, h * 0.042, '#9adfff');
  fillDisc(ctx, w * 0.13, h * 0.15, h * 0.01, '#7cc6ec');
  fillDisc(ctx, w * 0.155, h * 0.175, h * 0.007, '#7cc6ec');
  fillOval(ctx, [w * 0.125, h * 0.145, h * 0.012, h * 0.006], 'rgba(255, 255, 255, 0.8)', -0.6);
  fillDisc(ctx, w * 0.32, h * 0.5, h * 0.022, '#a7f3d0');
  paintShootingStarAt(ctx, [w * 0.1, h * 0.06], t, { phase: 0.5, period: 5, dist: w * 0.5, u });
  paintShootingStarAt(ctx, [w * 0.5, h * 0.02], t, { phase: 3.2, period: 7, dist: w * 0.4, u });
  paintSky(ctx, [0, hor, w, h - hor], ['#4a37a8', '#291c6a']);
  withAlpha(ctx, 0.7, () => fillBox(ctx, [0, hor, w, Math.max(1, 2 * u)], '#c9a2ff'));
  for (let i = 0; i < 22; i++) {
    const x = w * rand01(i, 251);
    if (Math.abs(x - w / 2) < w * 0.18) continue;
    withAlpha(ctx, 0.3 + 0.7 * Math.abs(Math.sin(t * 2 + i)), () => paintSparkle(ctx, x, hor + (h - hor) * (0.15 + rand01(i, 252) * 0.8), (1.4 + rand01(i, 253) * 2) * u, pick(GLITTER_COLORS, i)));
  }
}

// ---------------------------------------------------------------------------
// 背景（土地・季節: 今昔館の江戸の町・中崎町のレトロ路地・天神祭の夜・紅葉の公園）
// ---------------------------------------------------------------------------

/**
 * 今昔館の天井に描かれた「空」（夕方の空・平たい雲・天井の梁・ゆっくり変わる明るさ）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintPaintedCeiling(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  const bottom = h * 0.4;
  paintSky(ctx, [0, 0, w, bottom], ['#ffd9c2', '#efe1ff']);
  const bands: readonly (readonly [number, number, number])[] = [[0.06, 0.13, 0.34], [0.52, 0.08, 0.3], [0.3, 0.24, 0.26], [0.76, 0.2, 0.22]];
  for (const [fx, fy, fw] of bands) {
    const bh = Math.max(2, 7 * u);
    fillBox(ctx, [w * fx, h * fy, w * fw, bh], '#fff6ee', bh / 2);
    fillBox(ctx, [w * fx + w * fw * 0.2, h * fy - bh * 0.7, w * fw * 0.45, bh], '#fff6ee', bh / 2);
  }
  withAlpha(ctx, 0.1 + 0.06 * Math.sin(t * 0.4), () => fillBox(ctx, [0, 0, w, bottom], '#ffe58a'));
  fillBox(ctx, [0, 0, w, Math.max(1.5, 4 * u)], '#c49a78');
  for (let x = 0; x < w; x += Math.max(8, 60 * u)) fillBox(ctx, [x, 0, Math.max(1, 3 * u), Math.max(2, 9 * u)], '#c49a78');
}

/**
 * 火の見櫓（淡い藤色のシルエット・はしごの段・すじかい・屋根と半鐘）を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param base 足元の Y
 * @param height 高さ
 * @param u 細部の倍率
 */
function paintWatchtower(ctx: CanvasRenderingContext2D, x: number, base: number, height: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const c = '#b9a9dc';
  const top = base - height;
  const half = height * 0.12;
  /**
   * k 段目の高さと半幅。
   * @param k 段（0=足元）
   * @returns Y と半幅
   */
  const rung = (k: number): readonly [number, number] => [base - (height * 0.85 * k) / 5, half - (half * 0.55 * k) / 5]; // audit-ignore: fnlog-missing 毎フレーム描画
  strokeLine(ctx, [[x - half, base], [x - half * 0.45, top + height * 0.12]], c, 2.4 * u);
  strokeLine(ctx, [[x + half, base], [x + half * 0.45, top + height * 0.12]], c, 2.4 * u);
  for (let k = 0; k < 5; k++) {
    const [y0, hw0] = rung(k);
    const [y1, hw1] = rung(k + 1);
    strokeLine(ctx, [[x - hw1, y1], [x + hw1, y1]], c, 1.4 * u);
    strokeLine(ctx, [[x - hw0, y0], [x + hw1, y1]], c, 0.9 * u);
  }
  fillBox(ctx, [x - half * 0.7, top + height * 0.1, half * 1.4, height * 0.05], c);
  fillPoly(ctx, [[x - half * 0.75, top + height * 0.1], [x + half * 0.75, top + height * 0.1], [x, top]], c);
  fillDisc(ctx, x, top + height * 0.075, height * 0.025, '#ffe58a');
}

/** 江戸の町家ののれんの色 */
const MACHIYA_NOREN: readonly string[] = ['#8aa0e6', '#ff9ccc', '#7fd6b4', '#c9a2ff'];

/**
 * 江戸の町家の建物（瓦屋根・2階の虫籠窓・ひさし・1階の格子と店の入口）を描く。
 * @param ctx 描画先
 * @param b 範囲
 * @param u 細部の倍率
 */
function paintMachiya(ctx: CanvasRenderingContext2D, b: ArtBox, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const top = b.base - b.h;
  const midY = top + b.h * 0.42;
  fillBox(ctx, [b.x, top + b.h * 0.08, b.w, midY - top - b.h * 0.08], '#fff3e6');
  fillBox(ctx, [b.x + b.w * 0.2, top + b.h * 0.16, b.w * 0.6, b.h * 0.14], '#e8d2b8', u);
  for (let k = 0; k < 7; k++) fillBox(ctx, [b.x + b.w * (0.22 + k * 0.08), top + b.h * 0.16, Math.max(0.8, b.w * 0.035), b.h * 0.14], '#b98a62');
  fillBox(ctx, [b.x - 2 * u, top, b.w + 4 * u, b.h * 0.09], '#857fa8', u);
  for (let x = b.x; x < b.x + b.w; x += Math.max(3, 8 * u)) fillBox(ctx, [x, top + b.h * 0.02, Math.max(0.6, u), b.h * 0.06], '#a49fc7');
  fillPoly(ctx, [[b.x - 4 * u, midY], [b.x + b.w + 4 * u, midY], [b.x + b.w + u, midY - b.h * 0.06], [b.x - u, midY - b.h * 0.06]], '#857fa8');
  fillBox(ctx, [b.x - 3 * u, midY - b.h * 0.06, b.w + 6 * u, Math.max(0.6, 1.2 * u)], '#a49fc7');
  fillBox(ctx, [b.x, midY, b.w, b.base - midY], '#e3b88c');
  fillBox(ctx, [b.x + b.w * 0.04, midY + b.h * 0.06, b.w * 0.5, b.base - midY - b.h * 0.08], '#f6dfc2');
  for (let x = b.x + b.w * 0.05; x < b.x + b.w * 0.54; x += Math.max(2, 4.5 * u)) fillBox(ctx, [x, midY + b.h * 0.06, Math.max(0.6, 1.4 * u), b.base - midY - b.h * 0.08], '#b07d55');
  fillBox(ctx, [b.x + b.w * 0.6, midY + b.h * 0.04, b.w * 0.34, b.base - midY - b.h * 0.04], '#ffe2b0');
  fillBox(ctx, [b.x, midY, Math.max(1, 2.5 * u), b.base - midY], '#b07d55');
  fillBox(ctx, [b.x + b.w - Math.max(1, 2.5 * u), midY, Math.max(1, 2.5 * u), b.base - midY], '#b07d55');
}

/**
 * 町家の店先（入口の灯り・ゆれるのれん・吊り看板）を描く。
 * @param ctx 描画先
 * @param b 範囲（paintMachiya と同じ）
 * @param opts 模様の種・のれんの色・経過秒・細部の倍率
 */
function paintMachiyaShop(ctx: CanvasRenderingContext2D, b: ArtBox, opts: { readonly seed: number; readonly color: string; readonly t: number; readonly u: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { u, t } = opts;
  const midY = b.base - b.h + b.h * 0.42;
  const nx = b.x + b.w * 0.6;
  const nw = b.w * 0.34;
  paintGlow(ctx, [nx + nw / 2, midY + b.h * 0.3, b.w * 0.4], '#ffe58a', 0.4 + 0.06 * Math.sin(t * 2.4 + opts.seed));
  for (let k = 0; k < 3; k++) {
    const sway = Math.sin(t * 1.4 + k + opts.seed) * 1.2 * u;
    const x0 = nx + (k * nw) / 3 + 0.5 * u;
    const x1 = nx + ((k + 1) * nw) / 3 - 0.5 * u;
    fillPoly(ctx, [[x0, midY + u], [x1, midY + u], [x1 + sway, midY + b.h * 0.24], [x0 + sway, midY + b.h * 0.24]], opts.color);
  }
  fillDisc(ctx, nx + nw / 2, midY + b.h * 0.12, Math.max(0.8, b.w * 0.04), '#ffffff');
  ctx.save();
  ctx.translate(b.x + b.w * 0.28, midY + 2 * u);
  ctx.rotate(Math.sin(t * 1.1 + opts.seed) * 0.06);
  strokeLine(ctx, [[-b.w * 0.08, 0], [-b.w * 0.08, b.h * 0.03]], '#8a6a52', Math.max(0.5, 0.8 * u));
  strokeLine(ctx, [[b.w * 0.08, 0], [b.w * 0.08, b.h * 0.03]], '#8a6a52', Math.max(0.5, 0.8 * u));
  fillBox(ctx, [-b.w * 0.14, b.h * 0.03, b.w * 0.28, b.h * 0.1], '#f5e2c4', u);
  fillBox(ctx, [-b.w * 0.1, b.h * 0.055, b.w * 0.2, Math.max(0.6, 1.2 * u)], '#a77f68');
  fillBox(ctx, [-b.w * 0.07, b.h * 0.09, b.w * 0.14, Math.max(0.6, 1.2 * u)], '#a77f68');
  ctx.restore();
}

/**
 * 背景「今昔館の江戸の町」：天井に描かれた空・火の見櫓・瓦屋根の町家の並び・のれん・吊り看板・店先の灯り・土の道・ぼんぼり。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgEdo(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.66;
  paintPaintedCeiling(ctx, { w, h }, t, u);
  paintWatchtower(ctx, w * 0.64, hor - h * 0.2, h * 0.42, u);
  const n = 4;
  const hw = w / n;
  for (let i = 0; i < n; i++) {
    const b: ArtBox = { x: i * hw + hw * 0.03, base: hor, w: hw * 0.94, h: h * (0.44 + (i % 2) * 0.04) };
    paintMachiya(ctx, b, u);
    paintMachiyaShop(ctx, b, { seed: i, color: pick(MACHIYA_NOREN, i), t, u });
  }
  paintSky(ctx, [0, hor, w, h - hor], ['#f4e2c8', '#ead2b0']);
  fillBox(ctx, [0, hor, w, h * 0.025], '#d9c2a2');
  for (let x = 0, i = 0; x < w; x += Math.max(4, 16 * u), i++) fillBox(ctx, [x, hor + h * 0.006, Math.max(2, 12 * u), h * 0.013], i % 2 === 0 ? '#cdb594' : '#c4aa86', u);
  paintBonbori(ctx, w * 0.08, h * 0.95, { u, t });
  paintBonbori(ctx, w * 0.92, h * 0.95, { u, t });
}

/** 中崎町の路地の左右の壁の色 */
const ALLEY_WALLS: readonly { readonly wall: string; readonly plank: string; readonly awning: string }[] = [
  { wall: '#f6dcc4', plank: '#e2bd9c', awning: '#ff9ccc' },
  { wall: '#e9e0f7', plank: '#cfc2ea', awning: '#7fd6b4' },
];

/**
 * 路地の壁の上の点（遠近。奥の端は画面の中央寄りに縮む）。
 * @param size 幅・高さ
 * @param side 左なら -1、右なら 1
 * @param s 奥行き（0=手前の端、1=奥の端）
 * @param v 壁の上端 0〜下端 1
 * @returns 点
 */
function alleyPt(size: { readonly w: number; readonly h: number }, side: -1 | 1, s: number, v: number): Pt { // audit-ignore: fnlog-missing 毎フレーム描画
  const x = size.w * 0.36 * s;
  const top = size.h * (0.06 + 0.3 * s);
  const bottom = size.h * (0.94 - 0.28 * s);
  return [side < 0 ? x : size.w - x, top + (bottom - top) * v];
}

/**
 * 路地の壁の上の四角（奥行き s0〜s1、高さ v0〜v1）を塗る。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param side 左なら -1、右なら 1
 * @param r s0・s1・v0・v1
 * @param fill 塗り色
 */
function fillAlleyQuad(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, side: -1 | 1, r: readonly [number, number, number, number], fill: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [s0, s1, v0, v1] = r;
  fillPoly(ctx, [alleyPt(size, side, s0, v0), alleyPt(size, side, s1, v0), alleyPt(size, side, s1, v1), alleyPt(size, side, s0, v1)], fill);
}

/**
 * 路地の片側の古い木の家（板張り・ひさし・灯りの窓・カフェのドア・日よけ・鉢植え）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param side 左なら -1、右なら 1
 * @param u 細部の倍率
 */
function paintAlleyWall(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, side: -1 | 1, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const colors = ALLEY_WALLS[side < 0 ? 0 : 1] ?? { wall: '#f6dcc4', plank: '#e2bd9c', awning: '#ff9ccc' };
  fillAlleyQuad(ctx, size, side, [0, 1, 0, 1], colors.wall);
  for (let k = 1; k < 9; k++) strokeLine(ctx, [alleyPt(size, side, 0, k / 9), alleyPt(size, side, 1, k / 9)], colors.plank, Math.max(0.5, u));
  fillAlleyQuad(ctx, size, side, [0, 1, -0.07, 0.02], '#9b7d8e');
  fillAlleyQuad(ctx, size, side, [0.18, 0.42, 0.2, 0.46], '#ffffff');
  fillAlleyQuad(ctx, size, side, [0.2, 0.4, 0.23, 0.43], '#ffe9b8');
  fillAlleyQuad(ctx, size, side, [0.55, 0.75, 0.45, 1], '#b48a6e');
  fillAlleyQuad(ctx, size, side, [0.58, 0.72, 0.5, 0.72], '#ffe9b8');
  for (let k = 0; k < 6; k++) fillAlleyQuad(ctx, size, side, [0.08 + k * 0.07, 0.15 + k * 0.07, 0.5, 0.58], k % 2 === 0 ? colors.awning : '#ffffff');
  for (const s of [0.05, 0.3, 0.5, 0.82]) {
    const [px, py] = alleyPt(size, side, s, 1);
    const ps = (14 - s * 9) * u;
    const cx = px + side * -ps * 0.6;
    fillPoly(ctx, [[cx - ps * 0.5, py - ps * 0.7], [cx + ps * 0.5, py - ps * 0.7], [cx + ps * 0.38, py], [cx - ps * 0.38, py]], '#e58357');
    fillDisc(ctx, cx - ps * 0.2, py - ps * 0.95, ps * 0.42, '#5fd3a0');
    fillDisc(ctx, cx + ps * 0.22, py - ps * 1.05, ps * 0.38, '#7fe0b8');
    fillDisc(ctx, cx, py - ps * 1.3, ps * 0.16, pick(['#ff8cc6', '#ffe58a', '#ffffff', '#c9a2ff'], Math.round(s * 10)));
  }
}

/**
 * 路地の奥の家（板壁・屋根・灯りの窓）と、路地の石畳を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param u 細部の倍率
 */
function paintAlleyEndAndFloor(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { w, h } = size;
  fillBox(ctx, [w * 0.36, h * 0.38, w * 0.28, h * 0.28], '#fbe9dc');
  fillBox(ctx, [w * 0.34, h * 0.35, w * 0.32, h * 0.04], '#9b7d8e', u);
  fillBox(ctx, [w * 0.42, h * 0.43, w * 0.07, h * 0.08], '#ffe9b8', u);
  fillBox(ctx, [w * 0.53, h * 0.46, w * 0.07, h * 0.2], '#b48a6e', u);
  fillBox(ctx, [w * 0.41, h * 0.52, w * 0.09, h * 0.02], '#ff9ccc', u);
  fillPoly(ctx, [[w * 0.36, h * 0.66], [w * 0.64, h * 0.66], [w, h * 0.94], [w, h], [0, h], [0, h * 0.94]], '#efe2d0');
  for (let k = 0; k <= 6; k++) strokeLine(ctx, [[w * (0.36 + (0.28 * k) / 6), h * 0.66], [w * (-0.3 + (1.6 * k) / 6), h]], '#ded0bb', Math.max(0.5, u));
  for (let i = 1; i <= 4; i++) {
    const p = Math.pow(i / 5, 1.3);
    const y = h * 0.66 + h * 0.34 * p;
    const half = w * (0.14 + 0.5 * p);
    fillBox(ctx, [w / 2 - half, y, half * 2, Math.max(0.5, u)], '#ded0bb');
  }
}

/**
 * 路地に渡した電球の列（奥行きの違う3本・またたく）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintAlleyLights(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (const d of [0.85, 0.5, 0.2]) {
    const [xl, yl] = alleyPt(size, -1, d, 0.06);
    const [xr, yr] = alleyPt(size, 1, d, 0.06);
    const sag = size.h * (0.03 + (1 - d) * 0.05);
    const pts: Pt[] = [];
    for (let i = 0; i <= 12; i++) {
      const p = i / 12;
      pts.push([xl + (xr - xl) * p, yl + (yr - yl) * p + sag * 4 * p * (1 - p)]);
    }
    strokeLine(ctx, pts, 'rgba(155, 125, 142, 0.7)', Math.max(0.5, 0.8 * u));
    pts.forEach(([x, y], i) => {
      if (i === 0 || i === pts.length - 1) return;
      const color = pick(BULB_COLORS, i + Math.round(d * 10));
      withAlpha(ctx, 0.5 + 0.5 * Math.abs(Math.sin(t * 2 + i * 1.3 + d * 5)), () => {
        paintGlow(ctx, [x, y + 2 * u, (7 - d * 3) * u], color, 0.7);
        fillDisc(ctx, x, y + 2 * u, (2.4 - d) * u, color);
      });
    });
  }
}

/**
 * 路地の小物（突き出したレトロな看板・丸いホーロー看板・屋根の上のねこ）を描く。
 * @param ctx 描画先
 * @param size 幅・高さ
 * @param t 経過秒
 * @param u 細部の倍率
 */
function paintAlleyProps(ctx: CanvasRenderingContext2D, size: { readonly w: number; readonly h: number }, t: number, u: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [sx, sy] = alleyPt(size, -1, 0.3, 0.12);
  strokeLine(ctx, [[sx, sy + 3 * u], [sx + 6 * u, sy + 3 * u]], '#9b7d8e', 1.2 * u);
  fillBox(ctx, [sx + 5 * u, sy, 11 * u, 28 * u], '#ff8cc6', 2 * u);
  fillBox(ctx, [sx + 6.5 * u, sy + 1.5 * u, 8 * u, 25 * u], '#fff5fb', 1.5 * u);
  for (let k = 0; k < 3; k++) fillDisc(ctx, sx + 10.5 * u, sy + (6 + k * 7) * u, 2.4 * u, pick(['#ff8cc6', '#9adfff', '#ffe58a'], k));
  const [ex, ey] = alleyPt(size, 1, 0.38, 0.3);
  fillDisc(ctx, ex - 8 * u, ey, 7 * u, '#9adfff');
  fillDisc(ctx, ex - 8 * u, ey, 5 * u, '#ffffff');
  fillDisc(ctx, ex - 8 * u, ey, 3.2 * u, '#ffe58a');
  const [cx, cy] = alleyPt(size, 1, 0.55, -0.07);
  const tail = Math.sin(t * 1.6) * 3 * u;
  strokeLine(ctx, [[cx + 4 * u, cy - 2 * u], [cx + 9 * u, cy - 4 * u], [cx + 10 * u + tail, cy - 10 * u]], '#f2c9a8', 1.8 * u);
  fillOval(ctx, [cx, cy - 4 * u, 6 * u, 4.5 * u], '#fff3e6');
  fillDisc(ctx, cx - 5 * u, cy - 9 * u, 3.6 * u, '#fff3e6');
  fillPoly(ctx, [[cx - 8 * u, cy - 10 * u], [cx - 7.5 * u, cy - 14 * u], [cx - 5 * u, cy - 11.5 * u]], '#fff3e6');
  fillPoly(ctx, [[cx - 4.5 * u, cy - 11.5 * u], [cx - 2.5 * u, cy - 14 * u], [cx - 2 * u, cy - 10 * u]], '#fff3e6');
  fillOval(ctx, [cx + 2 * u, cy - 5 * u, 2.6 * u, 2 * u], '#f2c9a8');
}

/**
 * 背景「中崎町のレトロ路地」：午後の金色の光・奥の家・石畳・古い木の家のカフェ・鉢植え・電球の列・レトロな看板・屋根のねこ。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgNakazaki(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  paintSky(ctx, [0, 0, w, h * 0.5], ['#ffd8b0', '#fff0de']);
  paintGlow(ctx, [w * 0.5, h * 0.16, h * 0.28], '#fff3c4', 0.7);
  paintAlleyEndAndFloor(ctx, { w, h }, u);
  paintAlleyWall(ctx, { w, h }, -1, u);
  paintAlleyWall(ctx, { w, h }, 1, u);
  paintAlleyProps(ctx, { w, h }, t, u);
  paintAlleyLights(ctx, { w, h }, t, u);
  withAlpha(ctx, 0.16 + 0.04 * Math.sin(t * 0.6), () => {
    fillPoly(ctx, [[w * 0.12, 0], [w * 0.26, 0], [w * 0.5, h * 0.6], [w * 0.38, h * 0.6]], '#fff1c2');
    fillPoly(ctx, [[w * 0.34, 0], [w * 0.4, 0], [w * 0.58, h * 0.5], [w * 0.52, h * 0.5]], '#fff1c2');
  });
}

/**
 * 天神祭の船（紫の船体・金の縁・屋形・提灯の列・川面に映る灯り。波でゆれる）を描く。
 * @param ctx 描画先
 * @param at 船の中心 X・水面の Y
 * @param s 大きさ（1 で幅約 70px）
 * @param opts 経過秒・模様の種
 */
function paintFestivalBoat(ctx: CanvasRenderingContext2D, at: Pt, s: number, opts: { readonly t: number; readonly seed: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { t, seed } = opts;
  const x = at[0];
  const y = at[1] + Math.sin(t * 1.2 + seed) * 1.5 * s;
  for (let k = 0; k < 6; k++) {
    const len = (8 + Math.abs(Math.sin(t * 2 + k + seed)) * 10) * s;
    withAlpha(ctx, 0.35, () => fillBox(ctx, [x - 26 * s + k * 10.4 * s - 1.2 * s, y + 4 * s, 2.4 * s, len], k % 2 === 0 ? '#ffb070' : '#ffe58a'));
  }
  fillPoly(ctx, [[x - 34 * s, y - 6 * s], [x + 34 * s, y - 6 * s], [x + 28 * s, y + 4 * s], [x - 30 * s, y + 4 * s]], '#7e6bc4');
  fillBox(ctx, [x - 33 * s, y - 7 * s, 66 * s, 2 * s], '#ffd86b');
  fillBox(ctx, [x - 16 * s, y - 20 * s, 32 * s, 14 * s], '#ffe3f1', 2 * s);
  fillBox(ctx, [x - 12 * s, y - 17 * s, 24 * s, 6 * s], '#ffe58a', s);
  fillPoly(ctx, [[x - 20 * s, y - 20 * s], [x + 20 * s, y - 20 * s], [x + 14 * s, y - 27 * s], [x - 14 * s, y - 27 * s]], '#ff8cc6');
  strokeLine(ctx, [[x - 27 * s, y - 6 * s], [x - 27 * s, y - 36 * s]], '#c9a2ff', 1.2 * s);
  strokeLine(ctx, [[x + 27 * s, y - 6 * s], [x + 27 * s, y - 36 * s]], '#c9a2ff', 1.2 * s);
  for (let k = 0; k < 7; k++) {
    const p = k / 6;
    const lx = x - 27 * s + 54 * s * p;
    const ly = y - 34 * s + 6 * s * 4 * p * (1 - p);
    const color = k % 2 === 0 ? '#ff7a6b' : '#ffe58a';
    paintGlow(ctx, [lx, ly + 3 * s, 7 * s], color, 0.55);
    fillOval(ctx, [lx, ly + 3 * s, 2.4 * s, 3.2 * s], color);
  }
  fillPoly(ctx, [[x - 27 * s, y - 36 * s], [x - 19 * s, y - 34 * s], [x - 27 * s, y - 32 * s]], '#a7f3d0');
  fillPoly(ctx, [[x + 27 * s, y - 36 * s], [x + 35 * s, y - 34 * s], [x + 27 * s, y - 32 * s]], '#9adfff');
}

/**
 * 背景「天神祭の夜」：夜空と星・打ち上げ花火・向こう岸の街と橋・花火の映る大川・提灯をともした船渡御の船・川岸の遊歩道とぼんぼり。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgTenjinMatsuri(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const bank = h * 0.5;
  const shore = h * 0.76;
  paintSky(ctx, [0, 0, w, bank], ['#1d1b55', '#5b3f95']);
  paintStarField(ctx, [0, 0, w, bank * 0.5], t, { count: 12, size: u, seed: 261 });
  const bursts: readonly (readonly [number, number, number, string, number])[] = [[0.22, 0.2, 0.55, '#ff8cc6', 1], [0.72, 0.15, 0.15, '#ffe58a', 1], [0.5, 0.3, 0.8, '#9adfff', 0.8], [0.88, 0.32, 0.35, '#a7f3d0', 0.7]];
  for (const [fx, fy, offset, color, k] of bursts) paintSkyBurst(ctx, [w * fx, h * fy], t, { offset, color, u: u * k });
  paintFarSkyline(ctx, { from: 0, to: w }, { base: bank, offset: 0, color: '#2e2a6b', minH: h * 0.06, maxH: h * 0.2, seed: 263, unit: Math.max(6, 20 * u) });
  for (let i = 0; i < 20; i++) fillBox(ctx, [w * rand01(i, 264), bank - h * (0.015 + rand01(i, 265) * 0.035), Math.max(0.8, 2 * u), Math.max(0.8, 2 * u)], 'rgba(255, 229, 138, 0.85)');
  fillBox(ctx, [0, bank - h * 0.04, w * 0.42, Math.max(1, 2.5 * u)], '#4b4594');
  ctx.strokeStyle = '#4b4594';
  ctx.lineWidth = Math.max(0.8, 2 * u);
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.arc(w * (0.07 + k * 0.14), bank, w * 0.065, Math.PI, 0);
    ctx.stroke();
  }
  paintSky(ctx, [0, bank, w, shore - bank], ['#2b3484', '#1c2160']);
  for (const [fx, , , color] of bursts) paintGlow(ctx, [w * fx, bank + h * 0.07, h * 0.12], color, 0.16);
  for (let i = 0; i < 14; i++) {
    const sx = wrap(rand01(i, 266) * w + t * (5 + (i % 3) * 3) * u, w + 20 * u) - 10 * u;
    fillBox(ctx, [sx, bank + (shore - bank) * (0.1 + rand01(i, 267) * 0.85), (8 + rand01(i, 268) * 12) * u, Math.max(0.6, 1.3 * u)], 'rgba(255, 214, 236, 0.45)');
  }
  for (let i = 0; i < 3; i++) {
    const x = wrap(w * (0.15 + i * 0.4) + t * (5 + i * 2) * u, w + 140 * u) - 70 * u;
    paintFestivalBoat(ctx, [x, bank + (shore - bank) * (0.36 + (i % 2) * 0.32)], u * (0.72 + (i % 2) * 0.22), { t, seed: i * 1.7 });
  }
  paintSky(ctx, [0, shore, w, h - shore], ['#4a3f7a', '#362d66']);
  fillBox(ctx, [0, shore - 8 * u, w, Math.max(1, 1.8 * u)], '#6f62a8');
  for (let x = 4 * u; x < w; x += Math.max(5, 26 * u)) fillBox(ctx, [x, shore - 8 * u, Math.max(1, 1.8 * u), 8 * u], '#6f62a8');
  paintBonbori(ctx, w * 0.08, h * 0.97, { u, t });
  paintBonbori(ctx, w * 0.92, h * 0.97, { u, t });
}

/** 紅葉の色（赤・橙・黄・薄紅。パステル寄り） */
const MAPLE_COLORS: readonly string[] = ['#ff7a6b', '#ffa45c', '#ffd36b', '#ff9b85'];

/**
 * もみじの葉（5つにとがった葉と軸）を描く。
 * @param ctx 描画先
 * @param c 中心 X・Y・大きさ
 * @param rot 回転
 * @param color 色
 */
function paintMapleLeaf(ctx: CanvasRenderingContext2D, c: readonly [number, number, number], rot: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, s] = c;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  paintStar5(ctx, 0, 0, s, color);
  strokeLine(ctx, [[0, s * 0.2], [0, s * 1.05]], mixColors(color, '#7a3b2e', 0.3), Math.max(0.4, s * 0.14));
  ctx.restore();
}

/**
 * 背景「紅葉の公園」：やわらかな金色の空と太陽・遠くの丘・紅葉の並木・芝生と両脇の小道・落ち葉・舞い落ちるもみじ。
 * @param ctx 描画先
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒
 */
function bgMomiji(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const u = unitOf(w, h);
  const hor = h * 0.66;
  paintSky(ctx, [0, 0, w, hor], ['#ffd6a8', '#fff3dc']);
  paintGlow(ctx, [w * 0.8, h * 0.12, h * 0.24], '#fff1b8', 0.55);
  fillDisc(ctx, w * 0.8, h * 0.12, h * 0.05, '#fff7d0');
  paintPuffyCloud(ctx, wrap(w * 0.12 + t * 3 * u, w + 80 * u) - 70 * u, h * 0.22, 0.8 * u);
  for (const [x0, peak, x1, color] of [[-0.1, 0.16, 0.6, '#ffcfa6'], [0.4, 0.2, 1.1, '#f8bd95']] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(w * x0, hor);
    ctx.quadraticCurveTo(w * (x0 + x1) / 2, hor - h * peak, w * x1, hor);
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < 10; i++) fillDisc(ctx, ((i + 0.5) * w) / 10, hor - 3 * u, (10 + rand01(i, 271) * 8) * u, pick(MAPLE_COLORS, i));
  paintSky(ctx, [0, hor, w, h - hor], ['#f6e6b4', '#ecd59a']);
  for (const side of [-1, 1] as const) {
    /**
     * 左側の X を、右側なら鏡に映した X にする。
     * @param fx 左側の X の割合
     * @returns 実際の X
     */
    const mx = (fx: number): number => (side < 0 ? w * fx : w - w * fx);
    ctx.fillStyle = '#f3d6b8';
    ctx.beginPath();
    ctx.moveTo(mx(0), h);
    ctx.quadraticCurveTo(mx(0.12), h * 0.8, mx(0.3), hor + 2 * u);
    ctx.lineTo(mx(0.34), hor + 2 * u);
    ctx.quadraticCurveTo(mx(0.22), h * 0.82, mx(0.2), h);
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < 24; i++) {
    const x = w * rand01(i, 272);
    if (Math.abs(x - w / 2) < w * 0.2) continue;
    paintMapleLeaf(ctx, [x, hor + (h - hor) * (0.1 + rand01(i, 273) * 0.85), 3 * u], rand01(i, 274) * Math.PI * 2, pick(MAPLE_COLORS, i));
  }
  paintCanopyTree(ctx, [w * 0.27, hor + 4 * u], h * 0.4, { puffs: [pick(MAPLE_COLORS, 1), pick(MAPLE_COLORS, 2)], light: '#ffe9c2' });
  paintCanopyTree(ctx, [w * 0.73, hor + 4 * u], h * 0.36, { puffs: [pick(MAPLE_COLORS, 2), pick(MAPLE_COLORS, 3)], light: '#ffe9c2' });
  paintCanopyTree(ctx, [w * 0.07, h * 0.95], h * 0.92, { puffs: [pick(MAPLE_COLORS, 0), pick(MAPLE_COLORS, 1)], light: '#ffe9c2' });
  paintCanopyTree(ctx, [w * 0.94, h * 0.92], h * 0.82, { puffs: [pick(MAPLE_COLORS, 3), pick(MAPLE_COLORS, 0)], light: '#ffe9c2' });
  for (let i = 0; i < 18; i++) {
    const speed = 0.16 + rand01(i, 276) * 0.14;
    const y = wrap(rand01(i, 277) * h + t * speed * h, h);
    const x = rand01(i, 275) * w + Math.sin(t * 1.2 + i * 1.7) * 9 * u;
    paintMapleLeaf(ctx, [x, y, (2.6 + rand01(i, 278) * 1.6) * u], t * 1.5 + i, pick(MAPLE_COLORS, i));
  }
}

/** 背景の種類 → 描く関数 */
const BACKGROUND_PAINTERS: Readonly<Record<BackgroundStyle, BackgroundPainter>> = {
  plain: bgPlain,
  room: bgRoom,
  minamimori: bgMinamimori,
  tenma: bgTenma,
  tenroku: bgTenroku,
  ogimachi: bgOgimachi,
  okawa: bgOkawa,
  sunset: bgSunset,
  night: bgNight,
  starry: bgStarry,
  dreamy: bgDreamy,
  idol: bgIdol,
  aquarium: bgAquarium,
  yozakura: bgYozakura,
  snowlight: bgSnowlight,
  candy: bgCandy,
  beach: bgBeach,
  castle: bgCastle,
  cafe: bgCafe,
  galaxy: bgGalaxy,
  edo: bgEdo,
  nakazaki: bgNakazaki,
  tenjinMatsuri: bgTenjinMatsuri,
  momiji: bgMomiji,
};

/** 描ける背景の種類（表の順） */
export const BACKGROUND_STYLES: readonly BackgroundStyle[] = Object.freeze(Object.keys(BACKGROUND_PAINTERS) as BackgroundStyle[]);

/**
 * ステージの背景を描く（矩形 [0,0,w,h] を不透明に塗りきる。地面の線は h × STAGE_FLOOR_RATIO）。
 * 知らない種類は「シンプル」で描く。
 * @param ctx 描画先（dpr 変換済み・CSS px 座標）
 * @param style 背景の種類
 * @param w 幅
 * @param h 高さ
 * @param t 経過秒（動きを減らす設定は 0）
 * @sideEffect ctx に描画する（状態は save/restore で戻す）
 */
export function paintBackground(ctx: CanvasRenderingContext2D, style: BackgroundStyle, w: number, h: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (!(w > 0) || !(h > 0)) return;
  const painter = (BACKGROUND_PAINTERS as Readonly<Record<string, BackgroundPainter | undefined>>)[style] ?? bgPlain;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  fillBox(ctx, [0, 0, w, h], '#ffffff');
  painter(ctx, w, h, Number.isFinite(t) ? t : 0);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 置くもの（足元の中心が原点・上が負。拡大率 1 で高さ約 70px）
// ---------------------------------------------------------------------------

/**
 * ベンチ（木の座面と背もたれ・鉄の脚）。
 * @param ctx 描画先
 */
function objBench(ctx: CanvasRenderingContext2D): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const wood = '#d39a62';
  const iron = '#475569';
  fillBox(ctx, [-27, -18, 3.5, 18], iron, 1);
  fillBox(ctx, [23.5, -18, 3.5, 18], iron, 1);
  fillBox(ctx, [-26, -38, 3, 20], iron, 1);
  fillBox(ctx, [23, -38, 3, 20], iron, 1);
  fillBox(ctx, [-32, -21, 64, 5], wood, 2);
  fillBox(ctx, [-32, -16.5, 64, 2.5], '#b07a47', 1);
  fillBox(ctx, [-31, -38, 62, 5.5], wood, 2);
  fillBox(ctx, [-31, -30.5, 62, 5.5], wood, 2);
  fillBox(ctx, [-29, -37, 40, 1.2], 'rgba(255, 255, 255, 0.45)', 0.6);
  fillBox(ctx, [-29, -29.5, 30, 1.2], 'rgba(255, 255, 255, 0.45)', 0.6);
  fillBox(ctx, [-35, -27, 5, 3], iron, 1.5);
  fillBox(ctx, [30, -27, 5, 3], iron, 1.5);
}

/**
 * 観葉植物（素焼きの鉢と、ゆれる大きな葉）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objPlant(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const leaves: readonly (readonly [number, number, number])[] = [[-13, -18, -0.9], [13, -20, 0.9], [-6, -32, -0.35], [7, -34, 0.4], [0, -16, 0]];
  ctx.save();
  ctx.translate(0, -20);
  ctx.rotate(Math.sin(t * 1.2) * 0.04);
  leaves.forEach(([lx, ly, rot], i) => {
    strokeLine(ctx, [[0, 0], [lx * 0.7, ly * 0.7]], '#2f9e5f', 1.4);
    fillOval(ctx, [lx, ly, 6.5, 12], i % 2 === 0 ? '#34c77b' : '#22a565', rot);
    strokeLine(ctx, [[lx - Math.sin(rot) * 9, ly + Math.cos(rot) * 9], [lx + Math.sin(rot) * 9, ly - Math.cos(rot) * 9]], 'rgba(255, 255, 255, 0.35)', 0.8);
  });
  ctx.restore();
  fillPoly(ctx, [[-12, -20], [12, -20], [9, 0], [-9, 0]], '#e58357');
  fillPoly(ctx, [[2, -20], [12, -20], [9, 0], [2, 0]], '#d4704a');
  fillBox(ctx, [-13.5, -23, 27, 5], '#cf6a40', 1.5);
  fillOval(ctx, [0, -22.5, 10.5, 1.6], '#6b4a34');
}

/**
 * 自転車（タイヤとスポーク・コーラルのフレーム・前かごの花）。
 * @param ctx 描画先
 */
function objBicycle(ctx: CanvasRenderingContext2D): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const tire = '#374151';
  const frame = '#ff6b4a';
  for (const wx of [-18, 18]) {
    ctx.strokeStyle = tire;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(wx, -12, 11, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 4;
      strokeLine(ctx, [[wx + Math.cos(a) * 9, -12 + Math.sin(a) * 9], [wx - Math.cos(a) * 9, -12 - Math.sin(a) * 9]], '#cbd5e1', 0.8);
    }
    fillDisc(ctx, wx, -12, 2, '#94a3b8');
  }
  strokeLine(ctx, [[-18, -12], [-2, -12], [-7, -31], [-18, -12]], frame, 2.6);
  strokeLine(ctx, [[-7, -31], [12, -29], [-2, -12]], frame, 2.6);
  strokeLine(ctx, [[18, -12], [12, -29], [11, -36]], frame, 2.6);
  strokeLine(ctx, [[6, -37], [15, -37]], tire, 2.2);
  fillBox(ctx, [-13, -35, 11, 3.5], '#1f2937', 1.75);
  fillDisc(ctx, -2, -12, 2.6, '#475569');
  strokeLine(ctx, [[-2, -12], [1, -8]], '#475569', 1.6);
  fillBox(ctx, [15, -38, 14, 10], '#d9a86a', 2);
  fillBox(ctx, [15, -34.5, 14, 1], '#b88648');
  fillBox(ctx, [15, -31.5, 14, 1], '#b88648');
  fillDisc(ctx, 19, -39, 2.4, '#f472b6');
  fillDisc(ctx, 24, -40, 2.2, '#facc15');
  fillDisc(ctx, 22, -42, 1.8, '#ffffff');
  fillDisc(ctx, 9, -38.5, 1.6, '#facc15');
}

/** 自販機の飲みものの色 */
const DRINK_COLORS: readonly string[] = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#f472b6', '#14b8a6', '#facc15'];

/**
 * 自販機（光る見本の飲みもの・ボタン・取り出し口）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objVending(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const glow = 0.75 + 0.25 * Math.sin(t * 2.2);
  paintGlow(ctx, [-2, -50, 32], '#cfe8ff', 0.3 * glow);
  fillBox(ctx, [-17, -68, 34, 68], '#e94b4b', 3);
  fillBox(ctx, [11, -68, 6, 68], '#c43a3a', 2);
  fillBox(ctx, [-14.5, -64, 24, 27], '#eef7ff', 2);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const x = -13 + c * 6;
      const y = -61.5 + r * 8.5;
      fillBox(ctx, [x, y, 4, 6.5], DRINK_COLORS[(r * 4 + c) % DRINK_COLORS.length] ?? '#ef4444', 1.5);
      fillBox(ctx, [x + 1, y - 1.2, 2, 1.4], '#ffffff');
    }
  }
  withAlpha(ctx, 0.35 * glow, () => fillBox(ctx, [-14.5, -64, 24, 27], '#ffffff', 2));
  for (let c = 0; c < 4; c++) fillDisc(ctx, -11 + c * 6, -34.5, 1.2, '#fde68a');
  fillBox(ctx, [-14.5, -31, 24, 8], '#ffffff', 1.5);
  fillBox(ctx, [-12.5, -28.5, 20, 3], '#3b82f6', 1.5);
  fillBox(ctx, [12.5, -46, 3, 6], '#1f2937', 1);
  fillBox(ctx, [-13.5, -17, 22, 8], '#1f2937', 2);
  fillBox(ctx, [-16, -2.5, 32, 2.5], '#7f1d1d');
}

/**
 * 街灯（細い柱・ガラスの灯り・ゆっくり脈打つ光・街の小旗）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objLamp(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const pole = '#334155';
  paintGlow(ctx, [0, -65, 32], '#ffe08a', 0.42 + 0.1 * Math.sin(t * 2));
  fillBox(ctx, [-6, -6, 12, 6], pole, 2);
  fillBox(ctx, [-1.6, -60, 3.2, 56], pole);
  fillBox(ctx, [-3.5, -30, 7, 3], pole, 1.5);
  fillPoly(ctx, [[-7, -60], [7, -60], [5, -56], [-5, -56]], pole);
  fillBox(ctx, [-5.5, -71, 11, 11], '#fff3c0', 2);
  fillBox(ctx, [-5.5, -71, 3, 11], '#ffe28a', 1);
  fillPoly(ctx, [[-8, -71], [8, -71], [3, -77], [-3, -77]], pole);
  fillDisc(ctx, 0, -78, 1.8, pole);
  const flap = Math.sin(t * 2.4) * 1.2;
  fillPoly(ctx, [[1.6, -52], [13, -52 + flap], [13, -38 + flap], [1.6, -38]], '#ff5a36');
  fillDisc(ctx, 7.5, -45 + flap / 2, 2.4, '#ffffff');
}

/**
 * 立て看板（黒板のメニュー・チョーク）。
 * @param ctx 描画先
 */
function objSignboard(ctx: CanvasRenderingContext2D): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const wood = '#a8754a';
  strokeLine(ctx, [[-15, 0], [-11, -48]], wood, 3);
  strokeLine(ctx, [[15, 0], [11, -48]], wood, 3);
  fillBox(ctx, [-16, -52, 32, 40], wood, 3);
  fillBox(ctx, [-13.5, -49.5, 27, 35], '#2f3d36', 2);
  fillBox(ctx, [-10, -46, 20, 6], '#ff7a5c', 2);
  for (const [y, len] of [[-36, 15], [-31, 11], [-26, 16], [-21, 9]] as const) {
    fillBox(ctx, [-10, y, len, 1.4], 'rgba(255, 255, 255, 0.85)', 0.7);
    fillDisc(ctx, 8.5, y + 0.7, 1, '#fde68a');
  }
  fillDisc(ctx, 6, -21, 2.4, 'rgba(255, 255, 255, 0.7)');
  fillBox(ctx, [-12, -13, 24, 2], wood, 1);
  fillBox(ctx, [-6, -14.2, 5, 1.4], '#ffffff', 0.7);
}

/**
 * 屋台（縞の屋根・のれん・木の台・湯気の立つ鍋・吊り提灯）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objStall(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const wood = '#cf955c';
  const woodDeep = '#a8703f';
  for (const wx of [-22, 22]) {
    fillDisc(ctx, wx, -6, 6, '#475569');
    fillDisc(ctx, wx, -6, 2.4, '#cbd5e1');
  }
  fillBox(ctx, [-33, -34, 66, 26], wood, 2);
  fillBox(ctx, [-33, -22, 66, 1], woodDeep);
  fillBox(ctx, [-34, -35, 68, 4], woodDeep, 2);
  fillBox(ctx, [-31, -66, 3.5, 32], woodDeep);
  fillBox(ctx, [27.5, -66, 3.5, 32], woodDeep);
  for (let k = 0; k < 8; k++) {
    const color = k % 2 === 0 ? '#e5483d' : '#fff4ea';
    fillBox(ctx, [-36 + k * 9, -74, 9, 10], color);
    fillDisc(ctx, -31.5 + k * 9, -64, 4.5, color);
  }
  fillBox(ctx, [-37, -76, 74, 3], '#b8322a', 1.5);
  for (let k = 0; k < 3; k++) {
    const x = -26 + k * 17.5;
    const sway = Math.sin(t * 1.5 + k) * 1.2;
    fillPoly(ctx, [[x, -59], [x + 15, -59], [x + 15 + sway, -47], [x + sway, -47]], '#334a86');
    fillDisc(ctx, x + 7.5 + sway * 0.5, -53, 2.2, '#ffffff');
  }
  fillBox(ctx, [-6, -42, 16, 8], '#64748b', 2);
  fillOval(ctx, [2, -42, 9, 2], '#94a3b8');
  paintSteam(ctx, [2, -45], t, 1);
  strokeLine(ctx, [[31, -64], [33, -60]], '#3f3f46', 0.8);
  paintChochin(ctx, 33, -60, 0.45);
}

/**
 * 鳥居（小さな朱の門）。
 * @param ctx 描画先
 */
function objTorii(ctx: CanvasRenderingContext2D): void { // audit-ignore: fnlog-missing 毎フレーム描画
  paintTorii(ctx, 0, 0, { w: 62, h: 64 });
}

/** 桜の木の花の房（中心 X・Y・半径） */
const SAKURA_PUFFS: readonly (readonly [number, number, number])[] = [[0, -56, 16], [-17, -50, 12], [17, -50, 12], [-9, -66, 11], [10, -66, 11], [-25, -42, 8], [25, -42, 8], [0, -44, 10]];

/**
 * 桜の木（幹・花の房・舞い落ちる花びら）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objSakura(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  fillPoly(ctx, [[-5, 0], [5, 0], [3, -30], [10, -42], [7, -44], [1, -34], [-2, -46], [-6, -45], [-2, -30]], '#8c6d62');
  SAKURA_PUFFS.forEach(([x, y, r], i) => fillDisc(ctx, x, y, r, i % 2 === 0 ? '#f9bfd6' : '#f6a8c8'));
  fillDisc(ctx, -6, -62, 5, '#fde1ec');
  fillDisc(ctx, 9, -54, 4, '#fde1ec');
  fillDisc(ctx, -17, -49, 3, '#fde1ec');
  for (let i = 0; i < 5; i++) {
    const p = wrap(t * 0.35 + i / 5, 1);
    const x = -30 + rand01(i, 95) * 60 + Math.sin(t * 1.7 + i) * 4;
    paintPetal(ctx, [x, -38 + p * 38, 1.9], t * 2 + i, i % 2 === 0 ? '#f7a1c4' : '#fbd3e3');
  }
}

/**
 * 吊り提灯（木の柱と腕・揺れる赤い提灯）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objLantern(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const pole = '#5b4636';
  fillBox(ctx, [-8, -4, 16, 4], pole, 1.5);
  fillBox(ctx, [-1.6, -72, 3.2, 70], pole);
  fillBox(ctx, [-1.6, -72, 22, 2.6], pole, 1);
  ctx.save();
  ctx.translate(17, -70);
  ctx.rotate(Math.sin(t * 1.6) * 0.12);
  fillBox(ctx, [-0.4, 0, 0.8, 5], '#3f3f46');
  paintChochin(ctx, 0, 5, 1);
  ctx.restore();
}

/**
 * 郵便ポスト（赤い丸型・投函口・白い札）。
 * @param ctx 描画先
 */
function objPostbox(ctx: CanvasRenderingContext2D): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const red = '#e5392b';
  const deep = '#c42a1e';
  fillBox(ctx, [-11, -6, 22, 6], '#3f3f46', 1.5);
  fillBox(ctx, [-12, -50, 24, 44], red, 3);
  fillBox(ctx, [5, -50, 7, 44], deep, 3);
  fillOval(ctx, [0, -50, 12, 5.5], red);
  fillBox(ctx, [-13, -55, 26, 4.5], deep, 2);
  fillOval(ctx, [0, -55, 13, 2.5], '#f05a4b');
  fillBox(ctx, [-8, -43, 16, 2.6], '#3b0d0a', 1.3);
  fillBox(ctx, [-6, -35, 12, 10], '#ffffff', 1.5);
  fillBox(ctx, [-3, -33, 6, 1.2], red);
  fillBox(ctx, [-3, -31, 6, 1.2], red);
  fillBox(ctx, [-0.6, -31, 1.2, 4.5], red);
  fillBox(ctx, [-9, -20, 14, 1], deep);
  fillBox(ctx, [-9.5, -47, 2.5, 36], 'rgba(255, 255, 255, 0.28)', 1.25);
}

/**
 * 招きねこ（赤い座布団・小判・鈴・ゆっくり招く手）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objManeki(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const white = '#fbfaf7';
  fillOval(ctx, [0, -4, 18, 5], '#e5483d');
  fillOval(ctx, [0, -19, 13, 15], white);
  fillOval(ctx, [6, -19, 6, 13], '#eee9e1');
  fillOval(ctx, [-7, -21, 3, 4], '#374151');
  fillOval(ctx, [-2, -15, 5, 7.5], '#f5b700');
  for (const y of [-19, -15, -11]) fillBox(ctx, [-5, y, 6, 0.8], '#d99a00');
  fillDisc(ctx, 0, -37, 11.5, white);
  fillPoly(ctx, [[-10, -42], [-8, -52], [-2, -47]], white);
  fillPoly(ctx, [[10, -42], [8, -52], [2, -47]], white);
  fillPoly(ctx, [[-8.5, -43], [-7.5, -49.5], [-4, -46.5]], '#f9b4c6');
  fillPoly(ctx, [[8.5, -43], [7.5, -49.5], [4, -46.5]], '#f9b4c6');
  fillOval(ctx, [6, -44, 3.5, 2.5], '#f59e0b');
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 1.2;
  for (const ex of [-4.5, 4.5]) {
    ctx.beginPath();
    ctx.arc(ex, -39, 2, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  fillDisc(ctx, 0, -34.5, 1.2, '#f48fb1');
  for (const s of [-1, 1]) strokeLine(ctx, [[s * 6, -34], [s * 11.5, -35]], '#c4c9d1', 0.6);
  fillBox(ctx, [-9, -28, 18, 3], '#e5483d', 1.5);
  fillDisc(ctx, 0, -24.5, 2.4, '#f5b700');
  ctx.save();
  ctx.translate(9, -27);
  ctx.rotate(-0.2 + Math.sin(t * 3) * 0.35);
  fillBox(ctx, [-3, -14, 6, 15], white, 3);
  fillDisc(ctx, 0, -14, 3.6, white);
  fillDisc(ctx, 0, -14.5, 1.4, '#f9b4c6');
  ctx.restore();
}

/**
 * 信楽のたぬき（笠・とっくり・通い帳・大きなおなか）。
 * @param ctx 描画先
 */
function objTanuki(ctx: CanvasRenderingContext2D): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const fur = '#8a6a4f';
  const furDeep = '#6f5440';
  const belly = '#efe0c8';
  fillOval(ctx, [14, -7, 6, 4], furDeep);
  fillOval(ctx, [-7, -3, 6, 3.5], furDeep);
  fillOval(ctx, [7, -3, 6, 3.5], furDeep);
  fillOval(ctx, [0, -19, 15, 16], fur);
  fillOval(ctx, [0, -16, 10.5, 11], belly);
  fillOval(ctx, [-13, -21, 4, 6], furDeep);
  fillBox(ctx, [-21, -25, 7, 10], '#f1e7d3', 1);
  fillBox(ctx, [-20, -23, 5, 0.8], '#9ca3af');
  fillBox(ctx, [-20, -21, 4, 0.8], '#9ca3af');
  fillOval(ctx, [15, -18, 4.5, 6], '#f8fafc');
  fillBox(ctx, [13.5, -28, 3, 5], '#f8fafc', 1);
  fillBox(ctx, [12, -20, 6, 3.5], '#3b82f6', 0.8);
  fillOval(ctx, [12, -22, 4, 5.5], furDeep);
  fillDisc(ctx, 0, -39, 10, fur);
  fillOval(ctx, [-4, -39, 3.6, 3], '#3f2f22');
  fillOval(ctx, [4, -39, 3.6, 3], '#3f2f22');
  fillDisc(ctx, -3.6, -39.5, 1, '#ffffff');
  fillDisc(ctx, 4.4, -39.5, 1, '#ffffff');
  fillOval(ctx, [0, -34.5, 4.5, 3.2], belly);
  fillDisc(ctx, 0, -35.5, 1.4, '#2b2b33');
  fillOval(ctx, [0, -47, 15, 3.5], '#d9b56a');
  fillOval(ctx, [0, -50, 8, 4], '#e8c983');
  fillBox(ctx, [-8, -49, 16, 1.4], '#b8893f');
}

/**
 * 噴水の水の弧と、弧に沿って落ちるしずく。
 * @param ctx 描画先
 * @param t 経過秒
 */
function paintFountainJets(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.strokeStyle = 'rgba(143, 208, 242, 0.85)';
  ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, -46);
    ctx.quadraticCurveTo(side * 10, -64, side * 21, -14);
    ctx.stroke();
  }
  fillBox(ctx, [-1, -58, 2, 14], 'rgba(191, 229, 250, 0.9)', 1);
  fillDisc(ctx, 0, -59, 2.6, '#bfe5fa');
  for (let i = 0; i < 6; i++) {
    const p = wrap(t * 0.9 + i / 6, 1);
    const side = i % 2 === 0 ? 1 : -1;
    const bx = 2 * (1 - p) * p * side * 10 + p * p * side * 21;
    const by = (1 - p) * (1 - p) * -46 + 2 * (1 - p) * p * -64 + p * p * -14;
    fillDisc(ctx, bx, by, 1.4, '#e0f4ff');
  }
}

/**
 * 噴水（石の水盤・広がる波紋・上の受け皿・水の弧）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objFountain(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const stone = '#cbd5e1';
  const stoneDeep = '#a9b6c6';
  const water = '#8fd0f2';
  fillOval(ctx, [0, -8, 34, 9], stoneDeep);
  fillOval(ctx, [0, -11, 34, 9], stone);
  fillOval(ctx, [0, -11, 29, 6.5], water);
  for (let k = 0; k < 2; k++) {
    const p = wrap(t * 0.5 + k * 0.5, 1);
    withAlpha(ctx, 0.6 * (1 - p), () => {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, -11, 6 + p * 20, 1.5 + p * 4.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
  fillBox(ctx, [-3.5, -40, 7, 30], stone);
  fillBox(ctx, [1, -40, 2.5, 30], stoneDeep);
  fillOval(ctx, [0, -40, 14, 4], stoneDeep);
  fillOval(ctx, [0, -42, 14, 3.5], stone);
  fillOval(ctx, [0, -42, 11, 2.4], water);
  paintFountainJets(ctx, t);
}

/** ガチャの中のカプセル（中心 X・Y・色） */
const CAPSULES: readonly (readonly [number, number, string])[] = [
  [-8, -36, '#f472b6'], [0, -35, '#60a5fa'], [8, -36, '#facc15'], [-4, -43, '#34d399'],
  [5, -43, '#f97316'], [-8, -50, '#a78bfa'], [1, -51, '#f87171'], [8, -49, '#22d3ee'],
];

/**
 * カプセルトイの機械（ガラスの中のカプセル・回るつまみ・取り出し口）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objGacha(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  fillBox(ctx, [-15, -28, 30, 28], '#ef4444', 3);
  fillBox(ctx, [8, -28, 7, 28], '#c53030', 3);
  fillBox(ctx, [-16, -30, 32, 4], '#c53030', 2);
  fillBox(ctx, [-11, -10, 13, 7], '#3f1d1d', 2);
  fillDisc(ctx, -5, -6.5, 2.4, '#60a5fa');
  fillDisc(ctx, 0, -19.5, 5, '#f8fafc');
  ctx.save();
  ctx.translate(0, -19.5);
  ctx.rotate(Math.sin(t * 1.5) * 0.7);
  fillBox(ctx, [-4.5, -1.2, 9, 2.4], '#94a3b8', 1.2);
  ctx.restore();
  fillBox(ctx, [-14, -60, 28, 30], '#e0f2fe', 8);
  for (const [x, y, color] of CAPSULES) {
    fillDisc(ctx, x, y, 4, '#ffffff');
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  }
  fillBox(ctx, [-11, -56, 3, 22], 'rgba(255, 255, 255, 0.7)', 1.5);
  fillBox(ctx, [-15, -63, 30, 5], '#ef4444', 2.5);
  paintSparkle(ctx, 0, -67, 3.8, '#fde047');
}

/** 打ち上げ花火の1発（ひらく位置・色・位相のずれ） */
interface FireworkShot {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly offset: number;
}

/** 打ち上げ花火の玉（t=0 でも1発はひらいて見える位相にする） */
const FIREWORK_SHOTS: readonly FireworkShot[] = [
  { x: -14, y: -84, color: '#ff7ab6', offset: 0.62 },
  { x: 15, y: -94, color: '#ffd166', offset: 0.22 },
  { x: 2, y: -70, color: '#6ee7ff', offset: 0.9 },
];

/**
 * 花火の1発（打ち上がる火の玉 → ひらいて消える）を描く。
 * @param ctx 描画先
 * @param shot 玉
 * @param t 経過秒
 */
function paintFireworkShot(ctx: CanvasRenderingContext2D, shot: FireworkShot, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const p = wrap(t / 2.4 + shot.offset, 1);
  if (p < 0.3) {
    const k = p / 0.3;
    const x = shot.x * k;
    const y = -16 + (shot.y + 16) * k;
    strokeLine(ctx, [[x - shot.x * 0.06, y + 9], [x, y]], 'rgba(255, 247, 214, 0.6)', 1.2);
    fillDisc(ctx, x, y, 1.6, '#fff7d6');
    return;
  }
  const q = (p - 0.3) / 0.7;
  const r = 5 + 14 * (1 - (1 - q) * (1 - q));
  withAlpha(ctx, 1 - q * q, () => {
    paintGlow(ctx, [shot.x, shot.y, r * 1.4], shot.color, 0.3);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const drop = q * q * 6;
      const ex = shot.x + Math.cos(a) * r;
      const ey = shot.y + Math.sin(a) * r + drop;
      strokeLine(ctx, [[shot.x + Math.cos(a) * r * 0.55, shot.y + Math.sin(a) * r * 0.55 + drop], [ex, ey]], shot.color, 1.4);
      fillDisc(ctx, ex, ey, 1.3, '#ffffff');
    }
  });
}

/**
 * 打ち上げ花火（地面の筒と、上でひらく花火）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objFireworks(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  fillBox(ctx, [-6, -16, 12, 16], '#1f2937', 2);
  fillBox(ctx, [-6, -12, 12, 2.4], '#ef4444');
  fillBox(ctx, [-6, -6, 12, 2.4], '#ef4444');
  fillOval(ctx, [0, -16, 6, 1.8], '#374151');
  withAlpha(ctx, 0.6 + 0.4 * Math.abs(Math.sin(t * 5)), () => {
    paintSparkle(ctx, -10, -4, 2.6, '#fde047');
    paintSparkle(ctx, 10, -6, 2, '#fb923c');
  });
  FIREWORK_SHOTS.forEach((shot) => paintFireworkShot(ctx, shot, t));
}

/**
 * 金のトロフィー（木の台・金の杯・星・きらめき）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objTrophy(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const gold = '#f5b700';
  const goldDeep = '#d99a00';
  fillBox(ctx, [-15, -12, 30, 12], '#7c4a2d', 2);
  fillBox(ctx, [-15, -12, 30, 3], '#93603d', 2);
  fillBox(ctx, [-7, -8, 14, 4.5], '#ffd95a', 1);
  fillBox(ctx, [-10, -17, 20, 5], goldDeep, 1.5);
  fillPoly(ctx, [[-3, -17], [3, -17], [2, -27], [-2, -27]], gold);
  fillOval(ctx, [0, -27, 4.5, 2.2], goldDeep);
  ctx.strokeStyle = gold;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(-13, -46, 6, Math.PI * 0.5, Math.PI * 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(13, -46, 6, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.stroke();
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.moveTo(-13, -55);
  ctx.lineTo(13, -55);
  ctx.quadraticCurveTo(13, -31, 0, -28);
  ctx.quadraticCurveTo(-13, -31, -13, -55);
  ctx.fill();
  fillPoly(ctx, [[4, -55], [13, -55], [12, -40], [7, -32], [3, -30]], goldDeep);
  fillOval(ctx, [0, -55, 13, 2.8], '#ffd95a');
  fillOval(ctx, [0, -55, 10.5, 1.8], goldDeep);
  paintStar5(ctx, -1, -43, 5.5, '#fff3b0');
  fillBox(ctx, [-9, -52, 2.4, 15], 'rgba(255, 255, 255, 0.5)', 1.2);
  const sparks: readonly Pt[] = [[-17, -60], [18, -52], [10, -66]];
  sparks.forEach(([x, y], i) => {
    const a = 0.5 + 0.5 * Math.sin(t * 2.4 + i * 2.1);
    withAlpha(ctx, a, () => paintSparkle(ctx, x, y, 3 + a * 2, '#ffffff'));
  });
}

/** ハートの風船（中心 X・Y・大きさ・色・揺れの位相） */
const HEART_BALLOONS: readonly (readonly [number, number, number, string, number])[] = [
  [-15, -74, 11, '#ff8cc6', 0],
  [14, -66, 10, '#9adfff', 2.1],
  [1, -94, 12.5, '#c9a2ff', 1.2],
];

/**
 * ハートの風船の束（つやのあるハート・ひも・リボンのついたおもりの箱）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objHeartBalloon(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const knot: Pt = [0, -13];
  for (const [x, y, s, color, phase] of HEART_BALLOONS) {
    const bx = x + Math.sin(t * 1.1 + phase) * 1.6;
    const by = y + Math.sin(t * 1.6 + phase) * 2;
    ctx.strokeStyle = 'rgba(244, 166, 200, 0.95)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(knot[0], knot[1]);
    ctx.quadraticCurveTo((knot[0] + bx) / 2 + Math.sin(t * 1.3 + phase) * 3, (knot[1] + by) / 2, bx, by + s * 0.9);
    ctx.stroke();
    paintGlossyHeart(ctx, [bx, by, s], color);
    fillPoly(ctx, [[bx - 1.6, by + s * 0.98], [bx + 1.6, by + s * 0.98], [bx, by + s * 0.82]], mixColors(color, '#7a2e6e', 0.25));
  }
  fillBox(ctx, [-7.5, -12, 15, 12], '#ffb6d9', 2);
  fillBox(ctx, [-7.5, -12, 15, 3.5], '#ff8cc6', 2);
  fillBox(ctx, [-1.4, -12, 2.8, 12], '#fff3b0');
  fillOval(ctx, [-3, -13.5, 3, 1.8], '#ffe58a', -0.4);
  fillOval(ctx, [3, -13.5, 3, 1.8], '#ffe58a', 0.4);
  fillBox(ctx, [-6, -10, 3.5, 1], 'rgba(255, 255, 255, 0.7)', 0.5);
}

/** ドレッサーの香水びん（中心 X・中身の色・形） */
const PERFUMES: readonly (readonly [number, string, 'square' | 'round'])[] = [[-23, '#c9a2ff', 'square'], [22, '#ff8cc6', 'round'], [-16, '#9adfff', 'round']];

/**
 * ドレッサーの上の香水びん（ガラスのつや・丸いふた）を並べる。
 * @param ctx 描画先
 * @param top 天板の上端の Y
 */
function paintPerfumes(ctx: CanvasRenderingContext2D, top: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (const [x, color, shape] of PERFUMES) {
    if (shape === 'square') {
      fillBox(ctx, [x - 3.2, top - 8, 6.4, 8], color, 2);
      fillBox(ctx, [x - 1, top - 10, 2, 2.4], '#ffffff');
      fillDisc(ctx, x, top - 11, 2, '#ffd86b');
    } else {
      fillOval(ctx, [x, top - 4, 3.6, 4], color);
      fillBox(ctx, [x - 1, top - 9.5, 2, 2.4], '#ffffff');
      fillDisc(ctx, x, top - 10.5, 1.8, '#ffe58a');
    }
    fillOval(ctx, [x - 1.2, top - 5.5, 0.8, 1.8], 'rgba(255, 255, 255, 0.85)');
  }
}

/**
 * ひみつのドレッサー（白とピンクの台・楕円の鏡と鏡のきらめき・香水びん・金のつまみ）。
 * @param ctx 描画先
 * @param t 経過秒
 */
function objDresser(ctx: CanvasRenderingContext2D, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const pink = '#ffb6d9';
  const deep = '#f4a6c8';
  fillHeart(ctx, [0, -77, 3.4], deep);
  fillOval(ctx, [0, -57, 15.5, 19.5], pink);
  fillOval(ctx, [0, -57, 12.2, 16], '#e8f6ff');
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, -57, 12.2, 16, 0, 0, Math.PI * 2);
  ctx.clip();
  fillPoly(ctx, [[-12, -52], [-2, -73], [3, -73], [-7, -48]], 'rgba(255, 255, 255, 0.7)');
  fillPoly(ctx, [[-4, -44], [6, -66], [8, -66], [-2, -43]], 'rgba(255, 255, 255, 0.45)');
  ctx.restore();
  const tw = 0.6 + 0.4 * Math.abs(Math.sin(t * 2.2));
  withAlpha(ctx, tw, () => paintSparkle(ctx, 6, -64, 2.5 + tw * 2, '#ffffff'));
  fillBox(ctx, [-3, -40, 6, 4], deep);
  fillBox(ctx, [-24, -10, 4, 10], deep, 2);
  fillBox(ctx, [20, -10, 4, 10], deep, 2);
  fillBox(ctx, [-28, -34, 56, 25], '#ffffff', 4);
  fillBox(ctx, [-28, -14, 56, 5], '#fbe9f3', 3);
  fillBox(ctx, [-24, -30, 22, 9], '#fff0f7', 2);
  fillBox(ctx, [2, -30, 22, 9], '#fff0f7', 2);
  fillDisc(ctx, -13, -25.5, 1.6, '#ffd86b');
  fillDisc(ctx, 13, -25.5, 1.6, '#ffd86b');
  fillHeart(ctx, [0, -17, 3], deep);
  fillBox(ctx, [-30, -37, 60, 5], pink, 2.5);
  fillBox(ctx, [-26, -36.2, 30, 1.1], 'rgba(255, 255, 255, 0.75)', 0.5);
  paintPerfumes(ctx, -37);
}

/** 置くものの種類 → 描く関数 */
const OBJECT_PAINTERS: Readonly<Record<ObjectStyle, ObjectPainter>> = {
  bench: objBench,
  plant: objPlant,
  bicycle: objBicycle,
  vending: objVending,
  lamp: objLamp,
  signboard: objSignboard,
  stall: objStall,
  torii: objTorii,
  sakura: objSakura,
  lantern: objLantern,
  postbox: objPostbox,
  maneki: objManeki,
  tanuki: objTanuki,
  fountain: objFountain,
  gacha: objGacha,
  fireworks: objFireworks,
  trophy: objTrophy,
  heartballoon: objHeartBalloon,
  dresser: objDresser,
};

/** 置くものの足元の影の横半径（拡大率 1） */
const OBJECT_SHADOW_RX: Readonly<Record<ObjectStyle, number>> = {
  bench: 34, plant: 13, bicycle: 30, vending: 19, lamp: 9, signboard: 17, stall: 36, torii: 30, sakura: 24,
  lantern: 10, postbox: 14, maneki: 18, tanuki: 17, fountain: 34, gacha: 16, fireworks: 10, trophy: 16,
  heartballoon: 11, dresser: 30,
};

/** 描ける置くものの種類（表の順） */
export const OBJECT_STYLES: readonly ObjectStyle[] = Object.freeze(Object.keys(OBJECT_PAINTERS) as ObjectStyle[]);

/**
 * 置くものを描く（足元の中心 (x, y) 基準。拡大率 1 で高さ約 70px・幅 ±40px。花火は上へ約 115px までひらく）。
 * 足元に淡い影を敷く。知らない種類は描かない。
 * @param ctx 描画先（dpr 変換済み・CSS px 座標）
 * @param style 置くものの種類
 * @param x 足元の中心 X
 * @param y 足元の Y
 * @param scale 拡大率
 * @param t 経過秒（動きを減らす設定は 0）
 * @sideEffect ctx に描画する（状態は save/restore で戻す）
 */
export function paintObject(ctx: CanvasRenderingContext2D, style: ObjectStyle, x: number, y: number, scale: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const painter = (OBJECT_PAINTERS as Readonly<Record<string, ObjectPainter | undefined>>)[style];
  if (painter === undefined || !(scale > 0)) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  fillOval(ctx, [0, 0, OBJECT_SHADOW_RX[style], 3.6], 'rgba(17, 24, 39, 0.14)');
  painter(ctx, Number.isFinite(t) ? t : 0);
  ctx.restore();
}
