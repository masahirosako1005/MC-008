/**
 * @file デモの位置リセットユースケース（application 層・デモ専用）
 * デモ位置を開始地区（DEMO_START_DISTRICT_ID_TEXT＝南森町・天満宮地区）の入口へ戻す（docs/08 §4.4, §9.3）。位置はメモリのみで保存しない（PRV-03, D15）。
 * isDemoBuild が false なら DEMO_DISABLED で拒否する（SEC-02）。呼び出しは warn ログで記録する（DI-20）。座標はログに出さない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { PositionDto } from '@/application/dto/Dto';
import type { DemoControl } from '@/application/ports/DemoControl';
import { demoDisabled, isDemoEnabled } from '@/application/usecases/demo/demoGuard';
import type { DemoSwitch } from '@/application/usecases/demo/demoGuard';
import { demoPositionDtoOf, startDistrictOf } from '@/application/usecases/demo/demoPosition';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/demo/ResetPositionUseCase');

/** ResetPositionUseCase の依存 */
export interface ResetPositionDeps extends DemoSwitch {
  readonly spots: SpotRepository;
  readonly demoControl: DemoControl;
}

/** デモの位置リセット */
export class ResetPositionUseCase implements UseCase<void, PositionDto> {
  private readonly enabled: boolean;

  /**
   * ユースケースを作る。
   * @param deps マスタ参照・デモ操作・有効フラグ（省略時 isDemoBuild）
   */
  constructor(private readonly deps: ResetPositionDeps) {
    this.enabled = isDemoEnabled(deps);
  }

  /**
   * デモ位置を開始地区の入口へ戻す。
   * @returns 成功: 入口の位置（描画専用）。失敗: DEMO_DISABLED／DISTRICT_NOT_FOUND（開始地区が無い）
   * @sideEffect DemoControl.setPosition（メモリ上のデモ位置を変える）
   * @see docs/08 §4.4、docs/05 SEC-02、docs/06 DI-20
   */
  async execute(): Promise<Result<PositionDto>> {
    const log = logger.fn('execute');
    log.warn('デモ操作: 位置リセット', { enabled: this.enabled });
    if (!this.enabled) return log.fail(demoDisabled());
    const district = startDistrictOf(this.deps.spots);
    if (!district.ok) return log.fail(district);
    this.deps.demoControl.setPosition(district.value.entrance);
    return log.exit(ok(demoPositionDtoOf(district.value.entrance)), `${district.value.name}の入口へ移動`);
  }
}
