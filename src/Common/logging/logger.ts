/**
 * @file 関数単位デバッグロガー（Common/logging 層。docs/templates/logger.ts の移植）
 * - createLogger(moduleName) でモジュール別ロガーを作り、logger.fn(name, args) で関数スコープを開始する
 * - log.exit(value) / log.fail(value) で終了（経過時間つき）。debug 無効時はマスク等の処理をせず即 return（軽量）
 * - 機微情報は maskKeys で自動マスク。CR/LF・制御文字を除去し 500 字で切り詰める（ログ注入対策）
 * - 本番ビルド（デモでない production）では debug を常に無効（LG-04）。バッファは logBuffer.ts（LogViewer が読む）
 * 依存: Common/constants と logBuffer のみ（domain 層からも import 可能）
 */
import { DEBUG_FLAG_STORAGE_KEY, isProductionBuild, isTestMode } from '@/Common/constants/env';
import { DEFAULT_LOG_BUFFER_SIZE, LEVEL_ORDER, pushLog, setLogBufferCapacity } from '@/Common/logging/logBuffer';
import type { LogEntry, LogLevel, LogPhase } from '@/Common/logging/logBuffer';

export type { LogEntry, LogFilter, LogLevel, LogPhase } from '@/Common/logging/logBuffer';
export { clearLogBuffer, exportLogBuffer, readLogBuffer } from '@/Common/logging/logBuffer';

/** ログの出力先（既定: console。テストでは差し替えて検証する） */
export type LogSink = (entry: LogEntry) => void;

/** ロガー設定（起動時・テスト時に configureLogger で上書き） */
export interface LoggerConfig {
  /** false なら debug（ENTER/EXIT/途中経過）を捨てる。本番ビルドでは常に false */
  readonly enabled: boolean;
  /** これ未満のレベルは捨てる */
  readonly minLevel: LogLevel;
  /** リングバッファの保持件数 */
  readonly bufferSize: number;
  /** 値をマスクするキー名（大文字小文字を区別しない） */
  readonly maskKeys: readonly string[];
  /** 文字列1項目の最大文字数 */
  readonly maxValueLength: number;
  /** オブジェクトをたどる最大深さ（循環参照・巨大オブジェクト対策） */
  readonly maxDepth: number;
  /** 出力先 */
  readonly sink: LogSink;
}

/** 関数スコープロガー。logger.fn() が返す */
export interface FnLog {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  /** 正常終了。値をそのまま返すので `return log.exit(value)` と書ける */
  exit<T>(value: T, message?: string): T;
  /** 失敗終了（warn）。`return log.fail(fail(AppError.of(...)))` と書ける */
  fail<T>(value: T, message?: string): T;
}

/** モジュールロガー */
export interface Logger {
  readonly moduleName: string;
  /** 関数スコープを開始し ENTER を記録する */
  fn(name: string, args?: unknown): FnLog;
}

/** 既定でマスクするキー（docs/04 §2.4-4。位置座標・認証情報・クーポンコード・連絡先） */
export const DEFAULT_MASK_KEYS: readonly string[] = [
  'lat', 'lng', 'latitude', 'longitude', 'token', 'accesstoken', 'password', 'code', 'email', 'secret', 'authorization', 'apikey',
];

/** 名前の一部に含まれていればマスクする語（clientSecret・idToken・sessionCookie・connectionString など。キーの書き忘れに備える） */
const MASK_KEY_PATTERN = /secret|token|password|cookie|authorization|connectionstring|databaseurl/i;

/** マスク後の表示 */
const MASK = '***';
/** 文字列1項目の既定最大長（docs/04 §2.4-5） */
const DEFAULT_MAX_VALUE_LENGTH = 500;
/** 配列は先頭からこの件数だけ記録する */
const MAX_ARRAY_ITEMS = 50;
/** 相関ID の文字種と長さ */
const CID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const CID_LENGTH = 6;
/** AppError の code（機械可読な大文字スネーク）はマスクしない */
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
/** ログ注入対策で空白に置き換える文字（C0/C1 制御文字・CR/LF・行/段落区切り） */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
/** debug を有効にしてよいビルドか（本番ビルドでは不可＝LG-04） */
const DEBUG_ALLOWED = !isProductionBuild;

