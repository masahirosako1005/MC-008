/**
 * @file 地図のカメラ操作（presentation/screens/Map/town 層）
 * ドラッグで地図を動かす・2本指やホイールで拡大縮小・指を離した後の慣性・ボタンでの移動（なめらかに飛ぶ）・歩行中の追従をまとめる（2026-11-09 ユーザー指示「ドラッグしたときはマップを移動」）。
 * ドラッグせずに離したら「タップ」として通知する（ドラッグとタップを取り違えない）。カメラは街の外へ出ないよう、表示範囲ごと街の中に収める。
 * 座標はログに出さない（操作の種類だけ）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { setStyle } from '@/Common/ui/dom';
import { METERS_PER_DEG_LAT, easeInOutCubic, interpolateCamera, metersPerDegLng, unproject, viewAnchor } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, GeoBounds, LatLng, Viewport } from '@/presentation/screens/Map/MapViewModel';

const logger = createLogger('presentation/screens/Map/town/mapCamera');

/** これ以上動いたらドラッグとみなす（CSS px） */
export const DRAG_THRESHOLD_PX = 7;
/** いちばん寄ったときの縮尺（1 CSS px あたりのメートル） */
export const MIN_METERS_PER_PX = 0.22;
/** ボタンで飛ぶときの時間（ミリ秒） */
export const FLY_MS = 480;
/** 慣性の減り方（1ミリ秒あたりに速さに掛ける値） */
const INERTIA_DECAY_PER_MS = 0.9955;
/** 慣性を止める速さ（CSS px／ミリ秒） */
const INERTIA_STOP = 0.02;
/** ホイール1目盛りあたりの拡大率の指数 */
const WHEEL_ZOOM_RATE = 0.0016;
/** 追従するとき、画面の端からこの割合より内側にアイコンを保つ */
const FOLLOW_MARGIN_RATIO = 0.24;

/** カメラ操作の通知 */
export interface MapCameraHooks {
  /** ドラッグせずに離した（canvas 内の CSS px） */
  onTap(point: Point2D): void;
  /** カメラが動いた（描き直してほしい） */
  onChange(): void;
  /** 利用者が自分で動かした（追従をやめる） */
  onUserMove(): void;
}

