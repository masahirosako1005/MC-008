/**
 * @file 街の絵の共通部品（presentation/shared 層。Canvas 描画の純粋関数）
 * マイ街の街並み・スポット詳細の絵・図鑑のタイル・演出で使う「フラットなモダン都市イラスト」の部品（docs/08 §10.5）。
 * 角の立ったビル（窓のグリッド）、ガラス張りの店先、地区色のストライプの日よけ、街路樹、街灯、淡い空色のグラデ。
 * 鳥居・瓦屋根・日の丸・提灯などの「昔の日本」記号は使わない。墨の輪郭線も使わず、面の明暗だけで形を見せる。
 * 色は CityTone（カラー／色あせのグレー／シルエット）で差し替える。ctx.filter に頼らないので、どのブラウザでも同じ見た目になる。
 * 毎フレーム描画から呼ばれるため関数ログは出さない（呼び出し側でまとめてログ）。乱数は使わず、模様は座標と種（整数）から決める。
 */
import { mixColors, scaleSaturation } from '@/Common/ui/canvas/colorUtils';
import { PALETTE } from '@/Common/ui/theme/palette';
import { paintShopIcon } from '@/presentation/shared/shopIcons';
import type { ShopIcon } from '@/presentation/shared/shopIcons';

/** 部品を描く範囲（x=左端、base=足元の Y、w=幅、h=高さ。CSS px） */
export interface ArtBox {
  readonly x: number;
  readonly base: number;
  readonly w: number;
  readonly h: number;
}

/** 街の絵の色一式（すべて '#rrggbb'） */
export interface CityTone {
  /** 壁（いちばん明るい面） */
  readonly wall: string;
  /** 壁（隣の建物と差をつける面） */
  readonly wallAlt: string;
  /** 建物の側面の陰 */
  readonly wallShade: string;
  readonly glass: string;
  readonly glassDeep: string;
  /** 屋上の縁・窓枠・柱 */
  readonly frame: string;
  /** 扉・設備などの濃い部分 */
  readonly ink: string;
  /** 地区色（日よけ・看板・屋根） */
  readonly accent: string;
  readonly accentDeep: string;
  readonly accentSoft: string;
  readonly leaf: string;
  readonly leafDeep: string;
  readonly blossom: string;
  readonly blossomDeep: string;
  readonly trunk: string;
  /** 灯りの色（ライトアップの窓・街灯） */
  readonly lit: string;
  /** 細部（窓・縞・看板のアイコン・ガラスの光）を描くか（シルエットは false） */
  readonly detail: boolean;
  /** ライトアップ（窓の灯り・街灯の光。成長 Lv3） */
  readonly isLit: boolean;
}

/** 空のグラデーション（上・下） */
export const SKY_TOP = '#d4e9f7';
export const SKY_BOTTOM = '#f4f8fb';

/** 遠景のビル群の色（空に溶ける淡い青灰） */
export const FAR_SKYLINE = '#e2eaf2';

/** シルエット（未訪問）の灰色 */
const SILHOUETTE = { body: '#aab1bc', light: '#bcc2cb', deep: '#a89e92' } as const;

/**
 * 地区色からカラーの色一式を作る（訪問済み・色あざやかな地区）。
 * @param accent 地区色 '#rrggbb'
 * @param opts lit=ライトアップするか
 * @returns 色一式
 */
export function colorTone(accent: string, opts: { readonly lit?: boolean } = {}): CityTone { // audit-ignore: fnlog-missing 毎フレーム描画
  return {
    wall: '#ffffff',
    wallAlt: '#eef1f5',
    wallShade: '#dde3ea',
    glass: '#cfe4f6',
    glassDeep: '#9fc3e4',
    frame: '#9aa5b4',
    ink: '#475569',
    accent,
    accentDeep: mixColors(accent, '#2a211b', 0.28),
    accentSoft: mixColors(accent, '#ffffff', 0.72),
    leaf: PALETTE.tree,
    leafDeep: PALETTE.treeDark,
    blossom: '#f9a8d4',
    blossomDeep: '#f472b6',
    trunk: PALETTE.trunk,
    lit: '#fde68a',
    detail: true,
    isLit: opts.lit === true,
  };
}

/**
 * 色一式の彩度を落とす（色あせ・復活前の灰色。形と細部は残す）。
 * @param tone 元の色一式
 * @param saturation 彩度の係数（0=無彩色、1=そのまま）
 * @returns 彩度を落とした色一式（ライトアップは消す）
 */
