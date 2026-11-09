/**
 * @file 地図の「絵」の描画（presentation/screens/Map 層。状態を持たない純粋な draw 関数群）
 * コンセプト「紙の上に育つ、ミニチュアの街」：紙の地・海・地区の島（有機的な輪郭・柔らかい浮き影・水彩のグラデーション）、
 * 木・家・灯り（成長Lvで密度が増える）、霧のかかった山並み（Lv0＝未開拓）を描く。
 * 色あせは彩度低下＋セピア＋破線の輪郭（色だけに頼らない＝CLAUDE.md 6.1。◌ はラベル側で付ける）。
 * requestAnimationFrame から毎フレーム呼ぶので関数ログは出さない（呼び出し側 MapScreen でまとめてログ）。座標は CSS px。
 */
import { mixColors, scaleSaturation, toRgba } from '@/Common/ui/canvas/colorUtils';
import type { FadeVisual } from '@/Common/ui/canvas/fadeStyle';
import { distance2D, pointInPolygon, polygonBounds, polygonCentroid } from '@/Common/ui/canvas/geometry';
import type { Point2D, Rect } from '@/Common/ui/canvas/geometry';
import { hashString, seededRandomFor } from '@/Common/ui/canvas/seededHash';
import { PALETTE } from '@/Common/ui/theme/palette';

/** 成長段階ごとに地区色へ混ぜる紙色の割合（Lv が上がるほど色が濃く、はっきり色づく） */
/** 成長段階ごとの地区の塗りの不透明度（docs/08 §10.4。Lv0 は塗らない） */
export const LEVEL_FILL_ALPHA: readonly number[] = [0, 0.16, 0.24, 0.32];
export const LEVEL_PAPER_MIX: readonly number[] = [0.9, 0.62, 0.46, 0.3];
/** 成長段階ごとの木の本数（Lv0 は霧の山並みなので木は描かない） */
export const LEVEL_TREE_COUNT: readonly number[] = [0, 6, 8, 11];
/** Lv3 で灯る街灯の数 */
const LAMP_COUNT = 7;
/** 地区どうしの間に見せる紙の余白（CSS px。片側） */
const DISTRICT_INSET_PX = 5;
/** 輪郭のゆらぎ（メートル）。画面では 1〜4px に丸める */
const WOBBLE_M = 0;
/** 1辺を何分割してゆらがせるか（ズームで形が変わらないよう固定） */
const EDGE_SUBDIVISIONS = 6;
/** 木・家の大きさ（メートル） */
const TREE_SIZE_M = 52;
const HOUSE_SIZE_M = 56;
/** 島の厚み（CSS px。紙を重ねたジオラマの台の側面） */
const ISLAND_THICKNESS_PX = 5;
/** 木をスポットからこれだけ離す（CSS px） */
const TREE_SPOT_CLEARANCE_PX = 16;
/** 紙の質感パターンの1辺（CSS px） */
const PAPER_TILE_PX = 180;

/** 地区の島を描くための入力 */
export interface IslandInput {
  readonly id: string;
  /** '#rrggbb'（マスタの地区色） */
  readonly color: string;
  readonly level: number;
  readonly fade: FadeVisual;
  /** 画面座標の地区ポリゴン */
  readonly polygon: readonly Point2D[];
  /** 1 CSS px あたりのメートル */
  readonly metersPerPx: number;
  /** 地区・近接ズーム（スポットを見やすくするため少し淡く） */
  readonly zoomed: boolean;
  /** 注目中の地区（輪郭を少し強める） */
  readonly focused: boolean;
  /** 塗りの不透明度（0〜1。背景の道路・川を透かすとき 1 未満。省略時 1） */
  readonly wash?: number;
}

let paperPattern: CanvasPattern | null | undefined;

/**
 * 紙の質感（細かい繊維と点）のパターンを1度だけ作って使い回す。
 * @param ctx 描画先のコンテキスト（パターン生成に使う）
 * @returns パターン（作れなければ null）
 * @sideEffect 初回だけ作業用の canvas を作る
 */
