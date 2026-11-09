/**
 * @file 銀・金カード獲得の演出（presentation/screens/Effects 層）
 * 幾何学的な紙吹雪がはじけ、金属のグラデーションのカード（会員証の形）が裏から表へ回転し、光沢の帯が流れる（Canvas・rAF）。
 * 文言は地区名と回数だけで、網羅ではなく「通い」への報酬だと分かるようにする
 * （「金カード獲得！」「{地区} {n}回通いました」＝wireframes/08）。
 */
import { createLogger } from '@/Common/logging/logger';
import { beginFrame } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSize } from '@/Common/ui/canvas/CanvasBase';
import { mixColors, toRgba } from '@/Common/ui/canvas/colorUtils';
import { canvasFont, drawCircle, drawPolygon, drawRoundRect, drawTextWithOutline, roundRectPath } from '@/Common/ui/canvas/drawUtils';
import type { Rect } from '@/Common/ui/canvas/geometry';
import { h } from '@/Common/ui/dom';
import { PALETTE } from '@/Common/ui/theme/palette';
import { drawConfetti, drawHalo, drawSparkle } from '@/presentation/screens/Effects/effectArt';
import { startCanvasAnimation } from '@/presentation/screens/Effects/EffectFrame';
import type { CanvasAnimationHandle, EffectView } from '@/presentation/screens/Effects/EffectFrame';
import { cardFlip, cardShinePosition, clamp01, confettiFor, easeOutBack, easeOutCubic, EFFECT_ANIMATION_MS } from '@/presentation/screens/Effects/effectMath';

const logger = createLogger('presentation/screens/Effects/CardAwardEffect');

/** カード獲得の演出の内容 */
export interface CardAwardEffectModel {
  readonly districtName: string;
  readonly rank: 'silver' | 'gold';
  /** 獲得理由（訪問回数／四季すべて） */
  readonly reason: 'visits' | 'seasons';
  /** 条件を満たしたときの地区への訪問回数 */
  readonly visitCount: number;
}

/** カードの色（docs/08 §10.2 の金・銀のグラデーション） */
interface CardPalette {
  /** 面のグラデーション（左上 → 右下） */
  readonly stops: readonly [string, string, string];
  /** 面の上の文字 */
  readonly ink: string;
  /** カードの後ろの光 */
  readonly halo: string;
  /** 紙吹雪の色 */
  readonly confetti: readonly string[];
  /** 英字のランク名（カード面の飾り） */
  readonly word: string;
}

/**
 * 金属の段の明暗（PALETTE の金・銀から作る。tokens.css の --metal-gold-light／--metal-gold-ink／--metal-silver-light／-edge に当たる）。
 * PALETTE にまだ明暗の名前がないので、ここで混ぜて作る（docs/10 §2 金属の段）。
 */
const METAL_TONE = {
  goldLight: mixColors(PALETTE.metalGold, PALETTE.white, 0.55),
  goldInk: mixColors(PALETTE.goldInk, PALETTE.ink, 0.5),
  silverLight: mixColors(PALETTE.metalSilver, PALETTE.white, 0.8),
  silverDeep: mixColors(PALETTE.metalSilver, PALETTE.mutedInk, 0.45),
} as const;

/** ランクごとのカードの色と表示名（色は PALETTE の金属の段・ブランド・文字色） */
const CARD_STYLES: Readonly<Record<CardAwardEffectModel['rank'], CardPalette & { readonly label: string }>> = {
  gold: {
    stops: [METAL_TONE.goldLight, PALETTE.metalGold, PALETTE.goldDeep], ink: METAL_TONE.goldInk, halo: toRgba(PALETTE.metalGold, 0.32),
    confetti: [PALETTE.brand, PALETTE.metalGold, METAL_TONE.goldLight, PALETTE.ink], word: 'GOLD', label: '金',
  },
  silver: {
    stops: [METAL_TONE.silverLight, PALETTE.metalSilver, METAL_TONE.silverDeep], ink: PALETTE.ink, halo: toRgba(METAL_TONE.silverDeep, 0.32),
    confetti: [PALETTE.brand, PALETTE.metalSilver, PALETTE.mutedInk, PALETTE.ink], word: 'SILVER', label: '銀',
  },
};

/** カードの縦横比（会員証・交通系カードと同じ 1.586:1） */
const CARD_ASPECT = 1.586;

/** 紙吹雪の片の数 */
const CONFETTI_COUNT = 28;

