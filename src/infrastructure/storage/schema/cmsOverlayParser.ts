/**
 * @file 店舗CMS の登録内容（保存データ）の検証（infrastructure/storage/schema 層の境界）
 * localStorage から読んだ unknown を CmsOverlay にする（DI-01）。形・ID・字数・日付だけを見る。
 * 「協力店だけ」「地区の中」などマスタとの整合は、利用者アプリ側の applyCmsOverlay がマスタと同じ parse で確かめる（docs/09 APP-11）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseOperationId, parseShopEventId, parseSpotId } from '@/Common/types/Id';
import type { OperationId } from '@/Common/types/Id';
import { parseInstant, parseLocalDate } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import { CMS_PROCESSED_OPERATION_LIMIT } from '@/application/ports/CmsOverlayRepository';
import type { CmsOverlay, CmsShopEventRecord, CmsSpotEdit } from '@/application/ports/CmsOverlayRepository';
import { isShopEventKind } from '@/domain/revisit/ShopEvent';
import { AMENITIES, isAmenity } from '@/domain/spot/Amenity';
import type { Amenity } from '@/domain/spot/Amenity';
import { isDisplayText, TEXT_LIMITS } from '@/infrastructure/master/masterRecordParsers';
import type { StoredRecord } from '@/infrastructure/storage/schema/storageSchema';

const logger = createLogger('infrastructure/storage/schema/cmsOverlayParser');

/** 保存できる件数の上限（スポットの編集・クーポン/イベント。マスタの shopEvents 上限と同じ） */
export const CMS_OVERLAY_MAX_RECORDS = 200;

/**
 * 保存データ不正の失敗を作る。
 * @param rule 破った規則名
 * @returns INVALID_INPUT の失敗
 */
function invalid(rule: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', '店舗CMS の保存データが正しくありません', { kind: 'CmsOverlay', rule }));
}

/**
 * 配列であり件数が上限以内か判定する。
 * @param raw 判定する値
 * @param max 上限
 * @returns 配列（不正なら undefined）
 */
function arrayWithin(raw: unknown, max: number): readonly unknown[] | undefined {
  return Array.isArray(raw) && raw.length <= max ? (raw as readonly unknown[]) : undefined;
}

/**
 * 便利情報の配列を検証する（既知の値だけ・重複なし）。
 * @param raw 未検証の値
 * @returns 便利情報（不正なら undefined）
 */
function parseAmenityList(raw: unknown): readonly Amenity[] | undefined {
  const log = logger.fn('parseAmenityList');
  const items = arrayWithin(raw, AMENITIES.length);
  if (items === undefined || new Set(items).size !== items.length || !items.every(isAmenity)) return log.exit(undefined, 'invalid');
  return log.exit(Object.freeze([...items]));
}

/**
 * スポットの編集1件を検証する。
 * @param raw 未検証の値
 * @returns 成功: 編集。失敗: INVALID_INPUT
 */
export function parseCmsSpotEdit(raw: unknown): Result<CmsSpotEdit> {
  const log = logger.fn('parseCmsSpotEdit');
  if (!isRecord(raw)) return log.fail(invalid('spotEdit'));
  const spotId = parseSpotId(raw['spotId']);
  const updatedAt = parseInstant(raw['updatedAt']);
  if (!spotId.ok || !updatedAt.ok) return log.fail(invalid('spotEdit.id'));
  const { hours } = raw;
  if (hours !== undefined && !isDisplayText(hours, TEXT_LIMITS.hours)) return log.fail(invalid('spotEdit.hours'));
  const amenities = raw['amenities'] === undefined ? undefined : parseAmenityList(raw['amenities']);
  if (raw['amenities'] !== undefined && amenities === undefined) return log.fail(invalid('spotEdit.amenities'));
  const edit: CmsSpotEdit = { spotId: spotId.value, updatedAt: updatedAt.value, ...(hours === undefined ? {} : { hours }), ...(amenities === undefined ? {} : { amenities }) };
  return log.exit(ok(Object.freeze(edit)));
}

