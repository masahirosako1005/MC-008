/**
 * @file 旅人集約の保存形（TravelerState）と、その検証・不変条件（domain/exploration 層）
 * Traveler.restore はここで構造（DI-01）と不変条件（DI-02, DI-08）を検証してから集約を作る。
 * infrastructure の parsers.ts も parseTravelerState を使って unknown → TravelerState に変換できる。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseOperationId, parseTravelerId } from '@/Common/types/Id';
import type { OperationId, TravelerId } from '@/Common/types/Id';
import { codePointLength, hasControlChars, isRecord } from '@/Common/utils/guards';
import { isNonNegativeInteger } from '@/Common/utils/number';
import { DEFAULT_NICKNAME, MAX_NICKNAME_LENGTH, MAX_PROCESSED_OPERATION_IDS } from '@/domain/exploration/constants';
import { parseCouponRedemption, parseDiscoveryRecord, parseVisitRecord } from '@/domain/exploration/VisitRecord';
import type { CouponRedemption, DiscoveryRecord, VisitRecord } from '@/domain/exploration/VisitRecord';

const logger = createLogger('domain/exploration/TravelerState');

/** 旅人のプロフィール（デモの「初回の人」「通い慣れた人」、本番の利用者） */
export const TRAVELER_PROFILES = ['first', 'regular', 'user'] as const;

/** 旅人のプロフィール */
export type TravelerProfile = (typeof TRAVELER_PROFILES)[number];

/** 旅人集約の保存形（すべて readonly。processedOperationIds は直近 MAX_PROCESSED_OPERATION_IDS 件） */
export interface TravelerState {
  readonly id: TravelerId;
  readonly nickname: string;
  readonly profile: TravelerProfile;
  readonly version: number;
  readonly discoveries: readonly DiscoveryRecord[];
  readonly visits: readonly VisitRecord[];
  readonly redemptions: readonly CouponRedemption[];
  readonly processedOperationIds: readonly OperationId[];
}

/** 保存形のうち ID・表示名・プロフィール・版数 */
type TravelerHeader = Pick<TravelerState, 'id' | 'nickname' | 'profile' | 'version'>;

/** 保存形のうち記録の配列 */
type TravelerRecords = Pick<TravelerState, 'discoveries' | 'visits' | 'redemptions' | 'processedOperationIds'>;

/**
 * 不正データの失敗を作る。値そのものは入れず、破った規則名だけを details に入れる。
 * @param rule 破った規則名
 * @returns INVALID_INPUT の失敗
 */
function invalidState(rule: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', '冒険者データが正しくありません', { kind: 'TravelerState', rule }));
}

/**
 * 未検証の値がプロフィールか判定する型ガード。
 * @param value 判定する値
 * @returns 'first' / 'regular' / 'user' なら true
 */
export function isTravelerProfile(value: unknown): value is TravelerProfile {
  return value === 'first' || value === 'regular' || value === 'user';
}

/**
 * ニックネームを正規化する（NFC・制御文字除去・前後空白除去・最大文字数で切詰め。空なら既定名）（DI-17）。
 * @param raw 入力されたニックネーム
 * @returns 正規化したニックネーム（1〜MAX_NICKNAME_LENGTH 文字）
 */
export function normalizeNickname(raw: string): string {
  const log = logger.fn('normalizeNickname', { length: raw.length });
  const cleaned = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  const clipped = Array.from(cleaned).slice(0, MAX_NICKNAME_LENGTH).join('').trim();
  return log.exit(clipped.length > 0 ? clipped : DEFAULT_NICKNAME);
}

/**
 * 保存されていたニックネームとして正しいか判定する（空でない・制御文字なし・最大文字数以内）。
 * @param value 判定する値
 * @returns 正しければ true
 */
export function isValidNickname(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !hasControlChars(value) && codePointLength(value) <= MAX_NICKNAME_LENGTH;
}

/**
 * 処理済み操作ID 列を直近 MAX_PROCESSED_OPERATION_IDS 件に切り詰める（古いものから捨てる＝DI-07）。
 * @param ids 古い順の操作ID 列
 * @returns 切り詰めた列（凍結済み）
 */
export function trimProcessedOperationIds(ids: readonly OperationId[]): readonly OperationId[] {
  return Object.freeze(ids.length > MAX_PROCESSED_OPERATION_IDS ? ids.slice(ids.length - MAX_PROCESSED_OPERATION_IDS) : [...ids]);
}

/**
 * 未検証の配列の各要素をパーサで検証する。1件でも不正なら失敗。
 * @param raw 未検証の値（配列であること）
 * @param parser 要素のパーサ
 * @param rule 失敗時の規則名
 * @returns 成功: 凍結済み配列。失敗: INVALID_INPUT
 */
