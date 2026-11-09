#!/usr/bin/env node
/**
 * @file 連携サーバーつきで、利用者アプリと店舗CMS を動かす（依存ライブラリなし / Node 24。docs/09 §7.3）
 *
 * 使い方:
 *   node scripts/dev/backend.mjs dev     … 開発用。連携サーバー（8787）と Vite の開発サーバー（5174）を起動する。
 *                                          Vite は /api を連携サーバーへ中継する。アプリ http://localhost:5174/ ・CMS http://localhost:5174/cms.html
 *                                          自分の PC からだけ開ける（LAN に出すときは serve を使う。https が要るため）
 *   node scripts/dev/backend.mjs serve   … 発表用。アプリと CMS を連携つきでデモビルドし（dist-backend）、
 *                                          連携サーバーが画面と API を1つのオリジン（8787）で配る。http://localhost:8787/ ・ /cms.html
 *
 * オプション:
 *   --host 0.0.0.0   同じネットワークのスマホから開くとき（serve だけ）。自動で https になる（証明書は scripts/dev/devCert.mjs がユーザーごとのフォルダに作る）
 *   --tls            自分の PC だけで開くときも https にする（serve だけ）
 *   --api-port 8787  連携サーバーのポート
 *   --web-port 5174  Vite の開発サーバーのポート（dev のとき。5173 はふだんの開発サーバーが使う）
 *   --db <path>      SQLite のファイル（既定 .data/cms-demo.sqlite）
 *
 * スマホで警告を出さずに開くには、起動時に表示される ca.crt をスマホに入れて信頼する（手元用の認証局。発表が終わったら消す）。
 * https で起動したときは、起動後に https で本当につながるかを確かめ、つながらなければ止める（平文のまま LAN に出さない）。
 * ふだんの `npm run dev`（5173）は今までどおり localStorage でつなぐ（このスクリプトは影響しない）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:https';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defaultTlsDir, ensureDevCertificates } from './devCert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
/** 自分の PC だけを指すホスト名 */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];
/** 起動後に https を確かめる最長の時間（ミリ秒） */
const TLS_PROBE_TIMEOUT_MS = 30_000;

/**
 * 引数を読む。
 * @param argv process.argv.slice(2)
 * @returns コマンドとオプション
 */
function parseArgs(argv) {
  const [command = 'dev', ...rest] = argv;
  const opts = { host: '127.0.0.1', apiPort: '8787', webPort: '5174', db: '.data/cms-demo.sqlite', tls: false };
  const keys = { '--host': 'host', '--api-port': 'apiPort', '--web-port': 'webPort', '--db': 'db' };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--tls') {
      opts.tls = true;
      continue;
    }
    const key = keys[rest[i]];
    if (key === undefined || rest[i + 1] === undefined || rest[i + 1].startsWith('--')) throw new Error(`知らないオプションか値がありません: ${rest[i]}`);
    opts[key] = rest[i + 1];
    i += 1;
  }
  if (!['dev', 'serve'].includes(command)) throw new Error(`コマンドは dev か serve です: ${command}`);
  if (command === 'dev' && (opts.tls || !LOOPBACK_HOSTS.includes(opts.host))) {
    throw new Error('dev は自分の PC からだけ開けます。スマホから開く・https にするときは serve を使ってください（例: serve --host 0.0.0.0）');
  }
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

/**
 * https の証明書を用意し、サーバーに渡す引数と開く URL を返す。
 * @param port ポート
 * @returns { args, urls }
 */
function prepareTls(port) {
  const made = ensureDevCertificates({ dir: defaultTlsDir() });
  console.log(`[backend] https の証明書: ${made.certPath}（${made.serverCreated ? '作りました' : '使い回します'}）`);
  console.log(`[backend] スマホで警告を出さないには ${made.caCertPath} をスマホに入れて信頼してください${made.caCreated ? '（新しく作りました）' : ''}`);
  if (made.skipped.length > 0) console.log(`[backend] 社内の IP ではないため証明書に入れなかったアドレス: ${made.skipped.join(', ')}`);
  const urls = made.ipAddresses.filter((ip) => !ip.includes(':')).map((ip) => `https://${ip === '127.0.0.1' ? 'localhost' : ip}:${port}/`);
  return { args: ['--tls-cert', made.certPath, '--tls-key', made.keyPath], urls, caCertPath: made.caCertPath };
}

