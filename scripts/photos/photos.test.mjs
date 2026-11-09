/**
 * @file 同梱した写真の整合性（scripts 側のテスト）
 * - マスタのすべての名所に実写、すべての店舗カテゴリにイメージ写真がある
 * - 一覧のファイルが public/photos に実在し、ライセンスは CC0／パブリックドメイン／CC BY／CC BY-SA だけ、作者と出典がある
 * 一覧（src/presentation/shared/spotPhotoData.ts）は fetch-photos.mjs が生成する。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_PHOTO_DATA, LANDMARK_PHOTO_DATA } from '../../src/presentation/shared/spotPhotoData';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const landmarks = readJson('public/master/landmarks.json').landmarks;
const shops = readJson('public/master/shops.json').shops;
const OK_LICENSE = /^(cc0|public domain|pd[- ]|cc[- ]by(-sa)?[- ][0-9.]+|cc by(-sa)? [0-9.]+)/i;

describe('同梱した写真', () => {
  it('すべての名所に実写の写真がある', () => {
    for (const l of landmarks) expect(LANDMARK_PHOTO_DATA[l.id], l.id).toBeDefined();
  });

  it('すべての店舗カテゴリにイメージ写真がある', () => {
    for (const category of new Set(shops.map((s) => s.category))) expect(CATEGORY_PHOTO_DATA[category], category).toBeDefined();
  });

  it('ファイルが実在し、ライセンスは許可したものだけで、作者と出典がある', () => {
    for (const [key, record] of [...Object.entries(LANDMARK_PHOTO_DATA), ...Object.entries(CATEGORY_PHOTO_DATA)]) {
      expect(fs.existsSync(path.join(ROOT, 'public/photos', record.file)), `${key} ${record.file}`).toBe(true);
      expect(record.license, key).toMatch(OK_LICENSE);
      expect(record.artist.length, key).toBeGreaterThan(0);
      expect(record.artist, key).not.toBe('不明');
      expect(record.sourceUrl, key).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });
});
