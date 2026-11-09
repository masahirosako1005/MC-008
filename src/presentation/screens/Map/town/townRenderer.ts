/**
 * @file 街の地面を描く（presentation/screens/Map/town 層）
 * 街を 160m 四方のチャンクに分けて townArt でドット絵を焼き、キャッシュして drawImage で並べる（拡大してもドットがにじまない）。
 * 引いて見るとき（1セルが小さいとき）は、街全体を1枚にした全体図を使う。まだ焼けていないチャンクは全体図で埋めるので、地図に空白はできない。
 * 成長・色あせ・陣地が変わったら、古い絵を表示したまま少しずつ焼き直す（ちらつかない）。座標はログに出さない。
 */
import { createLogger } from '@/Common/logging/logger';
import { METERS_PER_DEG_LAT, metersPerDegLng, project } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, Viewport } from '@/presentation/screens/Map/MapViewModel';
// 2026-11-09 ユーザー指示「お店以外は簡易オブジェクトに」で簡易表示に切り替え（細かいドット絵は townArt に残してある）
import { paintChunk, paintOverview } from '@/presentation/screens/Map/town/townArtSimple';
import { CELL_M, CHUNK_CELLS, CHUNK_PX, OVERVIEW_PX_PER_CELL, TERRITORY_MINE, TERRITORY_RIVAL } from '@/presentation/screens/Map/town/townTypes';
import type { TownGrid, TownPaintState } from '@/presentation/screens/Map/town/townTypes';

const logger = createLogger('presentation/screens/Map/town/townRenderer');

/** 1セルがこの CSS px より小さいときは全体図で描く */
export const OVERVIEW_BELOW_CELL_PX = 1.9;
/** 1フレームで焼くチャンクの上限 */
export const CHUNKS_PER_FRAME = 4;
/** 1フレームでチャンクを焼くのに使う時間の上限（ミリ秒） */
export const CHUNK_BUDGET_MS = 12;
/** 引いて見ているとき、全体図の描き直しに1フレームで使う時間（ミリ秒） */
export const REFINE_BUDGET_MS = 9;
/** 寄って見ているとき（チャンクを焼き終わった後）に使う時間（ミリ秒） */
export const REFINE_IDLE_BUDGET_MS = 3;
/** チャンクのキャッシュの上限（枚） */
export const MAX_CACHED_CHUNKS = 140;

/** グリッドを画面に置く変換（セル → CSS px） */
export interface GridTransform {
  /** セル (0,0) の左上の画面座標 */
  readonly ox: number;
  readonly oy: number;
  /** 1セルの幅・高さ（CSS px） */
  readonly cellW: number;
  readonly cellH: number;
}

/** キャッシュしたチャンク */
interface ChunkEntry {
  readonly canvas: HTMLCanvasElement;
  version: number;
  lastUsed: number;
}

/**
 * 今のカメラでのグリッドの置き方を返す。
 * @param grid 街
 * @param camera カメラ
 * @param vp 描画領域
 * @returns 変換
 */
export function gridTransform(grid: Pick<TownGrid, 'originLat' | 'originLng' | 'metersPerDegLng'>, camera: Camera, vp: Viewport): GridTransform { // audit-ignore: fnlog-missing 毎フレーム描画
  const o = project(camera, vp, { lat: grid.originLat, lng: grid.originLng });
  const kx = metersPerDegLng(camera.centerLat) / grid.metersPerDegLng;
  return { ox: o.x, oy: o.y, cellW: (CELL_M * kx) / camera.metersPerPx, cellH: (CELL_M * (METERS_PER_DEG_LAT / 111_000)) / camera.metersPerPx };
}

