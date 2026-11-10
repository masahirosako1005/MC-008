/**
 * @file QR コードを読み取る画面（presentation/screens/Map/town 層）
 * 2026-11-09 ユーザー指示「チェックインを QR コードにしてほしい（デモ向けに自動的な演出）。購入も別の QR など」。
 * お店の QR（チェックイン）とレジの QR（購入）を読み取る画面。デモではカメラの代わりに、お店の QR スタンドが
 * 手ぶれしながら枠に入ってきて、ピタッと合うと「ピピッ」と読み取れる演出を自動で流す（本物のカメラ読み取りは未実装）。
 * 読み取れたら onScanned を呼んで閉じる（その後の演出・記録は MapScreen）。乱数は使わずお店の ID で QR の模様を決める。
 */
import { createLogger } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { canvasFont } from '@/Common/ui/canvas/drawUtils';
import { createSeededRandom, hashString } from '@/Common/ui/canvas/seededHash';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';
import { PALETTE } from '@/Common/ui/theme/palette';
import { playScanBeep, unlockSound } from '@/presentation/screens/Map/town/mapSound';

const logger = createLogger('presentation/screens/Map/town/QrScanSheet');

/** 枠に入ってくるまで（ミリ秒） */
export const AIM_MS = 1150;
/** 合ってから読み取りまで（ミリ秒） */
const LOCK_MS = 260;
/** 読み取ってから閉じるまで（ミリ秒） */
const DONE_MS = 520;
/** QR のマスの数（一辺） */
const QR_MODULES = 25;

/** 読み取りの種類 */
export type QrScanKind = 'checkin' | 'purchase';

/** 読み取り画面のオプション */
export interface QrScanOptions {
  readonly kind: QrScanKind;
  readonly spotId: string;
  readonly spotName: string;
  /** デモ（自動で読み取る） */
  readonly demo: boolean;
  onScanned(): void;
  onCancel(): void;
}

/**
 * 読み取り画面を開く（地図の領域いっぱいに重ねる）。
 * @param host 重ねる先（地図の領域）
 * @param opts 種類・お店・読み取れたとき・やめたとき
 * @returns 閉じる関数
 * @sideEffect DOM を足し、アニメーションを始める
 */
