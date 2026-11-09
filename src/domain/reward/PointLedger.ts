/**
 * @file ポイント台帳（集約ルート・domain/reward 層）
 * 追記専用（DI-06）。残高は行の合計から導出し、残高を直接書き換える操作（setBalance 等）は作らない。
 * 同じ entryId の行は2回目以降を無視するので、同じ訪問操作を再実行しても残高は1回分のまま（DI-07）。
 * 行のポイントは 0 以上の整数なので、残高は構造的に負にならず、減ることもない（CLAUDE.md 5「失う体験を作らない」）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseTravelerId } from '@/Common/types/Id';
import type { TravelerId } from '@/Common/types/Id';
import { invariant } from '@/Common/utils/assert';
import { isRecord } from '@/Common/utils/guards';
import { isNonNegativeInteger } from '@/Common/utils/number';
import { parseLedgerEntry, visitEntryIdFor } from '@/domain/reward/LedgerEntry';
import type { LedgerEntry } from '@/domain/reward/LedgerEntry';
import { Points } from '@/domain/reward/Points';

export {
  LEDGER_ENTRY_ID_PATTERN,
  LEDGER_ENTRY_KINDS,
  createLedgerEntry,
  isLedgerEntryKind,
  ledgerEntryIdOf,
  parseLedgerEntry,
  visitEntryIdFor,
} from '@/domain/reward/LedgerEntry';
export type { LedgerEntry, LedgerEntryId, LedgerEntryInput, LedgerEntryKind } from '@/domain/reward/LedgerEntry';

const logger = createLogger('domain/reward/PointLedger');

/** ポイント台帳の保存形（行は古い順） */
export interface PointLedgerState {
  readonly travelerId: TravelerId;
  /** 楽観ロック用の版数（リポジトリが保存成功時に +1 する） */
  readonly version: number;
  readonly entries: readonly LedgerEntry[];
}

/**
 * 不正な台帳の失敗を作る。値そのものは入れず、破った規則名だけを details に入れる。
 * @param rule 破った規則名
 * @returns INVALID_INPUT の失敗
 */
function invalidLedger(rule: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', 'ポイント台帳のデータが正しくありません', { kind: 'PointLedger', rule }));
}

/**
 * 保存形を凍結する（行の配列も凍結し、外から書き換えられないようにする）。
 * @param state 保存形
 * @returns 凍結済みの保存形
 */
function freezeState(state: PointLedgerState): PointLedgerState {
  return Object.freeze({ ...state, entries: Object.freeze([...state.entries]) });
}

/**
 * 未検証の値（保存データ）を台帳の保存形として構造検証する（DI-01）。不変条件は checkLedgerInvariants で別に見る。
 * @param raw 未検証の値
 * @returns 成功: 凍結済み PointLedgerState。失敗: INVALID_INPUT（details.rule に破った項目）
 */
export function parsePointLedgerState(raw: unknown): Result<PointLedgerState> {
  const log = logger.fn('parsePointLedgerState');
  if (!isRecord(raw)) return log.fail(invalidLedger('shape'));
  const travelerId = parseTravelerId(raw['travelerId']);
  if (!travelerId.ok) return log.fail(invalidLedger('travelerId'));
  const version = raw['version'];
  if (!isNonNegativeInteger(version)) return log.fail(invalidLedger('version'));
  const rawEntries = raw['entries'];
  if (!Array.isArray(rawEntries)) return log.fail(invalidLedger('entries'));
  const items: readonly unknown[] = rawEntries;
  const entries: LedgerEntry[] = [];
  for (const item of items) {
    const entry = parseLedgerEntry(item);
    if (!entry.ok) return log.fail(entry);
    entries.push(entry.value);
  }
  return log.exit(ok(freezeState({ travelerId: travelerId.value, version, entries })));
}

/**
 * 台帳の不変条件を検証し、残高を返す（DI-02, DI-06）。
 * - 行ID（entryId）は一意
 * - おかえりボーナス行は、同じ操作の訪問行が台帳にある
 * - 残高（行の合計）は安全な整数の範囲に収まる
 * 行のポイントが 0 以上の整数であることは parseLedgerEntry / createLedgerEntry で保証済み。
 * @param entries 構造検証済みの行
 * @returns 成功: 残高。失敗: INVALID_INPUT（details.rule: uniqueEntryId / bonusWithoutVisit / tooLarge）
 */
export function checkLedgerInvariants(entries: readonly LedgerEntry[]): Result<Points> {
  const log = logger.fn('checkLedgerInvariants', { entries: entries.length });
  const ids = new Set<string>(entries.map((e) => e.entryId));
  if (ids.size !== entries.length) return log.fail(invalidLedger('uniqueEntryId'));
  const orphanBonus = entries.some((e) => e.kind === 'welcomeBack' && !ids.has(visitEntryIdFor(e.entryId)));
  if (orphanBonus) return log.fail(invalidLedger('bonusWithoutVisit'));
  let total = Points.ZERO;
  for (const entry of entries) {
    const sum = Points.add(total, entry.points);
    if (!sum.ok) return log.fail(invalidLedger('tooLarge'));
    total = sum.value;
  }
  return log.exit(ok(total));
}