/**
 * キャンバスを作る（document が無い環境では undefined）。
 * @param w 幅（px）
 * @param h 高さ（px）
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

/** 街の地面の描画（チャンクのキャッシュと全体図を持つ） */
export class TownRenderer {
  private state: TownPaintState;
  private version = 0;
  private readonly chunks = new Map<string, ChunkEntry>();
  private overview: HTMLCanvasElement | undefined;
  private overviewVersion = -1;
  /** 全体図のうち、本物のチャンクの絵を縮めて描き込んだチャンク（キー → 版） */
  private readonly refined = new Map<string, number>();
  private scratch: HTMLCanvasElement | undefined;
  private wash: HTMLCanvasElement | undefined;
  private washVersion = -1;
  private frame = 0;

  /**
   * 描画を用意する（絵は描くときに焼く）。
   * @param grid 街
   * @param state 成長・色あせ・陣地
   */
  constructor(
    readonly grid: TownGrid,
    state: TownPaintState,
  ) {
    this.state = state;
  }

  /**
   * 成長・色あせ・陣地を差し替える（キャッシュは古い印を付けて、表示しながら焼き直す）。
   * @param state 新しい状態
   * @sideEffect 版を上げる
   */
  setPaintState(state: TownPaintState): void {
    const log = logger.fn('setPaintState', { version: this.version + 1 });
    this.state = state;
    this.version += 1;
    log.exit(undefined);
  }

  /**
   * 今の状態を返す。
   * @returns 成長・色あせ・陣地
   */
  paintState(): TownPaintState {
    return this.state;
  }

  /**
   * 地面を描く。
   * @param ctx 2D コンテキスト（CSS px 座標・dpr 倍の変換済み）
   * @param camera カメラ
   * @param vp 描画領域
   * @param dpr デバイスピクセル比
   * @returns まだ焼くチャンクが残っていれば true（次のフレームも描く）
   * @sideEffect canvas に描く。チャンクを焼いてキャッシュする
   */
  draw(ctx: CanvasRenderingContext2D, camera: Camera, vp: Viewport, dpr: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
    this.frame += 1;
    const t = gridTransform(this.grid, camera, vp);
    if (t.cellW < OVERVIEW_BELOW_CELL_PX) {
      this.drawOverview(ctx, t, vp, dpr);
      return this.refineOverview(t, vp, REFINE_BUDGET_MS);
    }
    const pending = this.drawChunks(ctx, t, vp, dpr);
    return pending || this.refineOverview(t, vp, REFINE_IDLE_BUDGET_MS);
  }

  /**
   * 全体図（必要なら焼き直して）を描く。
   * @param ctx 2D コンテキスト
   * @param t 変換
   * @param vp 描画領域
   * @param dpr デバイスピクセル比
   * @sideEffect canvas に描く
   */
  private drawOverview(ctx: CanvasRenderingContext2D, t: GridTransform, vp: Viewport, dpr: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const overview = this.ensureOverview();
    if (overview === undefined) return;
    const k = OVERVIEW_PX_PER_CELL;
    const c0 = Math.max(0, Math.floor(-t.ox / t.cellW) - 1);
    const r0 = Math.max(0, Math.floor(-t.oy / t.cellH) - 1);
    const c1 = Math.min(this.grid.cols, Math.ceil((vp.width - t.ox) / t.cellW) + 1);
    const r1 = Math.min(this.grid.rows, Math.ceil((vp.height - t.oy) / t.cellH) + 1);
    if (c1 <= c0 || r1 <= r0) return;
    ctx.imageSmoothingEnabled = t.cellW * dpr < k;
    ctx.drawImage(overview, c0 * k, r0 * k, (c1 - c0) * k, (r1 - r0) * k, t.ox + c0 * t.cellW, t.oy + r0 * t.cellH, (c1 - c0) * t.cellW, (r1 - r0) * t.cellH);
  }

  /**
   * 全体図を（状態が変わっていれば）焼き直して返す。
   * @returns 全体図の canvas（作れなければ undefined）
   * @sideEffect 全体図を焼く
   */
  private ensureOverview(): HTMLCanvasElement | undefined { // audit-ignore: fnlog-missing 毎フレーム描画（焼き直すときだけ refreshOverview がログ）
    // 最初の1回だけ代表色で全体を作り、あとは本物のチャンクの絵で少しずつ描き直す（refineOverview）
    if (this.overview !== undefined) return this.overview;
    this.refreshOverview();
    return this.overview;
  }

