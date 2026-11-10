/**
 * @file 加点が抜けた訪問を見つけて、あとから加点するユースケース（application 層・書込系。DI-11 結果整合の後始末）
 * 訪問の保存と加点（台帳の追記）は別々の保存なので、訪問だけ保存できて台帳の保存に失敗すると、その訪問の EXP が付かないまま残る
 * （同じ日の押し直しは「今日は達成済み」になり、加点の機会が二度と来ない。docs/audit/20261110_integrity.md 欠陥1）。
 * 起動時に、アクティブな旅人の訪問記録のうち台帳に訪問行が無いものを AwardVisitRewardsUseCase へ流し直す。
 * ハンドラは行ID（操作ID から決まる）で冪等なので、何度呼んでも二重には付かない（DI-07）。増やすだけで、減らす操作はしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { EventFactory } from '@/application/events/EventFactory';
import type { AwardVisitRewardsUseCase } from '@/application/usecases/reward/AwardVisitRewardsUseCase';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import type { WorldDeps } from '@/application/usecases/shared/World';
import { ledgerEntryIdOf } from '@/domain/reward/LedgerEntry';
import type { PointLedgerRepository } from '@/domain/reward/PointLedgerRepository';

const logger = createLogger('application/usecases/reward/ReconcileVisitRewardsUseCase');

/** ReconcileVisitRewardsUseCase の依存 */
export interface ReconcileVisitRewardsDeps extends Pick<WorldDeps, 'session' | 'travelers' | 'spots'> {
  /** ポイント台帳（読むだけ。追記は award が行う） */
  readonly ledgers: PointLedgerRepository;
  /** イベントのメタ情報を付ける工場 */
  readonly eventFactory: EventFactory;
  /** 訪問の報酬を付けるハンドラ（冪等） */
  readonly award: Pick<AwardVisitRewardsUseCase, 'handle'>;
}

/** 抜けた加点を付け直した結果 */
export interface ReconcileVisitRewardsOutput {
  /** 台帳に訪問行が無かった訪問の数 */
  readonly missing: number;
  /** そのうち加点できた数 */
  readonly recovered: number;
}

/** 加点が抜けた訪問を加点し直す */
export class ReconcileVisitRewardsUseCase implements UseCase<void, ReconcileVisitRewardsOutput> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人・台帳・マスタ・イベント工場・報酬のハンドラ
   */
  constructor(private readonly deps: ReconcileVisitRewardsDeps) {}

  /**
   * アクティブな旅人の訪問のうち、台帳に訪問行が無いものを古い順に加点し直す。
   * @returns 成功: 抜けていた数と加点できた数（1件ずつ試し、失敗した訪問は次の起動でまた試す）。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED（読込）
   * @sideEffect AwardVisitRewardsUseCase.handle（台帳の追記・報酬イベントの発行）
   */
  async execute(): Promise<Result<ReconcileVisitRewardsOutput>> {
    const log = logger.fn('execute');
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    const ledger = await this.deps.ledgers.find(traveler.value.id);
    if (!ledger.ok) return log.fail(ledger);
    const missing = traveler.value.visits.filter((visit) => !ledger.value.hasEntry(ledgerEntryIdOf(visit.operationId, 'visit')));
    let recovered = 0;
    for (const visit of missing) {
      const event = this.deps.eventFactory.create(traveler.value.id, {
        type: 'SpotVisited', spotId: visit.spotId, districtId: visit.districtId, localDate: visit.localDate, operationId: visit.operationId,
      });
      const awarded = await this.deps.award.handle(event);
      if (awarded.ok) recovered += 1;
      else log.warn('抜けた加点を付け直せませんでした（次の起動でまた試す）', { code: awarded.error.code });
    }
    if (missing.length > 0) log.warn('加点が抜けた訪問を付け直しました（DI-11）', { missing: missing.length, recovered });
    return log.exit(ok({ missing: missing.length, recovered }));
  }
}