export function openQrScan(host: HTMLElement, opts: QrScanOptions): () => void {
  const log = logger.fn('openQrScan', { kind: opts.kind, spotId: opts.spotId, demo: opts.demo });
  unlockSound();
  const canvas = h('canvas', { class: 'map-qr__view', attrs: { 'aria-hidden': 'true' } });
  const status = h('p', { class: 'map-qr__status', attrs: { role: 'status', 'aria-live': 'polite' }, text: opts.kind === 'checkin' ? 'お店のQRを枠に' : 'レジのQRを枠に' });
  let closed = false;
  let raf: number | undefined;
  /**
   * 閉じる（2回目以降は何もしない）。
   * @sideEffect DOM を外し、アニメーションを止める
   */
  const close = (): void => {
    const closeLog = logger.fn('close', { closed });
    if (closed) return closeLog.exit(undefined);
    closed = true;
    if (raf !== undefined) cancelAnimationFrame(raf);
    root.remove();
    closeLog.exit(undefined);
  };
  const cancel = h('button', { class: 'map-qr__close', attrs: { type: 'button', 'aria-label': 'やめる', 'data-testid': 'qr-cancel' }, on: { click: userAction('qr-cancel', () => { close(); opts.onCancel(); }) } }, [createIcon('close')]);
  const title = h('p', { class: 'map-qr__title', text: opts.kind === 'checkin' ? 'クエスト達成' : '購入QR' });
  const root = h('section', { class: ['map-qr', `map-qr--${opts.kind}`], attrs: { 'data-testid': 'qr-scan', 'data-kind': opts.kind, 'aria-label': title.textContent ?? '' } }, [canvas, h('div', { class: 'map-qr__top' }, [title, cancel]), status]);
  host.append(root);
  const started = performance.now();
  let beeped = false;
  /**
   * 1フレーム描き、読み取りの段階を進める。
   * @sideEffect canvas に描く。読み取れたら onScanned を呼んで閉じる
   */
  const frame = (): void => { // audit-ignore: fnlog-missing 毎フレーム描画
    if (closed) return;
    const t = performance.now() - started;
    paintScan(canvas, opts, t);
    if (t > AIM_MS + LOCK_MS && !beeped) {
      beeped = true;
      playScanBeep();
      status.textContent = '読み取り完了';
      root.dataset.done = '1';
    }
    if (t > AIM_MS + LOCK_MS + DONE_MS) {
      close();
      opts.onScanned();
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return log.exit(close);
}

/**
 * 0..1 をなめらかに（はじめ速く、最後ゆっくり）。
 * @param k 進み
 * @returns なめらかにした進み
 */
function easeOut(k: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const c = Math.min(1, Math.max(0, k));
  return 1 - (1 - c) ** 3;
}

/**
 * 読み取り画面の絵（ぼけた店先・枠・走る線・入ってくる QR スタンド）を描く。
 * @param canvas 描く canvas
 * @param opts オプション
 * @param t 開いてからの時間（ミリ秒）
 * @sideEffect canvas に描く（大きさも合わせる）
 */
function paintScan(canvas: HTMLCanvasElement, opts: QrScanOptions, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const dpr = normalizeDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  const w = Math.max(1, canvas.clientWidth);
  const hgt = Math.max(1, canvas.clientHeight);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintBackdrop(ctx, w, hgt, t, opts.spotId);
  const size = Math.min(w * 0.68, 250);
  const cx = w / 2;
  const cy = hgt * 0.46;
  const k = easeOut(t / AIM_MS);
  const shake = (1 - k) * 10;
  const px = cx + (1 - k) * w * 0.32 + Math.sin(t / 90) * shake;
  const py = cy + (1 - k) * hgt * 0.22 + Math.cos(t / 110) * shake;
  const rot = (1 - k) * -0.42 + Math.sin(t / 160) * 0.02 * (1 - k);
  const scale = 0.55 + 0.45 * k;
  paintStand(ctx, px, py, size * 0.78 * scale, rot, opts);
  paintFrame(ctx, cx, cy, size, t, t > AIM_MS);
}

/**
 * カメラ越しのぼけた店先（暖かいボケ玉と周辺の暗さ）。
 * @param ctx 2D コンテキスト
 * @param w 幅
 * @param h 高さ
 * @param t 時間
 * @param spotId お店（色の種）
 * @sideEffect canvas に描く
 */
function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, spotId: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#2a2f3d');
  grad.addColorStop(1, '#141720');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const rnd = createSeededRandom(hashString(spotId));
  for (let i = 0; i < 14; i++) {
    const x = rnd() * w + Math.sin(t / 1400 + i) * 8;
    const y = rnd() * h * 0.9 + Math.cos(t / 1700 + i) * 6;
    const r = 18 + rnd() * 46;
    const warm = rnd() < 0.6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, warm ? 'rgba(255, 196, 120, 0.22)' : 'rgba(140, 190, 255, 0.18)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

/**
 * QR スタンド（白い台紙に QR・お店の名前。購入はお会計の札）。
 * @param ctx 2D コンテキスト
 * @param cx 中心
 * @param cy 中心
 * @param size QR の一辺
 * @param rot 傾き
 * @param opts オプション
 * @sideEffect canvas に描く
 */
function paintStand(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, rot: number, opts: QrScanOptions): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const pad = size * 0.1;
  const cardW = size + pad * 2;
  const cardH = size + pad * 2 + size * 0.26;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.roundRect(-cardW / 2 + 4, -cardH / 2 + 8, cardW, cardH, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 12);
  ctx.fill();
  ctx.fillStyle = opts.kind === 'checkin' ? PALETTE.brand : PALETTE.gold;
  ctx.beginPath();
  ctx.roundRect(-cardW / 2, cardH / 2 - size * 0.26, cardW, size * 0.26, [0, 0, 12, 12]);
  ctx.fill();
  ctx.fillStyle = opts.kind === 'checkin' ? '#ffffff' : PALETTE.brandNight;
  ctx.font = canvasFont(Math.max(11, size * 0.075), 800, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(opts.kind === 'checkin' ? `まちクエ ${opts.spotName}` : `お会計 ${opts.spotName}`, 0, cardH / 2 - size * 0.13, cardW - 12);
  paintQr(ctx, -size / 2, -cardH / 2 + pad, size, `${opts.kind}:${opts.spotId}`);
  ctx.restore();
}

/**
 * QR コードらしい模様（3隅の位置合わせの四角＋お店ごとに決まった模様）。
 * @param ctx 2D コンテキスト
 * @param x 左
 * @param y 上
 * @param size 一辺
 * @param seedText 模様の種
 * @sideEffect canvas に描く
 */
function paintQr(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, seedText: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const n = QR_MODULES;
  const m = size / n;
  const rnd = createSeededRandom(hashString(seedText));
  ctx.fillStyle = '#111318';
  /**
   * 位置合わせの四角（左上 7×7）の中か。
   * @param c 列
   * @param r 行
   * @returns 中なら true
   */
  const finder = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < 7 && r < 7; // audit-ignore: fnlog-missing 模様のマスごとの判定
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const inFinder = finder(c, r) || finder(c - (n - 7), r) || finder(c, r - (n - 7));
      const bit = rnd() < 0.5;
      if (inFinder || (c < 8 && r < 8) || (c > n - 9 && r < 8) || (c < 8 && r > n - 9)) continue;
      if (bit) ctx.fillRect(x + c * m, y + r * m, m + 0.4, m + 0.4);
    }
  }
  for (const [c, r] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
    ctx.fillRect(x + c * m, y + r * m, m * 7, m * 7);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + (c + 1) * m, y + (r + 1) * m, m * 5, m * 5);
    ctx.fillStyle = '#111318';
    ctx.fillRect(x + (c + 2) * m, y + (r + 2) * m, m * 3, m * 3);
  }
}

