/**
 * @file マスタデータの検証ルール群（scripts 層・純粋関数）
 * JSON.parse 済みのマスタ（districts / landmarks / shops / shopEvents / rivals / mapFeatures / amenityPoints / master.schema.json）を受け取り、
 * スキーマ・件数・ID・参照整合・座標配置（地区・川）・デモ動線・日付・ライバル・背景・便利施設ポイント・文言を検証して違反を列挙する
 * （DI-13, SEC-22, SEC-16）。ファイル入出力は持たない（check-master.mjs が担当）。距離は2つの計算法の厳しい側で判定し、アプリ側の実装差に耐える。
 * 2026-11-09: 舞台を南森町周辺に変更（docs/08 §9）。海の検証を川（中心線から 60m）の検証に置き換え、背景・便利施設ポイントの検証を追加。
 */
import {
  distanceBounds, distanceToBoundary, distanceToPolyline, isSimplePolygon, pointInPolygon, polygonGap, polygonsOverlap,
  samplePath, toLatLng, toMeters,
} from './geo.mjs';
import { resolveRef, validateSchema } from './jsonSchemaLite.mjs';
import {
  DEMO_KNOWN_START_SPOTS, EXPECTED_ATTRIBUTION, EXPECTED_BOUNDS, EXPECTED_CITY_NAME, EXPECTED_DISTRICTS, EXPECTED_ORIGIN,
  EXPECTED_RIVALS, FORBIDDEN_WORDS, ID_PATTERNS, LORD_DISTRICT_ID, NO_BACKGROUND_DISTRICT, REQUIRED_FEATURE_KINDS,
  REQUIRED_FESTIVAL, REQUIRED_LANDMARKS, REQUIRED_SEASON_WINDOWS, REQUIRED_SHOP_EVENTS, REQUIRED_SHOPS, REQUIRED_STATIONS,
  RULES, SIMULATED_MARK, SPOT_NAMING, START_DISTRICT_ID, TENMA_SOUTH_SPOTS, WAGASHI_SPOT_ID,
} from './masterRules.mjs';
import { FILE_DEFINITIONS, MASTER_SCHEMA_VERSION } from '../source/schema.mjs';
import { createCliLogger } from './cliLog.mjs';

const logger = createCliLogger('scripts/master/lib/masterChecks');

/** 隣接地区とみなして隙間を報告する上限（メートル）。離れた地区どうしの距離は報告しない */
const NEIGHBOR_GAP_REPORT_M = 400;

/**
 * 値が配列ならそのまま、そうでなければ空配列を返す（スキーマ違反のデータでも後続の検証を続けるため）。
 * @param {unknown} value 値
 * @returns {any[]} 配列
 */
function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 小数1桁に丸めた距離表記を作る。
 * @param {number} meters 距離（メートル）
 * @returns {string} 例: '96.1m'
 */
function formatMeters(meters) {
  return `${(Math.round(meters * 10) / 10).toFixed(1)}m`;
}

/**
 * 背景地物から川（kind='water' の line）を取り出し、メートル座標の中心線と川幅にする。
 * @param {any[]} features mapFeatures.json の features
 * @returns {Array<{id: string, name: string, widthM: number, line: Array<{x: number, y: number}>}>} 川の一覧
 */
function waterLinesOf(features) {
  const log = logger.fn('waterLinesOf', { features: features.length });
  const lines = features
    .filter((f) => f?.kind === 'water' && f?.shape === 'line')
    .map((f) => ({ id: f.id, name: f.name, widthM: Number(f.widthM) || 0, line: arrayOf(f.points).map((p) => toMeters(p)) }));
  return log.exit(lines, `water=${lines.length}`);
}

/**
 * 検証しやすい索引（地区・スポット・イベント・ライバル・背景・便利施設ポイントの一覧と ID 引き）を作る。
 * @param {Record<string, any>} data ファイル名 → パース済み JSON
 * @returns {object} 索引
 */
export function buildIndex(data) {
  const log = logger.fn('buildIndex', { files: Object.keys(data).length });
  const districts = arrayOf(data['districts.json']?.districts);
  const landmarks = arrayOf(data['landmarks.json']?.landmarks).map((s) => ({ ...s, kind: 'landmark' }));
  const shops = arrayOf(data['shops.json']?.shops).map((s) => ({ ...s, kind: 'shop' }));
  const spots = [...landmarks, ...shops];
  const features = arrayOf(data['mapFeatures.json']?.features);
  return log.exit({
    city: data['districts.json']?.city,
    districts,
    landmarks,
    shops,
    spots,
    districtById: new Map(districts.map((d) => [d.id, d])),
    spotById: new Map(spots.map((s) => [s.id, s])),
    polygonById: new Map(districts.map((d) => [d.id, arrayOf(d.polygon).map((p) => toMeters(p))])),
    shopEvents: arrayOf(data['shopEvents.json']?.shopEvents),
    rivals: arrayOf(data['rivals.json']?.rivals),
    mapFeatures: data['mapFeatures.json'],
    features,
    stations: arrayOf(data['mapFeatures.json']?.stations),
    amenityFile: data['amenityPoints.json'],
    amenityPoints: arrayOf(data['amenityPoints.json']?.points),
    waterLines: waterLinesOf(features),
  }, `spots=${spots.length}`);
}

