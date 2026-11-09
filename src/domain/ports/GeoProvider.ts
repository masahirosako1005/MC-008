/**
 * @file 位置ポート（domain/ports 層）
 * 実装: infrastructure/geo の BrowserGeoProvider（本番 GPS）/ DemoGeoProvider（地図タップ移動）。
 * 生座標は保存しない（PRV-03・SEC-13）。ログには距離や精度だけを出す。
 */
import type { AppError, Result } from '@/Common/result/Result';
import type { Instant } from '@/Common/utils/date';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';

/** 1回の測位結果 */
export interface GeoFix {
  readonly point: GeoPoint;
  /** 測位精度（メートル。小さいほど正確） */
  readonly accuracyM: number;
  /** 測位した瞬間 */
  readonly at: Instant;
}

/** 位置取得の失敗コード */
export type GeoErrorCode = 'GEO_UNAVAILABLE' | 'GEO_DENIED';

/** 現在地の供給元 */
export interface GeoProvider {
  /** 現在地を1回取得する。失敗時は GEO_UNAVAILABLE / GEO_DENIED（デモ位置に勝手に切り替えない＝SEC-27） */
  current(): Promise<Result<GeoFix, AppError<GeoErrorCode>>>;
}
