import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId, parseRivalId, parseSpotId } from '@/Common/types/Id';
import { MasterDataLoader, sha256Hex } from '@/infrastructure/master/MasterDataLoader';
import type { FetchText } from '@/infrastructure/master/MasterDataLoader';
import { MASTER_FILE_NAMES } from '@/infrastructure/master/masterValidators';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

/** JSON の一部を書き換えられるようにした、可変なマスタの写し */
type MutableJson = Record<string, unknown>;

const FILE_NAMES: readonly string[] = Object.values(MASTER_FILE_NAMES);
const MASTER_DIR = resolve(process.cwd(), 'public/master');

/** テスト用: public/master の実ファイルの本文 */
function realTexts(): Map<string, string> {
  return new Map(FILE_NAMES.map((name) => [name, readFileSync(resolve(MASTER_DIR, name), 'utf8')]));
}

/** テスト用: 本文の表から取得関数を作る */
function fetchFrom(texts: ReadonlyMap<string, string>): FetchText {
  return async (fileName: string): Promise<Result<string>> => {
    const text = texts.get(fileName);
    return text === undefined ? fail(AppError.of('NOT_FOUND', 'x')) : ok(text);
  };
}

/** テスト用: 1ファイルの JSON を書き換えた取得関数を作る */
function fetchWith(fileName: string, edit: (json: MutableJson) => void): FetchText {
  const texts = realTexts();
  const json = JSON.parse(texts.get(fileName) ?? '') as MutableJson;
  edit(json);
  texts.set(fileName, JSON.stringify(json));
  return fetchFrom(texts);
}

/** テスト用: JSON の配列項目を取り出す */
function itemsOf(json: MutableJson, field: string): MutableJson[] {
  return json[field] as MutableJson[];
}

/** テスト用: public/master の実ファイル1つを JSON として読む */
function realJson(fileName: string): MutableJson {
  return JSON.parse(realTexts().get(fileName) ?? '') as MutableJson;
}

/** テスト用: 読込を実行し、失敗の details を返す */
async function failureOf(fetchText: FetchText): Promise<{ code: string; details: Readonly<Record<string, unknown>> | undefined }> {
  const result = await MasterDataLoader.load(fetchText);
  if (result.ok) throw new Error('成功してしまった');
  return { code: result.error.code, details: result.error.details };
}

describe('MasterDataLoader（実ファイル）', () => {
  it('public/master の7ファイルを読み、地区5・名所14・店舗66（大阪・南森町周辺＝docs/08 §9）のリポジトリを作る', async () => {
    const loaded = must(await MasterDataLoader.load(fetchFrom(realTexts())));
    const spots = loaded.spots.allSpots();
    expect(loaded.spots.allDistricts()).toHaveLength(5);
    expect(spots.filter((s) => s.kind === 'landmark')).toHaveLength(14);
    expect(spots.filter((s) => s.kind === 'shop')).toHaveLength(66);
    expect(loaded.spots.allDistricts().map((d) => d.id)).toEqual(['d_minamimori', 'd_tenma', 'd_tenroku', 'd_ogimachi', 'd_okawa']);
    expect(loaded.spots.findSpot(must(parseSpotId('l_mm01')))?.name).toBe('大阪天満宮');
    expect(loaded.spots.findDistrict(must(parseDistrictId('d_minamimori')))?.color).toBe('#6366f1');
    const inOgimachi = [...itemsOf(realJson('landmarks.json'), 'landmarks'), ...itemsOf(realJson('shops.json'), 'shops')].filter((s) => s['districtId'] === 'd_ogimachi');
    expect(loaded.spots.spotsInDistrict(must(parseDistrictId('d_ogimachi')))).toHaveLength(inOgimachi.length);
    expect(loaded.spots.allShopEvents()).toHaveLength(itemsOf(realJson('shopEvents.json'), 'shopEvents').length);
    expect(loaded.spots.shopEventsForSpot(must(parseSpotId('s_mm02'))).map((e) => e.id)).toContain('c_mm01');
    expect(loaded.spots.cityBounds()).toEqual({ south: 34.6895, west: 135.501, north: 34.714, east: 135.5245 });
  });

  it('地図の背景（地物・駅・便利施設ポイント）と出典を読み込む（docs/08 §9）', async () => {
    const loaded = must(await MasterDataLoader.load(fetchFrom(realTexts())));
    const backdrop = loaded.spots.backdrop();
    const mapFeatures = realJson('mapFeatures.json');
    expect(backdrop.attribution).toBe(mapFeatures['attribution']);
    expect(backdrop.attribution).toContain('OpenStreetMap');
    expect(backdrop.features).toHaveLength(itemsOf(mapFeatures, 'features').length);
    expect(backdrop.features.some((f) => f.kind === 'water' && f.shape === 'line' && f.widthM !== undefined)).toBe(true);
    expect(backdrop.stations).toHaveLength(itemsOf(mapFeatures, 'stations').length);
    expect(backdrop.stations.map((s) => s.name)).toContain('南森町');
    expect(backdrop.amenityPoints).toHaveLength(itemsOf(realJson('amenityPoints.json'), 'points').length);
    expect(backdrop.amenityPoints.some((p) => p.kind === 'toilet')).toBe(true);
    expect(Object.isFrozen(backdrop)).toBe(true);
    expect(loaded.spots.backdrop()).toBe(backdrop);
  });

  it('ライバルを ID 昇順で返し、ID で引ける', async () => {
    const loaded = must(await MasterDataLoader.load(fetchFrom(realTexts())));
    const ids = loaded.rivals.allRivals().map((r) => r.id);
    expect(ids).toHaveLength(7);
    expect(ids).toEqual([...ids].sort());
    expect(loaded.rivals.findRival(must(parseRivalId('r_taro')))?.name).toBe('旅人タロウ');
    expect(loaded.rivals.findRival(must(parseRivalId('r_none')))).toBeUndefined();
  });

  it('クーポン・イベントの地区はスポットの地区から決まる', async () => {
    const loaded = must(await MasterDataLoader.load(fetchFrom(realTexts())));
    for (const event of loaded.spots.allShopEvents()) {
      expect(event.districtId).toBe(loaded.spots.findSpot(event.spotId)?.districtId);
    }
  });
});