/**
 * 各データファイルを master.schema.json の対応する $defs 定義で検証する。
 * @param {{errors: string[]}} report 検証結果
 * @param {Record<string, any>} data ファイル名 → パース済み JSON
 * @returns {void}
 * @sideEffect report.errors に追記
 */
export function checkSchema(report, data) {
  const log = logger.fn('checkSchema', { files: Object.keys(data).length });
  const schema = data['master.schema.json'];
  if (!schema || typeof schema !== 'object') {
    report.errors.push('[schema] master.schema.json がありません');
    return log.exit(undefined);
  }
  for (const [file, defName] of Object.entries(FILE_DEFINITIONS)) {
    if (!(file in data)) {
      report.errors.push(`[schema] ${file} がありません`);
      continue;
    }
    const definition = resolveRef(schema, `#/$defs/${defName}`);
    if (!definition) {
      report.errors.push(`[schema] master.schema.json に $defs/${defName} がありません`);
      continue;
    }
    for (const e of validateSchema(schema, data[file], definition)) {
      report.errors.push(`[schema] ${file}${e.path || '/'}: ${e.message}`);
    }
    if (data[file]?.schemaVersion !== MASTER_SCHEMA_VERSION) {
      report.errors.push(`[schema] ${file}: schemaVersion が ${MASTER_SCHEMA_VERSION} ではありません`);
    }
  }
  log.exit(undefined);
}

/**
 * 件数（地区5・名所14・店舗66、地区ごとの名所2〜3・店舗10〜15、docs/08 §9.1 の地区別件数）を検証する（DI-13）。
 * @param {{errors: string[]}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors に追記
 */
export function checkCounts(report, idx) {
  const log = logger.fn('checkCounts', { spots: idx.spots.length });
  const totals = [
    ['地区', idx.districts.length, RULES.DISTRICT_COUNT],
    ['名所', idx.landmarks.length, RULES.LANDMARK_COUNT],
    ['店舗', idx.shops.length, RULES.SHOP_COUNT],
  ];
  for (const [label, actual, expected] of totals) {
    if (actual !== expected) report.errors.push(`[count] ${label}が ${actual} 件です（期待 ${expected} 件）`);
  }
  for (const d of EXPECTED_DISTRICTS) {
    const landmarks = idx.landmarks.filter((s) => s.districtId === d.id).length;
    const shops = idx.shops.filter((s) => s.districtId === d.id).length;
    const { min: lMin, max: lMax } = RULES.LANDMARKS_PER_DISTRICT;
    const { min: sMin, max: sMax } = RULES.SHOPS_PER_DISTRICT;
    if (landmarks < lMin || landmarks > lMax) report.errors.push(`[count] ${d.id} の名所 ${landmarks} 件（${lMin}〜${lMax}）`);
    if (shops < sMin || shops > sMax) report.errors.push(`[count] ${d.id} の店舗 ${shops} 件（${sMin}〜${sMax}）`);
    if (landmarks !== d.landmarks) report.errors.push(`[count] ${d.id} の名所 ${landmarks} 件（docs/08 は ${d.landmarks} 件）`);
    if (shops !== d.shops) report.errors.push(`[count] ${d.id} の店舗 ${shops} 件（docs/08 は ${d.shops} 件）`);
  }
  log.exit(undefined);
}

/**
 * ID の形式（docs/08 §2・§9 の正規表現、§9.1 の命名規則）と一意性を検証する（SEC-16, DI-13）。
 * 背景（f_）・駅（st_）・便利施設ポイント（a_）も同じ名前空間で一意にする。
 * @param {{errors: string[]}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors に追記
 */
export function checkIds(report, idx) {
  const log = logger.fn('checkIds', { spots: idx.spots.length });
  const groups = [
    ['district', idx.districts],
    ['spot', idx.spots],
    ['shopEvent', idx.shopEvents],
    ['rival', idx.rivals],
    ['feature', idx.features],
    ['station', idx.stations],
    ['amenityPoint', idx.amenityPoints],
  ];
  const seen = new Set();
  for (const [kind, records] of groups) {
    for (const record of records) {
      const id = record?.id;
      if (typeof id !== 'string' || !ID_PATTERNS[kind].test(id)) {
        report.errors.push(`[id] ${kind} の ID ${JSON.stringify(id)} が形式に合いません（${ID_PATTERNS[kind]}）`);
        continue;
      }
      if (seen.has(id)) report.errors.push(`[id] ID ${id} が重複しています`);
      seen.add(id);
    }
  }
  for (const spot of idx.spots) checkSpotNaming(report, spot);
  log.exit(undefined);
}

/**
 * スポットID の命名規則（l|s _ 地区2字 連番2桁）と、ID の地区2字・種別が実データと一致するかを検証する。
 * @param {{errors: string[]}} report 検証結果
 * @param {{id: string, kind: string, districtId: string}} spot スポット
 * @returns {void}
 * @sideEffect report.errors に追記
 */
function checkSpotNaming(report, spot) {
  const log = logger.fn('checkSpotNaming', { spotId: spot.id });
  const match = typeof spot.id === 'string' ? SPOT_NAMING.exec(spot.id) : null;
  if (!match) {
    report.errors.push(`[id] スポットID ${JSON.stringify(spot.id)} が命名規則 l|s_<地区2字><連番2桁> に合いません`);
    return log.exit(undefined);
  }
  const expectedPrefix = spot.kind === 'landmark' ? 'l' : 's';
  if (match[1] !== expectedPrefix) report.errors.push(`[id] ${spot.id} の接頭辞が種別（${spot.kind}）と合いません`);
  const district = EXPECTED_DISTRICTS.find((d) => d.code === match[2]);
  if (district && district.id !== spot.districtId) {
    report.errors.push(`[id] ${spot.id} の地区2字 ${match[2]} と districtId ${spot.districtId} が食い違っています`);
  }
  log.exit(undefined);
}

