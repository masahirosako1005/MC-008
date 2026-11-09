/**
 * @file デモ位置の共通処理（application 層）
 * 位置リセット・旅人切替で戻る「開始地区（DEMO_START_DISTRICT_ID_TEXT＝南森町・天満宮地区）の入口」の解決と、PositionDto への変換・市域の内外判定を持つ。
 * 地区名などの文言はマスタの地区から取る（ID 以外をここに書かない）。
 * 位置はメモリのみで保存しない（PRV-03, docs/08 D15）。座標はログに出さない（LG-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId } from '@/Common/types/Id';
import type { PositionDto } from '@/application/dto/Dto';
import { DEMO_POSITION_ACCURACY_M, DEMO_START_DISTRICT_ID_TEXT } from '@/application/usecases/demo/constants';
import type { GeoBounds, GeoPoint } from '@/domain/exploration/GeoPoint';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import type { District } from '@/domain/town/District';

const logger = createLogger('application/usecases/demo/demoPosition');

/**
 * デモの開始地区（DEMO_START_DISTRICT_ID_TEXT）をマスタから引く。
 * @param spots マスタ参照
 * @returns 成功: 開始地区（名前・入口はマスタの値）。失敗: INVALID_INPUT（定数の地区ID が不正＝バグ）／DISTRICT_NOT_FOUND（マスタに開始地区が無い）
 * @see docs/08 §4.4, §9.3
 */
export function startDistrictOf(spots: SpotRepository): Result<District> {
  const log = logger.fn('startDistrictOf');
  const districtId = parseDistrictId(DEMO_START_DISTRICT_ID_TEXT);
  if (!districtId.ok) return log.fail(districtId);
  const district = spots.findDistrict(districtId.value);
  if (district === undefined) {
    return log.fail(fail(AppError.of('DISTRICT_NOT_FOUND', '開始地点の地区が見つかりません', { districtId: districtId.value })));
  }
  return log.exit(ok(district), district.name);
}

/**
 * デモの開始位置（開始地区の入口）を返す。
 * @param spots マスタ参照
 * @returns 成功: 入口の位置。失敗: startDistrictOf の失敗
 * @see docs/08 §4.4, §9.3
 */
export function startEntranceOf(spots: SpotRepository): Result<GeoPoint> {
  const log = logger.fn('startEntranceOf');
  const district = startDistrictOf(spots);
  return district.ok ? log.exit(ok(district.value.entrance)) : log.fail(district);
}

/**
 * デモ位置を画面向けの PositionDto にする（精度はデモ位置の DEMO_POSITION_ACCURACY_M）。
 * @param point 位置
 * @returns PositionDto（描画専用。ログに出さない）
 */
export function demoPositionDtoOf(point: GeoPoint): PositionDto {
  return Object.freeze({ lat: point.lat, lng: point.lng, accuracyM: DEMO_POSITION_ACCURACY_M });
}

/**
 * 位置が市域の矩形の内側（境界を含む）にあるか判定する。
 * @param point 位置
 * @param bounds 市域の範囲
 * @returns 内側なら true
 */
export function isWithinBounds(point: GeoPoint, bounds: GeoBounds): boolean {
  return point.lat >= bounds.south && point.lat <= bounds.north && point.lng >= bounds.west && point.lng <= bounds.east;
}
