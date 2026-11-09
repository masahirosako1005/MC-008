/**
 * @file 地区の主の盤（集約・domain/competition 層）
 * 旅人ごとの世界で「各地区の主は誰か」と「旅人が主の座を奪われて取り返し中か（lostByTraveler）」を持つ不変オブジェクト。
 * - 主の交代は LordPolicy.decide の結果を apply で反映する（docs/08 D7）
 * - 旅人 → ライバルの交代で lostByTraveler=true、旅人が主に戻れば false。ライバル → ライバルでは変えない（D8）
 * - 版数（version）は楽観ロック用。リポジトリが保存成功時に +1 する（DI-10）
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId, parseTravelerId } from '@/Common/types/Id';
import type { DistrictId, TravelerId } from '@/Common/types/Id';
import { invariant } from '@/Common/utils/assert';
import { isRecord } from '@/Common/utils/guards';
import { isNonNegativeInteger } from '@/Common/utils/number';
import { holderKey, parseLordHolder, sameHolder } from '@/domain/competition/LordHolder';
import type { LordHolder } from '@/domain/competition/LordHolder';

const logger = createLogger('domain/competition/LordshipBoard');

/** 1地区分の主の状態 */
export interface LordshipEntry {
  readonly districtId: DistrictId;
  /** 主（主なしなら undefined） */
  readonly holder?: LordHolder;
  /** 旅人が主の座をライバルに奪われ、まだ取り返していない（true なら holder はライバル） */
  readonly lostByTraveler: boolean;
}

/** 盤の保存形 */
export interface LordshipBoardState {
  readonly travelerId: TravelerId;
  /** 版数（0以上の整数） */
  readonly version: number;
  /** 地区ごとの状態（districtId は一意） */
  readonly entries: readonly LordshipEntry[];
}

/** apply の結果 */
export interface LordshipApplyOutcome {
  readonly board: LordshipBoard;
  /** 主が変わった */
  readonly changed: boolean;
  /** 適用前の主（主なしなら undefined） */
  readonly from?: LordHolder;
}

/** 不変条件違反の種類（AppError.details.rule に入れる） */
type BoardRule = 'shape' | 'travelerId' | 'version' | 'entries' | 'entry' | 'districtId' | 'holder' | 'lostByTraveler' | 'duplicateDistrict';

/**
 * 保存データの不正を表す失敗値を作る（値そのものは details に入れない）。
 * @param rule 破った規則
 * @param index 違反した行の位置（該当する場合のみ）
 * @returns INVALID_INPUT の失敗 Result
 */
function invalid(rule: BoardRule, index?: number): Result<never> {
  const log = logger.fn('invalid', { rule, index });
  const details = index === undefined ? { kind: 'LordshipBoard', rule } : { kind: 'LordshipBoard', rule, index };
  return log.exit(fail(AppError.of('INVALID_INPUT', '地区の主のデータが正しくありません', details)));
}

/**
 * 1地区分の状態を作る（凍結済み。主なしなら holder を持たない）。
 * @param districtId 地区ID
 * @param holder 主（undefined は主なし）
 * @param lostByTraveler 取り返し中か
 * @returns 凍結済みの LordshipEntry
 */
function makeEntry(districtId: DistrictId, holder: LordHolder | undefined, lostByTraveler: boolean): LordshipEntry {
  return Object.freeze(holder === undefined ? { districtId, lostByTraveler } : { districtId, holder, lostByTraveler });
}

/**
 * 未検証の1行を検証して LordshipEntry にする（holder の null は主なしとして受け付ける）。
 * 不変条件: lostByTraveler が true なら holder はライバル。
 * @param raw 未検証の値
 * @param index 行の位置（失敗時の details 用）
 * @returns 成功: LordshipEntry。失敗: INVALID_INPUT
 */
function parseEntry(raw: unknown, index: number): Result<LordshipEntry> {
  const log = logger.fn('parseEntry', { index });
  if (!isRecord(raw)) return log.fail(invalid('entry', index));
  const districtId = parseDistrictId(raw['districtId']);
  if (!districtId.ok) return log.fail(invalid('districtId', index));
  const rawHolder = raw['holder'];
  const holder = rawHolder === undefined || rawHolder === null ? ok(undefined) : parseLordHolder(rawHolder);
  if (!holder.ok) return log.fail(invalid('holder', index));
  const lost = raw['lostByTraveler'];
  if (typeof lost !== 'boolean') return log.fail(invalid('lostByTraveler', index));
  if (lost && holder.value?.type !== 'rival') return log.fail(invalid('lostByTraveler', index));
  return log.exit(ok(makeEntry(districtId.value, holder.value, lost)));
}

