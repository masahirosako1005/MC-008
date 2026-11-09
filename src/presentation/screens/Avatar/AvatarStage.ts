/**
 * @file アバターのステージ（presentation/screens/Avatar 層。Canvas 部品）
 * 背景・光の粒・置くもの・台座・オーラ（奥）・アバター・オーラ（手前）・エモート・キラッを1枚の canvas に描き、呼吸・まばたき・ポーズで動かす。
 * 開いたときは幕が左右に開く。撮影のときは白く光る。
 * requestAnimationFrame は destroy で必ず止める。動きを減らす設定（prefers-reduced-motion）なら、変わったときに1回だけ描く（幕・光・粒の動きは出さない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { beginFrame, createCanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSize, CanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import { h } from '@/Common/ui/dom';
import { paintAura } from '@/presentation/screens/Avatar/stageAuras';
import { EMOTES, paintEmoteBubble, paintEmoteParticles } from '@/presentation/screens/Avatar/stageEmotes';
import type { EmoteDef } from '@/presentation/screens/Avatar/stageEmotes';
import { paintBurst, paintGlitter, paintSpotlight, paintSsrTwinkles, paintTwinkle } from '@/presentation/screens/Avatar/stageSparkle';
import type { SparkleBurst, SparkleRarity } from '@/presentation/screens/Avatar/stageSparkle';
import type { AvatarPose, EmoteStyle, ObjectStyle, StageLook } from '@/presentation/shared/avatar/avatarLook';
import { drawAvatar } from '@/presentation/shared/avatar/avatarPaint';
import { STAGE_FLOOR_RATIO, paintBackground, paintObject } from '@/presentation/shared/avatar/stageArt';

const logger = createLogger('presentation/screens/Avatar/AvatarStage');

/** アバターの高さ（ステージの高さに対する割合。拡大率1で高さ約70px） */
const AVATAR_HEIGHT_RATIO = 0.62;
/** 置くものの位置（ステージ幅に対する X・床からの奥行き・大きさの倍率）。並び＝左手前・右手前・奥 */
const OBJECT_SLOTS: readonly { readonly x: number; readonly lift: number; readonly scale: number }[] = [
  { x: 0.16, lift: 0.02, scale: 0.86 },
  { x: 0.85, lift: 0.02, scale: 0.86 },
  { x: 0.7, lift: -0.08, scale: 0.6 },
];
/** ジャンプなど一時的なポーズを続ける秒数 */
const TEMP_POSE_SEC = 1.6;
/** 開いたときの幕が開ききるまでの秒数 */
const INTRO_SEC = 0.9;
/** 撮影の光の秒数 */
const FLASH_SEC = 0.45;
/** 動きを減らす設定で、エモートの吹き出しを止めて見せる瞬間（秒） */
const STILL_EMOTE_E = 0.6;

/** ステージの操作 */
export interface AvatarStageHandle {
  readonly element: HTMLElement;
  /** 装いを変える（次のフレームから反映。hasSsr は SSR を身につけているか） */
  update(stage: StageLook, hasSsr?: boolean): void;
  /** ポーズを変える（temporary なら少しだけ。エモート中ならエモートをやめる） */
  setPose(pose: AvatarPose, temporary?: boolean): void;
  /** 着替えたときの「キラッ」（レア度で色と大きさが変わる。動きを減らす設定では何もしない） */
  sparkle(rarity: SparkleRarity): void;
  /** エモートを1回再生する */
  playEmote(style: EmoteStyle): void;
  /** 撮影の光を出し、いまの絵（canvas）を返す */
  capture(): HTMLCanvasElement | undefined;
  /** 描画ループと監視を止める */
  destroy(): void;
}

/** createAvatarStage の入力 */
export interface AvatarStageInput {
  readonly stage: StageLook;
  /** SSR を身につけている */
  readonly hasSsr: boolean;
  /** 動きを減らす */
  readonly reducedMotion: boolean;
  /** ステージを押したとき */
  readonly onTap: () => void;
}

/** 1フレームの描画に使う状態 */
interface FrameState {
  readonly stage: StageLook;
  readonly pose: AvatarPose;
  readonly t: number;
  readonly hasSsr: boolean;
  readonly burst?: SparkleBurst;
  readonly emote?: { readonly def: EmoteDef; readonly e: number };
  /** 幕の開き具合 0..1（開ききったら undefined） */
  readonly intro?: number;
  /** 撮影の光の進み 0..1（無ければ undefined） */
  readonly flash?: number;
}

