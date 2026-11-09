/**
 * @file スポット詳細の表示用の純粋関数（presentation/screens/Spot 層）
 * 訪問ボタンの状態と文言・クーポン/イベントの期限表示・次のカードまでの表示・訪問後のトースト文言を DOM から切り離す。
 * 達成率（％・全n件中m件）は作らない（CLAUDE.md 6.5）。用語は CLAUDE.md 11章に従う（名所と店舗の総称は「スポット」）。
 */
import type { ShopEventDto, SpotDetailDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { formatDistance } from '@/Common/ui/format';
import type { EffectSummary } from '@/presentation/App/AppContext';

const logger = createLogger('presentation/screens/Spot/spotDetailModel');

/** 訪問ボタンの状態 */
export interface VisitButtonState {
  readonly enabled: boolean;
  readonly label: string;
}

/** 訪問できるときのボタン文言（80m は VISIT_RADIUS_M（仮）＝地図の円と同じ。2026-11-09 に 40m から変更。presentation は文言で持つ） */
export const VISIT_ENABLED_LABEL = 'クエスト達成（80m以内）';

/** クーポン・イベントの種類の表示名 */
export const SHOP_EVENT_KIND_LABELS: Readonly<Record<ShopEventDto['kind'], string>> = { coupon: 'クーポン', event: 'イベント' };

/** カードのランクの表示名 */
export const CARD_RANK_LABELS: Readonly<Record<'silver' | 'gold', string>> = { silver: '銀', gold: '金' };

/**
 * 訪問ボタンの有効・無効と文言を決める。
 * 優先順: 訪問できる → 今日は訪問済み → あと n m → application の理由文 → 既定文。
 * @param dto スポット詳細（canVisit・visitedToday・metersToVisit・visitBlockedReason を使う）
 * @returns ボタンの状態
 */
export function visitButtonState(dto: Pick<SpotDetailDto, 'canVisit' | 'visitedToday' | 'metersToVisit' | 'visitBlockedReason'>): VisitButtonState {
  const log = logger.fn('visitButtonState', { canVisit: dto.canVisit, visitedToday: dto.visitedToday, metersToVisit: dto.metersToVisit });
  if (dto.canVisit) return log.exit({ enabled: true, label: VISIT_ENABLED_LABEL });
  if (dto.visitedToday) return log.exit({ enabled: false, label: dto.visitBlockedReason ?? '今日は訪問済みです。また別の日に' });
  if (dto.metersToVisit !== undefined && dto.metersToVisit > 0) {
    return log.exit({ enabled: false, label: `あと ${Math.ceil(dto.metersToVisit)}m 近づくと訪問できます` });
  }
  return log.exit({ enabled: false, label: dto.visitBlockedReason ?? '今は訪問できません' });
}

/**
 * 現在地からの距離の表示。
 * @param meters 距離（位置が取れないときは undefined）
 * @returns '62m'／'1.2km'／'現在地不明'
 */
export function distanceText(meters: number | undefined): string {
  const log = logger.fn('distanceText', { meters });
  return log.exit(meters === undefined ? '現在地不明' : formatDistance(meters));
}

/**
 * 'YYYY-MM-DD' を 'M/D' にする（形式外はそのまま返す）。
 * @param date 日付文字列
 * @returns 例 '11/12'
 */
export function formatMonthDay(date: string): string {
  const log = logger.fn('formatMonthDay', { date });
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return log.exit(date);
  return log.exit(`${Number(match[2])}/${Number(match[3])}`);
}

/**
 * クーポン・イベントの期限の表示（期間内なら残り日数、開始前なら開始日）。
 * @param event クーポン・イベント
 * @returns 'あと3日'／'今日まで'／'12/1から'
 */
export function eventTimingLabel(event: Pick<ShopEventDto, 'active' | 'daysLeft' | 'start'>): string {
  const log = logger.fn('eventTimingLabel', { active: event.active, daysLeft: event.daysLeft });
  if (event.active && event.daysLeft !== undefined) return log.exit(event.daysLeft <= 0 ? '今日まで' : `あと${event.daysLeft}日`);
  if (!event.active && event.daysLeft === undefined) return log.exit(`${formatMonthDay(event.start)}から`);
  return log.exit('終了しました');
}

/**
 * クーポン・イベントの2行目（種類・期限・期間）。
 * @param event クーポン・イベント
 * @returns 例 'クーポン ・ あと3日 ・ 11/1〜11/12'
 */
export function eventSubtitle(event: ShopEventDto): string {
  const log = logger.fn('eventSubtitle', { id: event.id, kind: event.kind });
  const period = `${formatMonthDay(event.start)}〜${formatMonthDay(event.end)}`;
  return log.exit([SHOP_EVENT_KIND_LABELS[event.kind], eventTimingLabel(event), period].join(' ・ '));
}

/**
 * 次のカードまでの表示（地区単位の通いの目標）。
 * @param nextCard 次のカード（無ければ undefined）
 * @returns 'あと1回で銀カード'。無ければ undefined
 */
export function nextCardLabel(nextCard: SpotDetailDto['nextCard']): string | undefined {
  const log = logger.fn('nextCardLabel', { rank: nextCard?.rank, remaining: nextCard?.remainingVisits });
  if (nextCard === undefined) return log.exit(undefined);
  return log.exit(`あと${nextCard.remainingVisits}回で${CARD_RANK_LABELS[nextCard.rank]}カード`);
}

/**
 * 訪問後のトースト文言（基本ポイントとおかえりボーナス）。
 * @param summary 演出のまとめ
 * @returns 例 'クエスト達成！ +15EXP（おかえりボーナス +7）'
 */
export function visitToastMessage(summary: Pick<EffectSummary, 'points' | 'bonusPoints'>): string {
  const log = logger.fn('visitToastMessage', { points: summary.points, bonusPoints: summary.bonusPoints });
  const bonus = summary.bonusPoints > 0 ? `（おかえりボーナス +${summary.bonusPoints}）` : '';
  return log.exit(`クエスト達成！ +${summary.points}EXP${bonus}`);
}

/**
 * 地区の成長のトースト文言。
 * @param districtName 地区名（不明なら undefined）
 * @param level 新しい成長段階（不明なら undefined）
 * @returns 例 '南森町・天満宮地区が Lv3 に育ちました'
 */
export function growthToastMessage(districtName: string | undefined, level: number | undefined): string {
  const log = logger.fn('growthToastMessage', { level });
  const name = districtName ?? '地区';
  return log.exit(level === undefined ? `${name}が育ちました` : `${name}が Lv${level} に育ちました`);
}