/**
 * カード獲得の文言（2行目）を作る。
 * @param model カード獲得の演出の内容
 * @returns '天満地区 10回通いました'／'天満地区 四季すべてで訪れました'
 */
export function cardAwardText(model: CardAwardEffectModel): string {
  const log = logger.fn('cardAwardText', { reason: model.reason, visitCount: model.visitCount });
  return log.exit(model.reason === 'seasons' ? `${model.districtName} 四季すべてで訪れました` : `${model.districtName} ${model.visitCount}回通いました`);
}

/**
 * カードの表面を描く（金属のグラデーション・同心円の地模様・ランク名・回数・地区名・光の帯）。座標の原点はカードの中心。
 * カード面の文字は絵の一部なので文字拡大に追従させない（同じ内容を DOM の見出し・本文で読める）。
 * @param ctx 2D コンテキスト
 * @param rect カードの矩形（中心原点）
 * @param model カード獲得の演出の内容
 * @param progress 0〜1
 * @sideEffect ctx に描画する
 */
function drawCardFace(ctx: CanvasRenderingContext2D, rect: Rect, model: CardAwardEffectModel, progress: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const style = CARD_STYLES[model.rank];
  const { x, y, width: w, height: hh } = rect;
  const face = ctx.createLinearGradient(x, y, x + w, y + hh);
  face.addColorStop(0, style.stops[0]);
  face.addColorStop(0.55, style.stops[1]);
  face.addColorStop(1, style.stops[2]);
  ctx.save();
  ctx.shadowColor = 'rgba(17, 24, 39, 0.28)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  roundRectPath(ctx, rect, 12);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, rect, 12);
  ctx.clip();
  for (let i = 1; i <= 4; i++) drawCircle(ctx, { x: x + w * 0.96, y: y + hh * 1.02 }, hh * (0.3 + i * 0.2), { stroke: 'rgba(255, 255, 255, 0.22)', lineWidth: 1 });
  drawRoundRect(ctx, { x: x + 1, y: y + 1, width: w - 2, height: hh - 2 }, 11, { stroke: 'rgba(255, 255, 255, 0.55)', lineWidth: 1 });
  drawCardText(ctx, rect, model, style);
  const shine = cardShinePosition(progress);
  if (shine !== undefined) {
    const bandX = x + w * shine;
    drawPolygon(ctx, [{ x: bandX - 8, y }, { x: bandX + 22, y }, { x: bandX - 4, y: y + hh }, { x: bandX - 34, y: y + hh }], { fill: 'rgba(255, 255, 255, 0.55)' });
  }
  ctx.restore();
}

/**
 * カード面の文字（左上にランク名、中央に回数、左下に地区名、右上に星）を描く。
 * @param ctx 2D コンテキスト
 * @param rect カードの矩形（中心原点）
 * @param model カード獲得の演出の内容
 * @param style ランクの色
 * @sideEffect ctx に描画する
 */
function drawCardText(ctx: CanvasRenderingContext2D, rect: Rect, model: CardAwardEffectModel, style: CardPalette): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, y, width: w, height: hh } = rect;
  const pad = w * 0.08;
  const left = { align: 'left' as const, baseline: 'alphabetic' as const, color: style.ink };
  drawTextWithOutline(ctx, `${style.word} CARD`, { x: x + pad, y: y + hh * 0.22 }, { ...left, sizePx: hh * 0.1, weight: 700 });
  const count = model.reason === 'seasons' ? '四季' : String(model.visitCount);
  ctx.font = canvasFont(hh * 0.36, 700);
  const countW = ctx.measureText(count).width;
  drawTextWithOutline(ctx, count, { x: x + pad, y: y + hh * 0.7 }, { ...left, sizePx: hh * 0.36, weight: 700 });
  if (model.reason !== 'seasons') drawTextWithOutline(ctx, '回', { x: x + pad + countW + 3, y: y + hh * 0.7 }, { ...left, sizePx: hh * 0.14, weight: 700 });
  drawTextWithOutline(ctx, model.districtName, { x: x + pad, y: y + hh * 0.88 }, { ...left, sizePx: hh * 0.1, weight: 500, maxWidth: w * 0.6 });
  const star = { x: x + w - pad - hh * 0.07, y: y + hh * 0.17 };
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * i) / 5;
    const r = i % 2 === 0 ? hh * 0.08 : hh * 0.035;
    return { x: star.x + Math.cos(a) * r, y: star.y + Math.sin(a) * r };
  });
  drawPolygon(ctx, pts, { stroke: style.ink, lineWidth: 1.5 });
}

