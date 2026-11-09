/**
 * @file 関数単位デバッグロガー（Common/logging/logger.ts の雛形）
 * 規約: docs/04_comment_and_logging.md
 * - createLogger(moduleName) でモジュール別ロガーを作る
 * - logger.fn(name, args) で関数スコープを開始（ENTER を記録）
 * - log.exit(value) / log.fail(error) で終了（EXIT と経過時間を記録）
 * - 機微情報は maskKeys で自動マスク。CR/LF 除去・長さ制限でログ注入を防ぐ
 * - リングバッファに保持し、LogViewer から参照・エクスポートできる
 * 依存: なし（domain 層からも import 可能）
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 1件のログエントリ（構造化） */
export interface LogEntry {
  readonly at: string;          // ISO 8601 (UTC)
  readonly level: LogLevel;
  readonly module: string;      // 例: application/VisitSpotUseCase
  readonly fn: string;          // 関数名
  readonly phase: 'ENTER' | 'EXIT' | 'FAIL' | 'LOG';
  readonly message?: string;
  readonly data?: unknown;
  readonly elapsedMs?: number;
  readonly cid?: string;        // 相関ID（1ユーザ操作ごと）
}

/** ロガー設定（アプリ起動時に configureLogger で上書き） */
export interface LoggerConfig {
  enabled: boolean;                         // false なら debug を捨てる
  minLevel: LogLevel;
  bufferSize: number;                       // リングバッファ件数
  maskKeys: ReadonlyArray<string>;          // 値をマスクするキー名
  maxValueLength: number;                   // 1項目の最大文字数
  sink: (entry: LogEntry) => void;          // 出力先（既定: console）
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** 既定設定: debug は localStorage['nnishi.debug']==='1' または ?debug=1 で有効化 */
const config: LoggerConfig = {
  enabled: detectDebugFlag(),
  minLevel: 'debug',
  bufferSize: 2000,
  maskKeys: ['lat', 'lng', 'latitude', 'longitude', 'token', 'password', 'code', 'email', 'secret', 'authorization'],
  maxValueLength: 500,
  sink: consoleSink,
};

/** リングバッファ（読み取り専用APIのみ公開） */
const buffer: LogEntry[] = [];

/** 現在の相関ID（presentation 層が操作開始時に setCorrelationId で設定） */
let currentCid: string | undefined;

/**
 * デバッグフラグを検出する。
 * ブラウザ以外（テスト）では false。
 * @returns 有効なら true
 */
function detectDebugFlag(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (new URLSearchParams(window.location.search).get('debug') === '1') return true;
    return window.localStorage.getItem('nnishi.debug') === '1';
  } catch {
    return false;
  }
}

/**
 * ロガー設定を上書きする（起動時・テスト時）。
 * @param partial 上書きする項目
 */
export function configureLogger(partial: Partial<LoggerConfig>): void {
  Object.assign(config, partial);
}

/**
 * 相関IDを設定する。presentation 層が 1 操作ごとに呼ぶ。
 * @param cid 相関ID（未指定なら新規発行）
 * @returns 設定された相関ID
 */
export function setCorrelationId(cid?: string): string {
  currentCid = cid ?? Math.random().toString(36).slice(2, 8); // audit-ignore: math-random ログ用の短いIDで安全性不要
  return currentCid;
}

/**
 * ログバッファのスナップショットを返す（LogViewer 用）。
 * @param filter モジュール名の部分一致・レベル・cid で絞り込み
 * @returns 条件に合うエントリ（古い順）
 */
export function readLogBuffer(filter?: { module?: string; minLevel?: LogLevel; cid?: string }): ReadonlyArray<LogEntry> {
  return buffer.filter((e) =>
    (!filter?.module || e.module.includes(filter.module)) &&
    (!filter?.minLevel || LEVEL_ORDER[e.level] >= LEVEL_ORDER[filter.minLevel]) &&
    (!filter?.cid || e.cid === filter.cid),
  );
}

/**
 * ログバッファを JSON 文字列にする（ダウンロード・AI への貼付用）。
 * @returns 整形済み JSON
 */
export function exportLogBuffer(): string {
  return JSON.stringify(buffer, null, 2);
}

