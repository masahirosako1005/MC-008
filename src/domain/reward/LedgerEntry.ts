/**
 * @file ポイント台帳の1行（LedgerEntry）の型・作成・検証（domain/reward 層）
 * 台帳は追記専用（DI-06）。1行は「訪問の基本点」か「おかえりボーナスの差分」のどちらか。
 * entryId は `${operationId}:visit` / `${operationId}:bonus` で、同じ訪問操作の再実行を冪等にする鍵になる（DI-07）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { Brand } from '@/Common/types/Brand';
import { ID_PATTERNS, parseDistrictId, parseSpotId } from '@/Common/types/Id';
import type { DistrictId, OperationId, SpotId } from '@/Common/types/Id';
import { parseInstant, parseLocalDate } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import { Points } from '@/domain/reward/Points';

const logger = createLogger('domain/reward/LedgerEntry');

/** 台帳の行の種別（訪問の基本点／おかえりボーナスの差分） */
export const LEDGER_ENTRY_KINDS = ['visit', 'welcomeBack'] as const;

/** 台帳の行の種別 */
export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

/** 台帳の行ID（`${operationId}:visit` | `${operationId}:bonus`） */
export type LedgerEntryId = Brand<string, 'LedgerEntryId'>;

/**
 * 操作ID 部分の正規表現（Common/types/Id の ID_PATTERNS.OperationId から先頭の ^ と末尾の $ を除いたもの）。
 * 操作ID の形式の定義を Id.ts の1か所にそろえる（SEC-16）。
 */
const OPERATION_ID_BODY = ID_PATTERNS.OperationId.source.replace(/^\^/, '').replace(/\$$/, '');

/** 行IDの正規表現（`<OperationId>:visit` または `<OperationId>:bonus`） */
export const LEDGER_ENTRY_ID_PATTERN = new RegExp(`^${OPERATION_ID_BODY}:(?:visit|bonus)$`);

/** 種別ごとの行IDの接尾辞 */
const ENTRY_ID_SUFFIX: Readonly<Record<LedgerEntryKind, string>> = { visit: 'visit', welcomeBack: 'bonus' };

/** ポイント台帳の1行（凍結済み。points は 0 以上の整数） */
export interface LedgerEntry {
  readonly entryId: LedgerEntryId;
  readonly kind: LedgerEntryKind;
  readonly points: Points;
  readonly districtId: DistrictId;
  readonly spotId: SpotId;
  /** 加点した日時（UTC） */
  readonly at: Instant;
  /** at の JST 暦日（おかえりボーナスの「当日」の判定に使う） */
  readonly localDate: LocalDate;
}

/** createLedgerEntry の入力（points は未検証の数値。ここで Points.of を通す） */
export interface LedgerEntryInput {
  readonly operationId: OperationId;
  readonly kind: LedgerEntryKind;
  readonly points: number;
  readonly districtId: DistrictId;
  readonly spotId: SpotId;
  readonly at: Instant;
  readonly localDate: LocalDate;
}

/**
 * 不正な行の失敗を作る。値そのものは入れず、破った規則名だけを details に入れる。
 * @param rule 破った規則名
 * @returns INVALID_INPUT の失敗
 */
function invalidEntry(rule: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', 'ポイント台帳のデータが正しくありません', { kind: 'LedgerEntry', rule }));
}

/**
 * 未検証の値が台帳の行の種別か判定する型ガード。
 * @param value 判定する値
 * @returns 'visit' または 'welcomeBack' なら true
 */
export function isLedgerEntryKind(value: unknown): value is LedgerEntryKind {
  return value === 'visit' || value === 'welcomeBack';
}

/**
 * 操作IDと種別から行IDを作る（訪問=`:visit`、おかえりボーナス=`:bonus`）。
 * 同じ訪問操作からは常に同じ行IDになるので、再実行しても台帳に2重に載らない（DI-07）。
 * @param operationId 訪問操作のID（検証済み）
 * @param kind 行の種別
 * @returns 行ID
 */
