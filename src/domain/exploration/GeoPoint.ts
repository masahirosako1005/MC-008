/**
 * @file 緯度経度の値オブジェクト（domain/exploration 層）
 * GeoPoint.of で範囲を検証してから作る（DI-02）。座標はログに出さない（ロガーが lat/lng をマスクする＝LG-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';

const logger = createLogger('domain/exploration/GeoPoint');

/** 緯度経度（度）。緯度 −90〜90、経度 −180〜180 の有限数 */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** 緯度経度の矩形範囲（地図のズーム合わせ・市域） */
export interface GeoBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/**
 * 緯度として正しいか判定する。
 * @param lat 緯度（度）
 * @returns −90〜90 の有限数なら true
 */
function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

/**
 * 経度として正しいか判定する。
 * @param lng 経度（度）
 * @returns −180〜180 の有限数なら true
 */
function isValidLongitude(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

/** GeoPoint のファクトリと比較関数（interface と同名の値） */
export const GeoPoint = {
  /**
   * 緯度経度を検証して GeoPoint を作る。
   * @param lat 緯度（度、−90〜90）
   * @param lng 経度（度、−180〜180）
   * @returns 成功: 凍結済み GeoPoint。失敗: INVALID_INPUT（非数・範囲外）
   */
  of(lat: number, lng: number): Result<GeoPoint> {
    const log = logger.fn('of');
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isValidLatitude(lat) || !isValidLongitude(lng)) {
      return log.fail(fail(AppError.of('INVALID_INPUT', '位置の値が正しくありません', { kind: 'GeoPoint' })));
    }
    return log.exit(ok(Object.freeze({ lat, lng })));
  },

  /**
   * 未検証の値（JSON など）から GeoPoint を作る。{ lat: number, lng: number } の形だけを受け付ける。
   * @param raw 未検証の値
   * @returns 成功: GeoPoint。失敗: INVALID_INPUT
   */
  fromUnknown(raw: unknown): Result<GeoPoint> {
    const log = logger.fn('fromUnknown');
    if (typeof raw !== 'object' || raw === null) {
      return log.fail(fail(AppError.of('INVALID_INPUT', '位置の値が正しくありません', { kind: 'GeoPoint' })));
    }
    const candidate = raw as { lat?: unknown; lng?: unknown };
    const lat = typeof candidate.lat === 'number' ? candidate.lat : Number.NaN;
    const lng = typeof candidate.lng === 'number' ? candidate.lng : Number.NaN;
    return log.exit(GeoPoint.of(lat, lng));
  },

  /**
   * 2点が同じ位置か判定する。
   * @param a 1点目
   * @param b 2点目
   * @returns 緯度・経度とも等しければ true
   */
  equals(a: GeoPoint, b: GeoPoint): boolean {
    return a.lat === b.lat && a.lng === b.lng;
  },
};

/**
 * 点の集合を囲む矩形を返す（地区ポリゴンに地図を合わせる・市域の算出）。
 * @param points 点の集合
 * @returns 矩形。点が無ければ undefined
 */
export function boundsOf(points: readonly GeoPoint[]): GeoBounds | undefined {
  const log = logger.fn('boundsOf', { count: points.length });
  if (points.length === 0) return log.exit(undefined);
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return log.exit({ south: Math.min(...lats), west: Math.min(...lngs), north: Math.max(...lats), east: Math.max(...lngs) });
}
