/**
 * @file 復活（おかえり）の演出（presentation/screens/Effects 層）
 * 色あせた地区の小さな街並み（ビル・ガラスの店先・地区色の日よけ）に、灰色から色が戻るワイプ（灰色・破線・◌ → 元の色・実線）と、
 * 「おかえり！」「{地区}が色を取り戻しました」「{n}日ぶりの再訪・Lv{level} のまま」「今日はこの地区の獲得ポイント 1.5倍」を出す（wireframes/08）。
 * Lv・建物が減っていないことを言葉でも示す（色あせは見た目だけ＝CLAUDE.md 4.3）。
 */
import { createLogger } from '@/Common/logging/logger';
import { textScaleFactor } from '@/Common/ui/a11y/textScale';
import { beginFrame } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSize } from '@/Common/ui/canvas/CanvasBase';
import { mixColors } from '@/Common/ui/canvas/colorUtils';
import { drawTextWithOutline } from '@/Common/ui/canvas/drawUtils';
import { FADE_ICON } from '@/Common/ui/canvas/fadeStyle';
import { h } from '@/Common/ui/dom';
import { drawSparkle } from '@/presentation/screens/Effects/effectArt';
import { startCanvasAnimation } from '@/presentation/screens/Effects/EffectFrame';
import type { CanvasAnimationHandle, EffectView } from '@/presentation/screens/Effects/EffectFrame';
import { EFFECT_ANIMATION_MS, revivalStreetFor, revivalWipe } from '@/presentation/screens/Effects/effectMath';
import {
  colorTone,
  FAR_SKYLINE,
  fillBox,
  grayTone,
  paintFarSkyline,
  paintMidrise,
  paintShopfront,
  paintSky,
  paintStreetTree,
  paintTower,
  SKY_BOTTOM,
  SKY_TOP,
} from '@/presentation/shared/cityArt';
import type { CityTone } from '@/presentation/shared/cityArt';

const logger = createLogger('presentation/screens/Effects/RevivalEffect');

/** 復活の演出の内容 */
export interface RevivalEffectModel {
  readonly districtId: string;
  readonly districtName: string;
  /** 地区の色（'#rrggbb'） */
  readonly color: string;
  readonly daysSinceLastVisit: number;
  /** 成長段階（復活しても変わらない） */
  readonly level: number;
  /** おかえりボーナスの倍率（無ければ undefined） */
  readonly multiplier?: number;
}

/** 色あせ側（ワイプ前）の彩度。形と細部は残し、色だけを抜く */
const FADED_SATURATION = 0.06;

/**
 * 小さな街並み（空・遠景・ビル・店・木・歩道）を1色調で描く。
 * @param ctx 2D コンテキスト
 * @param size canvas の大きさ
 * @param model 復活の演出の内容
 * @param tone 色一式（カラー／灰色）
 * @param faded 色あせ側（灰色）として描くか
 * @sideEffect ctx に描画する
 */
function paintStreet(ctx: CanvasRenderingContext2D, size: CanvasSize, model: RevivalEffectModel, tone: CityTone, faded: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { width: W, height: H } = size;
  const groundY = Math.round(H * 0.8);
  const sky: readonly [string, string] = faded ? ['#eceef1', '#f7f8f9'] : [SKY_TOP, mixColors(model.color, SKY_BOTTOM, 0.86)];
  paintSky(ctx, [0, 0, W, groundY], sky);
  paintFarSkyline(ctx, { from: 0, to: W }, { base: groundY, offset: 0, color: faded ? '#e3e5e8' : FAR_SKYLINE, minH: groundY * 0.2, maxH: groundY * 0.42, seed: 7, unit: 18 });
  for (const p of revivalStreetFor(model.districtId)) {
    const box = { x: p.x * W, base: groundY, w: p.w * W, h: p.h * groundY };
    if (p.kind === 'tower') paintTower(ctx, box, tone, p.seed);
    else if (p.kind === 'midrise') paintMidrise(ctx, box, tone, { seed: p.seed, shopBase: true });
    else if (p.kind === 'shop') paintShopfront(ctx, box, tone, { seed: p.seed, floors: 1, icon: p.seed % 2 === 0 ? 'cup' : 'bag' });
    else paintStreetTree(ctx, box, tone);
  }
  fillBox(ctx, [0, groundY, W, H - groundY], faded ? '#e5e7eb' : '#e9edf2');
  ctx.save();
  ctx.strokeStyle = faded ? '#b6bcc5' : mixColors(model.color, '#ffffff', 0.2);
  ctx.lineWidth = 2;
  if (faded) ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(0, groundY + 1); ctx.lineTo(W, groundY + 1); ctx.stroke();
  ctx.restore();
}

