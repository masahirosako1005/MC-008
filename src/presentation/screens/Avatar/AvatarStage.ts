/**
 * @file アバターのステージ（presentation/screens/Avatar 層。Canvas 部品）
 * 背景・置くもの（左手前・右手前・奥）・アバター（相棒・持ち物つき）を1枚の canvas に描き、呼吸・まばたき・ポーズで動かす。
 * requestAnimationFrame は destroy で必ず止める。動きを減らす設定（prefers-reduced-motion）なら、変わったときに1回だけ描く。
 */
import { createLogger } from '@/Common/logging/logger';
import { beginFrame, createCanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSize, CanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import { h } from '@/Common/ui/dom';
import type { AvatarPose, ObjectStyle, StageLook } from '@/presentation/shared/avatar/avatarLook';
import { drawAvatar } from '@/presentation/shared/avatar/avatarPaint';
import { STAGE_FLOOR_RATIO, paintBackground, paintObject } from '@/presentation/shared/avatar/stageArt';
import { paintBurst, paintGlitter, paintSpotlight, paintSsrTwinkles } from '@/presentation/screens/Avatar/stageSparkle';
import type { SparkleBurst, SparkleRarity } from '@/presentation/screens/Avatar/stageSparkle';

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

/** ステージの操作 */
export interface AvatarStageHandle {
  readonly element: HTMLElement;
  /** 装いを変える（次のフレームから反映。hasSsr は SSR を身につけているか） */
  update(stage: StageLook, hasSsr?: boolean): void;
  /** ポーズを変える（temporary なら少しだけ） */
  setPose(pose: AvatarPose, temporary?: boolean): void;
  /** 着替えたときの「キラッ」（レア度で色と大きさが変わる。動きを減らす設定では何もしない） */
  sparkle(rarity: SparkleRarity): void;
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

/**
 * 置くものを奥（3つめ）→ 手前（1つめ・2つめ）の順に描く。
 * @param ctx 描画先
 * @param objects 置くもの（並び＝左手前・右手前・奥）
 * @param size 大きさ
 * @param unit アバターの拡大率（置くものも同じ縮尺）
 * @param t 経過秒
 */
function drawObjects(ctx: CanvasRenderingContext2D, objects: readonly ObjectStyle[], size: CanvasSize, unit: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const floor = size.height * STAGE_FLOOR_RATIO;
  for (const i of [2, 0, 1]) {
    const style = objects[i];
    const slot = OBJECT_SLOTS[i];
    if (style === undefined || slot === undefined) continue;
    paintObject(ctx, style, size.width * slot.x, floor - size.height * slot.lift, unit * slot.scale, t);
  }
}

/**
 * ステージ1枚を描く。
 * @param ctx 描画先
 * @param size 大きさ
 * @param stage 装い
 * @param pose ポーズ
 * @param t 経過秒
 * @param fx 着替えたときの「キラッ」と、SSR を身につけているか
 */
function drawStage(ctx: CanvasRenderingContext2D, size: CanvasSize, stage: StageLook, pose: AvatarPose, t: number, fx: { readonly burst?: SparkleBurst; readonly hasSsr: boolean }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  beginFrame(ctx, size);
  paintBackground(ctx, stage.background, size.width, size.height, t);
  paintGlitter(ctx, size.width, size.height, t);
  const unit = unitOf(size);
  const feet = avatarFeetOf(size);
  drawObjects(ctx, stage.objects, size, unit, t);
  paintSpotlight(ctx, feet.x, feet.y, unit, t);
  drawAvatar(ctx, stage.avatar, { x: feet.x, y: feet.y, scale: unit }, { pose, t });
  if (fx.hasSsr) paintSsrTwinkles(ctx, feet.x, feet.y, unit, t);
  if (fx.burst !== undefined) paintBurst(ctx, fx.burst, t);
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
  const element = h('div', { class: 'avatar-stage__canvas', attrs: { role: 'button', tabindex: 0, 'aria-label': 'アバター（押すとジャンプ）' } });
  const st: { stage: StageLook; pose: AvatarPose; tempUntil: number; frame: number; start: number; burst?: SparkleBurst; hasSsr: boolean } = { stage: input.stage, pose: 'stand', tempUntil: 0, frame: 0, start: -1, hasSsr: input.hasSsr };
  let surface: CanvasSurface | undefined;
  /**
   * 1フレーム描く。
   * @param now requestAnimationFrame の時刻（ms）
   */
  const paint = (now: number): void => { // audit-ignore: fnlog-missing 毎フレーム描画
    if (surface === undefined) return;
    if (st.start < 0) st.start = now;
    const t = input.reducedMotion ? 0 : (now - st.start) / 1000;
    if (st.tempUntil > 0 && t > st.tempUntil) { st.pose = 'stand'; st.tempUntil = 0; }
    const size = surface.size();
    if (size.width > 0 && size.height > 0) drawStage(surface.ctx, size, st.stage, st.pose, t, { burst: st.burst, hasSsr: st.hasSsr });
  };
  /**
   * 次のフレームを予約する（動きを減らす設定では1回だけ描く）。
   * @param now 時刻（ms）
   */
  const loop = (now: number): void => { // audit-ignore: fnlog-missing 毎フレーム描画
    paint(now);
    st.frame = input.reducedMotion ? 0 : requestAnimationFrame(loop);
  };
  surface = createCanvasSurface(element, { className: 'avatar-stage__surface', onResize: (): void => paint(performance.now()) });
  st.frame = requestAnimationFrame(loop);
  bindTap(element, input.onTap);
  return log.exit({
    element,
    update: (next: StageLook, ssr = false): void => { st.stage = next; st.hasSsr = ssr; if (input.reducedMotion) paint(performance.now()); },
    setPose: (next: AvatarPose, temporary = false): void => {
      st.pose = next;
      st.tempUntil = temporary && !input.reducedMotion ? (performance.now() - Math.max(st.start, 0)) / 1000 + TEMP_POSE_SEC : 0;
      if (input.reducedMotion) paint(performance.now());
    },
    sparkle: (rarity: SparkleRarity): void => {
      const size = surface?.size();
      if (input.reducedMotion || size === undefined || st.start < 0) return;
      const feet = avatarFeetOf(size);
      const unit = unitOf(size);
      st.burst = { start: (performance.now() - st.start) / 1000, x: feet.x, y: feet.y - 50 * unit, footY: feet.y, rarity };
    },
    destroy: (): void => { cancelAnimationFrame(st.frame); surface?.destroy(); surface = undefined; },
  });
}
