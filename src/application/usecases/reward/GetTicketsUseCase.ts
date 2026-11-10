/**
 * @file 獲得したチケットの一覧を返すユースケース（application 層・読取系）
 * チケット＝お店のクーポンを、その期間中にそのお店でクエスト達成すると獲得したもの（導出は tickets.ts）。
 * 旅人はセッションから解決する（入力に travelerId は無い＝SEC-01）。書込みはしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { TicketDto } from '@/application/dto/Dto';
import { ticketsOf } from '@/application/usecases/reward/tickets';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import type { WorldDeps } from '@/application/usecases/shared/World';

const logger = createLogger('application/usecases/reward/GetTicketsUseCase');

/** GetTicketsUseCase の依存 */
export type GetTicketsDeps = Pick<WorldDeps, 'session' | 'travelers' | 'spots' | 'clock'>;

/** 獲得したチケットの一覧 */
export class GetTicketsUseCase implements UseCase<void, readonly TicketDto[]> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人・マスタ・時計
   */
  constructor(private readonly deps: GetTicketsDeps) {}

  /**
   * チケットを、使える → 使用済みの順（使えるものは期限の近い順）に返す。期限切れは含めない。
   * @returns 成功: チケット（凍結済み）。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect セッション・旅人を読む（書かない）
   */
  async execute(): Promise<Result<readonly TicketDto[]>> {
    const log = logger.fn('execute');
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    const tickets = ticketsOf(traveler.value, this.deps.spots, this.deps.clock.today());
    return log.exit(ok(tickets), `${tickets.length} 枚`);
  }
}
