/**
 * @file ランク画面の動きの部品（presentation/screens/Rank 層）
 * - 数え上げ: 複数の数字を1本の requestAnimationFrame でまとめて回す（開始の遅れ・ease-out）。飛ばすと全部最後の数にする
 * - 傾き: 盤の上でポインタを動かすと紋章が3Dに傾く（発表の PC ではマウスで反応する）。離れると戻す
 * - 出現: 画面に入ったまとまりに is-in を付ける（IntersectionObserver。使えなければすぐ付ける）
 * 動きを減らす設定では、数え上げ・傾きはしない（CSS 側の動きも止まる）。
 */
import { createLogger } from '@/Common/logging/logger';
import { setStyle } from '@/Common/ui/dom';

const logger = createLogger('presentation/screens/Rank/rankFx');

/** 傾きの CSS 変数を書き換えるときの小数の桁 */
const TILT_DIGITS = 3;

/** 出現とみなす見えている割合 */
const REVEAL_THRESHOLD = 0.15;

/**
 * 動きを減らす設定か。
 * @returns 減らす設定なら true
 */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 0..1 の進み具合を ease-out（三次）にする。
 * @param t 進み具合
 * @returns ゆるめた値
 */
export function easeOutCubic(t: number): number { // audit-ignore: fnlog-missing 毎フレームの数え上げから呼ぶ純粋な算術
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/** 数え上げの1件 */
interface Counting {
  readonly el: HTMLElement;
  readonly to: number;
  readonly start: number;
  readonly onDone?: () => void;
  done: boolean;
}

/** 数え上げの操作 */
export interface CounterRunner {
  /** el の数字を 0 から to まで数え上げる（delayMs 待ってから） */
  count(el: HTMLElement, to: number, delayMs?: number, onDone?: () => void): void;
  /** 数え上げ中のものを全部最後の数にする（演出を飛ばしたとき） */
  finish(): void;
  /** 止める（画面を離れたとき。数字はそのまま） */
  stop(): void;
}

/** 数え上げ（1本の requestAnimationFrame で複数の数字を進める） */
class Counter implements CounterRunner {
  private readonly items: Counting[] = [];
  private frame: number | undefined;

  /**
   * 数え上げを作る。
   * @param durationMs 1件の数え上げにかける時間（ms）
   */
  constructor(private readonly durationMs: number) {}

  /**
   * el の数字を 0 から to まで数え上げる。動きを減らす設定・0 以下なら最初から to にする。
   * @param el 数字の要素
   * @param to 目標
   * @param delayMs 始めるまでの待ち（ms）
   * @param onDone 終わったときの処理
   * @sideEffect el の文字を書き換え、requestAnimationFrame を予約する
   */
  count(el: HTMLElement, to: number, delayMs = 0, onDone?: () => void): void {
    const log = logger.fn('count', { to, delayMs });
    if (prefersReducedMotion() || to <= 0 || typeof requestAnimationFrame !== 'function') {
      el.textContent = String(to);
      onDone?.();
      return log.exit(undefined, '数え上げなし');
    }
    el.textContent = '0';
    this.items.push({ el, to, start: performance.now() + delayMs, onDone, done: false });
    if (this.frame === undefined) this.frame = requestAnimationFrame(this.tick);
    log.exit(undefined);
  }

  /**
   * 数え上げ中のものを全部最後の数にして止める。
   * @sideEffect 文字を書き換え、requestAnimationFrame を取り消す
   */
  finish(): void {
    const log = logger.fn('finish', { items: this.items.length });
    for (const item of this.items) if (!item.done) this.complete(item);
    this.stop();
    log.exit(undefined);
  }

  /**
   * 止める（数字はそのまま）。
   * @sideEffect requestAnimationFrame を取り消す
   */
  stop(): void {
    const log = logger.fn('stop', { running: this.frame !== undefined });
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    log.exit(undefined);
  }

  /**
   * 1件を最後の数にして、終わりの処理を呼ぶ。
   * @param item 数え上げの1件
   * @sideEffect 文字を書き換える
   */
  private complete(item: Counting): void { // audit-ignore: fnlog-missing 毎フレームの数え上げから呼ぶ小さな処理（開始は count でログ）
    item.done = true;
    item.el.textContent = String(item.to);
    item.onDone?.();
  }

  /**
   * 1フレーム分だけ全部の数字を進める（全部終わったら止まる）。
   * @param now requestAnimationFrame の時刻
   * @sideEffect 文字を書き換え、次のフレームを予約する
   */
  private readonly tick = (now: number): void => { // audit-ignore: fnlog-missing 毎フレーム呼ばれる数え上げ（開始は count でログ）
    for (const item of this.items) {
      if (item.done) continue;
      const t = (now - item.start) / this.durationMs;
      if (t >= 1) this.complete(item);
      else item.el.textContent = String(Math.round(item.to * easeOutCubic(t)));
    }
    this.frame = this.items.some((i) => !i.done) ? requestAnimationFrame(this.tick) : undefined;
  };
}

/**
 * 数え上げの仕組みを作る。
 * @param durationMs 1件の数え上げにかける時間（ms）
 * @returns 数え上げの操作
 */
export function createCounterRunner(durationMs: number): CounterRunner {
  const log = logger.fn('createCounterRunner', { durationMs });
  return log.exit(new Counter(durationMs));
}

/**
 * 盤の上のポインタの位置に合わせて、紋章を3Dに傾ける（CSS 変数 --tilt-x / --tilt-y を -1..1 で書く）。
 * 傾けている間は is-tilting を付ける（CSS の「ゆらゆら」を止める）。動きを減らす設定では何もしない。
 * @param surface ポインタを受ける要素（盤）
 * @param target 傾ける要素
 * @returns 外す関数
 * @sideEffect pointermove / pointerleave を登録し、target の style を書き換える
 */
export function attachTilt(surface: HTMLElement, target: HTMLElement): () => void {
  const log = logger.fn('attachTilt');
  if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') return log.exit((): void => undefined, '傾きなし');
  let frame: number | undefined;
  let next = { x: 0, y: 0 };
  /**
   * 予約した傾きを書き込む。
   * @sideEffect target の style を書き換える
   */
  const apply = (): void => { // audit-ignore: fnlog-missing ポインタが動くたびに呼ぶ書き込み（登録は attachTilt でログ）
    frame = undefined;
    setStyle(target, '--tilt-x', next.x.toFixed(TILT_DIGITS));
    setStyle(target, '--tilt-y', next.y.toFixed(TILT_DIGITS));
  };
  /**
   * ポインタの位置を -1..1 にして傾きを予約する。
   * @param e ポインタのイベント
   */
  const onMove = (e: PointerEvent): void => { // audit-ignore: fnlog-missing ポインタが動くたびに呼ぶ（登録は attachTilt でログ）
    const r = surface.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    next = { x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)), y: Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1)) };
    target.classList.add('is-tilting');
    if (frame === undefined) frame = requestAnimationFrame(apply);
  };
  /**
   * ポインタが離れたら傾きを戻す。
   */
  const onLeave = (): void => { // audit-ignore: fnlog-missing ポインタが離れるたびに呼ぶ（登録は attachTilt でログ）
    next = { x: 0, y: 0 };
    target.classList.remove('is-tilting');
    if (frame === undefined) frame = requestAnimationFrame(apply);
  };
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerleave', onLeave);
  return log.exit((): void => {
    surface.removeEventListener('pointermove', onMove);
    surface.removeEventListener('pointerleave', onLeave);
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  });
}

