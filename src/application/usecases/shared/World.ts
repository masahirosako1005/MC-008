/**
 * @file 読取系ユースケースが共通で使う「旅人の世界」のロード（application 層）
 * セッションから旅人を解決し（入力の travelerId を信用しない＝SEC-01）、旅人・地区の主の盤・ライバル行動・ライバル・マスタ・今日をまとめて読む。
 * 書込みはしない。保存データの検証はリポジトリ（infrastructure）の境界で済んでいる前提（DI-01）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { SpotId, TravelerId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import type { LordshipBoard } from '@/domain/competition/LordshipBoard';
import type { LordshipRepository } from '@/domain/competition/LordshipRepository';
import type { Rival, RivalActionVisit } from '@/domain/competition/Rival';
import type { RivalActionRepository, RivalRepository } from '@/domain/competition/RivalRepository';
import type { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import type { Clock } from '@/domain/ports/Clock';
import type { PointLedgerRepository } from '@/domain/reward/PointLedgerRepository';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/shared/World');

/** 「旅人の世界」を読むための依存（ユースケースのコンストラクタ deps にそのまま含められる形） */
export interface WorldDeps {
  readonly session: SessionRepository;
  readonly travelers: TravelerRepository;
  /** ポイント台帳（loadWorld は読まない。マイ街などが同じ deps から使う） */
  readonly ledgers: PointLedgerRepository;
  readonly lordships: LordshipRepository;
  readonly rivalActions: RivalActionRepository;
  readonly rivals: RivalRepository;
  readonly spots: SpotRepository;
  readonly clock: Clock;
}

/** 旅人の世界（読取専用のスナップショット） */
export interface World {
  /** 今日（Clock.today()。1回のロードで固定） */
  readonly today: LocalDate;
  /** アクティブな旅人 */
  readonly traveler: Traveler;
  /** 地区の主の盤（未保存なら LordshipBoard.empty） */
  readonly board: LordshipBoard;
  /** 旅人の世界のライバル行動（古い順） */
  readonly actions: readonly RivalActionVisit[];
  /** すべての模擬ライバル（マスタ） */
  readonly rivals: readonly Rival[];
  /** マスタ参照（スポット・地区・クーポン/イベント） */
  readonly spots: SpotRepository;
}

/**
 * 旅人が見つからないときの失敗値を作る。
 * @returns TRAVELER_NOT_FOUND の失敗 Result
 */
function travelerNotFound(): Result<never, AppError<'TRAVELER_NOT_FOUND'>> {
  return fail(AppError.of('TRAVELER_NOT_FOUND', '冒険者のデータが見つかりません。アプリを再読み込みしてください'));
}

/**
 * セッションからアクティブな旅人ID を解決する（入力の travelerId は使わない＝SEC-01）。
 * @param session セッションリポジトリ
 * @returns 成功: 旅人ID。失敗: TRAVELER_NOT_FOUND（セッションに旅人が無い）／STORAGE_FAILED など（セッション読込の失敗をそのまま返す）
 * @sideEffect SessionRepository.load を呼ぶ（読むだけ）
 * @see docs/05_security_checklist.md SEC-01
 */
export async function resolveActiveTravelerId(session: SessionRepository): Promise<Result<TravelerId>> {
  const log = logger.fn('resolveActiveTravelerId');
  const loaded = await session.load();
  if (!loaded.ok) return log.fail(loaded);
  const travelerId = loaded.value.activeTravelerId;
  if (travelerId === undefined) return log.fail(travelerNotFound(), 'セッションに旅人が無い');
  return log.exit(ok(travelerId));
}

/**
 * セッションのアクティブな旅人を読む。
 * @param deps セッションと旅人リポジトリ
 * @returns 成功: 旅人。失敗: TRAVELER_NOT_FOUND（セッションに無い・保存されていない）／STORAGE_FAILED など
 * @sideEffect SessionRepository.load・TravelerRepository.findById を呼ぶ（読むだけ）
 */
export async function loadActiveTraveler(deps: Pick<WorldDeps, 'session' | 'travelers'>): Promise<Result<Traveler>> {
  const log = logger.fn('loadActiveTraveler');
  const travelerId = await resolveActiveTravelerId(deps.session);
  if (!travelerId.ok) return log.fail(travelerId);
  const found = await deps.travelers.findById(travelerId.value);
  if (!found.ok) return log.fail(found);
  if (found.value === undefined) return log.fail(travelerNotFound(), '旅人が保存されていない');
  return log.exit(ok(found.value));
}

/**
 * 読取系ユースケースが共通で使う「旅人の世界」をまとめて読む。
 * 地区の主の盤が未保存ならリポジトリが LordshipBoard.empty を返す（行は主が決まったときに増える）。
 * @param deps WorldDeps
 * @returns 成功: World。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED など（各リポジトリの失敗をそのまま返す）
 * @sideEffect 各リポジトリの読込（find/list）と Clock.today を呼ぶ。書込みはしない
 */
export async function loadWorld(deps: WorldDeps): Promise<Result<World>> {
  const log = logger.fn('loadWorld');
  const traveler = await loadActiveTraveler(deps);
  if (!traveler.ok) return log.fail(traveler);
  const travelerId = traveler.value.id;
  const [board, actions] = await Promise.all([deps.lordships.find(travelerId), deps.rivalActions.list(travelerId)]);
  if (!board.ok) return log.fail(board);
  if (!actions.ok) return log.fail(actions);
  const world: World = Object.freeze({
    today: deps.clock.today(),
    traveler: traveler.value,
    board: board.value,
    actions: actions.value,
    rivals: deps.rivals.allRivals(),
    spots: deps.spots,
  });
  log.debug('世界を読込', { travelerId, today: world.today, visits: world.traveler.visits.length, actions: world.actions.length });
  return log.exit(ok(world));
}

/**
 * 旅人が発見済みのスポットID の集合を返す（訪問済みも含める。RevisitReasonPolicy・地図の状態判定用）。
 * @param traveler 旅人
 * @returns 発見記録と訪問記録のスポットID の和集合（新しい Set）
 */
export function discoveredSpotIdsOf(traveler: Traveler): Set<SpotId> {
  const log = logger.fn('discoveredSpotIdsOf', { discoveries: traveler.discoveries.length, visits: traveler.visits.length });
  const ids = new Set<SpotId>(traveler.discoveries.map((record) => record.spotId));
  for (const visit of traveler.visits) ids.add(visit.spotId);
  return log.exit(ids);
}
