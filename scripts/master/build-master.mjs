/**
 * @file マスタデータ生成スクリプト（scripts 層・Node 専用）
 * scripts/master/source/*.mjs の原データ（緯度経度 [lat, lng] を直接持つ）を小数6桁に丸め、public/master の
 * districts / landmarks / shops / shopEvents / rivals / mapFeatures / amenityPoints / master.schema.json を書き出す。
 * 出力は決定論的（同じ原データから同じバイト列）なので、再生成しても masterHashes.ts は変わらない。
 * 2026-11-09: 舞台を大阪・南森町周辺に変更（docs/08 §9）。原データをメートル座標から緯度経度に変え、背景と便利施設ポイントを追加。
 * 使い方: node scripts/master/build-master.mjs（npm run master:build）→ master:check → master:hash
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CITY_ORIGIN, latLngOf } from './lib/geo.mjs';
import { toJsonFileText } from './lib/jsonFormat.mjs';
import { printLine } from './lib/cliOutput.mjs';
import { DATA_FILES, MASTER_DIR, SCHEMA_FILE, isDirectRun } from './lib/masterFiles.mjs';
import { AMENITY_POINT_SOURCES } from './source/amenityPoints.mjs';
import { CITY_BOUNDS, CITY_NAME, DISTRICT_CODES, DISTRICT_SOURCES } from './source/districts.mjs';
import { LANDMARK_SOURCES } from './source/landmarks.mjs';
import { MAP_ATTRIBUTION, MAP_FEATURE_SOURCES, STATION_SOURCES } from './source/mapFeatures.mjs';
import { RIVAL_SOURCES } from './source/rivals.mjs';
import { MASTER_SCHEMA, MASTER_SCHEMA_VERSION } from './source/schema.mjs';
import { SHOP_EVENT_SOURCES } from './source/shopEvents.mjs';
import { SHOP_SOURCES } from './source/shops.mjs';
import { createCliLogger } from './lib/cliLog.mjs';

const logger = createCliLogger('scripts/master/build-master');

/**
 * スポットID の地区2字（l_mm01 → mm）から地区ID を引く。
 * 原データに districtId を重複して書かず、ID の命名規則（docs/08 §9.1）から一意に決めるため。
 * @param {string} spotId スポットID（例: 's_tm03'）
 * @returns {string} 地区ID（例: 'd_tenma'）
 * @throws {Error} 地区2字が未知のとき（原データの誤り＝生成を止めるべきバグ）
 */
export function districtIdOfSpot(spotId) {
  const log = logger.fn('districtIdOfSpot', { spotId });
  const code = spotId.slice(2, 4);
  const districtId = DISTRICT_CODES[code];
  if (!districtId) throw new Error(`スポットID ${spotId} の地区2字 "${code}" が未知です`);
  return log.exit(districtId);
}

/**
 * 舞台（名前・原点・範囲）の出力オブジェクトを作る。原点は南森町駅（メートル座標の基準）。
 * @returns {{name: string, origin: {lat: number, lng: number}, bounds: {south: number, west: number, north: number, east: number}}} 舞台の定義
 */
function buildCity() {
  const log = logger.fn('buildCity');
  return log.exit({
    name: CITY_NAME,
    origin: { lat: CITY_ORIGIN.lat, lng: CITY_ORIGIN.lng },
    bounds: { south: CITY_BOUNDS.south, west: CITY_BOUNDS.west, north: CITY_BOUNDS.north, east: CITY_BOUNDS.east },
  });
}

/**
 * districts.json の内容を作る（order 順）。
 * @returns {object} { schemaVersion, city, districts }
 */
export function buildDistrictsFile() {
  const log = logger.fn('buildDistrictsFile', { sources: DISTRICT_SOURCES.length });
  const districts = [...DISTRICT_SOURCES]
    .sort((a, b) => a.order - b.order)
    .map((d) => ({
      id: d.id,
      name: d.name,
      shortName: d.shortName,
      theme: d.theme,
      order: d.order,
      color: d.color,
      center: latLngOf(d.center),
      entrance: latLngOf(d.entrance),
      polygon: d.polygon.map((p) => latLngOf(p)),
    }));
  return log.exit({ schemaVersion: MASTER_SCHEMA_VERSION, city: buildCity(), districts }, `districts=${districts.length}`);
}

/**
 * 文字列をコードポイント順で比較する（ロケールに依存しない決定論的な並び順のため）。
 * @param {string} a 文字列A
 * @param {string} b 文字列B
 * @returns {number} a<b なら負、a>b なら正、等しければ 0
 */
