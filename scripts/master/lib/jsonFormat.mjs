/**
 * @file マスタ JSON の決定論的な整形（scripts 層・Node 専用）
 * 2スペースインデントを基本に、短い平坦オブジェクト（{lat,lng} など）とプリミティブ配列は1行にまとめて読みやすくする。
 * 同じ入力からは必ず同じ文字列（LF 改行・末尾改行あり）を返すので、再生成しても SHA-256 が変わらない。
 */

/** 1行にまとめる平坦オブジェクトの最大文字数 */
const INLINE_MAX_CHARS = 80;

/**
 * 値が JSON のプリミティブ（null・文字列・数値・真偽値）か判定する。
 * @param {unknown} value 判定する値
 * @returns {boolean} プリミティブなら true
 */
function isPrimitive(value) {
  return value === null || typeof value !== 'object';
}

/**
 * 値がプリミティブだけを持つプレーンオブジェクトか判定する。
 * @param {unknown} value 判定する値
 * @returns {boolean} 平坦なオブジェクトなら true
 */
function isFlatObject(value) { // audit-ignore: fnlog-missing 値ごとに再帰する純粋な整形ヘルパー（呼び出し側 renderMasterFiles でまとめて記録）
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value).every(isPrimitive)
  );
}

/**
 * 平坦オブジェクトを1行の JSON 文字列にする。
 * @param {Record<string, unknown>} value 平坦なオブジェクト
 * @returns {string} 例: { "lat": 34.69, "lng": 135.195 }
 */
function inlineObject(value) { // audit-ignore: fnlog-missing 値ごとに再帰する純粋な整形ヘルパー（呼び出し側 renderMasterFiles でまとめて記録）
  const body = Object.entries(value)
    .map(([key, v]) => `${JSON.stringify(key)}: ${JSON.stringify(v)}`)
    .join(', ');
  return `{ ${body} }`;
}

/**
 * 値を読みやすい JSON 文字列に整形する（再帰）。
 * @param {unknown} value JSON に変換できる値（関数・undefined・循環参照は不可）
 * @param {string} [indent] 現在のインデント
 * @returns {string} 整形済み JSON（末尾改行なし）
 */
export function formatJson(value, indent = '') { // audit-ignore: fnlog-missing 値ごとに再帰する純粋な整形ヘルパー（呼び出し側 renderMasterFiles でまとめて記録）
  if (isPrimitive(value)) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(isPrimitive)) return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  if (isFlatObject(value)) {
    const line = inlineObject(value);
    if (line.length <= INLINE_MAX_CHARS) return line;
  }
  const body = entries.map(([key, v]) => `${inner}${JSON.stringify(key)}: ${formatJson(v, inner)}`);
  return `{\n${body.join(',\n')}\n${indent}}`;
}

/**
 * ファイルに書く JSON 本文（LF 改行・末尾改行1つ）を作る。
 * @param {unknown} value JSON に変換できる値
 * @returns {string} ファイル本文
 */
export function toJsonFileText(value) {
  return `${formatJson(value)}\n`;
}
