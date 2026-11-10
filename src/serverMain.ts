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
import { openAppBackend } from '@/infrastructure/di/openAppBackend';
import { createServerApp } from '@/infrastructure/di/serverContainer';
import { runAccountCommand } from '@/infrastructure/server/cli/accountCommand';
import { nodeFetchText } from '@/infrastructure/server/nodeFetchText';
import { isLoopbackHost, parseServerArgs } from '@/infrastructure/server/serverOptions';
import type { ServerCliOptions } from '@/infrastructure/server/serverOptions';

const logger = createLogger('serverMain');

/** ヘッダーを受け取り終えるまでに待つ時間（ミリ秒） */
const HEADERS_TIMEOUT_MS = 10_000;
/** 要求の全体（本文は 16KB まで）を受け取り終えるまでに待つ時間（ミリ秒） */
const REQUEST_TIMEOUT_MS = 15_000;
/** 使い回すつながりを、次の要求が来ないまま開けておく時間（ミリ秒） */
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
/** 待ち時間の上限を確かめる間隔（ミリ秒） */
const CONNECTIONS_CHECK_INTERVAL_MS = 2_000;
/** TLS の握手を終えるまでに待つ時間（ミリ秒） */
const TLS_HANDSHAKE_TIMEOUT_MS = 10_000;
/** 1つの要求のヘッダーの数の上限 */
const MAX_HEADERS_COUNT = 64;
/** 1つの待ち受けが同時に持つつながりの上限（SSE の上限 200 本＋通常の要求の分） */
const MAX_CONNECTIONS = 1_000;

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
  // connectionsCheckingInterval：待ち時間の上限を確かめる間隔（既定の 30 秒だと、上限を過ぎても最大 30 秒つながったまま）。handshakeTimeout：TLS の握手を終えないつながりを切る
  const server = tls === undefined
    ? createHttpServer({ connectionsCheckingInterval: CONNECTIONS_CHECK_INTERVAL_MS }, handler)
    : createHttpsServer({ cert: tls.cert, key: tls.key, connectionsCheckingInterval: CONNECTIONS_CHECK_INTERVAL_MS, handshakeTimeout: TLS_HANDSHAKE_TIMEOUT_MS }, handler);
  // 遅い送信でつながりを占有されないように、待つ時間とつながりの数に上限を置く（SEC-18。SSE は応答を開いたままにするだけなので影響しない）
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.maxHeadersCount = MAX_HEADERS_COUNT;
  server.maxConnections = MAX_CONNECTIONS;
  const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  return log.exit(new Promise((done) => server.listen(port, host, () => done({ server, url: `${tls === undefined ? 'http' : 'https'}://${shownHost}:${port}/` }))));
}

/**
 * 起動してはいけない設定を見つける（平文での公開、本番での開発用ログイン）。
 * @param options 起動の設定
 * @param tls TLS の証明書と鍵（無ければ undefined）
 * @returns 起動できない理由（ログ用の文と短い名前）。問題が無ければ undefined
 */
function startupProblem(options: ServerCliOptions, tls: TlsMaterial | undefined): { readonly message: string; readonly reason: string } | undefined {
  const log = logger.fn('startupProblem');
  if (!isLoopbackHost(options.host) && tls === undefined && !options.trustProxy) {
    return log.exit({ message: '自分の PC 以外に公開するときは、--tls-cert/--tls-key か --trust-proxy が要ります（平文では起動しません）', reason: 'insecure' });
  }
  if (!isDemoBuild && options.mockLogin) {
    return log.exit({ message: '--mock-login（開発用ログイン）は本番の版では使えません。オプションを外してください', reason: 'mockLoginInProduction' });
  }
  return log.exit(undefined);
}

/**
 * 起動はできるが気をつける設定を、警告として記録する（中継の後ろの平文、デモ版の LAN 公開）。
 * @param options 起動の設定
 * @param tls TLS の証明書と鍵（無ければ undefined）
 * @sideEffect 警告のログを出す
 */