/**
 * https で1回つないでみる（認証局だけを信頼して検証する）。
 * @param port ポート
 * @param ca 認証局の証明書（PEM）
 * @returns 'ok' | 'retry'（まだ待ち受けていない）| 'fail'（https ではない・証明書が違う）
 */
function probeTls(port, ca) {
  return new Promise((done) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/health', ca, timeout: 3000 }, (res) => {
      res.resume();
      done(res.statusCode === 200 ? 'ok' : 'fail');
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => done(['ECONNREFUSED', 'ECONNRESET'].includes(e.code) || e.message === 'timeout' ? 'retry' : 'fail'));
    req.end();
  });
}

/**
 * 起動した連携サーバーに https で本当につながるか確かめる。つながらなければ全体を止める（平文のまま LAN に出さない）。
 * @param port ポート
 * @param caCertPath 認証局の証明書のファイル
 */
async function verifyTlsOrStop(port, caCertPath) {
  const ca = readFileSync(caCertPath);
  const deadline = Date.now() + TLS_PROBE_TIMEOUT_MS;
  let result = 'retry';
  while (result === 'retry' && Date.now() < deadline && children.every((c) => c.exitCode === null)) {
    result = await probeTls(port, ca);
    if (result === 'retry') await new Promise((r) => setTimeout(r, 500));
  }
  if (result === 'ok') {
    console.log('[backend] https でつながることを確かめました');
    return;
  }
  console.error('[backend] 連携サーバーに https でつながりません。平文で LAN に出さないよう止めます');
  stopAll();
  process.exitCode = 1;
}

const { command, opts } = parseArgs(process.argv.slice(2));
if (!existsSync(VITE)) throw new Error('node_modules/vite がありません。npm install を実行してください');

console.log('[backend] 連携サーバーをビルドします（dist-server）');
runViteSync(['build', '-c', 'vite.server.config.ts', '--mode', 'demo', '--logLevel', 'warn']);
const serverArgs = [join(ROOT, 'dist-server', 'serverMain.mjs'), '--port', opts.apiPort, '--db', opts.db];

if (command === 'serve') {
  const useTls = opts.tls || !LOOPBACK_HOSTS.includes(opts.host);
  const tls = useTls ? prepareTls(opts.apiPort) : { args: [], urls: [`http://localhost:${opts.apiPort}/`] };
  console.log('[backend] アプリと CMS を連携つきでビルドします（dist-backend）');
  runViteSync(['build', '--mode', 'demo', '--outDir', 'dist-backend', '--emptyOutDir', '--logLevel', 'warn'], { VITE_CMS_BACKEND: 'server' });
  children.push(start('連携サーバー', [...serverArgs, '--host', opts.host, '--static', 'dist-backend', ...tls.args]));
  if (useTls) await verifyTlsOrStop(opts.apiPort, tls.caCertPath);
  if (process.exitCode !== 1) {
    for (const url of useTls && LOOPBACK_HOSTS.includes(opts.host) ? tls.urls.slice(0, 1) : tls.urls) console.log(`[backend] アプリ ${url}  CMS ${url}cms.html`);
  }
} else {
  children.push(start('連携サーバー', [...serverArgs, '--host', '127.0.0.1']));
  const viteArgs = [VITE, '--mode', 'demo', '--port', opts.webPort];
  children.push(start('Vite', viteArgs, { VITE_CMS_BACKEND: 'server', CMS_API_PROXY: `http://127.0.0.1:${opts.apiPort}` }));
  console.log(`[backend] アプリ http://localhost:${opts.webPort}/  CMS http://localhost:${opts.webPort}/cms.html`);
}