/**
 * カードの裏面（濃いグレーにブランドの青の斜めの帯と輪のロゴ）を描く。
 * @param ctx 2D コンテキスト
 * @param rect カードの矩形（中心原点）
 * @sideEffect ctx に描画する
 */
function drawCardBack(ctx: CanvasRenderingContext2D, rect: Rect): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, y, width: w, height: hh } = rect;
  drawRoundRect(ctx, rect, 12, { fill: PALETTE.ink });
  ctx.save();
  roundRectPath(ctx, rect, 12);
  ctx.clip();
  drawPolygon(ctx, [{ x: x + w * 0.55, y }, { x: x + w * 0.75, y }, { x: x + w * 0.45, y: y + hh }, { x: x + w * 0.25, y: y + hh }], { fill: PALETTE.brand });
  drawCircle(ctx, { x: 0, y: 0 }, hh * 0.18, { stroke: PALETTE.white, lineWidth: 2 });
  ctx.restore();
}

/**
 * カード獲得のアニメーションを1フレーム描く（紙吹雪がはじけ、カードが裏から表へ回って光る）。
 * @param ctx 2D コンテキスト
 * @param size canvas の大きさ
 * @param model カード獲得の演出の内容
 * @param progress 0〜1
 * @sideEffect ctx に描画する
 */
function drawCardFrame(ctx: CanvasRenderingContext2D, size: CanvasSize, model: CardAwardEffectModel, progress: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  beginFrame(ctx, size);
  const style = CARD_STYLES[model.rank];
  const flip = cardFlip(progress);
  const cardW = Math.min(size.width * 0.66, size.height * 0.84 * CARD_ASPECT);
  const cardH = cardW / CARD_ASPECT;
  const rise = (1 - easeOutCubic(clamp01(progress / 0.4))) * 10;
  const center = { x: size.width / 2, y: size.height / 2 + rise };
  if (flip.showFront) drawHalo(ctx, center, Math.min(size.height * 0.5, cardW * 0.62), style.halo);
  drawConfetti(ctx, confettiFor(`card:${model.rank}:${model.districtName}`, CONFETTI_COUNT), { center, radius: size.width * 0.5 }, progress, style.confetti);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.scale(flip.scaleX, 1);
  const rect: Rect = { x: -cardW / 2, y: -cardH / 2, width: cardW, height: cardH };
  if (flip.showFront) drawCardFace(ctx, rect, model, progress);
  else drawCardBack(ctx, rect);
  ctx.restore();
  if (progress > 0.62) {
    const t = clamp01((progress - 0.62) / 0.3);
    drawSparkle(ctx, { x: center.x + cardW * 0.52, y: center.y - cardH * 0.5 }, 7 * easeOutBack(t), PALETTE.metalGold);
    drawSparkle(ctx, { x: center.x - cardW * 0.56, y: center.y + cardH * 0.34 }, 5 * easeOutBack(t), PALETTE.brand);
  }
}

/**
 * カード獲得の演出を作る。
 * @param model カード獲得の演出の内容
 * @returns 演出1つ分の表示
 */
export function createCardAwardEffect(model: CardAwardEffectModel): EffectView {
  const log = logger.fn('createCardAwardEffect', { rank: model.rank, reason: model.reason, visitCount: model.visitCount });
  const label = CARD_STYLES[model.rank].label;
  const canvasBox = h('div', { class: ['fx__canvas', 'fx__canvas--wide'] });
  const element = h('div', { class: 'fx__content', dataset: { rank: model.rank } }, [
    canvasBox,
    h('h2', { class: 'fx__title', text: `${label}カード獲得！` }),
    h('p', { class: 'fx__text', text: cardAwardText(model) }),
    h('p', { class: 'fx__sub', text: '通い続けた証。カードは減りません' }),
  ]);
  let animation: CanvasAnimationHandle | undefined;
  const view: EffectView = {
    kind: 'card',
    label: `${label}カード獲得：${cardAwardText(model)}`,
    element,
    start: (): void => {
      animation = startCanvasAnimation(canvasBox, {
        durationMs: EFFECT_ANIMATION_MS,
        ariaLabel: `${label}カードが回転して光る様子`,
        draw: (ctx, size, progress): void => drawCardFrame(ctx, size, model, progress),
      });
    },
    stop: (): void => {
      animation?.stop();
      animation = undefined;
    },
  };
  return log.exit(view);
}
