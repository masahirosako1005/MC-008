/**
 * @file デモ操作のポート（application 層）
 * DemoClock（日付進行）と DemoGeoProvider（地図タップ移動）を操作する。isDemoBuild のときだけ container が実装を渡す（SEC-02）。
 * 位置はメモリのみで保存しない（PRV-03, docs/08 D15）。
 */
import type { Result } from '@/Common/result/Result';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';

/** デモ操作 */
export interface DemoControl {
  /** 実時刻からのずらし日数 */
  offsetDays(): number;
  /** 日付を days 日進める。戻り値は新しい offset */
  advanceDays(days: number): Result<number>;
  /** ずらし日数を 0 に戻す */
  resetOffset(): Result<void>;
  /** デモ位置を設定する（地図タップ・位置リセット） */
  setPosition(point: GeoPoint): void;
}
