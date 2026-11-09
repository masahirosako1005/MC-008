/**
 * @file マスタ7ファイルの検証（infrastructure/master 層の境界）
 * JSON.parse 済みの7ファイル（unknown）を検証して domain 型にする（DI-01, DI-13, SEC-22）。
 * - ファイル: オブジェクトで schemaVersion=1、配列項目がある
 * - 件数: 地区5・名所14・店舗66（クーポン・イベント 200 件まで、ライバル 1〜50 件）
 * - ID: 正規表現（SEC-16）と一意性（種類ごと）
 * - 参照整合: スポット→地区、クーポン・イベント→スポット、ライバルの背景活動→地区
 * - 配置: スポットの座標が所属地区のポリゴン内
 * - 地図の背景（mapFeatures.json・amenityPoints.json）: backdropValidators.ts（2026-11-09 の舞台変更＝docs/08 §9 で追加）
 * 項目ごとの検証は masterRecordParsers.ts、ファイル共通の部品は masterFileChecks.ts。失敗は MASTER_INVALID（details: file / rule / index。値は入れない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { DistrictId, SpotId } from '@/Common/types/Id';
import type { Rival } from '@/domain/competition/Rival';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import type { MapBackdrop } from '@/domain/spot/MapBackdrop';
import type { Spot, SpotKind } from '@/domain/spot/Spot';
import type { CityBounds } from '@/domain/spot/SpotRepository';
import { isPointInPolygon } from '@/domain/town/District';
import type { District } from '@/domain/town/District';
import { validateBackdrop } from '@/infrastructure/master/backdropValidators';
import { checkCount, checkUniqueIds, masterInvalid, MASTER_FILE_NAMES, parseEach, readFileArray } from '@/infrastructure/master/masterFileChecks';
import type { MasterError, MasterJson } from '@/infrastructure/master/masterFileChecks';
import {
  parseCityBounds,
  parseDistrictRecord,
  parseRivalRecord,
  parseShopEventRecord,
  parseSpotRecord,
} from '@/infrastructure/master/masterRecordParsers';

export { MASTER_FILE_NAMES, MASTER_SCHEMA_VERSION, masterInvalid } from '@/infrastructure/master/masterFileChecks';
export type { MasterError, MasterErrorCode, MasterFileKey, MasterJson } from '@/infrastructure/master/masterFileChecks';

const logger = createLogger('infrastructure/master/masterValidators');

/** 件数の固定値と上限（DI-13, SEC-22。CLAUDE.md 4.1） */
export const MASTER_COUNTS = Object.freeze({ districts: 5, landmarks: 14, shops: 66, maxShopEvents: 200, maxRivals: 50 });

/** スポット・地区・クーポン/イベント・市域・地図の背景（InMemorySpotRepository の材料） */
export interface SpotCatalog {
  readonly districts: readonly District[];
  readonly spots: readonly Spot[];
  readonly shopEvents: readonly ShopEvent[];
  readonly cityBounds: CityBounds;
  /** 地図の背景（川・公園・道路・線路・駅）と便利施設ポイント（docs/08 §9） */
  readonly backdrop: MapBackdrop;
}

/** 検証済みのマスタ一式 */
export interface ValidatedMaster extends SpotCatalog {
  readonly rivals: readonly Rival[];
}

/**
 * districts.json を検証する（市域・地区5件・ID 一意）。
 * @param json パース済みの districts.json
 * @returns 成功: 地区と市域。失敗: MASTER_INVALID
 */
