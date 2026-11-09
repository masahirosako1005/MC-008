/**
 * @file 連携サーバーのエントリポイント（Node 24。docs/09 §7.3）
 * 店舗CMS と利用者アプリをつなぐ。Node 標準の http／https と node:sqlite だけで動く（依存パッケージなし。U1 の決定）。
 * ビルド：vite build -c vite.server.config.ts [--mode demo]（→ dist-server/serverMain.mjs）
 * 起動：node dist-server/serverMain.mjs [起動オプション]（serverOptions.ts）
 * アカウント：node dist-server/serverMain.mjs account <create|list|set-password|suspend|resume> ...（cli/accountCommand.ts）
 *
 * - デモの版（--mode demo でビルド）はデモの日付・デモのログイン（自分の PC からだけ）・デモのやり直しを受け付ける
 * - 本番の版は、店舗CMS の API をパスワードのログインつきで出す（SEC-19、SEC-01、SEC-03）
 * - 自分の PC 以外に公開する（--host 0.0.0.0 など）ときは、TLS（--tls-cert/--tls-key）か、TLS を終端する中継（--trust-proxy）が要る（SEC-05）。
 *   どちらも無ければ起動しない（平文の LAN 公開で Cookie やパスワードが流れないように）
 * - --cms-port を付けると、CMS の画面と CMS・ログインの API を別のポート（別のオリジン）で出す（docs/09 §7.1）
 */
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { RequestListener, Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { isDemoBuild } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { createServerApp } from '@/infrastructure/di/serverContainer';
import { runAccountCommand } from '@/infrastructure/server/cli/accountCommand';
import { nodeFetchText } from '@/infrastructure/server/nodeFetchText';
import { isLoopbackHost, parseServerArgs } from '@/infrastructure/server/serverOptions';
import type { ServerCliOptions } from '@/infrastructure/server/serverOptions';

const logger = createLogger('serverMain');

/** TLS の証明書と鍵（PEM） */
interface TlsMaterial {
  readonly cert: Buffer;
  readonly key: Buffer;
}

/**
 * TLS の証明書と鍵を読む。
 * @param options 起動オプション
 * @returns 読んだもの（指定が無ければ undefined。読めなければ null）
 */
function loadTls(options: ServerCliOptions): TlsMaterial | undefined | null {
  const log = logger.fn('loadTls', { tls: options.tlsCert !== undefined });
  if (options.tlsCert === undefined || options.tlsKey === undefined) return log.exit(undefined);
  try {
    return log.exit({ cert: readFileSync(options.tlsCert), key: readFileSync(options.tlsKey) });
  } catch (error) {
    log.error('TLS の証明書か鍵を読めませんでした', { message: error instanceof Error ? error.message : 'unknown' });
    return log.exit(null, 'unreadable');
  }
}

/**
 * 待ち受けを1つ作って開く。
 * @param handler 要求ハンドラ
 * @param port ポート
 * @param host ホスト
 * @param tls TLS の証明書と鍵（無ければ http）
 * @returns 開いたサーバーと URL
 * @sideEffect ポートを開く
 */
function listen(handler: RequestListener, port: number, host: string, tls: TlsMaterial | undefined): Promise<{ readonly server: Server; readonly url: string }> {
  const log = logger.fn('listen', { port, host, tls: tls !== undefined });
  const server = tls === undefined ? createHttpServer(handler) : createHttpsServer({ cert: tls.cert, key: tls.key }, handler);
  const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  return log.exit(new Promise((done) => server.listen(port, host, () => done({ server, url: `${tls === undefined ? 'http' : 'https'}://${shownHost}:${port}/` }))));
}

/**
 * 連携サーバーを起動する。
 * @sideEffect ポートを開き、DB のファイルを開く。SIGINT・SIGTERM で閉じる
 */
async function serve(): Promise<void> {
  const log = logger.fn('serve');
  const options = parseServerArgs(process.argv.slice(2), process.env);
  if (!options.ok) {
    log.error(options.error.message);
    process.exitCode = 2;
    return log.fail(undefined, 'args');
  }
  const { port, host, dbPath, masterDir, staticDir, cmsStaticDir, cmsPort, trustProxy, allowedHosts } = options.value;
  const tls = loadTls(options.value);
  if (tls === null) {
    process.exitCode = 2;
    return log.fail(undefined, 'tls');
  }
  if (!isLoopbackHost(host) && tls === undefined && !trustProxy) {
    log.error('自分の PC 以外に公開するときは、--tls-cert/--tls-key か --trust-proxy が要ります（平文では起動しません）');
    process.exitCode = 2;
    return log.fail(undefined, 'insecure');
  }
  const mode = isDemoBuild ? 'demo' : 'production';
  const app = await createServerApp({
    mode, dbPath, fetchText: nodeFetchText(masterDir), trust: { trustProxy, tls: tls !== undefined }, allowedHosts, separateCms: cmsPort !== undefined,
    ...(staticDir === undefined ? {} : { staticDir }), ...(cmsStaticDir === undefined ? {} : { cmsStaticDir }),
  });
  if (!app.ok) {
    log.error('連携サーバーを準備できませんでした', { code: app.error.code, message: app.error.message });
    process.exitCode = 1;
    return log.fail(undefined, app.error.code);
  }
  const main = await listen(app.value.handler, port, host, tls);
  const cms = app.value.cmsHandler === undefined || cmsPort === undefined ? undefined : await listen(app.value.cmsHandler, cmsPort, host, tls);
  log.info('連携サーバーを起動しました', { url: main.url, cmsUrl: cms?.url ?? '（同じオリジン）', mode, db: dbPath, static: staticDir ?? 'なし', cmsStatic: cmsStaticDir ?? 'なし', trustProxy });
  if (mode === 'demo' && !isLoopbackHost(host)) log.warn('デモ版を LAN に公開しています。デモのログインはこの PC からだけ使えます。発表の場だけで使ってください');
  /** 止めるときに DB・SSE・つながりを閉じる */
  const shutdown = (): void => { // audit-ignore: fnlog-missing 止めるときに1回だけ呼ぶ後始末（serve のログで記録する）
    log.info('連携サーバーを止めます');
    app.value.close();
    for (const { server } of [main, ...(cms === undefined ? [] : [cms])]) {
      server.close();
      server.closeAllConnections();
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return log.exit(undefined);
}

/**
 * 入口（account サブコマンドか、サーバーの起動か）。
 * @sideEffect プロセスの終了コードを決める
 */
async function main(): Promise<void> {
  const log = logger.fn('main', { command: process.argv[2] });
  if (process.argv[2] === 'account') {
    process.exitCode = await runAccountCommand(process.argv.slice(3), process.env, isDemoBuild ? 'demo' : 'production');
    return log.exit(undefined, 'account');
  }
  await serve();
  return log.exit(undefined);
}

void main();
