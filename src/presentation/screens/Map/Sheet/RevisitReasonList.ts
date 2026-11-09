/**
 * @file 再訪理由カードの一覧（presentation/screens/Map/Sheet 層）
 * 下シート「半分」で、次に訪れる理由を優先順（期限＞取り返し＞色あせ＞未訪問＞新着）に並べる（CLAUDE.md 4.5・6.3）。
 * タップ先: 期限・未訪問でスポットが分かればスポット詳細、それ以外は地区（地図の地区ズーム）。
 */
import type { RevisitReasonDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { createRevisitReasonCard } from '@/Common/ui/cards/RevisitReasonCard';
import { h } from '@/Common/ui/dom';
import { reasonTarget, sortReasons } from '@/presentation/screens/Map/Sheet/sheetModel';
import type { SheetTarget } from '@/presentation/screens/Map/Sheet/sheetModel';

const logger = createLogger('presentation/screens/Map/Sheet/RevisitReasonList');

/** 再訪理由カード1枚のオプション */
export interface ReasonCardOptions {
  /** つまみ用の1行表示 */
  readonly compact?: boolean;
  /** カードが押されたときの行き先の受け口 */
  readonly onTarget: (target: SheetTarget) => void;
}

/**
 * 再訪理由カードを1枚作る（data-testid="reason-card"、data-kind・data-district-id・data-spot-id 付き）。
 * @param reason 再訪理由（文言は application で日本語化済み）
 * @param opts 1行表示・タップ時の処理
 * @returns カード要素
 */
export function createReasonCardFor(reason: RevisitReasonDto, opts: ReasonCardOptions): HTMLElement {
  const log = logger.fn('createReasonCardFor', { kind: reason.kind, districtId: reason.districtId, compact: opts.compact === true });
  const card = createRevisitReasonCard({
    kind: reason.kind,
    title: reason.title,
    subtitle: reason.subtitle,
    compact: opts.compact,
    onClick: (): void => opts.onTarget(reasonTarget(reason)),
    dataset: { districtId: reason.districtId, spotId: reason.spotId },
  });
  return log.exit(card);
}

/**
 * 再訪理由カードの一覧を作る（data-testid="reason-list"）。
 * @param reasons 再訪理由
 * @param onTarget カードが押されたときの行き先の受け口
 * @returns 一覧の要素
 */
export function createRevisitReasonList(reasons: readonly RevisitReasonDto[], onTarget: (target: SheetTarget) => void): HTMLElement {
  const log = logger.fn('createRevisitReasonList', { count: reasons.length });
  if (reasons.length === 0) {
    return log.exit(h('p', { class: ['hint', 'map-sheet__empty'], attrs: { 'data-testid': 'reason-list' }, text: 'いまは急ぎの理由はありません。気の向くまま歩いてみましょう' }));
  }
  const cards = sortReasons(reasons).map((reason) => createReasonCardFor(reason, { onTarget }));
  return log.exit(h('div', { class: 'map-sheet__list', attrs: { 'data-testid': 'reason-list' } }, cards));
}
