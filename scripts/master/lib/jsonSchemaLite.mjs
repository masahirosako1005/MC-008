/**
 * @file 依存ライブラリなしの JSON Schema（draft 2020-12 の一部）検証器（scripts 層・Node 専用）
 * master.schema.json で使うキーワードだけを実装する。未対応の検証キーワードが現れたら「未対応」として違反を返し、
 * 黙って素通りさせない（SEC-22 / DI-13 のマスタ完全性検証を確実にするため）。純粋関数のみ
 * （入口の validateSchema だけ CLI ロガー lib/cliLog.mjs で ENTER/EXIT を記録する。既定は無効で出力しない）。
 */
import { createCliLogger } from './cliLog.mjs';

const logger = createCliLogger('scripts/master/lib/jsonSchemaLite');

/** 検証に影響しない注釈キーワード（読み飛ばす） */
const ANNOTATION_KEYWORDS = new Set([
  '$schema', '$id', '$comment', '$defs', 'title', 'description', 'examples', 'default', 'format',
]);

/** この検証器が解釈する検証キーワード */
const SUPPORTED_KEYWORDS = new Set([
  '$ref', 'type', 'enum', 'const', 'anyOf', 'properties', 'required', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum',
]);

/**
 * JSON の値の型名（JSON Schema の type 語彙）を返す。
 * @param {unknown} value 値
 * @returns {string} 'null' | 'array' | 'object' | 'string' | 'boolean' | 'integer' | 'number' | 'undefined'
 */
function jsonTypeOf(value) { // audit-ignore: fnlog-missing スキーマのノードごとに再帰する純粋な検証ヘルパー（入口 validateSchema でまとめて記録）
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/**
 * 値が schema の type に合うか判定する（integer は number にも合う）。
 * @param {unknown} value 値
 * @param {string | string[]} type スキーマの type
 * @returns {boolean} 合えば true
 */
function matchesType(value, type) { // audit-ignore: fnlog-missing スキーマのノードごとに再帰する純粋な検証ヘルパー（入口 validateSchema でまとめて記録）
  const actual = jsonTypeOf(value);
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
}

/**
 * ローカル参照（'#/$defs/Name' 形式）を解決する。
 * @param {object} root ルートスキーマ
 * @param {string} ref 参照文字列
 * @returns {object | undefined} 参照先スキーマ。解決できなければ undefined
 */
export function resolveRef(root, ref) { // audit-ignore: fnlog-missing $ref ごとに呼ばれる純粋な参照解決ヘルパー（呼び出し側 validateSchema / checkSchema でまとめて記録）
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * 2つの JSON 値が等しいか（構造比較）を判定する。enum・const・uniqueItems 用。
 * @param {unknown} a 値A
 * @param {unknown} b 値B
 * @returns {boolean} 等しければ true
 */
function jsonEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * スカラー系キーワード（type・enum・const・文字列・数値）を検証する。
 * @param {{schema: object, value: unknown, path: string, errors: Array<{path: string, message: string}>}} ctx 検証文脈
 * @returns {boolean} type が合わず以降の検証を打ち切るなら false
 */
function checkScalarKeywords({ schema, value, path, errors }) { // audit-ignore: fnlog-missing スキーマのノードごとに再帰する純粋な検証ヘルパー（入口 validateSchema でまとめて記録）
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push({ path, message: `型が ${JSON.stringify(schema.type)} ではありません（実際: ${jsonTypeOf(value)}）` });
    return false;
  }
  if (schema.enum && !schema.enum.some((v) => jsonEquals(v, value))) {
    errors.push({ path, message: `許可されていない値です: ${JSON.stringify(value)}` });
  }
  if ('const' in schema && !jsonEquals(schema.const, value)) {
    errors.push({ path, message: `値は ${JSON.stringify(schema.const)} でなければなりません` });
  }
  if (typeof value === 'string') checkStringKeywords({ schema, value, path, errors });
  if (typeof value === 'number') checkNumberKeywords({ schema, value, path, errors });
  return true;
}

/**
 * 文字列キーワード（pattern・minLength・maxLength）を検証する。長さはコードポイント数で数える。
 * @param {{schema: object, value: string, path: string, errors: Array<{path: string, message: string}>}} ctx 検証文脈
 * @returns {void}
 */
function checkStringKeywords({ schema, value, path, errors }) { // audit-ignore: fnlog-missing スキーマのノードごとに再帰する純粋な検証ヘルパー（入口 validateSchema でまとめて記録）
  const length = [...value].length;
  if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
    errors.push({ path, message: `形式が /${schema.pattern}/ に合いません: ${JSON.stringify(value)}` });
  }
  if (schema.minLength !== undefined && length < schema.minLength) {
    errors.push({ path, message: `文字数 ${length} が下限 ${schema.minLength} 未満です` });
  }
  if (schema.maxLength !== undefined && length > schema.maxLength) {
    errors.push({ path, message: `文字数 ${length} が上限 ${schema.maxLength} を超えています` });
  }
}

/**
 * 数値キーワード（minimum・maximum）を検証する。NaN・Infinity は JSON に現れないので扱わない。
 * @param {{schema: object, value: number, path: string, errors: Array<{path: string, message: string}>}} ctx 検証文脈
 * @returns {void}
 */
