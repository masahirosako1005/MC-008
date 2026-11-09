/**
 * @file 看板商品の「写真風」の絵（presentation/screens/Map/town 層）
 * 2026-11-09 ユーザー指示「地図のお店のアイコンはドット絵じゃなくて写真風にしてほしい」。本物の写真素材は無いので、Canvas 2D で商品写真のように描く。
 * - 背景: 商品に合う場所（カフェの木のテーブル・和紙・赤ちょうちんの店・市場の木箱・タイル・大理石…）を、ぼけ・ボケ玉・周辺減光つきで
 * - 被写体: グラデーションの立体感・つや・接地のやわらかい影・湯気。輪郭線は描かない（写真に輪郭線は無い）
 * アイコンごとに 160px 四方へ1回だけ描いてキャッシュし、角丸に切り抜いて縮めて描く。未発見の店用のシルエット版（灰色・ぼかし・暗く）も別にキャッシュする。
 * 乱数は使わず、アイコン名から作る決まった乱数（seededRandomFor）で粒・ボケ玉を散らす。document が無い環境（テスト）では何もしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { seededRandomFor } from '@/Common/ui/canvas/seededHash';
import type { GoodsIcon } from '@/presentation/screens/Map/town/pixelSprites';

const logger = createLogger('presentation/screens/Map/town/goodsPhoto');

/** キャッシュする写真の一辺（px） */
export const PHOTO_PX = 160;
/** 角丸の既定（一辺に対する割合） */
const DEFAULT_RADIUS_RATIO = 0.22;
/** 被写体の既定の拡大率 */
const DEFAULT_ZOOM = 1.12;
/** 拡大の中心（y） */
const ZOOM_PIVOT_Y = 100;
/** シルエット版のフィルタ */
const SILHOUETTE_FILTER = 'grayscale(1) blur(2px) brightness(0.55)';

const S = PHOTO_PX;
type Ctx = CanvasRenderingContext2D;
type Rand = () => number;
type Stop = readonly [number, string];

/** 写真の背景（場所） */
interface Scene {
  /** 壁（上→下） */
  readonly wall: readonly [string, string];
  /** 机・台（奥→手前） */
  readonly table: readonly [string, string];
  /** 壁と机の境（px） */
  readonly horizon: number;
  /** ボケ玉の色 */
  readonly bokeh: readonly string[];
  /** 机の模様 */
  readonly kind: 'wood' | 'cloth' | 'tile' | 'marble' | 'plain';
  /** 木目の色 */
  readonly grain?: string;
}

/** 背景の種類 */
const SCENES = {
  cafe: { wall: ['#5a3d2b', '#2e1f17'], table: ['#6e4a2f', '#b07c52'], horizon: 70, bokeh: ['#ffd28a', '#ffb862', '#fff0c8'], kind: 'wood', grain: '#4e321f' },
  washi: { wall: ['#f3ebdd', '#d9cab0'], table: ['#b08458', '#dcb88e'], horizon: 74, bokeh: ['#ffffff', '#f7e7c9'], kind: 'wood', grain: '#94683f' },
  redcloth: { wall: ['#f0e6d4', '#d4c0a0'], table: ['#8e2620', '#c8443a'], horizon: 76, bokeh: ['#fff6e0', '#ffd9a8'], kind: 'cloth' },
  izakaya: { wall: ['#2e1e17', '#140c09'], table: ['#55361f', '#946644'], horizon: 70, bokeh: ['#ff6b3d', '#ffb25c', '#ffd98a'], kind: 'wood', grain: '#3a2414' },
  market: { wall: ['#71905a', '#3c522e'], table: ['#8f6340', '#c79a68'], horizon: 72, bokeh: ['#ffe08a', '#ff8a5c', '#d4f59a'], kind: 'wood', grain: '#6e4a2a' },
  shop: { wall: ['#efebe4', '#d2c9bc'], table: ['#c9bdac', '#ebe3d7'], horizon: 76, bokeh: ['#ffffff', '#fbe3c4'], kind: 'cloth' },
  bath: { wall: ['#a9d8ec', '#6db0d1'], table: ['#cde7f1', '#f2fbff'], horizon: 88, bokeh: ['#ffffff', '#dff5ff'], kind: 'tile' },
  marble: { wall: ['#f7efe9', '#e6d9d1'], table: ['#efebe7', '#ffffff'], horizon: 78, bokeh: ['#ffd6e0', '#ffffff', '#ffe9c2'], kind: 'marble' },
  shelf: { wall: ['#4e3a2c', '#2a1e16'], table: ['#6e5038', '#a17a58'], horizon: 74, bokeh: ['#e8b45c', '#9ec4d8', '#d86a4f'], kind: 'wood', grain: '#523a28' },
  outdoor: { wall: ['#bfe3f7', '#8ec88a'], table: ['#a9a295', '#d6cfc1'], horizon: 100, bokeh: ['#ffffff', '#e8ffd0', '#ffe0ef'], kind: 'plain' },
  studio: { wall: ['#e6e9ee', '#b4bcc8'], table: ['#c4cad3', '#eef0f3'], horizon: 82, bokeh: ['#ffffff'], kind: 'plain' },
  gallery: { wall: ['#f5f3ef', '#dcd7cf'], table: ['#c9baa8', '#e4d9ca'], horizon: 134, bokeh: ['#fff6dc'], kind: 'plain' },
} as const satisfies Record<string, Scene>;

/** 背景の名前 */
type SceneName = keyof typeof SCENES;

// ---------------------------------------------------------------------------
// 色と形の小道具（すべて 160px 四方の座標で描く）
// ---------------------------------------------------------------------------

/**
 * '#rrggbb' を RGB にする。
 * @param hex 色
 * @returns [r, g, b]
 */
function rgbOf(hex: string): [number, number, number] { // audit-ignore: fnlog-missing 絵を描くときに何百回も呼ぶ純粋な変換ヘルパー
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 色を明るく（amt>0 で白へ）・暗く（amt<0 で黒へ）する。
 * @param hex 色
 * @param amt -1..1
 * @returns 'rgb(...)'
 */
function shade(hex: string, amt: number): string { // audit-ignore: fnlog-missing 絵を描くときに何百回も呼ぶ純粋な変換ヘルパー
  const [r, g, b] = rgbOf(hex);
  const t = Math.min(1, Math.abs(amt));
  const to = amt >= 0 ? 255 : 0;
  return `rgb(${Math.round(r + (to - r) * t)},${Math.round(g + (to - g) * t)},${Math.round(b + (to - b) * t)})`;
}

/**
 * 透明度つきの色。
 * @param hex 色
 * @param a 不透明度 0..1
 * @returns 'rgba(...)'
 */
function rgba(hex: string, a: number): string { // audit-ignore: fnlog-missing 絵を描くときに何百回も呼ぶ純粋な変換ヘルパー
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * 線形グラデーション。
 * @param c 2D コンテキスト
 * @param x0 始点x
 * @param y0 始点y
 * @param x1 終点x
 * @param y1 終点y
 * @param stops [位置, 色]
 * @returns グラデーション
 */
function lin(c: Ctx, x0: number, y0: number, x1: number, y1: number, stops: readonly Stop[]): CanvasGradient { // audit-ignore: fnlog-missing 絵を描くときに何百回も呼ぶヘルパー
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [p, color] of stops) g.addColorStop(p, color);
  return g;
}

/**
 * 放射グラデーション。
 * @param c 2D コンテキスト
 * @param x0 内側の中心x
 * @param y0 内側の中心y
 * @param r0 内側の半径
 * @param x1 外側の中心x
 * @param y1 外側の中心y
 * @param r1 外側の半径
 * @param stops [位置, 色]
 * @returns グラデーション
 */
function rad(c: Ctx, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, stops: readonly Stop[]): CanvasGradient { // audit-ignore: fnlog-missing 絵を描くときに何百回も呼ぶヘルパー
  const g = c.createRadialGradient(x0, y0, Math.max(0, r0), x1, y1, Math.max(0.1, r1));
  for (const [p, color] of stops) g.addColorStop(p, color);
  return g;
}

/**
 * だ円を塗る。
 * @param c 2D コンテキスト
 * @param cx 中心x
 * @param cy 中心y
 * @param rx 横の半径
 * @param ry 縦の半径
 * @param fill 塗り
 * @param rot 回転（ラジアン）
 * @sideEffect canvas に描く
 */
function ell(c: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string | CanvasGradient, rot = 0): void { // audit-ignore: fnlog-missing 絵を描くときに何百回も呼ぶヘルパー
  c.beginPath();
  c.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
}

/**
 * 多角形を塗る。
 * @param c 2D コンテキスト
 * @param pts 頂点 [x, y, x, y, ...]
 * @param fill 塗り
 * @sideEffect canvas に描く
 */
function poly(c: Ctx, pts: readonly number[], fill: string | CanvasGradient): void { // audit-ignore: fnlog-missing 絵を描くときに何百回も呼ぶヘルパー
  c.beginPath();
  for (let k = 0; k + 1 < pts.length; k += 2) {
    if (k === 0) c.moveTo(pts[k] ?? 0, pts[k + 1] ?? 0);
    else c.lineTo(pts[k] ?? 0, pts[k + 1] ?? 0);
  }
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

/**
 * 角丸の四角を塗る。
 * @param c 2D コンテキスト
 * @param x 左
 * @param y 上
 * @param w 幅
 * @param h 高さ
 * @param r 角丸
 * @param fill 塗り
 * @sideEffect canvas に描く
 */
function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient): void { // audit-ignore: fnlog-missing 絵を描くときに何百回も呼ぶヘルパー
  roundRectPath(c, x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
}

/**
 * 角丸の四角のパスを作る（roundRect が無い環境では弧で作る）。
 * @param c 2D コンテキスト
 * @param x 左
 * @param y 上
 * @param w 幅
 * @param h 高さ
 * @param r 角丸
 * @sideEffect パスを作る
 */
function roundRectPath(c: Ctx, x: number, y: number, w: number, h: number, r: number): void { // audit-ignore: fnlog-missing 絵を描くときに何百回も呼ぶヘルパー
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}

/**
 * 接地のやわらかい影（だ円のぼけた影）。
 * @param c 2D コンテキスト
 * @param cx 中心x
 * @param cy 中心y
 * @param rx 横の半径
 * @param ry 縦の半径
 * @param a 濃さ
 * @sideEffect canvas に描く
 */
function shadow(c: Ctx, cx: number, cy: number, rx: number, ry: number, a = 0.42): void { // audit-ignore: fnlog-missing 絵を描くときに呼ぶヘルパー
  c.save();
  c.translate(cx, cy);
  c.scale(1, ry / Math.max(0.1, rx));
  c.beginPath();
  c.arc(0, 0, rx, 0, Math.PI * 2);
  c.fillStyle = rad(c, 0, 0, 0, 0, 0, rx, [[0, `rgba(20,10,5,${a})`], [0.6, `rgba(20,10,5,${a * 0.45})`], [1, 'rgba(20,10,5,0)']]);
  c.fill();
  c.restore();
}

/**
 * 球（左上から光が当たった立体）。
 * @param c 2D コンテキスト
 * @param cx 中心x
 * @param cy 中心y
 * @param r 半径
 * @param base 色
 * @param shine つやの強さ（0 でつやなし）
 * @sideEffect canvas に描く
 */
function sphere(c: Ctx, cx: number, cy: number, r: number, base: string, shine = 0.55): void { // audit-ignore: fnlog-missing 絵を描くときに呼ぶヘルパー
  ell(c, cx, cy, r, r, rad(c, cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r, [[0, shade(base, 0.45)], [0.45, base], [1, shade(base, -0.5)]]));
  if (shine > 0) gloss(c, cx - r * 0.32, cy - r * 0.4, r * 0.28, r * 0.18, shine);
}

/**
 * つや（白い鏡面のハイライト）。
 * @param c 2D コンテキスト
 * @param cx 中心x
 * @param cy 中心y
 * @param rx 横の半径
 * @param ry 縦の半径
 * @param a 濃さ
 * @param rot 回転
 * @sideEffect canvas に描く
 */
function gloss(c: Ctx, cx: number, cy: number, rx: number, ry: number, a = 0.55, rot = -0.5): void { // audit-ignore: fnlog-missing 絵を描くときに呼ぶヘルパー
  c.save();
  c.translate(cx, cy);
  c.rotate(rot);
  c.scale(1, ry / Math.max(0.1, rx));
  c.beginPath();
  c.arc(0, 0, rx, 0, Math.PI * 2);
  c.fillStyle = rad(c, 0, 0, 0, 0, 0, rx, [[0, `rgba(255,255,255,${a})`], [1, 'rgba(255,255,255,0)']]);
  c.fill();
  c.restore();
}

/**
 * だ円の中に小さな粒を散らす（ごま・パン粉・あんこ・青のりなど）。
 * @param c 2D コンテキスト
 * @param rnd 決まった乱数
 * @param n 粒の数
 * @param cx 中心x
 * @param cy 中心y
 * @param rx 横の半径
 * @param ry 縦の半径
 * @param colors 粒の色
 * @param size 粒の大きさ [最小, 最大]
 * @sideEffect canvas に描く
 */
function speckle(c: Ctx, rnd: Rand, n: number, cx: number, cy: number, rx: number, ry: number, colors: readonly string[], size: readonly [number, number] = [0.8, 1.8]): void { // audit-ignore: fnlog-missing 絵を描くときに呼ぶヘルパー
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd());
    const r = size[0] + rnd() * (size[1] - size[0]);
    ell(c, cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, r, r * (0.6 + rnd() * 0.5), colors[Math.floor(rnd() * colors.length)] ?? '#ffffff', rnd() * 3);
  }
}

