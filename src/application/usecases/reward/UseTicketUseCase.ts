/**
 * @file チケットを使う（使用済みにする）ユースケース（application 層・書込み系）
 * お店の人に QR を見せたあと「使う」で、クーポン利用記録（Traveler.redeem）を旅人に追記する。
 * 流れ: 入力検証（parseOperationId・parseShopEventId＝DI-01）→ クーポン → 旅人（セッションから解決＝SEC-01）→ 獲得済みか
 *       → 現在地と距離（お店から VISIT_RADIUS_M 以内）→ Traveler.redeem（クーポンか・期間内・利用済み・距離）→ 保存は最後に1回（楽観ロック＝DI-10）。
 * 同じ operationId の再実行は何も変えず duplicate=true を返す（DI-07）。保存が競合したら1回だけ読み直してやり直す。座標はログに出さない（LG-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseOperationId, parseShopEventId } from '@/Common/types/Id';
import type { OperationId } from '@/Common/types/Id';
import { localDateOf } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import type { UseCase } from '@/application/AppServices';
import type { UseTicketInput, UseTicketOutput } from '@/application/dto/Dto';
import { earnedOnOf } from '@/application/usecases/reward/tickets';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import type { WorldDeps } from '@/application/usecases/shared/World';
import { Distance } from '@/domain/exploration/Distance';
import type { RedeemInput, Traveler } from '@/domain/exploration/Traveler';
import type { GeoProvider } from '@/domain/ports/GeoProvider';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';

const logger = createLogger('application/usecases/reward/UseTicketUseCase');

/** UseTicketUseCase の依存 */
export type UseTicketDeps = Pick<WorldDeps, 'session' | 'travelers' | 'spots' | 'clock'> & { readonly geo: GeoProvider };

/** 持っていないチケットの失敗コード */
export const TICKET_NOT_FOUND = 'TICKET_NOT_FOUND';

/**
 * 持っていない（無い・まだ獲得していない）チケットの失敗を作る。
 * @returns TICKET_NOT_FOUND の失敗
 */
function notFound(): Result<never> {
  return fail(AppError.of(TICKET_NOT_FOUND, 'このチケットは持っていません'));
}

/**
 * 処理済みの操作なら、その時の利用記録から duplicate=true の出力を返す。
 * @param traveler 旅人
 * @param event クーポン
 * @param operationId 操作ID
 * @returns 処理済みの利用なら出力。未処理なら undefined
 */
function replayOf(traveler: Traveler, event: ShopEvent, operationId: OperationId): UseTicketOutput | undefined {
  const log = logger.fn('replayOf', { operationId });
  if (!traveler.hasProcessed(operationId)) return log.exit(undefined);
  const record = traveler.redemptions.find((r) => r.operationId === operationId && r.shopEventId === event.id);
  return log.exit(record === undefined ? undefined : Object.freeze({ ticketId: event.id, usedOn: localDateOf(record.redeemedAt), duplicate: true }));
}