describe('MasterDataLoader（改変したマスタを拒否する＝DI-13, SEC-22）', () => {
  it('店舗を1件消すと件数違反で失敗する（T-07）', async () => {
    const failure = await failureOf(fetchWith('shops.json', (json) => itemsOf(json, 'shops').pop()));
    expect(failure).toEqual({ code: 'MASTER_INVALID', details: { file: 'shops.json', rule: 'count' } });
  });

  it('地区を1件消すと失敗する', async () => {
    const failure = await failureOf(fetchWith('districts.json', (json) => itemsOf(json, 'districts').pop()));
    expect(failure.details).toMatchObject({ file: 'districts.json', rule: 'count' });
  });

  it('ID の形式が不正なら失敗する（SEC-16）', async () => {
    const failure = await failureOf(fetchWith('shops.json', (json) => Object.assign(itemsOf(json, 'shops')[0] ?? {}, { id: 'S_JO01' })));
    expect(failure.details).toEqual({ file: 'shops.json', rule: 'id', index: 0 });
  });

  it('店舗ファイルに名所の ID（l_）があれば失敗する', async () => {
    const failure = await failureOf(fetchWith('shops.json', (json) => Object.assign(itemsOf(json, 'shops')[3] ?? {}, { id: 'l_mm09' })));
    expect(failure.details).toEqual({ file: 'shops.json', rule: 'kind', index: 3 });
  });

  it('スポット ID が重複していれば失敗する', async () => {
    const failure = await failureOf(fetchWith('shops.json', (json) => Object.assign(itemsOf(json, 'shops')[1] ?? {}, { id: itemsOf(json, 'shops')[0]?.['id'] })));
    expect(failure.details).toMatchObject({ rule: 'duplicateId' });
  });

  it('存在しない地区を参照するスポットは失敗する', async () => {
    const failure = await failureOf(fetchWith('landmarks.json', (json) => Object.assign(itemsOf(json, 'landmarks')[0] ?? {}, { districtId: 'd_nowhere' })));
    expect(failure.details).toEqual({ file: 'landmarks.json', rule: 'districtRef', index: 0 });
  });

  it('所属地区のポリゴン外にあるスポットは失敗する', async () => {
    const failure = await failureOf(fetchWith('landmarks.json', (json) => Object.assign(itemsOf(json, 'landmarks')[0] ?? {}, { lat: 35.5, lng: 139.7 })));
    expect(failure.details).toEqual({ file: 'landmarks.json', rule: 'outsideDistrict', index: 0 });
  });

  it('未知の便利情報・色の書式違反は失敗する', async () => {
    const amenity = await failureOf(fetchWith('shops.json', (json) => Object.assign(itemsOf(json, 'shops')[0] ?? {}, { amenities: ['wifi'] })));
    expect(amenity.details).toMatchObject({ rule: 'amenities' });
    const color = await failureOf(fetchWith('districts.json', (json) => Object.assign(itemsOf(json, 'districts')[0] ?? {}, { color: 'purple' })));
    expect(color.details).toMatchObject({ file: 'districts.json', rule: 'color' });
  });

  it('存在しないスポットを参照するクーポン・イベントは失敗する', async () => {
    const failure = await failureOf(fetchWith('shopEvents.json', (json) => Object.assign(itemsOf(json, 'shopEvents')[0] ?? {}, { spotId: 's_mm99' })));
    expect(failure.details).toEqual({ file: 'shopEvents.json', rule: 'spotRef', index: 0 });
  });

  it('開始日が終了日より後・実在しない日付のクーポン・イベントは失敗する', async () => {
    const reversed = await failureOf(fetchWith('shopEvents.json', (json) => Object.assign(itemsOf(json, 'shopEvents')[0] ?? {}, { start: '2027-01-01', end: '2026-01-01' })));
    expect(reversed.details).toMatchObject({ rule: 'period' });
    const invalid = await failureOf(fetchWith('shopEvents.json', (json) => Object.assign(itemsOf(json, 'shopEvents')[0] ?? {}, { end: '2026-02-30' })));
    expect(invalid.details).toMatchObject({ rule: 'period' });
  });

  it('ライバルの背景活動が存在しない地区を参照していれば失敗する', async () => {
    const failure = await failureOf(
      fetchWith('rivals.json', (json) => Object.assign(itemsOf(json, 'rivals')[0] ?? {}, { patterns: [{ districtId: 'd_nowhere', intervalDays: 3, phase: 0 }] })),
    );
    expect(failure.details).toEqual({ file: 'rivals.json', rule: 'districtRef', index: 0 });
  });

  it('地図の背景の地物・便利施設ポイントが不正なら失敗する（ID・種類・座標範囲）', async () => {
    const badId = await failureOf(fetchWith('mapFeatures.json', (json) => Object.assign(itemsOf(json, 'features')[0] ?? {}, { id: 'F_RIVER' })));
    expect(badId).toEqual({ code: 'MASTER_INVALID', details: { file: 'mapFeatures.json', rule: 'id', index: 0 } });
    const farAway = await failureOf(fetchWith('mapFeatures.json', (json) => Object.assign(itemsOf(json, 'stations')[0] ?? {}, { lat: 35.68, lng: 139.76 })));
    expect(farAway.details).toEqual({ file: 'mapFeatures.json', rule: 'outsideArea', index: 0 });
    const badKind = await failureOf(fetchWith('amenityPoints.json', (json) => Object.assign(itemsOf(json, 'points')[0] ?? {}, { kind: 'wifi' })));
    expect(badKind.details).toEqual({ file: 'amenityPoints.json', rule: 'kind', index: 0 });
    const noAttribution = await failureOf(fetchWith('mapFeatures.json', (json) => Object.assign(json, { attribution: '' })));
    expect(noAttribution.details).toEqual({ file: 'mapFeatures.json', rule: 'attribution' });
  });

  it('schemaVersion が 1 でなければ失敗する', async () => {
    const failure = await failureOf(fetchWith('rivals.json', (json) => Object.assign(json, { schemaVersion: 2 })));
    expect(failure.details).toEqual({ file: 'rivals.json', rule: 'schemaVersion' });
  });

  it('壊れた JSON は MASTER_INVALID（rule: json）', async () => {
    const texts = realTexts();
    texts.set('landmarks.json', '{"schemaVersion":1,"landmarks":[');
    const failure = await failureOf(fetchFrom(texts));
    expect(failure).toEqual({ code: 'MASTER_INVALID', details: { file: 'landmarks.json', rule: 'json' } });
  });
});

