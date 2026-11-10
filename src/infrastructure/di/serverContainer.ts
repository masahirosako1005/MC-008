/**
 * @file 連携サーバーの DI コンテナ（infrastructure/di 層。docs/09 §7.3）
 * マスタを利用者アプリと同じ MasterDataLoader で読み、SQLite を開き、API の一覧と要求ハンドラを組み立てる。
 * - 公開の API（スナップショット・SSE）：どの版でも、どの面でも登録する
 * - 店舗CMS の API・ログインの API：ログインが要る（SEC-01、SEC-03）。本番の版でも出す。デモのやり直し・デモのログインはデモの版だけ
 * - 面（surface）：CMS を利用者アプリと別のオリジン（別ポート）に置くとき、公開の面（アプリ＋公開 API）と CMS の面（CMS＋CMS/ログイン API）に分ける（docs/09 §7.1）
 * CMS のユースケースは 1回の要求ごとに作る（デモの日付のずらし日数と、変更履歴に残す操作者を、その要求の値にするため）。
 */
import type { IncomingMessage, RequestListener } from 'node:http';
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { epochMsOf, instantFromEpochMs } from '@/Common/utils/date';
import type { CmsServices } from '@/application/CmsServices';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import type { PublicCmsSnapshot } from '@/infrastructure/api/schema/publicCmsSnapshot';
import { createAppBackend } from '@/infrastructure/di/appBackend';
import type { AppBackend, AppBackendOptions } from '@/infrastructure/di/appBackend';
import { buildCmsUseCases } from '@/infrastructure/di/cmsUseCases';
import { MasterDataLoader } from '@/infrastructure/master/MasterDataLoader';
import type { FetchText } from '@/infrastructure/master/MasterDataLoader';
import { CryptoIdGenerator } from '@/infrastructure/random/CryptoIdGenerator';
import { AUTH_LOG_RETENTION_MS, AuthService, LOGIN_RATE_LIMIT } from '@/infrastructure/server/auth/AuthService';
import type { Principal } from '@/infrastructure/server/auth/principal';
import type { RequestTrust } from '@/infrastructure/server/auth/requestOrigin';
import { sessionTokenOf } from '@/infrastructure/server/auth/sessionCookie';
import { buildPublicCmsSnapshot } from '@/infrastructure/server/buildPublicCmsSnapshot';
import { authRoutes } from '@/infrastructure/server/http/authRoutes';
import { cmsRoutes } from '@/infrastructure/server/http/cmsRoutes';
import { createApiHandler } from '@/infrastructure/server/http/createApiHandler';
import { FixedWindowRateLimiter } from '@/infrastructure/server/http/FixedWindowRateLimiter';
import type { RateLimitOptions } from '@/infrastructure/server/http/FixedWindowRateLimiter';
import { publicRoutes } from '@/infrastructure/server/http/publicRoutes';
import { SnapshotStream } from '@/infrastructure/server/http/SnapshotStream';
import { createStaticHandler } from '@/infrastructure/server/http/staticFiles';
import type { StaticHandler } from '@/infrastructure/server/http/staticFiles';
import { CmsDatabase } from '@/infrastructure/server/sqlite/CmsDatabase';
import { SqliteAuthStore } from '@/infrastructure/server/sqlite/SqliteAuthStore';
import { SqliteCmsOverlayRepository } from '@/infrastructure/server/sqlite/SqliteCmsOverlayRepository';
import { OffsetClock } from '@/infrastructure/time/OffsetClock';
import { SystemClock } from '@/infrastructure/time/SystemClock';

const logger = createLogger('infrastructure/di/serverContainer');

/** SSE を同時につなげる数（全体・1つの相手ごと）・空のコメントの間隔 */
const STREAM_OPTIONS = { maxClients: 200, maxPerClient: 10, heartbeatMs: 25_000 } as const;
/** 書込系の回数制限（1つの相手につき1分に120回） */
const WRITE_LIMIT: RateLimitOptions = { limit: 120, windowMs: 60_000 };
/** 読取系の回数制限（1つの相手につき1分に600回。SEC-18） */
const READ_LIMIT: RateLimitOptions = { limit: 600, windowMs: 60_000 };
/** 期限切れのセッション・古い記録を掃除する間隔（ミリ秒） */
const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;
/** 何も信じない（中継なし・TLS なし） */
const NO_TRUST: RequestTrust = Object.freeze({ trustProxy: false, tls: false });

