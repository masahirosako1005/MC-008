/**
 * @file 広域のイラストの街（presentation/screens/Map/town 層）
 * 2026-11-10 ユーザー指示「広域表示のときのグレー部分の背景が殺風景なので、イラストなどを用いて楽しそうな町に」
 * 「陣取りで街の活性とともに、陣地がとられていくと街が廃れていく感じに。演出も」「システム表示ではなく、旅をしているときの温かみある表示に」。
 * 広域（mpp ≥ 2.4）の地面を、手描き風の観光マップのように描く（MapScreen が renderer.draw の代わりに呼ぶ）。
 * - 静かな部分（紙の地・川・木・家）は 512px 四方のタイルに焼いてキャッシュする（縮尺と画面の密度で解像度の段を選ぶ。焼けるまでは土地の色だけの全体図で埋める）
 * - 地区ごとの雰囲気（town/vitality）は毎フレームの重ね塗り（彩度・くすみ・暖かい光）と小さな飾りで見せる。setVitality で変わると、地区の中心から波が広がって色が戻る／抜ける
 * - 空の雲・鳥・川の小舟・高架の電車・風船・花火・雨雲・カラスは毎フレーム数十個だけ描く
 * 地区の中心は王者の台座と札（MapScreen）のために空け、文字は描かない。乱数は使わない。座標はログに出さない。
 */
import { prefersReducedMotion } from '@/Common/ui/a11y/reducedMotion';
import { createLogger } from '@/Common/logging/logger';
import { project } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, LatLng, Viewport } from '@/presentation/screens/Map/MapViewModel';
import { gridTransform } from '@/presentation/screens/Map/town/townRenderer';
import type { GridTransform } from '@/presentation/screens/Map/town/townRenderer';
import { hash01 } from '@/presentation/screens/Map/town/townGenerator';
import { latLngToCell } from '@/presentation/screens/Map/town/townTypes';
import type { TownGrid } from '@/presentation/screens/Map/town/townTypes';
import type { VitalityModel } from '@/presentation/screens/Map/town/vitality';
import {
  PAPER,
  drawBalloon,
  drawBird,
  drawBoat,
  drawCloud,
  drawCrack,
  drawCrow,
  drawFirework,
  drawFlowers,
  drawLanternString,
  drawNobori,
  drawRainCloud,
  drawShutter,
  drawSmoke,
  drawTrain,
  drawWaveFront,
  drawWeeds,
  drawWitheredTree,
  paintLanduse,
  paintTile,
} from '@/presentation/screens/Map/town/wideIllustrationArt';
import type { TileScene } from '@/presentation/screens/Map/town/wideIllustrationArt';
import {
  CALM_LOOK,
  LEVELS_PX_PER_CELL,
  TRANSITION_MS,
  bucketSlots,
  chooseLevel,
  decorOf,
  houseSlotsOf,
  isUplift,
  lookOf,
  looksDiffer,
  mixLook,
  polygonToCells,
  riverPathsOf,
  viaductLineOf,
  waveProgress,
} from '@/presentation/screens/Map/town/wideIllustrationModel';
import type { CellPoint, DecorItem, DistrictDecor, DistrictLook } from '@/presentation/screens/Map/town/wideIllustrationModel';

const logger = createLogger('presentation/screens/Map/town/wideIllustration');

/** タイルの一辺（px） */
export const TILE_PX = 512;
/** タイルのキャッシュの上限（枚。1枚 1MB） */
export const MAX_TILES = 32;
/** 1フレームでタイルを焼くのに使う時間の上限（ミリ秒） */
export const BAKE_BUDGET_MS = 9;
/** 地区の外を紙の色で少し沈める濃さ（地区を主役にする） */
const OUTSIDE_WASH = 0.2;
/** 建物の箱の一辺（セル） */
const BUCKET_CELLS = 32;
/** 飾りがぽんと現れる長さ（ミリ秒） */
const POP_MS = 380;
/** 花火の間隔と長さ（ミリ秒） */
const FIREWORK_EVERY_MS = 3800;
const FIREWORK_MS = 1500;
/** 空に浮かべる雲の数 */
const CLOUDS = 4;

/** 広域の地区（DistrictMapDto から作る） */
export interface WideDistrictInput {
  readonly id: string;
  readonly color: string;
  readonly theme: string;
  readonly polygon: readonly LatLng[];
  readonly center: LatLng;
  readonly level: number;
}

/** 焼いたタイル */
interface TileEntry {
  readonly canvas: HTMLCanvasElement;
  lastUsed: number;
}

