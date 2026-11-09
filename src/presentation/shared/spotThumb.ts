/**
 * @file スポットの丸いサムネ（presentation/shared 層）
 * 下シートのスポットカードなどに、図鑑・スポット詳細と同じ街なみ絵（paintIllustration）を小さな丸で添える。
 * 訪問済み＝地区色のカラー、発見済み＝同じ絵の彩度を落としたもの（CSS で 45%。建物の種類で見分けられるように形は残す）。未発見は名前と同じく絵も伏せる（呼び出し側で「？」アイコンを使う）。
 * 地区色は CSS の --district（data-district-id から）を描画時に読むため、DOM に入った次のフレームで描く。
 */
import type { SpotKindDto, SpotStatusDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { SPOT_STATUS_ICONS } from '@/Common/ui/cards/SpotCard';
import { h } from '@/Common/ui/dom';
import { paintIllustration } from '@/presentation/screens/Spot/SpotIllustrationCanvas';

const logger = createLogger('presentation/shared/spotThumb');

/** サムネの直径（CSS px） */
export const SPOT_THUMB_PX = 48;

/** サムネの元になる情報 */
export interface SpotThumbModel {
  readonly id: string;
  readonly kind: SpotKindDto;
  readonly status: SpotStatusDto;
  /** マスタのカテゴリ（分からなければ省略。種別の既定の形になる） */
  readonly category?: string;
  /** スポット名（カテゴリが無いとき、名前の手がかりで店構え・名所の絵を選ぶ） */
  readonly name?: string;
}

/**
 * 丸いサムネを作る（未発見なら undefined）。読み上げは状態名（「訪問済み」など）にする。
 * @param model スポットの種別・状態・ID
 * @returns span 要素（class="spot-icon spot-thumb"）。未発見は undefined
 * @sideEffect 次のフレームで canvas に描く（requestAnimationFrame）
 */
export function createSpotThumb(model: SpotThumbModel): HTMLElement | undefined {
  const log = logger.fn('createSpotThumb', { spotId: model.id, status: model.status });
  if (model.status === 'unknown') return log.exit(undefined, '未発見は伏せる');
  const canvas = h('canvas', { class: 'spot-thumb__canvas', attrs: { 'aria-hidden': 'true' } });
  const dpr = normalizeDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  canvas.width = Math.round(SPOT_THUMB_PX * dpr);
  canvas.height = Math.round(SPOT_THUMB_PX * dpr);
  const icon = h('span', { class: ['spot-icon', 'spot-thumb'], attrs: { role: 'img', 'aria-label': SPOT_STATUS_ICONS[model.status].name }, dataset: { status: model.status } }, [canvas]);
  /**
   * サムネを描く（DOM に入ってから。地区色を CSS から読むため）。
   * @sideEffect canvas に描く
   */
  const paint = (): void => { // audit-ignore: fnlog-missing 描画は paintIllustration がログを出す
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    paintIllustration(ctx, { width: SPOT_THUMB_PX, height: SPOT_THUMB_PX, dpr }, { seed: model.id, kind: model.kind, category: model.category ?? '', status: 'visited', name: model.name ?? '' });
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(paint);
  else paint();
  return log.exit(icon);
}
