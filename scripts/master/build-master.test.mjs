/**
 * @file マスタ生成（build-master.mjs）・整形（lib/jsonFormat.mjs）・ハッシュ（hash-master.mjs）のテスト（scripts 層）
 * 2026-11-09: 舞台を南森町周辺に変更（docs/08 §9）。地区2字・背景（mapFeatures）・便利施設ポイント（amenityPoints）を追加。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { districtIdOfSpot, renderMasterFiles } from './build-master.mjs';
import { computeMasterHashes, renderMasterHashesTs, sha256Hex } from './hash-master.mjs';
import { formatJson } from './lib/jsonFormat.mjs';
import { DATA_FILES, HASHES_TS_PATH, MASTER_DIR, SCHEMA_FILE } from './lib/masterFiles.mjs';

describe('build-master', () => {
  it('同じ原データからは毎回同じ本文を生成する（決定論的）', () => {
    const first = renderMasterFiles();
    const second = renderMasterFiles();
    expect([...first.keys()]).toEqual([...DATA_FILES, SCHEMA_FILE]);
    for (const [name, text] of first) expect(second.get(name)).toBe(text);
  });

  it('public/master の各ファイルは原データからの生成結果と一致する（手編集なし）', () => {
    for (const [name, text] of renderMasterFiles()) {
      expect(readFileSync(resolve(MASTER_DIR, name), 'utf8')).toBe(text);
    }
  });

  it('本文は LF 改行で末尾に改行が1つだけある', () => {
    for (const text of renderMasterFiles().values()) {
      expect(text.includes('\r')).toBe(false);
      expect(text.endsWith('}\n')).toBe(true);
    }
  });

  it('スポット・背景・駅・便利施設ポイントの緯度経度は小数6桁以内', () => {
    const files = renderMasterFiles();
    const shops = JSON.parse(files.get('shops.json')).shops;
    const map = JSON.parse(files.get('mapFeatures.json'));
    const amenity = JSON.parse(files.get('amenityPoints.json'));
    const points = [...shops, ...map.features.flatMap((f) => f.points), ...map.stations, ...amenity.points];
    expect(points.length).toBeGreaterThan(66);
    for (const p of points) {
      expect(Math.round(p.lat * 1e6) / 1e6).toBe(p.lat);
      expect(Math.round(p.lng * 1e6) / 1e6).toBe(p.lng);
    }
  });

  it('スポットID の地区2字から地区ID を引く。未知の2字・旧 N西市の2字は生成を止める', () => {
    expect(districtIdOfSpot('s_mm02')).toBe('d_minamimori');
    expect(districtIdOfSpot('l_tm01')).toBe('d_tenma');
    expect(districtIdOfSpot('s_tr01')).toBe('d_tenroku');
    expect(districtIdOfSpot('l_og03')).toBe('d_ogimachi');
    expect(districtIdOfSpot('l_ok01')).toBe('d_okawa');
    expect(() => districtIdOfSpot('s_zz01')).toThrow('地区2字');
    expect(() => districtIdOfSpot('s_jo02')).toThrow('地区2字');
  });

  it('舞台は南森町周辺で、原点は南森町駅、範囲は docs/08 §9.1 の bounds', () => {
    const { city } = JSON.parse(renderMasterFiles().get('districts.json'));
    expect(city).toEqual({
      name: '南森町周辺（大阪市北区）',
      origin: { lat: 34.6977, lng: 135.51102 },
      bounds: { south: 34.6895, west: 135.501, north: 34.714, east: 135.5245 },
    });
  });

  it('mapFeatures.json は出典表示を持ち、line だけが widthM を持つ（キー順 id, kind, name, shape, widthM, points）', () => {
    const map = JSON.parse(renderMasterFiles().get('mapFeatures.json'));
    expect(map.schemaVersion).toBe(1);
    expect(map.attribution).toBe('© OpenStreetMap contributors');
    for (const f of map.features) {
      expect('widthM' in f, f.id).toBe(f.shape === 'line');
      expect(Object.keys(f), f.id).toEqual(f.shape === 'line' ? ['id', 'kind', 'name', 'shape', 'widthM', 'points'] : ['id', 'kind', 'name', 'shape', 'points']);
    }
    expect(map.stations.map((s) => Object.keys(s))[0]).toEqual(['id', 'name', 'lat', 'lng', 'lines']);
  });

  it('amenityPoints.json は出典表示と、公衆トイレ・授乳室のポイントを持つ', () => {
    const amenity = JSON.parse(renderMasterFiles().get('amenityPoints.json'));
    expect(amenity.attribution).toBe('© OpenStreetMap contributors');
    expect(amenity.points.some((p) => p.kind === 'toilet')).toBe(true);
    expect(amenity.points.filter((p) => p.kind === 'nursing').map((p) => p.note)).toEqual(['キッズプラザ大阪の館内']);
    expect(Object.keys(amenity.points[0])).toEqual(['id', 'kind', 'name', 'lat', 'lng', 'note']);
  });
});

describe('jsonFormat', () => {
  it('短い平坦オブジェクトとプリミティブ配列は1行、それ以外は複数行', () => {
    expect(formatJson({ lat: 34.69, lng: 135.195 })).toBe('{ "lat": 34.69, "lng": 135.195 }');
    expect(formatJson(['kids', 'toilet'])).toBe('["kids", "toilet"]');
    expect(formatJson({ a: [1] })).toBe('{\n  "a": [1]\n}');
    expect(formatJson([])).toBe('[]');
    expect(formatJson({})).toBe('{}');
  });

  it('JSON.parse で元の値に戻る', () => {
    const value = { name: '南森町周辺', list: [{ x: 1, y: [true, null] }], s: '"\\' };
    expect(JSON.parse(formatJson(value))).toEqual(value);
  });
});

describe('hash-master', () => {
  it('SHA-256 の既知の値を返す', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('1バイトでも変わればハッシュが変わる（改変検出）', () => {
    const text = readFileSync(resolve(MASTER_DIR, 'shops.json'));
    const tampered = Buffer.from(text.toString('utf8').replace('天二珈琲店', '天二咖琲店'), 'utf8');
    expect(sha256Hex(tampered)).not.toBe(sha256Hex(text));
  });

  it('masterHashes.ts は現在の public/master のハッシュと一致する', () => {
    const { hashes, missing } = computeMasterHashes();
    expect(missing).toEqual([]);
    expect(Object.keys(hashes)).toEqual([...DATA_FILES]);
    expect(readFileSync(HASHES_TS_PATH, 'utf8').replace(/\r\n/g, '\n')).toBe(renderMasterHashesTs(hashes));
  });

  it('生成する TS は @file ヘッダと MASTER_HASHES を持つ', () => {
    const ts = renderMasterHashesTs({ 'districts.json': 'a'.repeat(64) });
    expect(ts.startsWith('/**\n * @file')).toBe(true);
    expect(ts).toContain("export const MASTER_HASHES: Readonly<Record<string, string>> = Object.freeze({");
    expect(ts).toContain(`'districts.json': '${'a'.repeat(64)}',`);
  });

  it('ファイルが無いディレクトリでは missing に列挙する（不正値）', () => {
    const { hashes, missing } = computeMasterHashes(resolve(MASTER_DIR, 'no-such-dir'));
    expect(hashes).toEqual({});
    expect(missing).toEqual([...DATA_FILES]);
  });
});
