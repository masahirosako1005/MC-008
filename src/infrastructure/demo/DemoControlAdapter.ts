/**
 * @file デモ操作のアダプタ（infrastructure/demo 層。application の DemoControl の実装）
 * 日付進行は DemoClock、地図タップ移動・位置リセットは DemoGeoProvider を操作する。
 * container は isDemoBuild のときだけこれを渡す。さらにここでも enabled=false なら操作を拒否する（SEC-02 の多重防御）。
 * デモ操作は warn ログで記録する（DI-20）。位置はメモリのみで保存しない（PRV-03）。
 */
import { isDemoBuild } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { DemoControl } from '@/application/ports/DemoControl';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { DemoGeoProvider } from '@/infrastructure/geo/DemoGeoProvider';
import type { DemoClock } from '@/infrastructure/time/DemoClock';

const logger = createLogger('infrastructure/demo/DemoControlAdapter');

/** DemoControlAdapter の依存 */
export interface DemoControlAdapterDeps {
  readonly clock: DemoClock;
  readonly geo: DemoGeoProvider;
  /** デモ操作を許可するか（省略時は isDemoBuild。本番ビルドでは false＝SEC-02） */
  readonly enabled?: boolean;
}

/**
 * デモ操作が無効なときの失敗を作る。
 * @returns DEMO_DISABLED の失敗
 */
function demoDisabled(): Result<never> {
  return fail(AppError.of('DEMO_DISABLED', 'この操作はデモ版でのみ使えます'));
}

/** デモ操作のアダプタ */
export class DemoControlAdapter implements DemoControl {
  private readonly enabled: boolean;

  /**
   * アダプタを作る。
   * @param deps DemoClock・DemoGeoProvider・有効フラグ
   */
  constructor(private readonly deps: DemoControlAdapterDeps) {
    this.enabled = deps.enabled ?? isDemoBuild;
  }

  /**
   * 実時刻からのずらし日数を返す。
   * @returns offset（日）
   */
  offsetDays(): number {
    const log = logger.fn('offsetDays');
    return log.exit(this.deps.clock.offsetDays());
  }

  /**
   * 日付を days 日進める。
   * @param days 進める日数（1 以上の整数）
   * @returns 成功: 新しい offset。失敗: DEMO_DISABLED / INVALID_INPUT / STORAGE_FAILED
   * @sideEffect デモ日付の offset を保存する
   */
  advanceDays(days: number): Result<number> {
    const log = logger.fn('advanceDays', { days });
    if (!this.enabled) {
      log.warn('デモ操作が無効なビルドで日付進行が呼ばれました', { days });
      return log.fail(demoDisabled());
    }
    const advanced = this.deps.clock.advanceDays(days);
    return advanced.ok ? log.exit(advanced) : log.fail(advanced);
  }

  /**
   * ずらし日数を 0 に戻す。
   * @returns 成功: void。失敗: DEMO_DISABLED / STORAGE_FAILED
   * @sideEffect デモ日付の offset を消す
   */
  resetOffset(): Result<void> {
    const log = logger.fn('resetOffset');
    if (!this.enabled) {
      log.warn('デモ操作が無効なビルドで日付リセットが呼ばれました');
      return log.fail(demoDisabled());
    }
    const reset = this.deps.clock.resetOffset();
    return reset.ok ? log.exit(reset) : log.fail(reset);
  }

  /**
   * デモ位置を設定する（無効なビルドでは何もしない）。座標はログに出さない。
   * @param point 検証済みの位置
   * @sideEffect DemoGeoProvider の位置を更新する
   */
  setPosition(point: GeoPoint): void {
    const log = logger.fn('setPosition');
    if (!this.enabled) {
      log.warn('デモ操作が無効なビルドで位置設定が呼ばれました');
      log.exit(undefined, 'ignored');
      return;
    }
    this.deps.geo.setPosition(point);
    log.exit(undefined);
  }
}
