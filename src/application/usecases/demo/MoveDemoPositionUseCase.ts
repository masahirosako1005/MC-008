/**
 * @file デモ位置の移動ユースケース（application 層・デモ専用）
 * 地図タップ・歩行でデモ位置を動かす（docs/08 §4.4）。緯度経度は GeoPoint.of で検証し、市域（cityBounds）の外は受け付けない（DI-01, DI-14）。
 * 位置はメモリのみで保存しない（PRV-03, D15）。isDemoBuild が false なら DEMO_DISABLED（SEC-02）。
 * 歩行で何度も呼ばれるため、warn ログには座標を出さず操作名だけを残す（DI-20, LG-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { MoveDemoPositionInput, PositionDto } from '@/application/dto/Dto';
import type { DemoControl } from '@/application/ports/DemoControl';
import { demoDisabled, isDemoEnabled } from '@/application/usecases/demo/demoGuard';
import type { DemoSwitch } from '@/application/usecases/demo/demoGuard';
import { demoPositionDtoOf, isWithinBounds } from '@/application/usecases/demo/demoPosition';
import { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/demo/MoveDemoPositionUseCase');

/** MoveDemoPositionUseCase の依存 */
export interface MoveDemoPositionDeps extends DemoSwitch {
  readonly spots: SpotRepository;
  readonly demoControl: DemoControl;
}

/** デモ位置の移動 */
export class MoveDemoPositionUseCase implements UseCase<MoveDemoPositionInput, PositionDto> {
  private readonly enabled: boolean;

  /**
   * ユースケースを作る。
   * @param deps マスタ参照（市域）・デモ操作・有効フラグ（省略時 isDemoBuild）
   */
  constructor(private readonly deps: MoveDemoPositionDeps) {
    this.enabled = isDemoEnabled(deps);
  }

  /**
   * デモ位置を指定の緯度経度へ動かす。
   * @param input 緯度・経度（度）
   * @returns 成功: 新しい位置（描画専用）。失敗: DEMO_DISABLED／INVALID_INPUT（数値でない・範囲外・市域の外）
   * @sideEffect DemoControl.setPosition（メモリ上のデモ位置を変える）
   * @see docs/08 §4.4, D15、docs/05 SEC-02、docs/06 DI-01, DI-20
   */
  async execute(input: MoveDemoPositionInput): Promise<Result<PositionDto>> {
    const log = logger.fn('execute');
    log.warn('デモ操作: 位置移動', { enabled: this.enabled });
    if (!this.enabled) return log.fail(demoDisabled());
    const point = GeoPoint.of(input.lat, input.lng);
    if (!point.ok) return log.fail(point);
    if (!isWithinBounds(point.value, this.deps.spots.cityBounds())) {
      return log.fail(fail(AppError.of('INVALID_INPUT', '市の外には移動できません', { kind: 'MoveDemoPosition', rule: 'outOfCity' })));
    }
    this.deps.demoControl.setPosition(point.value);
    return log.exit(ok(demoPositionDtoOf(point.value)), '移動');
  }
}
