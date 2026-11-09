/**
 * @file アバターの画像要素（presentation/shared）
 * avatarSprite のアバター（マイ街・地図と同じ絵、白いふち付き）を <img> にして、DOM で組む画面（ランキングなど）に置く。
 * 同じ装い・大きさの画像は data URL を使い回す。Canvas が使えない環境（テストなど）では undefined を返し、呼び出し側が頭文字などで代わりに描く。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { avatarSpriteFor } from '@/presentation/shared/avatarSprite';
import type { AvatarLook } from '@/presentation/shared/avatarSprite';

const logger = createLogger('presentation/shared/avatarImage');

/** 1ドットの大きさ（CSS px。地図と同じ） */
const DOT_PX = 2;
/** 端末のピクセル比の上限（画像を大きくしすぎない） */
const MAX_DPR = 3;
/** 使い回す data URL の上限 */
const MAX_CACHED = 64;

/** 装い・大きさごとの data URL と大きさ */
const cache = new Map<string, { readonly url: string; readonly width: number; readonly height: number }>();

/**
 * アバターの <img> を作る（足元が画像の下端。飾りなので読み上げない）。
 * @param look 装い
 * @param scale 拡大率（1 で高さ約 70px）
 * @returns 画像要素（Canvas が使えなければ undefined）
 * @sideEffect 初回だけ canvas に描いて data URL をキャッシュする
 */
export function createAvatarImage(look: AvatarLook, scale: number): HTMLImageElement | undefined {
  const log = logger.fn('createAvatarImage', { scale });
  const dpr = Math.min(MAX_DPR, Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  const key = `${JSON.stringify(look)}|${scale}|${dpr}`;
  let hit = cache.get(key);
  if (hit === undefined) {
    const sprite = avatarSpriteFor(look, { scale, dotPx: DOT_PX, dpr });
    if (sprite === undefined) return log.exit(undefined, 'Canvas なし');
    let url: string;
    try {
      url = sprite.image.toDataURL('image/png');
    } catch (e) {
      return log.exit(undefined, `画像にできない: ${String(e)}`);
    }
    hit = { url, width: Math.round(sprite.width), height: Math.round(sprite.height) };
    if (cache.size >= MAX_CACHED) cache.clear();
    cache.set(key, hit);
  }
  return log.exit(h('img', { class: 'avatar-img', attrs: { src: hit.url, width: hit.width, height: hit.height, alt: '', 'aria-hidden': 'true', draggable: 'false' } }));
}
