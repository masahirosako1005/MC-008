/**
 * @file 地図に重ねる追加の絵（presentation/screens/Map/town 層。毎フレーム描く）
 * 2026-11-09 ユーザー指示に合わせて足したもの:
 * - 「広域は町とかのレベルで大きなブロックにして、タップすると中域になるような表現」→ drawDistrictBlocks（地区を色の面と大きな札で描く）
 * - 「陣取り＋街の成長要素」→ drawRisingBuildings（領地が広がった所で、建物が下からにょきっと建ち上がる）
 * - 「自分のアイコンが街に埋もれている」→ drawSelfBeacon（足もとの光・広がる輪・白い台座）
 * 色はテーマ（ブランドのオレンジ #bc5b1b、TERRITORY_MINE_COLOR）に合わせる。座標はログに出さない。
 */
import { canvasFont } from '@/Common/ui/canvas/drawUtils';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { project } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, MapDistrictVm, Viewport } from '@/presentation/screens/Map/MapViewModel';
import type { TerritoryModel } from '@/presentation/screens/Map/town/territory';
import { VIVID_BUILDING_COLORS } from '@/presentation/screens/Map/town/townArtSimple';
import type { GridTransform } from '@/presentation/screens/Map/town/townRenderer';
import { TERRITORY_MINE_COLOR, TERRITORY_RIVAL_COLOR } from '@/presentation/screens/Map/town/townTypes';
import type { TownGrid } from '@/presentation/screens/Map/town/townTypes';

/** インク（文字・輪郭） */
const INK = '#1f2430';
/** 建ち上がりの長さ（ミリ秒） */
export const RISE_MS = 520;
/** 中心から遠い建物ほど遅れて建つ（ミリ秒／セル） */
const RISE_DELAY_PER_CELL_MS = 34;

/** 建ち上がる建物（セル座標） */
export interface RisingBuilding {
  readonly col: number;
  readonly row: number;
  readonly w: number;
  readonly h: number;
  readonly color: string;
  /** 演出の中心からの距離（セル） */
  readonly dist: number;
}

/** 建ち上がりの演出 */
export interface RiseAnimation {
  readonly buildings: readonly RisingBuilding[];
  readonly startedAt: number;
}

/**
 * 新しく領地になったセルにある建物を、建ち上がりの演出用に集める（近い順）。
 * @param grid 街
 * @param cells 新しく領地になったセル
 * @param center 演出の中心
 * @returns 建物
 */