/**
 * 舞台（名前・原点・範囲）の固定値を検証する（docs/08 §9.1・§9.2）。
 * @param {{errors: string[]}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors に追記
 */
function checkCityValues(report, idx) {
  const log = logger.fn('checkCityValues');
  const origin = idx.city?.origin;
  const bounds = idx.city?.bounds;
  if (idx.city?.name !== EXPECTED_CITY_NAME) report.errors.push(`[fixed] city.name が ${EXPECTED_CITY_NAME} ではありません`);
  if (origin?.lat !== EXPECTED_ORIGIN.lat || origin?.lng !== EXPECTED_ORIGIN.lng) {
    report.errors.push(`[fixed] city.origin が ${EXPECTED_ORIGIN.lat}, ${EXPECTED_ORIGIN.lng}（南森町駅）ではありません`);
  }
  for (const key of ['south', 'west', 'north', 'east']) {
    if (bounds?.[key] !== EXPECTED_BOUNDS[key]) report.errors.push(`[fixed] city.bounds.${key} が ${EXPECTED_BOUNDS[key]} ではありません`);
  }
  log.exit(undefined);
}

/**
 * docs/08 §9 の固定値（舞台、地区の名前・テーマ・色、名所14の名前と実座標、シード用店舗の名前とカテゴリ）を検証する。
 * @param {{errors: string[]}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors に追記
 */
export function checkFixedValues(report, idx) {
  const log = logger.fn('checkFixedValues', { districts: idx.districts.length });
  checkCityValues(report, idx);
  for (const expected of EXPECTED_DISTRICTS) {
    const d = idx.districtById.get(expected.id);
    if (!d) {
      report.errors.push(`[fixed] 地区 ${expected.id} がありません`);
      continue;
    }
    for (const key of ['name', 'shortName', 'theme', 'color']) {
      if (d[key] !== expected[key]) report.errors.push(`[fixed] ${d.id}.${key} が ${expected[key]} ではありません（${d[key]}）`);
    }
  }
  const orders = idx.districts.map((d) => d.order);
  if (new Set(orders).size !== orders.length) report.errors.push('[fixed] 地区の order が重複しています');
  for (const d of idx.districts) {
    if (!EXPECTED_DISTRICTS.some((e) => e.id === d.id)) report.errors.push(`[fixed] 未知の地区 ${d.id} があります`);
  }
  for (const [id, expected] of Object.entries(REQUIRED_LANDMARKS)) {
    const spot = idx.spotById.get(id);
    if (spot?.name !== expected.name) report.errors.push(`[fixed] ${id} は「${expected.name}」でなければなりません（${spot?.name ?? 'なし'}）`);
    else if (spot.lat !== expected.lat || spot.lng !== expected.lng) {
      report.errors.push(`[fixed] ${id} ${expected.name} の座標が docs/08 §9.2（${expected.lat}, ${expected.lng}）と違います`);
    }
  }
  for (const [id, expected] of Object.entries(REQUIRED_SHOPS)) {
    const spot = idx.spotById.get(id);
    if (spot?.name !== expected.name) report.errors.push(`[fixed] ${id} は「${expected.name}」でなければなりません（${spot?.name ?? 'なし'}）`);
    if (spot && spot.category !== expected.category) report.errors.push(`[fixed] ${id} のカテゴリが ${expected.category} ではありません`);
  }
  log.exit(undefined);
}

/**
 * 参照整合（スポット→地区、クーポン・イベント→スポット、クーポン→店舗協力ありの店舗、ライバル→地区）を検証する（DI-13, DI-16）。
 * @param {{errors: string[]}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors に追記
 */
export function checkReferences(report, idx) {
  const log = logger.fn('checkReferences', { shopEvents: idx.shopEvents.length });
  for (const spot of idx.spots) {
    if (!idx.districtById.has(spot.districtId)) report.errors.push(`[ref] ${spot.id} の地区 ${spot.districtId} がありません`);
  }
  for (const e of idx.shopEvents) {
    const spot = idx.spotById.get(e.spotId);
    if (!spot) {
      report.errors.push(`[ref] ${e.id} のスポット ${e.spotId} がありません`);
      continue;
    }
    if (e.kind === 'coupon' && (spot.kind !== 'shop' || spot.partner !== true)) {
      report.errors.push(`[ref] クーポン ${e.id} が店舗協力ありの店舗ではない ${e.spotId} に付いています`);
    }
  }
  for (const rival of idx.rivals) {
    for (const p of arrayOf(rival.patterns)) {
      if (!idx.districtById.has(p.districtId)) report.errors.push(`[ref] ${rival.id} の地区 ${p.districtId} がありません`);
    }
  }
  log.exit(undefined);
}

/**
 * city.bounds をメートル座標の外枠にする（slackM だけ外側へ広げる）。
 * @param {object} idx 索引
 * @param {number} [slackM] 外側へ広げる幅（メートル）
 * @returns {{minX: number, minY: number, maxX: number, maxY: number} | undefined} 外枠。bounds が無ければ undefined
 */
