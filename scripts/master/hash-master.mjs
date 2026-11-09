/**
 * @file マスタ JSON の SHA-256 ハッシュ生成スクリプト（scripts 層・Node 専用）
 * public/master のデータ7ファイル（districts / landmarks / shops / shopEvents / rivals / mapFeatures / amenityPoints。
 * 一覧は lib/masterFiles.mjs の DATA_FILES）の本文（ファイルのバイト列そのまま）の SHA-256（hex）を求め、
 * src/infrastructure/master/masterHashes.ts を書き出す。MasterDataLoader はこの値と照合し、改変されたマスタを拒否する（SEC-22, DI-13）。
 * 使い方: node scripts/master/hash-master.mjs（npm run master:hash）／ --check で「書き出し済みの値が最新か」だけを確認（古ければ exit 1）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { printError, printLine } from './lib/cliOutput.mjs';
import { DATA_FILES, HASHES_TS_PATH, MASTER_DIR, ROOT_DIR, isDirectRun } from './lib/masterFiles.mjs';
import { createCliLogger } from './lib/cliLog.mjs';

const logger = createCliLogger('scripts/master/hash-master');

/**
 * バイト列の SHA-256 を16進文字列で返す。
 * @param {Buffer | Uint8Array} bytes ファイルの中身
 * @returns {string} 64文字の16進数（小文字）
 */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * public/master のデータファイルを読み、ファイル名 → SHA-256 の対応を作る。
 * 改行・BOM を含め、ファイルのバイト列をそのままハッシュする（ブラウザが fetch で受け取る本文と同じ）。
 * @param {string} [dir] マスタのディレクトリ（既定は public/master）
 * @returns {{hashes: Record<string, string>, missing: string[]}} ハッシュと、見つからなかったファイル名
 * @sideEffect ファイルを読む
 */
export function computeMasterHashes(dir = MASTER_DIR) {
  const log = logger.fn('computeMasterHashes');
  const hashes = {};
  const missing = [];
  for (const name of DATA_FILES) {
    const path = resolve(dir, name);
    if (!existsSync(path)) {
      missing.push(name);
      continue;
    }
    hashes[name] = sha256Hex(readFileSync(path));
  }
  return log.exit({ hashes, missing });
}

/**
 * masterHashes.ts の本文（@file ヘッダ付き・LF 改行）を作る。
 * @param {Record<string, string>} hashes ファイル名 → SHA-256（DATA_FILES の順に並べる）
 * @returns {string} TypeScript ソース
 */
export function renderMasterHashesTs(hashes) {
  const log = logger.fn('renderMasterHashesTs', { files: Object.keys(hashes).length });
  const lines = DATA_FILES.filter((name) => name in hashes).map((name) => `  '${name}': '${hashes[name]}',`);
  const source = [
    '/**',
    ' * @file マスタデータの SHA-256 ハッシュ（infrastructure 層・自動生成。手で編集しない）',
    ' * scripts/master/hash-master.mjs（npm run master:hash）が public/master/*.json のバイト列から生成する。',
    ' * MasterDataLoader が fetch した本文の SHA-256（crypto.subtle.digest）と照合し、一致しないマスタは読み込まない（SEC-22, DI-13）。',
    ' */',
    '',
    '/** マスタファイル名 → 本文の SHA-256（16進・小文字） */',
    'export const MASTER_HASHES: Readonly<Record<string, string>> = Object.freeze({',
    ...lines,
    '});',
    '',
  ].join('\n');
  return log.exit(source, `lines=${lines.length}`);
}

/**
 * コマンドラインの入口。ハッシュを計算し、masterHashes.ts を書く（--check のときは比較のみ）。
 * @param {string[]} args コマンドライン引数
 * @returns {number} 終了コード（0=成功, 1=ファイル不足または --check で差分あり）
 * @sideEffect masterHashes.ts の書込み（--check 以外）、標準出力・標準エラー
 */
function main(args) {
  const log = logger.fn('main', { args });
  const { hashes, missing } = computeMasterHashes();
  if (missing.length > 0) {
    printError(`マスタファイルがありません: ${missing.join(', ')}（先に npm run master:build）`);
    return log.fail(1, `missing=${missing.length}`);
  }
  const source = renderMasterHashesTs(hashes);
  const target = relative(ROOT_DIR, HASHES_TS_PATH).split('\\').join('/');
  if (args.includes('--check')) {
    const current = existsSync(HASHES_TS_PATH) ? readFileSync(HASHES_TS_PATH, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current === source) {
      printLine(`${target} は最新です。`);
      return log.exit(0);
    }
    printError(`${target} が public/master と一致しません。npm run master:hash を実行してください。`);
    return log.fail(1, '古い masterHashes.ts');
  }
  mkdirSync(dirname(HASHES_TS_PATH), { recursive: true });
  writeFileSync(HASHES_TS_PATH, source, 'utf8');
  printLine(`${target} を書き出しました:`);
  for (const name of DATA_FILES) printLine(`  ${name.padEnd(19)} ${hashes[name]}`);
  return log.exit(0);
}

if (isDirectRun(import.meta.url)) process.exitCode = main(process.argv.slice(2));