/**
 * アバターの拡大率（ステージの高さに合わせる）。
 * @param size 大きさ
 * @returns 拡大率
 */
function unitOf(size: CanvasSize): number {
  return (size.height * AVATAR_HEIGHT_RATIO) / 70;
}

/**
 * アバターの足元の位置。
 * @param size 大きさ
 * @returns 足元（CSS px）
 */
function avatarFeetOf(size: CanvasSize): { readonly x: number; readonly y: number } {
  return { x: size.width / 2 + 8 * unitOf(size), y: size.height * STAGE_FLOOR_RATIO + 2 * unitOf(size) };
}

/**
 * 置くものを奥（3つめ）→ 手前（1つめ・2つめ）の順に描く。
 * @param ctx 描画先
 * @param objects 置くもの（並び＝左手前・右手前・奥）
 * @param size 大きさ
 * @param t 経過秒
 */
function drawObjects(ctx: CanvasRenderingContext2D, objects: readonly ObjectStyle[], size: CanvasSize, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const floor = size.height * STAGE_FLOOR_RATIO;
  for (const i of [2, 0, 1]) {
    const style = objects[i];
    const slot = OBJECT_SLOTS[i];
    if (style === undefined || slot === undefined) continue;
    paintObject(ctx, style, size.width * slot.x, floor - size.height * slot.lift, unitOf(size) * slot.scale, t);
  }
}

/**
 * 開いたときの幕（ピンクのベルベットが左右に開く）を描く。
 * @param ctx 描画先
 * @param size 大きさ
 * @param p 開き具合 0..1
 */
function drawCurtain(ctx: CanvasRenderingContext2D, size: CanvasSize, p: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const ease = 1 - (1 - p) ** 3;
  const half = (size.width / 2) * (1 - ease);
  ctx.save();
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? 0 : size.width - half;
    const g = ctx.createLinearGradient(x0, 0, x0 + half, 0);
    for (let k = 0; k <= 6; k += 1) g.addColorStop(k / 6, k % 2 === 0 ? '#e24a8d' : '#ff86b8');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, half, size.height);
    ctx.fillStyle = '#ffd75e';
    ctx.fillRect(x0, size.height - 8, half, 8);
  }
  ctx.globalAlpha = 1 - ease;
  for (let i = 0; i < 6; i += 1) paintTwinkle(ctx, size.width / 2, (size.height * (i + 0.5)) / 6, 6 + (i % 2) * 4, '#ffffff');
  ctx.restore();
}

/**
 * アバターとオーラ・エモートを描く。
 * @param ctx 描画先
 * @param size 大きさ
 * @param s 1フレームの状態
 */
function drawAvatarLayer(ctx: CanvasRenderingContext2D, size: CanvasSize, s: FrameState): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const unit = unitOf(size);
  const feet = avatarFeetOf(size);
  const aura = s.stage.aura;
  if (aura !== undefined) paintAura(ctx, aura, { x: feet.x, y: feet.y, unit, t: s.t, layer: 'back' });
  const pose = s.emote?.def.pose ?? s.pose;
  drawAvatar(ctx, s.stage.avatar, { x: feet.x, y: feet.y, scale: unit }, { pose, t: s.emote === undefined ? s.t : s.emote.e });
  if (aura !== undefined) paintAura(ctx, aura, { x: feet.x, y: feet.y, unit, t: s.t, layer: 'front' });
  if (s.hasSsr) paintSsrTwinkles(ctx, feet.x, feet.y, unit, s.t);
  if (s.emote !== undefined) {
    const f = { x: feet.x, y: feet.y, unit, e: s.emote.e };
    paintEmoteParticles(ctx, s.emote.def, f);
    paintEmoteBubble(ctx, s.emote.def, f);
  }
}

/**
 * ステージ1枚を描く。
 * @param ctx 描画先
 * @param size 大きさ
 * @param s 1フレームの状態
 */