  /**
   * 全体図を焼く。
   * @sideEffect 全体図の canvas を作る・描き直す
   */
  private refreshOverview(): void {
    const log = logger.fn('refreshOverview', { version: this.version });
    const k = OVERVIEW_PX_PER_CELL;
    const w = this.grid.cols * k;
    const h = this.grid.rows * k;
    const canvas = this.overview ?? makeCanvas(w, h);
    const ctx = canvas?.getContext('2d');
    if (canvas === undefined || ctx === null || ctx === undefined) return log.exit(undefined, 'canvas なし');
    const pixels = paintOverview(this.grid, this.state);
    const image = ctx.createImageData(w, h);
    image.data.set(pixels.subarray(0, image.data.length));
    ctx.putImageData(image, 0, 0);
    this.overview = canvas;
    this.overviewVersion = this.version;
    log.exit(undefined);
  }

  /**
   * 全体図を、本物のチャンクの絵を縮めたもので少しずつ描き直す（見ている所に近いチャンクから。引いて見ても街のドット絵の雰囲気が出る）。
   * @param t 変換
   * @param vp 描画領域
   * @param budgetMs 使ってよい時間（ミリ秒）
   * @returns まだ描き直すチャンクが残っていれば true
   * @sideEffect 全体図を描き直す
   */
  private refineOverview(t: GridTransform, vp: Viewport, budgetMs: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画（1チャンクごとの処理は refineChunk）
    const overview = this.ensureOverview();
    const octx = overview?.getContext('2d');
    if (overview === undefined || octx === null || octx === undefined) return false;
    const chunkW = t.cellW * CHUNK_CELLS;
    const centerCx = (vp.width / 2 - t.ox) / chunkW;
    const centerCy = (vp.height / 2 - t.oy) / (t.cellH * CHUNK_CELLS);
    const maxCx = Math.ceil(this.grid.cols / CHUNK_CELLS);
    const maxCy = Math.ceil(this.grid.rows / CHUNK_CELLS);
    const started = performance.now();
    for (;;) {
      let best: { cx: number; cy: number } | undefined;
      let bestD = Number.POSITIVE_INFINITY;
      for (let cy = 0; cy < maxCy; cy++) {
        for (let cx = 0; cx < maxCx; cx++) {
          if (this.refined.get(`${cx},${cy}`) === this.version) continue;
          const d = (cx + 0.5 - centerCx) ** 2 + (cy + 0.5 - centerCy) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { cx, cy };
          }
        }
      }
      if (best === undefined) return false;
      if (performance.now() - started > budgetMs) return true;
      this.refineChunk(octx, best.cx, best.cy);
    }
  }

  /**
   * 1チャンク分の本物の絵（キャッシュが新しければそれ、無ければ焼いて）を縮めて全体図に描き込む。
   * @param octx 全体図の 2D コンテキスト
   * @param cx チャンクの列
   * @param cy チャンクの行
   * @sideEffect 全体図に描く
   */
  private refineChunk(octx: CanvasRenderingContext2D, cx: number, cy: number): void { // audit-ignore: fnlog-missing 全体図の描き直しで何百回も呼ぶ（座標を扱わない内部処理）
    const key = `${cx},${cy}`;
    const entry = this.chunks.get(key);
    let source = entry !== undefined && entry.version === this.version ? entry.canvas : undefined;
    if (source === undefined) {
      this.scratch ??= makeCanvas(CHUNK_PX, CHUNK_PX);
      const sctx = this.scratch?.getContext('2d');
      if (this.scratch === undefined || sctx === null || sctx === undefined) return;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      try {
        paintChunk(sctx, this.grid, cx, cy, this.state);
      } catch {
        this.refined.set(key, this.version);
        return;
      }
      source = this.scratch;
    }
    const k = OVERVIEW_PX_PER_CELL * CHUNK_CELLS;
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(source, 0, 0, CHUNK_PX, CHUNK_PX, cx * k, cy * k, k, k);
    this.refined.set(key, this.version);
  }

  /**
   * 見えているチャンクを描く（焼けていない所は全体図か古い絵で埋め、近い順に少しずつ焼く）。
   * @param ctx 2D コンテキスト
   * @param t 変換
   * @param vp 描画領域
   * @param dpr デバイスピクセル比
   * @returns まだ焼くチャンクが残っていれば true
   * @sideEffect canvas に描く。チャンクを焼く
   */
  private drawChunks(ctx: CanvasRenderingContext2D, t: GridTransform, vp: Viewport, dpr: number): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
    const chunkW = t.cellW * CHUNK_CELLS;
    const chunkH = t.cellH * CHUNK_CELLS;
    const maxCx = Math.ceil(this.grid.cols / CHUNK_CELLS) - 1;
    const maxCy = Math.ceil(this.grid.rows / CHUNK_CELLS) - 1;
    const cx0 = Math.max(0, Math.floor(-t.ox / chunkW));
    const cy0 = Math.max(0, Math.floor(-t.oy / chunkH));
    const cx1 = Math.min(maxCx, Math.floor((vp.width - t.ox) / chunkW));
    const cy1 = Math.min(maxCy, Math.floor((vp.height - t.oy) / chunkH));
    const pending: { cx: number; cy: number; d: number }[] = [];
    ctx.imageSmoothingEnabled = (t.cellW / 8) * dpr < 0.75;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const entry = this.chunks.get(`${cx},${cy}`);
        // 隣のチャンクとの間に隙間ができないよう、端をデバイスピクセルに合わせる
        const x0 = Math.round((t.ox + cx * chunkW) * dpr) / dpr;
        const y0 = Math.round((t.oy + cy * chunkH) * dpr) / dpr;
        const x1 = Math.round((t.ox + (cx + 1) * chunkW) * dpr) / dpr;
        const y1 = Math.round((t.oy + (cy + 1) * chunkH) * dpr) / dpr;
        if (entry === undefined) this.drawOverviewPatch(ctx, cx, cy, x0, y0, x1 - x0, y1 - y0);
        else {
          entry.lastUsed = this.frame;
          ctx.drawImage(entry.canvas, x0, y0, x1 - x0, y1 - y0);
        }
        if (entry === undefined || entry.version !== this.version) {
          pending.push({ cx, cy, d: Math.hypot(x0 + chunkW / 2 - vp.width / 2, y0 + chunkH / 2 - vp.height / 2) });
        }
      }
    }
    pending.sort((a, b) => a.d - b.d);
    const started = performance.now();
    let baked = 0;
    for (const p of pending) {
      if (baked >= CHUNKS_PER_FRAME || performance.now() - started > CHUNK_BUDGET_MS) break;
      this.bakeChunk(p.cx, p.cy);
      baked++;
    }
    if (baked > 0) this.evict();
    return pending.length > baked;
  }

  /**
   * まだ焼けていないチャンクの場所を、全体図の該当部分で埋める。
   * @param ctx 2D コンテキスト
   * @param cx チャンクの列
   * @param cy チャンクの行
   * @param x 画面の左
   * @param y 画面の上
   * @param w 画面の幅
   * @param h 画面の高さ
   * @sideEffect canvas に描く
   */
  private drawOverviewPatch(ctx: CanvasRenderingContext2D, cx: number, cy: number, x: number, y: number, w: number, h: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const overview = this.ensureOverview();
    if (overview === undefined) return;
    const k = OVERVIEW_PX_PER_CELL;
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(overview, cx * CHUNK_CELLS * k, cy * CHUNK_CELLS * k, CHUNK_CELLS * k, CHUNK_CELLS * k, x, y, w, h);
    ctx.imageSmoothingEnabled = smoothing;
  }

  /**
   * チャンクを1枚焼く（既にあれば同じ canvas に描き直す）。
   * @param cx チャンクの列
   * @param cy チャンクの行
   * @sideEffect キャッシュを書き換える
   */
  private bakeChunk(cx: number, cy: number): void {
    const log = logger.fn('bakeChunk', { cx, cy, version: this.version });
    const key = `${cx},${cy}`;
    const existing = this.chunks.get(key);
    const canvas = existing?.canvas ?? makeCanvas(CHUNK_PX, CHUNK_PX);
    const ctx = canvas?.getContext('2d');
    if (canvas === undefined || ctx === null || ctx === undefined) return log.exit(undefined, 'canvas なし');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    try {
      paintChunk(ctx, this.grid, cx, cy, this.state);
    } catch (error) {
      log.error('チャンクを描けませんでした', { error });
    }
    this.chunks.set(key, { canvas, version: this.version, lastUsed: this.frame });
    log.exit(undefined);
  }

  /**
   * キャッシュが上限を超えたら、長く使っていないチャンクから捨てる。
   * @sideEffect キャッシュを減らす
   */
  private evict(): void { // audit-ignore: fnlog-missing 毎フレーム描画（捨てるときだけ数を数える）
    if (this.chunks.size <= MAX_CACHED_CHUNKS) return;
    const entries = [...this.chunks.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key] of entries.slice(0, this.chunks.size - MAX_CACHED_CHUNKS)) this.chunks.delete(key);
  }

  /**
   * 陣地を色の面で重ねる（引いて見たとき、どこが自分の陣地かひと目で分かるように。1セル=1ドットの画像を拡大）。
   * @param ctx 2D コンテキスト
   * @param camera カメラ
   * @param vp 描画領域
   * @param alpha 不透明度
   * @sideEffect canvas に描く。陣地の画像を作り直す
   */
  drawTerritoryWash(ctx: CanvasRenderingContext2D, camera: Camera, vp: Viewport, alpha: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    if (alpha <= 0) return;
    if (this.wash === undefined || this.washVersion !== this.version) this.refreshWash();
    const wash = this.wash;
    if (wash === undefined) return;
    const t = gridTransform(this.grid, camera, vp);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(wash, t.ox, t.oy, this.grid.cols * t.cellW, this.grid.rows * t.cellH);
    ctx.restore();
  }

  /**
   * 陣地の画像（1セル=1ドット。自分は朱、ライバルは紫）を作る。
   * @sideEffect 陣地の画像を作り直す
   */
  private refreshWash(): void {
    const log = logger.fn('refreshWash', { version: this.version });
    const canvas = this.wash ?? makeCanvas(this.grid.cols, this.grid.rows);
    const ctx = canvas?.getContext('2d');
    if (canvas === undefined || ctx === null || ctx === undefined) return log.exit(undefined, 'canvas なし');
    const image = ctx.createImageData(this.grid.cols, this.grid.rows);
    const cells = this.state.territory;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (v !== TERRITORY_MINE && v !== TERRITORY_RIVAL) continue;
      const o = i * 4;
      image.data[o] = v === TERRITORY_MINE ? 255 : 123;
      image.data[o + 1] = v === TERRITORY_MINE ? 106 : 97;
      image.data[o + 2] = v === TERRITORY_MINE ? 61 : 255;
      image.data[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    this.wash = canvas;
    this.washVersion = this.version;
    log.exit(undefined);
  }

  /**
   * キャッシュを捨てる（画面を閉じるとき）。
   * @sideEffect キャッシュを空にする
   */
  dispose(): void {
    const log = logger.fn('dispose', { chunks: this.chunks.size });
    this.chunks.clear();
    this.overview = undefined;
    log.exit(undefined);
  }
}