/** 地区の見え方の切り替わり */
interface LookState {
  readonly from: DistrictLook;
  readonly to: DistrictLook;
  readonly startedAt: number;
  readonly up: boolean;
}

/** 地区の描く材料 */
interface DistrictRuntime {
  readonly input: WideDistrictInput;
  readonly decor: DistrictDecor;
}

/** 画面での地区（毎フレーム） */
interface ScreenDistrict {
  readonly d: DistrictRuntime;
  readonly path: Path2D;
  readonly points: readonly { x: number; y: number }[];
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly center: { readonly x: number; readonly y: number };
  readonly reachPx: number;
  readonly look: LookState;
  readonly progress: number;
}

/**
 * キャンバスを作る（document が無い環境では undefined）。
 * @param w 幅
 * @param h 高さ
 * @returns canvas
 */
function makeCanvas(w: number, h: number): HTMLCanvasElement | undefined {
  const log = logger.fn('makeCanvas', { w, h });
  if (typeof document === 'undefined') return log.exit(undefined, 'document なし');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return log.exit(canvas);
}

/**
 * 折れ線の上を行き来する点（小舟用）。
 * @param path 折れ線（セル）
 * @param dist 進んだ距離（セル。往復で折り返す）
 * @returns 位置と向き
 */
export function alongPath(path: readonly CellPoint[], dist: number): { col: number; row: number; angle: number } { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot((path[i]?.col ?? 0) - (path[i - 1]?.col ?? 0), (path[i]?.row ?? 0) - (path[i - 1]?.row ?? 0));
  const first = path[0] ?? { col: 0, row: 0 };
  if (total <= 0) return { col: first.col, row: first.row, angle: 0 };
  const m = ((dist % (2 * total)) + 2 * total) % (2 * total);
  const back = m > total;
  let left = back ? 2 * total - m : m;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] ?? first;
    const b = path[i] ?? first;
    const seg = Math.hypot(b.col - a.col, b.row - a.row);
    if (left <= seg || i === path.length - 1) {
      const k = seg > 0 ? Math.min(1, left / seg) : 0;
      const angle = Math.atan2(b.row - a.row, b.col - a.col) + (back ? Math.PI : 0);
      return { col: a.col + (b.col - a.col) * k, row: a.row + (b.row - a.row) * k, angle };
    }
    left -= seg;
  }
  return { col: first.col, row: first.row, angle: 0 };
}

/** 広域のイラストの街 */
export class WideIllustration {
  private readonly scene: TileScene;
  private readonly districts: readonly DistrictRuntime[];
  private readonly tiles = new Map<string, TileEntry>();
  private readonly looks = new Map<string, LookState>();
  private readonly rivers: readonly CellPoint[][];
  private readonly reducedMotion = prefersReducedMotion();
  private landuse: HTMLCanvasElement | undefined;
  private landuseTried = false;
  private level = -1;
  /** 前に使っていた段（新しい段が焼けるまでの下敷き） */
  private prevLevel = -1;
  private frame = 0;
  /** 全体の不透明度（draw の引数 × 呼んだときの globalAlpha） */
  private A = 1;

  /**
   * 街の材料（建物の箱・地区の多角形・飾りの場所・川と高架の道筋）を用意する（絵は描くときに焼く）。
   * @param grid 街
   * @param districts 地区
   */
  constructor(
    readonly grid: TownGrid,
    districts: readonly WideDistrictInput[],
  ) {
    const log = logger.fn('constructor', { districts: districts.length, buildings: grid.buildings.length });
    const viaduct = viaductLineOf(grid);
    const station = grid.buildings.find((b) => b.style === 'station');
    this.scene = {
      grid,
      slots: bucketSlots(houseSlotsOf(grid), BUCKET_CELLS),
      bucketCells: BUCKET_CELLS,
      ...(station === undefined ? {} : { station }),
      districts: districts.map((d) => ({ cells: polygonToCells(grid, d.polygon), color: d.color })),
      ...(viaduct === undefined ? {} : { viaduct }),
    };
    this.districts = districts.map((d) => {
      const number = grid.districtIds.indexOf(d.id) + 1;
      return { input: d, decor: decorOf(grid, number, polygonToCells(grid, d.polygon), latLngToCell(grid, d.center)) };
    });
    this.rivers = riverPathsOf(grid);
    log.exit(undefined, `川 ${this.rivers.length} 本`);
  }

