#!/usr/bin/env node
/**
 * @file 発表・デモ用：いまのソースをビルドし、空の状態でアプリと店舗CMS を起動する（依存ライブラリなし / Node 24）
 *
 * 使い方:
 *   npm run demo:fresh                    … 自分の PC で開く（プロジェクト直下の demo-fresh.cmd をダブルクリックでも同じ）
 *   npm run demo:fresh -- --host 0.0.0.0  … 同じネットワークのスマホからも開く（自動で https。証明書は scripts/dev/devCert.mjs）
 *
 * すること（起動のたびに毎回）:
 *   1. 連携サーバー（dist-server）と、アプリ＋CMS（dist-demo-fresh）をいまのソースからデモビルドする＝最新版
 *      - VITE_CMS_BACKEND=server：CMS の登録がアプリへ届く（別の端末どうしでもつながる）
 *      - VITE_DEMO_START=first  ：保存済みの旅人が無いとき「初回の人」（記録なし）で始める
 *   2. CMS の DB（.data/demo-fresh/）を消して作り直す＝CMS の登録・版が空
 *   3. 連携サーバーを起動し、まっさらなプロファイルのブラウザ（Edge か Chrome）でアプリと CMS を開く＝localStorage が空
 *
 * オプション:
 *   --port 8790      ポート（ふだんの 5173・demo:backend の 8787 とは別にしてある）
 *   --host 0.0.0.0   スマホから開くとき。スマホ側の空の状態は、スマホのシークレット（プライベート）タブで開いて作る
 *   --no-open        ブラウザを開かない（URL だけ表示）
 *
 * デモの途中で空に戻すとき: このスクリプトを止めて（Ctrl+C）もう一度起動する。
 * 獲得済みの状態を見せたいとき: アプリ右上の歯車を長押し → デモメニューの旅人切替「通い慣れた人」。
 * ふだんの `npm run dev`（5173）・`npm run demo:backend`（8787）には影響しない（出力先・DB・ブラウザのプロファイルが別）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultTlsDir, ensureDevCertificates } from './devCert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
/** 空の状態で始める版のアプリ＋CMS の出力先 */
const APP_OUT = 'dist-demo-fresh';
/** CMS の DB の置き場所（起動のたびに消して作り直す。このスクリプト専用） */
const DATA_DIR = join(ROOT, '.data', 'demo-fresh');
/** ブラウザのまっさらなプロファイルのフォルダ名の頭（一時フォルダに作る） */
const PROFILE_PREFIX = 'machiquest-demo-';
/** 自分の PC だけを指すホスト名 */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];
/** サーバーの起動を待つ最長の時間（ミリ秒） */
const READY_TIMEOUT_MS = 30_000;

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
  const result = spawnSync(process.execPath, [VITE, 'build', ...args, '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/**
 * サーバーに1回つないでみる。
 * @param {string} port ポート
 * @param {Buffer | undefined} ca https のときの認証局の証明書（http なら undefined）
 * @returns {Promise<boolean>} /api/health が 200 なら true
 */
function probe(port, ca) {
  return new Promise((done) => {
    const options = { host: '127.0.0.1', port, path: '/api/health', timeout: 2000, ...(ca === undefined ? {} : { ca }) };
    const req = (ca === undefined ? http : https).request(options, (res) => {
      res.resume();
      done(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => done(false));
    req.end();
  });
}

/**
 * Edge か Chrome の実行ファイルを探す（まっさらなプロファイルで開くため、既定のブラウザではなく実行ファイルを直接使う）。
 * @returns {string | undefined} 見つかったパス
 */
function findBrowser() {
  const roots = [process.env['ProgramFiles(x86)'], process.env['ProgramFiles'], process.env['LOCALAPPDATA']].filter((v) => v !== undefined);
  const tails = [join('Microsoft', 'Edge', 'Application', 'msedge.exe'), join('Google', 'Chrome', 'Application', 'chrome.exe')];
  for (const tail of tails) for (const root of roots) if (existsSync(join(root, tail))) return join(root, tail);
  return undefined;
}

/**
 * 前回までのデモのブラウザのプロファイルを消す（使用中で消せないものは残す）。
 */
function removeOldProfiles() {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    try {
      rmSync(join(tmpdir(), name), { recursive: true, force: true });
    } catch {
      // 前回のブラウザがまだ開いている。次の起動で消す
    }
  }
}

/**
 * まっさらなプロファイルのブラウザで URL を開く。
 * @param {string[]} urls 開く URL（1つ目が手前のタブ）
 */
function openFreshBrowser(urls) {
  const browser = findBrowser();
  if (browser === undefined) {
    console.log('[demo] Edge・Chrome が見つかりません。シークレット（InPrivate）ウィンドウで上の URL を開いてください');
    return;
  }
  removeOldProfiles();
  const profile = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  const args = [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--new-window', ...urls];
  spawn(browser, args, { detached: true, stdio: 'ignore' }).unref();
  console.log('[demo] まっさらなブラウザを開きました（このウィンドウの中だけが空の状態です。ふだんのブラウザで開くと前の記録が残っています）');
}

const port = option('--port', '8790');
const host = option('--host', '127.0.0.1');
const noOpen = process.argv.includes('--no-open');
if (!existsSync(VITE)) throw new Error('node_modules/vite がありません。npm install を実行してください');

console.log('[demo] いまのソースからビルドします（1分ほど）');
build(['-c', 'vite.server.config.ts', '--mode', 'demo']);
build(['--mode', 'demo', '--outDir', APP_OUT, '--emptyOutDir'], { VITE_CMS_BACKEND: 'server', VITE_DEMO_START: 'first' });

// CMS の DB を空にする（このスクリプト専用のフォルダ。前回のサーバーが動いたままなら消せないので止めてもらう）
try {
  rmSync(DATA_DIR, { recursive: true, force: true });
} catch {
  console.error(`[demo] 前回のデモがまだ動いています。そのウィンドウを閉じて（Ctrl+C）から、もう一度起動してください（${DATA_DIR}）`);
  process.exit(1);
}
mkdirSync(DATA_DIR, { recursive: true });

const useTls = !LOOPBACK_HOSTS.includes(host);
const tls = useTls ? ensureDevCertificates({ dir: defaultTlsDir() }) : undefined;
const serverArgs = ['dist-server/serverMain.mjs', '--port', port, '--host', host, '--db', join('.data', 'demo-fresh', 'cms.sqlite'), '--static', APP_OUT];
if (tls !== undefined) serverArgs.push('--tls-cert', tls.certPath, '--tls-key', tls.keyPath);

const server = spawn(process.execPath, serverArgs, { cwd: ROOT, stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));

const ca = tls === undefined ? undefined : readFileSync(tls.caCertPath);
const deadline = Date.now() + READY_TIMEOUT_MS;
let ready = false;
while (!ready && Date.now() < deadline) {
  ready = await probe(port, ca);
  if (!ready) await new Promise((r) => setTimeout(r, 400));
}
if (!ready) {
  // https で確かめられないまま LAN に出さない
  console.error('[demo] サーバーにつながりません。止めます');
  server.kill();
  process.exit(1);
}

const local = `${useTls ? 'https' : 'http'}://localhost:${port}/`;
console.log('');
console.log(`[demo] アプリ ${local}`);
console.log(`[demo] CMS    ${local}cms.html`);
if (tls !== undefined) {
  for (const ip of tls.ipAddresses.filter((a) => !a.includes(':') && a !== '127.0.0.1')) console.log(`[demo] スマホ  https://${ip}:${port}/ （シークレットタブで開くと空の状態）`);
  console.log(`[demo] スマホで警告を出さないには ${tls.caCertPath} をスマホに入れて信頼してください（発表後は消す）`);
}
console.log('[demo] 止めるとき・空に戻すとき: Ctrl+C で止めて、もう一度起動');
if (!noOpen) openFreshBrowser([local, `${local}cms.html`]);