function boundsBoxM(idx, slackM = 0) {
  const log = logger.fn('boundsBoxM', { slackM });
  const bounds = idx.city?.bounds;
  if (!bounds) return log.exit(undefined);
  const southWest = toMeters({ lat: bounds.south, lng: bounds.west });
  const northEast = toMeters({ lat: bounds.north, lng: bounds.east });
  return log.exit({ minX: southWest.x - slackM, minY: southWest.y - slackM, maxX: northEast.x + slackM, maxY: northEast.y + slackM });
}

/**
 * メートル座標の点が外枠の内側にあるかを判定する。
 * @param {{x: number, y: number}} p 点
 * @param {{minX: number, minY: number, maxX: number, maxY: number} | undefined} box 外枠（undefined なら常に true）
 * @returns {boolean} 内側（境界を含む）なら true
 */
function insideBox(p, box) {
  return !box || (p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY);
}

/**
 * 地区ポリゴン（頂点数・単純性・市域からのはみ出し・相互の重なりと隙間）を検証する。
 * @param {{errors: string[], warnings: string[], facts: object}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors / facts に追記
 */
export function checkPolygons(report, idx) {
  const log = logger.fn('checkPolygons', { districts: idx.districts.length });
  const box = boundsBoxM(idx);
  for (const d of idx.districts) {
    const polygon = idx.polygonById.get(d.id);
    if (polygon.length < 5 || polygon.length > 8) report.errors.push(`[geo] ${d.id} のポリゴンが ${polygon.length} 頂点です（5〜8）`);
    if (!isSimplePolygon(polygon)) report.errors.push(`[geo] ${d.id} のポリゴンが自己交差しています`);
    if (!polygon.every((p) => insideBox(p, box))) report.errors.push(`[geo] ${d.id} のポリゴンが city.bounds の外に出ています`);
  }
  report.facts.gaps = [];
  idx.districts.forEach((a, i) => {
    for (const b of idx.districts.slice(i + 1)) {
      const pa = idx.polygonById.get(a.id);
      const pb = idx.polygonById.get(b.id);
      if (polygonsOverlap(pa, pb)) {
        report.errors.push(`[geo] 地区 ${a.id} と ${b.id} のポリゴンが重なっています`);
        continue;
      }
      const gap = polygonGap(pa, pb);
      if (gap < NEIGHBOR_GAP_REPORT_M) report.facts.gaps.push({ a: a.id, b: b.id, meters: gap });
      if (gap < RULES.MIN_DISTRICT_GAP_M) report.errors.push(`[geo] 地区 ${a.id} と ${b.id} の隙間が ${formatMeters(gap)}（${RULES.MIN_DISTRICT_GAP_M}m 以上）`);
    }
  });
  log.exit(undefined);
}

/**
 * 点から最も近い川（中心線）とその距離を求める。
 * @param {{lat: number, lng: number}} point 緯度経度
 * @param {object} idx 索引
 * @returns {{id: string, name: string, widthM: number, meters: number} | undefined} 最も近い川。川が無ければ undefined
 */
function nearestWater(point, idx) {
  const log = logger.fn('nearestWater');
  let best;
  const p = toMeters(point);
  for (const w of idx.waterLines) {
    const meters = distanceToPolyline(p, w.line);
    if (!best || meters < best.meters) best = { id: w.id, name: w.name, widthM: w.widthM, meters };
  }
  return log.exit(best);
}

/**
 * 各スポットが自地区ポリゴンの内側かつ境界から 15m 以上内側にあり、川の中心線から 60m 以上離れ、
 * 同じ地区のスポット間が 60m 以上離れているかを検証する。
 * @param {{errors: string[], facts: object}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors / facts に追記
 */
export function checkSpotPlacement(report, idx) {
  const log = logger.fn('checkSpotPlacement', { spots: idx.spots.length });
  report.facts.districts ??= {};
  if (idx.waterLines.length === 0) report.errors.push('[geo] mapFeatures.json に川（kind=water の line）がありません');
  for (const d of idx.districts) {
    const polygon = idx.polygonById.get(d.id);
    const spots = idx.spots.filter((s) => s.districtId === d.id);
    let minMargin = Infinity;
    let minRiver = Infinity;
    for (const spot of spots) {
      const p = toMeters(spot);
      const margin = distanceToBoundary(p, polygon);
      minMargin = Math.min(minMargin, margin);
      if (!pointInPolygon(p, polygon)) report.errors.push(`[geo] ${spot.id} ${spot.name} が ${d.id} のポリゴンの外にあります`);
      else if (margin < RULES.BOUNDARY_MARGIN_M) report.errors.push(`[geo] ${spot.id} が境界から ${formatMeters(margin)}（${RULES.BOUNDARY_MARGIN_M}m 以上内側）`);
      const water = nearestWater(spot, idx);
      if (!water) continue;
      minRiver = Math.min(minRiver, water.meters);
      if (water.meters < RULES.RIVER_CLEARANCE_M) {
        report.errors.push(`[geo] ${spot.id} ${spot.name} が ${water.name}の中心線から ${formatMeters(water.meters)}（${RULES.RIVER_CLEARANCE_M}m 以上）`);
      }
    }
    const minSpacing = minPairDistance(report, spots);
    report.facts.districts[d.id] = { ...report.facts.districts[d.id], minMargin, minSpacing, minRiver };
  }
  log.exit(undefined);
}