function warnRiskySetup(options: ServerCliOptions, tls: TlsMaterial | undefined): void {
  const log = logger.fn('warnRiskySetup');
  const open = !isLoopbackHost(options.host);
  if (open && tls === undefined && options.trustProxy) {
    log.warn('中継の後ろで平文（http）で待ち受けます。中継以外からこのポートに届かないこと（ファイアウォール・内部ネットワーク）を確かめてください');
  }
  if (isDemoBuild && open) log.warn('デモ版を LAN に公開しています。デモのログインはこの PC からだけ使えます。発表の場だけで使ってください');
  log.exit(undefined);
}

/**
 * SIGINT・SIGTERM で後始末をしてから止まるようにする。
 * @param servers 待ち受けているサーバー
 * @param closeResources DB・SSE などを閉じる処理
 * @sideEffect プロセスのシグナルに1回だけの処理を登録する
 */
function closeOnSignal(servers: readonly Server[], closeResources: () => void): void {
  const log = logger.fn('closeOnSignal', { servers: servers.length });
  /** 止めるときに DB・SSE・つながりを閉じる */
  const shutdown = (): void => { // audit-ignore: fnlog-missing 止めるときに1回だけ呼ぶ後始末
    log.info('連携サーバーを止めます');
    closeResources();
    for (const server of servers) {
      server.close();
      server.closeAllConnections();
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  log.exit(undefined);
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
  const { port, host, dbPath, masterDir, staticDir, cmsStaticDir, cmsPort, trustProxy, proxyHops, allowedHosts } = options.value;
  const tls = loadTls(options.value);
  if (tls === null) {
    process.exitCode = 2;
    return log.fail(undefined, 'tls');
  }
  const problem = startupProblem(options.value, tls);
  if (problem !== undefined) {
    log.error(problem.message);
    process.exitCode = 2;
    return log.fail(undefined, problem.reason);
  }
  warnRiskySetup(options.value, tls);
  const mode = isDemoBuild ? 'demo' : 'production';
  const appBackend = await openAppBackend(options.value, process.env, tls !== undefined);
  if (!appBackend.ok) {
    log.error('利用者データのデータベースを準備できませんでした', { code: appBackend.error.code, message: appBackend.error.message });
    process.exitCode = 1;
    return log.fail(undefined, appBackend.error.code);
  }
  const app = await createServerApp({
    mode, dbPath, fetchText: nodeFetchText(masterDir), trust: { trustProxy, tls: tls !== undefined, proxyHops }, allowedHosts, separateCms: cmsPort !== undefined,
    ...(staticDir === undefined ? {} : { staticDir }), ...(cmsStaticDir === undefined ? {} : { cmsStaticDir }),
    ...(appBackend.value === undefined ? {} : { appBackend: appBackend.value }),
  });
  if (!app.ok) {
    log.error('連携サーバーを準備できませんでした', { code: app.error.code, message: app.error.message });
    process.exitCode = 1;
    void appBackend.value?.sql.close();
    return log.fail(undefined, app.error.code);
  }
  const main = await listen(app.value.handler, port, host, tls);
  const cms = app.value.cmsHandler === undefined || cmsPort === undefined ? undefined : await listen(app.value.cmsHandler, cmsPort, host, tls);
  log.info('連携サーバーを起動しました', { url: main.url, cmsUrl: cms?.url ?? '（同じオリジン）', mode, db: dbPath, static: staticDir ?? 'なし', cmsStatic: cmsStaticDir ?? 'なし', trustProxy,
    appBackend: appBackend.value === undefined ? 'なし' : options.value.pgliteDir !== undefined ? 'PGlite（自分の PC 用）' : 'PostgreSQL', appOrigin: appBackend.value?.origin ?? 'なし',
  });
  closeOnSignal([main.server, ...(cms === undefined ? [] : [cms.server])], () => {
    app.value.close();
    void appBackend.value?.sql.close();
  });
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

// 取りこぼした失敗は、記録してから終了コード 1 で止める（中途半端な状態で動き続けない。再起動は systemd・コンテナに任せる）
for (const event of ['unhandledRejection', 'uncaughtException'] as const) {
  process.on(event, (error: unknown) => {
    logger.fn(event).error('取りこぼした失敗で止まります', { message: error instanceof Error ? error.message : 'unknown' });
    process.exit(1);
  });
}

void main();
