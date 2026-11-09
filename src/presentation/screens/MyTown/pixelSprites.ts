/**
 * @file マイ街の小さなアイコン（presentation/screens/MyTown 層。モジュール名は旧来のまま）
 * 文字の代わりに絵で伝えるためのアイコン（足あと・カード・王冠・コイン・時計・星・持ち物・ピン）。
 * 絵は townIconArt のフラットなモダンのアイコン（docs/08 §10.5）を端末の解像度で描く。ドット絵はやめた。
 * SPRITES（旧ドット絵の行列）は表示の大きさ（列数×dot・行数×dot）を決めるためだけに残す（画面のレイアウトを変えないため）。
 */
import { createLogger } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { h, setStyle } from '@/Common/ui/dom';
import { paintTownIcon } from '@/presentation/screens/MyTown/townIconArt';

const logger = createLogger('presentation/screens/MyTown/pixelSprites');

/** アイコンの名前 */
export type SpriteName = 'foot' | 'card' | 'crown' | 'coin' | 'clock' | 'star' | 'chochin' | 'nobori' | 'matsu' | 'camera' | 'pin';

/** アイコンの表示の大きさを決める旧ドット絵の行列（列数×dot・行数×dot。絵は townIconArt で描く） */
export const SPRITES: Readonly<Record<SpriteName, readonly string[]>> = {
  foot: ['..kk......', '.kbbk.....', '.kbbk.....', '..kk..kk..', '.....kbbk.', '.....kbbk.', '......kk..', '..kk......', '.kbbk.....', '..kk......'],
  card: ['kkkkkkkkk', 'kgggggggk', 'kgsssssgk', 'kgsssssgk', 'kgooooogk', 'kgooooogk', 'kgggggggk', 'kgwwwwwgk', 'kgggggggk', 'kkkkkkkkk'],
  crown: ['k....k....k', 'kk..kkk..kk', 'kgk.kgk.kgk', 'kggkgggkggk', 'kgggggggggk', 'kgcgggggcgk', 'kgggggggggk', 'kkkkkkkkkkk'],
  coin: ['..kkkkk..', '.kgggggk.', 'kggyyyggk', 'kgyyggggk', 'kgyyggggk', 'kgggggggk', 'kgggggggk', '.kgggggk.', '..kkkkk..'],
  clock: ['..kkkkk..', '.kwwwwwk.', 'kwwwkwwwk', 'kwwwkwwwk', 'kwwwkkkwk', 'kwwwwwwwk', 'kwwwwwwwk', '.kwwwwwk.', '..kkkkk..'],
  star: ['....k....', '...kgk...', 'kkkgggkkk', '.kgggggk.', '..kgggk..', '.kggkggk.', '.kgk.kgk.', 'kk.....kk'],
  chochin: ['...kk...', '..kkkk..', '.kcccck.', 'kcccccck', 'kckkkkck', 'kcccccck', 'kcccccck', '.kcccck.', '..kkkk..', '...kk...', '...kk...'],
  nobori: ['k.......', 'kkkkkkk.', 'kssssssk', 'kswwwssk', 'kssssssk', 'kswwwssk', 'kssssssk', 'kkkkkkkk', 'k.......', 'k.......', 'k.......', 'k.......'],
  matsu: ['....k....', '...kok...', '..koook..', '.koooook.', 'kkoooookk', '..koook..', '.koooook.', 'koooooook', 'kkkkbkkkk', '....b....', '...kkk...'],
  camera: ['..kkk......', 'kkkkkkkkkkk', 'keeekkkeeek', 'keekwskeeek', 'keeksskeeek', 'keeekkkeeek', 'kkkkkkkkkkk'],
  pin: ['..kkkk..', '.kcccck.', 'kccwwcck', 'kccwwcck', '.kcccck.', '..kcck..', '...kk...'],
};

/** 色の置き換え（シルエット・灰色版などに使う） */
export type SpriteTint = 'normal' | 'gray' | 'silhouette';

/**
 * 描いたアイコンの色を置き換える（gray=彩度を抜く、silhouette=灰色の形だけ）。アイコン専用の canvas なので全体に掛けてよい。
 * @param ctx アイコンの canvas の 2D コンテキスト
 * @param tint 置き換え
 * @sideEffect ctx の画素を書き換える
 */
function applyTint(ctx: CanvasRenderingContext2D, tint: SpriteTint): void {
  const log = logger.fn('applyTint', { tint });
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (tint === 'silhouette') {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = '#b4bac4';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    return log.exit(undefined);
  }
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const gray = Math.round((px[i] ?? 0) * 0.3 + (px[i + 1] ?? 0) * 0.59 + (px[i + 2] ?? 0) * 0.11);
    const soft = Math.round(gray + (235 - gray) * 0.35);
    px[i] = soft; px[i + 1] = soft; px[i + 2] = soft;
  }
  ctx.putImageData(image, 0, 0);
  log.exit(undefined);
}

/**
 * アイコンを canvas で作る（表示の大きさは旧ドット絵と同じ 列数×dot・行数×dot）。
 * @param name アイコンの名前
 * @param dot 大きさの単位（CSS px。旧ドット絵の1ドット）
 * @param tint 色の置き換え（省略時そのまま）
 * @returns canvas（読み上げない飾り。意味は隣の文字で伝える）
 */
export function createSprite(name: SpriteName, dot: number, tint: SpriteTint = 'normal'): HTMLCanvasElement {
  const log = logger.fn('createSprite', { name, dot, tint });
  const rows = SPRITES[name];
  const cols = Math.max(...rows.map((r) => r.length));
  const width = cols * dot;
  const height = rows.length * dot;
  const dpr = normalizeDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  const canvas = h('canvas', { class: 'mytown-sprite', attrs: { width: Math.max(1, Math.round(width * dpr)), height: Math.max(1, Math.round(height * dpr)), 'aria-hidden': 'true' } });
  setStyle(canvas, 'width', `${width}px`);
  setStyle(canvas, 'height', `${height}px`);
  setStyle(canvas, 'image-rendering', 'auto');
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.fail(canvas, '2D コンテキストを取得できません');
  const side = Math.min(width, height);
  ctx.setTransform(dpr * side / 20, 0, 0, dpr * side / 20, dpr * (width - side) / 2, dpr * (height - side) / 2);
  paintTownIcon(ctx, name);
  if (tint !== 'normal') applyTint(ctx, tint);
  return log.exit(canvas);
}
