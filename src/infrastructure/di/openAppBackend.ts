/**
 * @file 起動オプションから利用者データのサーバーの設定を作る（infrastructure/di 層。docs/12 §3）
 * - DATABASE_URL（環境変数だけ。パスワードを含むのでコマンドラインでは受け付けない）：本物の PostgreSQL へ pg でつなぐ。
 *   自分の PC 以外の DB には TLS（--database-ssl）が要る（無ければ起動しない＝SEC-05）
 * - --pglite-dir：自分の PC 用。PGlite（組み込みの PostgreSQL）をそのフォルダに保存して使う（PostgreSQL のインストールが要らない）。
 *   PGlite は開発用の依存なので、node_modules のある場所（自分の PC）でだけ動く。本番のコンテナでは DATABASE_URL を使う
 * - どちらも無ければ undefined（利用者の API を出さない。今までどおり店舗CMS の連携だけ）
 * 外部ログインの秘密は環境変数（OIDC_GOOGLE_CLIENT_ID／_SECRET、OIDC_LINE_CLIENT_ID／_SECRET）からだけ読む（コマンドラインに書かせない＝SEC-11）。
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { AppBackendOptions } from '@/infrastructure/di/appBackend';
import { googleProvider, lineProvider } from '@/infrastructure/server/app/oidc/OidcClient';
import type { OidcProviderConfig } from '@/infrastructure/server/app/oidc/OidcClient';
import { PgSqlClient } from '@/infrastructure/server/pg/PgSqlClient';
import type { SqlClient } from '@/infrastructure/server/pg/SqlClient';
import type { ServerCliOptions } from '@/infrastructure/server/serverOptions';

const logger = createLogger('infrastructure/di/openAppBackend');

/** 環境変数 */
type Env = Readonly<Record<string, string | undefined>>;

/**
 * 環境変数から外部ログインの提供元の設定を作る（ID と秘密の両方があるものだけ）。
 * @param env 環境変数
 * @returns 提供元の設定
 */
export function providersFromEnv(env: Env): readonly OidcProviderConfig[] {
  const log = logger.fn('providersFromEnv');
  const providers: OidcProviderConfig[] = [];
  const googleId = env['OIDC_GOOGLE_CLIENT_ID'];
  const googleSecret = env['OIDC_GOOGLE_CLIENT_SECRET'];
  const lineId = env['OIDC_LINE_CLIENT_ID'];
  const lineSecret = env['OIDC_LINE_CLIENT_SECRET'];
  if (lineId !== undefined && lineId !== '' && lineSecret !== undefined && lineSecret !== '') providers.push(lineProvider(lineId, lineSecret));
  if (googleId !== undefined && googleId !== '' && googleSecret !== undefined && googleSecret !== '') providers.push(googleProvider(googleId, googleSecret));
  log.exit(undefined, `providers=${providers.map((p) => p.id).join(',')}`); // 秘密を含むので中身はログに出さない
  return providers;
}

/**
 * PGlite（自分の PC 用の PostgreSQL）を開く。
 * @param dir データを置くフォルダ
 * @returns 成功: 接続。失敗: STORAGE_FAILED（PGlite が入っていない・フォルダを開けない）
 * @sideEffect フォルダを作り、DB のファイルを開く
 */
async function openPglite(dir: string): Promise<Result<SqlClient>> {
  const log = logger.fn('openPglite');
  try {
    const dataDir = resolve(dir);
    mkdirSync(dataDir, { recursive: true });
    const { PgliteSqlClient } = await import('@/infrastructure/server/pg/testing/PgliteSqlClient');
    return log.exit(ok(await PgliteSqlClient.create(dataDir)));
  } catch (error) {
    log.error('PGlite を開けません（npm ci 済みの場所で起動してください）', { message: error instanceof Error ? error.message : 'unknown' });
    return log.fail(fail(AppError.of('STORAGE_FAILED', '自分の PC 用のデータベースを開けませんでした', undefined, error)));
  }
}