let config: LoggerConfig = defaultLoggerConfig();
let maskKeySet: ReadonlySet<string> = toMaskKeySet(config.maskKeys);
let currentCid: string | undefined;
let fallbackCidCounter = 0;

/**
 * 既定設定を作る。debug は URL `?debug=1` または localStorage['nnishi.debug']==='1' のときだけ有効。
 * テスト実行中は出力先を無音にする（バッファには残る）。
 * @returns 既定のロガー設定
 */
function defaultLoggerConfig(): LoggerConfig {
  return {
    enabled: detectDebugFlag(),
    minLevel: 'debug',
    bufferSize: DEFAULT_LOG_BUFFER_SIZE,
    maskKeys: DEFAULT_MASK_KEYS,
    maxValueLength: DEFAULT_MAX_VALUE_LENGTH,
    maxDepth: 3,
    sink: isTestMode ? silentSink : consoleSink,
  };
}

/**
 * ブラウザの debug フラグを検出する。本番ビルド・ブラウザ以外（テスト）では常に false。
 * @returns 有効なら true
 * @sideEffect ストレージにアクセスできない場合はバッファに warn を1件残す
 */
function detectDebugFlag(): boolean {
  if (!DEBUG_ALLOWED || typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('debug') === '1') return true;
    return window.localStorage.getItem(DEBUG_FLAG_STORAGE_KEY) === '1';
  } catch {
    // ロガー初期化前なのでバッファへ直接記録する（握りつぶさない）
    pushLog({ at: nowIso(), level: 'warn', module: 'Common/logging/logger', fn: 'detectDebugFlag', phase: 'LOG', message: 'debug フラグを読めませんでした' });
    return false;
  }
}

/**
 * マスクキー一覧を小文字の Set にする。
 * @param keys キー名
 * @returns 小文字化した Set
 */
function toMaskKeySet(keys: readonly string[]): ReadonlySet<string> {
  return new Set(keys.map((key) => key.toLowerCase()));
}

/**
 * ロガー設定を上書きする（起動時・テスト時）。undefined の項目は無視する。
 * 本番ビルドでは enabled=true を渡しても debug は無効のまま（LG-04）。
 * @param partial 上書きする項目
 * @sideEffect モジュール内の設定とバッファ上限を更新する
 */
export function configureLogger(partial: Partial<LoggerConfig>): void {
  config = {
    enabled: (partial.enabled ?? config.enabled) && DEBUG_ALLOWED,
    minLevel: partial.minLevel ?? config.minLevel,
    bufferSize: partial.bufferSize ?? config.bufferSize,
    maskKeys: partial.maskKeys ?? config.maskKeys,
    maxValueLength: partial.maxValueLength ?? config.maxValueLength,
    maxDepth: partial.maxDepth ?? config.maxDepth,
    sink: partial.sink ?? config.sink,
  };
  maskKeySet = toMaskKeySet(config.maskKeys);
  setLogBufferCapacity(config.bufferSize);
}

/**
 * ロガー設定を既定に戻す（テスト後始末用）。
 * @sideEffect モジュール内の設定とバッファ上限を更新する
 */
export function resetLoggerConfig(): void {
  config = defaultLoggerConfig();
  maskKeySet = toMaskKeySet(config.maskKeys);
  setLogBufferCapacity(config.bufferSize);
}

/**
 * debug ログが有効か返す（LG-04 の確認・ログビューア表示用）。
 * @returns 有効なら true
 */
export function isDebugEnabled(): boolean {
  return config.enabled;
}

/**
 * 相関ID を設定する。presentation 層が 1 ユーザー操作ごとに呼ぶ。
 * 指定値は英数字・_・- 以外を除いて 32 字までにする。未指定（または空）なら crypto で6桁英数字を発行する。
 * @param cid 相関ID（省略時は新規発行）
 * @returns 設定された相関ID
 * @sideEffect 以降のログに付く相関ID を変える
 */