function paperTexture(ctx: CanvasRenderingContext2D): CanvasPattern | null { // audit-ignore: fnlog-missing 毎フレーム描画（初回だけ生成するキャッシュ）
  if (paperPattern !== undefined) return paperPattern;
  const tile = document.createElement('canvas');
  tile.width = PAPER_TILE_PX;
  tile.height = PAPER_TILE_PX;
  const t = tile.getContext('2d');
  if (t === null) return (paperPattern = null);
  const random = seededRandomFor('paper-texture');
  for (let i = 0; i < 520; i++) {
    t.fillStyle = toRgba(PALETTE.paperFiber, 0.12 + random() * 0.22);
    t.fillRect(random() * PAPER_TILE_PX, random() * PAPER_TILE_PX, 0.6 + random() * 0.9, 0.6 + random() * 0.9);
  }
  t.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = random() * PAPER_TILE_PX;
    const y = random() * PAPER_TILE_PX;
    const a = random() * Math.PI;
    t.strokeStyle = toRgba(PALETTE.paperFiber, 0.18 + random() * 0.15);
    t.lineWidth = 0.6;
    t.beginPath();
    t.moveTo(x, y);
    t.quadraticCurveTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5 + 2, x + Math.cos(a) * 10, y + Math.sin(a) * 10);
    t.stroke();
  }
  paperPattern = ctx.createPattern(tile, 'repeat');
  return paperPattern;
}

/**
 * 地図の地（淡いクールグレーのベースマップの陸）を画面いっぱいに塗る。テクスチャ・陰りは付けない（docs/08 §10.4）。
 * @param ctx 2D コンテキスト
 * @param width 幅（CSS px）
 * @param height 高さ（CSS px）
 * @sideEffect ctx に描画する
 */
export function drawPaper(ctx: CanvasRenderingContext2D, width: number, height: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.fillStyle = PALETTE.land;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * 海（海岸線より下）を描く。砂浜の帯・白い波打ち際・沖へ深くなるグラデーション・小さな波。
 * @param ctx 2D コンテキスト
 * @param coast 海岸線の点列（左から右）
 * @param size 描画領域の幅・高さ
 * @param waveOrigin 波の模様の基準点（地図に固定して一緒に動かす）
 * @param spacing 波の模様の間隔（CSS px）
 * @sideEffect ctx に描画する
 */
export function drawSea(ctx: CanvasRenderingContext2D, coast: readonly Point2D[], size: { readonly width: number; readonly height: number }, waveOrigin: Point2D, spacing: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (coast.length < 2) return;
  const top = Math.min(...coast.map((p) => p.y));
  ctx.save();
  ctx.beginPath();
  coast.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.lineTo(size.width + 8, size.height + 8);
  ctx.lineTo(-8, size.height + 8);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, top, 0, Math.max(top + 1, size.height));
  grad.addColorStop(0, PALETTE.sea);
  grad.addColorStop(1, PALETTE.seaDeep);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.clip();
  drawWaveMarks(ctx, top, size, waveOrigin, spacing);
  ctx.restore();
  strokeLine(ctx, coast, toRgba(PALETTE.paperDeep, 0.9), 7);
  strokeLine(ctx, coast, toRgba(PALETTE.seaFoam, 0.85), 2.5);
}

/**
 * 海の小さな波の模様（白い弧）を描く。
 * @param ctx 2D コンテキスト（海でクリップ済み）
 * @param top 海の上端
 * @param size 描画領域
 * @param origin 模様の基準点
 * @param spacing 間隔
 * @sideEffect ctx に描画する
 */