export function ledgerEntryIdOf(operationId: OperationId, kind: LedgerEntryKind): LedgerEntryId {
  return `${operationId}:${ENTRY_ID_SUFFIX[kind]}` as LedgerEntryId; // 検証済みの操作IDと固定の接尾辞だけで組み立てる
}

/**
 * おかえりボーナス行に対応する訪問行の行IDを返す（ボーナスは同じ操作の訪問行とセットでしか存在しない）。
 * @param entryId 行ID
 * @returns 同じ操作の訪問行の行ID
 */
export function visitEntryIdFor(entryId: LedgerEntryId): LedgerEntryId {
  return entryId.replace(/:bonus$/, ':visit') as LedgerEntryId; // 検証済みの行IDの接尾辞だけを差し替える
}

/**
 * 未検証の値を行IDとして検証し、種別と接尾辞が合っているかも確かめる。
 * @param raw 未検証の値
 * @param kind 検証済みの種別
 * @returns 成功: LedgerEntryId。失敗: INVALID_INPUT
 */
function parseEntryId(raw: unknown, kind: LedgerEntryKind): Result<LedgerEntryId> {
  const log = logger.fn('parseEntryId', { kind });
  if (typeof raw !== 'string' || !LEDGER_ENTRY_ID_PATTERN.test(raw)) return log.fail(invalidEntry('entryId'));
  if (!raw.endsWith(`:${ENTRY_ID_SUFFIX[kind]}`)) return log.fail(invalidEntry('entryIdKindMismatch'));
  return log.exit(ok(raw as LedgerEntryId)); // 正規表現と接尾辞を確認済み
}

/**
 * 訪問操作の結果から台帳の行を作る（ポイントは Points.of で検証する）。
 * @param input 操作ID・種別・ポイント・地区・スポット・日時・暦日
 * @returns 成功: 凍結済み LedgerEntry。失敗: INVALID_INPUT（ポイントが負・小数など）
 */
export function createLedgerEntry(input: LedgerEntryInput): Result<LedgerEntry> {
  const log = logger.fn('createLedgerEntry', { kind: input.kind, points: input.points, spotId: input.spotId });
  const points = Points.of(input.points);
  if (!points.ok) return log.fail(points);
  const { kind, districtId, spotId, at, localDate } = input;
  const entryId = ledgerEntryIdOf(input.operationId, kind);
  return log.exit(ok(Object.freeze({ entryId, kind, points: points.value, districtId, spotId, at, localDate })));
}

/**
 * 未検証の値（保存データ）を台帳の行として検証する（DI-01）。points は 0 以上の整数のみ。
 * @param raw 未検証の値
 * @returns 成功: 凍結済み LedgerEntry。失敗: INVALID_INPUT（details.rule に破った項目）
 */
export function parseLedgerEntry(raw: unknown): Result<LedgerEntry> {
  const log = logger.fn('parseLedgerEntry');
  if (!isRecord(raw)) return log.fail(invalidEntry('shape'));
  const kind = raw['kind'];
  if (!isLedgerEntryKind(kind)) return log.fail(invalidEntry('kind'));
  const entryId = parseEntryId(raw['entryId'], kind);
  if (!entryId.ok) return log.fail(entryId);
  const points = Points.of(raw['points']);
  if (!points.ok) return log.fail(invalidEntry('points'));
  const districtId = parseDistrictId(raw['districtId']);
  const spotId = parseSpotId(raw['spotId']);
  const at = parseInstant(raw['at']);
  const localDate = parseLocalDate(raw['localDate']);
  if (!districtId.ok || !spotId.ok || !at.ok || !localDate.ok) return log.fail(invalidEntry('fields'));
  return log.exit(
    ok(Object.freeze({ entryId: entryId.value, kind, points: points.value, districtId: districtId.value, spotId: spotId.value, at: at.value, localDate: localDate.value })),
  );
}