export function setCorrelationId(cid?: string): string {
  const cleaned = cid === undefined ? '' : cid.replace(/[^0-9A-Za-z_-]/g, '').slice(0, 32);
  currentCid = cleaned.length > 0 ? cleaned : generateCorrelationId();
  return currentCid;
}

/**
 * 現在の相関ID を返す。
 * @returns 相関ID（未設定なら undefined）
 */
export function getCorrelationId(): string | undefined {
  return currentCid;
}

/**
 * 相関ID を消す（テスト・操作終了時）。
 * @sideEffect 以降のログに相関ID が付かなくなる
 */
export function clearCorrelationId(): void {
  currentCid = undefined;
}

/**
 * crypto.getRandomValues で6桁の英数字を作る（SEC-12。Math.random は使わない）。
 * 偏りを避けるため 252 以上のバイトは捨てる（252 = 36×7）。crypto が無い環境では連番で代替する。
 * @returns 6桁の英数字
 */
function generateCorrelationId(): string {
  const cryptoApi: Crypto | undefined = typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto;
  if (cryptoApi === undefined || typeof cryptoApi.getRandomValues !== 'function') {
    fallbackCidCounter += 1;
    return fallbackCidCounter.toString(36).padStart(CID_LENGTH, '0').slice(-CID_LENGTH);
  }
  let out = '';
  while (out.length < CID_LENGTH) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(CID_LENGTH * 2));
    for (const byte of bytes) {
      if (byte < 252 && out.length < CID_LENGTH) out += CID_ALPHABET.charAt(byte % CID_ALPHABET.length);
    }
  }
  return out;
}

/**
 * 現在時刻を ISO 8601（UTC）で返す。ログの時刻専用（業務時刻は Clock ポートを使う）。
 * @returns ISO 8601 文字列
 */
function nowIso(): string {
  return new Date().toISOString(); // audit-ignore: date-now ログの記録時刻であり業務判定には使わない
}

/**
 * 経過時間計測用の単調時刻（ミリ秒）を返す。
 * @returns performance.now()。使えない環境では 0
 */
function monotonicMs(): number {
  return typeof performance === 'undefined' ? 0 : performance.now();
}

/**
 * そのレベルのログを今出すべきか判定する。debug は enabled のときだけ。
 * @param level ログレベル
 * @returns 出すなら true
 */
function isLevelActive(level: LogLevel): boolean {
  if (level === 'debug' && !config.enabled) return false;
  return LEVEL_ORDER[level] >= LEVEL_ORDER[config.minLevel];
}

/**
 * 文字列をログ安全にする（制御文字・CR/LF を空白に置換し、maxValueLength で切り詰め）。
 * @param text 元の文字列
 * @returns 安全化した文字列（切り詰めたときは末尾に …）
 */
export function sanitizeText(text: string): string {
  const cleaned = text.replace(CONTROL_CHARS, ' ');
  if (cleaned.length <= config.maxValueLength) return cleaned;
  let cut = cleaned.slice(0, config.maxValueLength);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // サロゲートペアの片割れを残さない
  return `${cut}…`;
}

/**
 * 任意の値をログ安全な形に変換する（マスク・切詰め・深さ制限）。
 * @param value 任意の値
 * @param depth 現在の深さ（0 始まり）
 * @returns 変換後の値
 */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case 'string':
      return sanitizeText(value);
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
    case 'symbol':
      return sanitizeText(value.toString());
    case 'function':
      return '[function]';
    default:
      return sanitizeObject(value, depth);
  }
}

/**
 * オブジェクト・配列・Error などをログ安全な形に変換する。
 * @param value オブジェクト
 * @param depth 現在の深さ
 * @returns 変換後の値
 */
function sanitizeObject(value: object, depth: number): unknown {
  if (depth >= config.maxDepth) return '[depth]';
  if (value instanceof Error) return { name: sanitizeText(value.name), message: sanitizeText(value.message) };
  if (Array.isArray(value)) return sanitizeArray(value, depth);
  if (value instanceof Set) return sanitizeArray(Array.from(value), depth);
  if (value instanceof Map) return `[Map size=${value.size}]`;
  return sanitizeRecord(value, depth);
}