export function risingBuildingsOf(grid: TownGrid, cells: readonly number[], center: { readonly col: number; readonly row: number }): RisingBuilding[] { // audit-ignore: fnlog-missing チェックインのたびに1回呼ぶ純粋な集計（呼び出し側でログ）
  const seen = new Set<number>();
  const out: RisingBuilding[] = [];
  for (const i of cells) {
    const b = grid.buildingAt[i] ?? -1;
    if (b < 0 || seen.has(b)) continue;
    seen.add(b);
    const building = grid.buildings[b];
    if (building === undefined) continue;
    out.push({
      col: building.col,
      row: building.row,
      w: building.w,
      h: building.h,
      color: VIVID_BUILDING_COLORS[building.roof] ?? '#d9dde6',
      dist: Math.hypot(building.col + building.w / 2 - center.col, building.row + building.h / 2 - center.row),
    });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/**
 * 演出の長さ（いちばん遠い建物が建ち終わるまで）。
 * @param anim 演出
 * @returns ミリ秒
 */
export function riseDuration(anim: RiseAnimation): number { // audit-ignore: fnlog-missing 毎フレーム描画
  const last = anim.buildings[anim.buildings.length - 1];
  return (last?.dist ?? 0) * RISE_DELAY_PER_CELL_MS + RISE_MS;
}

/**
 * 建物が下から建ち上がる演出を描く（地面で隠してから、少し行き過ぎて止まる高さで描く）。
 * @param ctx 2D コンテキスト
 * @param anim 演出
 * @param tr セル → 画面の変換
 * @param vp 描画領域
 * @param now 現在時刻
 * @returns まだ続くなら true
 * @sideEffect canvas に描く
 */
export function drawRisingBuildings(ctx: CanvasRenderingContext2D, anim: RiseAnimation, tr: GridTransform, vp: Viewport, now: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
  const elapsed = now - anim.startedAt;
  if (elapsed > riseDuration(anim)) return false;
  ctx.save();
  for (const b of anim.buildings) {
    const local = elapsed - b.dist * RISE_DELAY_PER_CELL_MS;
    const x = tr.ox + b.col * tr.cellW + 1;
    const y = tr.oy + b.row * tr.cellH + 1;
    const w = b.w * tr.cellW - 2;
    const h = b.h * tr.cellH - 2;
    if (x > vp.width || y > vp.height || x + w < 0 || y + h < 0) continue;
    if (local >= RISE_MS) continue;
    // まだ建っていない間は地面で隠す（下に描かれた完成済みの建物を見せない）
    ctx.fillStyle = '#fdf5ed';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    if (local < 0) continue;
    const k = local / RISE_MS;
    const s = 1.70158;
    const grow = Math.max(0, 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2);
    const hh = h * grow;
    ctx.fillStyle = 'rgba(30, 40, 70, 0.18)';
    ctx.fillRect(x, y + h - hh + 2, w, hh);
    ctx.fillStyle = b.color;
    ctx.fillRect(x, y + h - hh, w, hh);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(x, y + h - hh, w, Math.min(2, hh));
    if (k < 0.5) {
      ctx.globalAlpha = 1 - k * 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 2, y + h - 2, w + 4, 3);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  return true;
}

/**
 * 自分の位置の目印（足もとの光・広がる輪・白い台座）。アバターより先に描く。
 * @param ctx 2D コンテキスト
 * @param p 足もとの画面座標
 * @param now 現在時刻
 * @param tier 寄り具合（引いて見るほど目印を大きく）
 * @sideEffect canvas に描く
 */
export function drawSelfBeacon(ctx: CanvasRenderingContext2D, p: Point2D, now: number, tier: 'wide' | 'district' | 'near'): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const scale = tier === 'near' ? 1 : tier === 'district' ? 1.15 : 1.3;
  ctx.save();
  const glow = ctx.createRadialGradient(p.x, p.y - 10, 2, p.x, p.y - 10, 40 * scale);
  glow.addColorStop(0, 'rgba(188, 91, 27, 0.38)');
  glow.addColorStop(1, 'rgba(188, 91, 27, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(p.x, p.y - 10, 40 * scale, 0, Math.PI * 2);
  ctx.fill();
  for (const phase of [0, 0.5]) {
    const k = ((now / 1500 + phase) % 1 + 1) % 1;
    ctx.globalAlpha = 0.75 * (1 - k);
    ctx.strokeStyle = TERRITORY_MINE_COLOR;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, (12 + k * 30) * scale, (5 + k * 12) * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = TERRITORY_MINE_COLOR;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 15 * scale, 6 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * 広域の地区ブロック（地区を色の面・太い縁・大きな札で描く。タップすると中域へ）。
 * 札には地区名・Lv・自分の領地の割合（棒）・領主を出す。下の街は薄く白で覆って、ブロックを主役にする。
 * @param ctx 2D コンテキスト
 * @param districts 地区
 * @param camera カメラ
 * @param vp 描画領域
 * @param territory 領地（地区ごとのマス数）
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
export function drawDistrictBlocks(ctx: CanvasRenderingContext2D, districts: readonly MapDistrictVm[], camera: Camera, vp: Viewport, territory: TerritoryModel, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.fillRect(0, 0, vp.width, vp.height);
  for (const d of districts) {
    const pts = d.polygon.map((ll) => project(camera, vp, ll));
    if (pts.length < 3) continue;
    const path = new Path2D();
    pts.forEach((p, k) => (k === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
    path.closePath();
    ctx.globalAlpha = Math.max(0.5, d.fade.alpha);
    ctx.fillStyle = withAlpha(d.color, 0.2 + Math.min(3, d.level) * 0.08);
    ctx.fill(path);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 7;
    ctx.stroke(path);
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 3;
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
  for (const d of districts) drawBlockLabel(ctx, d, project(camera, vp, d.center), territory, textScale);
  ctx.restore();
}

/**
 * 地区ブロックの札（地区名＋Lv、領地の割合の棒、領主）。
 * @param ctx 2D コンテキスト
 * @param d 地区
 * @param at 札の中心
 * @param territory 領地
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawBlockLabel(ctx: CanvasRenderingContext2D, d: MapDistrictVm, at: Point2D, territory: TerritoryModel, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const mine = territory.mineByDistrict.get(d.id) ?? 0;
  const land = territory.landByDistrict.get(d.id) ?? 0;
  const ratio = land > 0 ? Math.min(1, mine / land) : 0;
  const title = d.shortName;
  const level = `Lv${d.level}`;
  ctx.font = canvasFont(16, 800, textScale);
  const tw = ctx.measureText(title).width;
  ctx.font = canvasFont(11, 800, textScale);
  const lw = ctx.measureText(level).width + 12;
  const w = Math.max(112, tw + lw + 30);
  const h = (!d.isLordMe && d.subtitle !== undefined ? 66 : 54) * textScale;
  const x = at.x - w / 2;
  const y = at.y - h / 2;
  ctx.globalAlpha = Math.max(0.6, d.fade.alpha);
  ctx.fillStyle = 'rgba(42, 33, 27, 0.16)';
  ctx.beginPath();
  ctx.roundRect(x, y + 3, w, h, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 12);
  ctx.fill();
  ctx.fillStyle = d.color;
  ctx.beginPath();
  ctx.roundRect(x, y, 6, h, [12, 0, 0, 12]);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = canvasFont(16, 800, textScale);
  ctx.fillText(title, x + 14, y + 17 * textScale);
  ctx.fillStyle = TERRITORY_MINE_COLOR;
  ctx.beginPath();
  ctx.roundRect(x + 18 + tw, y + 9 * textScale, lw, 16 * textScale, 8);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = canvasFont(11, 800, textScale);
  ctx.fillText(level, x + 24 + tw, y + 17 * textScale);
  if (d.isLordMe) drawCrown(ctx, x + w - 16, y + 17 * textScale);
  drawBlockBar(ctx, d, { x: x + 14, y: y + 33 * textScale, w: w - 28 }, ratio, textScale);
  ctx.globalAlpha = 1;
}

/**
 * 地区ブロックの札の下段（自分の領地の割合の棒と、領地の割合・領主）。
 * @param ctx 2D コンテキスト
 * @param d 地区
 * @param bar 棒の左・上・幅
 * @param ratio 領地の割合 0..1
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawBlockBar(ctx: CanvasRenderingContext2D, d: MapDistrictVm, bar: { x: number; y: number; w: number }, ratio: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const barX = bar.x;
  const barW = bar.w;
  const barY = bar.y;
  ctx.fillStyle = '#ebe4d8';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, 6, 3);
  ctx.fill();
  if (ratio > 0) {
    ctx.fillStyle = TERRITORY_MINE_COLOR;
    ctx.beginPath();
    ctx.roundRect(barX, barY, Math.max(6, barW * ratio), 6, 3);
    ctx.fill();
  }
  ctx.fillStyle = '#5b6170';
  ctx.font = canvasFont(9, 700, textScale);
  ctx.fillText(ratio > 0 ? `領地 ${Math.max(1, Math.round(ratio * 100))}%` : 'まだ領地なし', barX, barY + 14 * textScale);
  // 領主・色あせは次の行に（幅に収まらなければ … で切る）
  if (!d.isLordMe && d.subtitle !== undefined) {
    let text = d.subtitle;
    while (ctx.measureText(text).width > barW && text.length > 2) text = `${text.slice(0, -2)}…`;
    ctx.fillStyle = TERRITORY_RIVAL_COLOR;
    ctx.fillText(text, barX, barY + 27 * textScale);
  }
}

/**
 * 小さな王冠（自分が領主の地区）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @sideEffect canvas に描く
 */
function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = '#ffc83d';
  ctx.strokeStyle = '#b8860b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 8, y + 5);
  ctx.lineTo(x - 8, y - 4);
  ctx.lineTo(x - 4, y);
  ctx.lineTo(x, y - 6);
  ctx.lineTo(x + 4, y);
  ctx.lineTo(x + 8, y - 4);
  ctx.lineTo(x + 8, y + 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/**
 * '#rrggbb' に透明度を付ける。
 * @param hex 色
 * @param alpha 不透明度
 * @returns rgba 文字列
 */
function withAlpha(hex: string, alpha: number): string { // audit-ignore: fnlog-missing 毎フレーム描画の色変換ヘルパー
  const n = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return `rgba(188, 91, 27, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