/**
 * 同じ地区のスポットの組を総当たりし、60m 未満の組を違反にして最短距離を返す。
 * @param {{errors: string[]}} report 検証結果
 * @param {Array<{id: string, lat: number, lng: number}>} spots 同じ地区のスポット
 * @returns {number} 最短距離（メートル、下限側）。2件未満なら Infinity
 * @sideEffect report.errors に追記
 */
function minPairDistance(report, spots) {
  const log = logger.fn('minPairDistance', { spots: spots.length });
  let best = Infinity;
  spots.forEach((a, i) => {
    for (const b of spots.slice(i + 1)) {
      const { min } = distanceBounds(a, b);
      best = Math.min(best, min);
      if (min < RULES.MIN_SPOT_SPACING_M) report.errors.push(`[geo] ${a.id} と ${b.id} が ${formatMeters(min)}（${RULES.MIN_SPOT_SPACING_M}m 以上）`);
    }
  });
  return log.exit(best);
}

/**
 * 地区の center・entrance が自地区ポリゴン内にあり、entrance がどのスポットからも 85m 以上離れているかを検証する。
 * @param {{errors: string[], facts: object}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors / facts に追記
 */
export function checkEntrances(report, idx) {
  const log = logger.fn('checkEntrances', { districts: idx.districts.length });
  report.facts.districts ??= {};
  for (const d of idx.districts) {
    const polygon = idx.polygonById.get(d.id);
    for (const key of ['center', 'entrance']) {
      if (!d[key] || !pointInPolygon(toMeters(d[key]), polygon)) report.errors.push(`[geo] ${d.id}.${key} が地区ポリゴンの外にあります`);
    }
    if (!d.entrance) continue;
    let nearest = { id: '', meters: Infinity };
    for (const spot of idx.spots) {
      const { min } = distanceBounds(d.entrance, spot);
      if (min < nearest.meters) nearest = { id: spot.id, meters: min };
      if (min < RULES.ENTRANCE_CLEARANCE_M) report.errors.push(`[geo] ${d.id}.entrance と ${spot.id} が ${formatMeters(min)}（${RULES.ENTRANCE_CLEARANCE_M}m 以上）`);
    }
    report.facts.districts[d.id] = { ...report.facts.districts[d.id], entranceNearest: nearest };
  }
  log.exit(undefined);
}

/**
 * 実演の動線を検証する: 開始地区（南森町）の entrance→和菓子店（s_mm02）が 100〜160m、entrance→center の直線歩行
 * （20m ごとの発見判定）で通い慣れた人にとって未発見のスポットが2つ以上 80m 円に入る（docs/08 §6・§9.3、CLAUDE.md 7.2 手順2）。
 * @param {{errors: string[], facts: object}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors / facts に追記
 */
export function checkDemoRoute(report, idx) {
  const log = logger.fn('checkDemoRoute');
  const start = idx.districtById.get(START_DISTRICT_ID);
  const wagashi = idx.spotById.get(WAGASHI_SPOT_ID);
  if (!start?.entrance || !start?.center || !wagashi) {
    report.errors.push(`[demo] 開始地区 ${START_DISTRICT_ID} の entrance・center または ${WAGASHI_SPOT_ID} がありません`);
    return log.exit(undefined);
  }
  const toWagashi = distanceBounds(start.entrance, wagashi);
  const range = RULES.START_ENTRANCE_TO_WAGASHI_M;
  report.facts.startEntranceToWagashi = { ...toWagashi, id: wagashi.id, name: wagashi.name };
  if (toWagashi.min < range.min || toWagashi.max > range.max) {
    report.errors.push(`[demo] ${START_DISTRICT_ID} entrance→${WAGASHI_SPOT_ID} が ${formatMeters(toWagashi.min)}〜${formatMeters(toWagashi.max)}（${range.min}〜${range.max}m）`);
  }
  const samples = samplePath(toMeters(start.entrance), toMeters(start.center), RULES.WALK_SAMPLE_STEP_M).map((p) => toLatLng(p));
  const candidates = idx.spots.filter((s) => s.districtId === START_DISTRICT_ID && !DEMO_KNOWN_START_SPOTS.includes(s.id));
  const discovered = [];
  for (const spot of candidates) {
    const closest = Math.min(...samples.map((p) => distanceBounds(p, spot).max));
    if (closest <= RULES.DISCOVERY_RADIUS_M) discovered.push({ id: spot.id, name: spot.name, meters: closest });
  }
  report.facts.walkDiscoveries = discovered;
  report.facts.walkLength = distanceBounds(start.entrance, start.center).max;
  if (discovered.length < RULES.MIN_WALK_DISCOVERIES) {
    report.errors.push(`[demo] ${START_DISTRICT_ID} entrance→center の歩行で新たに発見できるスポットが ${discovered.length} 件（${RULES.MIN_WALK_DISCOVERIES} 件以上）`);
  }
  log.exit(undefined);
}

/**
 * 天満のデモ用スポット（l_tm02, s_tm01〜03）が天満の南寄り（南森町側）にあるかを検証する。
 * 南寄り = ポリゴンの緯度幅の南 50% 以内、かつ南森町 entrance から天満 center より近い。4つが最寄り4件でなければ警告。
 * l_tm01 天満市場は docs/08 §9.2 の実座標が北寄りのため対象外（取り返しの2スポット訪問は南の4か所で足りる）。
 * @param {{errors: string[], warnings: string[], facts: object}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors / warnings / facts に追記
 */
