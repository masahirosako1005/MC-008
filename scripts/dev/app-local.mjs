#!/usr/bin/env node
/**
 * @file 商用版（利用者データのサーバーつき）を自分の PC で動かす（依存ライブラリなし / Node 24。docs/12 §7）
 *
 * 使い方:
 *   node scripts/dev/app-local.mjs [--port 8787] [--data .data/app-pg]
 *
 * すること:
 *   1. 連携サーバーをデモの版でビルドする（dist-server。開発用ログインを使うため）
 *   2. 利用者アプリを「サーバーにつなぐ版」（VITE_APP_BACKEND=server）でデモビルドする（dist-app-local）
 *   3. サーバーを起動する。DB は PGlite（組み込みの PostgreSQL）を --data のフォルダに保存。ログインは開発用ログイン（テスト冒険者を選ぶ）。
 *      地図タップの移動（デモの歩行）は徒歩より速いので、移動の妥当性の確認（TOO_FAST）は外す（--demo-walk。開発用ログインのときだけ効く）
 *
 * 開く場所: http://localhost:<port>/ （ログインの画面 → 開発用ログイン → アプリ）
 * 自分の PC からだけ開ける。ふだんの `npm run dev`（5173。端末の localStorage で動く版）には影響しない。
 * LINE・Google で試すときは、環境変数 OIDC_LINE_CLIENT_ID／OIDC_LINE_CLIENT_SECRET、OIDC_GOOGLE_CLIENT_ID／OIDC_GOOGLE_CLIENT_SECRET を付けて起動する。
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
/** サーバーにつなぐ版のアプリの出力先 */
const APP_OUT = 'dist-app-local';

/**
 * 引数から値を読む。
 * @param {string} name オプション名
 * @param {string} fallback 既定値
 * @returns {string} 値
 */
function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

/**
 * Vite のビルドを1回走らせる（失敗したら終了する）。
 * @param {string[]} args vite に渡す引数
 * @param {Record<string, string>} env 足す環境変数
 */
function build(args, env = {}) {
  const result = spawnSync(process.execPath, [VITE, 'build', ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const port = option('--port', '8787');
const dataDir = option('--data', '.data/app-pg');

build(['-c', 'vite.server.config.ts', '--mode', 'demo']);
build(['--mode', 'demo', '--outDir', APP_OUT, '--emptyOutDir'], { VITE_APP_BACKEND: 'server' });

const server = spawn(
  process.execPath,
  ['dist-server/serverMain.mjs', '--port', port, '--static', APP_OUT, '--pglite-dir', dataDir, '--db', '.data/app-local-cms.sqlite', '--mock-login', '--demo-walk'],
  { cwd: ROOT, stdio: 'inherit' },
);
server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
