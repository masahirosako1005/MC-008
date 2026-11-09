/**
 * @file マスタファイルの場所・名前と読込（scripts 層・Node 専用）
 * build / check / hash の3スクリプトが同じファイル一覧とパスを使うための共通モジュール。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCliLogger } from './cliLog.mjs';

const logger = createCliLogger('scripts/master/lib/masterFiles');

/** リポジトリのルート（scripts/master/lib から3階層上） */
export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** マスタ JSON の置き場（Vite が配信する public/master） */
export const MASTER_DIR = resolve(ROOT_DIR, 'public', 'master');

/** アプリが読み込み、SHA-256 で照合するデータファイル（docs/08 §5・§9。地図の背景と便利施設ポイントを含む7件） */
export const DATA_FILES = Object.freeze([
  'districts.json',
  'landmarks.json',
  'shops.json',
  'shopEvents.json',
  'rivals.json',
  'mapFeatures.json',
  'amenityPoints.json',
]);

/** ドキュメント用の JSON Schema ファイル名 */
export const SCHEMA_FILE = 'master.schema.json';

/** ハッシュ定数の出力先（infrastructure 層の TS） */
export const HASHES_TS_PATH = resolve(ROOT_DIR, 'src', 'infrastructure', 'master', 'masterHashes.ts');

/**
 * public/master の JSON（データ7件＋スキーマ）を読み、本文とパース結果を返す。
 * 失敗は例外にせず errors に積む（CLI が一覧表示して exit 1 にするため）。
 * @param {string} [dir] 読み込むディレクトリ（既定は MASTER_DIR。テストで差し替える）
 * @returns {{texts: Record<string, string>, data: Record<string, unknown>, errors: string[]}} 本文・パース結果・読込エラー
 * @sideEffect ファイルを読む
 */
export function loadMasterBundle(dir = MASTER_DIR) {
  const log = logger.fn('loadMasterBundle');
  const texts = {};
  const data = {};
  const errors = [];
  for (const name of [...DATA_FILES, SCHEMA_FILE]) {
    const path = resolve(dir, name);
    if (!existsSync(path)) {
      errors.push(`${name}: ファイルがありません（npm run master:build で生成）`);
      continue;
    }
    texts[name] = readFileSync(path, 'utf8');
    try {
      data[name] = JSON.parse(texts[name]);
    } catch (error) {
      errors.push(`${name}: JSON として読めません（${error instanceof Error ? error.message : String(error)}）`);
    }
  }
  return log.exit({ texts, data, errors }, `files=${Object.keys(data).length} errors=${errors.length}`);
}

/**
 * このモジュールがコマンドラインから直接実行されたかを判定する（テストからの import では false）。
 * Windows のドライブ文字の大小差を吸収するため小文字で比較する。
 * @param {string} moduleUrl 呼び出し元の import.meta.url
 * @returns {boolean} 直接実行なら true
 */
export function isDirectRun(moduleUrl) {
  const log = logger.fn('isDirectRun');
  const entry = process.argv[1];
  if (!entry) return log.exit(false);
  return log.exit(resolve(fileURLToPath(moduleUrl)).toLowerCase() === resolve(entry).toLowerCase());
}
