/**
 * @file 地図の背景マスタ2ファイル（mapFeatures.json・amenityPoints.json）の検証（infrastructure/master 層の境界）
 * JSON.parse 済みの2ファイル（unknown）を検証して domain の MapBackdrop にする（DI-01, DI-13, SEC-22）。2026-11-09 の舞台変更（docs/08 §9）で追加。
 * - ファイル: オブジェクトで schemaVersion=1、出典（attribution）と配列項目がある
 * - 件数: 地物 1〜200・駅 0〜50・便利施設ポイント 0〜200（master.schema.json と同じ）
 * - 各レコード: backdropRecordParsers（ID・種類・座標範囲・頂点数・文字列長）
 * - ID: 種類ごとに一意
 * 座標範囲: 地物は市域を BACKDROP_AREA_MARGIN_DEG だけ広げた範囲（川・線路の端は市域の外へはみ出してよい）、駅と便利施設ポイントは市域の中。
 * 生成側（scripts/master の check-master）はもっと細かく（市域＋300m、川の水面にトイレが無い等）見る。ここは起動時の最低限の歯止め。
 * 背景の出典は mapFeatures.json の attribution を使う（地図の隅に出す。ODbL）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { GeoBounds } from '@/domain/exploration/GeoPoint';
import type { AmenityPoint, MapBackdrop, MapFeature, Station } from '@/domain/spot/MapBackdrop';
import {
  BACKDROP_TEXT_LIMITS, expandBounds, parseAmenityPointRecord, parseMapFeatureRecord, parseStationRecord,
} from '@/infrastructure/master/backdropRecordParsers';
import { checkCountRange, checkUniqueIds, masterInvalid, MASTER_FILE_NAMES, parseEach, readArrayField, readFileBody } from '@/infrastructure/master/masterFileChecks';
import type { MasterError } from '@/infrastructure/master/masterFileChecks';
import { isDisplayText } from '@/infrastructure/master/masterRecordParsers';
import type { RecordResult } from '@/infrastructure/master/masterRecordParsers';

const logger = createLogger('infrastructure/master/backdropValidators');

/** 背景データの件数の範囲（master.schema.json と同じ。描画負荷とファイル改ざんへの備え） */
export const BACKDROP_COUNTS = Object.freeze({
  features: { min: 1, max: 200 },
  stations: { min: 0, max: 50 },
  amenityPoints: { min: 0, max: 200 },
});

/** 地物に許す範囲の、市域からの広げ幅（度。南北約 550m・東西約 460m。生成側の「市域＋300m」より少し緩い） */
export const BACKDROP_AREA_MARGIN_DEG = 0.005;

/** JSON.parse 済みの背景マスタ2ファイル（未検証） */
export interface BackdropJson {
  readonly mapFeatures: unknown;
  readonly amenityPoints: unknown;
}

/** 配列項目を検証する入力 */
interface ListInput<T extends { readonly id: string }> {
  readonly body: Readonly<Record<string, unknown>>;
  readonly file: string;
  readonly field: string;
  readonly range: { readonly min: number; readonly max: number };
  readonly parse: (raw: unknown) => RecordResult<T>;
}

/** ファイル本体と出典 */
interface AttributedBody {
  readonly body: Readonly<Record<string, unknown>>;
  readonly attribution: string;
}

/**
 * ファイルの外形（schemaVersion）と出典を検証する。
 * @param json パース済みのファイル
 * @param file ファイル名
 * @returns 成功: ファイル本体と出典。失敗: MASTER_INVALID（shape / schemaVersion / attribution）
 */
function readAttributedBody(json: unknown, file: string): Result<AttributedBody, MasterError> {
  const log = logger.fn('readAttributedBody', { file });
  const body = readFileBody(json, file);
  if (!body.ok) return log.fail(body);
  const attribution = body.value['attribution'];
  if (!isDisplayText(attribution, BACKDROP_TEXT_LIMITS.attribution)) return log.fail(masterInvalid(file, 'attribution'));
  return log.exit(ok({ body: body.value, attribution }));
}

/**
 * 配列項目を検証する（配列か・件数・各レコード・ID 一意）。
 * @param input ファイル本体・ファイル名・項目名・件数の範囲・レコードの検証関数
 * @returns 成功: 凍結済みのレコード。失敗: MASTER_INVALID（field 名 / count / レコードの規則名 / duplicateId）
 */