/**
 * 読み取りの枠（4隅のかぎ・走る光の線。合ったら緑になってきゅっと締まる）。
 * @param ctx 2D コンテキスト
 * @param cx 中心
 * @param cy 中心
 * @param size 一辺
 * @param t 時間
 * @param locked 合ったか
 * @sideEffect canvas に描く
 */
function paintFrame(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, t: number, locked: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const snap = locked ? Math.max(0, 1 - (t - AIM_MS) / LOCK_MS) : 1;
  const s = size * (locked ? 0.9 + 0.1 * snap : 1 + Math.sin(t / 300) * 0.012);
  const half = s / 2;
  const len = s * 0.18;
  ctx.save();
  ctx.strokeStyle = locked ? PALETTE.success : '#ffffff';
  ctx.lineWidth = locked ? 6 : 4;
  ctx.lineCap = 'round';
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * half, cy + sy * (half - len));
    ctx.lineTo(cx + sx * half, cy + sy * half);
    ctx.lineTo(cx + sx * (half - len), cy + sy * half);
    ctx.stroke();
  }
  if (!locked) {
    const y = cy - half + ((t / 900) % 1) * s;
    const g = ctx.createLinearGradient(0, y - 18, 0, y + 2);
    g.addColorStop(0, 'rgba(255, 207, 138, 0)');
    g.addColorStop(1, 'rgba(255, 207, 138, 0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - half + 8, y - 18, s - 16, 20);
  } else {
    ctx.globalAlpha = 0.25 * snap + 0.1;
    ctx.fillStyle = PALETTE.success;
    ctx.fillRect(cx - half, cy - half, s, s);
  }
  ctx.restore();
}