describe('MasterDataLoader（取得とハッシュ）', () => {
  it('取得に失敗したファイルがあれば MASTER_FETCH_FAILED（地図の背景のファイルも必須）', async () => {
    const texts = realTexts();
    texts.delete('rivals.json');
    const failure = await failureOf(fetchFrom(texts));
    expect(failure).toEqual({ code: 'MASTER_FETCH_FAILED', details: { file: 'rivals.json' } });
    const withoutBackdrop = realTexts();
    withoutBackdrop.delete('amenityPoints.json');
    expect(await failureOf(fetchFrom(withoutBackdrop))).toEqual({ code: 'MASTER_FETCH_FAILED', details: { file: 'amenityPoints.json' } });
  });

  it('地図の背景のファイルが壊れた JSON なら MASTER_INVALID（rule: json）', async () => {
    const texts = realTexts();
    texts.set('mapFeatures.json', '{"schemaVersion":1,"features":[');
    expect(await failureOf(fetchFrom(texts))).toEqual({ code: 'MASTER_INVALID', details: { file: 'mapFeatures.json', rule: 'json' } });
  });

  it('取得関数が reject しても例外を外へ出さず MASTER_FETCH_FAILED', async () => {
    const failure = await failureOf(async () => {
      throw new Error('network');
    });
    expect(failure.code).toBe('MASTER_FETCH_FAILED');
  });

  it('verifyHashes を有効にすると、ハッシュ表と一致すれば成功し、1バイトでも違えば拒否する', async () => {
    const texts = realTexts();
    const hashes: Record<string, string> = {};
    for (const [name, text] of texts) hashes[name] = must(await sha256Hex(text));
    const loader = new MasterDataLoader({ verifyHashes: true, hashes });
    expect((await loader.load(fetchFrom(texts))).ok).toBe(true);
    texts.set('shops.json', `${texts.get('shops.json') ?? ''} `);
    const tampered = await loader.load(fetchFrom(texts));
    expect(tampered.ok ? undefined : tampered.error.details).toEqual({ file: 'shops.json', rule: 'hash' });
  });

  it('既定のハッシュ表（masterHashes.ts）は public/master の実ファイルと一致する', async () => {
    const result = await new MasterDataLoader({ verifyHashes: true }).load(fetchFrom(realTexts()));
    expect(result.ok ? undefined : result.error.details).toBeUndefined();
  });

  it('sha256Hex は既知の値を返す', async () => {
    expect(must(await sha256Hex('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