/** チケットを使う */
export class UseTicketUseCase implements UseCase<UseTicketInput, UseTicketOutput> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人・マスタ・時計・位置
   */
  constructor(private readonly deps: UseTicketDeps) {}

  /**
   * チケットを使用済みにする。
   * @param input operationId（UUID）と ticketId（クーポンID）
   * @returns 成功: 使った日と duplicate。失敗: INVALID_INPUT／TICKET_NOT_FOUND／TRAVELER_NOT_FOUND／GEO_UNAVAILABLE／GEO_DENIED／
   *          OUT_OF_RANGE（お店から遠い）／EXPIRED／ALREADY_REDEEMED／CONFLICT／STORAGE_FAILED
   * @sideEffect GeoProvider.current、TravelerRepository.save を1回（競合時は読み直して最大2回）
   * @see docs/06_data_integrity_checklist.md DI-01, DI-07, DI-10
   */
  async execute(input: UseTicketInput): Promise<Result<UseTicketOutput>> {
    const log = logger.fn('execute');
    const record: Readonly<Record<string, unknown>> = isRecord(input) ? input : {};
    const operationId = parseOperationId(record['operationId']);
    if (!operationId.ok) return log.fail(operationId, 'operationId が不正');
    const ticketId = parseShopEventId(record['ticketId']);
    if (!ticketId.ok) return log.fail(ticketId, 'ticketId が不正');
    const event = this.deps.spots.allShopEvents().find((e) => e.id === ticketId.value);
    const spot = event === undefined ? undefined : this.deps.spots.findSpot(event.spotId);
    if (event === undefined || spot === undefined) return log.fail(notFound(), 'クーポンが無い');
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    const replay = replayOf(traveler.value, event, operationId.value);
    if (replay !== undefined) return log.exit(ok(replay), '処理済みの操作');
    if (earnedOnOf(traveler.value, event) === undefined) return log.fail(notFound(), 'まだ獲得していない');
    const fix = await this.deps.geo.current();
    if (!fix.ok) return log.fail(fix, '位置を取得できない');
    const at = this.deps.clock.now();
    const redeem: RedeemInput = Object.freeze({ shopEvent: event, meters: Distance.between(fix.value.point, spot.point).meters, at, localDate: localDateOf(at), operationId: operationId.value });
    const result = await this.commitWithRetry(traveler.value, redeem);
    if (!result.ok) return log.fail(result);
    log.info('チケットを使った', { ticketId: event.id, duplicate: result.value.duplicate });
    return log.exit(result);
  }

  /**
   * 利用を記録して保存する。保存が競合（CONFLICT）したら旅人を読み直して1回だけやり直す（並行した二重送信なら duplicate=true になる）。
   * @param traveler 読み込んだ旅人
   * @param redeem Traveler.redeem の入力
   * @returns 成功: 出力。失敗: OUT_OF_RANGE／EXPIRED／ALREADY_REDEEMED／NOT_COUPON／CONFLICT／STORAGE_FAILED
   * @sideEffect TravelerRepository.save・findById
   */
  private async commitWithRetry(traveler: Traveler, redeem: RedeemInput): Promise<Result<UseTicketOutput>> {
    const log = logger.fn('commitWithRetry', { travelerId: traveler.id, version: traveler.version });
    const first = await this.commit(traveler, redeem);
    if (first.ok || first.error.code !== 'CONFLICT') return first.ok ? log.exit(first) : log.fail(first);
    const reloaded = await this.deps.travelers.findById(traveler.id);
    if (!reloaded.ok) return log.fail(reloaded);
    if (reloaded.value === undefined) return log.fail(first, '読み直したら旅人が無い');
    const second = await this.commit(reloaded.value, redeem);
    return second.ok ? log.exit(second) : log.fail(second);
  }

  /**
   * Traveler.redeem で判定・記録し、新しい利用なら保存する。
   * @param traveler 旅人（この版数で楽観ロック）
   * @param redeem Traveler.redeem の入力
   * @returns 成功: 出力（処理済みなら duplicate=true で保存しない）。失敗: redeem の拒否理由／CONFLICT／STORAGE_FAILED
   * @sideEffect 新しい利用なら TravelerRepository.save を1回呼ぶ
   */
  private async commit(traveler: Traveler, redeem: RedeemInput): Promise<Result<UseTicketOutput>> {
    const log = logger.fn('commit', { travelerId: traveler.id, ticketId: redeem.shopEvent.id });
    const outcome = traveler.redeem(redeem);
    if (!outcome.ok) return log.fail(outcome);
    const output: UseTicketOutput = Object.freeze({ ticketId: redeem.shopEvent.id, usedOn: redeem.localDate, duplicate: outcome.value.duplicate });
    if (outcome.value.duplicate) return log.exit(ok(output), '処理済みの操作');
    const saved = await this.deps.travelers.save(outcome.value.traveler, traveler.version);
    if (!saved.ok) return log.fail(saved);
    return log.exit(ok(output));
  }
}
