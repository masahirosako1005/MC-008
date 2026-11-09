#!/usr/bin/env node
/**
 * @file 本番向けのビルド一式（依存ライブラリなし / Node 24。docs/10）
 * 連携サーバー・利用者アプリ・店舗CMS を本番の版で作る。
 *
 *   node scripts/build/backend.mjs [--app-origin https://app.example.jp] [--skip-typecheck]
 *
 * 出力：
 *   dist-server/serverMain.mjs … 連携サーバー（本番の版。デモの API は入らない）
 *   dist/                       … 利用者アプリ（連携サーバーの公開スナップショットを受け取る版。cms.html は入らない）
 *   dist-cms/                   … 店舗CMS（連携サーバーにつなぐ版。index.html として配る＝別オリジンの / で開ける）
 * --app-origin は、店舗CMS の「アプリを開く」のリンク先（CMS を別オリジンに置くとき）。無ければ同じオリジン。
 * 動かし方は docs/10_backend_operations.md。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

/**
 * 引数を読む。
 * @param argv process.argv.slice(2)
 * @returns オプション
 */
function parseArgs(argv) {
  const opts = { appOrigin: '', typecheck: true };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (name === '--skip-typecheck') opts.typecheck = false;
    else if (name === '--app-origin' && argv[i + 1] !== undefined) opts.appOrigin = argv[++i];
    else throw new Error(`知らないオプションか値がありません: ${name}`);
  }
  return opts;
}

/**
 * Node のスクリプトを同期で動かす。失敗したら終了する。
 * @param label 名前
 * @param script スクリプトの場所
 * @param args 引数
 * @param env 足す環境変数
 */
function run(label, script, args, env = {}) {
  console.log(`[build] ${label}`);
  const result = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const opts = parseArgs(process.argv.slice(2));
if (!existsSync(VITE)) throw new Error('node_modules/vite がありません。npm install を実行してください');
if (opts.appOrigin !== '' && !/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(opts.appOrigin)) throw new Error('--app-origin は https://名前[:ポート] の形です');

const appOrigin = opts.appOrigin === '' ? {} : { VITE_APP_ORIGIN: opts.appOrigin };
if (opts.typecheck) run('型の確認（tsc）', TSC, ['--noEmit']);
run('連携サーバー（本番の版）→ dist-server', VITE, ['build', '-c', 'vite.server.config.ts', '--logLevel', 'warn']);
run('利用者アプリ（本番・連携つき）→ dist', VITE, ['build', '--logLevel', 'warn'], { VITE_CMS_BACKEND: 'server' });
run('店舗CMS（本番・連携つき）→ dist-cms', VITE, ['build', '--mode', 'cms', '--outDir', 'dist-cms', '--emptyOutDir', '--logLevel', 'warn'], { VITE_CMS_BACKEND: 'server', ...appOrigin });
const cmsHtml = join(ROOT, 'dist-cms', 'cms.html');
if (existsSync(cmsHtml)) renameSync(cmsHtml, join(ROOT, 'dist-cms', 'index.html'));
console.log('[build] 完了: dist-server/serverMain.mjs, dist/, dist-cms/（index.html）');
console.log('[build] 起動例: node dist-server/serverMain.mjs --host 0.0.0.0 --static dist --cms-static dist-cms --cms-port 8788 --tls-cert <crt> --tls-key <key> --allowed-hosts app.example.jp,admin.example.jp');