/**
 * 値をログ安全な形に変換する。
 * - maskKeys に該当するキーの値は "***"
 * - 文字列は CR/LF・制御文字を除去し maxValueLength で切り詰め
 * - 循環参照・巨大オブジェクトは深さ 3 で打ち切り
 * @param value 任意の値
 * @param depth 現在の深さ
 * @returns 変換後の値
 */
function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ');
    return cleaned.length > config.maxValueLength ? cleaned.slice(0, config.maxValueLength) + '…' : cleaned;
  }
  if (typeof value !== 'object') return value;
  if (depth >= 3) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = config.maskKeys.includes(k.toLowerCase()) ? '***' : sanitize(v, depth + 1);
  }
  return out;
}

/**
 * エントリをバッファと sink に書き出す。debug は enabled のときだけ。
 * @param entry ログエントリ
 */
function emit(entry: LogEntry): void {
  if (entry.level === 'debug' && !config.enabled) return;
  if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[config.minLevel]) return;
  buffer.push(entry);
  if (buffer.length > config.bufferSize) buffer.splice(0, buffer.length - config.bufferSize);
  config.sink(entry);
}

/**
 * 既定の出力先。console に 1 行で出す（Common/logging 内のみ console 使用可）。
 * @param e ログエントリ
 */
function consoleSink(e: LogEntry): void {
  const elapsed = e.elapsedMs !== undefined ? ` (${e.elapsedMs.toFixed(1)}ms)` : '';
  const data = e.data !== undefined ? ' ' + JSON.stringify(e.data) : '';
  const line = `${e.at} ${e.level.toUpperCase().padEnd(5)} [${e.module}.${e.fn}] ${e.phase}${e.message ? ' ' + e.message : ''}${data}${elapsed}${e.cid ? ' cid=' + e.cid : ''}`;
  // eslint-disable-next-line no-console
  (e.level === 'error' ? console.error : e.level === 'warn' ? console.warn : console.log)(line); // audit-ignore: console-direct ロガー本体
}

/** 関数スコープロガー。logger.fn() が返す */
export interface FnLog {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  /** 正常終了。値をそのまま返すので `return log.exit(value)` と書ける */
  exit<T>(value: T, message?: string): T;
  /** 失敗終了。Result の失敗やエラーを返すときに使う */
  fail<T>(value: T, message?: string): T;
}

/** モジュールロガー */
export interface Logger {
  /** 関数スコープを開始し ENTER を記録する */
  fn(name: string, args?: unknown): FnLog;
}

/**
 * モジュール別ロガーを作る。ファイル先頭で 1 回呼ぶ。
 * @param moduleName 層/ファイル名（例: 'domain/DiscoveryRule'）
 * @returns Logger
 */
export function createLogger(moduleName: string): Logger {
  return {
    /** 関数スコープを開始し ENTER を記録する。@param name 関数名 @param args 引数（マスク後に記録） */
    fn(name: string, args?: unknown): FnLog {
      const started = typeof performance !== 'undefined' ? performance.now() : 0;
      const cid = currentCid;
      /** 共通の出力処理。レベル・フェーズ・メッセージ・データ・経過時間をエントリ化して emit する */
      const base = (level: LogLevel, phase: LogEntry['phase'], message?: string, data?: unknown, elapsedMs?: number): void =>
        emit({ at: new Date().toISOString(), level, module: moduleName, fn: name, phase, message, data: sanitize(data), elapsedMs, cid }); // audit-ignore: date-now ログ時刻
      /** ENTER からの経過ミリ秒を返す */
      const elapsed = (): number => (typeof performance !== 'undefined' ? performance.now() - started : 0);
      base('debug', 'ENTER', undefined, args);
      return {
        debug: (m, d) => base('debug', 'LOG', m, d),
        info: (m, d) => base('info', 'LOG', m, d),
        warn: (m, d) => base('warn', 'LOG', m, d),
        error: (m, d) => base('error', 'LOG', m, d),
        exit: (v, m) => { base('debug', 'EXIT', m, v, elapsed()); return v; },
        fail: (v, m) => { base('warn', 'FAIL', m, v, elapsed()); return v; },
      };
    },
  };
}