function drawStage(ctx: CanvasRenderingContext2D, size: CanvasSize, s: FrameState): void { // audit-ignore: fnlog-missing 毎フレーム描画
  beginFrame(ctx, size);
  paintBackground(ctx, s.stage.background, size.width, size.height, s.t);
  paintGlitter(ctx, size.width, size.height, s.t);
  drawObjects(ctx, s.stage.objects, size, s.t);
  const feet = avatarFeetOf(size);
  paintSpotlight(ctx, feet.x, feet.y, unitOf(size), s.t);
  drawAvatarLayer(ctx, size, s);
  if (s.burst !== undefined) paintBurst(ctx, s.burst, s.t);
  if (s.intro !== undefined) drawCurtain(ctx, size, s.intro);
  if (s.flash !== undefined) {
    ctx.save();
    ctx.globalAlpha = 1 - s.flash;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.restore();
  }
}

/** ステージの描画ループ */
class StageRunner {
  private stage: StageLook;
  private hasSsr: boolean;
  private pose: AvatarPose = 'stand';
  private tempUntil = 0;
  private frame = 0;
  private start = -1;
  private burst: SparkleBurst | undefined;
  private emote: { readonly def: EmoteDef; readonly start: number } | undefined;
  private flashStart: number | undefined;
  private surface: CanvasSurface | undefined;
  private stillTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * 描画面を作り、ループを始める。
   * @param element canvas を入れる要素
   * @param input 最初の装いなど
   * @sideEffect canvas を作り、requestAnimationFrame を予約する
   */
  constructor(element: HTMLElement, private readonly input: AvatarStageInput) {
    const log = logger.fn('StageRunner.constructor', { reducedMotion: input.reducedMotion });
    this.stage = input.stage;
    this.hasSsr = input.hasSsr;
    this.surface = createCanvasSurface(element, { className: 'avatar-stage__surface', onResize: (): void => this.paint(performance.now()) });
    this.frame = requestAnimationFrame((now) => this.loop(now));
    log.exit(undefined);
  }

  /**
   * いまの経過秒。
   * @returns 秒（まだ描いていなければ 0）
   */
  now(): number { // audit-ignore: fnlog-missing 毎フレーム呼ぶ時刻の換算
    return this.start < 0 ? 0 : (performance.now() - this.start) / 1000;
  }

  /**
   * 1フレームぶんの状態を作る。
   * @param t 経過秒
   * @returns 状態
   */
  private frameState(t: number): FrameState { // audit-ignore: fnlog-missing 毎フレーム描画
    const still = this.input.reducedMotion;
    const emoteE = this.emote === undefined ? undefined : still ? STILL_EMOTE_E : t - this.emote.start;
    if (this.emote !== undefined && emoteE !== undefined && emoteE >= this.emote.def.sec) this.emote = undefined;
    const flash = this.flashStart === undefined || still ? undefined : (t - this.flashStart) / FLASH_SEC;
    if (flash !== undefined && flash >= 1) this.flashStart = undefined;
    return {
      stage: this.stage, pose: this.pose, t, hasSsr: this.hasSsr, burst: this.burst,
      emote: this.emote === undefined || emoteE === undefined ? undefined : { def: this.emote.def, e: emoteE },
      intro: still || t >= INTRO_SEC ? undefined : t / INTRO_SEC,
      flash: flash !== undefined && flash < 1 ? flash : undefined,
    };
  }

  /**
   * 1フレーム描く。
   * @param now requestAnimationFrame の時刻（ms）
   */
  paint(now: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const surface = this.surface;
    if (surface === undefined) return;
    if (this.start < 0) this.start = now;
    const t = this.input.reducedMotion ? 0 : (now - this.start) / 1000;
    if (this.tempUntil > 0 && t > this.tempUntil) { this.pose = 'stand'; this.tempUntil = 0; }
    const size = surface.size();
    if (size.width > 0 && size.height > 0) drawStage(surface.ctx, size, this.frameState(t));
  }

  /**
   * 次のフレームを予約する（動きを減らす設定では1回だけ描く）。
   * @param now 時刻（ms）
   */
  private loop(now: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    this.paint(now);
    this.frame = this.input.reducedMotion ? 0 : requestAnimationFrame((n) => this.loop(n));
  }

  /**
   * 動きを減らす設定のときだけ、いますぐ描き直す。
   * @sideEffect canvas に描く
   */
  repaintIfStill(): void { // audit-ignore: fnlog-missing 操作のたびに呼ぶ小さな分岐
    if (this.input.reducedMotion) this.paint(performance.now());
  }