  /**
   * 地区の雰囲気を差し替える（変わった地区は、中心から波が広がって約1.6秒で切り替わる）。
   * @param model 活気と陣取り
   * @param now 現在時刻（performance.now()）
   * @sideEffect 地区の見え方の切り替わりを始める
   */
  setVitality(model: VitalityModel, now: number): void {
    const log = logger.fn('setVitality', { districts: model.byDistrict.size });
    let changed = 0;
    for (const { input } of this.districts) {
      const v = model.byDistrict.get(input.id);
      const target = v === undefined ? CALM_LOOK : lookOf(v.mood, v.vitality);
      const prev = this.looks.get(input.id);
      if (prev === undefined) {
        this.looks.set(input.id, { from: target, to: target, startedAt: Number.NEGATIVE_INFINITY, up: true });
        continue;
      }
      if (!looksDiffer(prev.to, target)) continue;
      const p = waveProgress(prev.startedAt, now);
      const current = p >= 1 ? prev.to : mixLook(prev.from, prev.to, p);
      this.looks.set(input.id, { from: current, to: target, startedAt: this.reducedMotion ? Number.NEGATIVE_INFINITY : now, up: isUplift(current, target) });
      changed++;
    }
    log.exit(undefined, `${changed} 地区が切り替わる`);
  }

  /**
   * 切り替わりの波が動いているか。
   * @param now 現在時刻
   * @returns 動いていれば true
   */
  isTransitioning(now: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
    for (const look of this.looks.values()) if (waveProgress(look.startedAt, now) < 1) return true;
    return false;
  }

