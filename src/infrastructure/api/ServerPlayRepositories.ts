/**
 * @file サーバーの記録の写しを読むだけのリポジトリ（infrastructure/api 層。docs/12 §3）
 * 商用版のアプリでは、旅人と台帳への書き込みはサーバーの API（HttpPlayUseCase）だけが行う。画面の読み取り系ユースケース
 * （地図・図鑑・ランク・再訪理由など）は今までどおりリポジトリ IF を読むので、ここで写し（ServerPlayState）を返す。
 * save・delete は必ず失敗する（アプリ側で記録や EXP を作れない＝SEC-21）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import type { SessionRepository, SessionState } from '@/application/ports/SessionRepository';
import type { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerRepository, TravelerSaveErrorCode } from '@/domain/exploration/TravelerRepository';
import { PointLedger } from '@/domain/reward/PointLedger';
import type { PointLedgerRepository, PointLedgerSaveErrorCode } from '@/domain/reward/PointLedgerRepository';
import type { ServerPlayState } from '@/infrastructure/api/ServerPlayState';

const logger = createLogger('infrastructure/api/ServerPlayRepositories');

/**
 * アプリ側からは保存できない、という失敗を作る。
 * @returns STORAGE_FAILED の失敗
 */
function readOnly(): Result<never, AppError<'STORAGE_FAILED'>> {
  return fail(AppError.of('STORAGE_FAILED', 'この操作はサーバーで行います', { rule: 'serverAuthoritative' }));
}

/** ログイン中の旅人だけを返すセッション */
export class ServerSessionRepository implements SessionRepository {
  /**
   * 作る。
   * @param state サーバーの記録の写し
   */
  constructor(private readonly state: ServerPlayState) {}

  /**
   * ログイン中の旅人を返す。
   * @returns セッション
   */
  async load(): Promise<Result<SessionState>> {
    return ok({ activeTravelerId: this.state.travelerId });
  }

  /**
   * 何もしない（旅人はサーバーのログインで決まるので、アプリ側では切り替えない）。
   * @returns 成功
   */
  async save(): Promise<Result<void>> {
    return okVoid();
  }
}

/** 旅人の写しを読むだけのリポジトリ */
export class ServerTravelerRepository implements TravelerRepository {
  /**
   * 作る。
   * @param state サーバーの記録の写し
   */
  constructor(private readonly state: ServerPlayState) {}

  /**
   * 旅人を読む。
   * @param id 旅人ID
   * @returns ログイン中の旅人ならその写し。ほかの ID は undefined
   */
  async findById(id: TravelerId): Promise<Result<Traveler | undefined>> {
    const log = logger.fn('findById', { id });
    return log.exit(ok(id === this.state.travelerId ? this.state.traveler() : undefined));
  }

  /**
   * 保存はできない。
   * @returns STORAGE_FAILED
   */
  async save(): Promise<Result<Traveler, AppError<TravelerSaveErrorCode>>> {
    const log = logger.fn('save');
    return log.fail(readOnly());
  }

  /**
   * 削除はできない。
   * @returns STORAGE_FAILED
   */
  async delete(): Promise<Result<void>> {
    const log = logger.fn('delete');
    return log.fail(readOnly());
  }
}

/** 台帳の写しを読むだけのリポジトリ */
export class ServerPointLedgerRepository implements PointLedgerRepository {
  /**
   * 作る。
   * @param state サーバーの記録の写し
   */
  constructor(private readonly state: ServerPlayState) {}

  /**
   * 台帳を読む。
   * @param travelerId 旅人ID
   * @returns ログイン中の旅人ならその写し。ほかの ID は空の台帳
   */
  async find(travelerId: TravelerId): Promise<Result<PointLedger>> {
    const log = logger.fn('find', { travelerId });
    const ledger = travelerId === this.state.travelerId ? this.state.ledger() : undefined;
    return log.exit(ok(ledger ?? PointLedger.empty(travelerId)));
  }

  /**
   * 保存はできない。
   * @returns STORAGE_FAILED
   */
  async save(): Promise<Result<PointLedger, AppError<PointLedgerSaveErrorCode>>> {
    const log = logger.fn('save');
    return log.fail(readOnly());
  }

  /**
   * 削除はできない。
   * @returns STORAGE_FAILED
   */
  async delete(): Promise<Result<void>> {
    const log = logger.fn('delete');
    return log.fail(readOnly());
  }
}