/** 接続文字列の ? 以降で、接続先や TLS の設定を上書きできてしまう項目（pg が読む） */
const OVERRIDING_PARAMS: readonly string[] = ['host', 'hostaddr', 'port', 'ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'];

/**
 * 接続文字列が、? 以降で接続先や TLS を上書きしているか（読めない書式も true＝受け付けない）。
 * URL の本体で自分の PC を指しつつ ?host= で別のサーバーへ向ける・?sslmode=disable で TLS を外す、を防ぐ。
 * @param connectionString 接続文字列
 * @returns 上書きがあれば true
 */
function hasOverridingParams(connectionString: string): boolean { // audit-ignore: fnlog-missing 接続文字列（パスワードを含む）を扱うので記録しない純粋なヘルパー
  if (!URL.canParse(connectionString)) return true;
  const names = [...new URL(connectionString).searchParams.keys()].map((k) => k.toLowerCase());
  return names.some((k) => OVERRIDING_PARAMS.includes(k));
}

/**
 * 接続先が自分の PC（ループバック・UNIX ソケット）か。
 * @param connectionString 接続文字列
 * @returns 自分の PC なら true（読めない書式は false＝TLS を求める）
 */
function isLocalDatabase(connectionString: string): boolean { // audit-ignore: fnlog-missing 接続文字列（パスワードを含む）を扱うので記録しない純粋なヘルパー
  if (!URL.canParse(connectionString)) return false;
  const host = new URL(connectionString).hostname.toLowerCase();
  return host === '' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * 起動オプションから利用者データのサーバーの設定を作る。
 * @param options 起動オプション
 * @param env 環境変数（外部ログインの秘密）
 * @param tls このサーバーが TLS で待ち受けるか（既定のオリジンに使う）
 * @returns 成功: 設定（DB の指定が無ければ undefined）。失敗: STORAGE_FAILED
 * @sideEffect DB への接続を作る（閉じるのは呼び出し側）
 */
export async function openAppBackend(options: ServerCliOptions, env: Env, tls: boolean): Promise<Result<AppBackendOptions | undefined>> {
  const log = logger.fn('openAppBackend', { postgres: options.databaseUrl !== undefined, pglite: options.pgliteDir !== undefined, mockLogin: options.mockLogin });
  if (options.databaseUrl === undefined && options.pgliteDir === undefined) return log.exit(ok(undefined), 'none');
  if (options.databaseUrl !== undefined && hasOverridingParams(options.databaseUrl)) {
    log.error('DATABASE_URL の ? 以降で接続先や TLS を変える指定（host・hostaddr・port・ssl・sslmode など）は受け付けません。接続先は URL の本体に書き、TLS は --database-ssl で指定してください');
    return log.fail(fail(AppError.of('STORAGE_FAILED', 'データベースの接続文字列に受け付けない指定があります')));
  }
  if (options.databaseUrl !== undefined && !options.databaseSsl && !isLocalDatabase(options.databaseUrl)) {
    log.error('自分の PC 以外の PostgreSQL へは TLS でつなぎます。--database-ssl（DATABASE_SSL=1）を付けてください');
    return log.fail(fail(AppError.of('STORAGE_FAILED', 'データベースへの接続に TLS が指定されていません')));
  }
  const sql = options.databaseUrl !== undefined
    ? ok(PgSqlClient.connect({ connectionString: options.databaseUrl, ssl: options.databaseSsl }))
    : await openPglite(options.pgliteDir ?? '');
  if (!sql.ok) return log.fail(sql);
  const origin = options.appOrigin ?? `${tls ? 'https' : 'http'}://localhost:${options.port}`;
  log.exit(undefined, 'ok'); // 接続・秘密を含むので中身はログに出さない
  return ok({ sql: sql.value, origin, providers: providersFromEnv(env), mockLogin: options.mockLogin, demoWalk: options.demoWalk });
}
