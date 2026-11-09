/**
 * @file 訪問による地区の変化（成長段階の上昇・色あせからの復活）を判定して通知するイベントハンドラ（application 層）
 * docs/08 §4.2 の1番目: SpotVisited → DistrictRevived（訪問前に色あせ中だった＝D6）／DistrictGrown（Lv 上昇＝D3）。
 * 成長・復活は追記専用の訪問記録から導出するので保存しない（D4, DI-05）。日付は訪問記録の暦日で判定する（後から再実行しても同じ結果）。
 * 同じ訪問（operationId）について2回呼ばれても、イベントは1回しか出さない（DI-07, DI-19）。
 */
import { createLogger } from '@/Common/logging/logger';
import { okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { EventBus } from '@/application/events/EventBus';
import type { EventFactory } from '@/application/events/EventFactory';
import { loadVisitContext } from '@/application/usecases/shared/VisitContext';
import type { VisitContext, VisitContextDeps } from '@/application/usecases/shared/VisitContext';
import type { DomainEvent, SpotVisited } from '@/domain/events/DomainEvent';
import { isRevival } from '@/domain/reward/VisitRewardPolicy';
import { districtStatusOf } from '@/domain/town/DistrictStatus';

const logger = createLogger('application/usecases/town/EvaluateDistrictChangeUseCase');

/** 処理済みとして覚えておく訪問の最大件数（メモリのみ。古いものから忘れる） */
const MAX_HANDLED_VISITS = 500;

/** EvaluateDistrictChangeUseCase の依存 */
export interface EvaluateDistrictChangeDeps extends VisitContextDeps {
  /** DistrictRevived / DistrictGrown の発行先 */
  readonly events: Pick<EventBus, 'publish'>;
  /** イベントのメタ情報を付ける工場（container で共有） */
  readonly eventFactory: EventFactory;
}

/** 訪問による地区の変化を判定するハンドラ */
export class EvaluateDistrictChangeUseCase {
  /** 処理済みの訪問（旅人ID:操作ID）。挿入順に古いものから忘れる */
  private readonly handled = new Set<string>();

  /**
   * ハンドラを作る。
   * @param deps セッション・旅人リポジトリ・マスタ参照・イベントバス・イベント工場
   */
  constructor(private readonly deps: EvaluateDistrictChangeDeps) {}

  /**
   * SpotVisited を受け、訪問の前後で地区の成長段階と色あせを比べてイベントを発行する。
   * - 訪問前の同地区の最終訪問から見て色あせ中なら DistrictRevived（level は訪問後の段階。同じ日の2回目以降は出ない）
   * - 成長段階が上がれば DistrictGrown（from → to）
   * @param event SpotVisited
   * @returns 成功: void（変化が無ければ何も発行しない）。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED／INVALID_INPUT／SPOT_NOT_FOUND／DISTRICT_NOT_FOUND
   * @sideEffect EventBus.publish（DistrictRevived・DistrictGrown）。処理済みの訪問をメモリに覚える
   * @see docs/08 §4.2, D3, D6
   */
  async handle(event: SpotVisited): Promise<Result<void>> {
    const log = logger.fn('handle', { eventId: event.eventId, districtId: event.districtId, operationId: event.operationId });
    const key = `${event.travelerId}:${event.operationId}`;
    if (this.handled.has(key)) return log.exit(okVoid(), '処理済みの訪問');
    const context = await loadVisitContext(this.deps, event);
    if (!context.ok) return log.fail(context);
    const changes = this.changesOf(context.value);
    this.remember(key);
    if (changes.length > 0) await this.deps.events.publish(changes);
    log.info('地区の変化を判定', { districtId: context.value.district.id, events: changes.map((e) => e.type) });
    return log.exit(okVoid());
  }

  /**
   * 訪問の前後を比べ、発行するイベントを作る（復活 → 成長の順）。
   * @param context 訪問の前後
   * @returns 発行するイベント（変化が無ければ空）
   * @sideEffect EventFactory の sequence を進める
   */
  private changesOf(context: VisitContext): DomainEvent[] {
    const log = logger.fn('changesOf', { districtId: context.district.id, visitsBefore: context.visitsBefore.length });
    const { district, record, traveler } = context;
    const today = record.localDate;
    const before = districtStatusOf({ district, visits: context.visitsBefore, today });
    const after = districtStatusOf({ district, visits: context.visitsAfter, today });
    const revival = isRevival({ visitsBefore: context.visitsBefore, districtId: district.id, today });
    const events: DomainEvent[] = [];
    if (revival.revived) {
      const daysSinceLastVisit = revival.daysSinceLastVisit ?? 0;
      events.push(this.deps.eventFactory.create(traveler.id, { type: 'DistrictRevived', districtId: district.id, daysSinceLastVisit, level: after.level }));
    }
    if (after.level > before.level) {
      events.push(this.deps.eventFactory.create(traveler.id, { type: 'DistrictGrown', districtId: district.id, from: before.level, to: after.level }));
    }
    log.debug('判定', { from: before.level, to: after.level, revived: revival.revived, daysSinceLastVisit: revival.daysSinceLastVisit });
    return log.exit(events);
  }

  /**
   * 処理済みの訪問を覚える（MAX_HANDLED_VISITS を超えたら古いものから忘れる）。
   * @param key 旅人ID:操作ID
   * @sideEffect メモリ上の処理済み集合を更新する
   */
  private remember(key: string): void {
    const log = logger.fn('remember', { size: this.handled.size });
    this.handled.add(key);
    const oldest = this.handled.values().next();
    if (this.handled.size > MAX_HANDLED_VISITS && oldest.done !== true) this.handled.delete(oldest.value);
    log.exit(undefined);
  }
}
