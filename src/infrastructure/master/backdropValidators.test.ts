import { describe, expect, it } from 'vitest';
import { validateBackdrop } from '@/infrastructure/master/backdropValidators';
import type { BackdropJson } from '@/infrastructure/master/backdropValidators';

/** 市域（docs/08 §9.1 の bounds） */
const CITY = { south: 34.6895, west: 135.501, north: 34.714, east: 135.5245 } as const;

/** JSON の一部を書き換えられるようにした、可変な写し */
type MutableJson = Record<string, unknown>;

/** テスト用: 正しい mapFeatures.json（川の line・公園の area・駅） */
function mapFeaturesJson(): MutableJson {
  return {
    schemaVersion: 1,
    attribution: '© OpenStreetMap contributors',
    features: [
      // 川の端は市域の北端の少し外（約 200m）に出てよい
      { id: 'f_okawa', kind: 'water', name: '大川', shape: 'line', widthM: 110, points: [{ lat: 34.7158, lng: 135.5211 }, { lat: 34.6911, lng: 135.5149 }] },
      { id: 'f_ogimachi_park', kind: 'park', name: '扇町公園', shape: 'area', points: [{ lat: 34.705, lng: 135.5075 }, { lat: 34.7026, lng: 135.5077 }, { lat: 34.7034, lng: 135.5107 }] },
    ],
    stations: [{ id: 'st_minamimorimachi', name: '南森町', lat: 34.6977, lng: 135.51102, lines: '大阪メトロ谷町線・堺筋線' }],
  };
}

/** テスト用: 正しい amenityPoints.json */
function amenityPointsJson(): MutableJson {
  return {
    schemaVersion: 1,
    attribution: '© OpenStreetMap contributors',
    points: [
      { id: 'a_wc07', kind: 'toilet', name: '公衆トイレ', lat: 34.704707, lng: 135.508807, note: '扇町公園内' },
      { id: 'a_nursing01', kind: 'nursing', name: '授乳室', lat: 34.70468, lng: 135.50985, note: '' },
    ],
  };
}

/** テスト用: 配列項目の i 番目を取り出す */
function itemOf(json: MutableJson, field: string, index: number): MutableJson {
  const item = (json[field] as MutableJson[])[index];
  if (item === undefined) throw new Error('fixture');
  return item;
}

/** テスト用: 2ファイルを書き換えて検証し、失敗の details を返す（成功なら undefined） */
function detailsOf(edit: (files: { mapFeatures: MutableJson; amenityPoints: MutableJson }) => void): unknown {
  const files = { mapFeatures: mapFeaturesJson(), amenityPoints: amenityPointsJson() };
  edit(files);
  const json: BackdropJson = files;
  const result = validateBackdrop(json, CITY);
  return result.ok ? undefined : result.error.details;
}

