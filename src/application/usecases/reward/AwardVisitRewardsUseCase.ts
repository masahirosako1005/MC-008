/**
 * @file 訪問の報酬（ポイント・おかえりボーナス・銀金カード・アイテム）を付けて通知するイベントハンドラ（application 層）
 * docs/08 §4.2 の2番目: SpotVisited → 台帳追記 → PointsAwarded・WelcomeBackBonusGranted・CardAwarded・ItemAcquired。
 * - ポイントは台帳への追記だけで表す（DI-06）。行ID は操作ID から決まり、加点済みの訪問は何もしない（DI-07）
 * - 計算 → 台帳の保存（1回・楽観ロック＝DI-10, DI-12）→ イベント発行の順。保存に失敗したらイベントは出さない
 * - カード・アイテムは訪問記録から導出し保存しない（D4, D16）。訪問の前後の差でイベントを出す
 */
import { createLogger } from '@/Common/logging/logger';
import { okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { EventBus } from '@/application/events/EventBus';
import type { EventFactory } from '@/application/events/EventFactory';
import { visitLedgerEntriesOf } from '@/application/usecases/reward/visitLedgerEntries';
import { loadVisitContext } from '@/application/usecases/shared/VisitContext';
import type { VisitContext, VisitContextDeps } from '@/application/usecases/shared/VisitContext';
import type { DomainEvent, SpotVisited } from '@/domain/events/DomainEvent';
import { visitsInDistrict } from '@/domain/exploration/VisitStats';
import { cardsOf, newlyEarnedCards } from '@/domain/reward/CardPolicy';
import { itemsOf, newlyAcquiredItems } from '@/domain/reward/ItemPolicy';
import { ledgerEntryIdOf } from '@/domain/reward/LedgerEntry';
import type { PointLedgerRepository } from '@/domain/reward/PointLedgerRepository';
import { isRevival, rewardFor } from '@/domain/reward/VisitRewardPolicy';
import type { VisitReward } from '@/domain/reward/VisitRewardPolicy';

const logger = createLogger('application/usecases/reward/AwardVisitRewardsUseCase');

/** AwardVisitRewardsUseCase の依存 */
export interface AwardVisitRewardsDeps extends VisitContextDeps {
  /** ポイント台帳（追記専用） */
  readonly ledgers: PointLedgerRepository;
  /** 報酬イベントの発行先 */
  readonly events: Pick<EventBus, 'publish'>;
  /** イベントのメタ情報を付ける工場（container で共有） */
  readonly eventFactory: EventFactory;
}

/** 訪問の報酬を付けるハンドラ */
export class AwardVisitRewardsUseCase {
  /**
   * ハンドラを作る。
   * @param deps セッション・旅人・台帳リポジトリ・マスタ参照・イベントバス・イベント工場
   */
  constructor(private readonly deps: AwardVisitRewardsDeps) {}

  /**
   * SpotVisited を受け、加点を台帳に追記して報酬イベントを発行する。加点済みの訪問なら何もしない（冪等＝DI-07）。
   * @param event SpotVisited
   * @returns 成功: void。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED／CONFLICT（台帳の保存）／INVALID_INPUT／SPOT_NOT_FOUND／DISTRICT_NOT_FOUND
   * @sideEffect PointLedgerRepository.save（訪問行・ボーナス行の追記）。EventBus.publish（PointsAwarded・WelcomeBackBonusGranted・CardAwarded・ItemAcquired）
   * @see docs/08 §4.2, D6, D11, D16、docs/06 DI-06, DI-07, DI-10, DI-12
   */
  async handle(event: SpotVisited): Promise<Result<void>> {
    const log = logger.fn('handle', { eventId: event.eventId, spotId: event.spotId, operationId: event.operationId });
    const first = await this.award(event);
    if (first.ok || first.error.code !== 'CONFLICT') return first.ok ? log.exit(first) : log.fail(first);
    // 台帳の保存が競合したら、読み直して1回だけやり直す（訪問だけ残って加点が抜けるのを防ぐ。加点済みなら何もしない＝DI-07）
    log.warn('台帳の保存が競合したので読み直して1回だけやり直す', { operationId: event.operationId });
    const second = await this.award(event);
    return second.ok ? log.exit(second) : log.fail(second);
  }

  /**
   * 1回分の加点（読込 → 計算 → 台帳の保存 → イベント発行）。
   * @param event SpotVisited
   * @returns 成功: void。失敗: handle と同じ
   * @sideEffect PointLedgerRepository.save、EventBus.publish
   */
  private async award(event: SpotVisited): Promise<Result<void>> {
    const log = logger.fn('award', { eventId: event.eventId, operationId: event.operationId });
    const context = await loadVisitContext(this.deps, event);
    if (!context.ok) return log.fail(context);
    const { traveler, record, spot } = context.value;
    const ledger = await this.deps.ledgers.find(traveler.id);
    if (!ledger.ok) return log.fail(ledger);
    if (ledger.value.hasEntry(ledgerEntryIdOf(record.operationId, 'visit'))) return log.exit(okVoid(), '加点済みの訪問');
    const reward = rewardFor({ spot, visitsBefore: context.value.visitsBefore, today: record.localDate });
    const entries = visitLedgerEntriesOf(record, reward);
    if (!entries.ok) return log.fail(entries);
    const appended = ledger.value.append(entries.value);
    if (!appended.ok) return log.fail(appended);
    const saved = await this.deps.ledgers.save(appended.value, ledger.value.version);
    if (!saved.ok) return log.fail(saved);
    const events = this.rewardEvents(context.value, reward);
    await this.deps.events.publish(events);
    log.info('訪問の報酬', { basePoints: reward.basePoints, bonusPoints: reward.bonusPoints, balance: saved.value.balance(), events: events.map((e) => e.type) });
    return log.exit(okVoid());
  }

  /**
   * 発行する報酬イベントを作る（ポイント → おかえり → カード → アイテムの順）。
   * おかえり（WelcomeBackBonusGranted）は地区が復活した訪問のときだけ出す（同じ日の2回目以降は倍率だけ効いてイベントは出ない）。
   * @param context 訪問の前後
   * @param reward その訪問の加点
   * @returns 発行するイベント
   * @sideEffect EventFactory の sequence を進める
   */
  private rewardEvents(context: VisitContext, reward: VisitReward): DomainEvent[] {
    const log = logger.fn('rewardEvents', { districtId: context.district.id, bonusPoints: reward.bonusPoints });
    const { traveler, record } = context;
    const factory = this.deps.eventFactory;
    const events: DomainEvent[] = [
      factory.create(traveler.id, {
        type: 'PointsAwarded', districtId: record.districtId, spotId: record.spotId,
        basePoints: reward.basePoints, bonusPoints: reward.bonusPoints, operationId: record.operationId,
      }),
    ];
    const revived = isRevival({ visitsBefore: context.visitsBefore, districtId: record.districtId, today: record.localDate }).revived;
    if (revived && reward.bonusPoints > 0) {
      events.push(factory.create(traveler.id, { type: 'WelcomeBackBonusGranted', districtId: record.districtId, multiplier: reward.multiplier, bonusPoints: reward.bonusPoints }));
    }
    return log.exit([...events, ...this.cardEvents(context), ...this.itemEvents(context)]);
  }

  /**
   * 訪問の前後で新しく獲得したカードのイベントを作る（銀＝3回、金＝10回または四季）。
   * @param context 訪問の前後
   * @returns CardAwarded（新しいカードが無ければ空）
   * @sideEffect EventFactory の sequence を進める
   */
  private cardEvents(context: VisitContext): DomainEvent[] {
    const log = logger.fn('cardEvents', { districtId: context.district.id });
    const districtId = context.district.id;
    const newly = newlyEarnedCards(cardsOf(context.visitsBefore, districtId), cardsOf(context.visitsAfter, districtId));
    const visitCount = visitsInDistrict(context.visitsAfter, districtId).length;
    const events = newly.map((card) =>
      this.deps.eventFactory.create(context.traveler.id, { type: 'CardAwarded', districtId, rank: card.rank, reason: card.reason, visitCount }),
    );
    return log.exit(events);
  }

  /**
   * 訪問の前後で新しく獲得したアイテムのイベントを作る（提灯・のぼり・松＝D16）。
   * @param context 訪問の前後
   * @returns ItemAcquired（新しいアイテムが無ければ空）
   * @sideEffect EventFactory の sequence を進める
   */
  private itemEvents(context: VisitContext): DomainEvent[] {
    const log = logger.fn('itemEvents', { visitsBefore: context.visitsBefore.length });
    const spots = this.deps.spots.allSpots();
    const shopEvents = this.deps.spots.allShopEvents();
    const before = itemsOf({ visits: context.visitsBefore, spots, shopEvents });
    const after = itemsOf({ visits: context.visitsAfter, spots, shopEvents });
    const events = newlyAcquiredItems(before, after).map((item) =>
      this.deps.eventFactory.create(context.traveler.id, { type: 'ItemAcquired', itemId: item.itemId, name: item.name }),
    );
    return log.exit(events);
  }
}
