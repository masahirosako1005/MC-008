/**
 * @file JSON の形の検証のテスト（infrastructure/api/schema 層・テスト。DI-01）
 */
import { describe, expect, it } from 'vitest';
import { parseWithShape, shape, SHAPE_MAX_ARRAY_LENGTH, SHAPE_MAX_STRING_LENGTH } from '@/infrastructure/api/schema/shape';
import { parsePublicCmsSnapshot } from '@/infrastructure/api/schema/publicCmsSnapshot';

const ITEM = shape.object({ id: 'string', count: 'integer', kind: shape.literal('a', 'b'), note: shape.optional('string'), tags: shape.array('string') });

describe('parseWithShape', () => {
  it('知っている項目だけを写し、凍結して返す', () => {
    const parsed = parseWithShape<Record<string, unknown>>({ id: 'x', count: 2, kind: 'a', tags: ['t'], extra: '<script>' }, ITEM, 'Item');
    expect(parsed.ok && parsed.value).toEqual({ id: 'x', count: 2, kind: 'a', tags: ['t'] });
    expect(parsed.ok && Object.isFrozen(parsed.value)).toBe(true);
  });

  it('型・決まった値・整数・必須の項目が違えば失敗する', () => {
    for (const bad of [
      { id: 1, count: 2, kind: 'a', tags: [] },
      { id: 'x', count: 2.5, kind: 'a', tags: [] },
      { id: 'x', count: 2, kind: 'c', tags: [] },
      { id: 'x', count: 2, kind: 'a' },
      { id: 'x', count: 2, kind: 'a', tags: [], note: null },
      [],
      null,
    ]) expect(parseWithShape(bad, ITEM, 'Item').ok).toBe(false);
  });

  it('長すぎる文字列・多すぎる配列は失敗する（SEC-18）', () => {
    expect(parseWithShape('x'.repeat(SHAPE_MAX_STRING_LENGTH + 1), 'string', 'Text').ok).toBe(false);
    expect(parseWithShape(new Array(SHAPE_MAX_ARRAY_LENGTH + 1).fill('t'), shape.array('string'), 'List').ok).toBe(false);
  });
});

describe('parsePublicCmsSnapshot', () => {
  it('形の版・版番号・1件ずつの検証（字数）に通らなければ失敗する', () => {
    const ok = { schemaVersion: 1, dbId: 'testdb01', version: 3, spotEdits: [], shopEvents: [] };
    expect(parsePublicCmsSnapshot(ok).ok).toBe(true);
    expect(parsePublicCmsSnapshot({ ...ok, schemaVersion: 2 }).ok).toBe(false);
    expect(parsePublicCmsSnapshot({ ...ok, version: -1 }).ok).toBe(false);
    expect(parsePublicCmsSnapshot({ ...ok, dbId: '../x' }).ok).toBe(false);
    const longTitle = { id: 'c_test0001', spotId: 's_mm04', kind: 'coupon', title: 'x'.repeat(31), description: 'y', start: '2026-11-10', end: '2026-11-11', createdAt: '2026-11-09T01:00:00.000Z' };
    expect(parsePublicCmsSnapshot({ ...ok, shopEvents: [longTitle] }).ok).toBe(false);
  });
});
