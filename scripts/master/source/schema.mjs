/**
 * @file public/master/master.schema.json の原データ（JSON Schema draft 2020-12・scripts 層）
 * 7ファイル（districts / landmarks / shops / shopEvents / rivals / mapFeatures / amenityPoints）の構造を $defs に定義する。
 * build-master.mjs がそのまま書き出し、check-master.mjs が lib/jsonSchemaLite.mjs で各ファイルを検証する（docs/03 §11）。
 * ID の正規表現は docs/08 §2（SEC-16）・§9（背景 f_／駅 st_／便利施設 a_）、件数は DI-13 / SEC-22 に合わせる。
 * 2026-11-09: 舞台を南森町周辺に変更（docs/08 §9）。地区テーマを差し替え、mapFeatures / amenityPoints を追加。
 */

/** マスタの schemaVersion（現行） */
export const MASTER_SCHEMA_VERSION = 1;

/** 便利情報コード（docs/08 §3.2 AMENITIES と同じ順） */
export const AMENITY_CODES = Object.freeze(['kids', 'toilet', 'nursing', 'stroller', 'rainOk', 'parking']);

/** 地区テーマ（docs/08 §9.1） */
export const DISTRICT_THEMES = Object.freeze(['門前町', '市場と食', '暮らし', '公園と路地', '川辺と桜']);

/** 背景地物の種類（src/domain/spot/MapBackdrop.ts の MAP_FEATURE_KINDS と同じ） */
export const MAP_FEATURE_KINDS = Object.freeze(['water', 'park', 'shrine', 'campus', 'arcade', 'road', 'rail']);

/** 背景地物の形（line=折れ線を widthM の太さで描く、area=多角形） */
export const MAP_FEATURE_SHAPES = Object.freeze(['line', 'area']);

/** 便利施設ポイントの種類（src/domain/spot/MapBackdrop.ts の AMENITY_POINT_KINDS と同じ） */
export const AMENITY_POINT_KINDS = Object.freeze(['toilet', 'nursing', 'aed']);

/** 背景地物1件の頂点数の上限（area は 40 点以内に間引く。docs/08 §9） */
export const MAX_FEATURE_POINTS = 40;

/** スキーマ上のファイル名と $defs 名の対応（check-master.mjs が使う） */
export const FILE_DEFINITIONS = Object.freeze({
  'districts.json': 'DistrictsFile',
  'landmarks.json': 'LandmarksFile',
  'shops.json': 'ShopsFile',
  'shopEvents.json': 'ShopEventsFile',
  'rivals.json': 'RivalsFile',
  'mapFeatures.json': 'MapFeaturesFile',
  'amenityPoints.json': 'AmenityPointsFile',
});

/**
 * 「配列を1つ持つマスタファイル」のスキーマを作る。
 * @param {{key: string, itemRef: string, minItems: number, maxItems: number, description: string}} spec 配列キー・要素定義・件数
 * @returns {object} JSON Schema のオブジェクト定義
 */
function fileSchema({ key, itemRef, minItems, maxItems, description }) { // audit-ignore: fnlog-missing モジュール読込時に定数 MASTER_SCHEMA を組み立てる純粋関数（実行時の呼び出し経路に現れない）
  return {
    type: 'object',
    description,
    required: ['schemaVersion', key],
    additionalProperties: false,
    properties: {
      schemaVersion: { const: MASTER_SCHEMA_VERSION },
      [key]: { type: 'array', minItems, maxItems, items: { $ref: itemRef } },
    },
  };
}

/**
 * 名所・店舗（スポット）のスキーマを作る。名所は partner が常に false。
 * @param {{idRef: string, partner: object, description: string}} spec ID 定義の参照・partner の制約・説明
 * @returns {object} JSON Schema のオブジェクト定義
 */
function spotSchema({ idRef, partner, description }) { // audit-ignore: fnlog-missing モジュール読込時に定数 MASTER_SCHEMA を組み立てる純粋関数（実行時の呼び出し経路に現れない）
  return {
    type: 'object',
    description,
    required: ['id', 'districtId', 'name', 'lat', 'lng', 'category', 'description', 'amenities', 'hours', 'partner'],
    additionalProperties: false,
    properties: {
      id: { $ref: idRef },
      districtId: { $ref: '#/$defs/DistrictId' },
      name: { type: 'string', minLength: 1, maxLength: 20 },
      lat: { $ref: '#/$defs/Latitude' },
      lng: { $ref: '#/$defs/Longitude' },
      category: { type: 'string', minLength: 1, maxLength: 12 },
      description: { type: 'string', minLength: 40, maxLength: 70, description: '40〜70字の紹介文' },
      amenities: { type: 'array', maxItems: AMENITY_CODES.length, uniqueItems: true, items: { $ref: '#/$defs/Amenity' } },
      hours: { type: 'string', minLength: 1, maxLength: 40, description: "例: '10:00–18:00（水休）'" },
      partner: partner,
    },
  };
}

