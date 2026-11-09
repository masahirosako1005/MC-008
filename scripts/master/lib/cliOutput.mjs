/**
 * @file マスタ用 CLI スクリプトの端末出力（scripts 層・Node 専用）
 * build / check / hash の結果表示は CLI の本来の出力なので、ブラウザ向けロガー（src/Common/logging）ではなく標準出力に書く。
 * console の直接呼び出しをこのファイルの2か所に閉じ込め、静的監査の例外を理由付きで明示する（LG-01）。
 * 位置座標・秘密情報は扱わない（出力するのはマスタの ID・名前・距離・ハッシュのみ）。
 */

/**
 * 1行を標準出力に書く。
 * @param {string} [text] 出力する文字列（省略時は空行）
 * @returns {void}
 * @sideEffect 標準出力
 */
export function printLine(text = '') {
  console.log(text); // audit-ignore: console-direct CLI スクリプトの結果表示（ブラウザ用ロガーの対象外）
}

/**
 * 1行を標準エラーに書く（検証違反・失敗の表示）。
 * @param {string} text 出力する文字列
 * @returns {void}
 * @sideEffect 標準エラー
 */
export function printError(text) {
  console.error(text); // audit-ignore: console-direct CLI スクリプトの違反表示（ブラウザ用ロガーの対象外）
}
