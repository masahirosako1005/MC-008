/**
 * @file PC のブラウザのタブを「スマホの指の操作」にする（依存ライブラリなし / Node 24。scripts/dev/demo-fresh.mjs が使う）
 *
 * 開発者ツールの「デバイスのエミュレーション」と同じ仕組み（Chrome DevTools Protocol）を、起動したブラウザに外からつないで入れる。
 * マウスの押しながらの移動がタッチになる（スワイプでスクロール・はじくと惰性で流れる・カーソルが指の丸になる）。
 *
 * 使う条件: ブラウザを `--remote-debugging-port=0` と専用の `--user-data-dir` で起動していること
 * （ポート番号はブラウザが <user-data-dir>/DevToolsActivePort に書く。待ち受けは自分の PC だけ）。
 * つないでいる間だけ効くので、呼び出し元のプロセスが動いている間は接続を持ち続ける。あとから開いたタブにも数秒おきに入れる。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** ブラウザがポート番号を書くのを待つ最長の時間（ミリ秒） */
const PORT_FILE_TIMEOUT_MS = 20_000;
/** 新しいタブを探す間隔（ミリ秒） */
const SCAN_INTERVAL_MS = 2_000;

/**
 * ブラウザが書いたデバッグ用のポート番号を読む。
 * @param {string} profileDir ブラウザの --user-data-dir
 * @returns {Promise<string | undefined>} ポート番号（時間内に書かれなければ undefined）
 */
async function readDebugPort(profileDir) {
  const file = join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + PORT_FILE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const port = readFileSync(file, 'utf8').split('\n')[0]?.trim();
      if (port !== undefined && /^\d+$/.test(port)) return port;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return undefined;
}

/**
 * 1つのタブにつないで、タッチのエミュレーションを入れる（接続は開いたままにする）。
 * @param {string} wsUrl タブの webSocketDebuggerUrl
 * @returns {Promise<WebSocket | undefined>} つないだ接続（失敗したら undefined）
 */
function attachTouch(wsUrl) {
  return new Promise((done) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 1 } }));
      ws.send(JSON.stringify({ id: 2, method: 'Emulation.setEmitTouchEventsForMouse', params: { enabled: true, configuration: 'mobile' } }));
      done(ws);
    });
    ws.addEventListener('error', () => done(undefined));
  });
}

/**
 * ブラウザのタブのうち、条件に合うものをスマホの指の操作にする。あとから開いたタブにも入れ続ける。
 * @param {{ profileDir: string; matches: (url: string) => boolean }} input ブラウザの --user-data-dir と、対象のタブかを URL で決める関数
 * @returns {Promise<boolean>} ブラウザにつなげたら true（最初のタブに入れ終えてから返す）
 */
export async function emulateTouch(input) {
  const port = await readDebugPort(input.profileDir);
  if (port === undefined) return false;
  /** @type {Map<string, WebSocket>} つないだタブ（id → 接続） */
  const attached = new Map();

  /** いま開いているタブを調べ、まだつないでいない対象のタブにつなぐ */
  async function scan() {
    let targets;
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
      return; // ブラウザが閉じられた
    }
    for (const target of targets) {
      if (target.type !== 'page' || attached.has(target.id) || !input.matches(String(target.url))) continue;
      const ws = await attachTouch(target.webSocketDebuggerUrl);
      if (ws === undefined) continue;
      attached.set(target.id, ws);
      ws.addEventListener('close', () => attached.delete(target.id));
    }
  }

  await scan();
  setInterval(scan, SCAN_INTERVAL_MS).unref();
  return true;
}