function drawWaveMarks(ctx: CanvasRenderingContext2D, top: number, size: { readonly width: number; readonly height: number }, origin: Point2D, spacing: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.strokeStyle = toRgba(PALETTE.seaFoam, 0.55);
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  const rowGap = spacing * 0.45;
  for (let row = 0; top + 10 + row * rowGap < size.height; row++) {
    const y = top + 10 + row * rowGap;
    const shift = (row % 2) * spacing * 0.5;
    const first = Math.floor((0 - origin.x - shift) / spacing) - 1;
    for (let col = first; origin.x + shift + col * spacing < size.width + spacing; col++) {
      const x = origin.x + shift + col * spacing;
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.quadraticCurveTo(x - 2.5, y - 3, x, y);
      ctx.quadraticCurveTo(x + 2.5, y - 3, x + 5, y);
      ctx.stroke();
    }
  }
}

/**
 * 折れ線を描く（丸い端）。
 * @param ctx 2D コンテキスト
 * @param points 点列
 * @param color 色
 * @param width 線幅
 * @sideEffect ctx に描画する
 */
function strokeLine(ctx: CanvasRenderingContext2D, points: readonly Point2D[], color: string, width: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/**
 * 地区ポリゴンを「紙の上の島」の輪郭にする（重心へ少し縮めて余白を作り、辺をやさしくゆらがせる）。
 * ゆらぎは地区ID から決定論的に決め、辺の分割数を固定してズーム中も形が変わらないようにする。
 * @param polygon 画面座標のポリゴン
 * @param seedKey 乱数の種（地区ID）
 * @param metersPerPx 1 CSS px あたりのメートル
 * @returns 輪郭の点列（smoothClosedPath で曲線にして描く）
 */
export function organicOutline(polygon: readonly Point2D[], seedKey: string, metersPerPx: number): Point2D[] { // audit-ignore: fnlog-missing 毎フレーム描画
  if (polygon.length < 3) return [...polygon];
  const c = polygonCentroid(polygon);
  const box = polygonBounds(polygon);
  const half = Math.max(1, Math.min(box.width, box.height) / 2);
  const k = Math.max(0.6, 1 - DISTRICT_INSET_PX / half);
  const pts = polygon.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
  const amp = Math.min(6, WOBBLE_M / Math.max(0.01, metersPerPx));
  const jitter = seededRandomFor(`outline:${seedKey}`);
  const phase = ((hashString(seedKey) % 1000) / 1000) * Math.PI * 2;
  const out: Point2D[] = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length] ?? a;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    for (let j = 0; j < EDGE_SUBDIVISIONS; j++) {
      const t = j / EDGE_SUBDIVISIONS;
      const w = amp * (0.7 * Math.sin(phase + i * 2.1 + j * 1.3) + 0.45 * Math.sin(phase * 1.7 + i * 0.9 + j * 2.9) + (jitter() - 0.5) * 0.5) * (0.35 + 0.65 * Math.sin(Math.PI * t));
      out.push({ x: a.x + (b.x - a.x) * t + nx * w, y: a.y + (b.y - a.y) * t + ny * w });
    }
  });
  return out;
}

/**
 * 点列を通るなめらかな閉じた曲線のパスを作る（各点を制御点、隣との中点を通過点にする）。
 * @param ctx 2D コンテキスト
 * @param pts 点列
 * @sideEffect ctx のパスを作り直す
 */
