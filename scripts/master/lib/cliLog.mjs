/**
 * @file マスタ用 CLI スクリプトの関数単位デバッグログ（scripts 層・Node 専用）
 * src/Common/logging/logger.ts と同じ使い方（const log = logger.fn(name, args) → return log.exit(value) / log.fail(value)）で、
 * 関数の ENTER / EXIT / FAIL を標準エラーに1行ずつ書く（docs/04 §2）。アプリのロガーは Vite の import.meta.env に依存し
 * Node の CLI からは読めないため、同じ規約の軽量版をここに置く。
 * - 既定は無効（CLI の通常出力・生成物を変えない）。環境変数 NNISHI_DEBUG=1 のときだけ出力する
 * - 値は docs/04 §2.4 に合わせて、位置座標・秘密情報のキーをマスクし、制御文字を除去して 500 字で切り詰める
 */

/** 値をマスクするキー（小文字で比較。docs/04 §2.4-4） */
const MASK_KEYS = new Set(['lat', 'lng', 'latitude', 'longitude', 'token', 'password', 'secret', 'authorization', 'apikey', 'email', 'code']);
/** 文字列1項目の最大長（docs/04 §2.4-5） */
const MAX_VALUE_LENGTH = 500;
/** オブジェクトをたどる最大深さ */
const MAX_DEPTH = 3;
/** 配列は先頭からこの件数だけ記録する */
const MAX_ARRAY_ITEMS = 20;
/** ログ注入対策で空白にする文字（C0/C1 制御文字・行/段落区切り） */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** 無効時に返す関数スコープ（何もしないで値をそのまま返す） */
const SILENT_SCOPE = Object.freeze({
  /** 何もしない */
  debug() {},
  /** 何もしない */
  warn() {},
  /**
   * 値をそのまま返す。
   * @template T
   * @param {T} value 戻り値
   * @returns {T} value
   */
  exit(value) {
    return value;
  },
  /**
   * 値をそのまま返す。
   * @template T
   * @param {T} value 戻り値
   * @returns {T} value
   */
  fail(value) {
    return value;
  },
});

/**
 * 出力が有効か判定する（環境変数 NNISHI_DEBUG=1）。
 * @returns {boolean} 有効なら true
 */
function isEnabled() {
  return process.env.NNISHI_DEBUG === '1';
}

/**
 * 文字列をログ安全にする（制御文字を空白に、MAX_VALUE_LENGTH で切り詰め）。
 * @param {string} text 元の文字列
 * @returns {string} 安全化した文字列
 */
function sanitizeText(text) { // audit-ignore: fnlog-missing ロガー本体（自分自身をログすると無限再帰になる）
  const cleaned = text.replace(CONTROL_CHARS, ' ');
  return cleaned.length > MAX_VALUE_LENGTH ? `${cleaned.slice(0, MAX_VALUE_LENGTH)}…` : cleaned;
}

/**
 * 任意の値をログ安全な形に変換する（マスク・切詰め・深さ制限）。
 * @param {unknown} value 任意の値
 * @param {number} [depth] 現在の深さ
 * @returns {unknown} 変換後の値
 */
function sanitize(value, depth = 0) { // audit-ignore: fnlog-missing ロガー本体（自分自身をログすると無限再帰になる）
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value !== 'object') return sanitizeText(String(value));
  if (depth >= MAX_DEPTH) return '[depth]';
  if (value instanceof Map) return `[Map size=${value.size}]`;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1));
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = MASK_KEYS.has(key.toLowerCase()) ? '***' : sanitize(child, depth + 1);
  return out;
}

/**
 * 1件のログを標準エラーに1行で書く。
 * @param {{module: string, fn: string, phase: string, message?: string, data?: unknown, elapsedMs?: number}} entry ログの内容
 * @returns {void}
 * @sideEffect 標準エラーに書く
 */
function write(entry) { // audit-ignore: fnlog-missing ロガー本体（自分自身をログすると無限再帰になる）
  const elapsed = entry.elapsedMs === undefined ? '' : ` (${entry.elapsedMs.toFixed(1)}ms)`;
  const message = entry.message === undefined ? '' : ` ${sanitizeText(entry.message)}`;
  const data = entry.data === undefined ? '' : ` ${JSON.stringify(sanitize(entry.data))}`;
  process.stderr.write(`${new Date().toISOString()} DEBUG [${entry.module}.${entry.fn}] ${entry.phase}${message}${data}${elapsed}\n`); // audit-ignore: date-now ログの記録時刻（業務判定に使わない CLI）
}

/**
 * モジュール別の CLI ロガーを作る。ファイル先頭で1回呼ぶ。
 * @param {string} moduleName 'scripts/master/<ファイル名>' の形
 * @returns {{fn: (name: string, args?: unknown) => {debug: Function, warn: Function, exit: Function, fail: Function}}} ロガー
 */
export function createCliLogger(moduleName) { // audit-ignore: fnlog-missing ロガー本体（自分自身をログすると無限再帰になる）
  return Object.freeze({
    /**
     * 関数スコープを開始し、有効時だけ ENTER を記録する。
     * @param {string} name 関数名
     * @param {unknown} [args] 引数（安全なものだけ。マスク後に記録）
     * @returns {{debug: Function, warn: Function, exit: Function, fail: Function}} 関数スコープ
     */
    fn(name, args) { // audit-ignore: fnlog-missing ロガー本体（自分自身をログすると無限再帰になる）
      if (!isEnabled()) return SILENT_SCOPE;
      return openScope(moduleName, name, args);
    },
  });
}

/**
 * 有効時の関数スコープを作り、ENTER を書く。
 * @param {string} moduleName モジュール名
 * @param {string} name 関数名
 * @param {unknown} args 引数
 * @returns {{debug: Function, warn: Function, exit: Function, fail: Function}} 関数スコープ
 * @sideEffect 標準エラーに ENTER を書く
 */
function openScope(moduleName, name, args) { // audit-ignore: fnlog-missing ロガー本体（自分自身をログすると無限再帰になる）
  const started = performance.now();
  const base = { module: moduleName, fn: name };
  write({ ...base, phase: 'ENTER', data: args });
  return Object.freeze({
    /** 途中経過を書く。@param {string} message 説明 @param {unknown} [data] 補足値 */
    debug: (message, data) => write({ ...base, phase: 'LOG', message, data }),
    /** 回復可能な異常を書く。@param {string} message 説明 @param {unknown} [data] 補足値 */
    warn: (message, data) => write({ ...base, phase: 'WARN', message, data }),
    /** 正常終了を書き、値をそのまま返す。@param {unknown} value 戻り値 @param {string} [message] 補足 @returns {unknown} value */
    exit: (value, message) => (write({ ...base, phase: 'EXIT', message, data: value, elapsedMs: performance.now() - started }), value),
    /** 失敗終了を書き、値をそのまま返す。@param {unknown} value 戻り値 @param {string} [message] 補足 @returns {unknown} value */
    fail: (value, message) => (write({ ...base, phase: 'FAIL', message, data: value, elapsedMs: performance.now() - started }), value),
  });
}