export function checkTenmaSouth(report, idx) {
  const log = logger.fn('checkTenmaSouth');
  const tenma = idx.districtById.get(LORD_DISTRICT_ID);
  const start = idx.districtById.get(START_DISTRICT_ID);
  if (!tenma?.center || !start?.entrance) {
    report.errors.push(`[demo] ${LORD_DISTRICT_ID} または ${START_DISTRICT_ID} の entrance がありません`);
    return log.exit(undefined);
  }
  const ys = idx.polygonById.get(tenma.id).map((p) => p.y);
  const southLimit = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * RULES.SOUTH_SIDE_RATIO;
  const centerDistance = distanceBounds(start.entrance, tenma.center).min;
  report.facts.tenmaSouth = [];
  for (const id of TENMA_SOUTH_SPOTS) {
    const spot = idx.spotById.get(id);
    if (!spot || spot.districtId !== tenma.id) {
      report.errors.push(`[demo] ${id} が天満地区にありません`);
      continue;
    }
    const y = toMeters(spot).y;
    const fromStart = distanceBounds(start.entrance, spot).max;
    report.facts.tenmaSouth.push({ id, name: spot.name, y, fromStart });
    if (y > southLimit) report.errors.push(`[demo] ${id} が天満の南寄り（y ≦ ${Math.round(southLimit)}m）にありません（y=${Math.round(y)}m）`);
    if (fromStart >= centerDistance) report.errors.push(`[demo] ${id} が天満 center より南森町から遠い位置にあります`);
  }
  const others = idx.spots.filter((s) => s.districtId === tenma.id && !TENMA_SOUTH_SPOTS.includes(s.id));
  const farthest = Math.max(...report.facts.tenmaSouth.map((f) => f.fromStart));
  if (others.some((s) => distanceBounds(start.entrance, s).min <= farthest)) {
    report.warnings.push('[demo] 南森町 entrance から最も近い天満スポット4件がデモ用4スポットと一致しません');
  }
  log.exit(undefined);
}

/**
 * 'YYYY-MM-DD' が実在する暦日か判定する（うるう年を考慮）。
 * @param {unknown} value 文字列
 * @returns {boolean} 実在する日付なら true
 */
export function isValidLocalDate(value) { // audit-ignore: fnlog-missing 純粋な日付判定ヘルパー（イベントごとに呼ばれる。呼び出し側 checkShopEvents でまとめて記録）
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

/**
 * クーポン・イベントの日付（実在・start ≦ end）、指定クーポン（c_mm01, c_mm02）と秋の大売り出し、冬・春の有無、
 * 実在の名所のイベントに「模擬」の明記があるかを検証する。
 * @param {{errors: string[], warnings: string[]}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors / warnings に追記
 */
export function checkShopEvents(report, idx) {
  const log = logger.fn('checkShopEvents', { shopEvents: idx.shopEvents.length });
  for (const e of idx.shopEvents) {
    if (!isValidLocalDate(e.start) || !isValidLocalDate(e.end)) {
      report.errors.push(`[date] ${e.id} の日付が不正です（${e.start}〜${e.end}）`);
    } else if (e.start > e.end) {
      report.errors.push(`[date] ${e.id} の start ${e.start} が end ${e.end} より後です`);
    }
    const atLandmark = idx.spotById.get(e.spotId)?.kind === 'landmark';
    if (atLandmark && !`${e.title}${e.description}`.includes(SIMULATED_MARK)) {
      report.errors.push(`[text] 実在の名所のイベント ${e.id} に「${SIMULATED_MARK}」の明記がありません（実在行事と誤認させない）`);
    }
  }
  for (const req of REQUIRED_SHOP_EVENTS) {
    const e = idx.shopEvents.find((x) => x.id === req.id);
    const same = e && Object.entries(req).every(([key, value]) => e[key] === value);
    if (!same) report.errors.push(`[date] ${req.id} は ${req.spotId}「${req.title}」${req.start}〜${req.end} でなければなりません`);
  }
  const festival = idx.shopEvents.find((e) => Object.entries(REQUIRED_FESTIVAL).every(([k, v]) => e[k] === v));
  if (!festival) report.errors.push(`[date] ${REQUIRED_FESTIVAL.spotId} の「${REQUIRED_FESTIVAL.title}」がありません`);
  for (const w of REQUIRED_SEASON_WINDOWS) {
    if (!idx.shopEvents.some((e) => e.start <= w.end && e.end >= w.start)) report.errors.push(`[date] ${w.label} のクーポン・イベントがありません`);
  }
  const { min, max } = RULES.SHOP_EVENT_COUNT;
  if (idx.shopEvents.length < min || idx.shopEvents.length > max) {
    report.warnings.push(`[date] クーポン・イベントが ${idx.shopEvents.length} 件です（目安 ${min}〜${max} 件）`);
  }
  log.exit(undefined);
}

/**
 * 模擬ライバル（docs/08 §9.3 の7人・訪問間隔・phase の範囲・天満の背景活動なし）を検証する（D9）。
 * @param {{errors: string[]}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors に追記
 */
export function checkRivals(report, idx) {
  const log = logger.fn('checkRivals', { rivals: idx.rivals.length });
  const ids = idx.rivals.map((r) => r.id);
  for (const [id, expected] of Object.entries(EXPECTED_RIVALS)) {
    const rival = idx.rivals.find((r) => r.id === id);
    if (!rival) {
      report.errors.push(`[rival] ${id} ${expected.name} がありません`);
      continue;
    }
    if (rival.name !== expected.name) report.errors.push(`[rival] ${id} の名前が ${expected.name} ではありません`);
    const actual = Object.fromEntries(arrayOf(rival.patterns).map((p) => [p.districtId, p.intervalDays]));
    if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(expected.intervals).sort())) {
      report.errors.push(`[rival] ${id} の背景活動が docs/08 と違います（${JSON.stringify(actual)}）`);
    }
  }
  for (const id of ids) if (!(id in EXPECTED_RIVALS)) report.errors.push(`[rival] 未知のライバル ${id} があります`);
  for (const rival of idx.rivals) {
    for (const p of arrayOf(rival.patterns)) {
      if (p.districtId === NO_BACKGROUND_DISTRICT) report.errors.push(`[rival] ${rival.id} が天満（${NO_BACKGROUND_DISTRICT}）の背景活動を持っています`);
      const phaseOk = Number.isInteger(p.phase) && Number.isInteger(p.intervalDays) && p.phase >= 0 && p.phase < p.intervalDays;
      if (!phaseOk) report.errors.push(`[rival] ${rival.id} の phase ${p.phase} が 0..${p.intervalDays - 1} にありません`);
    }
  }
  log.exit(undefined);
}