export function smoothClosedPath(ctx: CanvasRenderingContext2D, pts: readonly Point2D[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  traceSmoothPath(ctx, pts);
}

/**
 * 今のパスに、点列を通るなめらかな閉じた曲線を書き足す（beginPath はしない。くり抜きのクリップに使う）。
 * @param ctx 2D コンテキスト
 * @param pts 点列
 * @sideEffect ctx のパスに書き足す
 */
function traceSmoothPath(ctx: CanvasRenderingContext2D, pts: readonly Point2D[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const n = pts.length;
  const first = pts[0];
  const last = pts[n - 1];
  if (n < 3 || first === undefined || last === undefined) return;
  const start = midpoint(last, first);
  ctx.moveTo(start.x, start.y);
  pts.forEach((p, i) => {
    const m = midpoint(p, pts[(i + 1) % n] ?? p);
    ctx.quadraticCurveTo(p.x, p.y, m.x, m.y);
  });
  ctx.closePath();
}

/**
 * 島の側面（台の厚み）を描く。輪郭を下にずらした形を、島の外側だけに塗る（ジオラマの板の厚み）。
 * @param ctx 2D コンテキスト
 * @param outline 島の輪郭
 * @param color 側面の色
 * @sideEffect ctx に描画する
 */
function drawIslandSide(ctx: CanvasRenderingContext2D, outline: readonly Point2D[], color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.beginPath();
  ctx.rect(-10000, -10000, 20000, 20000);
  traceSmoothPath(ctx, outline);
  ctx.clip('evenodd');
  smoothClosedPath(ctx, outline.map((p) => ({ x: p.x, y: p.y + ISLAND_THICKNESS_PX })));
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**
 * 2点の中点を返す。
 * @param a 点
 * @param b 点
 * @returns 中点
 */
function midpoint(a: Point2D, b: Point2D): Point2D { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * 島の外側にだけ柔らかい浮き影を落とす（島の内側はくり抜くので、半透明の塗りでも中が濁らない）。
 * @param ctx 2D コンテキスト
 * @param outline 島の輪郭
 * @param soft 薄い影にするか（Lv0）
 * @sideEffect ctx に描画する
 */
function drawIslandShadow(ctx: CanvasRenderingContext2D, outline: readonly Point2D[], soft: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.beginPath();
  ctx.rect(-10000, -10000, 20000, 20000);
  traceSmoothPath(ctx, outline);
  ctx.clip('evenodd');
  smoothClosedPath(ctx, outline);
  ctx.shadowColor = soft ? PALETTE.shadowSoft : PALETTE.shadow;
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = PALETTE.paperDeep;
  ctx.fill();
  ctx.restore();
}

/**
 * 色あせを掛けた色を返す（彩度を落としてセピアに寄せ、紙色へなじませる）。
 * @param hex 元の色
 * @param fade 色あせの描画パラメータ
 * @returns '#rrggbb'
 */
export function fadeTone(hex: string, fade: FadeVisual): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な変換ヘルパー
  if (fade.saturation >= 1 && fade.alpha >= 1) return hex;
  const desaturated = scaleSaturation(hex, fade.saturation);
  const sepia = mixColors(desaturated, PALETTE.sepia, (1 - fade.saturation) * 0.55);
  return mixColors(sepia, PALETTE.paper, (1 - fade.alpha) * 0.9);
}

/**
 * 地区の塗りの基本色（成長段階で濃くなり、色あせでセピアになる）を返す。
 * @param input 地区の島の入力
 * @returns '#rrggbb'
 */
export function islandBaseColor(input: Pick<IslandInput, 'color' | 'level' | 'fade' | 'zoomed'>): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な変換ヘルパー
  const level = Math.min(3, Math.max(0, Math.round(input.level)));
  const mix = Math.min(0.92, (LEVEL_PAPER_MIX[level] ?? 0.5) + (input.zoomed ? 0.12 : 0));
  return fadeTone(mixColors(input.color, PALETTE.paper, mix), input.fade);
}

/**
 * 地区を「ベースマップに重ねる情報レイヤー」として描く（docs/08 §10.4）。角を丸めた輪郭に、成長段階で濃くなる半透明の地区色と 2px の実線。
 * Lv0 は灰色の破線輪郭とごく淡い斜線（未開拓）。色あせは彩度を落として灰色に寄せ、輪郭を破線にする。影・紙の縁は付けない。
 * @param ctx 2D コンテキスト
 * @param input 地区の入力
 * @returns 描いた輪郭の点列（木を地区の内側に置くのに使う）
 * @sideEffect ctx に描画する
 */
export function drawIsland(ctx: CanvasRenderingContext2D, input: IslandInput): Point2D[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const outline = organicOutline(input.polygon, input.id, input.metersPerPx);
  const box = polygonBounds(outline);
  const level = Math.min(3, Math.max(0, Math.round(input.level)));
  const tone = fadeTone(input.color, input.fade);
  ctx.save();
  smoothClosedPath(ctx, outline);
  if (level <= 0) {
    ctx.fillStyle = toRgba(PALETTE.mutedInk, 0.05);
    ctx.fill();
    ctx.clip();
    drawHatch(ctx, box);
  } else {
    ctx.fillStyle = toRgba(tone, (LEVEL_FILL_ALPHA[level] ?? 0.24) * (input.zoomed ? 0.7 : 1) * input.fade.alpha);
    ctx.fill();
  }
  ctx.restore();
  drawIslandRim(ctx, outline, input, tone);
  return outline;
}

/**
 * 未開拓（Lv0）の地区にごく淡い斜線を引く。
 * @param ctx 2D コンテキスト（地区でクリップ済み）
 * @param box 地区の外接矩形
 * @sideEffect ctx に描画する
 */
function drawHatch(ctx: CanvasRenderingContext2D, box: Rect): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.strokeStyle = toRgba(PALETTE.mutedInk, 0.14);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = box.x - box.height; x < box.x + box.width; x += 9) {
    ctx.moveTo(x, box.y + box.height);
    ctx.lineTo(x + box.height, box.y);
  }
  ctx.stroke();
}

