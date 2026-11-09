/**
 * @file 連携サーバーのエントリポイント（Node 24。docs/09 §7.3）
 * 店舗CMS と利用者アプリをつなぐ。Node 標準の http と node:sqlite だけで動く（依存パッケージなし。U1 の決定）。
 * ビルド：vite build -c vite.server.config.ts --mode demo（→ dist-server/serverMain.mjs）
 * 起動：node dist-server/serverMain.mjs [--port 8787] [--host 127.0.0.1] [--db .data/cms-demo.sqlite] [--master public/master] [--static dist-backend]
 * デモの版（--mode demo でビルド）だけが店舗CMS の API を出す。本番の版は公開スナップショットを配るだけ（MUST-8、SEC-02）。
 */
import { createServer } from 'node:http';
import { isDemoBuild } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { createServerApp } from '@/infrastructure/di/serverContainer';
import { nodeFetchText } from '@/infrastructure/server/nodeFetchText';
import { parseServerArgs } from '@/infrastructure/server/serverOptions';

const logger = createLogger('serverMain');

/** ループバック（自分の PC だけ）のホスト名 */
const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '::1'];

/**
 * 連携サーバーを起動する。
 * @sideEffect ポートを開き、DB のファイルを開く。SIGINT・SIGTERM で閉じる
 */
async function main(): Promise<void> {
  const log = logger.fn('main');
  const options = parseServerArgs(process.argv.slice(2));
  if (!options.ok) {
    log.error(options.error.message);
    process.exitCode = 2;
    return log.fail(undefined, 'args');
  }
  const { port, host, dbPath, masterDir, staticDir } = options.value;
  const mode = isDemoBuild ? 'demo' : 'production';
  const app = await createServerApp({ mode, dbPath, fetchText: nodeFetchText(masterDir), ...(staticDir === undefined ? {} : { staticDir }) });
  if (!app.ok) {
    log.error('連携サーバーを準備できませんでした', { code: app.error.code, message: app.error.message });
    process.exitCode = 1;
    return log.fail(undefined, app.error.code);
  }
  const server = createServer(app.value.handler);
  server.listen(port, host, () => {
    log.info('連携サーバーを起動しました', { url: `http://${host.includes(':') ? `[${host}]` : host}:${port}/`, mode, db: dbPath, static: staticDir ?? 'なし' });
    if (mode === 'demo' && !LOOPBACK_HOSTS.includes(host)) log.warn('ログインが無いデモ版です。同じネットワークの人なら誰でもお店の情報を変えられます');
  });
  /** 止めるときに DB・SSE・つながりを閉じる */
  const shutdown = (): void => { // audit-ignore: fnlog-missing 止めるときに1回だけ呼ぶ後始末（main のログで記録する）
    log.info('連携サーバーを止めます');
    app.value.close();
    server.close();
    server.closeAllConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return log.exit(undefined);
}

void main();