/**
 * 要素が画面に入ったら is-in を付けて onIn を呼ぶ（1回だけ）。IntersectionObserver が無ければすぐ付ける。
 * @param elements 見張る要素
 * @param onIn 入ったときの処理
 * @returns 見張りをやめる関数
 * @sideEffect IntersectionObserver を作り、要素に is-in を付ける
 */
export function observeReveal(elements: readonly HTMLElement[], onIn: (el: HTMLElement) => void): () => void {
  const log = logger.fn('observeReveal', { elements: elements.length });
  /**
   * 1つを出現させる。
   * @param el 要素
   * @sideEffect is-in を付け、onIn を呼ぶ
   */
  const reveal = (el: HTMLElement): void => { // audit-ignore: fnlog-missing まとまりごとに1回呼ぶ小さな処理（見張りは observeReveal でログ）
    el.classList.add('is-in');
    onIn(el);
  };
  if (typeof IntersectionObserver !== 'function') {
    elements.forEach(reveal);
    return log.exit((): void => undefined, 'IntersectionObserver なし');
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
        observer.unobserve(entry.target);
        reveal(entry.target);
      }
    },
    { threshold: REVEAL_THRESHOLD },
  );
  elements.forEach((el) => observer.observe(el));
  return log.exit((): void => observer.disconnect());
}