/** 押している指（またはマウス） */
interface PointerState {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

/** 飛んでいる途中のカメラ */
interface Flight {
  readonly from: Camera;
  readonly to: Camera;
  readonly startedAt: number;
  readonly ms: number;
}

/**
 * 画面上の1点の下にある緯度経度を保ったまま、縮尺を変えたカメラを返す。
 * @param camera いまのカメラ
 * @param vp 描画領域
 * @param point 固定する画面上の点（CSS px）
 * @param metersPerPx 新しい縮尺
 * @returns 新しいカメラ
 */
export function zoomAround(camera: Camera, vp: Viewport, point: Point2D, metersPerPx: number): Camera {
  const log = logger.fn('zoomAround', { metersPerPx: Math.round(metersPerPx * 100) / 100 });
  const ll = unproject(camera, vp, point);
  const anchor = viewAnchor(vp);
  const centerLat = ll.lat + ((point.y - anchor.y) * metersPerPx) / METERS_PER_DEG_LAT;
  const centerLng = ll.lng - ((point.x - anchor.x) * metersPerPx) / metersPerDegLng(centerLat);
  return log.exit({ centerLat, centerLng, metersPerPx });
}

/**
 * カメラを、表示範囲ごと街の中に収める（縮尺も上限・下限に収める）。
 * @param camera カメラ
 * @param vp 描画領域
 * @param limits 街の範囲
 * @returns 収めたカメラ
 */
export function clampCamera(camera: Camera, vp: Viewport, limits: GeoBounds): Camera { // audit-ignore: fnlog-missing ドラッグ・毎フレームで呼ぶ純粋な算術ヘルパー
  const mLng = metersPerDegLng((limits.north + limits.south) / 2);
  const widthM = (limits.east - limits.west) * mLng;
  const heightM = (limits.north - limits.south) * METERS_PER_DEG_LAT;
  const maxMpp = Math.min(widthM / Math.max(1, vp.width), heightM / Math.max(1, vp.height));
  const mpp = Math.min(maxMpp, Math.max(MIN_METERS_PER_PX, camera.metersPerPx));
  const anchor = viewAnchor(vp);
  const leftM = anchor.x * mpp;
  const rightM = (vp.width - anchor.x) * mpp;
  const topM = anchor.y * mpp;
  const bottomM = (vp.height - anchor.y) * mpp;
  const minLng = limits.west + leftM / mLng;
  const maxLng = limits.east - rightM / mLng;
  const minLat = limits.south + bottomM / METERS_PER_DEG_LAT;
  const maxLat = limits.north - topM / METERS_PER_DEG_LAT;
  return {
    centerLat: minLat > maxLat ? (minLat + maxLat) / 2 : Math.min(maxLat, Math.max(minLat, camera.centerLat)),
    centerLng: minLng > maxLng ? (minLng + maxLng) / 2 : Math.min(maxLng, Math.max(minLng, camera.centerLng)),
    metersPerPx: mpp,
  };
}

/**
 * 1点が画面の内側（端から margin の割合より内）に入るよう、カメラを最小限ずらす。
 * @param camera カメラ
 * @param vp 描画領域
 * @param point 保ちたい点の画面座標（CSS px）
 * @param topInset 上端で隠れる高さ（上に浮いている部品と、点の上に立つ絵の高さ。CSS px。既定 0）
 * @returns ずらしたカメラ（入っていればそのまま）
 */
export function keepInside(camera: Camera, vp: Viewport, point: Point2D, topInset = 0): Camera { // audit-ignore: fnlog-missing 歩行の毎フレームで呼ぶ純粋な算術ヘルパー
  const usableH = Math.max(1, viewAnchor(vp).y * 2);
  const mx = vp.width * FOLLOW_MARGIN_RATIO;
  const my = usableH * FOLLOW_MARGIN_RATIO;
  const top = Math.min(Math.max(my, topInset), usableH / 2);
  const dx = point.x < mx ? point.x - mx : point.x > vp.width - mx ? point.x - (vp.width - mx) : 0;
  const dy = point.y < top ? point.y - top : point.y > usableH - my ? point.y - (usableH - my) : 0;
  if (dx === 0 && dy === 0) return camera;
  return {
    centerLat: camera.centerLat - (dy * camera.metersPerPx) / METERS_PER_DEG_LAT,
    centerLng: camera.centerLng + (dx * camera.metersPerPx) / metersPerDegLng(camera.centerLat),
    metersPerPx: camera.metersPerPx,
  };
}

/** 地図のカメラ（ドラッグ・拡大縮小・慣性・飛ぶ・追従） */
export class MapCameraController {
  private camera: Camera;
  private vp: Viewport = { width: 1, height: 1, bottomInset: 0 };
  private readonly pointers = new Map<number, PointerState>();
  private dragging = false;
  private pinchStart: { dist: number; mpp: number } | undefined;
  private velocity = { x: 0, y: 0 };
  private lastMove = 0;
  private inertiaAt: number | undefined;
  private flight: Flight | undefined;
  private readonly offs: (() => void)[] = [];

