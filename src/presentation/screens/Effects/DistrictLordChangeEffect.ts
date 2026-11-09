/**
 * @file 地区の主交代の演出（presentation/screens/Effects 層）
 * 自分が地区の主になった瞬間だけ出す（奪われたときは演出せず下シートの「取」カードで知らせる＝wireframes/08）。
 * 淡い円の上に王冠が線で描かれ、きらめきと小さな紙吹雪が出る（Canvas・rAF）。「{地区}の主になりました」「{fromName}から取り返しました」「直近30日：あなた {n}回」。
 */
import { createLogger } from '@/Common/logging/logger';
import { beginFrame } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSize } from '@/Common/ui/canvas/CanvasBase';
import { mixColors, toRgba } from '@/Common/ui/canvas/colorUtils';
import { drawCircle, drawPolygon } from '@/Common/ui/canvas/drawUtils';
import { h } from '@/Common/ui/dom';
import { PALETTE } from '@/Common/ui/theme/palette';
import { drawConfetti, drawSparkle } from '@/presentation/screens/Effects/effectArt';
import { startCanvasAnimation } from '@/presentation/screens/Effects/EffectFrame';
import type { CanvasAnimationHandle, EffectView } from '@/presentation/screens/Effects/EffectFrame';
import { clamp01, confettiFor, easeOutBack, easeOutCubic, EFFECT_ANIMATION_MS } from '@/presentation/screens/Effects/effectMath';

const logger = createLogger('presentation/screens/Effects/DistrictLordChangeEffect');

/** 主交代の演出の内容 */
export interface LordChangeEffectModel {
  readonly districtName: string;
  /** 取り返した相手（ライバル）の名前 */
  readonly fromName?: string;
  /** ライバルから取り返したか（false は初めて主になった） */
  readonly reclaimed: boolean;
  /** 自分の直近30日の訪問回数 */
  readonly travelerCount: number;
}

/** 王冠の線の色（地区の主の金＝PALETTE.gold）と、線が描き終わった後のごく淡い塗り（金を白へ 8 割寄せた色） */
const CROWN_STROKE = PALETTE.gold;
const CROWN_FILL = mixColors(PALETTE.gold, PALETTE.white, 0.8);

/** きらめきの数 */
const SPARKLE_COUNT = 6;

/**
 * 王冠の線（頂点の列）を作る。中心 (cx, cy)・幅 w。
 * @param cx 中心 X
 * @param cy 中心 Y
 * @param w 幅
 * @returns 頂点の列（下辺の左から時計回りに閉じる順）
 */
function crownPoints(cx: number, cy: number, w: number): { x: number; y: number }[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const hh = w * 0.62;
  return [
    { x: cx - w / 2, y: cy + hh / 2 },
    { x: cx - w / 2, y: cy - hh * 0.32 },
    { x: cx - w / 4, y: cy + hh * 0.02 },
    { x: cx, y: cy - hh / 2 },
    { x: cx + w / 4, y: cy + hh * 0.02 },
    { x: cx + w / 2, y: cy - hh * 0.32 },
    { x: cx + w / 2, y: cy + hh / 2 },
    { x: cx - w / 2, y: cy + hh / 2 },
  ];
}

/**
 * 王冠のアニメーションを1フレーム描く（淡い円が広がり、王冠が線で描かれ、きらめきと小さな紙吹雪が出る）。
 * 王冠は線のアイコン（docs/08 §10.5）。漢字の札は使わない。
 * @param ctx 2D コンテキスト
 * @param size canvas の大きさ
 * @param progress 0〜1
 * @sideEffect ctx に描画する
 */
function drawCrownFrame(ctx: CanvasRenderingContext2D, size: CanvasSize, progress: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  beginFrame(ctx, size);
  const s = Math.min(size.width, size.height);
  const center = { x: size.width / 2, y: size.height * 0.52 };
  const pop = Math.max(0, easeOutBack(clamp01(progress / 0.4)));
  drawCircle(ctx, center, s * 0.4 * pop, { fill: PALETTE.brandSoft });
  drawCircle(ctx, center, s * 0.46 * pop, { stroke: toRgba(PALETTE.brand, 0.25), lineWidth: 1.5 });
  drawConfetti(ctx, confettiFor('lord', 16), { center, radius: s * 0.55 }, progress);
  const pts = crownPoints(center.x, center.y + s * 0.02, s * 0.46);
  const draw = easeOutCubic(clamp01((progress - 0.12) / 0.5));
  if (draw >= 1) drawPolygon(ctx, pts, { fill: CROWN_FILL });
  ctx.save();
  ctx.strokeStyle = CROWN_STROKE;
  ctx.lineWidth = Math.max(2.5, s * 0.03);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const length = s * 2.4;
  ctx.setLineDash([length * draw, length]);
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);
  if (draw >= 1) {
    ctx.beginPath(); ctx.moveTo(pts[0]?.x ?? 0, center.y + s * 0.07); ctx.lineTo(pts[6]?.x ?? 0, center.y + s * 0.07); ctx.stroke();
    for (const tip of [pts[1], pts[3], pts[5]]) if (tip !== undefined) drawCircle(ctx, tip, s * 0.022, { fill: CROWN_STROKE });
  }
  ctx.restore();
  const t = clamp01((progress - 0.55) / 0.3);
  for (let i = 0; i < SPARKLE_COUNT && t > 0; i++) {
    const a = -Math.PI / 2 + ((i - (SPARKLE_COUNT - 1) / 2) * Math.PI) / (SPARKLE_COUNT + 1);
    const r = s * (0.36 + 0.06 * t);
    drawSparkle(ctx, { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r }, s * (i % 2 === 0 ? 0.035 : 0.025) * easeOutBack(t), i % 2 === 0 ? PALETTE.metalGold : PALETTE.brand);
  }
}

/**
 * 主交代の2行目の文言を作る。
 * @param model 主交代の演出の内容
 * @returns 'おまいり番長から取り返しました'／'初めての地区の主です'
 */
export function lordChangeText(model: Pick<LordChangeEffectModel, 'fromName' | 'reclaimed'>): string {
  const log = logger.fn('lordChangeText', { reclaimed: model.reclaimed });
  return log.exit(model.reclaimed ? `${model.fromName ?? 'ライバル'}から取り返しました` : '初めての地区の主です');
}

/**
 * 主交代の演出を作る。
 * @param model 主交代の演出の内容
 * @returns 演出1つ分の表示
 */
export function createDistrictLordChangeEffect(model: LordChangeEffectModel): EffectView {
  const log = logger.fn('createDistrictLordChangeEffect', { reclaimed: model.reclaimed, travelerCount: model.travelerCount });
  const canvasBox = h('div', { class: 'fx__canvas' });
  const title = `${model.districtName}の領主になりました`;
  const element = h('div', { class: 'fx__content' }, [
    canvasBox,
    h('h2', { class: 'fx__title', text: title }),
    h('p', { class: 'fx__text', text: lordChangeText(model) }),
    h('p', { class: 'fx__sub', text: `直近30日：あなた ${model.travelerCount}回` }),
  ]);
  let animation: CanvasAnimationHandle | undefined;
  const view: EffectView = {
    kind: 'lord',
    label: title,
    element,
    start: (): void => {
      animation = startCanvasAnimation(canvasBox, {
        durationMs: EFFECT_ANIMATION_MS,
        ariaLabel: '王冠が現れる様子',
        draw: (ctx, size, progress): void => drawCrownFrame(ctx, size, progress),
      });
    },
    stop: (): void => {
      animation?.stop();
      animation = undefined;
    },
  };
  return log.exit(view);
}
