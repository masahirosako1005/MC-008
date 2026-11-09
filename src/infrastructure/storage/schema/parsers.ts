/**
 * @file 保存データ（unknown）→ 検証済みの型への変換（infrastructure/storage 層の境界）
 * 封筒から取り出した data を検証してから domain 型にする（DI-01）。集約（旅人・台帳・主の盤）は domain の restore に任せ、
 * ここでは「キーの持ち主と中身の ID が一致するか」「封筒の版数と中身の版数が一致するか」を追加で確かめる（改ざん・取り違え対策＝SEC-21）。
 * ライバル行動・セッション・デモ日付オフセットは domain に restore が無いので、ここで項目ごとに検証する。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId, parseOperationId, parseRivalId, parseTravelerId } from '@/Common/types/Id';
import type { TravelerId } from '@/Common/types/Id';
import { parseLocalDate } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import type { SessionState } from '@/application/ports/SessionRepository';
import { LordshipBoard } from '@/domain/competition/LordshipBoard';
import { RivalActionVisit } from '@/domain/competition/Rival';
import { Traveler } from '@/domain/exploration/Traveler';
import { PointLedger } from '@/domain/reward/PointLedger';
import type { StoredRecord } from '@/infrastructure/storage/schema/storageSchema';

const logger = createLogger('infrastructure/storage/schema/parsers');

/** デモ日付オフセットの上限（日。約100年。これを超える値は壊れたデータとみなす） */
export const MAX_DEMO_OFFSET_DAYS = 36_500;

/** デモ日付オフセットの書式（0 以上の整数） */
const OFFSET_DAYS_PATTERN = /^\d{1,6}$/;

/** ライバル行動の保存形（data の中身） */
export interface RivalActionListState {
  readonly travelerId: TravelerId;
  readonly actions: readonly RivalActionVisit[];
}

/**
 * 保存データ不正の失敗を作る（値そのものは入れない）。
 * @param kind 対象の型名
 * @param rule 破った規則名
 * @returns INVALID_INPUT の失敗
 */
function invalidStored(kind: string, rule: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', '保存データが正しくありません', { kind, rule }));
}

/**
 * 保存レコードから旅人を復元し、持ち主の ID と版数の一致を確かめる。
 * @param record 封筒から取り出した版数と中身
 * @param expectedId 読もうとしたキーの旅人ID
 * @returns 成功: 旅人。失敗: INVALID_INPUT（構造・不変条件違反、ID・版数の不一致）
 */
export function parseStoredTraveler(record: StoredRecord, expectedId: TravelerId): Result<Traveler> {
  const log = logger.fn('parseStoredTraveler', { expectedId, version: record.version });
  const restored = Traveler.restore(record.data);
  if (!restored.ok) return log.fail(restored);
  if (restored.value.id !== expectedId) return log.fail(invalidStored('Traveler', 'idMismatch'));
  if (restored.value.version !== record.version) return log.fail(invalidStored('Traveler', 'versionMismatch'));
  return log.exit(ok(restored.value));
}

/**
 * 保存レコードからポイント台帳を復元し、持ち主の ID と版数の一致を確かめる（DI-06 の不変条件は domain が検証）。
 * @param record 封筒から取り出した版数と中身
 * @param expectedTravelerId 読もうとしたキーの旅人ID
 * @returns 成功: 台帳。失敗: INVALID_INPUT
 */
export function parseStoredLedger(record: StoredRecord, expectedTravelerId: TravelerId): Result<PointLedger> {
  const log = logger.fn('parseStoredLedger', { expectedTravelerId, version: record.version });
  const restored = PointLedger.restore(record.data);
  if (!restored.ok) return log.fail(restored);
  if (restored.value.travelerId !== expectedTravelerId) return log.fail(invalidStored('PointLedger', 'idMismatch'));
  if (restored.value.version !== record.version) return log.fail(invalidStored('PointLedger', 'versionMismatch'));
  return log.exit(ok(restored.value));
}

/**
 * 保存レコードから地区の主の盤を復元し、持ち主の ID と版数の一致を確かめる。
 * @param record 封筒から取り出した版数と中身
 * @param expectedTravelerId 読もうとしたキーの旅人ID
 * @returns 成功: 盤。失敗: INVALID_INPUT
 */
export function parseStoredLordship(record: StoredRecord, expectedTravelerId: TravelerId): Result<LordshipBoard> {
  const log = logger.fn('parseStoredLordship', { expectedTravelerId, version: record.version });
  const restored = LordshipBoard.restore(record.data);
  if (!restored.ok) return log.fail(restored);
  if (restored.value.travelerId !== expectedTravelerId) return log.fail(invalidStored('LordshipBoard', 'idMismatch'));
  if (restored.value.version !== record.version) return log.fail(invalidStored('LordshipBoard', 'versionMismatch'));
  return log.exit(ok(restored.value));
}

