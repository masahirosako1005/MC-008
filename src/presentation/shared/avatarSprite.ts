/**
 * @file アバターのスプライト（presentation/shared。マイ街のアバターを地図などほかの画面で使うための部品）
 * マイ街と同じアバター（MyTown/avatarArt.ts の drawAvatar・myTownModel の avatarLookOf）を、小さな画像にして使い回す。
 * - 端末の解像度でくっきり描く（マイ街と同じフラットなモダンのアバター＝docs/08 §10.5。大きさの単位 dotPx は配置の互換のため残す）
 * - まわりに白いふちを付ける（地図の上でも埋もれないステッカー風）
 * 画像は装い・拡大率・dpr ごとにキャッシュし、毎フレーム作らない。
 * 依存はこのファイルに閉じる（avatarArt が Common／shared へ移ったら import を差し替えるだけでよい）。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import type { MyTownDto } from '@/application/dto/Dto';
import { drawAvatar } from '@/presentation/screens/MyTown/avatarArt';
import type { AvatarLook } from '@/presentation/screens/MyTown/avatarArt';
import { avatarLookOf, profileStatsOf } from '@/presentation/screens/MyTown/myTownModel';

export type { AvatarLook };

const logger = createLogger('presentation/shared/avatarSprite');

/** アバター座標（拡大率1）で絵が収まる範囲。ねこ（左）・持ち物（右）・帽子（上）・影（下）を含む */
export const AVATAR_BOX = { left: 38, right: 30, top: 76, bottom: 6 } as const;
/** ふちの太さ（ドット） */
const OUTLINE_DOTS = 1;
/** ふちの色 */
const OUTLINE_COLOR = '#ffffff';
/** キャッシュする画像の上限（自分＋ほかの旅人7人 × ズーム3段階で約24枚。装い・dpr が変わったら古いものを捨てる） */
const MAX_CACHED = 64;

/** ドット絵の画像（大きさは CSS px。足元の位置で地面に立たせる） */
export interface AvatarSprite {
  readonly image: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  /** 画像の左上から足元までの距離（CSS px） */
  readonly footX: number;
  readonly footY: number;
}

/** 画像の作り方 */
export interface AvatarSpriteOptions {
  /** 拡大率（1 で高さ約 70px） */
  readonly scale: number;
  /** 1ドットの大きさ（CSS px） */
  readonly dotPx: number;
  /** 端末のピクセル比 */
  readonly dpr: number;
}

/** 装い・作り方ごとの画像 */
const cache = new Map<string, AvatarSprite>();

/**
 * マイ街のデータから、マイ街と同じアバターの装いを決める（帽子・ねこは通った実績、持ち物は着せ替えの選択）。
 * @param dto マイ街のデータ
 * @returns 装い
 */
export function avatarLookOfTown(dto: MyTownDto): AvatarLook {
  const log = logger.fn('avatarLookOfTown', { heldItemId: dto.heldItemId });
  return log.exit(avatarLookOf(profileStatsOf(dto.districts), dto.heldItemId));
}

/**
 * 画像の大きさ（ドット数）と足元の位置（ドット）を返す。ふちの分の余白を含む。
 * @param scale 拡大率
 * @param dotPx 1ドットの大きさ（CSS px）
 * @returns 幅・高さ・足元（ドット）
 */
export function spriteDotsOf(scale: number, dotPx: number): { readonly width: number; readonly height: number; readonly footX: number; readonly footY: number } {
  const log = logger.fn('spriteDotsOf', { scale, dotPx });
  const unit = scale / dotPx;
  const footX = Math.ceil(AVATAR_BOX.left * unit) + OUTLINE_DOTS;
  const footY = Math.ceil(AVATAR_BOX.top * unit) + OUTLINE_DOTS;
  return log.exit({ width: footX + Math.ceil(AVATAR_BOX.right * unit) + OUTLINE_DOTS, height: footY + Math.ceil(AVATAR_BOX.bottom * unit) + OUTLINE_DOTS, footX, footY });
}

/**
 * キャッシュのキーを作る。
 * @param look 装い
 * @param opts 作り方
 * @returns キー
 */