/**
 * 地区の輪郭線を描く（細い実線。破線は色あせの地区だけ＝色だけに頼らない）。
 * @param ctx 2D コンテキスト
 * @param outline 輪郭の点列
 * @param input 地区の入力
 * @param tone 色あせを掛けた地区色
 * @sideEffect ctx に描画する
 */
function drawIslandRim(ctx: CanvasRenderingContext2D, outline: readonly Point2D[], input: IslandInput, tone: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const lv0 = input.level <= 0;
  const dashed = input.fade.dashed;
  ctx.save();
  smoothClosedPath(ctx, outline);
  ctx.strokeStyle = lv0 ? toRgba(PALETTE.mutedInk, 0.55) : toRgba(tone, 0.85);
  ctx.lineWidth = input.focused ? 2 : 1.5;
  if (dashed) ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.restore();
}

/**
 * 地面の模様（草のちょぼちょぼ）を描く。Lv が上がるほど密になる。
 * @param ctx 2D コンテキスト（島でクリップ済み）
 * @param box 島の外接矩形
 * @param input 地区の島の入力
 * @param base 塗りの基本色
 * @sideEffect ctx に描画する
 */
function drawGroundSpeckles(ctx: CanvasRenderingContext2D, box: Rect, input: IslandInput, base: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const random = seededRandomFor(`ground:${input.id}`);
  const count = Math.min(90, Math.round((box.width * box.height) / 700));
  ctx.strokeStyle = toRgba(mixColors(base, '#2a3020', 0.35), 0.22);
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = box.x + random() * box.width;
    const y = box.y + random() * box.height;
    ctx.beginPath();
    ctx.moveTo(x - 2, y);
    ctx.lineTo(x - 1, y - 2.5);
    ctx.moveTo(x + 1, y);
    ctx.lineTo(x + 2, y - 2.5);
    ctx.stroke();
  }
}

/**
 * 霧のかかった「未開拓」の地（Lv0）を描く。ごく淡い丘の影の上に、白い霧のかたまりを重ねる（貼り絵に見えないよう輪郭をぼかす）。
 * @param ctx 2D コンテキスト（島でクリップ済み）
 * @param box 島の外接矩形
 * @param seedKey 乱数の種（地区ID）
 * @sideEffect ctx に描画する
 */