  /**
   * カメラ操作を canvas に取り付ける。
   * @param canvas 地図の canvas
   * @param limits 街の範囲（この外は映さない）
   * @param initial 最初のカメラ
   * @param hooks 通知
   * @sideEffect canvas にポインタ・ホイールのリスナを登録し、touch-action を none にする
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly limits: GeoBounds,
    initial: Camera,
    private readonly hooks: MapCameraHooks,
  ) {
    this.camera = initial;
    setStyle(canvas, 'touch-action', 'none');
    this.listen('pointerdown', (e) => this.handleDown(e as PointerEvent));
    this.listen('pointermove', (e) => this.handleMove(e as PointerEvent));
    this.listen('pointerup', (e) => this.handleUp(e as PointerEvent, true));
    this.listen('pointercancel', (e) => this.handleUp(e as PointerEvent, false));
    this.listen('wheel', (e) => this.handleWheel(e as WheelEvent), { passive: false });
  }

  /**
   * canvas にリスナを登録し、解除の関数を覚える。
   * @param type イベント名
   * @param fn 処理
   * @param options 登録のオプション
   * @sideEffect リスナを登録する
   */
  private listen(type: string, fn: (e: Event) => void, options?: AddEventListenerOptions): void {
    const log = logger.fn('listen', { type });
    this.canvas.addEventListener(type, fn, options);
    this.offs.push(() => this.canvas.removeEventListener(type, fn, options));
    log.exit(undefined);
  }

  /**
   * 描画領域を変える（カメラを収め直す）。
   * @param vp 描画領域
   * @sideEffect カメラを収め直す
   */
  setViewport(vp: Viewport): void {
    const log = logger.fn('setViewport', { width: vp.width, height: vp.height });
    this.vp = vp;
    this.camera = clampCamera(this.camera, vp, this.limits);
    log.exit(undefined);
  }

  /**
   * いまのカメラを返す（飛んでいる途中・慣性中なら進める）。
   * @param now 現在時刻（performance.now()）
   * @returns カメラ
   * @sideEffect 飛行・慣性を進め、終わったら片付ける
   */
  current(now: number): Camera { // audit-ignore: fnlog-missing 毎フレーム描画
    const flight = this.flight;
    if (flight !== undefined) {
      const k = (now - flight.startedAt) / flight.ms;
      if (k >= 1) {
        this.flight = undefined;
        this.camera = flight.to;
      } else this.camera = clampCamera(interpolateCamera(flight.from, flight.to, easeInOutCubic(k)), this.vp, this.limits);
    } else if (this.inertiaAt !== undefined) this.stepInertia(now);
    return this.camera;
  }

  /**
   * 動き続けているか（飛行中・慣性中・ドラッグ中）。
   * @returns 動いていれば true
   */
  isMoving(): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
    return this.flight !== undefined || this.inertiaAt !== undefined || this.dragging;
  }

  /**
   * カメラへなめらかに飛ぶ。
   * @param target 行き先のカメラ
   * @param ms 時間（ミリ秒）
   * @sideEffect 飛行を始める。慣性を止める
   */
  flyTo(target: Camera, ms = FLY_MS): void {
    const log = logger.fn('flyTo', { ms });
    this.inertiaAt = undefined;
    this.flight = { from: this.camera, to: clampCamera(target, this.vp, this.limits), startedAt: performance.now(), ms };
    this.hooks.onChange();
    log.exit(undefined);
  }

  /**
   * カメラをすぐ切り替える。
   * @param target カメラ
   * @sideEffect カメラを変え、飛行・慣性を止める
   */
  jumpTo(target: Camera): void {
    const log = logger.fn('jumpTo');
    this.flight = undefined;
    this.inertiaAt = undefined;
    this.camera = clampCamera(target, this.vp, this.limits);
    this.hooks.onChange();
    log.exit(undefined);
  }

  /**
   * 歩いている自分を追う（画面の端に寄ったら、最小限ずらす。利用者が触っている間・飛行中は追わない）。
   * @param position 自分の位置
   * @param project 緯度経度 → 画面座標
   * @param focus 自分を保つ範囲（カードで隠れる下側を除いた描画領域。省略時は描画領域全体）
   * @param topInset 上端で隠れる高さ（上に浮いている部品＋自分のアバターの背丈。CSS px）
   * @sideEffect カメラを少しずらす
   */
  follow(position: LatLng, project: (camera: Camera, ll: LatLng) => Point2D, focus?: Viewport, topInset = 0): void { // audit-ignore: fnlog-missing 歩行の毎フレームで呼ぶ
    if (this.dragging || this.flight !== undefined || this.pointers.size > 0) return;
    const next = keepInside(this.camera, focus ?? this.vp, project(this.camera, position), topInset);
    if (next === this.camera) return;
    // いきなり跳ばないよう、ずれの3割ずつ寄せる
    this.camera = clampCamera(interpolateCamera(this.camera, next, 0.3), this.vp, this.limits);
  }

