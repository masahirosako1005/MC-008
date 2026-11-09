/**
 * @file アバターの肖像（ブランドの淡い色の丸＋フラットなアバター）（presentation/screens/MyTown 層。DOM 部品）
 * 着せ替えのプレビュー・アバターのひと言で使う。絵は表示の解像度で直接描く（docs/08 §10.5 のフラットなイラスト）。
 */
import { createLogger } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { h, setStyle } from '@/Common/ui/dom';
import { PALETTE } from '@/Common/ui/theme/palette';
import { drawAvatar } from '@/presentation/screens/MyTown/avatarArt';
import type { AvatarLook } from '@/presentation/screens/MyTown/avatarArt';

const logger = createLogger('presentation/screens/MyTown/MyTownProfile');

/** 肖像の大きさ（CSS px）と、アバターの拡大率 */
export interface PortraitSize {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

/**
 * アバターの肖像を描いた canvas を作る。
 * @param look 装い
 * @param size 大きさと拡大率
 * @returns canvas 要素
 */
export function createPortrait(look: AvatarLook, size: PortraitSize): HTMLCanvasElement {
  const log = logger.fn('createPortrait', { held: look.held, width: size.width });
  const dpr = normalizeDpr(window.devicePixelRatio);
  const canvas = h('canvas', { class: 'mytown-portrait', attrs: { width: Math.round(size.width * dpr), height: Math.round(size.height * dpr), 'aria-hidden': 'true' } });
  setStyle(canvas, 'width', `${size.width}px`);
  setStyle(canvas, 'height', `${size.height}px`);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.fail(canvas, '2D コンテキストを取得できません');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = Math.min(size.width, size.height) * 0.4;
  ctx.fillStyle = PALETTE.brandSoft;
  ctx.beginPath(); ctx.arc(size.width / 2, size.height * 0.5, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255, 90, 54, 0.12)';
  ctx.beginPath(); ctx.arc(size.width * 0.72, size.height * 0.28, r * 0.22, 0, Math.PI * 2); ctx.fill();
  drawAvatar(ctx, look, { x: size.width / 2 + (look.hasCat ? 6 * size.scale : 0), y: size.height - 8 * size.scale, scale: size.scale });
  return log.exit(canvas);
}