/**
 * 湯気（半透明の白いゆらぎ）。
 * @param c 2D コンテキスト
 * @param cx 中心x
 * @param bottom 湯気の根元のy
 * @param h 高さ
 * @param a 濃さ
 * @sideEffect canvas に描く
 */
function steam(c: Ctx, cx: number, bottom: number, h: number, a = 0.42): void { // audit-ignore: fnlog-missing 絵を描くときに呼ぶヘルパー
  c.save();
  c.lineCap = 'round';
  c.filter = 'blur(2px)';
  for (const [dx, w] of [[-12, 7], [4, 9], [16, 6]] as const) {
    c.strokeStyle = lin(c, 0, bottom, 0, bottom - h, [[0, `rgba(255,255,255,${a})`], [1, 'rgba(255,255,255,0)']]);
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(cx + dx, bottom);
    c.bezierCurveTo(cx + dx - 10, bottom - h * 0.35, cx + dx + 10, bottom - h * 0.6, cx + dx - 2, bottom - h);
    c.stroke();
  }
  c.restore();
}

/**
 * 背景（壁・ボケ玉・机・模様）を描く。ぼけは filter が使えるときだけ強める。
 * @param c 2D コンテキスト
 * @param scene 背景
 * @param rnd 決まった乱数
 * @sideEffect canvas に描く
 */
function paintScene(c: Ctx, scene: Scene, rnd: Rand): void { // audit-ignore: fnlog-missing 写真を作るときに1回呼ぶ（photoCanvas でまとめてログ）
  const hz = scene.horizon;
  c.fillStyle = lin(c, 0, 0, 0, hz, [[0, scene.wall[0]], [1, scene.wall[1]]]);
  c.fillRect(0, 0, S, hz + 2);
  c.save();
  c.filter = 'blur(3px)';
  if (scene.kind === 'tile') {
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = 2;
    for (let x = 8; x < S; x += 22) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, hz);
      c.stroke();
    }
    for (let y = 10; y < hz; y += 22) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(S, y);
      c.stroke();
    }
  }
  for (let k = 0; k < 9; k++) {
    const x = rnd() * S;
    const y = rnd() * hz * 0.95;
    const r = 6 + rnd() * 14;
    const color = scene.bokeh[k % scene.bokeh.length] ?? '#ffffff';
    ell(c, x, y, r, r, rad(c, x, y, 0, x, y, r, [[0, rgba(color, 0.55)], [0.7, rgba(color, 0.35)], [1, rgba(color, 0)]]));
  }
  c.restore();
  c.fillStyle = lin(c, 0, hz, 0, S, [[0, scene.table[0]], [1, scene.table[1]]]);
  c.fillRect(0, hz, S, S - hz);
  paintTableTexture(c, scene, rnd);
  // 壁と机の境を少しぼかす
  c.fillStyle = lin(c, 0, hz - 6, 0, hz + 8, [[0, 'rgba(0,0,0,0)'], [0.5, 'rgba(0,0,0,0.18)'], [1, 'rgba(0,0,0,0)']]);
  c.fillRect(0, hz - 6, S, 14);
}

/**
 * 机の模様（木目・大理石の筋・布の織り目）。
 * @param c 2D コンテキスト
 * @param scene 背景
 * @param rnd 決まった乱数
 * @sideEffect canvas に描く
 */
function paintTableTexture(c: Ctx, scene: Scene, rnd: Rand): void { // audit-ignore: fnlog-missing 写真を作るときに1回呼ぶ
  const hz = scene.horizon;
  c.save();
  c.filter = 'blur(0.8px)';
  if (scene.kind === 'wood' && scene.grain !== undefined) {
    for (let k = 0; k < 14; k++) {
      const y = hz + 4 + rnd() * (S - hz);
      c.strokeStyle = rgba(scene.grain, 0.18 + rnd() * 0.18);
      c.lineWidth = 0.8 + rnd() * 1.6;
      c.beginPath();
      c.moveTo(-10, y);
      c.bezierCurveTo(50, y + (rnd() - 0.5) * 8, 110, y + (rnd() - 0.5) * 8, S + 10, y + (rnd() - 0.5) * 6);
      c.stroke();
    }
  } else if (scene.kind === 'marble') {
    for (let k = 0; k < 5; k++) {
      const y = hz + rnd() * (S - hz);
      c.strokeStyle = `rgba(150,150,160,${0.12 + rnd() * 0.12})`;
      c.lineWidth = 0.6 + rnd();
      c.beginPath();
      c.moveTo(-10, y);
      c.bezierCurveTo(40, y - 20 * rnd(), 100, y + 20 * rnd(), S + 10, y - 10);
      c.stroke();
    }
  } else if (scene.kind === 'cloth') {
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 1;
    for (let y = hz + 3; y < S; y += 3) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(S, y);
      c.stroke();
    }
  }
  c.restore();
}

/**
 * 仕上げ（左上からの光・周辺減光・写真の粒子）。
 * @param c 2D コンテキスト
 * @param rnd 決まった乱数
 * @sideEffect canvas に描く
 */
function finish(c: Ctx, rnd: Rand): void { // audit-ignore: fnlog-missing 写真を作るときに1回呼ぶ
  c.fillStyle = lin(c, 0, 0, S, S, [[0, 'rgba(255,248,235,0.22)'], [0.45, 'rgba(255,248,235,0)'], [1, 'rgba(0,0,0,0.12)']]);
  c.fillRect(0, 0, S, S);
  c.fillStyle = rad(c, S / 2, S * 0.55, S * 0.3, S / 2, S * 0.55, S * 0.78, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.42)']]);
  c.fillRect(0, 0, S, S);
  for (let k = 0; k < 420; k++) {
    c.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    c.fillRect(rnd() * S, rnd() * S, 1, 1);
  }
}

// ---------------------------------------------------------------------------
// 器（皿・どんぶり・カップ）
// ---------------------------------------------------------------------------

/**
 * 皿（白い丸皿を斜めから）。
 * @param c 2D コンテキスト
 * @param cx 中心x
 * @param cy 中心y
 * @param rx 横の半径
 * @param ry 縦の半径
 * @param color 皿の色
 * @sideEffect canvas に描く
 */
function plate(c: Ctx, cx: number, cy: number, rx: number, ry: number, color = '#f7f5f1'): void { // audit-ignore: fnlog-missing 絵を描くときに呼ぶヘルパー
  shadow(c, cx + 4, cy + ry * 0.5, rx * 1.05, ry * 0.9, 0.45);
  ell(c, cx, cy + 2, rx, ry, shade(color, -0.25));
  ell(c, cx, cy, rx, ry, lin(c, cx - rx, cy - ry, cx + rx, cy + ry, [[0, shade(color, 0.3)], [0.6, color], [1, shade(color, -0.18)]]));
  ell(c, cx, cy + 1, rx * 0.72, ry * 0.68, lin(c, 0, cy - ry, 0, cy + ry, [[0, shade(color, -0.12)], [1, shade(color, 0.12)]]));
  gloss(c, cx - rx * 0.55, cy - ry * 0.35, rx * 0.22, ry * 0.18, 0.7, -0.2);
}

/**
 * どんぶり・茶わん（斜めから。中身は inner で塗る）。
 * @param c 2D コンテキスト
 * @param cx 中心x
 * @param rimY ふちのy
 * @param rx ふちの横の半径
 * @param ry ふちの縦の半径
 * @param depth 深さ
 * @param color 器の色
 * @param inner 中身の塗り
 * @sideEffect canvas に描く
 */
function bowl(c: Ctx, cx: number, rimY: number, rx: number, ry: number, depth: number, color: string, inner: string | CanvasGradient): void { // audit-ignore: fnlog-missing 絵を描くときに呼ぶヘルパー
  shadow(c, cx + 5, rimY + depth + 2, rx * 0.9, ry * 0.8, 0.5);
  c.beginPath();
  c.moveTo(cx - rx, rimY);
  c.bezierCurveTo(cx - rx, rimY + depth * 0.95, cx - rx * 0.4, rimY + depth * 1.08, cx, rimY + depth * 1.08);
  c.bezierCurveTo(cx + rx * 0.4, rimY + depth * 1.08, cx + rx, rimY + depth * 0.95, cx + rx, rimY);
  c.closePath();
  c.fillStyle = lin(c, cx - rx, 0, cx + rx, 0, [[0, shade(color, -0.45)], [0.25, shade(color, 0.25)], [0.6, color], [1, shade(color, -0.55)]]);
  c.fill();
  ell(c, cx, rimY, rx, ry, shade(color, 0.35));
  ell(c, cx, rimY + 1, rx * 0.93, ry * 0.8, inner);
  gloss(c, cx - rx * 0.62, rimY + depth * 0.45, rx * 0.12, depth * 0.32, 0.45, 0.15);
}

/**
 * カップ・湯のみ（斜めから。中身は inner で塗る）。
 * @param c 2D コンテキスト
 * @param cx 中心x
 * @param rimY ふちのy
 * @param rx ふちの横の半径
 * @param h 高さ
 * @param color 器の色
 * @param inner 中身の塗り
 * @param bottomRatio 底の幅の割合
 * @sideEffect canvas に描く
 */
function cup(c: Ctx, cx: number, rimY: number, rx: number, h: number, color: string, inner: string | CanvasGradient, bottomRatio = 0.72): void { // audit-ignore: fnlog-missing 絵を描くときに呼ぶヘルパー
  const ry = rx * 0.28;
  const bx = rx * bottomRatio;
  shadow(c, cx + 6, rimY + h + 2, rx * 1.05, ry * 1.1, 0.5);
  c.beginPath();
  c.moveTo(cx - rx, rimY);
  c.lineTo(cx - bx, rimY + h - ry * 0.6);
  c.quadraticCurveTo(cx, rimY + h + ry * 0.8, cx + bx, rimY + h - ry * 0.6);
  c.lineTo(cx + rx, rimY);
  c.closePath();
  c.fillStyle = lin(c, cx - rx, 0, cx + rx, 0, [[0, shade(color, -0.4)], [0.28, shade(color, 0.3)], [0.62, color], [1, shade(color, -0.5)]]);
  c.fill();
  ell(c, cx, rimY, rx, ry, shade(color, 0.4));
  ell(c, cx, rimY + 1, rx * 0.88, ry * 0.72, inner);
  gloss(c, cx - rx * 0.55, rimY + h * 0.45, rx * 0.1, h * 0.3, 0.55, 0.12);
}

/**
 * 串（木の棒）。
 * @param c 2D コンテキスト
 * @param x0 始点x
 * @param y0 始点y
 * @param x1 終点x
 * @param y1 終点y
 * @param w 太さ
 * @sideEffect canvas に描く
 */
function stick(c: Ctx, x0: number, y0: number, x1: number, y1: number, w = 3): void { // audit-ignore: fnlog-missing 絵を描くときに呼ぶヘルパー
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = lin(c, x0, y0, x1, y1, [[0, '#c9a06a'], [1, '#e8cc98']]);
  c.lineWidth = w;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
  c.restore();
}

/**
 * 揚げ物の衣（きつね色の塊にパン粉のざらざら）。
 * @param c 2D コンテキスト
 * @param rnd 決まった乱数
 * @param cx 中心x
 * @param cy 中心y
 * @param rx 横の半径
 * @param ry 縦の半径
 * @param rot 回転
 * @sideEffect canvas に描く
 */
function fried(c: Ctx, rnd: Rand, cx: number, cy: number, rx: number, ry: number, rot = 0): void { // audit-ignore: fnlog-missing 絵を描くときに呼ぶヘルパー
  ell(c, cx, cy, rx, ry, rad(c, cx - rx * 0.3, cy - ry * 0.4, 1, cx, cy, Math.max(rx, ry), [[0, '#f2c46c'], [0.55, '#d4913f'], [1, '#8f4f1c']]), rot);
  speckle(c, rnd, Math.round(rx * ry * 0.35), cx, cy, rx * 0.92, ry * 0.88, ['#f7d58a', '#b8702c', '#e3a650', '#7a3e14'], [0.7, 1.7]);
  gloss(c, cx - rx * 0.3, cy - ry * 0.45, rx * 0.35, ry * 0.2, 0.35);
}

// ---------------------------------------------------------------------------
// 被写体（45種）
// ---------------------------------------------------------------------------