describe('validateBackdrop（地図の背景マスタ＝docs/08 §9、DI-13, SEC-22）', () => {
  it('正しい2ファイルから凍結済みの MapBackdrop を作り、出典は mapFeatures.json のものを使う', () => {
    const files = { mapFeatures: mapFeaturesJson(), amenityPoints: { ...amenityPointsJson(), attribution: '別の出典' } };
    const result = validateBackdrop(files, CITY);
    if (!result.ok) throw new Error(JSON.stringify(result.error.details));
    const backdrop = result.value;
    expect(backdrop.attribution).toBe('© OpenStreetMap contributors');
    expect(backdrop.features.map((f) => [f.id, f.kind, f.shape, f.points.length, f.widthM])).toEqual([
      ['f_okawa', 'water', 'line', 2, 110],
      ['f_ogimachi_park', 'park', 'area', 3, undefined],
    ]);
    expect('widthM' in (backdrop.features[1] ?? {})).toBe(false);
    expect(backdrop.stations).toEqual([{ id: 'st_minamimorimachi', name: '南森町', point: { lat: 34.6977, lng: 135.51102 }, lines: '大阪メトロ谷町線・堺筋線' }]);
    expect(backdrop.amenityPoints.map((p) => [p.id, p.kind, p.note])).toEqual([['a_wc07', 'toilet', '扇町公園内'], ['a_nursing01', 'nursing', '']]);
    expect(Object.isFrozen(backdrop)).toBe(true);
    expect(Object.isFrozen(backdrop.features)).toBe(true);
    expect(Object.isFrozen(backdrop.features[0]?.points)).toBe(true);
  });

  it('駅・便利施設ポイントが無くてもよい（0件）', () => {
    const none = detailsOf(({ mapFeatures, amenityPoints }) => {
      mapFeatures['stations'] = [];
      amenityPoints['points'] = [];
    });
    expect(none).toBeUndefined();
  });

  it('ファイルの外形（オブジェクト・schemaVersion・出典・配列項目）が違えば失敗する', () => {
    expect(detailsOf((f) => Object.assign(f.mapFeatures, { schemaVersion: 2 }))).toEqual({ file: 'mapFeatures.json', rule: 'schemaVersion' });
    expect(detailsOf((f) => Object.assign(f.mapFeatures, { attribution: '' }))).toEqual({ file: 'mapFeatures.json', rule: 'attribution' });
    expect(detailsOf((f) => Object.assign(f.amenityPoints, { attribution: 'x'.repeat(81) }))).toEqual({ file: 'amenityPoints.json', rule: 'attribution' });
    expect(detailsOf((f) => Object.assign(f.mapFeatures, { features: {} }))).toEqual({ file: 'mapFeatures.json', rule: 'features' });
    expect(detailsOf((f) => Object.assign(f.mapFeatures, { stations: undefined }))).toEqual({ file: 'mapFeatures.json', rule: 'stations' });
    expect(detailsOf((f) => Object.assign(f.amenityPoints, { points: 'a' }))).toEqual({ file: 'amenityPoints.json', rule: 'points' });
    const notObject = validateBackdrop({ mapFeatures: [], amenityPoints: amenityPointsJson() }, CITY);
    expect(notObject.ok ? undefined : notObject.error.details).toEqual({ file: 'mapFeatures.json', rule: 'shape' });
  });

  it('件数が範囲外なら失敗する（地物 1〜200・便利施設ポイント 200 まで）', () => {
    expect(detailsOf((f) => Object.assign(f.mapFeatures, { features: [] }))).toEqual({ file: 'mapFeatures.json', rule: 'count' });
    const many = Array.from({ length: 201 }, (_, i) => ({ id: `a_wc${i}`, kind: 'toilet', name: '公衆トイレ', lat: 34.7, lng: 135.51, note: '' }));
    expect(detailsOf((f) => Object.assign(f.amenityPoints, { points: many }))).toEqual({ file: 'amenityPoints.json', rule: 'count' });
  });

  it('ID の書式が違えば失敗する（f_ / st_ / a_ ＋ 英小文字・数字・_ の 2〜24 字＝SEC-16）', () => {
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 1), { id: 'F_PARK' }))).toEqual({ file: 'mapFeatures.json', rule: 'id', index: 1 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { id: 'st_okawa' }))).toEqual({ file: 'mapFeatures.json', rule: 'id', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'stations', 0), { id: 'st_' + 'a'.repeat(25) }))).toEqual({ file: 'mapFeatures.json', rule: 'id', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.amenityPoints, 'points', 0), { id: 'a_x' }))).toEqual({ file: 'amenityPoints.json', rule: 'id', index: 0 });
  });

  it('同じ ID が2回あれば失敗する', () => {
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 1), { id: 'f_okawa' }))).toEqual({ file: 'mapFeatures.json', rule: 'duplicateId', index: 1 });
    expect(detailsOf((f) => Object.assign(itemOf(f.amenityPoints, 'points', 1), { id: 'a_wc07' }))).toEqual({ file: 'amenityPoints.json', rule: 'duplicateId', index: 1 });
  });

  it('種類（kind）・形（shape）が未知なら失敗する', () => {
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { kind: 'sea' }))).toMatchObject({ rule: 'kind', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { shape: 'circle' }))).toMatchObject({ rule: 'featureShape', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.amenityPoints, 'points', 0), { kind: 'wifi' }))).toMatchObject({ file: 'amenityPoints.json', rule: 'kind', index: 0 });
  });

  it('頂点数が形ごとの範囲外なら失敗する（line 2〜40、area 3〜40）', () => {
    const p = { lat: 34.7, lng: 135.51 };
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { points: [p] }))).toMatchObject({ rule: 'points', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 1), { points: [p, p] }))).toMatchObject({ rule: 'points', index: 1 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 1), { points: Array.from({ length: 41 }, () => p) }))).toMatchObject({ rule: 'points', index: 1 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { points: 'x' }))).toMatchObject({ rule: 'points', index: 0 });
  });

  it('線の太さ: line は 1〜300m が必須、area は持たない', () => {
    expect(detailsOf((f) => delete itemOf(f.mapFeatures, 'features', 0)['widthM'])).toMatchObject({ rule: 'widthM', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { widthM: 0 }))).toMatchObject({ rule: 'widthM', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { widthM: 301 }))).toMatchObject({ rule: 'widthM', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { widthM: '110' }))).toMatchObject({ rule: 'widthM', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 1), { widthM: 10 }))).toMatchObject({ rule: 'widthM', index: 1 });
  });

  it('座標: 緯度経度として不正なら point、許す範囲の外なら outsideArea', () => {
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { points: [{ lat: 91, lng: 135.51 }, { lat: 34.7, lng: 135.51 }] }))).toMatchObject({ rule: 'point', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { points: [{ lat: '34.7', lng: 135.51 }, { lat: 34.7, lng: 135.51 }] }))).toMatchObject({ rule: 'point', index: 0 });
    // 地物は市域＋約 500m まで。東京は外
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 1), { points: [{ lat: 35.68, lng: 139.76 }, { lat: 34.7, lng: 135.51 }, { lat: 34.71, lng: 135.51 }] }))).toMatchObject({ rule: 'outsideArea', index: 1 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { points: [{ lat: CITY.north + 0.01, lng: 135.52 }, { lat: 34.7, lng: 135.51 }] }))).toMatchObject({ rule: 'outsideArea', index: 0 });
    // 緯度と経度の取り違え
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'stations', 0), { lat: 135.51102, lng: 34.6977 }))).toMatchObject({ rule: 'point', index: 0 });
  });

  it('駅と便利施設ポイントは市域の中だけ（地物のような はみ出しは許さない）', () => {
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'stations', 0), { lat: CITY.south - 0.001 }))).toEqual({ file: 'mapFeatures.json', rule: 'outsideArea', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.amenityPoints, 'points', 1), { lng: CITY.east + 0.001 }))).toEqual({ file: 'amenityPoints.json', rule: 'outsideArea', index: 1 });
    expect(detailsOf((f) => Object.assign(itemOf(f.amenityPoints, 'points', 0), { lat: CITY.north, lng: CITY.west }))).toBeUndefined();
  });

  it('文字列項目: 空・制御文字・長すぎ（名前 20 字、路線 40 字、補足 40 字）は失敗する', () => {
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { name: ' ' }))).toMatchObject({ rule: 'name', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { name: 'あ'.repeat(21) }))).toMatchObject({ rule: 'name', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'stations', 0), { name: '南森町\n駅' }))).toMatchObject({ rule: 'name', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'stations', 0), { lines: 'あ'.repeat(41) }))).toMatchObject({ rule: 'lines', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.amenityPoints, 'points', 0), { name: '' }))).toMatchObject({ rule: 'name', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.amenityPoints, 'points', 0), { note: 'あ'.repeat(41) }))).toMatchObject({ rule: 'note', index: 0 });
    expect(detailsOf((f) => Object.assign(itemOf(f.amenityPoints, 'points', 0), { note: undefined }))).toMatchObject({ rule: 'note', index: 0 });
  });

  it('レコードがオブジェクトでなければ shape で失敗し、エラーに値を入れない', () => {
    expect(detailsOf((f) => Object.assign(f.mapFeatures, { features: ['f_okawa'] }))).toEqual({ file: 'mapFeatures.json', rule: 'shape', index: 0 });
    const details = detailsOf((f) => Object.assign(itemOf(f.mapFeatures, 'features', 0), { name: '秘密の<script>' + 'あ'.repeat(30) }));
    expect(JSON.stringify(details)).not.toContain('script');
  });
});
