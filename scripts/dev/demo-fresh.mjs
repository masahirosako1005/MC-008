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
 *      - 最初の旅人は「通い慣れた人」（図鑑 36／80 枚・EXP 600・アバターの部品と特典を一部取得済み）。
 *        2026-11-10 ユーザー指示「図鑑とかアバターとか特典は一部を取得済に」。前に試した記録・写真・アンケート・CMS の登録は残らない
 *      - --empty のときだけ VITE_DEMO_START=first：「初回の人」（記録なし・EXP 0）で始める
 *   2. CMS の DB（.data/demo-fresh/）を消して作り直す＝CMS の登録・版が空
 *   3. 連携サーバーを起動し、まっさらなプロファイルのブラウザ（Edge か Chrome）でアプリと CMS を開く＝localStorage が空
 *      ブラウザは最大化し、スマホ枠（390×844＝iPhone 12〜14 の大きさ）が縦に欠けずに入るよう、このウィンドウだけ表示倍率を下げる
 *      （ノート PC では画面の高さが足りず、枠が縦に詰まって寸胴に見えるため。2026-11-10）
 *
 * オプション:
 *   --port 8790      ポート（ふだんの 5173・demo:backend の 8787 とは別にしてある）
 *   --host 0.0.0.0   スマホから開くとき。スマホ側の空の状態は、スマホのシークレット（プライベート）タブで開いて作る
 *   --empty          何も取得していない「初回の人」で始める（既定は一部取得済みの「通い慣れた人」）
 *   --no-open        ブラウザを開かない（URL だけ表示）
 *   --no-touch       アプリのタブをスマホの指の操作にしない（ふつうのマウス操作のまま）
 *
 * スマホの指の操作（既定）: アプリのタブだけ、マウスの押しながらの移動がスワイプになる（scripts/dev/touchEmulation.mjs。CMS のタブはマウスのまま）。
 * このスクリプトが動いている間だけ効く。あとから同じウィンドウで開いたアプリのタブにも数秒で効く。
 *
 * デモの途中で空に戻すとき: このスクリプトを止めて（Ctrl+C）もう一度起動する。
 * 何も取得していない状態を見せたいとき: アプリ右上の歯車を長押し → デモメニューの旅人切替「初回の人」（または --empty で起動）。
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
import { emulateTouch } from './touchEmulation.mjs';

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
/** スマホ枠を欠けずに出すのに要る高さ（CSS px）：枠 844 ＋ 上下の余白 40 ＋ ブラウザのタブ・アドレスバーのぶん 90（実測 約80） */
const FRAME_NEEDED_HEIGHT = 844 + 40 + 90;
/** 表示倍率の下限（これより小さくすると文字が読めない） */
const MIN_SCALE = 0.75;
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
 * スマホ枠が縦に欠けずに入る表示倍率を返す（いまの画面の倍率で入るなら undefined＝そのまま）。
 * 画面の実際の高さ（ピクセル）と、タスクバーを除いた高さから求める。
 * @returns {number | undefined} ブラウザに渡す表示倍率（0.05 刻み）
 */
function frameScale() {
  const script = 'Add-Type -AssemblyName System.Windows.Forms; $s=[System.Windows.Forms.Screen]::PrimaryScreen; ' +
    '$v=(Get-CimInstance Win32_VideoController | Where-Object CurrentVerticalResolution | Select-Object -First 1).CurrentVerticalResolution; ' +
    '"$($s.Bounds.Height) $($s.WorkingArea.Height) $v"';
  const result = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  const [logical, work, physical] = (result.stdout ?? '').trim().split(' ').map(Number);
  if (!(logical > 0 && work > 0 && physical > 0)) return undefined;
  const current = physical / logical;
  const fit = Math.floor(((work * current) / FRAME_NEEDED_HEIGHT) * 20) / 20;
  return fit >= current ? undefined : Math.max(MIN_SCALE, fit);
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
 * @param {string[]} urls 開く URL（1つ目が手前のタブ＝アプリ）
 * @param {boolean} touch アプリのタブをスマホの指の操作にするか
 */
async function openFreshBrowser(urls, touch) {
  const browser = findBrowser();
  if (browser === undefined) {
    console.log('[demo] Edge・Chrome が見つかりません。シークレット（InPrivate）ウィンドウで上の URL を開いてください');
    return;
  }
  removeOldProfiles();
  const profile = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  const scale = frameScale();
  const args = [
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--start-maximized',
    ...(scale === undefined ? [] : [`--force-device-scale-factor=${scale}`]), ...(touch ? ['--remote-debugging-port=0'] : []), '--new-window', ...urls,
  ];
  spawn(browser, args, { detached: true, stdio: 'ignore' }).unref();
  console.log('[demo] まっさらなブラウザを開きました（このウィンドウの中だけが空の状態です。ふだんのブラウザで開くと前の記録が残っています）');
  if (!touch) return;
  const app = urls[0] ?? '';
  const done = await emulateTouch({ profileDir: profile, matches: (url) => url.startsWith(app) && !url.includes('cms.html') });
  console.log(done ? '[demo] アプリのタブはスマホの指の操作です（マウスを押しながら動かすとスワイプ）' : '[demo] スマホの指の操作にできませんでした（マウス操作のまま使えます）');
}

const port = option('--port', '8790');
const host = option('--host', '127.0.0.1');
const noOpen = process.argv.includes('--no-open');
if (!existsSync(VITE)) throw new Error('node_modules/vite がありません。npm install を実行してください');

console.log('[demo] いまのソースからビルドします（1分ほど）');
build(['-c', 'vite.server.config.ts', '--mode', 'demo']);
build(['--mode', 'demo', '--outDir', APP_OUT, '--emptyOutDir'], { VITE_CMS_BACKEND: 'server', VITE_DEMO_START: process.argv.includes('--empty') ? 'first' : 'regular' });

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
if (!noOpen) await openFreshBrowser([local, `${local}cms.html`], !process.argv.includes('--no-touch'));
