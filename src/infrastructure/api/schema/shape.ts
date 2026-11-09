/**
 * @file JSON の形の検証（infrastructure/api/schema 層の境界。DI-01）
 * 通信で受け取った JSON（サーバーの応答・リクエストの本文）を、決めた形（Shape）と照らし合わせる。
 * 合えば「知っている項目だけを写した、凍結済みの新しい値」を返す。知らない項目は捨てる（画面やユースケースへ余計な値を渡さない）。
 * 文字列の長さ・配列の件数・入れ子の深さに上限を置き、大きすぎる入力で固まらないようにする（SEC-18 の考え方）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { isRecord } from '@/Common/utils/guards';

const logger = createLogger('infrastructure/api/schema/shape');

/** 形の定義 */
export type Shape =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | { readonly kind: 'literal'; readonly values: readonly (string | number | boolean)[] }
  | { readonly kind: 'array'; readonly of: Shape }
  | { readonly kind: 'optional'; readonly of: Shape }
  | { readonly kind: 'object'; readonly fields: Readonly<Record<string, Shape>> };

/** 文字列1つの長さの上限 */
export const SHAPE_MAX_STRING_LENGTH = 4000;
/** 配列1つの件数の上限 */
export const SHAPE_MAX_ARRAY_LENGTH = 1000;
/** 入れ子の深さの上限 */
const SHAPE_MAX_DEPTH = 8;

/** 形に合わなかった印 */
const MISMATCH: unique symbol = Symbol('mismatch');
type Projected = unknown;

/** 形を組み立てる関数（読みやすく書くため） */
export const shape = Object.freeze({
  /**
   * 決まった値のどれか。
   * @param values 許す値
   * @returns 形
   */
  literal: (...values: readonly (string | number | boolean)[]): Shape => ({ kind: 'literal', values }),
  /**
   * 配列。
   * @param of 要素の形
   * @returns 形
   */
  array: (of: Shape): Shape => ({ kind: 'array', of }),
  /**
   * 省略できる項目。
   * @param of 中身の形
   * @returns 形
   */
  optional: (of: Shape): Shape => ({ kind: 'optional', of }),
  /**
   * オブジェクト。
   * @param fields 項目名 → 形
   * @returns 形
   */
  object: (fields: Readonly<Record<string, Shape>>): Shape => ({ kind: 'object', fields }),
});

/**
 * 基本の値（文字列・数値・真偽）を照らし合わせる。
 * @param value 値
 * @param kind 基本の形
 * @returns 合えば値、合わなければ MISMATCH
 */
function projectPrimitive(value: unknown, kind: 'string' | 'number' | 'integer' | 'boolean'): Projected | typeof MISMATCH { // audit-ignore: fnlog-missing 値ごとに多数回呼ぶ小さな判定（parseWithShape で記録する）
  if (kind === 'string') return typeof value === 'string' && value.length <= SHAPE_MAX_STRING_LENGTH ? value : MISMATCH;
  if (kind === 'boolean') return typeof value === 'boolean' ? value : MISMATCH;
  if (typeof value !== 'number' || !Number.isFinite(value)) return MISMATCH;
  return kind === 'integer' && !Number.isInteger(value) ? MISMATCH : value;
}

/**
 * 配列を照らし合わせる。
 * @param value 値
 * @param of 要素の形
 * @param depth 今の深さ
 * @returns 写した配列、合わなければ MISMATCH
 */
function projectArray(value: unknown, of: Shape, depth: number): Projected | typeof MISMATCH { // audit-ignore: fnlog-missing 再帰で多数回呼ぶ（parseWithShape で記録する）
  if (!Array.isArray(value) || value.length > SHAPE_MAX_ARRAY_LENGTH) return MISMATCH;
  const out: unknown[] = [];
  for (const item of value as readonly unknown[]) {
    const projected = project(item, of, depth + 1);
    if (projected === MISMATCH || projected === undefined) return MISMATCH;
    out.push(projected);
  }
  return Object.freeze(out);
}

/**
 * オブジェクトを照らし合わせる（知っている項目だけを写す）。
 * @param value 値
 * @param fields 項目名 → 形
 * @param depth 今の深さ
 * @returns 写したオブジェクト、合わなければ MISMATCH
 */
function projectObject(value: unknown, fields: Readonly<Record<string, Shape>>, depth: number): Projected | typeof MISMATCH { // audit-ignore: fnlog-missing 再帰で多数回呼ぶ（parseWithShape で記録する）
  if (!isRecord(value) || Array.isArray(value)) return MISMATCH;
  const out: Record<string, unknown> = {};
  for (const [key, fieldShape] of Object.entries(fields)) {
    const raw = Object.hasOwn(value, key) ? value[key] : undefined;
    const projected = project(raw, fieldShape, depth + 1);
    if (projected === MISMATCH) return MISMATCH;
    if (projected !== undefined) out[key] = projected;
  }
  return Object.freeze(out);
}

/**
 * 値を形に照らして写す。
 * @param value 値
 * @param s 形
 * @param depth 今の深さ
 * @returns 写した値（省略できる項目が無ければ undefined）、合わなければ MISMATCH
 */
function project(value: unknown, s: Shape, depth: number): Projected | typeof MISMATCH { // audit-ignore: fnlog-missing 1件ごとに再帰で多数回呼ぶ小さな振り分け（呼び出し元の parseWithShape で記録する）
  if (depth > SHAPE_MAX_DEPTH) return MISMATCH;
  if (typeof s === 'string') return projectPrimitive(value, s);
  switch (s.kind) {
    case 'literal':
      return s.values.some((v) => v === value) ? value : MISMATCH;
    case 'optional':
      return value === undefined ? undefined : project(value, s.of, depth);
    case 'array':
      return projectArray(value, s.of, depth);
    case 'object':
      return projectObject(value, s.fields, depth);
  }
}

/**
 * JSON の値を形に照らし、合えば型付きの値にする。
 * @param raw 受け取った値（JSON.parse の結果）
 * @param s 形（T と同じ構造にすること）
 * @param kind 何の値か（失敗の記録用。例 'CmsShopInfoDto'）
 * @returns 成功: 知っている項目だけを写した凍結済みの値。失敗: INVALID_INPUT（details.kind）
 */
export function parseWithShape<T>(raw: unknown, s: Shape, kind: string): Result<T> {
  const log = logger.fn('parseWithShape', { kind });
  const projected = project(raw, s, 0);
  if (projected === MISMATCH || projected === undefined) {
    return log.fail(fail(AppError.of('INVALID_INPUT', 'データの形が正しくありません', { kind })));
  }
  // 境界での型付け（docs/03 §1-4）。形は T と同じ構造で定義し、知っている項目だけを写してある
  return log.exit(ok(projected as T));
}