/** 連携サーバーの設定 */
export interface ServerAppOptions {
  /** demo: デモの日付・デモのログイン・デモのやり直しを受け付ける／production: 受け付けない */
  readonly mode: 'demo' | 'production';
  /** SQLite のファイル（':memory:' でメモリ上） */
  readonly dbPath: string;
  /** マスタの読み方（nodeFetchText('public/master') など） */
  readonly fetchText: FetchText;
  /** 利用者アプリの画面のフォルダ（指定すると画面も配る） */
  readonly staticDir?: string;
  /** 店舗CMS の画面のフォルダ（本番で別に作ったもの。デモでは staticDir に同居） */
  readonly cmsStaticDir?: string;
  /** CMS を別の面（別ポート）に分けるか（true なら cmsHandler が別にできる） */
  readonly separateCms?: boolean;
  /** X-Forwarded-* を信じるか・TLS か（Cookie の Secure・HSTS・回数制限の鍵に使う） */
  readonly trust?: RequestTrust;
  /** 本番で使うホスト名（localhost・IP 以外で受け付けるもの） */
  readonly allowedHosts?: readonly string[];
  /** 実時刻（エポックミリ秒）。テストで固定する */
  readonly nowMs?: () => number;
  /** 書込系の回数制限（テストで変える） */
  readonly writeLimit?: RateLimitOptions;
  /** 読取系の回数制限（テストで変える） */
  readonly readLimit?: RateLimitOptions;
  /** ログインの試みの回数制限（テストで変える） */
  readonly loginLimit?: RateLimitOptions;
  /** 利用者データのサーバー（PostgreSQL・外部ログイン。docs/12）。省略時は店舗CMS の連携だけ */
  readonly appBackend?: AppBackendOptions;
}

/** 組み立てた連携サーバー */
export interface ServerApp {
  /** 公開の面（separateCms でなければ CMS・ログインの API も含む） */
  readonly handler: RequestListener;
  /** CMS の面（separateCms のときだけ） */
  readonly cmsHandler?: RequestListener;
  readonly db: CmsDatabase;
  /** ログイン・アカウント（コマンドライン・テストから使う） */
  readonly auth: AuthService;
  /** SSE を閉じ、掃除を止め、DB を閉じる */
  close(): void;
}

/** 面（どの API と画面を出すか） */
type Surface = 'all' | 'public' | 'cms';

/** 部品一式 */
interface ServerParts {
  readonly opts: ServerAppOptions;
  readonly spots: SpotRepository;
  readonly db: CmsDatabase;
  readonly stream: SnapshotStream;
  readonly auth: AuthService;
  readonly trust: RequestTrust;
  /** 利用者データのサーバー（指定されたときだけ） */
  readonly appBackend?: AppBackend;
}

/**
 * 実時刻の関数を opts から取り出す（テストで固定する）。
 * @param opts 設定
 * @returns nowMs があればそれを含むオブジェクト
 */
function nowMsOf(opts: ServerAppOptions): { readonly nowMs?: () => number } {
  return opts.nowMs === undefined ? {} : { nowMs: opts.nowMs };
}

/**
 * 1回の要求ごとの保存先を作る。
 * @param parts 部品一式
 * @param actor 変更履歴に残す操作者（ログイン中のアカウントID。公開スナップショットを作るだけなら 'system'）
 * @returns SQLite のリポジトリ
 */
function repositoryOf(parts: ServerParts, actor: string): SqliteCmsOverlayRepository {
  return new SqliteCmsOverlayRepository({ db: parts.db, actor, clock: new OffsetClock({ offsetDays: 0, ...nowMsOf(parts.opts) }) });
}

/**
 * 今の公開スナップショットを作る。
 * @param parts 部品一式
 * @returns 成功: 公開スナップショット。失敗: STORAGE_FAILED
 */
async function currentSnapshot(parts: ServerParts): Promise<Result<PublicCmsSnapshot>> {
  const log = logger.fn('currentSnapshot');
  const loaded = await repositoryOf(parts, 'system').load();
  if (!loaded.ok) return log.fail(loaded);
  const state = parts.db.tryReadState();
  if (!state.ok) return log.fail(state);
  return log.exit(ok(buildPublicCmsSnapshot(loaded.value, state.value)));
}

/**
 * デモの日付のずらし日数と操作者に合わせたユースケース一式を作る。
 * @param parts 部品一式
 * @param offsetDays ずらし日数
 * @param actor 操作者
 * @returns CmsServices
 */
function cmsServicesFor(parts: ServerParts, offsetDays: number, actor: string): CmsServices {
  const log = logger.fn('cmsServicesFor', { offsetDays, actor });
  const clock = new OffsetClock({ offsetDays, ...nowMsOf(parts.opts) });
  return log.exit(buildCmsUseCases({ spots: parts.spots, cmsOverlay: repositoryOf(parts, actor), clock, ids: new CryptoIdGenerator() }));
}

/**
 * 面ごとの画面の配信を作る。
 * @param parts 部品一式
 * @param surface 面
 * @returns 順に試す配信の一覧
 */
function staticHandlersOf(parts: ServerParts, surface: Surface): readonly StaticHandler[] {
  const log = logger.fn('staticHandlersOf', { surface });
  const handlers: StaticHandler[] = [];
  if (surface !== 'cms' && parts.opts.staticDir !== undefined) handlers.push(createStaticHandler(parts.opts.staticDir));
  if (surface !== 'public' && parts.opts.cmsStaticDir !== undefined) handlers.push(createStaticHandler(parts.opts.cmsStaticDir));
  return log.exit(handlers, `count=${handlers.length}`);
}

