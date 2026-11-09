/**
 * @file SpotVisited を受けるイベントハンドラが共通で使う「その訪問の前後」の読込（application 層の共通部品）
 * docs/08 §4.2: 各ハンドラは「訪問前の記録」を operationId が一致する記録を除いて再構成する。
 * ここでは保存順（古い順）の訪問記録で、その訪問より前を visitsBefore、その訪問までを visitsAfter とする
 * （ハンドラが訪問直後に動く通常の流れでは「operationId が一致する記録を除いた全件」と同じ。後から再実行しても結果が変わらない＝DI-05, DI-07）。
 * 旅人はセッションから解決し、イベントの旅人と一致しなければ処理しない（SEC-01）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import type { WorldDeps } from '@/application/usecases/shared/World';
import type { SpotVisited } from '@/domain/events/DomainEvent';
import type { Traveler } from '@/domain/exploration/Traveler';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import type { Spot } from '@/domain/spot/Spot';
import type { District } from '@/domain/town/District';

const logger = createLogger('application/usecases/shared/VisitContext');

/** loadVisitContext の依存 */
export type VisitContextDeps = Pick<WorldDeps, 'session' | 'travelers' | 'spots'>;

/** 1回の訪問の前後（読取専用のスナップショット） */
export interface VisitContext {
  /** セッションのアクティブな旅人（訪問記録は保存済み） */
  readonly traveler: Traveler;
  /** イベントの訪問記録（保存済みのもの） */
  readonly record: VisitRecord;
  /** この訪問より前の訪問記録（保存順） */
  readonly visitsBefore: readonly VisitRecord[];
  /** この訪問までの訪問記録（visitsBefore ＋ record） */
  readonly visitsAfter: readonly VisitRecord[];
  /** 訪問したスポット（マスタ） */
  readonly spot: Spot;
  /** 訪問した地区（マスタ） */
  readonly district: District;
}

/**
 * イベントと保存データが食い違うときの失敗値を作る。
 * @param rule 食い違いの種類（details.rule に入れる）
 * @returns INVALID_INPUT の失敗 Result
 */
function invalidEvent(rule: 'travelerMismatch' | 'visitNotFound' | 'visitMismatch'): Result<never> {
  return fail(AppError.of('INVALID_INPUT', '訪問の記録が見つかりません。もう一度お試しください', { kind: 'SpotVisited', rule }));
}

/**
 * イベントの訪問記録を旅人の記録から探し、その位置を返す。
 * @param traveler 旅人
 * @param event SpotVisited
 * @returns 成功: 記録の位置（保存順の添字）。失敗: INVALID_INPUT（記録が無い・スポット/地区/暦日が食い違う）
 */
function findRecordIndex(traveler: Traveler, event: SpotVisited): Result<number> {
  const log = logger.fn('findRecordIndex', { operationId: event.operationId, visits: traveler.visits.length });
  const index = traveler.visits.findIndex((visit) => visit.operationId === event.operationId);
  const record = traveler.visits[index];
  if (record === undefined) return log.fail(invalidEvent('visitNotFound'));
  if (record.spotId !== event.spotId || record.districtId !== event.districtId || record.localDate !== event.localDate) {
    return log.fail(invalidEvent('visitMismatch'));
  }
  return log.exit(ok(index));
}

/**
 * SpotVisited の訪問について、旅人・訪問記録・訪問の前後の記録・スポット・地区をまとめて読む。
 * @param deps セッション・旅人リポジトリ・マスタ参照
 * @param event SpotVisited（VisitSpotUseCase が保存後に発行したもの）
 * @returns 成功: VisitContext。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED（読込）／INVALID_INPUT（イベントの旅人がセッションと違う・訪問記録が無い）／
 *          SPOT_NOT_FOUND／DISTRICT_NOT_FOUND（マスタに無い）
 * @sideEffect SessionRepository.load・TravelerRepository.findById を呼ぶ（読むだけ）
 * @see docs/08 §4.2, docs/05 SEC-01
 */
export async function loadVisitContext(deps: VisitContextDeps, event: SpotVisited): Promise<Result<VisitContext>> {
  const log = logger.fn('loadVisitContext', { eventId: event.eventId, spotId: event.spotId, operationId: event.operationId });
  const traveler = await loadActiveTraveler(deps);
  if (!traveler.ok) return log.fail(traveler);
  if (traveler.value.id !== event.travelerId) return log.fail(invalidEvent('travelerMismatch'), 'イベントの旅人がセッションと違う');
  const index = findRecordIndex(traveler.value, event);
  if (!index.ok) return log.fail(index);
  const visitsAfter = Object.freeze(traveler.value.visits.slice(0, index.value + 1));
  const record = visitsAfter[index.value];
  if (record === undefined) return log.fail(invalidEvent('visitNotFound'));
  const spot = deps.spots.findSpot(record.spotId);
  if (spot === undefined) return log.fail(fail(AppError.of('SPOT_NOT_FOUND', 'スポットが見つかりません', { spotId: record.spotId })));
  const district = deps.spots.findDistrict(record.districtId);
  if (district === undefined) return log.fail(fail(AppError.of('DISTRICT_NOT_FOUND', '地区が見つかりません', { districtId: record.districtId })));
  const context: VisitContext = Object.freeze({
    traveler: traveler.value,
    record,
    visitsBefore: Object.freeze(visitsAfter.slice(0, index.value)),
    visitsAfter,
    spot,
    district,
  });
  return log.exit(ok(context), `visitsBefore=${index.value}`);
}
