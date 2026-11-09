/**
 * @file マイ街の街並み（横スクロールの Canvas 部品。presentation/screens/MyTown 層）
 * ドラッグで横に動かし、指を離すと一番近い地区で止まる。左右の ‹ › ボタンでも1地区ずつ送れる（スワイプに気づかない人向け）。
 * タップした地区を中央に寄せる。中央の地区が変わったら onCenterChange で知らせる（地区の詳細・セレクタを更新する）。
 * スクロールの補間は requestAnimationFrame。止まったらループも止める（常時は回さない）。動きを減らす設定なら補間せず即移動する。
 */
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { textScaleFactor } from '@/Common/ui/a11y/textScale';
import { beginFrame, createCanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { AvatarLook } from '@/presentation/screens/MyTown/avatarArt';
import { centerDistrictIndexOf, clampScrollX, scrollXForDistrict } from '@/presentation/screens/MyTown/myTownModel';
import { DISTRICT_WIDTH_PX, STRIP_HEIGHT_PX } from '@/presentation/screens/MyTown/townScenes';
import { drawTownStrip } from '@/presentation/screens/MyTown/townStripArt';
import type { StripDistrictVm } from '@/presentation/screens/MyTown/townStripArt';

const logger = createLogger('presentation/screens/MyTown/TownStrip');

/** ドラッグとみなす移動量（px）。これ未満で指を離したらタップ */
const DRAG_THRESHOLD_PX = 5;

/** 補間の係数（1フレームで残りの何割進むか） */
const EASE_FACTOR = 0.16;

/** createTownStrip のオプション */
export interface TownStripOptions {
  readonly districts: readonly StripDistrictVm[];
  readonly avatarIndex: number;
  readonly avatarLook: AvatarLook;
  /** アバターのセリフ（吹き出し） */
  readonly avatarSay?: string;
  /** 最初に中央に置く地区 */
  readonly initialIndex: number;
  /** 中央の地区が変わったとき */
  readonly onCenterChange: (index: number) => void;
}

/** 街並みの操作口 */
export interface TownStripHandle {
  readonly element: HTMLElement;
  /** 指定の地区を中央へ動かす */
  scrollToDistrict(index: number): void;
  /** ループ・監視を止める */
  destroy(): void;
}

/**
 * 動きを減らす設定か。
 * @returns 減らす設定なら true
 */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 街並みの部品を作る。
 * @param opts 地区・アバター・最初の地区・中央が変わったときの処理
 * @returns 操作口
 * @sideEffect DOM を作り、Canvas の大きさの監視を始める
 */
export function createTownStrip(opts: TownStripOptions): TownStripHandle {
  const log = logger.fn('createTownStrip', { count: opts.districts.length, initialIndex: opts.initialIndex });
  const strip = new TownStripController(opts);
  return log.exit({ element: strip.element, scrollToDistrict: (i: number): void => strip.scrollToDistrict(i), destroy: (): void => strip.destroy() });
}

/** 街並みの状態（スクロール位置・ドラッグ・ループ） */
class TownStripController {
  readonly element: HTMLElement;
  private readonly opts: TownStripOptions;
  private readonly prevButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private surface: CanvasSurface | undefined;
  private x = 0;
  private target = 0;
  private centerIndex = -1;
  private drag: { readonly startX: number; readonly startScroll: number; moved: boolean } | undefined;
  private frame: number | undefined;
  /** 街の動きの時刻（ms） */
  private time = 0;
  /** 表示幅が決まって最初の地区へ移動済みか */
  private positioned = false;

  /**
   * DOM と Canvas を作る。
   * @param opts 部品のオプション
   */
  constructor(opts: TownStripOptions) {
    const log = logger.fn('constructor', { count: opts.districts.length });
    this.opts = opts;
    this.prevButton = this.createArrow('prev');
    this.nextButton = this.createArrow('next');
    const stage = h('div', { class: 'mytown-strip__stage' });
    this.element = h('div', { class: 'mytown-strip', attrs: { 'data-testid': 'mytown-strip' } }, [stage, this.prevButton, this.nextButton]);
    this.surface = createCanvasSurface(stage, {
      testId: 'mytown-strip-canvas',
      ariaLabel: 'あなたの街の全景。訪れた地区ほど建物が増え、しばらく訪れていない地区は色が薄くなります',
      onResize: (): void => this.onResize(),
    });
    this.bindPointer(stage);
    log.exit(undefined);
  }

  /**
   * 左右の送りボタンを作る。
   * @param dir 向き
   * @returns ボタン
   */
  private createArrow(dir: 'prev' | 'next'): HTMLButtonElement {
    const log = logger.fn('createArrow', { dir });
    const label = dir === 'prev' ? '前の地区' : '次の地区';
    const button = h('button', {
      class: ['mytown-strip__arrow', `mytown-strip__arrow--${dir}`],
      attrs: { type: 'button', 'aria-label': label, 'data-testid': `mytown-strip-${dir}` },
    }, [createIcon(dir === 'prev' ? 'chevronLeft' : 'chevronRight')]);
    button.addEventListener('click', () => {
      setCorrelationId();
      this.scrollToDistrict(this.centerIndex + (dir === 'prev' ? -1 : 1));
    });
    return log.exit(button);
  }

  /**
   * 大きさが変わったら、最初の1回は初期地区へ即移動し、以後は今の位置で描き直す。
   * @sideEffect スクロール位置を設定し、描画する
   */
  private onResize(): void {
    const log = logger.fn('onResize');
    if (!this.positioned && this.viewWidth() > 1) {
      this.positioned = true;
      this.target = this.clamp(scrollXForDistrict(this.opts.initialIndex, this.viewWidth(), this.districtWidth()));
      this.x = this.target;
    } else {
      this.target = this.clamp(this.target);
      this.x = this.clamp(this.x);
    }
    this.render();
    this.startLoop();
    log.exit(undefined);
  }

  /**
   * 表示幅（CSS px）。
   * @returns 幅
   */
  private viewWidth(): number {
    return this.surface?.size().width ?? 0;
  }

  /**
   * 表示の拡大率（街並みの絵の高さ STRIP_HEIGHT_PX を表示の高さに合わせる。ヒーローでは 1 より大きい）。
   * @returns 拡大率（1 以上）
   */
  private zoom(): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ算術ヘルパー
    const height = this.surface?.size().height ?? STRIP_HEIGHT_PX;
    return Math.max(1, height / STRIP_HEIGHT_PX);
  }

  /**
   * 表示上の1地区の幅（CSS px）。
   * @returns 幅
   */
  private districtWidth(): number {
    return DISTRICT_WIDTH_PX * this.zoom();
  }

  /**
   * スクロール位置を範囲内に収める。
   * @param x 位置
   * @returns 収めた位置
   */
  private clamp(x: number): number {
    return clampScrollX(x, this.viewWidth(), this.districtWidth() * this.opts.districts.length);
  }

  /**
   * 指定の地区を中央へ動かす（範囲外は端の地区に丸める）。
   * @param index 地区のインデックス
   * @sideEffect 目標位置を変え、補間ループを始める
   */
  scrollToDistrict(index: number): void {
    const log = logger.fn('scrollToDistrict', { index });
    const safe = Math.max(0, Math.min(this.opts.districts.length - 1, index));
    this.target = this.clamp(scrollXForDistrict(safe, this.viewWidth(), this.districtWidth()));
    if (prefersReducedMotion()) this.x = this.target;
    this.startLoop();
    log.exit(undefined);
  }

  /**
   * ドラッグ・タップを登録する。
   * @param stage canvas の親要素
   * @sideEffect pointer イベントを登録する
   */
  private bindPointer(stage: HTMLElement): void {
    const log = logger.fn('bindPointer');
    stage.addEventListener('pointerdown', (e) => {
      this.drag = { startX: e.clientX, startScroll: this.x, moved: false };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (this.drag === undefined) return;
      const dx = e.clientX - this.drag.startX;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX) this.drag.moved = true;
      this.x = this.target = this.clamp(this.drag.startScroll - dx);
      this.render();
    });
    stage.addEventListener('pointerup', (e) => this.onPointerUp(stage, e));
    stage.addEventListener('pointercancel', () => {
      this.drag = undefined;
    });
    log.exit(undefined);
  }

  /**
   * 指を離したとき。ドラッグなら一番近い地区で止め、タップならその地区を中央へ寄せる。
   * @param stage canvas の親要素
   * @param e pointerup イベント
   * @sideEffect 目標位置を変える
   */
  private onPointerUp(stage: HTMLElement, e: PointerEvent): void {
    const log = logger.fn('onPointerUp', { moved: this.drag?.moved });
    const drag = this.drag;
    this.drag = undefined;
    if (drag === undefined) return log.exit(undefined);
    setCorrelationId();
    if (drag.moved) {
      this.scrollToDistrict(Math.round((this.x + this.viewWidth() / 2 - this.districtWidth() / 2) / this.districtWidth()));
      return log.exit(undefined);
    }
    const left = stage.getBoundingClientRect().left;
    this.scrollToDistrict(Math.floor((e.clientX - left + this.x) / this.districtWidth()));
    log.exit(undefined);
  }

  /**
   * 補間ループを始める（動いていれば何もしない）。
   * @sideEffect requestAnimationFrame を登録する
   */
  private startLoop(): void { // audit-ignore: fnlog-missing スクロールのたびに呼ぶループ開始だけの小さな処理
    if (this.frame === undefined) this.frame = requestAnimationFrame(() => this.tick());
  }

  /**
   * 1フレーム進める。目標に着いたらループを止める。
   * @sideEffect 位置を更新して描画し、必要なら次のフレームを登録する
   */
  private tick(): void { // audit-ignore: fnlog-missing 毎フレーム描画
    this.frame = undefined;
    const rest = this.target - this.x;
    this.x = Math.abs(rest) < 0.5 ? this.target : this.x + rest * EASE_FACTOR;
    if (!prefersReducedMotion()) this.time = performance.now();
    this.render();
    // 動きを減らす設定でなければ街の動き（雲・桜・旗）のため回し続ける。タブが隠れている間はブラウザが止める
    if (this.x !== this.target || !prefersReducedMotion()) this.startLoop();
  }

  /**
   * 今の位置で描き、中央の地区・ボタンの有効無効を更新する。
   * @sideEffect canvas に描画し、onCenterChange を呼ぶことがある
   */
  private render(): void { // audit-ignore: fnlog-missing 毎フレーム描画
    if (this.surface === undefined) return;
    const size = this.surface.size();
    beginFrame(this.surface.ctx, size);
    const zoom = this.zoom();
    drawTownStrip(this.surface.ctx, {
      width: size.width / zoom,
      height: size.height / zoom,
      scrollX: this.x / zoom,
      time: this.time,
      avatarSay: this.opts.avatarSay,
      districts: this.opts.districts,
      avatarIndex: this.opts.avatarIndex,
      avatarLook: this.opts.avatarLook,
      textScale: textScaleFactor(),
    }, zoom);
    const center = centerDistrictIndexOf(this.x, size.width, this.districtWidth(), this.opts.districts.length);
    if (center === this.centerIndex) return;
    this.centerIndex = center;
    this.prevButton.disabled = center <= 0;
    this.nextButton.disabled = center >= this.opts.districts.length - 1;
    this.opts.onCenterChange(center);
  }

  /**
   * ループと監視を止める。
   * @sideEffect requestAnimationFrame を取り消し、canvas を外す
   */
  destroy(): void {
    const log = logger.fn('destroy');
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.surface?.destroy();
    this.surface = undefined;
    log.exit(undefined);
  }
}