/**
 * 要求ハンドラを組み立てる。
 * @param parts 部品一式
 * @param surface 面
 * @returns 要求ハンドラ
 */
function buildHandler(parts: ServerParts, surface: Surface): RequestListener {
  const log = logger.fn('buildHandler', { mode: parts.opts.mode, surface });
  const { opts, trust } = parts;
  const routes = [
    ...publicRoutes({ mode: opts.mode, snapshot: () => currentSnapshot(parts), currentMarker: () => parts.db.tryReadState(), stream: parts.stream }),
    ...(surface === 'public' ? [] : cmsRoutes({ mode: opts.mode, servicesFor: (days, actor) => cmsServicesFor(parts, days, actor) })),
    ...(surface === 'public' ? [] : authRoutes({ auth: parts.auth, mode: opts.mode, trust })),
    ...(surface === 'cms' ? [] : parts.appBackend?.routes ?? []),
  ];
  return log.exit(createApiHandler({
    routes,
    writeLimiter: new FixedWindowRateLimiter({ ...(opts.writeLimit ?? WRITE_LIMIT), ...nowMsOf(opts) }),
    readLimiter: new FixedWindowRateLimiter({ ...(opts.readLimit ?? READ_LIMIT), ...nowMsOf(opts) }),
    authenticate: (req: IncomingMessage): Result<Principal | undefined> => parts.auth.authenticate(sessionTokenOf(req)),
    staticHandlers: staticHandlersOf(parts, surface),
    trust,
    ...(opts.allowedHosts === undefined ? {} : { allowedHosts: opts.allowedHosts }),
    hsts: trust.tls || trust.trustProxy,
  }));
}

/**
 * 定期的な掃除（期限切れのセッション・保持期間を過ぎた記録と変更履歴）を1回行う。
 * @param parts 部品一式
 * @sideEffect DB から削除する
 */
function maintain(parts: ServerParts): void {
  const log = logger.fn('maintain');
  const removed = parts.auth.maintain();
  void parts.appBackend?.maintain();
  try {
    const before = instantFromEpochMs(epochMsOf(new SystemClock(parts.opts.nowMs).now()) - AUTH_LOG_RETENTION_MS);
    const audits = parts.db.deleteAuditBefore(before);
    log.exit(undefined, `sessions=${removed.sessions} logs=${removed.logs} audits=${audits}`);
  } catch (error) {
    log.error('変更履歴の掃除で DB の失敗', { message: error instanceof Error ? error.message : 'unknown' });
    log.exit(undefined, 'failed');
  }
}

/**
 * 連携サーバーを組み立てる。
 * @param opts 設定
 * @returns 成功: 要求ハンドラと後始末。失敗: マスタの検証エラー / STORAGE_FAILED
 * @sideEffect DB のファイルを開く（無ければ作る）。掃除のタイマーを登録する（プロセスの終了は妨げない）
 */
export async function createServerApp(opts: ServerAppOptions): Promise<Result<ServerApp>> {
  const log = logger.fn('createServerApp', { mode: opts.mode, static: opts.staticDir !== undefined, separateCms: opts.separateCms === true });
  const master = await MasterDataLoader.load(opts.fetchText);
  if (!master.ok) return log.fail(master);
  const db = CmsDatabase.open(opts.dbPath);
  if (!db.ok) return log.fail(db);
  const auth = new AuthService({
    store: new SqliteAuthStore(db.value), clock: new SystemClock(opts.nowMs), ids: new CryptoIdGenerator(), spots: master.value.spots, mode: opts.mode,
    loginLimiter: new FixedWindowRateLimiter({ ...(opts.loginLimit ?? LOGIN_RATE_LIMIT), ...nowMsOf(opts) }),
  });
  const trust = opts.trust ?? NO_TRUST;
  const appBackend = opts.appBackend === undefined ? undefined : await createAppBackend(opts.appBackend, { mode: opts.mode, clock: new SystemClock(opts.nowMs), spots: master.value.spots, trust, ...nowMsOf(opts) });
  if (appBackend !== undefined && !appBackend.ok) {
    db.value.close();
    return log.fail(appBackend);
  }
  const parts: ServerParts = {
    opts, spots: master.value.spots, db: db.value, stream: new SnapshotStream(STREAM_OPTIONS), auth, trust,
    ...(appBackend === undefined ? {} : { appBackend: appBackend.value }),
  };
  const stopBroadcast = parts.db.onChange((state) => parts.stream.broadcast(state));
  const timer = setInterval(() => maintain(parts), MAINTENANCE_INTERVAL_MS);
  timer.unref();
  maintain(parts);
  return log.exit(ok({
    handler: buildHandler(parts, opts.separateCms === true ? 'public' : 'all'),
    ...(opts.separateCms === true ? { cmsHandler: buildHandler(parts, 'cms') } : {}),
    db: parts.db,
    auth,
    close: () => {
      clearInterval(timer);
      stopBroadcast();
      parts.stream.close();
      parts.db.close();
    },
  }));
}
