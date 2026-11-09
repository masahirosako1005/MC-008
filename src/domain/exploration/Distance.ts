/**
 * @file 2点間の距離の値オブジェクト（domain/exploration 層）
 * 市内（数 km 以内）の距離なので正距円筒近似で十分（docs/08 §3.3）。判定は m 単位の整数で行う（DI-18）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { roundToInt } from '@/Common/utils/number';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';

const logger = createLogger('domain/exploration/Distance');

/** 地球の平均半径（メートル。IUGG の平均半径 R1。物理定数なので（仮）ではない） */
export const EARTH_MEAN_RADIUS_M = 6_371_008.8;

/** 度→ラジアン */
const DEG_TO_RAD = Math.PI / 180;

/** 距離（メートル、0 以上の整数） */
export interface Distance {
  readonly meters: number;
}

/**
 * 2点間の距離を正距円筒近似で求める（丸める前の実数）。
 * 地図の再描画・近傍探索で多数回呼ばれるためログは出さない（呼び出し側でまとめて記録）。
 * @param a 1点目
 * @param b 2点目
 * @returns 距離（メートル、実数）
 */
export function rawMetersBetween(a: GeoPoint, b: GeoPoint): number { // audit-ignore: fnlog-missing 純粋な算術ヘルパー（近傍探索・描画で多数回呼ばれる）
  const meanLat = ((a.lat + b.lat) / 2) * DEG_TO_RAD;
  const x = (b.lng - a.lng) * DEG_TO_RAD * Math.cos(meanLat);
  const y = (b.lat - a.lat) * DEG_TO_RAD;
  return Math.sqrt(x * x + y * y) * EARTH_MEAN_RADIUS_M;
}

/** Distance のファクトリ（interface と同名の値） */
export const Distance = {
  /**
   * 2点間の距離を m 単位の整数で返す（DI-18）。
   * @param a 1点目
   * @param b 2点目
   * @returns 凍結済み Distance（meters は四捨五入した整数）
   */
  between(a: GeoPoint, b: GeoPoint): Distance {
    return Object.freeze({ meters: roundToInt(rawMetersBetween(a, b)) });
  },

  /**
   * メートル数から Distance を作る（0 以上の有限数。整数に丸める）。
   * @param meters メートル数
   * @returns 成功: Distance。失敗: INVALID_INPUT（負・非数）
   */
  ofMeters(meters: number): Result<Distance> {
    const log = logger.fn('ofMeters', { meters });
    if (!Number.isFinite(meters) || meters < 0) {
      return log.fail(fail(AppError.of('INVALID_INPUT', '距離の値が正しくありません', { kind: 'Distance' })));
    }
    return log.exit(ok(Object.freeze({ meters: roundToInt(meters) })));
  },
};