/** 地区の定義 */
const DISTRICT_DEF = {
  type: 'object',
  required: ['id', 'name', 'shortName', 'theme', 'order', 'color', 'center', 'entrance', 'polygon'],
  additionalProperties: false,
  properties: {
    id: { $ref: '#/$defs/DistrictId' },
    name: { type: 'string', minLength: 1, maxLength: 20 },
    shortName: { type: 'string', minLength: 1, maxLength: 8 },
    theme: { enum: [...DISTRICT_THEMES] },
    order: { type: 'integer', minimum: 1, maximum: 99 },
    color: { type: 'string', pattern: '^#[0-9a-f]{6}$' },
    center: { $ref: '#/$defs/LatLng' },
    entrance: { $ref: '#/$defs/LatLng', description: 'デモの位置リセット先。どのスポットからも 85m 以上離す' },
    polygon: { type: 'array', minItems: 5, maxItems: 8, items: { $ref: '#/$defs/LatLng' } },
  },
};

/** 市（舞台の範囲）の定義 */
const CITY_DEF = {
  type: 'object',
  required: ['name', 'origin', 'bounds'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 20 },
    origin: { $ref: '#/$defs/LatLng' },
    bounds: {
      type: 'object',
      required: ['south', 'west', 'north', 'east'],
      additionalProperties: false,
      properties: {
        south: { $ref: '#/$defs/Latitude' },
        west: { $ref: '#/$defs/Longitude' },
        north: { $ref: '#/$defs/Latitude' },
        east: { $ref: '#/$defs/Longitude' },
      },
    },
  },
};

/** クーポン・イベントの定義 */
const SHOP_EVENT_DEF = {
  type: 'object',
  required: ['id', 'spotId', 'kind', 'title', 'description', 'start', 'end'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^c_[0-9a-z]{2,16}$' },
    spotId: { $ref: '#/$defs/SpotId' },
    kind: { enum: ['coupon', 'event'] },
    title: { type: 'string', minLength: 1, maxLength: 30 },
    description: { type: 'string', minLength: 1, maxLength: 80 },
    start: { $ref: '#/$defs/LocalDate' },
    end: { $ref: '#/$defs/LocalDate' },
  },
};

/** ライバルの定義 */
const RIVAL_DEF = {
  type: 'object',
  required: ['id', 'name', 'patterns'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^r_[0-9a-z]{2,16}$' },
    name: { type: 'string', minLength: 1, maxLength: 20 },
    patterns: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        required: ['districtId', 'intervalDays', 'phase'],
        additionalProperties: false,
        properties: {
          districtId: { $ref: '#/$defs/DistrictId' },
          intervalDays: { type: 'integer', minimum: 1, maximum: 60 },
          phase: { type: 'integer', minimum: 0, maximum: 59, description: '0..intervalDays-1' },
        },
      },
    },
  },
};

/** 背景地物の定義（line は widthM を持つ。area の3点以上は check-master.mjs が検証） */
const MAP_FEATURE_DEF = {
  type: 'object',
  required: ['id', 'kind', 'name', 'shape', 'points'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^f_[0-9a-z_]{2,24}$' },
    kind: { enum: [...MAP_FEATURE_KINDS] },
    name: { type: 'string', minLength: 1, maxLength: 20 },
    shape: { enum: [...MAP_FEATURE_SHAPES] },
    widthM: { type: 'number', minimum: 1, maximum: 300, description: 'line の太さ（メートル）' },
    points: { type: 'array', minItems: 2, maxItems: MAX_FEATURE_POINTS, items: { $ref: '#/$defs/LatLng' } },
  },
};

/** 駅の定義 */
const STATION_DEF = {
  type: 'object',
  required: ['id', 'name', 'lat', 'lng', 'lines'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^st_[0-9a-z_]{2,24}$' },
    name: { type: 'string', minLength: 1, maxLength: 20 },
    lat: { $ref: '#/$defs/Latitude' },
    lng: { $ref: '#/$defs/Longitude' },
    lines: { type: 'string', minLength: 1, maxLength: 40, description: '路線名（表示用）' },
  },
};

/** 便利施設ポイントの定義 */
const AMENITY_POINT_DEF = {
  type: 'object',
  required: ['id', 'kind', 'name', 'lat', 'lng', 'note'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^a_[0-9a-z_]{2,24}$' },
    kind: { enum: [...AMENITY_POINT_KINDS] },
    name: { type: 'string', minLength: 1, maxLength: 20 },
    lat: { $ref: '#/$defs/Latitude' },
    lng: { $ref: '#/$defs/Longitude' },
    note: { type: 'string', maxLength: 40, description: '補足（例: 扇町公園内）' },
  },
};