/**
 * 未検証の行の配列を検証する（1行でも不正なら失敗。districtId の重複も失敗）。
 * @param raw 未検証の値
 * @returns 成功: 凍結済みの行の配列。失敗: INVALID_INPUT
 */
function parseEntries(raw: unknown): Result<readonly LordshipEntry[]> {
  const log = logger.fn('parseEntries');
  if (!Array.isArray(raw)) return log.fail(invalid('entries'));
  const entries: LordshipEntry[] = [];
  const seen = new Set<DistrictId>();
  for (const [index, item] of (raw as readonly unknown[]).entries()) {
    const entry = parseEntry(item, index);
    if (!entry.ok) return log.fail(entry);
    if (seen.has(entry.value.districtId)) return log.fail(invalid('duplicateDistrict', index));
    seen.add(entry.value.districtId);
    entries.push(entry.value);
  }
  return log.exit(ok(Object.freeze(entries)));
}

/**
 * 未検証の値（保存データ）を盤の保存形として検証する（DI-01）。
 * @param raw 未検証の値（{ travelerId, version, entries }）
 * @returns 成功: 凍結済みの保存形。失敗: INVALID_INPUT（details.rule に破った規則）
 */
export function parseLordshipBoardState(raw: unknown): Result<LordshipBoardState> {
  const log = logger.fn('parseLordshipBoardState'); // 保存データ由来で壊れている可能性があるため、検証前に中身をログに出さない
  if (!isRecord(raw)) return log.fail(invalid('shape'));
  const travelerId = parseTravelerId(raw['travelerId']);
  if (!travelerId.ok) return log.fail(invalid('travelerId'));
  const version = raw['version'];
  if (!isNonNegativeInteger(version)) return log.fail(invalid('version'));
  const entries = parseEntries(raw['entries']);
  if (!entries.ok) return log.fail(entries);
  return log.exit(ok(Object.freeze({ travelerId: travelerId.value, version, entries: entries.value })));
}

/**
 * 主が交代したときの lostByTraveler の次の値を決める（D8）。
 * 旅人 → ライバルで true、旅人が主になれば false、主なしになれば取り返す相手がいないので false。
 * ライバル → ライバル（および主なし → ライバル）では変えない。
 * @param before 交代前の行（無ければ主なし・取り返し中でない）
 * @param next 新しい主
 * @returns 次の lostByTraveler
 */
function nextLostByTraveler(before: LordshipEntry | undefined, next: LordHolder | undefined): boolean {
  const log = logger.fn('nextLostByTraveler', { from: before?.holder === undefined ? undefined : holderKey(before.holder), to: next === undefined ? undefined : holderKey(next) });
  if (next === undefined || next.type === 'traveler') return log.exit(false);
  if (before?.holder?.type === 'traveler') return log.exit(true);
  return log.exit(before?.lostByTraveler ?? false);
}

/** 地区の主の盤（集約ルート・不変） */
export class LordshipBoard {
  private readonly byDistrict: ReadonlyMap<DistrictId, LordshipEntry>;

  /**
   * 検証済みの保存形から作る（外からは empty / restore を使う）。地区ごとの索引を前計算する。
   * @param state 凍結済みで不変条件を満たす保存形
   */
  private constructor(private readonly state: LordshipBoardState) {
    this.byDistrict = new Map(state.entries.map((e) => [e.districtId, e]));
  }

  /**
   * 全地区が主なしの新しい盤を作る（版数 0）。重複した地区ID は1つにまとめる。
   * @param travelerId 旅人ID
   * @param districtIds 地区ID（省略時は地区なし。行は apply で必要になったときに増える）
   * @returns 新しい盤
   */
  static empty(travelerId: TravelerId, districtIds: readonly DistrictId[] = []): LordshipBoard {
    const log = logger.fn('empty', { travelerId, districts: districtIds.length });
    const entries = [...new Set(districtIds)].map((id) => makeEntry(id, undefined, false));
    return log.exit(new LordshipBoard(Object.freeze({ travelerId, version: 0, entries: Object.freeze(entries) })));
  }

