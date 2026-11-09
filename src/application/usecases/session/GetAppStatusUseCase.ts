/**
 * @file アプリ状態（今日・日付と時刻の表示・旅人のプロフィール・デモのずらし日数）を返すユースケース（application 層・読取系）
 * ステータスバーとデモメニューが使う。旅人はセッションから解決する（SEC-01）。書込みはしない。
 * デモ操作（DemoControl）は isDemoBuild のときだけ container が渡す（SEC-02）。渡されたときだけ isDemo=true・dayOffset を返す。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { formatJpDate, formatJpTime, localDateOf } from '@/Common/utils/date';
import type { UseCase } from '@/application/AppServices';
import type { AppStatusDto } from '@/application/dto/Dto';
import type { DemoControl } from '@/application/ports/DemoControl';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import type { Clock } from '@/domain/ports/Clock';

const logger = createLogger('application/usecases/session/GetAppStatusUseCase');

/** GetAppStatusUseCase の依存 */
export interface GetAppStatusDeps {
  readonly session: SessionRepository;
  readonly travelers: TravelerRepository;
  readonly clock: Clock;
  /** デモ操作（デモビルドのときだけ container が渡す。あれば isDemo=true・dayOffset を返す） */
  readonly demoControl?: DemoControl;
}

/** アプリ状態を返す */
export class GetAppStatusUseCase implements UseCase<void, AppStatusDto> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人リポジトリ・時計・デモ操作（任意）
   */
  constructor(private readonly deps: GetAppStatusDeps) {}

  /**
   * アプリ状態を返す。今日と時刻は同じ瞬間（Clock.now() 1回）から作り、日付の境目で食い違わないようにする（DI-04）。
   * @returns 成功: AppStatusDto。失敗: TRAVELER_NOT_FOUND（セッションに旅人が無い・未保存）／STORAGE_FAILED（読込失敗）
   * @sideEffect SessionRepository.load・TravelerRepository.findById・Clock.now・DemoControl.offsetDays を呼ぶ（読むだけ）
   */
  async execute(): Promise<Result<AppStatusDto>> {
    const log = logger.fn('execute', { isDemo: this.deps.demoControl !== undefined });
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    const now = this.deps.clock.now();
    const today = localDateOf(now);
    const demoControl = this.deps.demoControl;
    const dto: AppStatusDto = Object.freeze({
      today,
      dateLabel: formatJpDate(today),
      timeLabel: formatJpTime(now),
      isDemo: demoControl !== undefined,
      travelerProfile: traveler.value.profile,
      ...(demoControl === undefined ? {} : { dayOffset: demoControl.offsetDays() }),
    });
    log.debug('状態', { today, profile: dto.travelerProfile, dayOffset: dto.dayOffset });
    return log.exit(ok(dto));
  }
}