/**
 * 未検証の値をライバル行動1件として検証する（ID・暦日・回数・任意の操作ID）。
 * @param raw 未検証の値
 * @returns 成功: 凍結済みの RivalActionVisit。失敗: INVALID_INPUT
 */
export function parseRivalActionVisit(raw: unknown): Result<RivalActionVisit> {
  const log = logger.fn('parseRivalActionVisit');
  if (!isRecord(raw)) return log.fail(invalidStored('RivalActionVisit', 'shape'));
  const rivalId = parseRivalId(raw['rivalId']);
  const districtId = parseDistrictId(raw['districtId']);
  const localDate = parseLocalDate(raw['localDate']);
  const count = raw['count'];
  const rawOperationId = raw['operationId'];
  const operationId = rawOperationId === undefined ? ok(undefined) : parseOperationId(rawOperationId);
  if (!rivalId.ok || !districtId.ok || !localDate.ok || !operationId.ok || typeof count !== 'number') {
    return log.fail(invalidStored('RivalActionVisit', 'fields'));
  }
  const base = { rivalId: rivalId.value, districtId: districtId.value, localDate: localDate.value, count };
  return log.exit(RivalActionVisit.of(operationId.value === undefined ? base : { ...base, operationId: operationId.value }));
}

/**
 * 保存レコードからライバル行動の一覧を検証して取り出す（data は { travelerId, actions }）。
 * @param record 封筒から取り出した版数と中身
 * @param expectedTravelerId 読もうとしたキーの旅人ID
 * @returns 成功: 古い順のライバル行動（凍結済み）。失敗: INVALID_INPUT
 */
export function parseStoredRivalActions(record: StoredRecord, expectedTravelerId: TravelerId): Result<readonly RivalActionVisit[]> {
  const log = logger.fn('parseStoredRivalActions', { expectedTravelerId, version: record.version });
  const data = record.data;
  if (!isRecord(data)) return log.fail(invalidStored('RivalActionList', 'shape'));
  const travelerId = parseTravelerId(data['travelerId']);
  if (!travelerId.ok || travelerId.value !== expectedTravelerId) return log.fail(invalidStored('RivalActionList', 'idMismatch'));
  const rawActions = data['actions'];
  if (!Array.isArray(rawActions)) return log.fail(invalidStored('RivalActionList', 'actions'));
  const actions: RivalActionVisit[] = [];
  for (const item of rawActions as readonly unknown[]) {
    const action = parseRivalActionVisit(item);
    if (!action.ok) return log.fail(action);
    actions.push(action.value);
  }
  return log.exit(ok(Object.freeze(actions)), `count=${actions.length}`);
}

/**
 * 保存レコードからセッション（アクティブな旅人）を検証して取り出す（data は { activeTravelerId? }）。
 * @param record 封筒から取り出した版数と中身
 * @returns 成功: SessionState。失敗: INVALID_INPUT
 */
export function parseStoredSession(record: StoredRecord): Result<SessionState> {
  const log = logger.fn('parseStoredSession', { version: record.version });
  const data = record.data;
  if (!isRecord(data)) return log.fail(invalidStored('SessionState', 'shape'));
  const rawId = data['activeTravelerId'];
  if (rawId === undefined || rawId === null) return log.exit(ok(Object.freeze({})));
  const travelerId = parseTravelerId(rawId);
  if (!travelerId.ok) return log.fail(invalidStored('SessionState', 'activeTravelerId'));
  return log.exit(ok(Object.freeze({ activeTravelerId: travelerId.value })));
}

/**
 * 保存されたデモ日付オフセット（日数の10進文字列）を検証する。
 * @param raw 保存されていた文字列
 * @returns 成功: 0〜MAX_DEMO_OFFSET_DAYS の整数。失敗: INVALID_INPUT
 */
export function parseDemoOffsetDays(raw: string): Result<number> {
  const log = logger.fn('parseDemoOffsetDays', { length: raw.length });
  if (!OFFSET_DAYS_PATTERN.test(raw)) return log.fail(invalidStored('DemoOffsetDays', 'format'));
  const days = Number.parseInt(raw, 10);
  if (days > MAX_DEMO_OFFSET_DAYS) return log.fail(invalidStored('DemoOffsetDays', 'range'));
  return log.exit(ok(days));
}
