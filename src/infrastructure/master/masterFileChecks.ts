/**
 * @file マスタファイル共通の検証部品（infrastructure/master 層の境界）
 * ファイル名・失敗の作り方・ファイルの外形（schemaVersion と配列項目）・配列の要素ごとの検証・件数・ID 一意を持つ。
 * masterValidators（地区・スポット・クーポン/イベント・ライバル）と backdropValidators（地図の背景・便利施設ポイント）の両方が使う（DI-13, SEC-22）。
 * 失敗は MASTER_INVALID（details: file / rule / index。値は入れない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { isRecord } from '@/Common/utils/guards';
import type { RecordResult } from '@/infrastructure/master/masterRecordParsers';

const logger = createLogger('infrastructure/master/masterFileChecks');

/** マスタのファイル名（public/master/ 以下）。mapFeatures・amenityPoints は 2026-11-09 の舞台変更（docs/08 §9）で追加 */
export const MASTER_FILE_NAMES = Object.freeze({
  districts: 'districts.json',
  landmarks: 'landmarks.json',
  shops: 'shops.json',
  shopEvents: 'shopEvents.json',
  rivals: 'rivals.json',
  mapFeatures: 'mapFeatures.json',
  amenityPoints: 'amenityPoints.json',
} as const);

/** マスタファイルの種類 */
export type MasterFileKey = keyof typeof MASTER_FILE_NAMES;

/** JSON.parse 済みのマスタファイル（未検証） */
export type MasterJson = Readonly<Record<MasterFileKey, unknown>>;

/** マスタファイルの schemaVersion */
export const MASTER_SCHEMA_VERSION = 1;

/** マスタ検証・読込の失敗コード */
export type MasterErrorCode = 'MASTER_INVALID' | 'MASTER_FETCH_FAILED';

/** マスタ検証・読込の失敗 */
export type MasterError = AppError<MasterErrorCode>;

/** ファイルの外形を確かめた結果（本体と配列項目） */
export interface FileArray {
  readonly body: Readonly<Record<string, unknown>>;
  readonly items: readonly unknown[];
}

/** 配列の各要素を検証する入力 */
export interface ParseEachInput<T> {
  readonly items: readonly unknown[];
  readonly file: string;
  readonly parse: (raw: unknown) => RecordResult<T>;
}

/**
 * マスタ不正の失敗を作る。
 * @param file ファイル名
 * @param rule 破った規則名
 * @param index 違反したレコードの位置（該当する場合）
 * @returns MASTER_INVALID の失敗
 */
export function masterInvalid(file: string, rule: string, index?: number): Result<never, MasterError> {
  const log = logger.fn('masterInvalid', { file, rule, index });
  const details = index === undefined ? { file, rule } : { file, rule, index };
  return log.exit(fail(AppError.of<MasterErrorCode>('MASTER_INVALID', 'マスタデータが正しくありません', details)));
}

/**
 * ファイルの外形（オブジェクト・schemaVersion）を検証する。
 * @param json パース済みのファイル
 * @param file ファイル名
 * @returns 成功: ファイル本体。失敗: MASTER_INVALID（shape / schemaVersion）
 */
export function readFileBody(json: unknown, file: string): Result<Readonly<Record<string, unknown>>, MasterError> {
  const log = logger.fn('readFileBody', { file });
  if (!isRecord(json)) return log.fail(masterInvalid(file, 'shape'));
  if (json['schemaVersion'] !== MASTER_SCHEMA_VERSION) return log.fail(masterInvalid(file, 'schemaVersion'));
  return log.exit(ok(json));
}

/**
 * ファイル本体から配列項目を取り出す。
 * @param body ファイル本体（readFileBody の結果）
 * @param file ファイル名
 * @param field 配列項目の名前（例: 'districts'）
 * @returns 成功: 配列。失敗: MASTER_INVALID（rule は field 名）
 */
export function readArrayField(body: Readonly<Record<string, unknown>>, file: string, field: string): Result<readonly unknown[], MasterError> {
  const log = logger.fn('readArrayField', { file, field });
  const items = body[field];
  if (!Array.isArray(items)) return log.fail(masterInvalid(file, field));
  const array: readonly unknown[] = items;
  return log.exit(ok(array), `items=${array.length}`);
}

/**
 * ファイルの外形（オブジェクト・schemaVersion・配列項目）を検証する。
 * @param json パース済みのファイル
 * @param file ファイル名
 * @param field 配列項目の名前（例: 'districts'）
 * @returns 成功: ファイル本体と配列。失敗: MASTER_INVALID（shape / schemaVersion / field 名）
 */
export function readFileArray(json: unknown, file: string, field: string): Result<FileArray, MasterError> {
  const log = logger.fn('readFileArray', { file, field });
  const body = readFileBody(json, file);
  if (!body.ok) return log.fail(body);
  const items = readArrayField(body.value, file, field);
  if (!items.ok) return log.fail(items);
  return log.exit(ok({ body: body.value, items: items.value }));
}

/**
 * 配列の各要素を検証する（最初の違反で失敗）。
 * @param input 要素・ファイル名・要素の検証関数
 * @returns 成功: 凍結済みの配列。失敗: MASTER_INVALID（rule は要素の規則名、index は位置）
 */
export function parseEach<T>(input: ParseEachInput<T>): Result<readonly T[], MasterError> {
  const log = logger.fn('parseEach', { file: input.file, count: input.items.length });
  const out: T[] = [];
  for (const [index, item] of input.items.entries()) {
    const parsed = input.parse(item);
    if (!parsed.ok) return log.fail(masterInvalid(input.file, parsed.error, index));
    out.push(parsed.value);
  }
  return log.exit(ok(Object.freeze(out)));
}

/**
 * 件数が期待どおりか検証する。
 * @param items 要素
 * @param expected 期待件数
 * @param file ファイル名
 * @returns 成功: void。失敗: MASTER_INVALID（rule: 'count'）
 */
export function checkCount(items: readonly unknown[], expected: number, file: string): Result<void, MasterError> {
  const log = logger.fn('checkCount', { file, actual: items.length, expected });
  return items.length === expected ? log.exit(okVoid()) : log.fail(masterInvalid(file, 'count'));
}

/**
 * 件数が範囲内か検証する（両端を含む）。
 * @param items 要素
 * @param range 最小・最大
 * @param file ファイル名
 * @returns 成功: void。失敗: MASTER_INVALID（rule: 'count'）
 */
export function checkCountRange(items: readonly unknown[], range: { readonly min: number; readonly max: number }, file: string): Result<void, MasterError> {
  const log = logger.fn('checkCountRange', { file, actual: items.length, min: range.min, max: range.max });
  const within = items.length >= range.min && items.length <= range.max;
  return within ? log.exit(okVoid()) : log.fail(masterInvalid(file, 'count'));
}

/**
 * ID が一意か検証する。
 * @param records ID を持つレコード
 * @param file ファイル名
 * @returns 成功: void。失敗: MASTER_INVALID（rule: 'duplicateId'、index は2回目の位置）
 */
export function checkUniqueIds(records: readonly { readonly id: string }[], file: string): Result<void, MasterError> {
  const log = logger.fn('checkUniqueIds', { file, count: records.length });
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    if (seen.has(record.id)) return log.fail(masterInvalid(file, 'duplicateId', index));
    seen.add(record.id);
  }
  return log.exit(okVoid());
}
