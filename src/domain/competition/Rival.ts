/**
 * @file 模擬ライバルとライバル行動の型・不変条件（domain/competition 層）
 * 実在ユーザーの代わりに、日付から純粋計算できる決定論的なライバルを置く（docs/08 D9）。
 * - Rival: 地区ごとに「intervalDays 日ごとに1回訪問」する背景活動（patterns）を持つ。マスタ rivals.json 由来
 * - RivalActionVisit: デモの「ライバル行動」で記録する追加訪問（旅人ごとの世界に属する）
 * unknown からの読み込み（JSON 検証）は infrastructure の役割。ここは検証済みの値に対する不変条件チェックだけを持つ（DI-02）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { DistrictId, OperationId, RivalId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import { isValidNickname } from '@/domain/exploration/TravelerState';

const logger = createLogger('domain/competition/Rival');

/** ライバルの背景活動（ある地区に intervalDays 日ごとに1回訪問する） */
export interface RivalPattern {
  readonly districtId: DistrictId;
  /** 訪問の間隔（日。1以上の整数） */
  readonly intervalDays: number;
  /** 位相（0以上 intervalDays 未満の整数）。(epochDay + phase) % intervalDays === 0 の日に訪問する */
  readonly phase: number;
}

/** 模擬ライバル（マスタ rivals.json 由来・不変） */
export interface Rival {
  readonly id: RivalId;
  /** 表示名（例: 旅人タロウ） */
  readonly name: string;
  /** 地区ごとの背景活動（同じ地区は1件まで。空でもよい＝デモ行動だけで動くライバル） */
  readonly patterns: readonly RivalPattern[];
}

/** デモの「ライバル行動」で追加した訪問（その日に count 回訪問したとみなす） */
export interface RivalActionVisit {
  readonly rivalId: RivalId;
  readonly districtId: DistrictId;
  readonly localDate: LocalDate;
  /** 追加した訪問回数（1以上の整数） */
  readonly count: number;
  /** 記録した操作の ID（任意。リポジトリが同じ ID の二重追記を無視するために使う＝DI-07） */
  readonly operationId?: OperationId;
}

/** Rival.of の入力（patterns は検証後に凍結コピーされる） */
export interface RivalInput {
  readonly id: RivalId;
  readonly name: string;
  readonly patterns: readonly RivalPattern[];
}

/** 不変条件違反の種類（AppError.details.rule に入れる） */
export type RivalRule = 'name' | 'intervalDays' | 'phase' | 'duplicateDistrict' | 'count';

/**
 * 不変条件違反の失敗値を作る。
 * @param kind 対象の型名（'Rival' / 'RivalActionVisit'）
 * @param rule 破った規則
 * @param index 違反した背景活動の位置（該当する場合のみ）
 * @returns INVALID_INPUT の失敗 Result
 */
function invalid(kind: string, rule: RivalRule, index?: number): Result<never> {
  const log = logger.fn('invalid', { kind, rule, index });
  const details = index === undefined ? { kind, rule } : { kind, rule, index };
  return log.exit(fail(AppError.of('INVALID_INPUT', 'ライバルのデータが正しくありません', details)));
}

/**
 * 背景活動の間隔が「1以上の整数」か判定する。
 * @param intervalDays 間隔（日）
 * @returns 正しければ true
 */
export function isValidIntervalDays(intervalDays: number): boolean {
  return Number.isSafeInteger(intervalDays) && intervalDays >= 1;
}

/**
 * 背景活動の位相が「0以上 intervalDays 未満の整数」か判定する。
 * @param phase 位相
 * @param intervalDays 間隔（日。正しい値であること）
 * @returns 正しければ true
 */
export function isValidPhase(phase: number, intervalDays: number): boolean {
  return Number.isSafeInteger(phase) && phase >= 0 && phase < intervalDays;
}

/**
 * 背景活動の並びを検証し、違反した規則と位置を返す。
 * @param patterns 背景活動
 * @returns 違反があれば { rule, index }、無ければ undefined
 */
function findPatternViolation(patterns: readonly RivalPattern[]): { readonly rule: RivalRule; readonly index: number } | undefined {
  const log = logger.fn('findPatternViolation', { patterns: patterns.length });
  const seen = new Set<DistrictId>();
  for (const [index, pattern] of patterns.entries()) {
    if (!isValidIntervalDays(pattern.intervalDays)) return log.exit({ rule: 'intervalDays', index });
    if (!isValidPhase(pattern.phase, pattern.intervalDays)) return log.exit({ rule: 'phase', index });
    if (seen.has(pattern.districtId)) return log.exit({ rule: 'duplicateDistrict', index });
    seen.add(pattern.districtId);
  }
  return log.exit(undefined);
}

/**
 * ライバルを作る（不変条件: 表示名が空でなく制御文字なし・最大文字数以内、
 * 背景活動の intervalDays は1以上の整数、0 ≦ phase < intervalDays、同じ地区の背景活動は1件まで）。
 * @param input ID・表示名・背景活動
 * @returns 成功: 凍結済みの Rival（表示名は前後の空白を除去）。失敗: INVALID_INPUT（details.rule に破った規則）
 * @see docs/08 D9, docs/06 DI-02
 */
function ofRival(input: RivalInput): Result<Rival> {
  const log = logger.fn('Rival.of', { id: input.id, patterns: input.patterns.length });
  const name = input.name.trim();
  if (!isValidNickname(name)) return log.fail(invalid('Rival', 'name'));
  const violation = findPatternViolation(input.patterns);
  if (violation !== undefined) return log.fail(invalid('Rival', violation.rule, violation.index));
  const patterns = Object.freeze(input.patterns.map((p): RivalPattern => Object.freeze({ districtId: p.districtId, intervalDays: p.intervalDays, phase: p.phase })));
  return log.exit(ok(Object.freeze({ id: input.id, name, patterns })));
}

/**
 * ライバル行動（追加訪問）を作る（不変条件: count は1以上の整数）。
 * @param input ライバル・地区・暦日・回数・操作ID（任意）
 * @returns 成功: 凍結済みの RivalActionVisit。失敗: INVALID_INPUT（details.rule='count'）
 */
function ofRivalActionVisit(input: RivalActionVisit): Result<RivalActionVisit> {
  const log = logger.fn('RivalActionVisit.of', { rivalId: input.rivalId, districtId: input.districtId, localDate: input.localDate, count: input.count });
  if (!Number.isSafeInteger(input.count) || input.count < 1) {
    return log.fail(invalid('RivalActionVisit', 'count'));
  }
  const base = { rivalId: input.rivalId, districtId: input.districtId, localDate: input.localDate, count: input.count };
  return log.exit(ok(Object.freeze(input.operationId === undefined ? base : { ...base, operationId: input.operationId })));
}

/** Rival のファクトリ（interface と同名の値。`Rival.of(...)` と書ける） */
export const Rival = Object.freeze({ of: ofRival });

/** RivalActionVisit のファクトリ（interface と同名の値。`RivalActionVisit.of(...)` と書ける） */
export const RivalActionVisit = Object.freeze({ of: ofRivalActionVisit });