/**
 * 配列を先頭 MAX_ARRAY_ITEMS 件だけ変換する。
 * @param items 配列
 * @param depth 現在の深さ
 * @returns 変換後の配列（省略があれば末尾に件数メモ）
 */
function sanitizeArray(items: readonly unknown[], depth: number): unknown[] {
  const out = items.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  if (items.length > MAX_ARRAY_ITEMS) out.push(`…(+${items.length - MAX_ARRAY_ITEMS})`);
  return out;
}

/**
 * プレーンオブジェクトのキーごとにマスク・変換する。
 * AppError の形（code と message が文字列で code が大文字スネーク）なら code は失敗コードとして残す。
 * @param value オブジェクト
 * @param depth 現在の深さ
 * @returns 変換後のオブジェクト
 */
function sanitizeRecord(value: object, depth: number): Record<string, unknown> {
  const entries = Object.entries(value);
  const keepErrorCode = entries.some(([k, v]) => k === 'message' && typeof v === 'string');
  const out: Record<string, unknown> = {};
  for (const [key, child] of entries) {
    const isErrorCode = key === 'code' && keepErrorCode && typeof child === 'string' && ERROR_CODE_PATTERN.test(child);
    out[key] = !isErrorCode && (maskKeySet.has(key.toLowerCase()) || MASK_KEY_PATTERN.test(key)) ? MASK : sanitizeValue(child, depth + 1);
  }
  return out;
}

/** 1エントリ分の記録内容 */
interface WriteDetail {
  readonly message?: string;
  readonly data?: unknown;
  readonly elapsedMs?: number;
}

/** エントリの出どころ（モジュール名・関数名・相関ID） */
interface LogOrigin {
  readonly moduleName: string;
  readonly fnName: string;
  readonly cid: string | undefined;
}

/**
 * エントリを組み立ててバッファと sink に書き出す。レベルが無効なら何もせず即 return（軽量化）。
 * @param origin モジュール名・関数名・相関ID
 * @param level ログレベル
 * @param phase フェーズと記録内容
 * @sideEffect バッファに追加し sink を呼ぶ
 */
function writeEntry(origin: LogOrigin, level: LogLevel, phase: { readonly phase: LogPhase } & WriteDetail): void {
  if (!isLevelActive(level)) return;
  const entry: LogEntry = {
    at: nowIso(),
    level,
    module: origin.moduleName,
    fn: origin.fnName,
    phase: phase.phase,
    ...(phase.message === undefined ? {} : { message: sanitizeText(phase.message) }),
    ...(phase.data === undefined ? {} : { data: sanitizeValue(phase.data) }),
    ...(phase.elapsedMs === undefined ? {} : { elapsedMs: Math.round(phase.elapsedMs * 10) / 10 }),
    ...(origin.cid === undefined ? {} : { cid: origin.cid }),
  };
  pushLog(entry);
  deliver(entry);
}

/**
 * sink にエントリを渡す。sink の例外でアプリを止めない（失敗はバッファにだけ残す）。
 * @param entry 書き出すエントリ
 * @sideEffect sink を呼ぶ
 */
function deliver(entry: LogEntry): void {
  try {
    config.sink(entry);
  } catch {
    pushLog({ at: nowIso(), level: 'error', module: 'Common/logging/logger', fn: 'deliver', phase: 'LOG', message: 'ログの出力先でエラーが発生しました' });
  }
}

/**
 * テスト用の既定出力先。何もしない（バッファには残る）。
 * @param _entry ログエントリ（未使用）
 */
function silentSink(_entry: LogEntry): void {
  // 何もしない
}

/**
 * 既定の出力先。console に 1 行で出す（Common/logging 内のみ console 使用可）。
 * @param e ログエントリ
 * @sideEffect console に出力する
 */
