/**
 * @file 図鑑カードの絵（presentation/screens/Zukan 層）
 * 2026-11-09 ユーザー指示「リアル写真風な、場所がしっかり思い出せるデザインに」で、写真があれば写真を出す（名所は実写、店舗はカテゴリのイメージ写真）。
 * 写真が無い・読めないときは、スポット詳細と同じ街なみ絵（SpotIllustrationCanvas.paintIllustration）を小さく描く。
 * 訪問済み＝カラー、発見済み・未発見＝モノクロ（見た目は CSS）。「行けばこの写真が色づく」と見せて訪問の動機にする（B・C）。
 * 親要素が DOM に入ってから mountCardArt を呼ぶ（イラストは大きさが要るため）。
 */
import type { SpotKindDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { createCanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import { paintIllustration } from '@/presentation/screens/Spot/SpotIllustrationCanvas';
import { mountPhotoImage } from '@/presentation/screens/Spot/SpotPhotoView';
import type { SpotPhoto } from '@/presentation/shared/spotPhotos';

const logger = createLogger('presentation/screens/Zukan/ZukanCardArt');

/** カードの絵の元になる情報（発見済み・訪問済みのみ） */
export interface ZukanArtModel {
  readonly seed: string;
  readonly kind: SpotKindDto;
  readonly category: string;
  readonly status: 'discovered' | 'visited';
  readonly name: string;
  /** 写真（無ければイラスト） */
  readonly photo?: SpotPhoto;
}

/**
 * カードの絵を host に描く（大きさが変わったら描き直す）。
 * @param host 絵を入れる要素（DOM に追加済み・大きさが決まっていること）
 * @param model 絵の元になる情報
 * @returns 後始末する関数（Canvas を使えなければ何もしない関数）
 * @sideEffect host に canvas を追加し、ResizeObserver を登録する
 */
export function mountCardArt(host: HTMLElement, model: ZukanArtModel): () => void {
  const log = logger.fn('mountCardArt', { seed: model.seed, status: model.status, photo: model.photo !== undefined });
  if (model.photo !== undefined) {
    let destroyFallback: (() => void) | undefined;
    const stop = mountPhotoImage(host, model.photo, {
      alt: '',
      onFail: (): void => {
        host.dataset.photo = 'failed';
        destroyFallback = mountIllustration(host, model);
      },
    });
    preloadPhoto(host);
    return log.exit((): void => {
      stop();
      destroyFallback?.();
    }, '写真');
  }
  return log.exit(mountIllustration(host, model));
}

/**
 * カードの写真を先に読み込ませ、読み終えたら host に data-loaded を付ける。
 * 図鑑は速く動かすと写真が後から出て枠だけが見えるので、画面の外のカードも先に読む（写真は小さく圧縮済み・店舗はカテゴリで共用）。
 * 読み終えるまで「イメージ」の札は出さない（CSS。空の枠に札だけが出ないように）。
 * @param host 絵を入れた要素（mountPhotoImage で img を追加済み）
 * @sideEffect img の loading を eager・decoding を sync に変え、読み込み完了で host.dataset.loaded を付ける
 */
function preloadPhoto(host: HTMLElement): void {
  const log = logger.fn('preloadPhoto');
  const img = host.querySelector<HTMLImageElement>('img.spot-photo__img');
  if (img === null) return log.exit(undefined, '写真なし');
  /**
   * 読み込みを終えた印を付ける。
   */
  const markLoaded = (): void => {
    const markLog = logger.fn('markLoaded');
    host.dataset.loaded = '1';
    markLog.exit(undefined);
  };
  img.loading = 'eager';
  img.decoding = 'sync'; // 読み込み済みの写真は、画面に入った最初の描画で出す（後から遅れて出さない）
  if (img.complete && img.naturalWidth > 0) markLoaded();
  else img.addEventListener('load', markLoaded, { once: true });
  return log.exit(undefined);
}

/**
 * カードの街なみイラストを host に描く（大きさが変わったら描き直す）。
 * @param host 絵を入れる要素（DOM に追加済み・大きさが決まっていること）
 * @param model 絵の元になる情報
 * @returns 後始末する関数（Canvas を使えなければ何もしない関数）
 * @sideEffect host に canvas を追加し、ResizeObserver を登録する
 */
function mountIllustration(host: HTMLElement, model: ZukanArtModel): () => void {
  const log = logger.fn('mountIllustration', { seed: model.seed, status: model.status });
  let surface: CanvasSurface | undefined;
  surface = createCanvasSurface(host, {
    className: 'zukan-card__canvas',
    onResize: (size): void => {
      if (surface !== undefined) paintIllustration(surface.ctx, size, model);
    },
  });
  if (surface === undefined) {
    log.warn('Canvas を使えないため絵を省略します');
    return log.exit((): void => undefined);
  }
  paintIllustration(surface.ctx, surface.size(), model);
  const current = surface;
  return log.exit((): void => current.destroy());
}