function validateDistricts(json: unknown): Result<{ readonly districts: readonly District[]; readonly cityBounds: CityBounds }, MasterError> {
  const log = logger.fn('validateDistricts');
  const file = MASTER_FILE_NAMES.districts;
  const read = readFileArray(json, file, 'districts');
  if (!read.ok) return log.fail(read);
  const cityBounds = parseCityBounds(read.value.body['city']);
  if (!cityBounds.ok) return log.fail(masterInvalid(file, cityBounds.error));
  const counted = checkCount(read.value.items, MASTER_COUNTS.districts, file);
  if (!counted.ok) return log.fail(counted);
  const districts = parseEach({ items: read.value.items, file, parse: parseDistrictRecord });
  if (!districts.ok) return log.fail(districts);
  const unique = checkUniqueIds(districts.value, file);
  if (!unique.ok) return log.fail(unique);
  return log.exit(ok({ districts: districts.value, cityBounds: cityBounds.value }));
}

/**
 * 名所または店舗のファイルを検証する（件数・各レコード）。
 * @param json パース済みのファイル
 * @param kind 'landmark'（landmarks.json）/ 'shop'（shops.json）
 * @returns 成功: スポット。失敗: MASTER_INVALID
 */
function validateSpotFile(json: unknown, kind: SpotKind): Result<readonly Spot[], MasterError> {
  const log = logger.fn('validateSpotFile', { kind });
  const file = kind === 'landmark' ? MASTER_FILE_NAMES.landmarks : MASTER_FILE_NAMES.shops;
  const read = readFileArray(json, file, kind === 'landmark' ? 'landmarks' : 'shops');
  if (!read.ok) return log.fail(read);
  const counted = checkCount(read.value.items, kind === 'landmark' ? MASTER_COUNTS.landmarks : MASTER_COUNTS.shops, file);
  if (!counted.ok) return log.fail(counted);
  const spots = parseEach({ items: read.value.items, file, parse: (raw) => parseSpotRecord(raw, kind) });
  return spots.ok ? log.exit(spots) : log.fail(spots);
}

/**
 * スポットの地区参照と配置（所属地区のポリゴン内）を検証する。
 * @param spots スポット（名所→店舗の順）
 * @param districts 地区
 * @returns 成功: void。失敗: MASTER_INVALID（rule: districtRef / outsideDistrict。file はスポットの種別のファイル）
 */
function checkSpotPlacement(spots: readonly Spot[], districts: readonly District[]): Result<void, MasterError> {
  const log = logger.fn('checkSpotPlacement', { spots: spots.length });
  const byId = new Map<DistrictId, District>(districts.map((d) => [d.id, d]));
  for (const [index, spot] of spots.entries()) {
    const file = spot.kind === 'landmark' ? MASTER_FILE_NAMES.landmarks : MASTER_FILE_NAMES.shops;
    const district = byId.get(spot.districtId);
    if (district === undefined) return log.fail(masterInvalid(file, 'districtRef', index));
    if (!isPointInPolygon(spot.point, district.polygon)) return log.fail(masterInvalid(file, 'outsideDistrict', index));
  }
  return log.exit(okVoid());
}

/**
 * 名所・店舗の2ファイルを検証する（件数・ID 一意・地区参照・配置）。
 * @param landmarksJson パース済みの landmarks.json
 * @param shopsJson パース済みの shops.json
 * @param districts 検証済みの地区
 * @returns 成功: 名所→店舗の順のスポット。失敗: MASTER_INVALID
 */
function validateSpots(landmarksJson: unknown, shopsJson: unknown, districts: readonly District[]): Result<readonly Spot[], MasterError> {
  const log = logger.fn('validateSpots');
  const landmarks = validateSpotFile(landmarksJson, 'landmark');
  if (!landmarks.ok) return log.fail(landmarks);
  const shops = validateSpotFile(shopsJson, 'shop');
  if (!shops.ok) return log.fail(shops);
  const spots = Object.freeze([...landmarks.value, ...shops.value]);
  const unique = checkUniqueIds(spots, `${MASTER_FILE_NAMES.landmarks}+${MASTER_FILE_NAMES.shops}`);
  if (!unique.ok) return log.fail(unique);
  const placed = checkSpotPlacement(spots, districts);
  return placed.ok ? log.exit(ok(spots)) : log.fail(placed);
}

