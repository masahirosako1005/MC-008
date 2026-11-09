/**
 * @file 簡易 JSON Schema 検証器（lib/jsonSchemaLite.mjs）のテスト（scripts 層）
 */
import { describe, expect, it } from 'vitest';
import { resolveRef, validateSchema } from './jsonSchemaLite.mjs';

/** テスト用のスキーマ（マスタのスポットを簡略化したもの） */
const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    Spot: {
      type: 'object',
      required: ['id', 'name', 'lat', 'tags'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', pattern: '^s_[0-9a-z]{2,16}$' },
        name: { type: 'string', minLength: 1, maxLength: 5 },
        lat: { type: 'number', minimum: -90, maximum: 90 },
        tags: { type: 'array', maxItems: 2, uniqueItems: true, items: { enum: ['kids', 'toilet', 'rainOk'] } },
        version: { const: 1 },
        count: { type: 'integer' },
      },
    },
  },
  anyOf: [{ $ref: '#/$defs/Spot' }],
};

/** 適合する値 */
const VALID = { id: 's_mm01', name: '天二珈琲店', lat: 34.6959, tags: ['kids'] };

/**
 * Spot 定義で検証して違反メッセージの配列を返すテスト用ヘルパー。
 * @param {unknown} value 検証する値
 * @returns {string[]} 違反（パス: メッセージ）
 */
function errorsOf(value) {
  return validateSchema(SCHEMA, value, resolveRef(SCHEMA, '#/$defs/Spot')).map((e) => `${e.path}: ${e.message}`);
}

describe('jsonSchemaLite', () => {
  it('適合する値は違反0件', () => {
    expect(errorsOf(VALID)).toEqual([]);
    expect(validateSchema(SCHEMA, VALID)).toEqual([]);
  });

  it('必須項目の欠落と未定義の項目を報告する', () => {
    const { lat: _lat, ...noLat } = VALID;
    expect(errorsOf(noLat).join()).toContain('必須項目 "lat"');
    expect(errorsOf({ ...VALID, extra: 1 }).join()).toContain('未定義の項目 "extra"');
  });

  it('型・正規表現・列挙・const の違反を報告する', () => {
    expect(errorsOf({ ...VALID, lat: '34.6959' }).join()).toContain('/lat: 型が');
    expect(errorsOf({ ...VALID, id: 'S_JO01' }).join()).toContain('/id: 形式が');
    expect(errorsOf({ ...VALID, tags: ['wifi'] }).join()).toContain('/tags/0: 許可されていない値');
    expect(errorsOf({ ...VALID, version: 2 }).join()).toContain('/version: 値は 1');
  });

  it('文字数はコードポイントで数え、上限ちょうどは適合・1字超過は違反（境界値）', () => {
    expect(errorsOf({ ...VALID, name: '12345' })).toEqual([]);
    expect(errorsOf({ ...VALID, name: '🍡🍡🍡🍡🍡' })).toEqual([]);
    expect(errorsOf({ ...VALID, name: '123456' }).join()).toContain('上限 5');
    expect(errorsOf({ ...VALID, name: '' }).join()).toContain('下限 1');
  });

  it('数値の最小・最大は境界ちょうどを許し、超えたら違反', () => {
    expect(errorsOf({ ...VALID, lat: 90 })).toEqual([]);
    expect(errorsOf({ ...VALID, lat: -90 })).toEqual([]);
    expect(errorsOf({ ...VALID, lat: 90.000001 }).join()).toContain('最大値 90');
    expect(errorsOf({ ...VALID, lat: -91 }).join()).toContain('最小値 -90');
  });

  it('integer は小数を拒否する', () => {
    expect(errorsOf({ ...VALID, count: 3 })).toEqual([]);
    expect(errorsOf({ ...VALID, count: 3.5 }).join()).toContain('/count: 型が');
  });

  it('配列の要素数上限と重複を報告する', () => {
    expect(errorsOf({ ...VALID, tags: ['kids', 'toilet', 'rainOk'] }).join()).toContain('上限 2');
    expect(errorsOf({ ...VALID, tags: ['kids', 'kids'] }).join()).toContain('重複');
  });

  it('null・配列などオブジェクト以外は型違反', () => {
    expect(errorsOf(null).join()).toContain('型が');
    expect(errorsOf([VALID]).join()).toContain('型が');
  });

  it('解決できない参照と未対応キーワードは違反として返す（素通りさせない）', () => {
    expect(validateSchema({ $ref: '#/$defs/Nothing' }, {})[0]?.message).toContain('解決できません');
    expect(validateSchema({ oneOf: [{ type: 'string' }] }, 'x')[0]?.message).toContain('未対応のスキーマキーワード "oneOf"');
  });

  it('anyOf はどれにも合わなければ違反', () => {
    expect(validateSchema(SCHEMA, { id: 1 }).map((e) => e.message)).toContain('anyOf のどの定義にも合いません');
  });

  it('resolveRef はローカル参照以外を解決しない', () => {
    expect(resolveRef(SCHEMA, 'https://example.com/schema')).toBeUndefined();
    expect(resolveRef(SCHEMA, '#/$defs/Spot')).toBe(SCHEMA.$defs.Spot);
  });
});