function parseList<T>(raw: unknown, parser: (item: unknown) => Result<T>, rule: string): Result<readonly T[]> {
  const log = logger.fn('parseList', { rule });
  if (!Array.isArray(raw)) return log.fail(invalidState(rule));
  const items: readonly unknown[] = raw;
  const out: T[] = [];
  for (const item of items) {
    const parsed = parser(item);
    if (!parsed.ok) return log.fail(invalidState(rule));
    out.push(parsed.value);
  }
  return log.exit(ok(Object.freeze(out)));
}

/**
 * ID・ニックネーム・プロフィール・版数を検証する。
 * @param raw 未検証のオブジェクト
 * @returns 成功: TravelerHeader。失敗: INVALID_INPUT
 */
function parseHeader(raw: Readonly<Record<string, unknown>>): Result<TravelerHeader> {
  const log = logger.fn('parseHeader');
  const id = parseTravelerId(raw['id']);
  const nickname = raw['nickname'];
  const profile = raw['profile'];
  const version = raw['version'];
  if (!id.ok) return log.fail(invalidState('id'));
  if (!isValidNickname(nickname)) return log.fail(invalidState('nickname'));
  if (!isTravelerProfile(profile)) return log.fail(invalidState('profile'));
  if (!isNonNegativeInteger(version)) return log.fail(invalidState('version'));
  return log.exit(ok({ id: id.value, nickname, profile, version }));
}

/**
 * 発見・訪問・クーポン利用・処理済み操作ID の配列を検証する。
 * @param raw 未検証のオブジェクト
 * @returns 成功: TravelerRecords。失敗: INVALID_INPUT
 */
function parseRecords(raw: Readonly<Record<string, unknown>>): Result<TravelerRecords> {
  const log = logger.fn('parseRecords');
  const discoveries = parseList(raw['discoveries'], parseDiscoveryRecord, 'discoveries');
  if (!discoveries.ok) return log.fail(discoveries);
  const visits = parseList(raw['visits'], parseVisitRecord, 'visits');
  if (!visits.ok) return log.fail(visits);
  const redemptions = parseList(raw['redemptions'], parseCouponRedemption, 'redemptions');
  if (!redemptions.ok) return log.fail(redemptions);
  const processedOperationIds = parseList(raw['processedOperationIds'], parseOperationId, 'processedOperationIds');
  if (!processedOperationIds.ok) return log.fail(processedOperationIds);
  return log.exit(
    ok({ discoveries: discoveries.value, visits: visits.value, redemptions: redemptions.value, processedOperationIds: processedOperationIds.value }),
  );
}

/**
 * 未検証の値（保存データ）を TravelerState として構造検証する（DI-01）。不変条件は checkTravelerInvariants で別に見る。
 * @param raw 未検証の値
 * @returns 成功: 凍結済み TravelerState。失敗: INVALID_INPUT（details.rule に破った項目）
 */
export function parseTravelerState(raw: unknown): Result<TravelerState> {
  const log = logger.fn('parseTravelerState');
  if (!isRecord(raw)) return log.fail(invalidState('shape'));
  const header = parseHeader(raw);
  if (!header.ok) return log.fail(header);
  const records = parseRecords(raw);
  if (!records.ok) return log.fail(records);
  return log.exit(ok(Object.freeze({ ...header.value, ...records.value })));
}

/**
 * 配列のキーに重複があるか判定する。
 * @param keys キー列
 * @returns 重複があれば true
 */
function hasDuplicate(keys: readonly string[]): boolean {
  return new Set(keys).size !== keys.length;
}

/**
 * 旅人集約の不変条件を検証する（DI-02, DI-08）。
 * - 発見記録はスポットごとに1件
 * - 訪問記録の (spotId, localDate) は一意（同一スポットは1日1回）
 * - 訪問済みのスポットは発見済み
 * - クーポン利用はクーポンごとに1件
 * @param state 構造検証済みの保存形
 * @returns 成功: void。失敗: INVALID_INPUT（details.rule に破った規則）
 */
export function checkTravelerInvariants(state: TravelerState): Result<void> {
  const log = logger.fn('checkTravelerInvariants', { visits: state.visits.length, discoveries: state.discoveries.length });
  if (hasDuplicate(state.discoveries.map((d) => d.spotId))) return log.fail(invalidState('uniqueDiscovery'));
  if (hasDuplicate(state.visits.map((v) => `${v.spotId}|${v.localDate}`))) return log.fail(invalidState('uniqueVisitPerDay'));
  const discovered = new Set(state.discoveries.map((d) => d.spotId));
  if (!state.visits.every((v) => discovered.has(v.spotId))) return log.fail(invalidState('visitedMustBeDiscovered'));
  if (hasDuplicate(state.redemptions.map((r) => r.shopEventId))) return log.fail(invalidState('uniqueRedemption'));
  return log.exit(okVoid());
}
