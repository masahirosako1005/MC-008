/**
 * @file スポットの写真の表示（presentation/screens/Spot 層）
 * 2026-11-09 ユーザー指示「リアル写真風な、場所がしっかり思い出せるデザインに」。スポット詳細の上部と図鑑のカード・拡大プレビューで使う。
 * 写真は img（object-fit: cover）で出し、読めないときは街なみイラスト（SpotIllustrationCanvas）に切り替える。
 * 店舗のイメージ写真には「イメージ」の札、写真にはクレジット（作者・ライセンス・出典へのリンク）を添える（CC BY / BY-SA の表示義務）。
 * 未訪問はモノクロで出す（行けば色づく。見た目は CSS）。
 */
import '@/presentation/screens/Spot/SpotPhotoView.css';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createSpotIllustration } from '@/presentation/screens/Spot/SpotIllustrationCanvas';
import type { SpotIllustrationHandle, SpotIllustrationModel } from '@/presentation/screens/Spot/SpotIllustrationCanvas';
import { photoCreditText, spotPhotoOf } from '@/presentation/shared/spotPhotos';
import type { SpotPhoto } from '@/presentation/shared/spotPhotos';

const logger = createLogger('presentation/screens/Spot/SpotPhotoView');

/** mountPhotoImage のオプション */
export interface PhotoImageOptions {
  /** 代替テキスト（飾りなら空文字） */
  readonly alt: string;
  /** 読めなかったとき（img は取り除き済み） */
  readonly onFail: () => void;
}

/**
 * 写真の img を host に入れる。読めなければ img を取り除いて onFail を呼ぶ。
 * @param host 入れ先
 * @param photo 写真
 * @param opts 代替テキスト・失敗時の処理
 * @returns 後始末する関数（読込失敗の監視をやめる）
 * @sideEffect host に img を追加する
 */
export function mountPhotoImage(host: HTMLElement, photo: SpotPhoto, opts: PhotoImageOptions): () => void {
  const log = logger.fn('mountPhotoImage', { src: photo.src });
  const img = h('img', { class: 'spot-photo__img', attrs: { src: photo.src, alt: opts.alt, loading: 'lazy', decoding: 'async', draggable: 'false' } });
  /**
   * 読込に失敗したとき（イラストに切り替える）。
   */
  const fail = (): void => {
    const failLog = logger.fn('fail', { src: photo.src });
    img.remove();
    opts.onFail();
    failLog.warn('写真を読めないためイラストに切り替えます');
    failLog.exit(undefined);
  };
  img.addEventListener('error', fail, { once: true });
  host.append(img);
  return log.exit((): void => img.removeEventListener('error', fail));
}

/**
 * 「イメージ」の札（店舗のカテゴリ写真がその店の写真ではないことを示す）。
 * @returns 要素
 */
export function createImageBadge(): HTMLElement {
  const log = logger.fn('createImageBadge');
  return log.exit(h('span', { class: 'spot-photo__badge', attrs: { title: 'その店の写真ではなく、カテゴリのイメージ写真です' }, text: 'イメージ' }));
}

/**
 * 写真のクレジット（作者・ライセンス・出典へのリンク）。
 * @param photo 写真
 * @returns 要素
 */
export function createPhotoCredit(photo: SpotPhoto): HTMLElement {
  const log = logger.fn('createPhotoCredit', { license: photo.license });
  return log.exit(
    h('p', { class: 'spot-photo__credit', attrs: { 'data-testid': 'spot-photo-credit' } }, [
      h('span', { class: 'spot-photo__credit-text', text: photoCreditText(photo) }),
      h('a', { class: 'spot-photo__credit-link', attrs: { href: photo.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, text: '出典' }),
    ]),
  );
}

/**
 * スポット詳細の上部の絵を出す。写真があれば写真（イメージの札・クレジットつき）、無いか読めなければ街なみイラスト。
 * @param parent 入れ先（DOM に追加済みであること）
 * @param model 絵の元（名前・種別・カテゴリ・状態など）
 * @returns 絵の操作（SpotIllustrationHandle と同じ形）
 * @sideEffect parent に要素を追加する（イラストに切り替えるときは ResizeObserver も登録する）
 */
export function createSpotVisual(parent: HTMLElement, model: SpotIllustrationModel): SpotIllustrationHandle {
  const log = logger.fn('createSpotVisual', { seed: model.seed, kind: model.kind, status: model.status });
  const photo = spotPhotoOf({ id: model.seed, kind: model.kind, category: model.category });
  if (photo === undefined) return log.exit(createSpotIllustration(parent, model), 'イラスト');
  const box = h('figure', {
    class: ['spot-illust', 'spot-photo'],
    attrs: { 'data-testid': 'spot-illustration', 'data-status': model.status, 'data-district-id': model.districtId, 'data-photo': photo.isImage ? 'image' : 'real' },
  });
  parent.append(box);
  let fallback: SpotIllustrationHandle | undefined;
  const alt = photo.isImage ? `${model.category}のイメージ写真` : `${model.name}の写真`;
  const stop = mountPhotoImage(box, photo, {
    alt,
    onFail: (): void => {
      if (!box.isConnected) return;
      fallback = createSpotIllustration(parent, model);
      box.replaceWith(fallback.element);
    },
  });
  if (photo.isImage) box.append(createImageBadge());
  box.append(createPhotoCredit(photo));
  return log.exit({
    element: box,
    destroy: (): void => {
      stop();
      fallback?.destroy();
    },
  });
}