/** 1枚の写真の描き方（背景と被写体） */
interface PhotoPlan {
  readonly scene: SceneName;
  /** 被写体を拡大する倍率（小さく表示しても分かるように。既定 1.12） */
  readonly zoom?: number;
  readonly paint: (c: Ctx, rnd: Rand) => void;
}

/** 看板商品ごとの写真 */
const PLANS: Readonly<Record<GoodsIcon, PhotoPlan>> = {
  /** コーヒー（受け皿つきの白いカップ、湯気） */
  coffee: {
    scene: 'cafe',
    paint: (c) => {
      plate(c, 80, 124, 60, 18);
      cup(c, 78, 74, 36, 44, '#f4f1ec', rad(c, 72, 72, 2, 78, 75, 32, [[0, '#8a5532'], [0.55, '#4a2814'], [0.85, '#2c170b'], [1, '#c79063']]));
      c.save();
      c.lineWidth = 7;
      c.strokeStyle = lin(c, 108, 80, 124, 110, [[0, '#ffffff'], [1, '#bdb6ad']]);
      c.beginPath();
      c.ellipse(114, 94, 10, 13, 0, -1.3, 1.5);
      c.stroke();
      c.restore();
      steam(c, 78, 64, 46);
    },
  },
  /** 厚焼き玉子サンド（白い皿、断面の黄色い玉子） */
  sandwich: {
    scene: 'cafe',
    paint: (c, r) => {
      plate(c, 80, 120, 64, 20);
      /**
       * サンドイッチの断面を1切れ描く（耳・パン・厚焼き玉子）。
       * @param x 左
       * @param y 上
       * @param w 幅
       * @param h 高さ
       * @param dark 奥のものを暗くする量
       * @sideEffect canvas に描く
       */
      const slice = (x: number, y: number, w: number, h: number, dark: number): void => { // audit-ignore: fnlog-missing 絵の部品
        rr(c, x - 3, y - 3, w + 6, h + 6, 7, shade('#c98b4b', -dark));
        rr(c, x, y, w, h * 0.3, 4, lin(c, 0, y, 0, y + h * 0.3, [[0, shade('#fffaf0', -dark)], [1, shade('#eadcc4', -dark)]]));
        c.fillStyle = lin(c, 0, y + h * 0.3, 0, y + h * 0.72, [[0, shade('#ffd95a', -dark)], [1, shade('#eca52a', -dark)]]);
        c.fillRect(x, y + h * 0.3, w, h * 0.42);
        speckle(c, r, 24, x + w / 2, y + h * 0.51, w * 0.48, h * 0.18, [shade('#fff1a8', -dark), shade('#e6a12e', -dark)], [0.6, 1.4]);
        rr(c, x, y + h * 0.72, w, h * 0.28, 4, lin(c, 0, y + h * 0.72, 0, y + h, [[0, shade('#f4ead6', -dark)], [1, shade('#dccbb0', -dark)]]));
      };
      slice(70, 54, 52, 52, 0.18);
      slice(34, 66, 62, 60, 0);
      gloss(c, 50, 74, 14, 4, 0.5, 0);
    },
  },
  /** どら焼き（ふっくらきつね色の皮、間に粒あん） */
  dorayaki: {
    scene: 'washi',
    paint: (c, r) => {
      shadow(c, 86, 128, 56, 14, 0.5);
      ell(c, 92, 100, 46, 22, '#a65a22');
      ell(c, 92, 92, 46, 22, rad(c, 82, 84, 4, 92, 92, 48, [[0, '#f2b766'], [0.6, '#c9772f'], [1, '#8f4512']]));
      gloss(c, 80, 84, 18, 6, 0.4, -0.1);
      ell(c, 62, 122, 44, 14, '#b4682a');
      ell(c, 62, 114, 42, 12, rad(c, 62, 112, 2, 62, 114, 42, [[0, '#6f2c24'], [1, '#33110d']]));
      speckle(c, r, 40, 62, 114, 40, 9, ['#8a3c2e', '#5a1e18', '#a24e3a'], [1, 2.2]);
      ell(c, 62, 104, 44, 13, rad(c, 52, 98, 3, 62, 104, 46, [[0, '#f5be6e'], [0.6, '#cf7d33'], [1, '#93480f']]));
      gloss(c, 50, 99, 16, 4, 0.45, -0.08);
    },
  },
  /** 三色団子（桃・白・緑の玉を串に） */
  dango: {
    scene: 'redcloth',
    zoom: 1.12,
    paint: (c) => {
      shadow(c, 84, 132, 48, 10, 0.45);
      stick(c, 36, 146, 126, 22, 4);
      sphere(c, 60, 112, 22, '#9cc26a', 0.4);
      sphere(c, 80, 85, 22, '#f8f4e8', 0.5);
      sphere(c, 100, 58, 22, '#f2a6b8', 0.5);
    },
  },
  /** パン（塩をふったクロワッサン） */
  bread: {
    scene: 'washi',
    paint: (c, r) => {
      shadow(c, 82, 124, 60, 14, 0.5);
      const lobes: readonly [number, number, number, number][] = [
        [34, 108, 16, 12],
        [52, 96, 20, 17],
        [80, 90, 25, 22],
        [108, 96, 20, 17],
        [126, 108, 16, 12],
      ];
      for (const [x, y, rx, ry] of lobes) {
        ell(c, x, y + 4, rx, ry, '#8f4b18');
        ell(c, x, y, rx, ry, rad(c, x - rx * 0.3, y - ry * 0.5, 1, x, y, Math.max(rx, ry) * 1.05, [[0, '#f6cf86'], [0.5, '#d9913f'], [1, '#9a5318']]));
        gloss(c, x - rx * 0.25, y - ry * 0.45, rx * 0.4, ry * 0.18, 0.45, -0.1);
      }
      speckle(c, r, 26, 80, 90, 56, 14, ['#ffffff', '#f4f1ea'], [0.8, 1.5]);
    },
  },
  /** たこ焼き（舟皿にソース・マヨ・青のり・かつお節） */
  takoyaki: {
    scene: 'izakaya',
    paint: (c, r) => {
      shadow(c, 82, 132, 66, 14, 0.55);
      poly(c, [14, 104, 146, 104, 134, 136, 26, 136], lin(c, 0, 104, 0, 136, [[0, '#f0d6a8'], [1, '#c79e64']]));
      poly(c, [14, 104, 146, 104, 140, 110, 20, 110], '#f8e6c2');
      const balls: readonly [number, number][] = [[44, 86], [80, 82], [116, 86], [60, 104], [100, 104]];
      for (const [x, y] of balls) {
        sphere(c, x, y, 19, '#c0782f', 0);
        ell(c, x, y - 4, 17, 13, rad(c, x - 5, y - 9, 1, x, y - 4, 18, [[0, '#7a3a16'], [1, '#3a1407']]));
        gloss(c, x - 6, y - 10, 6, 2.5, 0.75, -0.2);
      }
      c.save();
      c.strokeStyle = 'rgba(255,250,235,0.95)';
      c.lineWidth = 2.2;
      c.beginPath();
      for (let k = 0; k <= 10; k++) c.lineTo(26 + k * 11, 82 + (k % 2 === 0 ? -8 : 10));
      c.stroke();
      c.restore();
      speckle(c, r, 60, 80, 90, 56, 18, ['#3f7a2a', '#5a9a34'], [0.6, 1.2]);
      speckle(c, r, 18, 80, 84, 50, 14, ['#e9b88a', '#d9926a', '#f4d2b0'], [1.5, 3]);
    },
  },
  /** 本（古書を3冊積んだところ） */
  book: {
    scene: 'shelf',
    paint: (c) => {
      shadow(c, 82, 136, 64, 10, 0.55);
      const books: readonly [number, number, number, string][] = [
        [22, 112, 118, '#6b2e2a'],
        [30, 92, 104, '#2f4f6b'],
        [26, 74, 108, '#5a6b3a'],
      ];
      for (const [x, y, w, color] of books) {
        const h = 18;
        poly(c, [x, y, x + w, y, x + w + 10, y - 6, x + 10, y - 6], shade(color, 0.15));
        c.fillStyle = lin(c, 0, y, 0, y + h, [[0, shade(color, 0.2)], [0.5, color], [1, shade(color, -0.45)]]);
        c.fillRect(x, y, w, h);
        poly(c, [x + w, y, x + w + 10, y - 6, x + w + 10, y + h - 6, x + w, y + h], lin(c, 0, y, 0, y + h, [[0, '#f3ead4'], [1, '#cdbf9d']]));
        c.fillStyle = 'rgba(214,176,92,0.85)';
        c.fillRect(x + 10, y + 4, 3, h - 8);
        c.fillRect(x + w - 16, y + 4, 3, h - 8);
        gloss(c, x + w * 0.35, y + 4, w * 0.3, 2, 0.3, 0);
      }
    },
  },
  /** 徳利とおちょこ（白い磁器に藍の線） */
  sake: {
    scene: 'izakaya',
    zoom: 1.22,
    paint: (c) => {
      shadow(c, 74, 134, 40, 10, 0.55);
      c.beginPath();
      c.moveTo(64, 30);
      c.lineTo(84, 30);
      c.bezierCurveTo(84, 48, 80, 54, 88, 64);
      c.bezierCurveTo(112, 92, 108, 128, 74, 134);
      c.bezierCurveTo(40, 128, 36, 92, 60, 64);
      c.bezierCurveTo(68, 54, 64, 48, 64, 30);
      c.closePath();
      c.fillStyle = lin(c, 36, 0, 110, 0, [[0, '#b9b4ac'], [0.3, '#ffffff'], [0.65, '#ece8e1'], [1, '#9e978c']]);
      c.fill();
      ell(c, 74, 30, 11, 3, '#e8e3dc');
      c.fillStyle = 'rgba(40,70,140,0.85)';
      c.fillRect(48, 96, 52, 4);
      c.fillRect(52, 104, 44, 2);
      gloss(c, 58, 96, 4, 18, 0.7, 0.1);
      cup(c, 124, 112, 16, 16, '#f2eee8', rad(c, 124, 112, 1, 124, 112, 14, [[0, '#f6f0d8'], [1, '#d9cfa8']]), 0.6);
    },
  },
  /** コロッケ（きつね色の衣、千切りキャベツ） */
  croquette: {
    scene: 'market',
    zoom: 1.18,
    paint: (c, r) => {
      plate(c, 80, 118, 66, 22, '#fbfaf6');
      c.save();
      c.strokeStyle = '#a8d06a';
      c.lineWidth = 1.6;
      for (let k = 0; k < 26; k++) {
        const x = 22 + r() * 34;
        const y = 98 + r() * 22;
        c.beginPath();
        c.moveTo(x, y);
        c.quadraticCurveTo(x + 8, y - 6 + r() * 4, x + 16, y + r() * 4 - 2);
        c.stroke();
      }
      c.restore();
      fried(c, r, 100, 102, 30, 18, -0.15);
      fried(c, r, 70, 112, 32, 19, 0.1);
    },
  },
  /** 着物（赤地に桜模様、金の帯） */
  kimono: {
    scene: 'washi',
    zoom: 1,
    paint: (c, r) => {
      shadow(c, 82, 138, 56, 8, 0.4);
      c.save();
      c.beginPath();
      c.moveTo(80, 26);
      c.lineTo(148, 40);
      c.lineTo(146, 82);
      c.lineTo(112, 80);
      c.lineTo(114, 138);
      c.lineTo(46, 138);
      c.lineTo(48, 80);
      c.lineTo(14, 82);
      c.lineTo(12, 40);
      c.closePath();
      c.fillStyle = lin(c, 12, 0, 148, 0, [[0, '#7a1218'], [0.3, '#c8303a'], [0.55, '#b0222c'], [0.8, '#d43a44'], [1, '#6e1016']]);
      c.fill();
      c.clip();
      for (let k = 0; k < 22; k++) {
        const x = 14 + r() * 132;
        const y = 34 + r() * 100;
        for (let p = 0; p < 5; p++) ell(c, x + Math.cos((p / 5) * Math.PI * 2) * 3, y + Math.sin((p / 5) * Math.PI * 2) * 3, 2.4, 1.6, 'rgba(255,235,240,0.85)', (p / 5) * Math.PI * 2);
        ell(c, x, y, 1, 1, '#f7c84a');
      }
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(46, 80, 4, 58);
      c.fillRect(110, 80, 4, 58);
      c.restore();
      poly(c, [64, 28, 80, 30, 96, 28, 82, 72, 78, 72], '#f8f4ea');
      poly(c, [70, 30, 80, 32, 90, 30, 80, 64], '#b0222c');
      c.fillStyle = lin(c, 0, 88, 0, 108, [[0, '#f6d77a'], [0.5, '#c99a32'], [1, '#8e6a1c']]);
      c.fillRect(46, 88, 68, 20);
      c.fillStyle = 'rgba(120,60,20,0.35)';
      c.fillRect(46, 97, 68, 2);
      gloss(c, 66, 92, 18, 3, 0.45, 0);
    },
  },
  /** うどん（太い白い麺、かまぼこ、ねぎ、湯気） */
  udon: {
    scene: 'washi',
    paint: (c, r) => {
      bowl(c, 80, 84, 62, 20, 46, '#5e3a26', rad(c, 76, 82, 4, 80, 85, 60, [[0, '#f0c77e'], [1, '#c48f44']]));
      c.save();
      c.beginPath();
      c.ellipse(80, 85, 56, 15, 0, 0, Math.PI * 2);
      c.clip();
      c.lineCap = 'round';
      for (let k = 0; k < 9; k++) {
        const y = 74 + k * 3;
        c.strokeStyle = k % 2 === 0 ? '#fbf6e8' : '#efe4c8';
        c.lineWidth = 6;
        c.beginPath();
        c.moveTo(28 + r() * 10, y + 4);
        c.bezierCurveTo(56, y - 8, 96, y + 12, 132 - r() * 10, y - 2);
        c.stroke();
      }
      c.restore();
      ell(c, 100, 78, 14, 6, '#f8f1ea');
      c.beginPath();
      c.ellipse(100, 78, 14, 6, 0, Math.PI, Math.PI * 2);
      c.fillStyle = '#e86a86';
      c.fill();
      speckle(c, r, 14, 62, 80, 14, 5, ['#6fb04a', '#9ad06a'], [1.5, 2.6]);
      steam(c, 80, 70, 40, 0.38); // audit-ignore: magic-radius 絵の座標（発見・訪問の距離ルールではない）
    },
  },
  /** 握り寿司（まぐろ・サーモン・玉子を下駄に） */
  sushi: {
    scene: 'izakaya',
    zoom: 1.12,
    paint: (c, r) => {
      shadow(c, 80, 134, 70, 12, 0.55);
      poly(c, [8, 112, 136, 96, 152, 118, 24, 138], lin(c, 0, 96, 0, 138, [[0, '#e8c690'], [1, '#c89a5e']]));
      poly(c, [24, 138, 152, 118, 152, 124, 24, 144], '#8a6236');
      /**
       * 握り寿司を1貫描く（しゃり・ネタ・筋・のり）。
       * @param x 中心x
       * @param y 中心y
       * @param top ネタの色
       * @param stripe ネタの筋の色（無ければ undefined）
       * @param nori のりを巻くか
       * @sideEffect canvas に描く
       */
      const nigiri = (x: number, y: number, top: string, stripe: string | undefined, nori: boolean): void => { // audit-ignore: fnlog-missing 絵の部品
        ell(c, x, y + 6, 20, 10, '#e9e5dc');
        speckle(c, r, 20, x, y + 6, 18, 8, ['#ffffff', '#d8d3c8'], [1, 2]);
        ell(c, x, y - 2, 23, 11, rad(c, x - 6, y - 6, 1, x, y - 2, 24, [[0, shade(top, 0.35)], [0.6, top], [1, shade(top, -0.35)]]), -0.12);
        if (stripe !== undefined) {
          c.save();
          c.strokeStyle = stripe;
          c.lineWidth = 1.6;
          for (let k = -2; k <= 2; k++) {
            c.beginPath();
            c.moveTo(x + k * 7 - 6, y - 10);
            c.lineTo(x + k * 7 + 4, y + 6);
            c.stroke();
          }
          c.restore();
        }
        if (nori) {
          c.fillStyle = '#1e2a22';
          c.fillRect(x - 4, y - 12, 8, 24);
        }
        gloss(c, x - 8, y - 7, 9, 2.5, 0.7, -0.15);
      };
      nigiri(46, 104, '#c42a38', undefined, false);
      nigiri(84, 98, '#f2894a', 'rgba(255,235,220,0.85)', false);
      nigiri(122, 92, '#f6cf48', undefined, true);
    },
  },
  /** ギフト（赤い箱に金のリボン） */
  gift: {
    scene: 'shop',
    zoom: 1.05,
    paint: (c) => {
      shadow(c, 84, 136, 56, 10, 0.5);
      poly(c, [30, 70, 108, 70, 134, 56, 56, 56], lin(c, 0, 56, 0, 70, [[0, '#f0605a'], [1, '#d63a3a']]));
      c.fillStyle = lin(c, 30, 0, 108, 0, [[0, '#a8242a'], [0.4, '#dc3c3c'], [1, '#b82a2e']]);
      c.fillRect(30, 70, 78, 64);
      poly(c, [108, 70, 134, 56, 134, 118, 108, 134], lin(c, 108, 0, 134, 0, [[0, '#8e1c22'], [1, '#6e1418']]));
      c.fillStyle = lin(c, 62, 0, 76, 0, [[0, '#c9952e'], [0.5, '#ffe28a'], [1, '#b8862a']]);
      c.fillRect(62, 70, 14, 64);
      poly(c, [62, 70, 76, 70, 102, 56, 88, 56], '#f6d36a');
      poly(c, [108, 94, 134, 80, 134, 90, 108, 104], '#c9952e');
      for (const [dx, rot] of [[-16, -0.5], [16, 0.5]] as const) ell(c, 82 + dx, 54, 16, 9, rad(c, 82 + dx, 50, 1, 82 + dx, 54, 16, [[0, '#ffeaa0'], [1, '#c08a28']]), rot);
      sphere(c, 82, 56, 6, '#e6b443', 0.6);
      gloss(c, 44, 82, 6, 18, 0.35, 0.1);
    },
  },
  /** 野菜（大根・にんじん・トマト） */
  veggie: {
    scene: 'market',
    paint: (c) => {
      shadow(c, 80, 134, 70, 12, 0.5);
      c.save();
      c.translate(80, 96);
      c.rotate(-0.5);
      rr(c, -56, -12, 104, 24, 12, lin(c, 0, -12, 0, 12, [[0, '#ffffff'], [0.5, '#f1efe6'], [1, '#c8c4b4']]));
      for (const a of [-0.5, 0, 0.5]) ell(c, 58 + Math.cos(a) * 10, Math.sin(a) * 10, 16, 6, '#5e9a3a', a);
      c.restore();
      for (const [x, y, rot] of [[54, 118, 0.35], [70, 124, 0.15]] as const) {
        c.save();
        c.translate(x, y);
        c.rotate(rot);
        poly(c, [-6, -30, 6, -30, 0, 26], lin(c, -6, 0, 6, 0, [[0, '#c9561c'], [0.4, '#ff9a3c'], [1, '#c44e16']]));
        ell(c, 0, -34, 4, 7, '#4f8a2e');
        c.restore();
      }
      sphere(c, 114, 116, 17, '#e0332c', 0.7);
      sphere(c, 134, 104, 13, '#e64a32', 0.7);
      ell(c, 114, 100, 6, 2.5, '#3f7a24');
    },
  },
  /** 日本茶（緑の湯のみ、茶葉） */
  tea: {
    scene: 'washi',
    zoom: 1.34,
    paint: (c, r) => {
      cup(c, 80, 66, 34, 56, '#8a9a86', rad(c, 74, 63, 2, 80, 66, 30, [[0, '#e8f09a'], [0.6, '#a8c03a'], [1, '#5e7a1e']]), 0.82);
      c.save();
      c.fillStyle = 'rgba(210,220,190,0.25)';
      for (let k = 0; k < 6; k++) c.fillRect(50 + k * 10, 78 + (k % 2) * 6, 3, 30 + (k % 3) * 6);
      c.restore();
      speckle(c, r, 10, 126, 126, 18, 5, ['#3f6a2a', '#5a8a3a'], [2, 3.4]);
      steam(c, 80, 58, 40, 0.35); // audit-ignore: magic-radius 絵の座標（発見・訪問の距離ルールではない）
    },
  },
  /** 串カツ（衣の串を3本、ソースつぼ） */
  kushikatsu: {
    scene: 'izakaya',
    zoom: 1.1,
    paint: (c, r) => {
      shadow(c, 80, 134, 64, 10, 0.5);
      rr(c, 16, 112, 128, 20, 8, lin(c, 0, 112, 0, 132, [[0, '#e6e8ec'], [1, '#9aa0a8']]));
      for (const [x, rot] of [[50, -0.3], [80, 0], [110, 0.3]] as const) {
        c.save();
        c.translate(x, 74);
        c.rotate(rot);
        stick(c, 0, 18, 0, 58, 3);
        fried(c, r, 0, -18, 15, 17);
        fried(c, r, 0, 12, 14, 15);
        c.restore();
      }
      cup(c, 134, 92, 13, 22, '#c8ccd2', rad(c, 134, 92, 1, 134, 92, 12, [[0, '#5a2a14'], [1, '#2a1006']]), 0.9);
    },
  },
  /** 鮮魚（氷の上の青魚） */
  fish: {
    scene: 'market',
    zoom: 1.05,
    paint: (c, r) => {
      ell(c, 80, 118, 72, 22, '#e6f1f6');
      speckle(c, r, 70, 80, 118, 68, 18, ['#ffffff', '#cfe4ee', '#b4d2e0'], [1.5, 3.5]);
      shadow(c, 80, 110, 60, 10, 0.3);
      c.beginPath();
      c.moveTo(20, 92);
      c.bezierCurveTo(44, 62, 104, 62, 126, 88);
      c.lineTo(150, 72);
      c.lineTo(144, 94);
      c.lineTo(150, 114);
      c.lineTo(126, 98);
      c.bezierCurveTo(104, 118, 44, 120, 20, 92);
      c.closePath();
      c.fillStyle = lin(c, 0, 66, 0, 116, [[0, '#2e4c6e'], [0.42, '#6a8eae'], [0.55, '#dfe8ee'], [1, '#f5f7f8']]);
      c.fill();
      c.save();
      c.clip();
      c.strokeStyle = 'rgba(30,50,80,0.45)';
      c.lineWidth = 1.2;
      for (let k = 0; k < 7; k++) {
        c.beginPath();
        c.moveTo(44 + k * 11, 70);
        c.quadraticCurveTo(50 + k * 11, 78, 44 + k * 11, 86);
        c.stroke();
      }
      gloss(c, 70, 82, 40, 4, 0.55, 0);
      c.restore();
      ell(c, 36, 88, 5, 5, '#f4f4f0');
      ell(c, 36, 88, 3, 3, '#141414');
      ell(c, 35, 87, 1, 1, '#ffffff');
      c.strokeStyle = 'rgba(180,60,60,0.6)';
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(48, 92, 9, -1, 1);
      c.stroke();
    },
  },
  /** 餃子（焼き目のついた餃子を皿に） */
  gyoza: {
    scene: 'izakaya',
    zoom: 1.18,
    paint: (c) => {
      plate(c, 80, 112, 68, 24, '#f4f2ee');
      for (let k = 0; k < 5; k++) {
        const x = 34 + k * 23;
        const y = 102 + Math.abs(k - 2) * 2;
        c.beginPath();
        c.ellipse(x, y, 13, 20, 0.35, Math.PI * 0.95, Math.PI * 2.05);
        c.closePath();
        c.fillStyle = rad(c, x - 4, y - 8, 1, x, y, 22, [[0, '#fff6e0'], [0.7, '#eedcb4'], [1, '#c99a5c']]);
        c.fill();
        ell(c, x + 6, y + 9, 10, 5, rad(c, x + 6, y + 9, 1, x + 6, y + 9, 11, [[0, '#a8601e'], [1, '#6e3a12']]), 0.35);
        c.strokeStyle = 'rgba(160,120,70,0.5)';
        c.lineWidth = 1;
        for (let p = 0; p < 3; p++) {
          c.beginPath();
          c.moveTo(x - 8 + p * 4, y - 12 + p * 3);
          c.lineTo(x - 4 + p * 4, y - 6 + p * 3);
          c.stroke();
        }
        gloss(c, x - 4, y - 6, 4, 8, 0.5, 0.35);
      }
    },
  },
  /** お好み焼き（鉄板の上、ソース・マヨの格子・青のり・かつお節） */
  okonomiyaki: {
    scene: 'izakaya',
    zoom: 1.05,
    paint: (c, r) => {
      c.fillStyle = lin(c, 0, 80, 0, 160, [[0, '#2a2a2e'], [1, '#4a4a50']]);
      c.fillRect(0, 84, S, 76);
      speckle(c, r, 20, 80, 120, 80, 36, ['rgba(255,255,255,0.08)'], [2, 5]);
      shadow(c, 82, 118, 64, 16, 0.6);
      ell(c, 80, 112, 62, 24, '#8a4a18');
      ell(c, 80, 106, 60, 22, rad(c, 70, 100, 2, 80, 106, 60, [[0, '#6a2c10'], [0.85, '#3a1406'], [1, '#a8682c']]));
      c.save();
      c.beginPath();
      c.ellipse(80, 106, 54, 19, 0, 0, Math.PI * 2);
      c.clip();
      c.strokeStyle = 'rgba(255,248,230,0.92)';
      c.lineWidth = 2;
      for (let k = -6; k <= 6; k++) {
        c.beginPath();
        c.moveTo(80 + k * 12 - 24, 84);
        c.lineTo(80 + k * 12 + 24, 128);
        c.stroke();
        c.beginPath();
        c.moveTo(80 + k * 12 + 24, 84);
        c.lineTo(80 + k * 12 - 24, 128);
        c.stroke();
      }
      c.restore();
      speckle(c, r, 50, 80, 104, 50, 16, ['#3f7a2a', '#5a9a34'], [0.6, 1.2]);
      speckle(c, r, 22, 84, 100, 40, 12, ['#e9b88a', '#d9926a', '#f4d2b0'], [2, 3.5]);
      gloss(c, 60, 98, 18, 4, 0.4, -0.1);
    },
  },
  /** 漬物（藍の小鉢に、たくあん・しば漬け・きゅうり） */
  pickles: {
    scene: 'washi',
    zoom: 1.22,
    paint: (c, r) => {
      bowl(c, 80, 96, 50, 16, 34, '#2c4a7a', rad(c, 80, 96, 2, 80, 97, 46, [[0, '#f4f0e6'], [1, '#d8d2c4']]));
      for (let k = 0; k < 5; k++) {
        const x = 52 + k * 9;
        const y = 92 - k * 1.5;
        ell(c, x, y, 12, 10, '#c8981a', -0.5);
        ell(c, x - 1, y - 1, 11, 9, rad(c, x - 4, y - 4, 1, x, y, 12, [[0, '#fff49a'], [0.7, '#f2cf2a'], [1, '#d8a818']]), -0.5);
      }
      for (let k = 0; k < 10; k++) {
        const x = 96 + r() * 18;
        const y = 84 + r() * 14;
        ell(c, x, y, 6, 4.5, rad(c, x - 2, y - 2, 0, x, y, 6, [[0, '#d860a0'], [1, '#6e1a48']]), r() * 3);
      }
      for (const [x, y] of [[90, 100], [104, 102], [116, 96]] as const) {
        ell(c, x, y, 8, 5.5, '#2f6a22');
        ell(c, x, y, 6.6, 4.4, rad(c, x - 2, y - 1, 0, x, y, 7, [[0, '#f0f8c0'], [1, '#b8d878']]));
        speckle(c, r, 5, x, y, 3, 2, ['#8aa84a'], [0.5, 0.9]);
      }
      gloss(c, 58, 86, 10, 2.5, 0.7, -0.4);
    },
  },
  /** 昆布（白い粉をふいた乾物を重ねて） */
  kombu: {
    scene: 'market',
    zoom: 1.08,
    paint: (c, r) => {
      shadow(c, 80, 132, 66, 10, 0.5);
      for (const [y, rot, tone] of [[112, -0.06, -0.1], [96, 0.05, 0], [80, -0.03, 0.06]] as const) {
        c.save();
        c.translate(80, y);
        c.rotate(rot);
        c.beginPath();
        c.moveTo(-64, -10);
        for (let x = -64; x <= 64; x += 16) c.quadraticCurveTo(x + 8, -16, x + 16, -10);
        c.lineTo(64, 12);
        for (let x = 64; x >= -64; x -= 16) c.quadraticCurveTo(x - 8, 18, x - 16, 12);
        c.closePath();
        c.fillStyle = lin(c, 0, -12, 0, 14, [[0, shade('#56603a', 0.12 + tone)], [0.5, shade('#2e3622', tone)], [1, shade('#1a2014', tone)]]);
        c.fill();
        speckle(c, r, 46, 0, 0, 60, 10, ['rgba(240,236,220,0.75)', 'rgba(220,216,200,0.5)'], [0.6, 1.6]);
        gloss(c, -10, -6, 40, 2, 0.25, 0);
        c.restore();
      }
    },
  },
  /** 定食（お盆にごはん・味噌汁・焼き魚） */
  teishoku: {
    scene: 'washi',
    zoom: 1.02,
    paint: (c, r) => {
      shadow(c, 82, 146, 76, 10, 0.5);
      poly(c, [8, 70, 152, 70, 160, 152, 0, 152], lin(c, 0, 70, 0, 152, [[0, '#3a1c10'], [1, '#1e0c06']]));
      poly(c, [12, 73, 148, 73, 155, 148, 5, 148], lin(c, 0, 73, 0, 148, [[0, '#7a3a22'], [1, '#4a1e10']]));
      plate(c, 82, 78, 44, 13, '#f2efe8');
      c.save();
      c.translate(82, 74);
      c.rotate(-0.06);
      rr(c, -32, -7, 64, 14, 7, lin(c, 0, -7, 0, 7, [[0, '#f8b48c'], [0.5, '#f0986c'], [1, '#c8603e']]));
      speckle(c, r, 14, 0, -2, 28, 4, ['#4a2210', '#7a3a1c'], [1, 2.4]);
      gloss(c, -8, -3, 18, 1.6, 0.6, 0);
      c.restore();
      bowl(c, 46, 112, 30, 10, 26, '#1e1a18', '#f4f2ea');
      c.beginPath();
      c.ellipse(46, 110, 26, 13, 0, Math.PI, Math.PI * 2);
      c.fillStyle = rad(c, 40, 100, 2, 46, 108, 28, [[0, '#ffffff'], [1, '#e0dcd0']]);
      c.fill();
      speckle(c, r, 40, 46, 104, 22, 7, ['#ebe7de', '#ffffff', '#d8d4c8'], [1, 1.9]);
      bowl(c, 116, 112, 28, 9, 24, '#6e1e16', rad(c, 116, 112, 2, 116, 112, 26, [[0, '#e0a868'], [1, '#9a6024']]));
      speckle(c, r, 10, 116, 112, 16, 4, ['#4a8a3a', '#f4f0e0', '#c8a060'], [1.2, 2.2]);
      steam(c, 116, 104, 30, 0.35);
    },
  },
  /** 焼き鳥（たれの照り、ねぎま、焦げ目） */
  yakitori: {
    scene: 'izakaya',
    paint: (c) => {
      shadow(c, 80, 132, 68, 10, 0.5);
      plate(c, 80, 120, 70, 18, '#2a2a2e');
      for (const [y, rot] of [[78, -0.08], [98, 0.02], [116, 0.1]] as const) {
        c.save();
        c.translate(80, y);
        c.rotate(rot);
        stick(c, -70, 0, 70, 0, 3);
        for (let k = 0; k < 4; k++) {
          const x = -42 + k * 26;
          if (k % 2 === 1) {
            rr(c, x - 8, -8, 16, 16, 5, lin(c, 0, -8, 0, 8, [[0, '#f4f2e0'], [0.5, '#c8d89a'], [1, '#7a9a4a']]));
          } else {
            rr(c, x - 12, -11, 24, 22, 8, rad(c, x - 4, -6, 1, x, 0, 16, [[0, '#c0702c'], [0.6, '#8a3c14'], [1, '#4a1a06']]));
            ell(c, x + 3, 3, 4, 3, 'rgba(30,10,0,0.55)');
            gloss(c, x - 5, -6, 6, 2, 0.75, -0.2);
          }
        }
        c.restore();
      }
    },
  },
  /** 台所道具（ふた付きの土鍋） */
  pot: {
    scene: 'shop',
    zoom: 1.15,
    paint: (c) => {
      shadow(c, 84, 136, 62, 12, 0.55);
      c.beginPath();
      c.moveTo(22, 96);
      c.bezierCurveTo(22, 132, 50, 140, 80, 140);
      c.bezierCurveTo(110, 140, 138, 132, 138, 96);
      c.closePath();
      c.fillStyle = lin(c, 22, 0, 138, 0, [[0, '#3a2418'], [0.28, '#8a5a3a'], [0.6, '#6a4028'], [1, '#2a180e']]);
      c.fill();
      ell(c, 80, 96, 58, 14, '#4a2e1e');
      c.beginPath();
      c.ellipse(80, 92, 54, 30, 0, Math.PI, Math.PI * 2);
      c.closePath();
      c.fillStyle = rad(c, 64, 72, 4, 80, 92, 60, [[0, '#c48a5a'], [0.5, '#8a5434'], [1, '#4a2a18']]);
      c.fill();
      sphere(c, 80, 60, 9, '#7a4a2e', 0.6);
      ell(c, 20, 104, 8, 5, '#5a3622');
      ell(c, 140, 104, 8, 5, '#3a2014');
      gloss(c, 60, 74, 16, 5, 0.5, -0.35);
      gloss(c, 40, 112, 4, 10, 0.4, 0.2);
    },
  },
  /** 銭湯（湯気の立つ木の桶とタイル） */
  bath: {
    scene: 'bath',
    zoom: 1.18,
    paint: (c) => {
      shadow(c, 84, 138, 54, 10, 0.4);
      c.beginPath();
      c.moveTo(34, 82);
      c.lineTo(42, 134);
      c.quadraticCurveTo(80, 144, 118, 134);
      c.lineTo(126, 82);
      c.closePath();
      c.fillStyle = lin(c, 34, 0, 126, 0, [[0, '#a8743e'], [0.3, '#f0c88a'], [0.65, '#d8a464'], [1, '#8a5a2a']]);
      c.fill();
      c.strokeStyle = 'rgba(120,80,40,0.35)';
      c.lineWidth = 1;
      for (let x = 44; x < 120; x += 9) {
        c.beginPath();
        c.moveTo(x, 84);
        c.lineTo(x + (x - 80) * 0.08, 136);
        c.stroke();
      }
      for (const y of [96, 124]) {
        c.fillStyle = lin(c, 34, 0, 126, 0, [[0, '#6a6e74'], [0.35, '#e2e6ea'], [1, '#5a5e64']]);
        c.fillRect(36 + (y - 82) * 0.15, y, 88 - (y - 82) * 0.3, 4);
      }
      ell(c, 80, 82, 46, 12, '#f2d29a');
      ell(c, 80, 83, 42, 10, rad(c, 72, 80, 2, 80, 83, 42, [[0, '#e8fbff'], [1, '#8ccbe4']]));
      gloss(c, 66, 80, 14, 3, 0.7, 0);
      steam(c, 80, 76, 56, 0.5); // audit-ignore: magic-radius 絵の座標（発見・訪問の距離ルールではない）
    },
  },
  /** 文具（削った色鉛筆3本） */
  pencil: {
    scene: 'shop',
    paint: (c) => {
      for (const [y, color] of [[78, '#f2c230'], [98, '#3f9a5a'], [118, '#d8403a']] as const) {
        c.save();
        c.translate(80, y);
        c.rotate(-0.35);
        shadow(c, 4, 12, 66, 5, 0.35);
        c.fillStyle = lin(c, 0, -7, 0, 7, [[0, shade(color, 0.35)], [0.35, color], [0.36, shade(color, -0.15)], [0.7, shade(color, -0.1)], [0.71, shade(color, -0.35)], [1, shade(color, -0.45)]]);
        c.fillRect(-52, -7, 92, 14);
        poly(c, [40, -7, 58, 0, 40, 7], lin(c, 40, -7, 40, 7, [[0, '#f6dcb0'], [1, '#c89a64']]));
        poly(c, [52, -2.4, 60, 0, 52, 2.4], shade(color, -0.3));
        c.fillStyle = lin(c, 0, -7, 0, 7, [[0, '#f4f4f6'], [0.5, '#a8acb4'], [1, '#6e7278']]);
        c.fillRect(-60, -7, 9, 14);
        rr(c, -70, -7, 12, 14, 3, lin(c, 0, -7, 0, 7, [[0, '#ffc2c8'], [1, '#e8828e']]));
        gloss(c, -10, -4, 30, 1.5, 0.55, 0);
        c.restore();
      }
    },
  },
  /** 豆腐（黒い器に白い豆腐、ねぎとしょうが） */
  tofu: {
    scene: 'washi',
    zoom: 1.22,
    paint: (c, r) => {
      plate(c, 80, 118, 62, 20, '#262426');
      poly(c, [42, 82, 104, 82, 122, 72, 60, 72], lin(c, 0, 72, 0, 82, [[0, '#ffffff'], [1, '#f2f0e6']]));
      c.fillStyle = lin(c, 42, 82, 104, 122, [[0, '#fbfaf2'], [1, '#e2dfd0']]);
      c.fillRect(42, 82, 62, 38);
      poly(c, [104, 82, 122, 72, 122, 110, 104, 120], lin(c, 104, 0, 122, 0, [[0, '#d6d3c4'], [1, '#bcb8a8']]));
      ell(c, 80, 124, 44, 6, 'rgba(60,24,10,0.85)');
      speckle(c, r, 14, 84, 74, 14, 3, ['#5a9a3a', '#8ac25a'], [1.4, 2.4]);
      ell(c, 96, 76, 6, 3, '#f2d27a');
      gloss(c, 56, 90, 6, 14, 0.5, 0);
    },
  },
  /** 金物（金づち） */
  hammer: {
    scene: 'shop',
    zoom: 1.15,
    paint: (c) => {
      c.save();
      c.translate(80, 92);
      c.rotate(-0.6);
      shadow(c, 8, 28, 60, 8, 0.4);
      rr(c, -62, -6, 96, 12, 6, lin(c, 0, -6, 0, 6, [[0, '#e8b878'], [0.5, '#b77a3c'], [1, '#7a4a1e']]));
      rr(c, 26, -26, 22, 52, 3, lin(c, 26, 0, 48, 0, [[0, '#5a5e66'], [0.35, '#e8ecf0'], [0.6, '#9aa0a8'], [1, '#4a4e54']]));
      rr(c, 48, -14, 18, 28, 2, lin(c, 0, -14, 0, 14, [[0, '#d8dce2'], [1, '#6a6e74']]));
      gloss(c, 34, -18, 4, 14, 0.7, 0);
      c.restore();
    },
  },
  /** 弁当（ごはんと梅干し・唐揚げ・玉子焼き・ブロッコリー） */
  bento: {
    scene: 'washi',
    zoom: 1.02,
    paint: (c, r) => {
      shadow(c, 82, 138, 70, 10, 0.5);
      rr(c, 12, 60, 136, 82, 10, lin(c, 0, 60, 0, 142, [[0, '#2a1a16'], [1, '#120a08']]));
      rr(c, 16, 64, 128, 74, 7, '#8e1e1a');
      rr(c, 20, 68, 58, 66, 5, '#fbfaf6');
      speckle(c, r, 70, 49, 101, 26, 30, ['#ece8de', '#ffffff', '#d8d4c8'], [1, 2]);
      sphere(c, 49, 100, 9, '#c8283a', 0.6);
      rr(c, 82, 68, 58, 66, 5, '#3a2014');
      fried(c, r, 98, 84, 13, 11, 0.3);
      fried(c, r, 120, 82, 12, 10, -0.2);
      rr(c, 86, 100, 24, 14, 3, lin(c, 0, 100, 0, 114, [[0, '#ffe27a'], [1, '#e8b02a']]));
      rr(c, 86, 116, 24, 14, 3, lin(c, 0, 116, 0, 130, [[0, '#ffe27a'], [1, '#e8b02a']]));
      for (const [x, y] of [[124, 108], [132, 122], [118, 124]] as const) {
        speckle(c, r, 18, x, y, 7, 6, ['#3f7a24', '#5a9a34', '#2a5a1a'], [1.6, 2.8]);
      }
      gloss(c, 30, 72, 14, 2, 0.35, 0);
    },
  },
  /** 古着（赤いチェックのシャツ） */
  shirt: {
    scene: 'shop',
    zoom: 1,
    paint: (c) => {
      shadow(c, 82, 140, 58, 8, 0.4);
      c.save();
      c.beginPath();
      c.moveTo(60, 28);
      c.lineTo(100, 28);
      c.lineTo(146, 48);
      c.lineTo(136, 80);
      c.lineTo(118, 72);
      c.lineTo(118, 140);
      c.lineTo(42, 140);
      c.lineTo(42, 72);
      c.lineTo(24, 80);
      c.lineTo(14, 48);
      c.closePath();
      c.fillStyle = '#b8302e';
      c.fill();
      c.clip();
      for (let x = 0; x < S; x += 18) {
        c.fillStyle = 'rgba(30,20,30,0.38)';
        c.fillRect(x, 0, 7, S);
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.fillRect(x + 10, 0, 2, S);
      }
      for (let y = 0; y < S; y += 18) {
        c.fillStyle = 'rgba(30,20,30,0.38)';
        c.fillRect(0, y, S, 7);
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.fillRect(0, y + 10, S, 2);
      }
      c.fillStyle = lin(c, 14, 0, 146, 0, [[0, 'rgba(0,0,0,0.3)'], [0.3, 'rgba(255,255,255,0.08)'], [0.7, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.3)']]);
      c.fillRect(0, 0, S, S);
      c.restore();
      poly(c, [60, 28, 80, 44, 72, 54, 56, 34], '#9a2624');
      poly(c, [100, 28, 80, 44, 88, 54, 104, 34], '#9a2624');
      for (let y = 58; y < 136; y += 16) sphere(c, 80, y, 2.6, '#f2ece0', 0.5);
    },
  },
  /** ラテ（上から見たハートのラテアート） */
  latte: {
    scene: 'cafe',
    zoom: 1.08,
    paint: (c) => {
      plate(c, 80, 98, 66, 42, '#f4f1ec');
      shadow(c, 84, 104, 44, 30, 0.35);
      ell(c, 80, 92, 46, 34, lin(c, 34, 60, 126, 126, [[0, '#ffffff'], [1, '#c8c2b8']]));
      ell(c, 80, 92, 40, 29, rad(c, 80, 92, 4, 80, 92, 40, [[0, '#e8c69a'], [0.75, '#b87a44'], [1, '#6a3a1a']]));
      c.beginPath();
      c.moveTo(80, 112);
      c.bezierCurveTo(52, 96, 56, 74, 70, 76);
      c.bezierCurveTo(76, 77, 79, 82, 80, 86);
      c.bezierCurveTo(81, 82, 84, 77, 90, 76);
      c.bezierCurveTo(104, 74, 108, 96, 80, 112);
      c.closePath();
      c.fillStyle = rad(c, 76, 88, 2, 80, 92, 26, [[0, '#fffaf0'], [1, '#f2e2c6']]);
      c.fill();
      c.save();
      c.lineWidth = 6;
      c.strokeStyle = lin(c, 120, 84, 140, 100, [[0, '#ffffff'], [1, '#bdb6ad']]);
      c.beginPath();
      c.ellipse(126, 94, 8, 11, 0, -1.3, 1.5);
      c.stroke();
      c.restore();
      gloss(c, 56, 74, 10, 4, 0.5, -0.5);
    },
  },
  /** 手芸（毛糸玉と編み針） */
  yarn: {
    scene: 'shop',
    zoom: 1.15,
    paint: (c) => {
      shadow(c, 80, 136, 66, 10, 0.5);
      /**
       * 毛糸玉を1つ描く（球に糸の巻き目）。
       * @param cx 中心x
       * @param cy 中心y
       * @param rr0 半径
       * @param color 毛糸の色
       * @sideEffect canvas に描く
       */
      const ball = (cx: number, cy: number, rr0: number, color: string): void => { // audit-ignore: fnlog-missing 絵の部品
        sphere(c, cx, cy, rr0, color, 0.25);
        c.save();
        c.beginPath();
        c.arc(cx, cy, rr0, 0, Math.PI * 2);
        c.clip();
        c.lineWidth = 1.6;
        for (let k = -6; k <= 6; k++) {
          c.strokeStyle = k % 2 === 0 ? rgba('#ffffff', 0.22) : rgba('#000000', 0.18);
          c.beginPath();
          c.ellipse(cx + k * 3, cy, rr0 * 0.4, rr0 * 1.1, 0.6, 0, Math.PI * 2);
          c.stroke();
        }
        c.restore();
      };
      c.save();
      c.lineCap = 'round';
      c.lineWidth = 3;
      c.strokeStyle = lin(c, 30, 30, 140, 120, [[0, '#e8e0d0'], [1, '#a89a80']]);
      c.beginPath();
      c.moveTo(40, 30);
      c.lineTo(130, 120);
      c.moveTo(120, 30);
      c.lineTo(36, 118);
      c.stroke();
      c.restore();
      ball(52, 108, 26, '#d8473a');
      ball(110, 110, 24, '#2fa39a');
      ball(82, 86, 26, '#e8b23a');
    },
  },
  /** ギャラリー（金の額縁の風景画、スポットライト） */
  painting: {
    scene: 'gallery',
    zoom: 1,
    paint: (c) => {
      ell(c, 80, 40, 70, 40, rad(c, 80, 30, 2, 80, 40, 70, [[0, 'rgba(255,246,220,0.7)'], [1, 'rgba(255,246,220,0)']]));
      shadow(c, 86, 92, 60, 52, 0.35);
      rr(c, 22, 36, 116, 90, 3, lin(c, 22, 36, 138, 126, [[0, '#f6d77a'], [0.4, '#b8862a'], [0.6, '#f0cc6a'], [1, '#8e6418']]));
      c.fillStyle = lin(c, 0, 46, 0, 116, [[0, '#7fb8e0'], [0.55, '#f2d9a8'], [1, '#e8c08a']]);
      c.fillRect(32, 46, 96, 70);
      poly(c, [32, 100, 62, 70, 84, 92, 104, 76, 128, 98, 128, 116, 32, 116], '#5a7a4a');
      poly(c, [32, 108, 70, 92, 128, 106, 128, 116, 32, 116], '#3f5a34');
      ell(c, 104, 60, 7, 7, '#fff2c0');
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.lineWidth = 2;
      c.strokeRect(32, 46, 96, 70);
    },
  },
  /** 駄菓子（包み飴とうずまきのペロペロキャンディ） */
  candy: {
    scene: 'shop',
    zoom: 1.12,
    paint: (c) => {
      shadow(c, 80, 136, 66, 10, 0.45);
      stick(c, 60, 90, 74, 146, 4);
      ell(c, 58, 66, 30, 30, '#ffffff');
      c.save();
      c.beginPath();
      c.arc(58, 66, 28, 0, Math.PI * 2);
      c.clip();
      const colors = ['#ff5a7a', '#ffd23a', '#4ac0e8', '#7ad05a'];
      for (let k = 0; k < 24; k++) {
        c.fillStyle = colors[k % colors.length] ?? '#ff5a7a';
        c.beginPath();
        c.moveTo(58, 66);
        c.arc(58, 66, 30, (k / 24) * Math.PI * 2 + k * 0.08, ((k + 0.5) / 24) * Math.PI * 2 + k * 0.08 + 0.12);
        c.closePath();
        c.fill();
      }
      c.restore();
      gloss(c, 48, 54, 12, 6, 0.7, -0.6);
      /**
       * 両端をねじった包み飴を1つ描く。
       * @param cx 中心x
       * @param cy 中心y
       * @param color 包みの色
       * @param rot 回転
       * @sideEffect canvas に描く
       */
      const wrapped = (cx: number, cy: number, color: string, rot: number): void => { // audit-ignore: fnlog-missing 絵の部品
        c.save();
        c.translate(cx, cy);
        c.rotate(rot);
        poly(c, [-14, 0, -26, -9, -26, 9], rgba(color, 0.75));
        poly(c, [14, 0, 26, -9, 26, 9], rgba(color, 0.75));
        sphere(c, 0, 0, 13, color, 0.7);
        c.restore();
      };
      wrapped(112, 112, '#e8483a', 0.3);
      wrapped(122, 80, '#f2b630', -0.4);
      wrapped(86, 126, '#3a9ad8', 0.1);
    },
  },
  /** 花（クラフト紙で包んだ花束） */
  flower: {
    scene: 'outdoor',
    zoom: 1.1,
    paint: (c) => {
      shadow(c, 82, 146, 40, 8, 0.4);
      for (const [x, y, rot] of [[50, 66, -0.6], [116, 64, 0.6], [80, 52, 0]] as const) ell(c, x, y, 7, 22, '#4f8a3a', rot);
      /**
       * 花を1輪描く（6枚の花びらと花芯）。
       * @param cx 中心x
       * @param cy 中心y
       * @param r0 半径
       * @param color 花びらの色
       * @sideEffect canvas に描く
       */
      const bloom = (cx: number, cy: number, r0: number, color: string): void => { // audit-ignore: fnlog-missing 絵の部品
        for (let p = 0; p < 6; p++) {
          const a = (p / 6) * Math.PI * 2;
          ell(c, cx + Math.cos(a) * r0 * 0.55, cy + Math.sin(a) * r0 * 0.55, r0 * 0.55, r0 * 0.38, rad(c, cx, cy, 1, cx, cy, r0, [[0, shade(color, -0.25)], [1, shade(color, 0.3)]]), a);
        }
        ell(c, cx, cy, r0 * 0.28, r0 * 0.28, '#f6d24a');
      };
      bloom(58, 72, 18, '#e8485a');
      bloom(102, 70, 18, '#f28ab0');
      bloom(80, 56, 17, '#f6c23a'); // audit-ignore: magic-radius 絵の座標（発見・訪問の距離ルールではない）
      bloom(70, 90, 15, '#ffffff');
      bloom(96, 92, 15, '#e86a3a');
      poly(c, [42, 92, 118, 92, 92, 150, 68, 150], lin(c, 42, 0, 118, 0, [[0, '#a8804a'], [0.4, '#e0c08a'], [1, '#8e6a3a']]));
      poly(c, [60, 112, 100, 112, 96, 120, 64, 120], '#c84a5a');
    },
  },
  /** おにぎり（のりを巻いた三角、梅） */
  onigiri: {
    scene: 'washi',
    paint: (c, r) => {
      shadow(c, 80, 136, 64, 10, 0.5);
      ell(c, 80, 124, 70, 14, lin(c, 10, 0, 150, 0, [[0, '#4a7a2a'], [0.5, '#8ac05a'], [1, '#3f6a24']]), -0.05);
      /**
       * おにぎりを1つ描く（三角のごはん・のり・梅）。
       * @param cx 中心x
       * @param cy 中心y
       * @param s 大きさ
       * @param ume 梅をのせるか
       * @sideEffect canvas に描く
       */
      const tri = (cx: number, cy: number, s: number, ume: boolean): void => { // audit-ignore: fnlog-missing 絵の部品
        c.beginPath();
        c.moveTo(cx, cy - s);
        c.quadraticCurveTo(cx + s * 0.25, cy - s * 0.95, cx + s * 0.95, cy + s * 0.55);
        c.quadraticCurveTo(cx, cy + s * 0.9, cx - s * 0.95, cy + s * 0.55);
        c.quadraticCurveTo(cx - s * 0.25, cy - s * 0.95, cx, cy - s);
        c.closePath();
        c.fillStyle = rad(c, cx - s * 0.3, cy - s * 0.3, 2, cx, cy, s * 1.1, [[0, '#ffffff'], [0.7, '#f2efe6'], [1, '#cfc9ba']]);
        c.fill();
        speckle(c, r, 60, cx, cy + s * 0.05, s * 0.75, s * 0.6, ['#ffffff', '#e4e0d4', '#d6d0c2'], [0.9, 1.8]);
        rr(c, cx - s * 0.42, cy + s * 0.2, s * 0.84, s * 0.62, 3, lin(c, cx - s * 0.4, 0, cx + s * 0.4, 0, [[0, '#0e1610'], [0.5, '#2a3a2a'], [1, '#0e1610']]));
        if (ume) sphere(c, cx, cy - s * 0.25, s * 0.16, '#c8283a', 0.6);
      };
      tri(108, 96, 30, false);
      tri(62, 104, 34, true);
    },
  },
  /** レンタサイクル（前かごつきの自転車） */
  bicycle: {
    scene: 'outdoor',
    zoom: 1,
    paint: (c) => {
      shadow(c, 80, 132, 72, 6, 0.45);
      /**
       * 自転車の車輪を1つ描く（タイヤ・リム・スポーク）。
       * @param cx 中心x
       * @sideEffect canvas に描く
       */
      const wheel = (cx: number): void => { // audit-ignore: fnlog-missing 絵の部品
        c.save();
        c.lineWidth = 6;
        c.strokeStyle = '#1e1e22';
        c.beginPath();
        c.arc(cx, 108, 24, 0, Math.PI * 2);
        c.stroke();
        c.lineWidth = 2;
        c.strokeStyle = '#c8ccd2';
        c.beginPath();
        c.arc(cx, 108, 20, 0, Math.PI * 2);
        c.stroke();
        c.lineWidth = 0.8;
        c.strokeStyle = 'rgba(220,224,230,0.8)';
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          c.beginPath();
          c.moveTo(cx, 108);
          c.lineTo(cx + Math.cos(a) * 20, 108 + Math.sin(a) * 20);
          c.stroke();
        }
        c.restore();
      };
      wheel(40);
      wheel(120);
      c.save();
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.lineWidth = 6;
      c.strokeStyle = lin(c, 40, 70, 120, 110, [[0, '#2fa39a'], [0.5, '#6fd6c8'], [1, '#1f7a72']]);
      c.beginPath();
      c.moveTo(40, 108);
      c.lineTo(66, 76);
      c.lineTo(82, 108);
      c.lineTo(40, 108);
      c.moveTo(82, 108);
      c.lineTo(110, 70);
      c.lineTo(120, 108);
      c.moveTo(66, 76);
      c.lineTo(62, 66);
      c.stroke();
      c.lineWidth = 3;
      c.strokeStyle = '#3a3a40';
      c.beginPath();
      c.moveTo(104, 62);
      c.lineTo(118, 60);
      c.stroke();
      c.restore();
      rr(c, 52, 60, 22, 7, 3, '#5a3a24');
      rr(c, 112, 62, 30, 20, 3, lin(c, 0, 62, 0, 82, [[0, '#e8c88a'], [1, '#a8804a']]));
      c.strokeStyle = 'rgba(90,60,30,0.6)';
      c.lineWidth = 1;
      for (let x = 116; x < 142; x += 5) {
        c.beginPath();
        c.moveTo(x, 62);
        c.lineTo(x, 82);
        c.stroke();
      }
      gloss(c, 80, 86, 14, 2, 0.5, -0.9);
    },
  },
  /** 洋菓子（いちごのショートケーキ） */
  cake: {
    scene: 'marble',
    paint: (c, r) => {
      plate(c, 80, 124, 64, 18, '#ffffff');
      poly(c, [28, 70, 120, 58, 140, 74, 48, 88], lin(c, 0, 58, 0, 88, [[0, '#ffffff'], [1, '#f2ece4']]));
      c.fillStyle = '#ffffff';
      poly(c, [48, 88, 140, 74, 140, 122, 48, 132], lin(c, 48, 0, 140, 0, [[0, '#f6efe4'], [1, '#e2d6c4']]));
      poly(c, [28, 70, 48, 88, 48, 132, 28, 116], '#fffcf6');
      for (const [y0, h, color] of [[92, 12, '#f6d98a'], [108, 4, '#ffffff'], [113, 12, '#f2d27a']] as const) {
        poly(c, [48, y0, 140, y0 - 12, 140, y0 - 12 + h, 48, y0 + h], color);
      }
      for (let k = 0; k < 4; k++) {
        const x = 62 + k * 20;
        const y = 106 - k * 2.6;
        ell(c, x, y, 6, 4, '#e8283a');
        ell(c, x, y, 3.5, 2.4, '#ff9aa4');
      }
      speckle(c, r, 30, 94, 100, 40, 8, ['#e8b860', '#fff0b8'], [0.6, 1.2]);
      ell(c, 76, 64, 16, 8, '#ffffff');
      sphere(c, 76, 56, 12, '#e01e32', 0.8);
      poly(c, [70, 46, 76, 50, 82, 46, 78, 52, 74, 52], '#3f8a2a');
      speckle(c, r, 10, 76, 58, 8, 8, ['#ffe08a'], [0.5, 0.9]);
    },
  },
  /** そば（ざるにこんもり盛った細い麺、のり、つゆ、わさび） */
  soba: {
    scene: 'washi',
    zoom: 1.1,
    paint: (c, r) => {
      shadow(c, 74, 138, 64, 10, 0.5);
      poly(c, [8, 110, 122, 102, 132, 138, 14, 146], lin(c, 0, 102, 0, 146, [[0, '#dcc08a'], [1, '#a8864e']]));
      c.save();
      c.strokeStyle = 'rgba(110,80,36,0.4)';
      c.lineWidth = 1;
      for (let k = 0; k < 15; k++) {
        c.beginPath();
        c.moveTo(10 + k * 8, 110 - k * 0.55);
        c.lineTo(16 + k * 8, 146 - k * 0.6);
        c.stroke();
      }
      c.restore();
      shadow(c, 66, 122, 50, 9, 0.55);
      c.save();
      c.beginPath();
      c.moveTo(16, 124);
      c.bezierCurveTo(18, 84, 46, 66, 68, 66);
      c.bezierCurveTo(92, 66, 116, 86, 118, 122);
      c.quadraticCurveTo(66, 132, 16, 124);
      c.closePath();
      c.fillStyle = rad(c, 56, 78, 4, 66, 98, 58, [[0, '#9a8c78'], [0.55, '#6e6050'], [1, '#3e342a']]);
      c.fill();
      c.clip();
      c.lineCap = 'round';
      for (let k = 0; k < 70; k++) {
        const y = 66 + k * 0.85;
        c.strokeStyle = k % 3 === 0 ? 'rgba(200,188,168,0.45)' : 'rgba(40,32,24,0.35)';
        c.lineWidth = 0.9;
        c.beginPath();
        c.moveTo(10, y + r() * 4);
        c.bezierCurveTo(40, y - 6 + r() * 6, 80, y + 6 - r() * 6, 124, y + r() * 4);
        c.stroke();
      }
      c.restore();
      gloss(c, 50, 80, 16, 4, 0.35, -0.3);
      for (let k = 0; k < 18; k++) {
        c.save();
        c.translate(48 + r() * 38, 68 + r() * 10);
        c.rotate((r() - 0.5) * 1.8);
        c.fillStyle = '#101610';
        c.fillRect(-4, -0.8, 8, 1.6);
        c.restore();
      }
      cup(c, 138, 104, 19, 26, '#eef2f6', rad(c, 136, 103, 1, 138, 104, 17, [[0, '#7a4420'], [1, '#2a1206']]), 0.8);
      c.save();
      c.strokeStyle = 'rgba(40,70,140,0.7)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(122, 116);
      c.quadraticCurveTo(138, 122, 154, 116);
      c.stroke();
      c.restore();
      sphere(c, 122, 140, 5, '#9ac24a', 0.3);
    },
  },
  /** 写真館（銀と黒のクラシックカメラ） */
  camera: {
    scene: 'studio',
    zoom: 1.05,
    paint: (c) => {
      shadow(c, 82, 132, 66, 10, 0.5);
      rr(c, 18, 58, 124, 70, 10, lin(c, 0, 58, 0, 128, [[0, '#3a3a40'], [1, '#141416']]));
      rr(c, 18, 52, 124, 18, 6, lin(c, 0, 52, 0, 70, [[0, '#f2f4f6'], [0.5, '#b4b8c0'], [1, '#7a7e86']]));
      rr(c, 30, 44, 22, 10, 3, lin(c, 0, 44, 0, 54, [[0, '#e8eaee'], [1, '#8a8e96']]));
      rr(c, 104, 44, 26, 12, 3, lin(c, 0, 44, 0, 56, [[0, '#e8eaee'], [1, '#8a8e96']]));
      ell(c, 80, 94, 34, 34, lin(c, 46, 60, 114, 128, [[0, '#d8dce2'], [0.5, '#6a6e76'], [1, '#2a2c30']]));
      ell(c, 80, 94, 27, 27, '#16161a');
      ell(c, 80, 94, 21, 21, rad(c, 74, 86, 2, 80, 94, 22, [[0, '#6a7ab8'], [0.4, '#2a3060'], [0.8, '#0e0e18'], [1, '#3a4a6a']]));
      gloss(c, 72, 84, 7, 4, 0.8, -0.6);
      ell(c, 90, 104, 3, 2, 'rgba(180,120,255,0.6)');
      gloss(c, 40, 64, 20, 2, 0.4, 0);
    },
  },
  /** うなぎ（重箱のごはんに、たれの照りのかば焼き2枚） */
  unagi: {
    scene: 'washi',
    zoom: 1.04,
    paint: (c, r) => {
      shadow(c, 82, 140, 72, 10, 0.55);
      rr(c, 12, 58, 136, 86, 9, lin(c, 0, 58, 0, 144, [[0, '#24150f'], [1, '#0a0605']]));
      rr(c, 16, 62, 128, 78, 7, lin(c, 0, 62, 0, 140, [[0, '#c0281e'], [1, '#7a1410']]));
      rr(c, 22, 68, 116, 66, 5, '#f4f0e4');
      speckle(c, r, 120, 80, 101, 56, 31, ['#ffffff', '#e2ddd0', '#d4cec0'], [1, 2]);
      for (const [y, rot] of [[86, -0.05], [113, 0.04]] as const) {
        c.save();
        c.translate(80, y);
        c.rotate(rot);
        shadow(c, 2, 9, 54, 6, 0.45);
        rr(c, -54, -11, 108, 24, 11, '#3a1606');
        rr(c, -53, -12, 106, 21, 10, rad(c, -14, -8, 2, 0, -2, 58, [[0, '#d68a3e'], [0.45, '#a0561c'], [0.85, '#5e2608'], [1, '#3a1606']]));
        speckle(c, r, 16, 0, -2, 46, 6, ['rgba(40,12,0,0.6)', 'rgba(60,20,4,0.5)'], [1.2, 2.6]);
        gloss(c, -16, -7, 30, 2.4, 0.75, 0);
        gloss(c, 24, -5, 14, 1.6, 0.55, 0);
        c.restore();
      }
      speckle(c, r, 22, 80, 100, 44, 22, ['#5a7a2a', '#7a9a3a'], [0.6, 1.1]);
    },
  },
  /** ジェラート（ワッフルコーンにピスタチオといちご） */
  gelato: {
    scene: 'marble',
    zoom: 1.12,
    paint: (c, r) => {
      shadow(c, 84, 146, 28, 6, 0.4);
      poly(c, [56, 86, 104, 86, 80, 150], lin(c, 56, 0, 104, 0, [[0, '#b8783a'], [0.5, '#e8b06a'], [1, '#a0642a']]));
      c.save();
      c.beginPath();
      c.moveTo(56, 86);
      c.lineTo(104, 86);
      c.lineTo(80, 150);
      c.closePath();
      c.clip();
      c.strokeStyle = 'rgba(120,70,20,0.55)';
      c.lineWidth = 1.4;
      for (let k = -6; k <= 6; k++) {
        c.beginPath();
        c.moveTo(56 + k * 9, 86);
        c.lineTo(86 + k * 9, 150);
        c.stroke();
        c.beginPath();
        c.moveTo(104 + k * 9, 86);
        c.lineTo(74 + k * 9, 150);
        c.stroke();
      }
      c.restore();
      /**
       * ジェラートのひとすくいを描く（ふちのでこぼこ・粒）。
       * @param cx 中心x
       * @param cy 中心y
       * @param s 半径
       * @param color 色
       * @sideEffect canvas に描く
       */
      const scoop = (cx: number, cy: number, s: number, color: string): void => { // audit-ignore: fnlog-missing 絵の部品
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          ell(c, cx + Math.cos(a) * s * 0.75, cy + Math.sin(a) * s * 0.55 + 4, s * 0.38, s * 0.3, shade(color, -0.15));
        }
        sphere(c, cx, cy, s, color, 0.35);
        speckle(c, r, 20, cx, cy, s * 0.8, s * 0.8, [shade(color, -0.2), shade(color, 0.25)], [0.8, 1.8]);
      };
      scoop(80, 80, 25, '#b5d27a');
      scoop(80, 50, 23, '#f4a2b4');
    },
  },
  /** 古道具（藍の釉薬の壺） */
  vase: {
    scene: 'shelf',
    zoom: 1.22,
    paint: (c, r) => {
      shadow(c, 84, 138, 44, 9, 0.55);
      c.beginPath();
      c.moveTo(64, 30);
      c.lineTo(96, 30);
      c.bezierCurveTo(96, 44, 90, 48, 98, 58);
      c.bezierCurveTo(128, 82, 126, 128, 100, 138);
      c.lineTo(60, 138);
      c.bezierCurveTo(34, 128, 32, 82, 62, 58);
      c.bezierCurveTo(70, 48, 64, 44, 64, 30);
      c.closePath();
      c.fillStyle = lin(c, 34, 0, 126, 0, [[0, '#14223a'], [0.3, '#4a6a9a'], [0.6, '#2c4a7a'], [1, '#101a2e']]);
      c.fill();
      c.save();
      c.clip();
      c.fillStyle = lin(c, 0, 30, 0, 90, [[0, 'rgba(230,220,190,0.7)'], [1, 'rgba(230,220,190,0)']]);
      c.fillRect(0, 30, S, 60);
      const drip = lin(c, 0, 56, 0, 96, [[0, 'rgba(220,210,180,0.5)'], [1, 'rgba(220,210,180,0)']]);
      for (let k = 0; k < 8; k++) rr(c, 46 + r() * 68, 56, 3 + r() * 3, 26 + r() * 22, 2, drip);
      c.restore();
      ell(c, 80, 30, 16, 4, '#2a2018');
      gloss(c, 60, 92, 5, 22, 0.6, 0.15);
      gloss(c, 66, 66, 8, 3, 0.5, -0.3);
    },
  },
  /** パフェ（背の高いグラスにクリーム・いちご・ウエハース） */
  parfait: {
    scene: 'cafe',
    zoom: 1.12,
    paint: (c, r) => {
      shadow(c, 82, 146, 30, 6, 0.5);
      ell(c, 80, 146, 22, 5, 'rgba(255,255,255,0.5)');
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.fillRect(77, 122, 6, 24);
      c.save();
      c.beginPath();
      c.moveTo(52, 56);
      c.lineTo(108, 56);
      c.lineTo(96, 122);
      c.lineTo(64, 122);
      c.closePath();
      c.clip();
      for (const [y0, h, color] of [[100, 22, '#d8a04a'], [86, 14, '#5a2a14'], [70, 16, '#fbf4e4'], [56, 14, '#f29aa8']] as const) {
        c.fillStyle = color;
        c.fillRect(40, y0, 80, h);
      }
      speckle(c, r, 30, 80, 110, 18, 9, ['#f2c46c', '#a8681e'], [1.4, 2.6]);
      c.fillStyle = lin(c, 52, 0, 108, 0, [[0, 'rgba(255,255,255,0.35)'], [0.2, 'rgba(255,255,255,0.05)'], [0.8, 'rgba(255,255,255,0.05)'], [1, 'rgba(255,255,255,0.3)']]);
      c.fillRect(40, 56, 80, 70);
      c.restore();
      for (const [x, y, s] of [[66, 50, 12], [94, 50, 12], [80, 42, 14], [80, 30, 10]] as const) sphere(c, x, y, s, '#fbf8f2', 0.3);
      rr(c, 96, 10, 9, 38, 2, lin(c, 96, 0, 105, 0, [[0, '#e8c27a'], [1, '#b88a3a']]));
      sphere(c, 68, 36, 9, '#e01e32', 0.8);
      sphere(c, 82, 18, 7, '#c8102a', 0.8);
      c.strokeStyle = '#4a6a2a';
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(82, 12);
      c.quadraticCurveTo(86, 4, 92, 2);
      c.stroke();
      gloss(c, 58, 90, 3, 22, 0.55, 0.15);
    },
  },
  /** ラーメン（しょうゆスープに麺・チャーシュー・味玉・のり・ねぎ） */
  ramen: {
    scene: 'izakaya',
    zoom: 1.05,
    paint: (c, r) => {
      bowl(c, 80, 82, 66, 22, 48, '#c8281e', rad(c, 72, 80, 4, 80, 83, 64, [[0, '#c88440'], [0.7, '#8a4a18'], [1, '#5a2a0c']]));
      c.save();
      c.beginPath();
      c.ellipse(80, 83, 60, 18, 0, 0, Math.PI * 2);
      c.clip();
      c.lineCap = 'round';
      for (let k = 0; k < 14; k++) {
        const y = 74 + k * 2;
        c.strokeStyle = k % 2 === 0 ? '#f6d684' : '#e8bf5a';
        c.lineWidth = 2.4;
        c.beginPath();
        c.moveTo(24 + r() * 8, y + 6);
        c.bezierCurveTo(52, y - 6, 74, y + 10, 104, y);
        c.stroke();
      }
      c.restore();
      poly(c, [104, 64, 128, 62, 132, 86, 108, 88], lin(c, 104, 64, 132, 88, [[0, '#1a2a1e'], [1, '#0a120c']]));
      ell(c, 106, 84, 14, 9, rad(c, 104, 82, 1, 106, 84, 14, [[0, '#f2c8b0'], [0.7, '#c8846a'], [1, '#8a4a34']]));
      ell(c, 62, 80, 12, 8, '#fbf8f0');
      ell(c, 62, 81, 7, 5, rad(c, 61, 80, 0, 62, 81, 7, [[0, '#ffb43a'], [1, '#e8781a']]));
      speckle(c, r, 16, 82, 78, 14, 5, ['#6ab04a', '#9ad06a', '#f2f8e0'], [1.4, 2.4]);
      steam(c, 80, 68, 40, 0.4); // audit-ignore: magic-radius 絵の座標（発見・訪問の距離ルールではない）
    },
  },
};