/**
 * CMS で登録したクーポン・イベント1件を検証する。
 * @param raw 未検証の値
 * @returns 成功: 登録内容。失敗: INVALID_INPUT
 */
export function parseCmsShopEventRecord(raw: unknown): Result<CmsShopEventRecord> {
  const log = logger.fn('parseCmsShopEventRecord');
  if (!isRecord(raw)) return log.fail(invalid('shopEvent'));
  const id = parseShopEventId(raw['id']);
  const spotId = parseSpotId(raw['spotId']);
  const start = parseLocalDate(raw['start']);
  const end = parseLocalDate(raw['end']);
  const createdAt = parseInstant(raw['createdAt']);
  if (!id.ok || !spotId.ok || !start.ok || !end.ok || !createdAt.ok) return log.fail(invalid('shopEvent.fields'));
  const { kind, title, description } = raw;
  if (!isShopEventKind(kind) || !isDisplayText(title, TEXT_LIMITS.eventTitle) || !isDisplayText(description, TEXT_LIMITS.eventDescription)) {
    return log.fail(invalid('shopEvent.texts'));
  }
  const withdrawnOn = raw['withdrawnOn'] === undefined ? undefined : parseLocalDate(raw['withdrawnOn']);
  if (withdrawnOn !== undefined && !withdrawnOn.ok) return log.fail(invalid('shopEvent.withdrawnOn'));
  const record: CmsShopEventRecord = {
    id: id.value, spotId: spotId.value, kind, title, description, start: start.value, end: end.value, createdAt: createdAt.value,
    ...(withdrawnOn === undefined ? {} : { withdrawnOn: withdrawnOn.value }),
  };
  return log.exit(ok(Object.freeze(record)));
}

/**
 * 配列の各要素を検証する（1つでも不正なら失敗）。
 * @param raw 未検証の配列
 * @param max 件数の上限
 * @param parse 1件の検証
 * @returns 成功: 凍結済みの配列。失敗: INVALID_INPUT
 */
function parseList<T>(raw: unknown, max: number, parse: (item: unknown) => Result<T>): Result<readonly T[]> {
  const log = logger.fn('parseList', { max });
  const items = arrayWithin(raw, max);
  if (items === undefined) return log.fail(invalid('list'));
  const parsed: T[] = [];
  for (const item of items) {
    const one = parse(item);
    if (!one.ok) return log.fail(one);
    parsed.push(one.value);
  }
  return log.exit(ok(Object.freeze(parsed)));
}

/**
 * 保存レコード（封筒の中身）を CmsOverlay にする。
 * @param record 版数と中身
 * @returns 成功: 登録内容（版数は封筒の版数）。失敗: INVALID_INPUT（EnvelopeStore が退避する）
 */
export function parseStoredCmsOverlay(record: StoredRecord): Result<CmsOverlay> {
  const log = logger.fn('parseStoredCmsOverlay', { version: record.version });
  const data = record.data;
  if (!isRecord(data)) return log.fail(invalid('shape'));
  const spotEdits = parseList(data['spotEdits'], CMS_OVERLAY_MAX_RECORDS, parseCmsSpotEdit);
  if (!spotEdits.ok) return log.fail(spotEdits);
  const shopEvents = parseList(data['shopEvents'], CMS_OVERLAY_MAX_RECORDS, parseCmsShopEventRecord);
  if (!shopEvents.ok) return log.fail(shopEvents);
  const operations = parseList<OperationId>(data['processedOperationIds'], CMS_PROCESSED_OPERATION_LIMIT, (item) => parseOperationId(item));
  if (!operations.ok) return log.fail(operations);
  return log.exit(ok(Object.freeze({ version: record.version, spotEdits: spotEdits.value, shopEvents: shopEvents.value, processedOperationIds: operations.value })));
}
