/**
 * @file 訪問・発見・クーポン利用の記録（domain/exploration 層）
 * 旅人集約の中に追記専用で積む。生座標は持たない（スポットID・日時・地区のみ＝PRV-03, SEC-13）。
 * parseXxx は保存データなど unknown な値を検証して記録型にする（DI-01）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId, parseOperationId, parseShopEventId, parseSpotId } from '@/Common/types/Id';
import type { DistrictId, OperationId, ShopEventId, SpotId } from '@/Common/types/Id';
import { parseInstant, parseLocalDate } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';

const logger = createLogger('domain/exploration/VisitRecord');

/** 訪問記録（同一スポットは JST 暦日で1日1件まで＝DI-08） */
export interface VisitRecord {
  readonly spotId: SpotId;
  readonly districtId: DistrictId;
  readonly visitedAt: Instant;
  /** visitedAt の JST 暦日 */
  readonly localDate: LocalDate;
  readonly operationId: OperationId;
}

/** 発見記録（スポットごとに1件） */
export interface DiscoveryRecord {
  readonly spotId: SpotId;
  readonly districtId: DistrictId;
  readonly discoveredAt: Instant;
}

/** クーポン利用記録（クーポンごとに1件） */
export interface CouponRedemption {
  readonly shopEventId: ShopEventId;
  readonly spotId: SpotId;
  readonly redeemedAt: Instant;
  readonly operationId: OperationId;
}

/**
 * 記録の形が不正なときの失敗を作る。
 * @param kind 記録の種類名
 * @returns INVALID_INPUT の失敗
 */
function invalidRecord(kind: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', '保存データの形式が正しくありません', { kind }));
}

/**
 * 未検証の値を訪問記録として検証する。
 * @param raw 未検証の値
 * @returns 成功: 凍結済み VisitRecord。失敗: INVALID_INPUT
 */
export function parseVisitRecord(raw: unknown): Result<VisitRecord> {
  const log = logger.fn('parseVisitRecord');
  if (!isRecord(raw)) return log.fail(invalidRecord('VisitRecord'));
  const spotId = parseSpotId(raw['spotId']);
  const districtId = parseDistrictId(raw['districtId']);
  const visitedAt = parseInstant(raw['visitedAt']);
  const localDate = parseLocalDate(raw['localDate']);
  const operationId = parseOperationId(raw['operationId']);
  if (!spotId.ok || !districtId.ok || !visitedAt.ok || !localDate.ok || !operationId.ok) {
    return log.fail(invalidRecord('VisitRecord'));
  }
  return log.exit(
    ok(Object.freeze({ spotId: spotId.value, districtId: districtId.value, visitedAt: visitedAt.value, localDate: localDate.value, operationId: operationId.value })),
  );
}

/**
 * 未検証の値を発見記録として検証する。
 * @param raw 未検証の値
 * @returns 成功: 凍結済み DiscoveryRecord。失敗: INVALID_INPUT
 */
export function parseDiscoveryRecord(raw: unknown): Result<DiscoveryRecord> {
  const log = logger.fn('parseDiscoveryRecord');
  if (!isRecord(raw)) return log.fail(invalidRecord('DiscoveryRecord'));
  const spotId = parseSpotId(raw['spotId']);
  const districtId = parseDistrictId(raw['districtId']);
  const discoveredAt = parseInstant(raw['discoveredAt']);
  if (!spotId.ok || !districtId.ok || !discoveredAt.ok) return log.fail(invalidRecord('DiscoveryRecord'));
  return log.exit(ok(Object.freeze({ spotId: spotId.value, districtId: districtId.value, discoveredAt: discoveredAt.value })));
}

/**
 * 未検証の値をクーポン利用記録として検証する。
 * @param raw 未検証の値
 * @returns 成功: 凍結済み CouponRedemption。失敗: INVALID_INPUT
 */
export function parseCouponRedemption(raw: unknown): Result<CouponRedemption> {
  const log = logger.fn('parseCouponRedemption');
  if (!isRecord(raw)) return log.fail(invalidRecord('CouponRedemption'));
  const shopEventId = parseShopEventId(raw['shopEventId']);
  const spotId = parseSpotId(raw['spotId']);
  const redeemedAt = parseInstant(raw['redeemedAt']);
  const operationId = parseOperationId(raw['operationId']);
  if (!shopEventId.ok || !spotId.ok || !redeemedAt.ok || !operationId.ok) return log.fail(invalidRecord('CouponRedemption'));
  return log.exit(
    ok(Object.freeze({ shopEventId: shopEventId.value, spotId: spotId.value, redeemedAt: redeemedAt.value, operationId: operationId.value })),
  );
}
