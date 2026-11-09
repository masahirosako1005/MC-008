/**
 * @file デモの日付進行ユースケース（application 層・デモ専用）
 * DemoControl.advanceDays で日付をずらし（D13）、全地区の主を今日の時点で再判定する（docs/08 §4.4）。
 * 色あせ・再訪理由は表示のたびに訪問記録と今日から計算するので、ここでは保存しない（DI-05）。
 * isDemoBuild が false なら DEMO_DISABLED で拒否する（SEC-02）。呼び出しは warn ログで記録する（DI-20）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { AdvanceDateInput, AdvanceDateOutput } from '@/application/dto/Dto';
import type { DemoControl } from '@/application/ports/DemoControl';
import type { UpdateDistrictLordUseCase } from '@/application/usecases/competition/UpdateDistrictLordUseCase';
import { DEMO_ADVANCE_DAYS } from '@/application/usecases/demo/constants';
import { demoDisabled, isDemoEnabled } from '@/application/usecases/demo/demoGuard';
import type { DemoSwitch } from '@/application/usecases/demo/demoGuard';
import type { Clock } from '@/domain/ports/Clock';

const logger = createLogger('application/usecases/demo/AdvanceDateUseCase');

/** AdvanceDateUseCase の依存 */
export interface AdvanceDateDeps extends DemoSwitch {
  readonly clock: Clock;
  readonly demoControl: DemoControl;
  /** 進めた後に全地区の主を再判定する */
  readonly updateLords: Pick<UpdateDistrictLordUseCase, 'execute'>;
}

/** デモの日付進行 */
export class AdvanceDateUseCase implements UseCase<AdvanceDateInput, AdvanceDateOutput> {
  private readonly enabled: boolean;

  /**
   * ユースケースを作る。
   * @param deps 時計・デモ操作・主の再判定・有効フラグ（省略時 isDemoBuild）
   */
  constructor(private readonly deps: AdvanceDateDeps) {
    this.enabled = isDemoEnabled(deps);
  }

  /**
   * 日付を days 日進め、全地区の主を再判定する。
   * @param input 進める日数（1 / 30 / 90）
   * @returns 成功: 新しい今日とずらし日数。失敗: DEMO_DISABLED／INVALID_INPUT（日数が選択肢に無い）／STORAGE_FAILED（offset の保存）／
   *          主の再判定の失敗（TRAVELER_NOT_FOUND／STORAGE_FAILED／CONFLICT。日付は進んだまま）
   * @sideEffect DemoControl.advanceDays（デモ日付の offset を保存）。主が交代すれば LordshipRepository.save と DistrictLordChanged の発行
   * @see docs/08 §4.4, D13、docs/05 SEC-02、docs/06 DI-20
   */
  async execute(input: AdvanceDateInput): Promise<Result<AdvanceDateOutput>> {
    const log = logger.fn('execute', { days: input.days });
    log.warn('デモ操作: 日付進行', { days: input.days, enabled: this.enabled });
    if (!this.enabled) return log.fail(demoDisabled());
    if (!DEMO_ADVANCE_DAYS.includes(input.days)) {
      return log.fail(fail(AppError.of('INVALID_INPUT', '進める日数が正しくありません', { allowed: DEMO_ADVANCE_DAYS })));
    }
    const offset = this.deps.demoControl.advanceDays(input.days);
    if (!offset.ok) return log.fail(offset);
    const lords = await this.deps.updateLords.execute({});
    if (!lords.ok) return log.fail(lords, '日付は進んだが主の再判定に失敗');
    const output: AdvanceDateOutput = Object.freeze({ today: this.deps.clock.today(), dayOffset: offset.value });
    log.info('日付を進めた', { today: output.today, dayOffset: output.dayOffset, lordChanges: lords.value.changed.length });
    return log.exit(ok(output));
  }
}
