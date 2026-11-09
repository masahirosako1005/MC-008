/**
 * @file 図鑑カードの絵（presentation/screens/Zukan 層）
 * スポット詳細と同じ街なみ絵（SpotIllustrationCanvas.paintIllustration）を小さく描く。訪問済み＝カラー、発見済み＝シルエット。
 * 「行けばこの絵が色づく」と見せて訪問の動機にする（B・C）。未発見は絵を描かない（CSS の「？」カード）。
 * 親要素が DOM に入ってから mountCardArt を呼ぶ（大きさが要るため）。
 */
import type { SpotKindDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { createCanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import { paintIllustration } from '@/presentation/screens/Spot/SpotIllustrationCanvas';

const logger = createLogger('presentation/screens/Zukan/ZukanCardArt');

/** カードの絵の元になる情報（発見済み・訪問済みのみ） */
export interface ZukanArtModel {
  readonly seed: string;
  readonly kind: SpotKindDto;
  readonly category: string;
  readonly status: 'discovered' | 'visited';
  readonly name: string;
}

/**
 * カードの絵を host に描く（大きさが変わったら描き直す）。
 * @param host 絵を入れる要素（DOM に追加済み・大きさが決まっていること）
 * @param model 絵の元になる情報
 * @returns 後始末する関数（Canvas を使えなければ何もしない関数）
 * @sideEffect host に canvas を追加し、ResizeObserver を登録する
 */
export function mountCardArt(host: HTMLElement, model: ZukanArtModel): () => void {
  const log = logger.fn('mountCardArt', { seed: model.seed, status: model.status });
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