  /**
   * 装いを変える。
   * @param next 装い
   * @param ssr SSR を身につけているか
   */
  update(next: StageLook, ssr: boolean): void { // audit-ignore: fnlog-missing 操作のたびに呼ぶ代入
    this.stage = next;
    this.hasSsr = ssr;
    this.repaintIfStill();
  }

  /**
   * ポーズを変える（エモート中ならやめる）。
   * @param next ポーズ
   * @param temporary 少しだけなら true
   */
  setPose(next: AvatarPose, temporary: boolean): void {
    const log = logger.fn('StageRunner.setPose', { next, temporary });
    this.pose = next;
    this.emote = undefined;
    this.tempUntil = temporary && !this.input.reducedMotion ? this.now() + TEMP_POSE_SEC : 0;
    this.repaintIfStill();
    log.exit(undefined);
  }

  /**
   * 着替えたときの「キラッ」を始める。
   * @param rarity レア度
   */
  sparkle(rarity: SparkleRarity): void {
    const log = logger.fn('StageRunner.sparkle', { rarity });
    const size = this.surface?.size();
    if (this.input.reducedMotion || size === undefined || this.start < 0) return log.exit(undefined, '動きを減らす設定');
    const feet = avatarFeetOf(size);
    this.burst = { start: this.now(), x: feet.x, y: feet.y - 50 * unitOf(size), footY: feet.y, rarity };
    log.exit(undefined);
  }

  /**
   * エモートを1回再生する（動きを減らす設定では吹き出しを止めて見せ、長さのぶんだけ出しておく）。
   * @param style エモート
   * @sideEffect 動きを減らす設定ではタイマーを1つ予約する
   */
  playEmote(style: EmoteStyle): void {
    const log = logger.fn('StageRunner.playEmote', { style });
    const def = EMOTES[style];
    this.emote = { def, start: this.now() };
    this.tempUntil = 0;
    if (this.input.reducedMotion) {
      if (this.stillTimer !== undefined) clearTimeout(this.stillTimer);
      this.stillTimer = setTimeout(() => { this.emote = undefined; this.repaintIfStill(); }, def.sec * 1000);
    }
    this.repaintIfStill();
    log.exit(undefined);
  }

  /**
   * 撮影の光を出し、いまの canvas を返す（光が入る前の絵）。
   * @returns canvas
   */
  capture(): HTMLCanvasElement | undefined {
    const log = logger.fn('StageRunner.capture');
    const canvas = this.surface?.canvas;
    this.flashStart = this.now();
    return log.exit(canvas);
  }

  /**
   * ループと監視を止める。
   * @sideEffect requestAnimationFrame・タイマー・ResizeObserver を解除する
   */
  destroy(): void {
    const log = logger.fn('StageRunner.destroy');
    cancelAnimationFrame(this.frame);
    if (this.stillTimer !== undefined) clearTimeout(this.stillTimer);
    this.surface?.destroy();
    this.surface = undefined;
    log.exit(undefined);
  }
}

/**
 * ステージを押したとき（クリック・Enter・スペース）の処理を付ける。
 * @param element ステージの要素
 * @param onTap 押したとき
 */
function bindTap(element: HTMLElement, onTap: () => void): void {
  const log = logger.fn('bindTap');
  element.addEventListener('click', () => onTap());
  element.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onTap(); });
  log.exit(undefined);
}

/**
 * ステージを作る。
 * @param input 最初の装い・動きを減らすか・押したとき
 * @returns 操作
 * @sideEffect canvas を作り、requestAnimationFrame の描画ループを始める（destroy で止める）
 */
export function createAvatarStage(input: AvatarStageInput): AvatarStageHandle {
  const log = logger.fn('createAvatarStage', { background: input.stage.background, reducedMotion: input.reducedMotion });
  const element = h('div', { class: 'avatar-stage__canvas', attrs: { role: 'button', tabindex: 0, 'aria-label': 'アバター（押すと決めポーズ）' } });
  const runner = new StageRunner(element, input);
  bindTap(element, input.onTap);
  return log.exit({
    element,
    update: (next: StageLook, ssr = false): void => runner.update(next, ssr),
    setPose: (next: AvatarPose, temporary = false): void => runner.setPose(next, temporary),
    sparkle: (rarity: SparkleRarity): void => runner.sparkle(rarity),
    playEmote: (style: EmoteStyle): void => runner.playEmote(style),
    capture: (): HTMLCanvasElement | undefined => runner.capture(),
    destroy: (): void => runner.destroy(),
  });
}