function compareText(a, b) { // audit-ignore: fnlog-missing sort の比較関数として多数回呼ばれる純粋ヘルパー（呼び出し側でまとめて記録）
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * 地区の order を引く表を作る（スポットの並び順に使う）。
 * @returns {Map<string, number>} 地区ID → order
 */
function districtOrderMap() {
  return new Map(DISTRICT_SOURCES.map((d) => [d.id, d.order]));
}

/**
 * スポットの原データ1件を出力形式（キー順固定）に変換する。
 * @param {{id: string, name: string, at: [number, number], category: string, description: string, amenities: string[], hours: string, partner?: boolean}} source 原データ（at は [緯度, 経度]）
 * @param {boolean} partner 店舗協力の有無（名所は常に false）
 * @returns {object} { id, districtId, name, lat, lng, category, description, amenities, hours, partner }
 */
function toSpotRecord(source, partner) {
  const log = logger.fn('toSpotRecord', { spotId: source.id, partner });
  const { lat, lng } = latLngOf(source.at);
  return log.exit({
    id: source.id,
    districtId: districtIdOfSpot(source.id),
    name: source.name,
    lat,
    lng,
    category: source.category,
    description: source.description,
    amenities: [...source.amenities],
    hours: source.hours,
    partner,
  });
}

/**
 * スポットを地区の order → ID の順に並べる（出力を決定論的にするため）。
 * @param {object[]} records スポットの出力オブジェクト
 * @returns {object[]} 並べ替えた新しい配列
 */
function sortSpots(records) {
  const log = logger.fn('sortSpots', { count: records.length });
  const order = districtOrderMap();
  const sorted = [...records].sort(
    (a, b) => (order.get(a.districtId) ?? 0) - (order.get(b.districtId) ?? 0) || compareText(a.id, b.id),
  );
  return log.exit(sorted, `count=${sorted.length}`);
}

/**
 * landmarks.json の内容を作る。名所は店舗協力の対象外なので partner は false。
 * @returns {object} { schemaVersion, landmarks }
 */
export function buildLandmarksFile() {
  const log = logger.fn('buildLandmarksFile', { sources: LANDMARK_SOURCES.length });
  const landmarks = sortSpots(LANDMARK_SOURCES.map((s) => toSpotRecord(s, false)));
  return log.exit({ schemaVersion: MASTER_SCHEMA_VERSION, landmarks }, `landmarks=${landmarks.length}`);
}

/**
 * shops.json の内容を作る。
 * @returns {object} { schemaVersion, shops }
 */
export function buildShopsFile() {
  const log = logger.fn('buildShopsFile', { sources: SHOP_SOURCES.length });
  const shops = sortSpots(SHOP_SOURCES.map((s) => toSpotRecord(s, s.partner === true)));
  return log.exit({ schemaVersion: MASTER_SCHEMA_VERSION, shops }, `shops=${shops.length}`);
}

/**
 * shopEvents.json の内容を作る（ID 順）。
 * @returns {object} { schemaVersion, shopEvents }
 */
export function buildShopEventsFile() {
  const log = logger.fn('buildShopEventsFile', { sources: SHOP_EVENT_SOURCES.length });
  const shopEvents = [...SHOP_EVENT_SOURCES]
    .sort((a, b) => compareText(a.id, b.id))
    .map((e) => ({ id: e.id, spotId: e.spotId, kind: e.kind, title: e.title, description: e.description, start: e.start, end: e.end }));
  return log.exit({ schemaVersion: MASTER_SCHEMA_VERSION, shopEvents }, `shopEvents=${shopEvents.length}`);
}

/**
 * rivals.json の内容を作る（原データの順＝docs/08 §9.3 の順）。
 * @returns {object} { schemaVersion, rivals }
 */
export function buildRivalsFile() {
  const log = logger.fn('buildRivalsFile', { sources: RIVAL_SOURCES.length });
  const rivals = RIVAL_SOURCES.map((r) => ({
    id: r.id,
    name: r.name,
    patterns: r.patterns.map((p) => ({ districtId: p.districtId, intervalDays: p.intervalDays, phase: p.phase })),
  }));
  return log.exit({ schemaVersion: MASTER_SCHEMA_VERSION, rivals }, `rivals=${rivals.length}`);
}

/**
 * 背景地物の原データ1件を出力形式（キー順固定。widthM は line のときだけ）に変換する。
 * @param {{id: string, kind: string, name: string, shape: string, widthM?: number, points: Array<[number, number]>}} source 原データ
 * @returns {object} { id, kind, name, shape, widthM?, points }
 */
function toFeatureRecord(source) {
  const log = logger.fn('toFeatureRecord', { featureId: source.id });
  const record = { id: source.id, kind: source.kind, name: source.name, shape: source.shape };
  if (source.widthM !== undefined) record.widthM = source.widthM;
  record.points = source.points.map((p) => latLngOf(p));
  return log.exit(record);
}

/**
 * mapFeatures.json の内容を作る（地物は原データの順＝描画順、駅は原データの順）。
 * @returns {object} { schemaVersion, attribution, features, stations }
 */
export function buildMapFeaturesFile() {
  const log = logger.fn('buildMapFeaturesFile', { features: MAP_FEATURE_SOURCES.length, stations: STATION_SOURCES.length });
  const features = MAP_FEATURE_SOURCES.map((f) => toFeatureRecord(f));
  const stations = STATION_SOURCES.map((s) => ({ id: s.id, name: s.name, ...latLngOf(s.at), lines: s.lines }));
  return log.exit({ schemaVersion: MASTER_SCHEMA_VERSION, attribution: MAP_ATTRIBUTION, features, stations }, `features=${features.length}`);
}

/**
 * amenityPoints.json の内容を作る（原データの順）。
 * @returns {object} { schemaVersion, attribution, points }
 */
export function buildAmenityPointsFile() {
  const log = logger.fn('buildAmenityPointsFile', { sources: AMENITY_POINT_SOURCES.length });
  const points = AMENITY_POINT_SOURCES.map((a) => ({ id: a.id, kind: a.kind, name: a.name, ...latLngOf(a.at), note: a.note }));
  return log.exit({ schemaVersion: MASTER_SCHEMA_VERSION, attribution: MAP_ATTRIBUTION, points }, `points=${points.length}`);
}

/**
 * 全マスタファイルの本文（LF 改行・末尾改行あり）を作る。ファイルには書かない。
 * check-master.mjs が「public/master が原データから再生成した結果と一致するか」の確認にも使う。
 * @returns {Map<string, string>} ファイル名 → 本文
 */
export function renderMasterFiles() {
  const log = logger.fn('renderMasterFiles');
  const objects = {
    'districts.json': buildDistrictsFile(),
    'landmarks.json': buildLandmarksFile(),
    'shops.json': buildShopsFile(),
    'shopEvents.json': buildShopEventsFile(),
    'rivals.json': buildRivalsFile(),
    'mapFeatures.json': buildMapFeaturesFile(),
    'amenityPoints.json': buildAmenityPointsFile(),
    [SCHEMA_FILE]: MASTER_SCHEMA,
  };
  const files = new Map([...DATA_FILES, SCHEMA_FILE].map((name) => [name, toJsonFileText(objects[name])]));
  return log.exit(files, `files=${files.size}`);
}

/**
 * マスタファイルを public/master に書き出し、件数の要約を表示する。
 * @param {string} [outDir] 出力先（既定は public/master）
 * @returns {Map<string, string>} 書いたファイル名 → 本文
 * @sideEffect ディレクトリ作成とファイル書込み、標準出力
 */
export function writeMasterFiles(outDir = MASTER_DIR) {
  const log = logger.fn('writeMasterFiles');
  const files = renderMasterFiles();
  mkdirSync(outDir, { recursive: true });
  for (const [name, text] of files) writeFileSync(resolve(outDir, name), text, 'utf8');
  return log.exit(files, `files=${files.size}`);
}

/**
 * コマンドラインの入口。生成して要約を表示する。
 * @returns {void}
 * @sideEffect public/master への書込み、標準出力
 */
function main() {
  const log = logger.fn('main');
  const files = writeMasterFiles();
  printLine(`public/master に ${files.size} ファイルを書き出しました:`);
  for (const [name, text] of files) printLine(`  ${name.padEnd(20)} ${Buffer.byteLength(text, 'utf8')} bytes`);
  printLine(
    `  地区 ${DISTRICT_SOURCES.length} / 名所 ${LANDMARK_SOURCES.length} / 店舗 ${SHOP_SOURCES.length}` +
      ` / クーポン・イベント ${SHOP_EVENT_SOURCES.length} / ライバル ${RIVAL_SOURCES.length}` +
      ` / 背景 ${MAP_FEATURE_SOURCES.length}・駅 ${STATION_SOURCES.length} / 便利施設ポイント ${AMENITY_POINT_SOURCES.length}`,
  );
  printLine('次に npm run master:check で検証し、npm run master:hash でハッシュを更新してください。');
  log.exit(undefined);
}

if (isDirectRun(import.meta.url)) main();
