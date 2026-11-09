/**
 * @file 新しい旅人を保存してアクティブにする共通部品（application 層）
 * 起動時の旅人準備（EnsureTravelerUseCase）とデモの旅人切替（SwitchTravelerUseCase）で使う。
 * 旅人 → 台帳 → 地区の主の初期状態（現職なしで D7 を計算）→ セッションの順に保存する。
 * 保存先はどれも未保存（版数 0）であることが前提（デモは先に削除する）。途中で失敗したらそこで止めて失敗を返す（DI-12）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import { recalculateLords } from '@/application/usecases/competition/recalculateLords';
import { LordshipBoard } from '@/domain/competition/LordshipBoard';
import type { LordshipRepository } from '@/domain/competition/LordshipRepository';
import type { Rival, RivalActionVisit } from '@/domain/competition/Rival';
import type { RivalRepository } from '@/domain/competition/RivalRepository';
import type { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import type { PointLedger } from '@/domain/reward/PointLedger';
import type { PointLedgerRepository } from '@/domain/reward/PointLedgerRepository';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import type { District } from '@/domain/town/District';

const logger = createLogger('application/usecases/session/TravelerSetup');

/** 新しい旅人を保存するための依存 */
export interface TravelerStoreDeps {
  readonly session: SessionRepository;
  readonly travelers: TravelerRepository;
  readonly ledgers: PointLedgerRepository;
  readonly lordships: LordshipRepository;
  readonly rivals: RivalRepository;
  readonly spots: SpotRepository;
}

/** persistNewTraveler の入力 */
export interface NewTravelerInput {
  /** 保存前の旅人（版数 0） */
  readonly traveler: Traveler;
  /** 保存前の台帳（版数 0。行が無ければ保存しない＝未保存は空の台帳として読まれる） */
  readonly ledger: PointLedger;
  /** 今日（主の初期状態の集計期間の終端） */
  readonly today: LocalDate;
}

/** initialLordshipBoard の入力 */
export interface InitialBoardInput {
  readonly travelerId: TravelerId;
  readonly today: LocalDate;
  /** 旅人の訪問記録 */
  readonly visits: readonly VisitRecord[];
  /** すべてのライバル */
  readonly rivals: readonly Rival[];
  /** すべての地区 */
  readonly districts: readonly District[];
  /** 旅人の世界のライバル行動（新しい旅人なら空） */
  readonly actions?: readonly RivalActionVisit[];
}

/**
 * 地区の主の初期状態を計算する（全地区・現職なしで D7: 回数1以上の最多。同数は 旅人 → ライバルID昇順）。
 * 初めて主が決まるだけなので lostByTraveler は立たない。
 * @param input 旅人ID・今日・訪問記録・ライバル・地区・ライバル行動
 * @returns 主の初期状態の盤（版数 0）
 * @see docs/08 §4.5「主の初期状態はシード時点で D7 に従い計算して保存する」
 */
export function initialLordshipBoard(input: InitialBoardInput): LordshipBoard {
  const log = logger.fn('initialLordshipBoard', { travelerId: input.travelerId, today: input.today, visits: input.visits.length });
  const result = recalculateLords({
    board: LordshipBoard.empty(input.travelerId),
    districtIds: input.districts.map((district) => district.id),
    today: input.today,
    visits: input.visits,
    rivals: input.rivals,
    actions: input.actions ?? [],
  });
  return log.exit(result.board, `lords=${result.changes.length}`);
}

/**
 * 新しい旅人を保存し、主の初期状態を計算して保存し、セッションのアクティブな旅人にする。
 * @param deps セッション・旅人・台帳・盤のリポジトリ・ライバル・マスタ
 * @param input 旅人・台帳・今日
 * @returns 成功: 保存後の旅人（版数 1）。失敗: CONFLICT（既に保存されている）／STORAGE_FAILED
 * @sideEffect TravelerRepository.save・PointLedgerRepository.save（行があれば）・LordshipRepository.save（主がいれば）・SessionRepository.save
 * @see docs/08 D14, §4.5、docs/05 SEC-01
 */
export async function persistNewTraveler(deps: TravelerStoreDeps, input: NewTravelerInput): Promise<Result<Traveler>> {
  const log = logger.fn('persistNewTraveler', { travelerId: input.traveler.id, profile: input.traveler.profile, today: input.today });
  const traveler = await deps.travelers.save(input.traveler, 0);
  if (!traveler.ok) return log.fail(traveler);
  if (input.ledger.entries.length > 0) {
    const ledger = await deps.ledgers.save(input.ledger, 0);
    if (!ledger.ok) return log.fail(ledger);
  }
  const board = initialLordshipBoard({
    travelerId: traveler.value.id, today: input.today, visits: traveler.value.visits, rivals: deps.rivals.allRivals(), districts: deps.spots.allDistricts(),
  });
  if (board.entries.length > 0) {
    const savedBoard = await deps.lordships.save(board, 0);
    if (!savedBoard.ok) return log.fail(savedBoard);
  }
  const session = await deps.session.save({ activeTravelerId: traveler.value.id });
  if (!session.ok) return log.fail(session);
  log.info('旅人を準備', { travelerId: traveler.value.id, profile: traveler.value.profile, lords: board.entries.length });
  return log.exit(ok(traveler.value));
}
