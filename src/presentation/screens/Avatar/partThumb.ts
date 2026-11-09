/**
 * @file 着せ替えの部品のサムネイル（presentation/screens/Avatar 層。Canvas 部品）
 * 身につける部品は「いまの装いにその部品を着せたアバター」を、部品のところ（頭・体・脚・全身）で切り出して描く（モバゲー風の試着サムネイル）。
 * 背景は背景の絵を縮めて、置くものはその絵だけを描く。絵は表示の解像度で直接描く（docs/08 §10.5）。
 */
import { createLogger } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { h, setStyle } from '@/Common/ui/dom';
import { equipPart, slotOfPartId } from '@/presentation/screens/Avatar/avatarScreenModel';
import type { ThumbFocus } from '@/presentation/screens/Avatar/avatarScreenModel';
import { avatarLookOfParts, splitPartId, stageLookOf } from '@/presentation/shared/avatar/avatarLook';
import type { BackgroundStyle, ObjectStyle } from '@/presentation/shared/avatar/avatarLook';
import { AVATAR_FOCUS, drawAvatar } from '@/presentation/shared/avatar/avatarPaint';
import { STAGE_FLOOR_RATIO, paintBackground, paintObject } from '@/presentation/shared/avatar/stageArt';

const logger = createLogger('presentation/screens/Avatar/partThumb');

/** 頭のあたりに付けるアクセサリー（顔まわりで切り出す） */
const HEAD_ACCESSORIES: ReadonlySet<string> = new Set(['glasses', 'sunglasses', 'ribbon', 'bandaid', 'headphones']);

/**
 * 部品をどこで切り出すかを決める。
 * @param partId 部品ID
 * @returns 切り出すところ
 */
export function focusOfPart(partId: string): ThumbFocus {
  const log = logger.fn('focusOfPart', { partId });
  const part = splitPartId(partId);
  if (part === undefined) return log.exit('full');
  if (part.slot === 'hair' || part.slot === 'eyes' || part.slot === 'hat') return log.exit('head');
  if (part.slot === 'accessory') return log.exit(HEAD_ACCESSORIES.has(part.style) ? 'head' : 'full');
  if (part.slot === 'top') return log.exit('body');
  if (part.slot === 'bottom' || part.slot === 'shoes') return log.exit('legs');
  return log.exit('full');
}

/**
 * 正方形の canvas を作る（端末の解像度で描けるよう変換済み）。
 * @param size 一辺（CSS px）
 * @param className クラス名
 * @returns canvas と 2D コンテキスト（取れなければ undefined）
 */
export function createSquareCanvas(size: number, className: string): { readonly canvas: HTMLCanvasElement; readonly ctx: CanvasRenderingContext2D | undefined } {
  const log = logger.fn('createSquareCanvas', { size });
  const dpr = normalizeDpr(window.devicePixelRatio);
  const canvas = h('canvas', { class: className, attrs: { width: Math.round(size * dpr), height: Math.round(size * dpr), 'aria-hidden': 'true' } });
  setStyle(canvas, 'width', `${size}px`);
  setStyle(canvas, 'height', `${size}px`);
  const ctx = canvas.getContext('2d') ?? undefined;
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return log.exit({ canvas, ctx });
}

/**
 * いまの装いにその部品を着せたアバターを、部品のところで切り出して描く。
 * @param ctx 描画先
 * @param partId 部品ID
 * @param base いまの装い
 * @param size 一辺（CSS px）
 */
function paintWearable(ctx: CanvasRenderingContext2D, partId: string, base: readonly string[], size: number): void {
  const log = logger.fn('paintWearable', { partId });
  const outfit = equipPart(base.filter((id) => slotOfPartId(id) !== 'pet' || slotOfPartId(partId) === 'pet'), partId).outfit;
  const region = AVATAR_FOCUS[focusOfPart(partId)];
  const s = (size * 0.94) / Math.max(region.w, region.h);
  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;
  drawAvatar(ctx, avatarLookOfParts(outfit), { x: size / 2 - cx * s, y: size / 2 - cy * s, scale: s });
  log.exit(undefined);
}

/**
 * 部品のサムネイルを作る（色・称号はサムネイルを使わない）。
 * @param partId 部品ID
 * @param base いまの装い（身につける部品は、これに着せて描く）
 * @param size 一辺（CSS px）
 * @returns canvas
 */
export function createPartThumb(partId: string, base: readonly string[], size: number): HTMLCanvasElement {
  const log = logger.fn('createPartThumb', { partId, size });
  const { canvas, ctx } = createSquareCanvas(size, 'avatar-thumb');
  const part = splitPartId(partId);
  if (ctx === undefined || part === undefined) return log.fail(canvas, '描けない');
  if (part.slot === 'background') paintBackground(ctx, part.style as BackgroundStyle, size, size, 0);
  else if (part.slot === 'object') {
    const scale = (size * 0.7) / 70;
    paintObject(ctx, part.style as ObjectStyle, size / 2, size * 0.92, part.style === 'fireworks' ? scale * 0.85 : scale, 0);
  } else paintWearable(ctx, partId, base, size);
  return log.exit(canvas);
}

/**
 * 装い全体（背景・置くもの・アバター）を小さく描く（マイコーデの一覧）。
 * @param partIds 装い
 * @param width 幅（CSS px）
 * @returns canvas
 */
export function createOutfitThumb(partIds: readonly string[], width: number): HTMLCanvasElement {
  const log = logger.fn('createOutfitThumb', { count: partIds.length, width });
  const { canvas, ctx } = createSquareCanvas(width, 'avatar-coord__thumb');
  if (ctx === undefined) return log.fail(canvas, '描けない');
  const stage = stageLookOf(partIds);
  paintBackground(ctx, stage.background, width, width, 0);
  const unit = (width * 0.62) / 70;
  const floor = width * STAGE_FLOOR_RATIO;
  stage.objects.slice(0, 2).forEach((o, i) => paintObject(ctx, o, i === 0 ? width * 0.16 : width * 0.85, floor, unit * 0.8, 0));
  drawAvatar(ctx, stage.avatar, { x: width / 2 + 6 * unit, y: floor + 2 * unit, scale: unit });
  return log.exit(canvas);
}
