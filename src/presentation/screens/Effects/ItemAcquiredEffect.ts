/**
 * @file アイテム獲得の演出（presentation/screens/Effects 層）
 * 淡い円の上にアイテムの絵（現代の道具として描く：LED ランタン・小旗・鉢植え）が弾むように出て、きらめきと紙吹雪（Canvas・rAF）。
 * 文言は「アイテム獲得：{名前}」「アバター画面で身につけられます」（wireframes/08 の文言をアバター画面に合わせて変更）。動きを減らす設定なら完成形だけを描く。
 */
import { createLogger } from '@/Common/logging/logger';
import { beginFrame } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSize } from '@/Common/ui/canvas/CanvasBase';
import { drawCircle } from '@/Common/ui/canvas/drawUtils';
import { h } from '@/Common/ui/dom';
import { PALETTE } from '@/Common/ui/theme/palette';
import { drawConfetti, drawSparkle } from '@/presentation/screens/Effects/effectArt';
import { startCanvasAnimation } from '@/presentation/screens/Effects/EffectFrame';
import type { CanvasAnimationHandle, EffectView } from '@/presentation/screens/Effects/EffectFrame';
import { clamp01, confettiFor, easeOutBack, EFFECT_ANIMATION_MS } from '@/presentation/screens/Effects/effectMath';
import { paintGear } from '@/presentation/shared/shopIcons';
import type { GearIcon } from '@/presentation/shared/shopIcons';

const logger = createLogger('presentation/screens/Effects/ItemAcquiredEffect');

/** アイテム獲得の演出の内容 */
export interface ItemAcquiredEffectModel {
  readonly name: string;
  /** アイテムID（絵を選ぶ。無い・知らない ID は小旗） */
  readonly itemId?: string;
}

/** アイテムID → 絵（アイテムの定義は domain/reward/ItemPolicy） */
const GEAR_BY_ITEM: Readonly<Record<string, GearIcon>> = { i_chochin: 'lantern', i_nobori: 'pennant', i_matsu: 'plant' };

/**
 * アイテムID から絵を決める。
 * @param itemId アイテムID
 * @returns 絵の種類
 */
export function gearOfItem(itemId: string | undefined): GearIcon {
  const log = logger.fn('gearOfItem', { itemId });
  return log.exit(itemId === undefined ? 'pennant' : (GEAR_BY_ITEM[itemId] ?? 'pennant'));
}

/**
 * アイテム獲得のアニメーションを1フレーム描く。
 * @param ctx 2D コンテキスト
 * @param size canvas の大きさ
 * @param gear アイテムの絵
 * @param progress 0〜1
 * @sideEffect ctx に描画する
 */
function drawItemFrame(ctx: CanvasRenderingContext2D, size: CanvasSize, gear: GearIcon, progress: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  beginFrame(ctx, size);
  const s = Math.min(size.width, size.height);
  const center = { x: size.width / 2, y: size.height * 0.52 };
  const pop = Math.max(0, easeOutBack(clamp01(progress / 0.45)));
  drawCircle(ctx, center, s * 0.38 * pop, { fill: PALETTE.brandSoft });
  drawConfetti(ctx, confettiFor(`item:${gear}`, 16), { center, radius: s * 0.55 }, progress);
  if (pop > 0.05) paintGear(ctx, gear, { x: center.x, y: center.y + s * 0.2 }, s * 0.34 * pop);
  const t = clamp01((progress - 0.45) / 0.3);
  if (t <= 0) return;
  drawSparkle(ctx, { x: center.x + s * 0.3, y: center.y - s * 0.26 }, s * 0.045 * easeOutBack(t), PALETTE.metalGold);
  drawSparkle(ctx, { x: center.x - s * 0.32, y: center.y - s * 0.08 }, s * 0.03 * easeOutBack(t), PALETTE.brand);
  drawSparkle(ctx, { x: center.x + s * 0.24, y: center.y + s * 0.24 }, s * 0.025 * easeOutBack(t), PALETTE.metalGold);
}

/**
 * アイテム獲得の演出を作る。
 * @param model アイテム獲得の演出の内容
 * @returns 演出1つ分の表示
 */
export function createItemAcquiredEffect(model: ItemAcquiredEffectModel): EffectView {
  const log = logger.fn('createItemAcquiredEffect', { name: model.name, itemId: model.itemId });
  const title = `アイテム獲得：${model.name}`;
  const gear = gearOfItem(model.itemId);
  const canvasBox = h('div', { class: 'fx__canvas' });
  const element = h('div', { class: 'fx__content' }, [
    canvasBox,
    h('h2', { class: 'fx__title', text: title }),
    h('p', { class: 'fx__text', text: 'アバター画面で身につけられます' }),
  ]);
  let animation: CanvasAnimationHandle | undefined;
  const view: EffectView = {
    kind: 'item',
    label: title,
    element,
    start: (): void => {
      animation = startCanvasAnimation(canvasBox, {
        durationMs: EFFECT_ANIMATION_MS,
        ariaLabel: `${model.name}が現れる様子`,
        draw: (ctx, size, progress): void => drawItemFrame(ctx, size, gear, progress),
      });
    },
    stop: (): void => {
      animation?.stop();
      animation = undefined;
    },
  };
  return log.exit(view);
}