/** 写真を描ける看板商品の一覧（テスト用） */
export const GOODS_PHOTO_ICONS: readonly GoodsIcon[] = Object.keys(PLANS) as GoodsIcon[];

/**
 * 160px 四方の 2D コンテキストに、1枚の写真（背景 → 被写体 → 仕上げ）を描く。
 * @param c 2D コンテキスト
 * @param icon 看板商品
 * @sideEffect canvas に描く
 */
export function renderGoodsPhoto(c: Ctx, icon: GoodsIcon): void {
  const log = logger.fn('renderGoodsPhoto', { icon });
  const plan = PLANS[icon];
  const rnd = seededRandomFor(`photo:${icon}`);
  c.save();
  c.lineJoin = 'round';
  paintScene(c, SCENES[plan.scene], rnd);
  try {
    const z = plan.zoom ?? DEFAULT_ZOOM;
    c.save();
    c.translate(S / 2, ZOOM_PIVOT_Y);
    c.scale(z, z);
    c.translate(-S / 2, -ZOOM_PIVOT_Y);
    plan.paint(c, rnd);
    c.restore();
  } catch (error) {
    log.warn('写真の被写体を描けませんでした', { icon, error });
  }
  c.filter = 'none';
  finish(c, rnd);
  c.restore();
  log.exit(undefined);
}