/** 部品（値の型）の定義 */
const PRIMITIVE_DEFS = {
  Latitude: { type: 'number', minimum: -90, maximum: 90 },
  Longitude: { type: 'number', minimum: -180, maximum: 180 },
  LatLng: {
    type: 'object',
    required: ['lat', 'lng'],
    additionalProperties: false,
    properties: { lat: { $ref: '#/$defs/Latitude' }, lng: { $ref: '#/$defs/Longitude' } },
  },
  DistrictId: { type: 'string', pattern: '^d_[0-9a-z]{2,16}$' },
  SpotId: { type: 'string', pattern: '^[ls]_[0-9a-z]{2,16}$' },
  LandmarkId: { type: 'string', pattern: '^l_[0-9a-z]{2,16}$' },
  ShopId: { type: 'string', pattern: '^s_[0-9a-z]{2,16}$' },
  Amenity: { enum: [...AMENITY_CODES], description: '子連れ歓迎/トイレ/授乳室/ベビーカーOK/雨の日OK/駐車場' },
  LocalDate: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', description: 'JST 暦日 YYYY-MM-DD' },
};

/** 背景（mapFeatures.json）のファイル定義 */
const MAP_FEATURES_FILE_DEF = {
  type: 'object',
  description: 'mapFeatures.json（地図の背景と駅。© OpenStreetMap contributors）',
  required: ['schemaVersion', 'attribution', 'features', 'stations'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: MASTER_SCHEMA_VERSION },
    attribution: { type: 'string', minLength: 1, maxLength: 80 },
    features: { type: 'array', minItems: 1, maxItems: 200, items: { $ref: '#/$defs/MapFeature' } },
    stations: { type: 'array', minItems: 0, maxItems: 50, items: { $ref: '#/$defs/Station' } },
  },
};

/** 便利施設ポイント（amenityPoints.json）のファイル定義 */
const AMENITY_POINTS_FILE_DEF = {
  type: 'object',
  description: 'amenityPoints.json（公衆トイレ・授乳室など。スポットではない）',
  required: ['schemaVersion', 'attribution', 'points'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: MASTER_SCHEMA_VERSION },
    attribution: { type: 'string', minLength: 1, maxLength: 80 },
    points: { type: 'array', minItems: 0, maxItems: 200, items: { $ref: '#/$defs/AmenityPoint' } },
  },
};

/** master.schema.json の本体 */
export const MASTER_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:nnishi-kayoimachi:master-schema:1',
  title: '南森町周辺 マスタデータ',
  description:
    'public/master の7ファイルの構造（ドキュメント用）。各ファイルは $defs の対応する *File 定義に従う。' +
    '件数・参照整合・座標の配置は scripts/master/check-master.mjs と MasterDataLoader が検証する（DI-13, SEC-22）。',
  anyOf: Object.values(FILE_DEFINITIONS).map((name) => ({ $ref: `#/$defs/${name}` })),
  $defs: {
    DistrictsFile: {
      type: 'object',
      description: 'districts.json',
      required: ['schemaVersion', 'city', 'districts'],
      additionalProperties: false,
      properties: {
        schemaVersion: { const: MASTER_SCHEMA_VERSION },
        city: { $ref: '#/$defs/City' },
        districts: { type: 'array', minItems: 5, maxItems: 5, items: { $ref: '#/$defs/District' } },
      },
    },
    LandmarksFile: fileSchema({
      key: 'landmarks', itemRef: '#/$defs/Landmark', minItems: 14, maxItems: 14, description: 'landmarks.json',
    }),
    ShopsFile: fileSchema({ key: 'shops', itemRef: '#/$defs/Shop', minItems: 66, maxItems: 66, description: 'shops.json' }),
    ShopEventsFile: fileSchema({
      key: 'shopEvents', itemRef: '#/$defs/ShopEvent', minItems: 0, maxItems: 200, description: 'shopEvents.json',
    }),
    RivalsFile: fileSchema({ key: 'rivals', itemRef: '#/$defs/Rival', minItems: 1, maxItems: 50, description: 'rivals.json' }),
    MapFeaturesFile: MAP_FEATURES_FILE_DEF,
    AmenityPointsFile: AMENITY_POINTS_FILE_DEF,
    City: CITY_DEF,
    District: DISTRICT_DEF,
    Landmark: spotSchema({ idRef: '#/$defs/LandmarkId', partner: { const: false }, description: '名所' }),
    Shop: spotSchema({ idRef: '#/$defs/ShopId', partner: { type: 'boolean' }, description: '店舗' }),
    ShopEvent: SHOP_EVENT_DEF,
    Rival: RIVAL_DEF,
    MapFeature: MAP_FEATURE_DEF,
    Station: STATION_DEF,
    AmenityPoint: AMENITY_POINT_DEF,
    ...PRIMITIVE_DEFS,
  },
});