function consoleSink(e: LogEntry): void {
  const elapsed = e.elapsedMs === undefined ? '' : ` (${e.elapsedMs.toFixed(1)}ms)`;
  const data = e.data === undefined ? '' : ` ${JSON.stringify(e.data)}`;
  const line = `${e.at} ${e.level.toUpperCase().padEnd(5)} [${e.module}.${e.fn}] ${e.phase}${e.message === undefined ? '' : ` ${e.message}`}${data}${elapsed}${e.cid === undefined ? '' : ` cid=${e.cid}`}`;
  if (e.level === 'error') console.error(line);
  else if (e.level === 'warn') console.warn(line);
  else if (e.level === 'info') console.info(line);
  else console.debug(line);
}

/** 関数スコープロガーの実装。logger.fn() が生成する */
class ScopedLog implements FnLog {
  /**
   * 関数スコープを作る。
   * @param origin モジュール名・関数名・相関ID（開始時点のもの）
   * @param startedAt 開始時刻（単調時刻ミリ秒）
   */
  constructor(
    private readonly origin: LogOrigin,
    private readonly startedAt: number,
  ) {}

  /**
   * 途中経過を debug で記録する。
   * @param message 日本語の説明
   * @param data 判定根拠など（マスクされる）
   */
  debug(message: string, data?: unknown): void {
    writeEntry(this.origin, 'debug', { phase: 'LOG', message, data });
  }

  /**
   * ユースケース完了・遷移などを info で記録する。
   * @param message 日本語の説明
   * @param data 補足値（マスクされる）
   */
  info(message: string, data?: unknown): void {
    writeEntry(this.origin, 'info', { phase: 'LOG', message, data });
  }

  /**
   * 回復可能な異常を warn で記録する。
   * @param message 日本語の説明
   * @param data 補足値（マスクされる）
   */
  warn(message: string, data?: unknown): void {
    writeEntry(this.origin, 'warn', { phase: 'LOG', message, data });
  }

  /**
   * 捕捉した例外・失敗を error で記録する。
   * @param message 日本語の説明
   * @param data 補足値（マスクされる）
   */
  error(message: string, data?: unknown): void {
    writeEntry(this.origin, 'error', { phase: 'LOG', message, data });
  }

  /**
   * 正常終了を debug で記録し、値をそのまま返す。
   * @param value 戻り値
   * @param message 補足（任意）
   * @returns value そのもの
   */
  exit<T>(value: T, message?: string): T {
    if (isLevelActive('debug')) writeEntry(this.origin, 'debug', { phase: 'EXIT', message, data: value, elapsedMs: this.elapsed() });
    return value;
  }

  /**
   * 失敗終了を warn で記録し、値をそのまま返す。
   * @param value 戻り値（失敗の Result など）
   * @param message 補足（任意）
   * @returns value そのもの
   */
  fail<T>(value: T, message?: string): T {
    if (isLevelActive('warn')) writeEntry(this.origin, 'warn', { phase: 'FAIL', message, data: value, elapsedMs: this.elapsed() });
    return value;
  }

  /**
   * 開始からの経過ミリ秒を返す。
   * @returns 経過ミリ秒
   */
  private elapsed(): number {
    return monotonicMs() - this.startedAt;
  }
}

/** モジュールロガーの実装 */
class ModuleLogger implements Logger {
  /**
   * モジュールロガーを作る。
   * @param moduleName 層/ファイル名（例: 'domain/exploration/DiscoveryRule'）
   */
  constructor(readonly moduleName: string) {}

  /**
   * 関数スコープを開始し、debug 有効時だけ ENTER を記録する。
   * @param name 関数名
   * @param args 引数（安全なものだけ。マスク後に記録）
   * @returns 関数スコープロガー
   */
  fn(name: string, args?: unknown): FnLog {
    const scope = new ScopedLog({ moduleName: this.moduleName, fnName: name, cid: currentCid }, monotonicMs());
    if (isLevelActive('debug')) writeEntry({ moduleName: this.moduleName, fnName: name, cid: currentCid }, 'debug', { phase: 'ENTER', data: args });
    return scope;
  }
}

/**
 * モジュール別ロガーを作る。ファイル先頭で 1 回呼ぶ。
 * @param moduleName 層/ファイル名（例: 'domain/exploration/DiscoveryRule'）
 * @returns Logger
 */
export function createLogger(moduleName: string): Logger {
  return new ModuleLogger(moduleName);
}