/** 作った写真（キー: アイコン名＋シルエットか） */
const cache = new Map<string, HTMLCanvasElement>();

/**
 * キャンバスを作る（document が無い環境では undefined）。
 * @returns 160px 四方の canvas
 */
function makePhotoCanvas(): HTMLCanvasElement | undefined {
  const log = logger.fn('makePhotoCanvas');
  if (typeof document === 'undefined') return log.exit(undefined, 'document なし');
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  return log.exit(canvas);
}

/**
 * 写真を返す（初回だけ描いてキャッシュ）。
 * @param icon 看板商品
 * @param silhouette 未発見の店用か
 * @returns canvas（作れなければ undefined）
 * @sideEffect キャッシュに入れる
 */
function photoCanvas(icon: GoodsIcon, silhouette: boolean): HTMLCanvasElement | undefined { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶ（作るときだけ renderGoodsPhoto・makeSilhouette がログ）
  const key = `${icon}|${silhouette ? 's' : 'c'}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const canvas = makePhotoCanvas();
  const c = canvas?.getContext('2d');
  if (canvas === undefined || c === null || c === undefined) return undefined;
  if (silhouette) {
    const color = photoCanvas(icon, false);
    if (color === undefined) return undefined;
    makeSilhouette(c, color);
  } else renderGoodsPhoto(c, icon);
  cache.set(key, canvas);
  return canvas;
}

/**
 * カラーの写真から、未発見の店用のシルエット（灰色・ぼかし・暗く）を作る。filter が使えなければ画素を自前で灰色にして暗くする。
 * @param c 描き込む 2D コンテキスト
 * @param color カラーの写真
 * @sideEffect canvas に描く
 */
function makeSilhouette(c: Ctx, color: HTMLCanvasElement): void {
  const log = logger.fn('makeSilhouette');
  c.filter = SILHOUETTE_FILTER;
  const filtered = c.filter === SILHOUETTE_FILTER;
  c.drawImage(color, 0, 0);
  c.filter = 'none';
  if (filtered) return log.exit(undefined, 'filter');
  const image = c.getImageData(0, 0, S, S);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = ((d[i] ?? 0) * 0.3 + (d[i + 1] ?? 0) * 0.59 + (d[i + 2] ?? 0) * 0.11) * 0.55;
    d[i] = g;
    d[i + 1] = g;
    d[i + 2] = g;
  }
  c.putImageData(image, 0, 0);
  log.exit(undefined, '画素で灰色化');
}

/**
 * (x,y) を左上に size 四方の角丸の枠いっぱいに、看板商品の写真を描く（枠線・影は呼び出し側）。
 * @param ctx 描く先の 2D コンテキスト
 * @param icon 看板商品
 * @param x 左
 * @param y 上
 * @param size 一辺
 * @param opts silhouette（未発見の店用）・radius（角丸。既定 size*0.22）・alpha（不透明度）
 * @sideEffect canvas に描く（初回は写真を作ってキャッシュする）
 */
export function drawGoodsPhoto(ctx: CanvasRenderingContext2D, icon: GoodsIcon, x: number, y: number, size: number, opts: { silhouette?: boolean; radius?: number; alpha?: number } = {}): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const photo = photoCanvas(icon, opts.silhouette === true);
  if (photo === undefined || size <= 0) return;
  ctx.save();
  roundRectPath(ctx, x, y, size, size, opts.radius ?? size * DEFAULT_RADIUS_RATIO);
  ctx.clip();
  ctx.globalAlpha *= opts.alpha ?? 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo, x, y, size, size);
  ctx.restore();
}

/**
 * DOM の canvas（カードのサムネ）に、cssSize 四方で看板商品の写真を描く（dpr に合わせて canvas の大きさ・style も設定）。
 * @param canvas 描く canvas
 * @param icon 看板商品
 * @param cssSize 一辺（CSS px）
 * @param opts silhouette（未発見の店用）
 * @sideEffect canvas の大きさを変えて描く
 */
export function paintGoodsPhoto(canvas: HTMLCanvasElement, icon: GoodsIcon, cssSize: number, opts: { silhouette?: boolean } = {}): void {
  const log = logger.fn('paintGoodsPhoto', { icon, cssSize, silhouette: opts.silhouette === true });
  const dpr = normalizeDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  canvas.width = Math.max(1, Math.round(cssSize * dpr));
  canvas.height = Math.max(1, Math.round(cssSize * dpr));
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.exit(undefined, '2D コンテキストなし');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);
  drawGoodsPhoto(ctx, icon, 0, 0, cssSize, { silhouette: opts.silhouette === true, radius: cssSize * DEFAULT_RADIUS_RATIO });
  log.exit(undefined);
}

/**
 * 作った写真のキャッシュを捨てる（テスト用）。
 * @sideEffect キャッシュを空にする
 */
export function clearGoodsPhotoCache(): void {
  const log = logger.fn('clearGoodsPhotoCache', { size: cache.size });
  cache.clear();
  log.exit(undefined);
}