export function grayTone(tone: CityTone, saturation: number): CityTone { // audit-ignore: fnlog-missing 毎フレーム描画
  const out: { -readonly [K in keyof CityTone]: CityTone[K] } = { ...tone, isLit: false };
  for (const key of TONE_COLOR_KEYS) out[key] = scaleSaturation(tone[key], saturation);
  return out;
}

/** CityTone のうち色（'#rrggbb'）の項目 */
const TONE_COLOR_KEYS: readonly (keyof Omit<CityTone, 'detail' | 'isLit'>)[] = [
  'wall', 'wallAlt', 'wallShade', 'glass', 'glassDeep', 'frame', 'ink', 'accent', 'accentDeep', 'accentSoft',
  'leaf', 'leafDeep', 'blossom', 'blossomDeep', 'trunk', 'lit',
];

/**
 * シルエット（未訪問）の色一式。細部を描かず、灰色の形だけにする。
 * @returns 色一式
 */
export function silhouetteTone(): CityTone { // audit-ignore: fnlog-missing 毎フレーム描画
  const { body, light, deep } = SILHOUETTE;
  return {
    wall: body, wallAlt: body, wallShade: deep, glass: light, glassDeep: deep, frame: deep, ink: deep,
    accent: deep, accentDeep: deep, accentSoft: light, leaf: light, leafDeep: body, blossom: light, blossomDeep: body,
    trunk: deep, lit: light, detail: false, isLit: false,
  };
}

/**
 * 角丸（または角）の矩形を塗る。
 * @param ctx 描画先
 * @param r x・y・幅・高さ
 * @param fill 塗り色
 * @param radius 角丸の半径（省略時 0）
 */
export function fillBox(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number], fill: string, radius = 0): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (r[2] <= 0 || r[3] <= 0) return;
  ctx.fillStyle = fill;
  ctx.beginPath();
  if (radius > 0) ctx.roundRect(r[0], r[1], r[2], r[3], Math.min(radius, r[2] / 2, r[3] / 2));
  else ctx.rect(r[0], r[1], r[2], r[3]);
  ctx.fill();
}

/**
 * 多角形を塗る。
 * @param ctx 描画先
 * @param pts 頂点
 * @param fill 塗り色
 */
export function fillPoly(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], fill: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = fill;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

/**
 * 円を塗る。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 半径
 * @param fill 塗り色
 */
export function fillDisc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (r <= 0) return;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 2つの整数から決定論的な整数（0 以上）を作る（窓の灯り・遠景の高さなどの模様用。Math.random は使わない）。
 * @param a 整数1
 * @param b 整数2
 * @returns 0 以上の整数
 */
export function hash2(a: number, b: number): number { // audit-ignore: fnlog-missing 毎フレーム描画
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * ガラスに斜めの光を1本入れる（細部を描くときだけ）。
 * @param ctx 描画先
 * @param r ガラスの x・y・幅・高さ
 * @param tone 色一式
 */
export function paintGlassShine(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number], tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (!tone.detail || r[2] < 8 || r[3] < 8) return;
  const [x, y, w, h] = r;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalAlpha = 0.45;
  fillPoly(ctx, [[x + w * 0.18, y], [x + w * 0.42, y], [x + w * 0.12, y + h], [x - w * 0.12, y + h]], '#ffffff');
  ctx.globalAlpha = 0.25;
  fillPoly(ctx, [[x + w * 0.5, y], [x + w * 0.58, y], [x + w * 0.28, y + h], [x + w * 0.2, y + h]], '#ffffff');
  ctx.restore();
}

/**
 * 窓のグリッドを描く（ライトアップ中は一部の窓に灯りがともる）。
 * @param ctx 描画先
 * @param area 窓を並べる範囲の x・y・幅・高さ
 * @param grid 列数・行数・模様の種
 * @param tone 色一式
 */