  /**
   * 広域の地面を描く（タイル → 雰囲気の重ね塗り → 地区の外を沈める → 手描きの縁 → 飾り → 空・川・電車）。
   * @param ctx 2D コンテキスト（CSS px 座標）。呼んだときの globalAlpha も掛ける
   * @param camera カメラ
   * @param vp 描画領域
   * @param t 現在時刻（performance.now()）
   * @param dpr デバイスピクセル比
   * @param opacity 不透明度（中間との境目でのクロスフェード用。既定 1）
   * @returns 次のフレームも描きたければ true（タイルが残っている・波が動いている・空が動いている）
   * @sideEffect ctx に描く。タイルを焼いてキャッシュする
   */
  draw(ctx: CanvasRenderingContext2D, camera: Camera, vp: Viewport, t: number, dpr: number, opacity = 1): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
    this.frame += 1;
    this.A = Math.max(0, Math.min(1, opacity)) * ctx.globalAlpha;
    if (this.A <= 0.001) return false;
    const tr = gridTransform(this.grid, camera, vp);
    const amb = this.reducedMotion ? 0 : t;
    ctx.save();
    ctx.globalAlpha = this.A;
    const pending = this.drawTiles(ctx, tr, vp, dpr);
    const districts = this.screenDistricts(camera, vp, tr, t);
    for (const sd of districts) this.drawMood(ctx, sd);
    this.drawOutsideWash(ctx, vp, districts);
    for (const sd of districts) this.drawBorder(ctx, sd);
    const s = Math.min(1.3, Math.max(0.65, tr.cellW * 0.62));
    for (const sd of districts) this.drawDecor(ctx, sd, tr, vp, t, amb, s);
    for (const sd of districts) {
      if (sd.progress >= 1) continue;
      ctx.save();
      ctx.clip(sd.path);
      drawWaveFront(ctx, sd.center.x, sd.center.y, sd.progress * sd.reachPx, sd.look.up, this.A * (1 - sd.progress * 0.85), t);
      ctx.restore();
    }
    ctx.globalAlpha = this.A;
    this.drawRiverAndRail(ctx, tr, amb, s);
    this.drawWeather(ctx, districts, tr, amb, s);
    this.drawSky(ctx, tr, vp, amb, s);
    ctx.restore();
    return pending || this.isTransitioning(t) || !this.reducedMotion;
  }

  /**
   * キャッシュを捨てる（画面を閉じるとき）。
   * @sideEffect タイルと全体図を捨てる
   */
  dispose(): void {
    const log = logger.fn('dispose', { tiles: this.tiles.size });
    this.tiles.clear();
    this.landuse = undefined;
    log.exit(undefined);
  }

  // -------------------------------------------------------------------------
  // タイル
  // -------------------------------------------------------------------------

  /**
   * 画面の密度に合う段を選ぶ（細かくするのはすぐ、粗くするのははっきり粗くてよいときだけ＝段がちらつかない）。
   * @param need 1セルが画面で何デバイス px か
   * @returns 段の添字
   */
  private pickLevel(need: number): number { // audit-ignore: fnlog-missing 毎フレーム描画
    const want = chooseLevel(need);
    if (this.level < 0 || want > this.level) return want;
    if (want < this.level && need <= (LEVELS_PX_PER_CELL[want] ?? 0) * 0.95) return want;
    return this.level;
  }

  /**
   * 見えているタイルを描く（焼けていない所は、前の段のタイル、それも無ければ土地の色だけの全体図で埋め、真ん中に近い順に少しずつ焼く）。
   * @param ctx 2D コンテキスト
   * @param tr セル → 画面の変換
   * @param vp 描画領域
   * @param dpr デバイスピクセル比
   * @returns まだ焼くタイルが残っていれば true
   * @sideEffect ctx に描く。タイルを焼く
   */
  private drawTiles(ctx: CanvasRenderingContext2D, tr: GridTransform, vp: Viewport, dpr: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
    const next = this.pickLevel(tr.cellW * dpr);
    if (next !== this.level) {
      this.prevLevel = this.level;
      this.level = next;
    }
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.imageSmoothingEnabled = true;
    const missing = this.missingTiles(this.level, tr, vp);
    const underlay = missing.length > 0 && this.prevLevel >= 0 && this.prevLevel !== this.level;
    if (underlay) this.drawLevel(ctx, this.prevLevel, tr, vp, dpr, false);
    this.drawLevel(ctx, this.level, tr, vp, dpr, !underlay);
    missing.sort((a, b) => a.d - b.d);
    const started = performance.now();
    let baked = 0;
    for (const p of missing) {
      if (baked > 0 && performance.now() - started > BAKE_BUDGET_MS) break;
      this.bakeTile(this.level, p.tx, p.ty);
      baked++;
    }
    if (baked > 0) this.evict();
    return missing.length > baked;
  }

  /**
   * その段で見えているタイルの範囲（列・行）と、画面での大きさ。
   * @param level 段
   * @param tr セル → 画面の変換
   * @param vp 描画領域
   * @returns 範囲
   */
  private tileRange(level: number, tr: GridTransform, vp: Viewport): { tx0: number; ty0: number; tx1: number; ty1: number; tw: number; th: number; cells: number } { // audit-ignore: fnlog-missing 毎フレーム描画
    const cells = TILE_PX / (LEVELS_PX_PER_CELL[level] ?? 2.4);
    const tw = cells * tr.cellW;
    const th = cells * tr.cellH;
    return {
      tx0: Math.max(0, Math.floor(-tr.ox / tw)),
      ty0: Math.max(0, Math.floor(-tr.oy / th)),
      tx1: Math.min(Math.ceil(this.grid.cols / cells) - 1, Math.floor((vp.width - tr.ox) / tw)),
      ty1: Math.min(Math.ceil(this.grid.rows / cells) - 1, Math.floor((vp.height - tr.oy) / th)),
      tw,
      th,
      cells,
    };
  }

  /**
   * その段で、見えているのにまだ焼けていないタイル（画面の真ん中からの距離つき）。
   * @param level 段
   * @param tr セル → 画面の変換
   * @param vp 描画領域
   * @returns 焼けていないタイル
   */
  private missingTiles(level: number, tr: GridTransform, vp: Viewport): { tx: number; ty: number; d: number }[] { // audit-ignore: fnlog-missing 毎フレーム描画
    const r = this.tileRange(level, tr, vp);
    const out: { tx: number; ty: number; d: number }[] = [];
    for (let ty = r.ty0; ty <= r.ty1; ty++) {
      for (let tx = r.tx0; tx <= r.tx1; tx++) {
        if (this.tiles.has(`${level}:${tx}:${ty}`)) continue;
        out.push({ tx, ty, d: Math.hypot(tr.ox + (tx + 0.5) * r.tw - vp.width / 2, tr.oy + (ty + 0.5) * r.th - vp.height / 2) });
      }
    }
    return out;
  }

  /**
   * その段の焼けているタイルを描く（焼けていない所は、fill なら土地の色だけの全体図で埋める）。
   * @param ctx 2D コンテキスト
   * @param level 段
   * @param tr セル → 画面の変換
   * @param vp 描画領域
   * @param dpr デバイスピクセル比
   * @param fill 焼けていない所を全体図で埋めるか
   * @sideEffect ctx に描く
   */
  private drawLevel(ctx: CanvasRenderingContext2D, level: number, tr: GridTransform, vp: Viewport, dpr: number, fill: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const r = this.tileRange(level, tr, vp);
    for (let ty = r.ty0; ty <= r.ty1; ty++) {
      for (let tx = r.tx0; tx <= r.tx1; tx++) {
        // 隣のタイルとの間に隙間ができないよう、端をデバイスピクセルに合わせる
        const x0 = Math.round((tr.ox + tx * r.tw) * dpr) / dpr;
        const y0 = Math.round((tr.oy + ty * r.th) * dpr) / dpr;
        const x1 = Math.round((tr.ox + (tx + 1) * r.tw) * dpr) / dpr;
        const y1 = Math.round((tr.oy + (ty + 1) * r.th) * dpr) / dpr;
        const entry = this.tiles.get(`${level}:${tx}:${ty}`);
        if (entry !== undefined) {
          entry.lastUsed = this.frame;
          ctx.drawImage(entry.canvas, x0, y0, x1 - x0, y1 - y0);
        } else if (fill) this.drawLandusePatch(ctx, tx * r.cells, ty * r.cells, r.cells, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
    }
  }

  /**
   * 焼けていないタイルの場所を、土地の色だけの全体図で埋める。
   * @param ctx 2D コンテキスト
   * @param col 左上の列
   * @param row 左上の行
   * @param cells タイルの一辺（セル）
   * @param dst 画面の四角
   * @sideEffect ctx に描く
   */
  private drawLandusePatch(ctx: CanvasRenderingContext2D, col: number, row: number, cells: number, dst: { x: number; y: number; w: number; h: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
    if (!this.landuseTried) {
      this.landuseTried = true;
      const canvas = makeCanvas(this.grid.cols, this.grid.rows);
      const lctx = canvas?.getContext('2d');
      if (canvas !== undefined && lctx !== null && lctx !== undefined) {
        const image = lctx.createImageData(this.grid.cols, this.grid.rows);
        image.data.set(paintLanduse(this.grid));
        lctx.putImageData(image, 0, 0);
        this.landuse = canvas;
      }
    }
    if (this.landuse === undefined) return;
    ctx.drawImage(this.landuse, col, row, cells, cells, dst.x, dst.y, dst.w, dst.h);
  }

  /**
   * タイルを1枚焼く。
   * @param level 段
   * @param tx タイルの列
   * @param ty タイルの行
   * @sideEffect キャッシュに足す
   */
  private bakeTile(level: number, tx: number, ty: number): void {
    const log = logger.fn('bakeTile', { level, tx, ty });
    const canvas = makeCanvas(TILE_PX, TILE_PX);
    const tctx = canvas?.getContext('2d');
    if (canvas === undefined || tctx === null || tctx === undefined) return log.exit(undefined, 'canvas なし');
    try {
      paintTile(tctx, this.scene, LEVELS_PX_PER_CELL[level] ?? 2.4, tx, ty, TILE_PX);
    } catch (error) {
      log.error('タイルを描けませんでした', { error });
    }
    this.tiles.set(`${level}:${tx}:${ty}`, { canvas, lastUsed: this.frame });
    log.exit(undefined);
  }

  /**
   * キャッシュが上限を超えたら、長く使っていないタイルから捨てる。
   * @sideEffect キャッシュを減らす
   */
  private evict(): void { // audit-ignore: fnlog-missing 毎フレーム描画
    if (this.tiles.size <= MAX_TILES) return;
    const entries = [...this.tiles.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key] of entries.slice(0, this.tiles.size - MAX_TILES)) this.tiles.delete(key);
  }

  // -------------------------------------------------------------------------
  // 地区の雰囲気
  // -------------------------------------------------------------------------

  /**
   * 地区を画面の座標にする（多角形・囲む四角・中心・波の半径・見え方）。
   * @param camera カメラ
   * @param vp 描画領域
   * @param tr セル → 画面の変換
   * @param t 現在時刻
   * @returns 画面での地区
   */
  private screenDistricts(camera: Camera, vp: Viewport, tr: GridTransform, t: number): ScreenDistrict[] { // audit-ignore: fnlog-missing 毎フレーム描画
    return this.districts.map((d) => {
      const points = d.input.polygon.map((ll) => project(camera, vp, ll));
      const path = new Path2D();
      points.forEach((p, k) => (k === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
      path.closePath();
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const box = { x: Math.min(...xs) - 4, y: Math.min(...ys) - 4, w: Math.max(...xs) - Math.min(...xs) + 8, h: Math.max(...ys) - Math.min(...ys) + 8 };
      const look = this.looks.get(d.input.id) ?? { from: CALM_LOOK, to: CALM_LOOK, startedAt: Number.NEGATIVE_INFINITY, up: true };
      return { d, path, points, box, center: project(camera, vp, d.input.center), reachPx: d.decor.reachCells * tr.cellW * 1.08, look, progress: waveProgress(look.startedAt, t) };
    });
  }

  /**
   * 地区の雰囲気を重ね塗りする（切り替わり中は、波の内側を新しい見え方、外側を前の見え方で）。
   * @param ctx 2D コンテキスト
   * @param sd 画面での地区
   * @sideEffect ctx に描く
   */
  private drawMood(ctx: CanvasRenderingContext2D, sd: ScreenDistrict): void { // audit-ignore: fnlog-missing 毎フレーム描画
    ctx.save();
    ctx.clip(sd.path);
    if (sd.progress >= 1) this.applyLook(ctx, sd, sd.look.to);
    else {
      const r = sd.progress * sd.reachPx;
      ctx.save();
      const outside = new Path2D();
      outside.rect(sd.box.x, sd.box.y, sd.box.w, sd.box.h);
      outside.arc(sd.center.x, sd.center.y, Math.max(0.1, r), 0, Math.PI * 2);
      ctx.clip(outside, 'evenodd');
      this.applyLook(ctx, sd, sd.look.from);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(sd.center.x, sd.center.y, Math.max(0.1, r), 0, Math.PI * 2);
      ctx.clip();
      this.applyLook(ctx, sd, sd.look.to);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * 見え方を1つ塗る（彩度を落とす・茶色くくすませる・暖かい光）。
   * @param ctx 2D コンテキスト（地区で切り抜き済み）
   * @param sd 画面での地区
   * @param look 見え方
   * @sideEffect ctx に描く
   */
  private applyLook(ctx: CanvasRenderingContext2D, sd: ScreenDistrict, look: DistrictLook): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const { x, y, w, h } = sd.box;
    if (look.desat > 0.01) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = this.A * look.desat;
      ctx.fillStyle = '#808080';
      ctx.fillRect(x, y, w, h);
    }
    if (look.brown > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = this.A * look.brown * 0.45;
      ctx.fillStyle = '#cdb294';
      ctx.fillRect(x, y, w, h);
    }
    if (look.glow > 0.01) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = this.A * look.glow * 0.45;
      const g = ctx.createRadialGradient(sd.center.x, sd.center.y, 0, sd.center.x, sd.center.y, Math.max(8, sd.reachPx));
      g.addColorStop(0, '#fff0c8');
      g.addColorStop(1, '#ffd59a');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = this.A;
  }

  /**
   * 地区の外を紙の色で少し沈める（地区が主役。灰色にはしない）。
   * @param ctx 2D コンテキスト
   * @param vp 描画領域
   * @param districts 画面での地区
   * @sideEffect ctx に描く
   */
  private drawOutsideWash(ctx: CanvasRenderingContext2D, vp: Viewport, districts: readonly ScreenDistrict[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const path = new Path2D();
    path.rect(-2, -2, vp.width + 4, vp.height + 4);
    for (const sd of districts) path.addPath(sd.path);
    ctx.globalAlpha = this.A * OUTSIDE_WASH;
    ctx.fillStyle = PAPER;
    ctx.fill(path, 'evenodd');
    ctx.globalAlpha = this.A;
  }

  /**
   * 地区の縁を手描き風の破線で描く（少しゆらぐ線＋白い下地）。
   * @param ctx 2D コンテキスト
   * @param sd 画面での地区
   * @sideEffect ctx に描く
   */
  private drawBorder(ctx: CanvasRenderingContext2D, sd: ScreenDistrict): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const pts = sd.points;
    if (pts.length < 3) return;
    const path = new Path2D();
    let n = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] ?? { x: 0, y: 0 };
      const b = pts[(i + 1) % pts.length] ?? a;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(len / 12));
      const nx = len > 0 ? -(b.y - a.y) / len : 0;
      const ny = len > 0 ? (b.x - a.x) / len : 0;
      for (let j = 0; j < steps; j++) {
        const k = j / steps;
        const wob = j === 0 ? 0 : Math.sin((n + j) * 1.9 + i) * 1.1;
        const x = a.x + (b.x - a.x) * k + nx * wob;
        const y = a.y + (b.y - a.y) * k + ny * wob;
        if (i === 0 && j === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      n += steps;
    }
    path.closePath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = this.A * 0.75;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.stroke(path);
    ctx.globalAlpha = this.A * 0.95;
    ctx.strokeStyle = sd.d.input.color;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([7, 5]);
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.globalAlpha = this.A;
  }

  /**
   * 地区の飾り（にぎわい／廃れ）を描く。切り替わり中は、波が届いた飾りからぽんと現れる・消える。
   * @param ctx 2D コンテキスト
   * @param sd 画面での地区
   * @param tr セル → 画面の変換
   * @param vp 描画領域
   * @param t 現在時刻
   * @param amb 動きの時刻（動きを減らす設定なら 0）
   * @param s 大きさの倍率
   * @sideEffect ctx に描く
   */
  private drawDecor(ctx: CanvasRenderingContext2D, sd: ScreenDistrict, tr: GridTransform, vp: Viewport, t: number, amb: number, s: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    for (const item of sd.d.decor.items) {
      const x = tr.ox + item.col * tr.cellW;
      const y = tr.oy + item.row * tr.cellH;
      if (x < -60 || y < -80 || x > vp.width + 60 || y > vp.height + 40) continue;
      const { look, pop } = this.itemLook(sd, item, t);
      this.drawItem(ctx, item, { x, y, w: (item.w ?? 1) * tr.cellW, h: (item.h ?? 1) * tr.cellH }, look, s * pop, amb);
    }
  }

  /**
   * 飾り1つの見え方（波がまだ届いていなければ前、届いたら少しずつ新しい見え方。現れるときに少し弾む）。
   * @param sd 画面での地区
   * @param item 飾り
   * @param t 現在時刻
   * @returns 見え方と弾み（大きさの倍率）
   */
  private itemLook(sd: ScreenDistrict, item: DecorItem, t: number): { look: DistrictLook; pop: number } { // audit-ignore: fnlog-missing 毎フレーム描画
    if (sd.progress >= 1 && t - sd.look.startedAt > TRANSITION_MS + POP_MS) return { look: sd.look.to, pop: 1 };
    const q = Math.min(1, item.dist / Math.max(1, sd.d.decor.reachCells * 1.08));
    const reachedAt = sd.look.startedAt + (1 - Math.cbrt(1 - q)) * TRANSITION_MS;
    const k = Math.min(1, Math.max(0, (t - reachedAt) / POP_MS));
    const look = mixLook(sd.look.from, sd.look.to, k);
    return { look, pop: k > 0 && k < 1 ? 1 + Math.sin(k * Math.PI) * 0.45 : 1 };
  }

  /**
   * 飾りを種類ごとに描く。
   * @param ctx 2D コンテキスト
   * @param item 飾り
   * @param at 画面での左上と、建物の幅・高さ
   * @param look 見え方
   * @param s 大きさの倍率
   * @param amb 動きの時刻
   * @sideEffect ctx に描く
   */
  private drawItem(ctx: CanvasRenderingContext2D, item: DecorItem, at: { x: number; y: number; w: number; h: number }, look: DistrictLook, s: number, amb: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const A = this.A;
    const { x, y, w, h } = at;
    switch (item.kind) {
      case 'lantern':
        drawLanternString(ctx, x, x + (item.span ?? 10) * w, y, s, amb, look.lively * A);
        break;
      case 'nobori':
        drawNobori(ctx, x + w * 0.88, y + h * 0.95, s, amb, look.lively * A, item.seed);
        break;
      case 'flowers':
        drawFlowers(ctx, x, y, s, Math.max(look.lively, 0) * A, item.seed);
        break;
      case 'chimney':
        drawSmoke(ctx, x + w * 0.72, y - 1.5 * s, s, amb, Math.max(look.lively, 0.3) * (1 - look.decay) * A, item.seed);
        break;
      case 'balloon':
        if (look.lively > 0.3) drawBalloon(ctx, x + w / 2, y, s, amb, look.lively * A, item.seed);
        break;
      case 'shutter':
        drawShutter(ctx, x + w * 0.12, y + h * 0.58, w * 0.72, Math.max(2, h * 0.34), look.decay * A);
        break;
      case 'withered':
        drawWitheredTree(ctx, x, y, s, look.decay * A, item.seed);
        break;
      case 'weeds':
        drawWeeds(ctx, x, y, s, look.decay * A, item.seed);
        break;
      case 'crack':
        drawCrack(ctx, x + w * 0.1, y, w * 0.8, h * 0.5, look.decay * A);
        break;
    }
    ctx.globalAlpha = A;
  }

  // -------------------------------------------------------------------------
  // 動くもの
  // -------------------------------------------------------------------------

  /**
   * 川の小舟と高架の電車。
   * @param ctx 2D コンテキスト
   * @param tr セル → 画面の変換
   * @param amb 動きの時刻
   * @param s 大きさの倍率
   * @sideEffect ctx に描く
   */
  private drawRiverAndRail(ctx: CanvasRenderingContext2D, tr: GridTransform, amb: number, s: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const boats = Math.min(4, this.rivers.length * 2);
    for (let i = 0; i < boats; i++) {
      const path = this.rivers[i % this.rivers.length];
      if (path === undefined) continue;
      const at = alongPath(path, (amb / 1000) * 1.4 + hash01(i, 3) * 400);
      ctx.globalAlpha = this.A;
      drawBoat(ctx, tr.ox + at.col * tr.cellW, tr.oy + at.row * tr.cellH, s, at.angle);
    }
    const v = this.scene.viaduct;
    if (v === undefined || v.col1 - v.col0 < 16) return;
    const pos = alongPath([{ col: v.col0 + 6, row: v.row }, { col: v.col1 - 6, row: v.row }], (amb / 1000) * 14);
    ctx.globalAlpha = this.A;
    drawTrain(ctx, tr.ox + pos.col * tr.cellW, tr.oy + v.row * tr.cellH, s, Math.cos(pos.angle) >= 0 ? 1 : -1);
  }

  /**
   * 雰囲気の空模様（にぎやかな地区の花火、廃れた地区の雨雲とカラス）。
   * @param ctx 2D コンテキスト
   * @param districts 画面での地区
   * @param tr セル → 画面の変換
   * @param amb 動きの時刻
   * @param s 大きさの倍率
   * @sideEffect ctx に描く
   */
  private drawWeather(ctx: CanvasRenderingContext2D, districts: readonly ScreenDistrict[], tr: GridTransform, amb: number, s: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const lively = districts.filter((sd) => sd.progress >= 1 && sd.look.to.lively > 0.5);
    if (lively.length > 0 && amb > 0) {
      const slot = Math.floor(amb / FIREWORK_EVERY_MS);
      const sd = lively[Math.floor(hash01(slot, 5) * lively.length)];
      const k = (amb % FIREWORK_EVERY_MS) / FIREWORK_MS;
      if (sd !== undefined && k < 1) drawFirework(ctx, sd.center.x + (hash01(slot, 6) - 0.5) * 90, sd.center.y - (95 + hash01(slot, 7) * 30) * s, s * 1.2, k, hash01(slot, 8));
    }
    for (const sd of districts) {
      const look = sd.progress >= 1 ? sd.look.to : mixLook(sd.look.from, sd.look.to, sd.progress);
      if (look.decay <= 0.15) continue;
      const cloud = { x: tr.ox + sd.d.decor.cloudAt.col * tr.cellW, y: tr.oy + sd.d.decor.cloudAt.row * tr.cellH };
      drawRainCloud(ctx, cloud.x, cloud.y - 20 * s, s * 1.15, amb, look.decay * this.A);
      for (let i = 0; i < 3; i++) {
        const a = (amb / 1700) * (1 + i * 0.25) + i * 2.1;
        const r = (20 + i * 6) * s;
        drawCrow(ctx, cloud.x + Math.cos(a) * r, cloud.y - 34 * s + Math.sin(a) * r * 0.45, s, amb, look.decay * this.A, i / 3);
      }
    }
    ctx.globalAlpha = this.A;
  }

  /**
   * 空（流れる白い雲と、渡っていく小鳥）。
   * @param ctx 2D コンテキスト
   * @param tr セル → 画面の変換
   * @param vp 描画領域
   * @param amb 動きの時刻
   * @param s 大きさの倍率
   * @sideEffect ctx に描く
   */
  private drawSky(ctx: CanvasRenderingContext2D, tr: GridTransform, vp: Viewport, amb: number, s: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const wrap = this.grid.cols + 80;
    ctx.globalAlpha = this.A;
    for (let i = 0; i < CLOUDS; i++) {
      const col = ((hash01(i, 1) * wrap + (amb / 1000) * (0.8 + hash01(i, 4) * 0.5)) % wrap) - 40;
      const row = (0.12 + 0.76 * hash01(i, 2)) * this.grid.rows;
      const x = tr.ox + col * tr.cellW;
      const y = tr.oy + row * tr.cellH;
      if (x < -80 || x > vp.width + 80 || y < -60 || y > vp.height + 60) continue;
      drawCloud(ctx, x, y, s * (1 + hash01(i, 5) * 0.4), hash01(i, 6));
    }
    const k = ((amb / 24000) % 1 + 1) % 1;
    const fx = -40 + k * (vp.width + 80);
    const fy = vp.height * 0.32 + Math.sin(k * 7) * 14;
    for (let i = 0; i < 4; i++) drawBird(ctx, fx - i * 9 * s - (i % 2) * 4, fy + (i % 2) * 6 * s + i * 2, s, amb, i / 4);
  }
}
