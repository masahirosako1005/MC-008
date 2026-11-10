/**
 * @file アバターの部品だけの絵（presentation/shared/avatar 層。Canvas 部品）
 * 2026-11-10 ユーザー指示「ランキング画面の報酬がアバター着用時のスクショになっているのでアイテムのみの画像にしてほしい」。
 * 帽子・アクセサリー・持ち物・相棒を、アバターの体を描かずに部品だけ描き（avatarPaint の drawAvatarItem）、絵の外接矩形を測って正方形の真ん中に大きく置く。
 * 外接矩形は部品ごとに一度だけ測って覚える（止まった絵なので、同じ部品はいつも同じ形）。測れない環境では枠ごとの決まった範囲を使う。
 */
import { createLogger } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { h, setStyle } from '@/Common/ui/dom';
import { splitPartId } from '@/presentation/shared/avatar/avatarLook';
import { drawAvatarItem, isAvatarItemSlot } from '@/presentation/shared/avatar/avatarPaint';
import type { AvatarItemSlot } from '@/presentation/shared/avatar/avatarPaint';

const logger = createLogger('presentation/shared/avatar/itemArt');

/** 範囲（アバター座標） */
interface Bounds { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** 測るときの拡大率（px / アバター座標 1） */
const MEASURE_SCALE = 3;

/** 測る範囲（アバター座標）。帽子は頭の上、相棒・持ち物は原点のまわりに描かれるので、どれも入る広さにする */
const MEASURE_AREA: Bounds = { x: -60, y: -100, w: 120, h: 130 };

/** 透明とみなす不透明度（0..255。うすい影やにじみは外接矩形に入れない） */
const ALPHA_MIN = 24;

/** 正方形の中で絵が占める割合（まわりに少し余白） */
const FILL = 0.84;

/** 測れないときの枠ごとの範囲（アバター座標） */
const FALLBACK: Readonly<Record<AvatarItemSlot, Bounds>> = {
  hat: { x: -20, y: -80, w: 40, h: 30 },
  accessory: { x: -18, y: -40, w: 36, h: 30 },
  held: { x: -6, y: -26, w: 26, h: 32 },
  pet: { x: -12, y: -24, w: 24, h: 26 },
};

/** 部品ID → 測った外接矩形 */
const boundsCache = new Map<string, Bounds>();

/**
 * 画素の不透明なところの外接矩形を求める。
 * @param data 画素（RGBA）
 * @param width 幅（px）
 * @param height 高さ（px）
 * @returns 外接矩形（px。何も無ければ undefined）
 */
function opaqueRectOf(data: Uint8ClampedArray, width: number, height: number): Bounds | undefined {
  const log = logger.fn('opaqueRectOf', { width, height });
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) < ALPHA_MIN) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return log.exit(undefined, '空');
  return log.exit({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
}

/**
 * 部品の絵の外接矩形（アバター座標）を測る（部品ごとに一度だけ）。
 * @param partId 部品ID
 * @param slot 枠
 * @param style 種類
 * @returns 外接矩形（描けない部品なら undefined）
 */
function boundsOf(partId: string, slot: AvatarItemSlot, style: string): Bounds | undefined {
  const log = logger.fn('boundsOf', { partId });
  const cached = boundsCache.get(partId);
  if (cached !== undefined) return log.exit(cached, '覚えていた');
  const width = MEASURE_AREA.w * MEASURE_SCALE;
  const height = MEASURE_AREA.h * MEASURE_SCALE;
  const canvas = h('canvas', { attrs: { width, height } });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? undefined;
  if (ctx === undefined) return log.exit(FALLBACK[slot], '2D コンテキストなし');
  ctx.setTransform(MEASURE_SCALE, 0, 0, MEASURE_SCALE, -MEASURE_AREA.x * MEASURE_SCALE, -MEASURE_AREA.y * MEASURE_SCALE);
  if (!drawAvatarItem(ctx, slot, style, MEASURE_SCALE)) return log.exit(undefined, '描けない部品');
  let px: Bounds | undefined;
  try {
    px = opaqueRectOf(ctx.getImageData(0, 0, width, height).data, width, height);
  } catch (e: unknown) {
    log.warn('画素を読めません。決まった範囲を使います', { error: String(e) });
    return log.exit(FALLBACK[slot]);
  }
  const bounds = px === undefined ? FALLBACK[slot] : { x: MEASURE_AREA.x + px.x / MEASURE_SCALE, y: MEASURE_AREA.y + px.y / MEASURE_SCALE, w: px.w / MEASURE_SCALE, h: px.h / MEASURE_SCALE };
  boundsCache.set(partId, bounds);
  return log.exit(bounds);
}

/**
 * 部品だけの絵を正方形の canvas に作る（帽子・アクセサリー・持ち物・相棒。体は描かない）。
 * @param partId 部品ID（'hat.laurel' など）
 * @param size 一辺（CSS px）
 * @param className クラス名
 * @returns canvas（部品だけで描けない枠・知らない部品なら undefined。呼び出し側で別の絵にする）
 */
export function createItemArt(partId: string, size: number, className = 'avatar-item'): HTMLCanvasElement | undefined {
  const log = logger.fn('createItemArt', { partId, size });
  const part = splitPartId(partId);
  if (part === undefined || !isAvatarItemSlot(part.slot)) return log.exit(undefined, '部品だけで描く枠ではない');
  const bounds = boundsOf(partId, part.slot, part.style);
  if (bounds === undefined) return log.exit(undefined, '描けない部品');
  const dpr = normalizeDpr(window.devicePixelRatio);
  const canvas = h('canvas', { class: className, attrs: { width: Math.round(size * dpr), height: Math.round(size * dpr), 'aria-hidden': 'true' } });
  setStyle(canvas, 'width', `${size}px`);
  setStyle(canvas, 'height', `${size}px`);
  const ctx = canvas.getContext('2d') ?? undefined;
  if (ctx === undefined) return log.exit(undefined, '2D コンテキストなし');
  const s = (size * FILL) / Math.max(bounds.w, bounds.h, 1);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (size / 2 - (bounds.x + bounds.w / 2) * s), dpr * (size / 2 - (bounds.y + bounds.h / 2) * s));
  drawAvatarItem(ctx, part.slot, part.style, s);
  return log.exit(canvas);
}