function validateList<T extends { readonly id: string }>(input: ListInput<T>): Result<readonly T[], MasterError> {
  const log = logger.fn('validateList', { file: input.file, field: input.field });
  const items = readArrayField(input.body, input.file, input.field);
  if (!items.ok) return log.fail(items);
  const counted = checkCountRange(items.value, input.range, input.file);
  if (!counted.ok) return log.fail(counted);
  const records = parseEach({ items: items.value, file: input.file, parse: input.parse });
  if (!records.ok) return log.fail(records);
  const unique = checkUniqueIds(records.value, input.file);
  return unique.ok ? log.exit(records) : log.fail(unique);
}

/**
 * mapFeatures.json を検証する（出典・地物・駅。地物は市域を少し広げた範囲、駅は市域の中）。
 * @param json パース済みの mapFeatures.json
 * @param cityBounds 検証済みの市域
 * @returns 成功: 地物・駅・出典。失敗: MASTER_INVALID
 */
function validateMapFeatures(
  json: unknown,
  cityBounds: GeoBounds,
): Result<{ readonly features: readonly MapFeature[]; readonly stations: readonly Station[]; readonly attribution: string }, MasterError> {
  const log = logger.fn('validateMapFeatures');
  const file = MASTER_FILE_NAMES.mapFeatures;
  const read = readAttributedBody(json, file);
  if (!read.ok) return log.fail(read);
  const area = expandBounds(cityBounds, BACKDROP_AREA_MARGIN_DEG);
  const { body, attribution } = read.value;
  const features = validateList({ body, file, field: 'features', range: BACKDROP_COUNTS.features, parse: (raw) => parseMapFeatureRecord(raw, area) });
  if (!features.ok) return log.fail(features);
  const stations = validateList({ body, file, field: 'stations', range: BACKDROP_COUNTS.stations, parse: (raw) => parseStationRecord(raw, cityBounds) });
  if (!stations.ok) return log.fail(stations);
  return log.exit(ok({ features: features.value, stations: stations.value, attribution }), `features=${features.value.length} stations=${stations.value.length}`);
}

/**
 * amenityPoints.json を検証する（出典・便利施設ポイント。位置は市域の中）。
 * @param json パース済みの amenityPoints.json
 * @param cityBounds 検証済みの市域
 * @returns 成功: 便利施設ポイント。失敗: MASTER_INVALID
 */
function validateAmenityPoints(json: unknown, cityBounds: GeoBounds): Result<readonly AmenityPoint[], MasterError> {
  const log = logger.fn('validateAmenityPoints');
  const file = MASTER_FILE_NAMES.amenityPoints;
  const read = readAttributedBody(json, file);
  if (!read.ok) return log.fail(read);
  const points = validateList({ body: read.value.body, file, field: 'points', range: BACKDROP_COUNTS.amenityPoints, parse: (raw) => parseAmenityPointRecord(raw, cityBounds) });
  return points.ok ? log.exit(points, `points=${points.value.length}`) : log.fail(points);
}

/**
 * 背景マスタ2ファイルを検証し、地図の背景一式を返す（DI-13, SEC-22）。
 * @param json JSON.parse 済みの mapFeatures.json・amenityPoints.json
 * @param cityBounds 検証済みの市域（districts.json の city.bounds）
 * @returns 成功: 凍結済みの MapBackdrop（出典は mapFeatures.json のもの）。失敗: MASTER_INVALID
 */
export function validateBackdrop(json: BackdropJson, cityBounds: GeoBounds): Result<MapBackdrop, MasterError> {
  const log = logger.fn('validateBackdrop');
  const map = validateMapFeatures(json.mapFeatures, cityBounds);
  if (!map.ok) return log.fail(map);
  const amenityPoints = validateAmenityPoints(json.amenityPoints, cityBounds);
  if (!amenityPoints.ok) return log.fail(amenityPoints);
  const backdrop: MapBackdrop = { features: map.value.features, stations: map.value.stations, amenityPoints: amenityPoints.value, attribution: map.value.attribution };
  return log.exit(ok(Object.freeze(backdrop)));
}