function drawMistyMountains(ctx: CanvasRenderingContext2D, box: Rect, seedKey: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const random = seededRandomFor(`mist:${seedKey}`);
  for (let i = 0; i < 4; i++) {
    const cx = box.x + box.width * (0.1 + random() * 0.8);
    const r = Math.max(box.width, box.height) * (0.28 + random() * 0.18);
    const g = ctx.createRadialGradient(cx, box.y + box.height * 0.95, r * 0.1, cx, box.y + box.height * 0.95, r);
    g.addColorStop(0, toRgba(PALETTE.mountainNear, 0.55));
    g.addColorStop(1, toRgba(PALETTE.mountainNear, 0));
    ctx.fillStyle = g;
    ctx.fillRect(box.x, box.y, box.width, box.height);
  }
  for (const [ratio, color, peaks] of [[0.62, PALETTE.mountainFar, 3], [0.82, PALETTE.mountainNear, 4]] as const) {
    const baseY = box.y + box.height * ratio;
    const step = box.width / peaks;
    ctx.beginPath();
    ctx.moveTo(box.x - 4, box.y + box.height + 4);
    ctx.lineTo(box.x - 4, baseY);
    for (let i = 0; i < peaks; i++) ctx.quadraticCurveTo(box.x + step * (i + 0.5), baseY - box.height * (0.18 + random() * 0.14), box.x + step * (i + 1), baseY);
    ctx.lineTo(box.x + box.width + 4, box.y + box.height + 4);
    ctx.closePath();
    ctx.fillStyle = toRgba(color, 0.75);
    ctx.fill();
  }
  for (let i = 0; i < 7; i++) {
    const cx = box.x + box.width * random();
    const cy = box.y + box.height * (0.15 + random() * 0.8);
    const r = Math.min(box.width, box.height) * (0.22 + random() * 0.25);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.6, r, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 島の内側に木を植える（Lv で本数が増える。位置は地区ID から決定論的で、ズームしても同じ場所）。
 * @param ctx 2D コンテキスト
 * @param outline 島の輪郭（画面座標）
 * @param input 地区の島の入力
 * @param avoid 避ける点（スポットのピン）
 * @sideEffect ctx に描画する
 */
export function drawTrees(ctx: CanvasRenderingContext2D, outline: readonly Point2D[], input: IslandInput, avoid: readonly Point2D[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const level = Math.min(3, Math.max(0, Math.round(input.level)));
  const count = LEVEL_TREE_COUNT[level] ?? 0;
  if (count === 0) return;
  const box = polygonBounds(input.polygon);
  const random = seededRandomFor(`trees:${input.id}`);
  const size = Math.min(18, Math.max(10, TREE_SIZE_M / Math.max(0.01, input.metersPerPx)));
  const canopy = fadeTone(PALETTE.tree, input.fade);
  const dark = fadeTone(PALETTE.treeDark, input.fade);
  let planted = 0;
  for (let i = 0; i < count * 4 && planted < count; i++) {
    const at = { x: box.x + box.width * (0.08 + random() * 0.84), y: box.y + box.height * (0.14 + random() * 0.8) };
    if (!pointInPolygon(at, outline) || avoid.some((p) => distance2D(p, at) < TREE_SPOT_CLEARANCE_PX + size)) continue;
    drawTree(ctx, at, size, canopy, dark);
    planted++;
  }
}

/**
 * 街路樹を1本描く（上から見た小さな緑の丸＋ごく弱い影）。
 * @param ctx 2D コンテキスト
 * @param at 位置（CSS px）
 * @param size 大きさ（CSS px）
 * @param canopy 樹冠の色
 * @param dark 樹冠の縁の色
 * @sideEffect ctx に描画する
 */
function drawTree(ctx: CanvasRenderingContext2D, at: Point2D, size: number, canopy: string, dark: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const r = size * 0.32;
  ctx.save();
  ctx.fillStyle = PALETTE.shadowSoft;
  ctx.beginPath();
  ctx.arc(at.x + 0.8, at.y + 1.2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = canopy;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** 家の描画パラメータ */
export interface HouseStyle {
  /** 大きさ（CSS px） */
  readonly size: number;
  /** 屋根の色 */
  readonly roof: string;
  /** 窓に灯りをともすか（Lv3） */
  readonly lit: boolean;
  /** 色あせ（壁・屋根の色に掛ける） */
  readonly fade: FadeVisual;
  /** 建物の段数（高さの倍率。省略時は灯りありなら 1.7、なしなら 1） */
  readonly storeys?: number;
}

/**
 * 家の大きさ（CSS px）を縮尺から求める。
 * @param metersPerPx 1 CSS px あたりのメートル
 * @returns 12〜22px
 */
export function houseSize(metersPerPx: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  return Math.min(22, Math.max(12, HOUSE_SIZE_M / Math.max(0.01, metersPerPx)));
}

/**
 * 建物を1棟描く（白いブロックの小さな立体。上面は白、手前の面は淡いグレー、ごく弱い影。Apple マップの3D風。docs/08 §10.4）。
 * 屋根の端に地区色の細い線を引いて地区を見分けやすくし、Lv3 は背を高くして窓に灯りをともす。
 * @param ctx 2D コンテキスト
 * @param at 建物の足もと中央（CSS px）
 * @param style 建物の描画パラメータ
 * @sideEffect ctx に描画する
 */
export function drawHouse(ctx: CanvasRenderingContext2D, at: Point2D, style: HouseStyle): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const w = style.size * 0.7;
  const d = w * 0.55;
  const hgt = w * 0.55 * (style.storeys ?? (style.lit ? 1.7 : 1));
  const x = at.x - w / 2;
  const top = at.y - d - hgt;
  const edge = fadeTone(style.roof, style.fade);
  ctx.save();
  ctx.fillStyle = PALETTE.shadowSoft;
  ctx.beginPath();
  ctx.ellipse(at.x + w * 0.2, at.y + 1, w * 0.62, w * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#dfe3e9';
  ctx.fillRect(x, top + d, w, hgt);
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  ctx.roundRect(x, top, w, d, 1.5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(17, 24, 39, 0.12)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(x, top, w, d + hgt);
  ctx.fillStyle = edge;
  ctx.fillRect(x, top + d - 1.6, w, 1.6);
  if (style.lit) {
    ctx.fillStyle = PALETTE.lamp;
    for (let i = 0; i < 2; i++) ctx.fillRect(x + w * (0.2 + i * 0.4), top + d + hgt * 0.3, w * 0.2, hgt * 0.22);
  }
  ctx.restore();
}

/**
 * 多角形を塗って縁取る（家の各面）。
 * @param ctx 2D コンテキスト（strokeStyle・lineWidth 設定済み）
 * @param pts 頂点 [x, y] の列
 * @param fill 塗り色
 * @sideEffect ctx に描画する
 */
function fillPoly(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], fill: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

/**
 * 灯りのにじみ（暖色の放射グラデーション）を描く。
 * @param ctx 2D コンテキスト
 * @param at 中心
 * @param r 半径
 * @sideEffect ctx に描画する
 */
function drawGlow(ctx: CanvasRenderingContext2D, at: Point2D, r: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
  g.addColorStop(0, PALETTE.lampGlow);
  g.addColorStop(1, 'rgba(255, 196, 80, 0)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Lv3 の地区に街灯（提灯のような灯り）をともす。位置は地区ID から決定論的。
 * @param ctx 2D コンテキスト
 * @param outline 島の輪郭
 * @param input 地区の島の入力
 * @param avoid 避ける点（スポットのピン）
 * @sideEffect ctx に描画する
 */
export function drawLamps(ctx: CanvasRenderingContext2D, outline: readonly Point2D[], input: IslandInput, avoid: readonly Point2D[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (input.level < 3) return;
  const box = polygonBounds(input.polygon);
  const random = seededRandomFor(`lamps:${input.id}`);
  const lamp = fadeTone(PALETTE.lamp, input.fade);
  for (let i = 0; i < LAMP_COUNT; i++) {
    const at = { x: box.x + box.width * (0.1 + random() * 0.8), y: box.y + box.height * (0.15 + random() * 0.75) };
    if (!pointInPolygon(at, outline) || avoid.some((p) => distance2D(p, at) < TREE_SPOT_CLEARANCE_PX)) continue;
    drawGlow(ctx, at, 9);
    ctx.save();
    ctx.strokeStyle = 'rgba(70, 50, 30, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(at.x, at.y + 6);
    ctx.lineTo(at.x, at.y);
    ctx.stroke();
    ctx.fillStyle = lamp;
    ctx.beginPath();
    ctx.arc(at.x, at.y - 1, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