export function paintWindowGrid(ctx: CanvasRenderingContext2D, area: readonly [number, number, number, number], grid: { readonly cols: number; readonly rows: number; readonly seed: number }, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (!tone.detail || grid.cols <= 0 || grid.rows <= 0) return;
  const [ax, ay, aw, ah] = area;
  const cw = aw / grid.cols;
  const rh = ah / grid.rows;
  const ww = Math.max(1.5, cw * 0.62);
  const wh = Math.max(1.5, rh * 0.58);
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const lit = tone.isLit && hash2(grid.seed + c, r) % 5 < 2;
      fillBox(ctx, [ax + c * cw + (cw - ww) / 2, ay + r * rh + (rh - wh) / 2, ww, wh], lit ? tone.lit : tone.glass, Math.min(1.5, ww / 3));
    }
  }
}

/**
 * 高層ビル（Lv3 の主役）を描く。種で「窓のグリッド／ガラスのカーテンウォール／横長の帯窓」を変える。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 * @param seed 模様の種（整数）
 */
export function paintTower(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const top = b.base - b.h;
  const side = Math.max(2, b.w * 0.18);
  const variant = seed % 3;
  fillBox(ctx, [b.x, top, b.w, b.h], variant === 1 ? tone.wall : tone.wallAlt);
  fillBox(ctx, [b.x + b.w - side, top, side, b.h], tone.wallShade);
  fillBox(ctx, [b.x - 1, top, b.w + 2, Math.max(2, b.h * 0.022)], tone.frame);
  const inner: [number, number, number, number] = [b.x + 3, top + 6, b.w - side - 6, b.h - 10];
  if (variant === 1 && tone.detail) {
    fillBox(ctx, inner, tone.isLit ? mixColors(tone.glass, tone.lit, 0.35) : tone.glass);
    ctx.fillStyle = tone.wallAlt;
    for (let y = inner[1] + 9; y < inner[1] + inner[3]; y += 9) ctx.fillRect(inner[0], y, inner[2], 1);
    for (let x = inner[0] + inner[2] / 3; x < inner[0] + inner[2] - 1; x += inner[2] / 3) ctx.fillRect(x, inner[1], 1, inner[3]);
    paintGlassShine(ctx, inner, tone);
  } else if (variant === 2 && tone.detail) {
    for (let y = inner[1] + 2, row = 0; y < inner[1] + inner[3] - 3; y += 8, row++) {
      const lit = tone.isLit && hash2(seed, row) % 3 === 0;
      fillBox(ctx, [inner[0], y, inner[2], 3.2], lit ? tone.lit : tone.glass, 1);
    }
  } else {
    paintWindowGrid(ctx, inner, { cols: Math.max(2, Math.round(inner[2] / 7)), rows: Math.max(3, Math.round(inner[3] / 9)), seed }, tone);
  }
  if (variant === 0) {
    fillBox(ctx, [b.x + b.w * 0.42, top - b.h * 0.08, 1.4, b.h * 0.08], tone.frame);
    if (tone.isLit) fillDisc(ctx, b.x + b.w * 0.42 + 0.7, top - b.h * 0.08, 1.6, '#f87171');
  } else if (variant === 2) {
    fillBox(ctx, [b.x + b.w * 0.2, top - 4, b.w * 0.45, 4], tone.wallShade);
  }
}

/**
 * 中層ビル（Lv2）を描く。地上階を地区色の日よけの店にすることもある。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 * @param opts 模様の種・地上階を店にするか
 */
export function paintMidrise(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, opts: { readonly seed: number; readonly shopBase?: boolean }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const top = b.base - b.h;
  const side = Math.max(2, b.w * 0.14);
  const baseH = opts.shopBase === true ? Math.min(18, b.h * 0.24) : 0;
  fillBox(ctx, [b.x, top, b.w, b.h], opts.seed % 2 === 0 ? tone.wall : tone.wallAlt);
  fillBox(ctx, [b.x + b.w - side, top, side, b.h], tone.wallShade);
  fillBox(ctx, [b.x - 1, top, b.w + 2, 2.5], tone.frame);
  const area: [number, number, number, number] = [b.x + 3, top + 6, b.w - side - 6, b.h - baseH - 10];
  paintWindowGrid(ctx, area, { cols: Math.max(2, Math.round(area[2] / 9)), rows: Math.max(2, Math.round(area[3] / 11)), seed: opts.seed }, tone);
  if (baseH <= 0) return;
  const gy = b.base - baseH;
  fillBox(ctx, [b.x + 2, gy + 5, b.w - side - 4, baseH - 5], tone.isLit ? mixColors(tone.glass, tone.lit, 0.5) : tone.glass);
  paintGlassShine(ctx, [b.x + 2, gy + 5, b.w - side - 4, baseH - 5], tone);
  paintStripedAwning(ctx, [b.x, gy, b.w - side + 1, 5], tone);
}