  /**
   * 指（マウス）を置いた。
   * @param e ポインタイベント
   * @sideEffect ポインタを捕まえ、慣性・飛行を止める
   */
  private handleDown(e: PointerEvent): void {
    const log = logger.fn('handleDown', { pointers: this.pointers.size + 1, type: e.pointerType });
    const p = this.local(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, startX: p.x, startY: p.y });
    this.canvas.setPointerCapture?.(e.pointerId);
    this.inertiaAt = undefined;
    this.velocity = { x: 0, y: 0 };
    this.lastMove = e.timeStamp;
    if (this.pointers.size === 2) {
      this.flight = undefined;
      this.pinchStart = { dist: this.pinchDistance(), mpp: this.camera.metersPerPx };
      this.dragging = true;
    }
    log.exit(undefined);
  }

  /**
   * 指を動かした（1本はドラッグ、2本は拡大縮小）。
   * @param e ポインタイベント
   * @sideEffect カメラを動かす
   */
  private handleMove(e: PointerEvent): void { // audit-ignore: fnlog-missing ドラッグ中に毎フレーム呼ぶ
    const state = this.pointers.get(e.pointerId);
    if (state === undefined) return;
    const p = this.local(e);
    const dx = p.x - state.x;
    const dy = p.y - state.y;
    state.x = p.x;
    state.y = p.y;
    if (this.pointers.size >= 2) return this.pinch();
    if (!this.dragging && Math.hypot(p.x - state.startX, p.y - state.startY) < DRAG_THRESHOLD_PX) return;
    if (!this.dragging) this.beginUserMove();
    this.panBy(dx, dy);
    const dt = Math.max(1, e.timeStamp - this.lastMove);
    this.velocity = { x: this.velocity.x * 0.6 + (dx / dt) * 0.4, y: this.velocity.y * 0.6 + (dy / dt) * 0.4 };
    this.lastMove = e.timeStamp;
  }

  /**
   * 利用者が地図を動かし始めた（飛行をやめ、追従をやめるよう知らせる）。
   * @sideEffect ドラッグ中にする。onUserMove を呼ぶ
   */
  private beginUserMove(): void {
    const log = logger.fn('beginUserMove');
    this.dragging = true;
    this.flight = undefined;
    this.hooks.onUserMove();
    log.exit(undefined);
  }

  /**
   * 2本指の拡大縮小（2本の中点を固定する）。
   * @sideEffect カメラを変える
   */
  private pinch(): void { // audit-ignore: fnlog-missing ピンチ中に毎フレーム呼ぶ
    const start = this.pinchStart;
    if (start === undefined) return;
    const dist = this.pinchDistance();
    if (dist <= 0) return;
    const [a, b] = [...this.pointers.values()];
    if (a === undefined || b === undefined) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.camera = clampCamera(zoomAround(this.camera, this.vp, mid, (start.mpp * start.dist) / dist), this.vp, this.limits);
    this.hooks.onUserMove();
    this.hooks.onChange();
  }

  /**
   * 2本の指の距離。
   * @returns 距離（CSS px）
   */
  private pinchDistance(): number { // audit-ignore: fnlog-missing ピンチ中に毎フレーム呼ぶ
    const [a, b] = [...this.pointers.values()];
    return a === undefined || b === undefined ? 0 : Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * 指を離した（動かしていなければタップ、動かしていれば慣性）。
   * @param e ポインタイベント
   * @param completed 正常に離したか（キャンセルは false）
   * @sideEffect onTap を呼ぶ、または慣性を始める
   */
  private handleUp(e: PointerEvent, completed: boolean): void {
    const log = logger.fn('handleUp', { pointers: this.pointers.size, dragging: this.dragging });
    const state = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.canvas.releasePointerCapture?.(e.pointerId);
    if (this.pointers.size > 0) {
      this.pinchStart = undefined;
      return log.exit(undefined, 'まだ指がある');
    }
    const wasDragging = this.dragging;
    this.dragging = false;
    this.pinchStart = undefined;
    if (!wasDragging && completed && state !== undefined) {
      this.hooks.onTap({ x: state.x, y: state.y });
      return log.exit(undefined, 'タップ');
    }
    if (wasDragging && e.timeStamp - this.lastMove < 80 && Math.hypot(this.velocity.x, this.velocity.y) > INERTIA_STOP * 4) {
      this.inertiaAt = performance.now();
      this.hooks.onChange();
    }
    log.exit(undefined, 'ドラッグ終わり');
  }

  /**
   * 慣性で1フレーム進める。
   * @param now 現在時刻
   * @sideEffect カメラを動かす。遅くなったら慣性を止める
   */
  private stepInertia(now: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const last = this.inertiaAt ?? now;
    const dt = Math.min(48, Math.max(0, now - last));
    this.inertiaAt = now;
    const decay = Math.pow(INERTIA_DECAY_PER_MS, dt);
    this.velocity = { x: this.velocity.x * decay, y: this.velocity.y * decay };
    this.panBy(this.velocity.x * dt, this.velocity.y * dt);
    if (Math.hypot(this.velocity.x, this.velocity.y) < INERTIA_STOP) this.inertiaAt = undefined;
  }

  /**
   * ホイールで拡大縮小する（カーソルの下を固定）。
   * @param e ホイールイベント
   * @sideEffect カメラを変える。ページのスクロールを止める
   */
  private handleWheel(e: WheelEvent): void {
    const log = logger.fn('handleWheel');
    e.preventDefault();
    this.flight = undefined;
    this.inertiaAt = undefined;
    const factor = Math.exp(e.deltaY * WHEEL_ZOOM_RATE * (e.deltaMode === 1 ? 16 : 1));
    this.camera = clampCamera(zoomAround(this.camera, this.vp, this.local(e), this.camera.metersPerPx * factor), this.vp, this.limits);
    this.hooks.onUserMove();
    this.hooks.onChange();
    log.exit(undefined);
  }

  /**
   * 画面上で (dx, dy) だけ地図を動かす（指の動きに地図がついてくる向き）。
   * @param dx 横（CSS px）
   * @param dy 縦（CSS px）
   * @sideEffect カメラを動かす
   */
  private panBy(dx: number, dy: number): void { // audit-ignore: fnlog-missing ドラッグ・慣性で毎フレーム呼ぶ
    const c = this.camera;
    this.camera = clampCamera(
      { centerLat: c.centerLat + (dy * c.metersPerPx) / METERS_PER_DEG_LAT, centerLng: c.centerLng - (dx * c.metersPerPx) / metersPerDegLng(c.centerLat), metersPerPx: c.metersPerPx },
      this.vp,
      this.limits,
    );
    this.hooks.onChange();
  }

  /**
   * イベントの位置を canvas 内の CSS px にする。
   * @param e マウス・ポインタイベント
   * @returns canvas 内の点
   */
  private local(e: MouseEvent): Point2D { // audit-ignore: fnlog-missing ポインタの移動ごとに呼ぶ変換ヘルパー
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /**
   * リスナを外す。
   * @sideEffect canvas のリスナを解除する
   */
  destroy(): void {
    const log = logger.fn('destroy');
    for (const off of this.offs.splice(0)) off();
    this.pointers.clear();
    log.exit(undefined);
  }
}