/**
 * 背景地物1件の形（line は2点以上と widthM、area は3点以上の単純多角形）と座標範囲を検証する。
 * @param {{errors: string[], warnings: string[]}} report 検証結果
 * @param {any} f 背景地物
 * @param {{minX: number, minY: number, maxX: number, maxY: number} | undefined} box 許容範囲（市域＋余裕）
 * @returns {void}
 * @sideEffect report.errors / warnings に追記
 */
function checkFeatureShape(report, f, box) {
  const log = logger.fn('checkFeatureShape', { featureId: f?.id });
  const points = arrayOf(f?.points);
  const meters = points.map((p) => toMeters(p));
  if (f?.shape === 'line') {
    if (points.length < 2) report.errors.push(`[map] ${f.id} の line は2点以上が必要です（${points.length} 点）`);
    if (!(Number(f.widthM) > 0)) report.errors.push(`[map] ${f.id} の line に widthM（太さ）がありません`);
  } else if (f?.shape === 'area') {
    if (points.length < 3) report.errors.push(`[map] ${f.id} の area は3点以上が必要です（${points.length} 点）`);
    else if (!isSimplePolygon(meters)) report.warnings.push(`[map] ${f.id} の area が自己交差しています（間引きすぎ？）`);
    if ('widthM' in f) report.errors.push(`[map] ${f.id} は area なので widthM を持ちません`);
  }
  if (!meters.every((p) => insideBox(p, box))) report.errors.push(`[map] ${f?.id} の座標が市域（＋${RULES.FEATURE_BOUNDS_SLACK_M}m）の外にあります`);
  log.exit(undefined);
}

/**
 * mapFeatures.json（出典表示・地物の形と範囲・必要な種類・§9.2 の9駅）を検証する（docs/08 §9）。
 * @param {{errors: string[], warnings: string[], facts: object}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors / warnings / facts に追記
 */
export function checkMapFeatures(report, idx) {
  const log = logger.fn('checkMapFeatures', { features: idx.features.length, stations: idx.stations.length });
  if (idx.mapFeatures?.attribution !== EXPECTED_ATTRIBUTION) report.errors.push(`[map] mapFeatures.json の attribution が「${EXPECTED_ATTRIBUTION}」ではありません`);
  const slackBox = boundsBoxM(idx, RULES.FEATURE_BOUNDS_SLACK_M);
  for (const f of idx.features) checkFeatureShape(report, f, slackBox);
  for (const kind of REQUIRED_FEATURE_KINDS) {
    if (!idx.features.some((f) => f?.kind === kind)) report.errors.push(`[map] 背景に kind=${kind} の地物がありません`);
  }
  const box = boundsBoxM(idx);
  for (const s of idx.stations) {
    if (!insideBox(toMeters(s), box)) report.errors.push(`[map] 駅 ${s.id} ${s.name} が city.bounds の外にあります`);
  }
  for (const [id, name] of Object.entries(REQUIRED_STATIONS)) {
    const station = idx.stations.find((s) => s.id === id);
    if (station?.name !== name) report.errors.push(`[map] 駅 ${id}「${name}」がありません（${station?.name ?? 'なし'}）`);
  }
  report.facts.features = idx.features.length;
  report.facts.stations = idx.stations.length;
  log.exit(undefined);
}

/**
 * amenityPoints.json（出典表示・市域内・川の中に無い・公衆トイレが1件以上）を検証する（docs/08 §9）。
 * 「川の中」は、最寄りの川の中心線からの距離が川幅の半分未満のこととする。
 * @param {{errors: string[], facts: object}} report 検証結果
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors / facts に追記
 */
