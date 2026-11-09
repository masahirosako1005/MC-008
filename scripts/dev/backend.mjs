#!/usr/bin/env node
/**
 * @file 連携サーバーつきで、利用者アプリと店舗CMS を動かす（依存ライブラリなし / Node 24。docs/09 §7.3）
 *
 * 使い方:
 *   node scripts/dev/backend.mjs dev     … 開発用。連携サーバー（8787）と Vite の開発サーバー（5174）を起動する。
 *                                          Vite は /api を連携サーバーへ中継する。アプリ http://localhost:5174/ ・CMS http://localhost:5174/cms.html
 *   node scripts/dev/backend.mjs serve   … 発表用。アプリと CMS を連携つきでデモビルドし（dist-backend）、
 *                                          連携サーバーが画面と API を1つのオリジン（8787）で配る。http://localhost:8787/ ・ /cms.html
 *
 * オプション:
 *   --host 0.0.0.0   同じネットワークのスマホから開くとき（ログインが無いので、発表の場だけで使う）
 *   --api-port 8787  連携サーバーのポート
 *   --web-port 5174  Vite の開発サーバーのポート（dev のとき。5173 はふだんの開発サーバーが使う）
 *   --db <path>      SQLite のファイル（既定 .data/cms-demo.sqlite。消すと登録内容が空に戻る）
 *
 * ふだんの `npm run dev`（5173）は今までどおり localStorage でつなぐ（このスクリプトは影響しない）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

/**
 * 引数を読む。
 * @param argv process.argv.slice(2)
 * @returns コマンドとオプション
 */
function parseArgs(argv) {
  const [command = 'dev', ...rest] = argv;
  const opts = { host: '127.0.0.1', apiPort: '8787', webPort: '5174', db: '.data/cms-demo.sqlite' };
  const keys = { '--host': 'host', '--api-port': 'apiPort', '--web-port': 'webPort', '--db': 'db' };
  for (let i = 0; i < rest.length; i += 2) {
    const key = keys[rest[i]];
    if (key === undefined || rest[i + 1] === undefined) throw new Error(`知らないオプションか値がありません: ${rest[i]}`);
    opts[key] = rest[i + 1];
  }
  if (!['dev', 'serve'].includes(command)) throw new Error(`コマンドは dev か serve です: ${command}`);
  return { command, opts };
}

/**
 * Vite を同期で動かす（ビルド）。失敗したら終了する。
 * @param args Vite の引数
 * @param env 足す環境変数
 */
function runViteSync(args, env = {}) {
  const result = spawnSync(process.execPath, [VITE, ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/**
 * 子プロセスを起動する（終わったら全体を止める）。
 * @param label 名前
 * @param args node の引数
 * @param env 足す環境変数
 * @returns 子プロセス
 */
function start(label, args, env = {}) {
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('exit', (code) => {
    console.log(`[backend] ${label} が終了しました（${code}）`);
    stopAll();
  });
  return child;
}

const children = [];
/** すべての子プロセスを止める */
function stopAll() {
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exitCode ??= 0;
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

const { command, opts } = parseArgs(process.argv.slice(2));
if (!existsSync(VITE)) throw new Error('node_modules/vite がありません。npm install を実行してください');

console.log('[backend] 連携サーバーをビルドします（dist-server）');
runViteSync(['build', '-c', 'vite.server.config.ts', '--mode', 'demo', '--logLevel', 'warn']);
const serverArgs = [join(ROOT, 'dist-server', 'serverMain.mjs'), '--port', opts.apiPort, '--db', opts.db];

if (command === 'serve') {
  console.log('[backend] アプリと CMS を連携つきでビルドします（dist-backend）');
  runViteSync(['build', '--mode', 'demo', '--outDir', 'dist-backend', '--emptyOutDir', '--logLevel', 'warn'], { VITE_CMS_BACKEND: 'server' });
  children.push(start('連携サーバー', [...serverArgs, '--host', opts.host, '--static', 'dist-backend']));
  console.log(`[backend] アプリ http://localhost:${opts.apiPort}/  CMS http://localhost:${opts.apiPort}/cms.html`);
} else {
  children.push(start('連携サーバー', [...serverArgs, '--host', '127.0.0.1']));
  const viteArgs = [VITE, '--mode', 'demo', '--port', opts.webPort, ...(opts.host === '127.0.0.1' ? [] : ['--host', opts.host])];
  children.push(start('Vite', viteArgs, { VITE_CMS_BACKEND: 'server', CMS_API_PROXY: `http://127.0.0.1:${opts.apiPort}` }));
  console.log(`[backend] アプリ http://localhost:${opts.webPort}/  CMS http://localhost:${opts.webPort}/cms.html`);
}