/**
 * 地区色のストライプの日よけを描く（シルエットは無地）。
 * @param ctx 描画先
 * @param r 日よけの x・y・幅・高さ（上辺。下辺は左右に少し張り出す）
 * @param tone 色一式
 */
export function paintStripedAwning(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number], tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const [x, y, w, h] = r;
  const out = Math.max(1, w * 0.035);
  const shape: (readonly [number, number])[] = [[x, y], [x + w, y], [x + w + out, y + h], [x - out, y + h]];
  fillPoly(ctx, shape, tone.accent);
  if (tone.detail) {
    const count = Math.max(4, Math.round(w / 7)) | 1;
    const sw = (w + out * 2) / count;
    ctx.save();
    ctx.beginPath(); shape.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py))); ctx.closePath(); ctx.clip();
    for (let i = 1; i < count; i += 2) fillBox(ctx, [x - out + i * sw, y, sw, h], '#ffffff');
    ctx.restore();
  }
  fillBox(ctx, [x - out, y + h, w + out * 2, Math.max(1, h * 0.18)], tone.accentDeep);
}

/**
 * 低層の店（ガラス張りの店先・地区色のストライプの日よけ・カテゴリのアイコンの看板）を描く。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 * @param opts 看板のアイコン・2階建てか・模様の種
 */
export function paintShopfront(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, opts: { readonly icon?: ShopIcon; readonly floors?: 1 | 2; readonly seed: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const top = b.base - b.h;
  const two = opts.floors === 2;
  fillBox(ctx, [b.x, top, b.w, b.h], opts.seed % 2 === 0 ? tone.wall : tone.wallAlt);
  fillBox(ctx, [b.x - 1, top, b.w + 2, Math.max(2, b.h * 0.05)], tone.frame);
  if (two) paintWindowGrid(ctx, [b.x + b.w * 0.08, top + b.h * 0.1, b.w * 0.84, b.h * 0.26], { cols: 2, rows: 1, seed: opts.seed }, tone);
  const signY = top + b.h * (two ? 0.42 : 0.12);
  const signH = Math.max(3, b.h * 0.15);
  fillBox(ctx, [b.x + b.w * 0.06, signY, b.w * 0.88, signH], tone.accentDeep, Math.min(2, signH / 3));
  if (opts.icon !== undefined && tone.detail && signH >= 6) {
    fillDisc(ctx, b.x + b.w / 2, signY + signH / 2, signH * 0.42, '#ffffff');
    paintShopIcon(ctx, opts.icon, { x: b.x + b.w / 2, y: signY + signH / 2 }, signH * 0.3, tone.accentDeep);
  }
  const awnY = signY + signH + Math.max(1, b.h * 0.02);
  const awnH = Math.max(3, b.h * 0.14);
  paintStripedAwning(ctx, [b.x + b.w * 0.04, awnY, b.w * 0.92, awnH], tone);
  const glassY = awnY + awnH + Math.max(2, b.h * 0.06);
  const glassH = b.base - glassY - 1;
  const win: [number, number, number, number] = [b.x + b.w * 0.08, glassY, b.w * 0.54, glassH];
  fillBox(ctx, win, tone.isLit ? mixColors(tone.glass, tone.lit, 0.55) : tone.glass, 1);
  paintGlassShine(ctx, win, tone);
  fillBox(ctx, [b.x + b.w * 0.68, glassY - 1, b.w * 0.24, glassH + 1], tone.glassDeep, 1);
  if (tone.detail) fillBox(ctx, [b.x + b.w * 0.72, glassY + glassH * 0.45, 1.2, glassH * 0.2], tone.wall);
}

/**
 * 街路樹（フラットな2トーンの樹冠＋細い幹）を描く。光沢は付けず、右半分を濃い色にして立体を示す（docs/08 §10.5）。
 * 樹冠は少し縦長の楕円で、幹は足元（b.base）で止める（地面より下へ突き抜けない）。
 * @param ctx 描画先
 * @param b 範囲（幅＝葉の直径、高さ＝全体の高さ）
 * @param tone 色一式
 * @param blossom 桜色にするか
 */
export function paintStreetTree(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, blossom = false): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const cx = b.x + b.w / 2;
  const rx = b.w / 2;
  const ry = Math.min(rx * 1.18, b.h * 0.42);
  const cy = b.base - b.h + ry;
  fillBox(ctx, [cx - Math.max(0.8, rx * 0.09), cy, Math.max(1.6, rx * 0.18), Math.max(0, b.base - cy)], tone.trunk);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = blossom ? tone.blossom : tone.leaf;
  ctx.fill();
  if (tone.detail) {
    ctx.clip();
    ctx.fillStyle = blossom ? tone.blossomDeep : tone.leafDeep;
    ctx.fillRect(cx, cy - ry, rx, ry * 2);
  }
  ctx.restore();
}