export function checkAmenityPoints(report, idx) {
  const log = logger.fn('checkAmenityPoints', { points: idx.amenityPoints.length });
  if (idx.amenityFile?.attribution !== EXPECTED_ATTRIBUTION) report.errors.push(`[amenity] amenityPoints.json の attribution が「${EXPECTED_ATTRIBUTION}」ではありません`);
  const box = boundsBoxM(idx);
  for (const a of idx.amenityPoints) {
    const p = toMeters(a);
    if (!insideBox(p, box)) report.errors.push(`[amenity] ${a.id} が city.bounds の外にあります`);
    for (const w of idx.waterLines) {
      const meters = distanceToPolyline(p, w.line);
      if (meters < w.widthM / 2) report.errors.push(`[amenity] ${a.id} が${w.name}の水面（中心線から ${formatMeters(meters)}、川幅 ${w.widthM}m）にあります`);
    }
  }
  const toilets = idx.amenityPoints.filter((a) => a.kind === 'toilet').length;
  if (toilets === 0) report.errors.push('[amenity] 公衆トイレ（kind=toilet）が1件もありません');
  report.facts.amenityCounts = { toilet: toilets, nursing: idx.amenityPoints.filter((a) => a.kind === 'nursing').length };
  log.exit(undefined);
}

/**
 * 値に含まれる文字列をすべて集める（禁止語の検査用）。
 * @param {unknown} value JSON 値
 * @param {string[]} [out] 収集先
 * @returns {string[]} 文字列の一覧
 */
function collectStrings(value, out = []) { // audit-ignore: fnlog-missing 値ごとに再帰する純粋ヘルパー（呼び出し側 checkTexts でまとめて記録）
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

/**
 * 文言を検証する: 禁止語（「施設」）なし、スポット名の一意、店舗協力ありの割合（約半数。外れたら警告）。
 * @param {{errors: string[], warnings: string[]}} report 検証結果
 * @param {Record<string, any>} data ファイル名 → パース済み JSON
 * @param {object} idx 索引
 * @returns {void}
 * @sideEffect report.errors / warnings に追記
 */
export function checkTexts(report, data, idx) {
  const log = logger.fn('checkTexts', { files: Object.keys(data).length });
  for (const [file, value] of Object.entries(data)) {
    if (file === 'master.schema.json') continue;
    for (const word of FORBIDDEN_WORDS) {
      const hit = collectStrings(value).find((s) => s.includes(word));
      if (hit) report.errors.push(`[text] ${file} に「${word}」が含まれています（スポットと書く）: ${hit}`);
    }
  }
  const names = new Map();
  for (const spot of idx.spots) {
    if (names.has(spot.name)) report.errors.push(`[text] スポット名「${spot.name}」が ${names.get(spot.name)} と ${spot.id} で重複しています`);
    names.set(spot.name, spot.id);
  }
  const { min, max } = RULES.PARTNER_RATIO;
  const ratio = idx.shops.length === 0 ? 0 : idx.shops.filter((s) => s.partner === true).length / idx.shops.length;
  if (ratio < min || ratio > max) report.warnings.push(`[text] 店舗協力ありの割合が ${Math.round(ratio * 100)}% です（目安 ${min * 100}〜${max * 100}%）`);
  log.exit(undefined);
}

/** 実行する検証の一覧（名前と関数）。順に実行し、例外は違反として記録する */
const CHECKS = Object.freeze([
  ['schema', (report, data) => checkSchema(report, data)],
  ['count', (report, _data, idx) => checkCounts(report, idx)],
  ['id', (report, _data, idx) => checkIds(report, idx)],
  ['fixed', (report, _data, idx) => checkFixedValues(report, idx)],
  ['ref', (report, _data, idx) => checkReferences(report, idx)],
  ['polygon', (report, _data, idx) => checkPolygons(report, idx)],
  ['placement', (report, _data, idx) => checkSpotPlacement(report, idx)],
  ['entrance', (report, _data, idx) => checkEntrances(report, idx)],
  ['demoRoute', (report, _data, idx) => checkDemoRoute(report, idx)],
  ['tenmaSouth', (report, _data, idx) => checkTenmaSouth(report, idx)],
  ['shopEvents', (report, _data, idx) => checkShopEvents(report, idx)],
  ['rivals', (report, _data, idx) => checkRivals(report, idx)],
  ['mapFeatures', (report, _data, idx) => checkMapFeatures(report, idx)],
  ['amenityPoints', (report, _data, idx) => checkAmenityPoints(report, idx)],
  ['texts', (report, data, idx) => checkTexts(report, data, idx)],
]);

/**
 * マスタ一式を検証し、違反（errors）・警告（warnings）・報告用の測定値（facts）を返す。
 * 1つの検証が例外で止まっても残りは実行する（壊れたデータでも違反を一覧できるように）。
 * @param {Record<string, any>} data ファイル名 → パース済み JSON（master.schema.json を含む）
 * @returns {{errors: string[], warnings: string[], facts: object}} 検証結果。errors が空なら合格
 */
export function checkMaster(data) {
  const log = logger.fn('checkMaster', { files: Object.keys(data).length });
  const report = { errors: [], warnings: [], facts: {} };
  const idx = buildIndex(data);
  for (const [name, run] of CHECKS) {
    try {
      run(report, data, idx);
    } catch (error) {
      report.errors.push(`[${name}] 検証中に例外が発生しました（データ構造の破損？）: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return log.exit(report, `errors=${report.errors.length} warnings=${report.warnings.length}`);
}