/**
 * shopEvents.json を検証する（件数上限・各レコード・スポット参照・ID 一意）。
 * @param json パース済みの shopEvents.json
 * @param spots 検証済みのスポット
 * @returns 成功: クーポン・イベント。失敗: MASTER_INVALID
 */
function validateShopEvents(json: unknown, spots: readonly Spot[]): Result<readonly ShopEvent[], MasterError> {
  const log = logger.fn('validateShopEvents');
  const file = MASTER_FILE_NAMES.shopEvents;
  const read = readFileArray(json, file, 'shopEvents');
  if (!read.ok) return log.fail(read);
  if (read.value.items.length > MASTER_COUNTS.maxShopEvents) return log.fail(masterInvalid(file, 'count'));
  const districtOf = new Map<SpotId, DistrictId>(spots.map((s) => [s.id, s.districtId]));
  const events = parseEach({ items: read.value.items, file, parse: (raw) => parseShopEventRecord(raw, (id) => districtOf.get(id)) });
  if (!events.ok) return log.fail(events);
  const unique = checkUniqueIds(events.value, file);
  return unique.ok ? log.exit(events) : log.fail(unique);
}

/**
 * rivals.json を検証する（1〜50件・各レコード・地区参照・ID 一意）。
 * @param json パース済みの rivals.json
 * @param districts 検証済みの地区
 * @returns 成功: ライバル。失敗: MASTER_INVALID
 */
function validateRivals(json: unknown, districts: readonly District[]): Result<readonly Rival[], MasterError> {
  const log = logger.fn('validateRivals');
  const file = MASTER_FILE_NAMES.rivals;
  const read = readFileArray(json, file, 'rivals');
  if (!read.ok) return log.fail(read);
  const count = read.value.items.length;
  if (count < 1 || count > MASTER_COUNTS.maxRivals) return log.fail(masterInvalid(file, 'count'));
  const districtIds = new Set<DistrictId>(districts.map((d) => d.id));
  const rivals = parseEach({ items: read.value.items, file, parse: (raw) => parseRivalRecord(raw, (id) => districtIds.has(id)) });
  if (!rivals.ok) return log.fail(rivals);
  const unique = checkUniqueIds(rivals.value, file);
  return unique.ok ? log.exit(rivals) : log.fail(unique);
}

/**
 * マスタ7ファイルを検証し、検証済みのマスタ一式を返す（DI-13, SEC-22）。
 * @param json JSON.parse 済みの7ファイル
 * @returns 成功: 地区（ファイル順）・スポット（名所→店舗）・クーポン/イベント・ライバル・市域・地図の背景。失敗: MASTER_INVALID
 */
export function validateMaster(json: MasterJson): Result<ValidatedMaster, MasterError> {
  const log = logger.fn('validateMaster');
  const districts = validateDistricts(json.districts);
  if (!districts.ok) return log.fail(districts);
  const spots = validateSpots(json.landmarks, json.shops, districts.value.districts);
  if (!spots.ok) return log.fail(spots);
  const shopEvents = validateShopEvents(json.shopEvents, spots.value);
  if (!shopEvents.ok) return log.fail(shopEvents);
  const rivals = validateRivals(json.rivals, districts.value.districts);
  if (!rivals.ok) return log.fail(rivals);
  const backdrop = validateBackdrop({ mapFeatures: json.mapFeatures, amenityPoints: json.amenityPoints }, districts.value.cityBounds);
  if (!backdrop.ok) return log.fail(backdrop);
  const master: ValidatedMaster = { ...districts.value, spots: spots.value, shopEvents: shopEvents.value, rivals: rivals.value, backdrop: backdrop.value };
  return log.exit(ok(Object.freeze(master)), `spots=${spots.value.length} events=${shopEvents.value.length} rivals=${rivals.value.length} features=${backdrop.value.features.length}`);
}