function checkNumberKeywords({ schema, value, path, errors }) { // audit-ignore: fnlog-missing スキーマのノードごとに再帰する純粋な検証ヘルパー（入口 validateSchema でまとめて記録）
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push({ path, message: `値 ${value} が最小値 ${schema.minimum} 未満です` });
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push({ path, message: `値 ${value} が最大値 ${schema.maximum} を超えています` });
  }
}

/**
 * 配列キーワード（items・minItems・maxItems・uniqueItems）を検証する。
 * @param {{root: object, schema: object, value: unknown[], path: string, errors: Array<{path: string, message: string}>}} ctx 検証文脈
 * @returns {void}
 */
function checkArrayKeywords({ root, schema, value, path, errors }) { // audit-ignore: fnlog-missing スキーマのノードごとに再帰する純粋な検証ヘルパー（入口 validateSchema でまとめて記録）
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errors.push({ path, message: `要素数 ${value.length} が下限 ${schema.minItems} 未満です` });
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push({ path, message: `要素数 ${value.length} が上限 ${schema.maxItems} を超えています` });
  }
  if (schema.uniqueItems === true) {
    const seen = new Set();
    value.forEach((item, i) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) errors.push({ path: `${path}/${i}`, message: '重複した要素があります' });
      seen.add(key);
    });
  }
  if (schema.items !== undefined) {
    value.forEach((item, i) => validateNode({ root, schema: schema.items, value: item, path: `${path}/${i}`, errors }));
  }
}

/**
 * オブジェクトキーワード（properties・required・additionalProperties）を検証する。
 * @param {{root: object, schema: object, value: Record<string, unknown>, path: string, errors: Array<{path: string, message: string}>}} ctx 検証文脈
 * @returns {void}
 */
function checkObjectKeywords({ root, schema, value, path, errors }) { // audit-ignore: fnlog-missing スキーマのノードごとに再帰する純粋な検証ヘルパー（入口 validateSchema でまとめて記録）
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (!(key in value)) errors.push({ path, message: `必須項目 "${key}" がありません` });
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${key}`;
    if (key in properties) {
      validateNode({ root, schema: properties[key], value: child, path: childPath, errors });
    } else if (schema.additionalProperties === false) {
      errors.push({ path: childPath, message: `未定義の項目 "${key}" があります` });
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      validateNode({ root, schema: schema.additionalProperties, value: child, path: childPath, errors });
    }
  }
}

/**
 * スキーマの1ノードで値を検証し、違反を errors に追記する（再帰）。
 * @param {{root: object, schema: object | boolean, value: unknown, path: string, errors: Array<{path: string, message: string}>}} ctx 検証文脈
 * @returns {void}
 * @sideEffect ctx.errors に違反を push する
 */
function validateNode(ctx) { // audit-ignore: fnlog-missing スキーマのノードごとに再帰する純粋な検証ヘルパー（入口 validateSchema でまとめて記録）
  const { root, schema, value, path, errors } = ctx;
  if (schema === true) return;
  if (schema === false || schema === null || typeof schema !== 'object') {
    errors.push({ path, message: 'スキーマが値を許可していません' });
    return;
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
      errors.push({ path, message: `未対応のスキーマキーワード "${key}"（jsonSchemaLite を拡張してください）` });
    }
  }
  if (schema.$ref !== undefined) {
    const target = resolveRef(root, schema.$ref);
    if (target === undefined) errors.push({ path, message: `参照 ${schema.$ref} を解決できません` });
    else validateNode({ ...ctx, schema: target });
  }
  if (schema.anyOf) checkAnyOf(ctx);
  if (!checkScalarKeywords(ctx)) return;
  if (Array.isArray(value)) checkArrayKeywords(ctx);
  else if (value !== null && typeof value === 'object') checkObjectKeywords(ctx);
}

/**
 * anyOf（いずれか1つ以上に合えばよい）を検証する。
 * @param {{root: object, schema: object, value: unknown, path: string, errors: Array<{path: string, message: string}>}} ctx 検証文脈
 * @returns {void}
 */
function checkAnyOf(ctx) { // audit-ignore: fnlog-missing スキーマのノードごとに再帰する純粋な検証ヘルパー（入口 validateSchema でまとめて記録）
  const passed = ctx.schema.anyOf.some((sub) => {
    const subErrors = [];
    validateNode({ ...ctx, schema: sub, errors: subErrors });
    return subErrors.length === 0;
  });
  if (!passed) ctx.errors.push({ path: ctx.path, message: 'anyOf のどの定義にも合いません' });
}

/**
 * 値をスキーマで検証し、違反の一覧を返す。
 * @param {object} rootSchema ルートスキーマ（$defs を含む）
 * @param {unknown} value 検証する値（JSON.parse 済み）
 * @param {object} [schema] 検証に使うノード（既定はルート。例: resolveRef(root, '#/$defs/ShopsFile')）
 * @returns {Array<{path: string, message: string}>} 違反の一覧。空なら適合
 */
export function validateSchema(rootSchema, value, schema = rootSchema) {
  const log = logger.fn('validateSchema');
  const errors = [];
  validateNode({ root: rootSchema, schema, value, path: '', errors });
  return log.exit(errors, `errors=${errors.length}`);
}
