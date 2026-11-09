/**
 * @file 訪問ボタン（presentation/screens/Spot 層）
 * 80m（VISIT_RADIUS_M（仮）＝地図の円と同じ）以内でだけ有効。無効のときは押せない理由（あと n m など）をボタンの文言で伝える（wireframes/04_spot）。
 * 店頭QR での訪問確定（CLAUDE.md 10章）は未実装のため、案内は出さない（準備中の機能を見せない）。
 * 実行中は createButton が Promise の完了まで無効化する（二重タップ防止）。
 */
import type { SpotDetailDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h, setStyle } from '@/Common/ui/dom';
import { visitButtonState } from '@/presentation/screens/Spot/spotDetailModel';

const logger = createLogger('presentation/screens/Spot/VisitButton');

/** 訪問できる範囲までの近さをゲージで見せるときの見通し距離（メートル。見た目だけの値で、判定には使わない） */
const APPROACH_GAUGE_HORIZON_M = 600;

/**
 * 訪問できる範囲への近さ（0〜1）を返す。あと n m が小さいほど 1 に近い（見た目のゲージ用）。
 * @param metersToVisit あと何 m 近づけば訪問できるか（不明なら undefined）
 * @returns 0.06〜1。不明なら undefined
 */
export function approachRatio(metersToVisit: number | undefined): number | undefined {
  const log = logger.fn('approachRatio', { metersToVisit });
  if (metersToVisit === undefined || !Number.isFinite(metersToVisit)) return log.exit(undefined);
  const ratio = 1 - Math.max(0, metersToVisit) / APPROACH_GAUGE_HORIZON_M;
  return log.exit(Math.round(Math.min(1, Math.max(0.06, ratio)) * 1000) / 1000);
}

/**
 * 画面下部に固定する訪問ボタンの塊を作る（ボタンは data-testid="visit-button"、data-can-visit=1/0）。
 * @param dto スポット詳細
 * @param onVisit 押されたときの処理（相関ID は createButton が発行済み。完了までボタンは無効）
 * @returns フッター要素
 */
export function createVisitButton(dto: SpotDetailDto, onVisit: () => Promise<void>): HTMLElement {
  const log = logger.fn('createVisitButton', { spotId: dto.id, canVisit: dto.canVisit, partner: dto.partner });
  const state = visitButtonState(dto);
  const button = createButton({
    label: state.label,
    variant: state.enabled ? 'primary' : 'secondary',
    size: 'large',
    disabled: !state.enabled,
    testId: 'visit-button',
    onClick: onVisit,
  });
  button.dataset.canVisit = state.enabled ? '1' : '0';
  const approach = state.enabled ? undefined : approachRatio(dto.metersToVisit);
  if (approach !== undefined) {
    button.classList.add('btn--approach');
    setStyle(button, '--progress', String(approach));
  }
  return log.exit(h('div', { class: 'spot-footer', attrs: { 'data-testid': 'visit-footer' } }, [button]));
}
