/**
 * @file アバターのステージの絵（presentation/shared/avatar。Canvas 描画の純粋関数）
 * アバター画面のステージ（と、その一覧の小さな見本）に敷く「背景」12種と、アバターの横に置く「置くもの」19種を描く。
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
 * 桜の木（幹と、ふんわり重なる花の房）を描く。
 * @param ctx 描画先
 * @param x 幹の X
 * @param base 足元の Y
 * @param size 高さ（花の房の半径もここから決める）
 */
function paintSakuraTree(ctx: CanvasRenderingContext2D, x: number, base: number, size: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const cy = base - size * 0.72;
  const r = size * 0.34;
  fillPoly(ctx, [[x - size * 0.04, base], [x + size * 0.04, base], [x + size * 0.02, cy + r * 0.3], [x + size * 0.1, cy], [x + size * 0.07, cy - r * 0.05], [x, cy + r * 0.2], [x - size * 0.08, cy - r * 0.02], [x - size * 0.03, cy + r * 0.4]], '#8c6d62');
  const puffs: readonly (readonly [number, number, number])[] = [[0, 0, 1], [-0.62, 0.22, 0.7], [0.62, 0.25, 0.72], [-0.32, -0.45, 0.66], [0.36, -0.42, 0.62], [0, 0.42, 0.6]];
  puffs.forEach(([dx, dy, k], i) => fillDisc(ctx, x + dx * r, cy + dy * r, r * k * 0.62, i % 2 === 0 ? '#f9bfd6' : '#f6a8c8'));
  fillDisc(ctx, x - r * 0.25, cy - r * 0.35, r * 0.18, '#fde1ec');
  fillDisc(ctx, x + r * 0.35, cy - r * 0.1, r * 0.14, '#fde1ec');
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