/**
 * 復活のアニメーションを1フレーム描く（灰色の街並みに、左から右へ色が戻るワイプ）。
 * 色あせ側は彩度を抜き、破線の歩道と ◌ でも示す（色だけに頼らない）。
 * @param ctx 2D コンテキスト
 * @param size canvas の大きさ
 * @param model 復活の演出の内容
 * @param progress 0〜1
 * @sideEffect ctx に描画する
 */
function drawRevivalFrame(ctx: CanvasRenderingContext2D, size: CanvasSize, model: RevivalEffectModel, progress: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  beginFrame(ctx, size);
  const { width: W, height: H } = size;
  const color = colorTone(model.color);
  const wipe = revivalWipe(progress) * W;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 14); ctx.clip();
  paintStreet(ctx, size, model, grayTone(color, FADED_SATURATION), true);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, wipe, H); ctx.clip();
  paintStreet(ctx, size, model, color, false);
  ctx.restore();
  if (wipe > 0 && wipe < W) {
    const band = ctx.createLinearGradient(wipe - 18, 0, wipe + 4, 0);
    band.addColorStop(0, 'rgba(255, 255, 255, 0)');
    band.addColorStop(0.8, 'rgba(255, 255, 255, 0.85)');
    band.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(wipe - 18, 0, 22, H);
    drawSparkle(ctx, { x: wipe, y: H * 0.22 }, 6, '#ffffff');
    drawSparkle(ctx, { x: wipe - 6, y: H * 0.56 }, 4, '#ffffff');
  }
  if (wipe < W - 34) drawTextWithOutline(ctx, FADE_ICON, { x: W - 16, y: 16 }, { sizePx: 16, scale: textScaleFactor(), color: '#6b7280', weight: 700 });
  ctx.restore();
}

/**
 * 倍率の表示（1.5 → '1.5'、2 → '2'）。
 * @param multiplier 倍率
 * @returns 表示文字列
 */
export function multiplierLabel(multiplier: number): string {
  return Number.isInteger(multiplier) ? String(multiplier) : String(Math.round(multiplier * 100) / 100);
}

/**
 * 復活の演出を作る。
 * @param model 復活の演出の内容
 * @returns 演出1つ分の表示
 */
export function createRevivalEffect(model: RevivalEffectModel): EffectView {
  const log = logger.fn('createRevivalEffect', { districtId: model.districtId, days: model.daysSinceLastVisit, level: model.level, multiplier: model.multiplier });
  const canvasBox = h('div', { class: ['fx__canvas', 'fx__canvas--wide'] });
  const bonus =
    model.multiplier === undefined
      ? undefined
      : h('p', { class: 'fx__bonus', attrs: { 'data-testid': 'effect-bonus' }, text: `今日はこの地区の獲得ポイント ${multiplierLabel(model.multiplier)}倍` });
  const element = h('div', { class: 'fx__content' }, [
    canvasBox,
    h('h2', { class: 'fx__title', text: 'おかえり！' }),
    h('p', { class: 'fx__text', text: `${model.districtName}が色を取り戻しました` }),
    h('p', { class: 'fx__sub', text: `${model.daysSinceLastVisit}日ぶりの再訪・Lv${model.level} のまま` }),
    bonus,
  ]);
  let animation: CanvasAnimationHandle | undefined;
  const view: EffectView = {
    kind: 'revival',
    label: `おかえり！${model.districtName}が色を取り戻しました`,
    element,
    start: (): void => {
      animation = startCanvasAnimation(canvasBox, {
        durationMs: EFFECT_ANIMATION_MS,
        ariaLabel: `${model.districtName}の街並みに色が戻る様子`,
        draw: (ctx, size, progress): void => drawRevivalFrame(ctx, size, model, progress),
      });
    },
    stop: (): void => {
      animation?.stop();
      animation = undefined;
    },
  };
  return log.exit(view);
}