/** ポイント台帳（集約ルート・不変。変更メソッドは新しいインスタンスを返す） */
export class PointLedger {
  private readonly entryIds: ReadonlySet<string>;

  /**
   * 検証済みの保存形と残高から作る（外からは empty / restore を使う）。行IDの索引を前計算する。
   * @param state 凍結済みで不変条件を満たす保存形
   * @param total 行の合計（checkLedgerInvariants が返した残高）
   */
  private constructor(
    private readonly state: PointLedgerState,
    private readonly total: Points,
  ) {
    this.entryIds = new Set(state.entries.map((e) => e.entryId));
  }

  /**
   * 行が空の台帳を作る（版数 0、残高 0）。
   * @param travelerId 旅人ID
   * @returns 新しい台帳
   */
  static empty(travelerId: TravelerId): PointLedger {
    const log = logger.fn('empty', { travelerId });
    const state: PointLedgerState = { travelerId, version: 0, entries: [] };
    return log.exit(new PointLedger(freezeState(state), Points.ZERO));
  }

  /**
   * 保存形（保存データから読んだ未検証の値でもよい）から台帳を復元する。構造と不変条件を検証する。
   * @param state 保存形
   * @returns 成功: 台帳。失敗: INVALID_INPUT（details.rule に破った規則。entryId 重複・ポイントが負や小数など）
   */
  static restore(state: unknown): Result<PointLedger> {
    const log = logger.fn('restore'); // 保存データ由来で壊れている可能性があるため、検証前に中身を読まない
    const parsed = parsePointLedgerState(state);
    if (!parsed.ok) return log.fail(parsed);
    const total = checkLedgerInvariants(parsed.value.entries);
    if (!total.ok) return log.fail(total);
    log.debug('検証済み', { entries: parsed.value.entries.length, version: parsed.value.version, balance: total.value });
    return log.exit(ok(new PointLedger(parsed.value, total.value)));
  }

  /** 旅人ID */
  get travelerId(): TravelerId {
    return this.state.travelerId;
  }

  /** 版数（楽観ロック用。リポジトリが保存成功時に +1 する） */
  get version(): number {
    return this.state.version;
  }

  /** 行（古い順・凍結済み） */
  get entries(): readonly LedgerEntry[] {
    return this.state.entries;
  }

  /**
   * 残高を返す。行の合計から導出した値で、直接書き換える手段はない（DI-06）。
   * @returns 残高（0 以上の整数）
   */
  balance(): Points {
    return this.total;
  }

  /**
   * その行IDが台帳に載っているか判定する（ユースケースが「この訪問は加点済みか」を確かめる用）。
   * @param entryId 行ID
   * @returns 載っていれば true
   */
  hasEntry(entryId: string): boolean {
    return this.entryIds.has(entryId);
  }

  /**
   * 行を追記した新しい台帳を返す。既に載っている entryId の行（同じバッチ内の重複も）は無視する（冪等＝DI-07）。
   * 1件でも不正な行があれば何も追記せず失敗する（全部か無し）。新しい行が無ければ自分自身を返す。
   * @param entries 追記する行
   * @returns 成功: 台帳。失敗: INVALID_INPUT（行が不正・同じ操作の訪問行が無いボーナス行・残高が範囲外）
   */
  append(entries: readonly LedgerEntry[]): Result<PointLedger> {
    const log = logger.fn('append', { count: entries.length, version: this.version });
    const known = new Set(this.entryIds);
    const added: LedgerEntry[] = [];
    for (const entry of entries) {
      const checked = parseLedgerEntry(entry); // 型を偽った値が混ざっても不正な行を載せない
      if (!checked.ok) return log.fail(checked);
      if (known.has(checked.value.entryId)) continue;
      known.add(checked.value.entryId);
      added.push(checked.value);
    }
    log.debug('追記対象', { added: added.length, skipped: entries.length - added.length });
    if (added.length === 0) return log.exit(ok(this));
    const nextEntries = [...this.state.entries, ...added];
    const total = checkLedgerInvariants(nextEntries);
    if (!total.ok) return log.fail(total);
    return log.exit(ok(new PointLedger(freezeState({ ...this.state, entries: nextEntries }), total.value)));
  }

  /**
   * 保存形を返す（凍結済み）。
   * @returns 保存形
   */
  toState(): PointLedgerState {
    return this.state;
  }

  /**
   * 版数だけを変えた台帳を返す（リポジトリが保存成功時に使う）。
   * @param version 新しい版数（0 以上の整数）
   * @returns 新しい台帳
   * @throws Error 版数が不正（呼び出し側のバグ）
   */
  withVersion(version: number): PointLedger {
    const log = logger.fn('withVersion', { version });
    invariant(isNonNegativeInteger(version), 'PointLedger.withVersion: 版数は 0 以上の整数');
    return log.exit(new PointLedger(freezeState({ ...this.state, version }), this.total));
  }
}