/**
 * 街灯（細い柱と腕・ライトアップ中は光る）を描く。
 * @param ctx 描画先
 * @param x 柱の X
 * @param base 足元の Y
 * @param h 高さ
 * @param tone 色一式
 */
export function paintStreetLamp(ctx: CanvasRenderingContext2D, x: number, base: number, h: number, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const top = base - h;
  const arm = h * 0.22;
  if (tone.isLit) {
    const glow = ctx.createRadialGradient(x + arm, top + 2, 0, x + arm, top + 2, h * 0.55);
    glow.addColorStop(0, 'rgba(253, 230, 138, 0.75)');
    glow.addColorStop(1, 'rgba(253, 230, 138, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x + arm - h * 0.55, top + 2 - h * 0.55, h * 1.1, h * 1.1);
  }
  fillBox(ctx, [x - 0.8, top, 1.6, h], tone.ink);
  fillBox(ctx, [x - 0.8, top, arm + 1, 1.6], tone.ink);
  fillBox(ctx, [x + arm - 2.6, top + 1, 5.2, 2.4], tone.isLit ? tone.lit : tone.frame, 1);
}

/**
 * 淡い空色のグラデーションで範囲を塗る。
 * @param ctx 描画先
 * @param r x・y・幅・高さ
 * @param colors 上・下の色（省略時は空色）
 */
export function paintSky(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number], colors: readonly [string, string] = [SKY_TOP, SKY_BOTTOM]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const g = ctx.createLinearGradient(0, r[1], 0, r[1] + r[3]);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  ctx.fillStyle = g;
  ctx.fillRect(r[0], r[1], r[2], r[3]);
}

/**
 * 雲（白い角丸の帯＋ふくらみ）を描く。
 * @param ctx 描画先
 * @param x 左端
 * @param y 下端
 * @param w 幅
 */
export function paintCloud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.globalAlpha = 0.85;
  const h = w * 0.22;
  fillBox(ctx, [x, y - h, w, h], '#ffffff', h / 2);
  fillDisc(ctx, x + w * 0.42, y - h, h * 0.95, '#ffffff');
  fillDisc(ctx, x + w * 0.66, y - h * 0.8, h * 0.6, '#ffffff');
  ctx.restore();
}

/**
 * 遠景のビル群（細部なしの淡い形）を横に並べる。world 座標の位置から高さを決めるので、パララックスで動かしても形が変わらない。
 * @param ctx 描画先
 * @param range 描く範囲（画面の左端・右端の X）
 * @param opts 足元の Y・ずらし量（world→画面）・色・高さの範囲・種
 */
export function paintFarSkyline( // audit-ignore: fnlog-missing 毎フレーム描画
  ctx: CanvasRenderingContext2D,
  range: { readonly from: number; readonly to: number },
  opts: { readonly base: number; readonly offset: number; readonly color: string; readonly minH: number; readonly maxH: number; readonly seed: number; readonly unit?: number },
): void {
  const unit = opts.unit ?? 22;
  const first = Math.floor((range.from + opts.offset) / unit) - 1;
  const last = Math.ceil((range.to + opts.offset) / unit) + 1;
  ctx.fillStyle = opts.color;
  for (let i = first; i <= last; i++) {
    const v = hash2(i, opts.seed);
    if (v % 7 === 0) continue;
    const h = opts.minH + (v % 1000) / 1000 * (opts.maxH - opts.minH);
    const w = unit * (0.7 + ((v >>> 10) % 30) / 100);
    const x = i * unit - opts.offset;
    ctx.fillRect(x, opts.base - h, w, h);
    if ((v >>> 4) % 4 === 0) ctx.fillRect(x + w * 0.45, opts.base - h - h * 0.14, 1.2, h * 0.14);
  }
}
