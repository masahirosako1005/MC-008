/**
 * @file あなたの訪問履歴（presentation/screens/Spot 層）
 * このスポットに通った回数・地区に通った回数・次のカードまで・訪問日の一覧（CLAUDE.md 6.4、wireframes/04_spot）。
 * カードの条件は地区単位（4.6）なので地区の回数に「あと◯回で銀カード」を添える（基準C）。達成率は出さない。
 */
import type { SpotDetailDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';
import { nextCardLabel } from '@/presentation/screens/Spot/spotDetailModel';

const logger = createLogger('presentation/screens/Spot/MyVisitHistory');

/**
 * 訪問日の一覧を作る（新しい順。無ければ案内文）。
 * @param history 訪問日の表示文字列（'2026/11/02（月）'）
 * @returns 要素
 */
function createHistoryDates(history: readonly string[]): HTMLElement {
  const log = logger.fn('createHistoryDates', { count: history.length });
  if (history.length === 0) {
    return log.exit(h('p', { class: 'hint', attrs: { 'data-testid': 'visit-dates' }, text: 'まだ訪れていません。最初の1回で地区が育ちはじめます' }));
  }
  const items = history.map((label) => h('li', { text: label }));
  return log.exit(h('ul', { class: 'spot-history__dates', attrs: { 'data-testid': 'visit-dates', 'aria-label': '訪問日' } }, items));
}

/**
 * 訪問履歴の塊を作る（data-testid="visit-history"）。
 * @param dto スポット詳細
 * @returns section 要素
 */
export function createMyVisitHistory(dto: SpotDetailDto): HTMLElement {
  const log = logger.fn('createMyVisitHistory', { spotId: dto.id, visitCount: dto.visitCount, districtVisitCount: dto.districtVisitCount });
  const nextCard = nextCardLabel(dto.nextCard);
  const districtValue = h('span', { attrs: { 'data-testid': 'district-visit-count' } }, [
    `${dto.districtVisitCount}回`,
    nextCard === undefined ? undefined : h('span', { class: ['tag', 'tag--accent', 'spot-history__next'], attrs: { 'data-testid': 'next-card' }, text: nextCard }),
  ]);
  const spotValue = h('span', { attrs: { 'data-testid': 'spot-visit-count' }, text: `${dto.visitCount}回` });
  return log.exit(
    h('section', { class: ['spot-section', 'spot-history'], attrs: { 'data-testid': 'visit-history' } }, [
      h('h2', { class: 'sheet-section-title', text: 'あなたの訪問履歴' }),
      h('div', { class: 'spot-history__stats' }, [
        createStatTile('このスポットに通った回数', spotValue),
        createStatTile(`${dto.districtName}に通った回数`, districtValue, createCardGauge(dto)),
      ]),
      h('h3', { class: 'spot-history__label', text: '訪問日' }),
      createHistoryDates(dto.history),
    ]),
  );
}

/**
 * 回数を大きく見せる数字のタイル（見出し＋数字＋任意のゲージ）を作る。
 * @param label 見出し
 * @param value 数字の要素（「3回」など。data-testid を持つ）
 * @param gauge 下に添えるゲージ（任意）
 * @returns div 要素
 */
function createStatTile(label: string, value: HTMLElement, gauge?: HTMLElement): HTMLElement {
  const log = logger.fn('createStatTile', { label });
  value.classList.add('spot-stat__value');
  return log.exit(h('div', { class: 'spot-stat' }, [h('span', { class: 'spot-stat__label', text: label }), value, gauge]));
}

/**
 * 次のカードまでの進み具合のゲージを作る（地区の回数 ÷ 次のカードに必要な回数）。見た目だけなので読み上げない。
 * 達成率の数字は出さない（網羅ではなく「あと何回」を主役にする）。
 * @param dto スポット詳細
 * @returns ゲージの要素（次のカードが無ければ undefined）
 */
function createCardGauge(dto: SpotDetailDto): HTMLElement | undefined {
  const log = logger.fn('createCardGauge', { rank: dto.nextCard?.rank, remaining: dto.nextCard?.remainingVisits });
  const next = dto.nextCard;
  if (next === undefined) return log.exit(undefined);
  const goal = dto.districtVisitCount + next.remainingVisits;
  const ratio = goal > 0 ? Math.min(1, Math.max(0, dto.districtVisitCount / goal)) : 0;
  const bar = h('span', { class: 'spot-gauge__bar' });
  setStyle(bar, '--progress', String(Math.round(ratio * 1000) / 1000));
  return log.exit(h('span', { class: 'spot-gauge', dataset: { rank: next.rank }, attrs: { 'aria-hidden': 'true' } }, [bar]));
}