  /**
   * 保存形から盤を復元する。構造と不変条件（districtId の一意、取り返し中なら主はライバル）を検証する。
   * @param state 保存形（保存データ由来の未検証の値でもよい）
   * @returns 成功: 盤。失敗: INVALID_INPUT（details.rule に破った規則）
   */
  static restore(state: unknown): Result<LordshipBoard> {
    const log = logger.fn('restore');
    const parsed = parseLordshipBoardState(state);
    if (!parsed.ok) return log.fail(parsed);
    return log.exit(ok(new LordshipBoard(parsed.value)), `entries=${parsed.value.entries.length}`);
  }

  /**
   * 保存形を返す（凍結済み）。
   * @returns 保存形
   */
  toState(): LordshipBoardState {
    return this.state;
  }

  /** 旅人ID */
  get travelerId(): TravelerId {
    return this.state.travelerId;
  }

  /** 版数（楽観ロック用） */
  get version(): number {
    return this.state.version;
  }

  /** 地区ごとの状態（凍結済み） */
  get entries(): readonly LordshipEntry[] {
    return this.state.entries;
  }

  /**
   * 地区の状態を返す。
   * @param districtId 地区ID
   * @returns 状態。盤に行が無ければ undefined（主なし・取り返し中でない、と同じ意味）
   */
  entryOf(districtId: DistrictId): LordshipEntry | undefined {
    return this.byDistrict.get(districtId);
  }

  /**
   * 地区の主を返す。
   * @param districtId 地区ID
   * @returns 主。主なし（行が無い場合も）なら undefined
   */
  holderOf(districtId: DistrictId): LordHolder | undefined {
    return this.byDistrict.get(districtId)?.holder;
  }

  /**
   * 旅人がその地区の主を奪われて取り返し中か判定する（「取り返し」理由を出す条件＝D8）。
   * @param districtId 地区ID
   * @returns 取り返し中なら true
   */
  isLostByTraveler(districtId: DistrictId): boolean {
    return this.byDistrict.get(districtId)?.lostByTraveler ?? false;
  }

  /**
   * 地区の主を next にする（LordPolicy.decide の結果を反映する）。主が変わらなければ同じ盤を返す。
   * 盤に無い地区は行を追加する。版数は変えない（保存時にリポジトリが +1）。
   * @param districtId 地区ID
   * @param next 新しい主（主なしなら undefined）
   * @returns 新しい盤・交代したか・適用前の主
   * @see docs/08 D7, D8
   */
  apply(districtId: DistrictId, next: LordHolder | undefined): LordshipApplyOutcome {
    const log = logger.fn('apply', { districtId, to: next === undefined ? undefined : holderKey(next) });
    const before = this.byDistrict.get(districtId);
    const from = before?.holder;
    if (sameHolder(from, next)) return log.exit(from === undefined ? { board: this, changed: false } : { board: this, changed: false, from });
    const entry = makeEntry(districtId, next, nextLostByTraveler(before, next));
    const entries = before === undefined ? [...this.state.entries, entry] : this.state.entries.map((e) => (e.districtId === districtId ? entry : e));
    const board = new LordshipBoard(Object.freeze({ ...this.state, entries: Object.freeze(entries) }));
    log.debug('主が交代', { from: from === undefined ? undefined : holderKey(from), lostByTraveler: entry.lostByTraveler });
    return log.exit(from === undefined ? { board, changed: true } : { board, changed: true, from });
  }

  /**
   * 版数だけを変えた盤を返す（リポジトリが保存成功時に使う）。
   * @param version 新しい版数（0以上の整数）
   * @returns 新しい盤
   * @throws Error 版数が不正（呼び出し側のバグ）
   */
  withVersion(version: number): LordshipBoard {
    const log = logger.fn('withVersion', { version });
    invariant(isNonNegativeInteger(version), 'LordshipBoard.withVersion: 版数は 0 以上の整数');
    return log.exit(new LordshipBoard(Object.freeze({ ...this.state, version })));
  }
}
