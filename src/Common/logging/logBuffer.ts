/**
 * @file ログのリングバッファ（Common/logging 層）
 * logger.ts が書き込み、LogViewer（デモメニュー）が読み取る。保持件数を超えたら古いものから捨てる。
 * モジュール直下の可変状態は 01 §3-7 の例外（デバッグ用途・読み取り専用API）として許可されている。
 */

/** ログレベル（docs/04 §2.3） */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** レベルの大小比較用の順位 */
export const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

/** 関数スコープ内の位置（開始・正常終了・失敗終了・途中経過） */
export type LogPhase = 'ENTER' | 'EXIT' | 'FAIL' | 'LOG';

/** 1件のログエントリ（構造化。data はマスク・切詰め済み） */
export interface LogEntry {
  readonly at: string;
  readonly level: LogLevel;
  readonly module: string;
  readonly fn: string;
  readonly phase: LogPhase;
  readonly message?: string;
  readonly data?: unknown;
  readonly elapsedMs?: number;
  readonly cid?: string;
}

/** LogViewer の絞り込み条件。すべて省略可 */
export interface LogFilter {
  /** モジュール名の部分一致 */
  readonly module?: string;
  /** 関数名の部分一致 */
  readonly fn?: string;
  /** このレベル以上だけ */
  readonly minLevel?: LogLevel;
  /** 相関ID の完全一致 */
  readonly cid?: string;
}

/** 既定の保持件数（docs/04 §2.4-6） */
export const DEFAULT_LOG_BUFFER_SIZE = 2000;

/** バッファ本体（古い順） */
const buffer: LogEntry[] = [];

/** 保持件数の上限。setLogBufferCapacity で変える */
let capacity = DEFAULT_LOG_BUFFER_SIZE;

/**
 * 保持件数の上限を変える。超過分は古いものから捨てる。
 * @param size 新しい上限（1以上の整数。不正値は無視）
 * @sideEffect バッファを切り詰めることがある
 */
export function setLogBufferCapacity(size: number): void {
  if (!Number.isInteger(size) || size < 1) return;
  capacity = size;
  if (buffer.length > capacity) buffer.splice(0, buffer.length - capacity);
}

/**
 * エントリを1件追加する。上限を超えたら最古のものを捨てる。
 * @param entry 追加するエントリ（logger でマスク済みのもの）
 * @sideEffect バッファを更新する
 */
export function pushLog(entry: LogEntry): void {
  buffer.push(Object.freeze(entry));
  if (buffer.length > capacity) buffer.splice(0, buffer.length - capacity);
}

/**
 * エントリが絞り込み条件に合うか判定する。
 * @param entry 判定するエントリ
 * @param filter 絞り込み条件（未指定の項目は条件なし）
 * @returns 条件に合えば true
 */
function matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
  if (filter.module !== undefined && !entry.module.includes(filter.module)) return false;
  if (filter.fn !== undefined && !entry.fn.includes(filter.fn)) return false;
  if (filter.minLevel !== undefined && LEVEL_ORDER[entry.level] < LEVEL_ORDER[filter.minLevel]) return false;
  return filter.cid === undefined || entry.cid === filter.cid;
}

/**
 * バッファのスナップショットを返す（LogViewer 用）。
 * @param filter 絞り込み条件（省略時はすべて）
 * @returns 条件に合うエントリの配列（古い順・コピー）
 */
export function readLogBuffer(filter?: LogFilter): readonly LogEntry[] {
  if (filter === undefined) return buffer.slice();
  return buffer.filter((entry) => matchesFilter(entry, filter));
}

/**
 * バッファを JSON 文字列にする（ダウンロード・AI への貼付用）。
 * @param filter 絞り込み条件（省略時はすべて）
 * @returns 整形済み JSON
 */
export function exportLogBuffer(filter?: LogFilter): string {
  return JSON.stringify(readLogBuffer(filter), null, 2);
}

/**
 * バッファを空にする（ログビューアの「クリア」・テスト用）。
 * @sideEffect バッファを空にする
 */
export function clearLogBuffer(): void {
  buffer.length = 0;
}

/**
 * 現在の保持件数を返す。
 * @returns バッファ内のエントリ数
 */
export function logBufferLength(): number {
  return buffer.length;
}
