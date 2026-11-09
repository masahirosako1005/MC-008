/**
 * @file デモ用の位置（infrastructure/geo 層。GeoProvider のデモ実装）
 * 地図タップ・歩行・位置リセットで setPosition された位置を返す。位置はメモリのみで保存しない（PRV-03, SEC-13, docs/08 D15）。
 * 座標はログに出さない（ロガーが lat/lng をマスクするうえ、ここでは有無だけを記録する）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { Clock } from '@/domain/ports/Clock';
import type { GeoErrorCode, GeoFix, GeoProvider } from '@/domain/ports/GeoProvider';

const logger = createLogger('infrastructure/geo/DemoGeoProvider');

/** デモ位置の測位精度（メートル。地図タップの位置をそのまま使うので十分小さい値） */
export const DEMO_ACCURACY_M = 5;

/** デモ用の位置 */
export class DemoGeoProvider implements GeoProvider {
  private position: GeoPoint | undefined;

  /**
   * 位置を作る（最初は未設定。container が開始地区＝南森町・天満宮地区の入口などへ setPosition する）。
   * @param clock 測位時刻に使う時計
   */
  constructor(private readonly clock: Clock) {}

  /**
   * デモ位置を設定する（検証済みの GeoPoint を渡す）。
   * @param point 新しい位置
   * @sideEffect メモリ上の位置を更新する
   */
  setPosition(point: GeoPoint): void {
    const log = logger.fn('setPosition');
    this.position = point;
    log.exit(undefined);
  }

  /**
   * デモ位置を未設定に戻す。
   * @sideEffect メモリ上の位置を消す
   */
  clearPosition(): void {
    const log = logger.fn('clearPosition');
    this.position = undefined;
    log.exit(undefined);
  }

  /**
   * 現在のデモ位置を返す。
   * @returns 成功: 位置・精度 DEMO_ACCURACY_M・時計の現在時刻。失敗: GEO_UNAVAILABLE（未設定）
   */
  async current(): Promise<Result<GeoFix, AppError<GeoErrorCode>>> {
    const log = logger.fn('current', { hasPosition: this.position !== undefined });
    if (this.position === undefined) {
      return log.fail(fail(AppError.of('GEO_UNAVAILABLE', '現在地がまだ決まっていません')));
    }
    return log.exit(ok({ point: this.position, accuracyM: DEMO_ACCURACY_M, at: this.clock.now() }));
  }
}