function keyOf(look: AvatarLook, opts: AvatarSpriteOptions): string { // audit-ignore: fnlog-missing 毎フレーム呼ぶキャッシュ参照（文字列を作るだけ）
  return `${look.hat ?? '-'}|${look.outfitColor}|${look.held}|${look.hasCat ? 1 : 0}|${opts.scale}|${opts.dotPx}|${opts.dpr}`;
}

/**
 * アバターの画像を返す（キャッシュがあればそれを、なければ作る）。
 * @param look 装い
 * @param opts 作り方
 * @returns 画像（Canvas が使えない環境では undefined）
 * @sideEffect 初回だけ canvas 要素を作ってキャッシュする
 */
export function avatarSpriteFor(look: AvatarLook, opts: AvatarSpriteOptions): AvatarSprite | undefined { // audit-ignore: fnlog-missing 毎フレーム描画（キャッシュ参照。作るときだけ buildSprite でログ）
  const key = keyOf(look, opts);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const built = buildSprite(look, opts);
  if (built === undefined) return undefined;
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(key, built);
  return built;
}

/**
 * 画像を作る（端末の解像度で描く → 白いふちを付ける）。
 * @param look 装い
 * @param opts 作り方
 * @returns 画像（Canvas が使えなければ undefined）
 * @sideEffect canvas 要素を作る
 */
function buildSprite(look: AvatarLook, opts: AvatarSpriteOptions): AvatarSprite | undefined {
  const log = logger.fn('buildSprite', { scale: opts.scale, dotPx: opts.dotPx, dpr: opts.dpr });
  if (typeof document === 'undefined') return log.exit(undefined, 'DOM なし');
  const dots = spriteDotsOf(opts.scale, opts.dotPx);
  const width = dots.width * opts.dotPx;
  const height = dots.height * opts.dotPx;
  const pxW = Math.max(1, Math.round(width * opts.dpr));
  const pxH = Math.max(1, Math.round(height * opts.dpr));
  const art = canvasOf(pxW, pxH);
  const image = canvasOf(pxW, pxH);
  if (art === undefined || image === undefined) return log.exit(undefined, '2D コンテキストなし');
  art.setTransform(opts.dpr, 0, 0, opts.dpr, 0, 0);
  drawAvatar(art, look, { x: dots.footX * opts.dotPx, y: dots.footY * opts.dotPx, scale: opts.scale });
  addOutline(image, art.canvas, Math.max(1, Math.round(OUTLINE_DOTS * opts.dotPx * 0.75 * opts.dpr)));
  return log.exit({ image: image.canvas, width, height, footX: dots.footX * opts.dotPx, footY: dots.footY * opts.dotPx });
}

/**
 * 絵のまわりに白いふち（ステッカー風）を付けて描く。8方向にずらして重ねた形を白で塗り、その上に元の絵を置く。
 * @param target 描き先（絵と同じ大きさ）
 * @param art 元の絵
 * @param radius ふちの太さ（実ピクセル）
 * @sideEffect target に描画する
 */
function addOutline(target: CanvasRenderingContext2D, art: HTMLCanvasElement, radius: number): void {
  const log = logger.fn('addOutline', { width: art.width, height: art.height, radius });
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12;
    target.drawImage(art, Math.cos(a) * radius, Math.sin(a) * radius);
  }
  target.globalCompositeOperation = 'source-in';
  target.fillStyle = OUTLINE_COLOR;
  target.fillRect(0, 0, art.width, art.height);
  target.globalCompositeOperation = 'source-over';
  target.drawImage(art, 0, 0);
  log.exit(undefined);
}

/**
 * 指定の大きさの canvas と 2D コンテキストを作る。
 * @param width 幅（px）
 * @param height 高さ（px）
 * @returns 2D コンテキスト（取れなければ undefined）
 */
function canvasOf(width: number, height: number): CanvasRenderingContext2D | undefined {
  const log = logger.fn('canvasOf', { width, height });
  const canvas = h('canvas', { attrs: { width, height } });
  return log.exit(canvas.getContext('2d') ?? undefined);
}
