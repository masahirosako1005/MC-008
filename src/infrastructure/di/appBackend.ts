/**
 * @file 利用者データのサーバー（商用版）の組み立て（infrastructure/di 層。docs/12 §3）
 * PostgreSQL の形を今の版まで進め、利用者のログイン（外部ログイン）と、発見・訪問・状態の API を組み立てる。serverContainer が公開の面にだけ足す
 * （CMS の面には出さない）。PostgreSQL の指定が無いサーバーでは呼ばれず、今までどおり店舗CMS の連携だけが動く。
 * にせの提供元（開発用ログイン）はデモの版で、指定されたときだけ足す（MUST-8）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { epochMsOf } from '@/Common/utils/date';
import type { Clock } from '@/domain/ports/Clock';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import { buildAppPlayServices, ensureServerTraveler } from '@/infrastructure/di/appPlay';
import { appAuthRoutes } from '@/infrastructure/server/app/appAuthRoutes';
import { AppAuthService } from '@/infrastructure/server/app/AppAuthService';
import { appPlayRoutes } from '@/infrastructure/server/app/appPlayRoutes';
import { createMockOidcProvider } from '@/infrastructure/server/app/oidc/mockOidcProvider';
import type { FetchFn, OidcProviderConfig } from '@/infrastructure/server/app/oidc/OidcClient';
import { PgAppAuthStore } from '@/infrastructure/server/app/PgAppAuthStore';
import type { RequestTrust } from '@/infrastructure/server/auth/requestOrigin';
import type { Route } from '@/infrastructure/server/http/createApiHandler';
import { FixedWindowRateLimiter } from '@/infrastructure/server/http/FixedWindowRateLimiter';
import type { RateLimitOptions } from '@/infrastructure/server/http/FixedWindowRateLimiter';
import { sendFailure, sendResult } from '@/infrastructure/server/http/httpIo';
import { migrate } from '@/infrastructure/server/pg/migrations';
import { PgPointLedgerRepository } from '@/infrastructure/server/pg/PgPointLedgerRepository';
import { PgTravelerRepository } from '@/infrastructure/server/pg/PgTravelerRepository';
import { ScopedSqlClient } from '@/infrastructure/server/pg/ScopedSqlClient';
import type { SqlClient } from '@/infrastructure/server/pg/SqlClient';

const logger = createLogger('infrastructure/di/appBackend');

/** ログインの開始・戻りの回数制限（1つの相手につき1分に30回。SEC-18） */
export const APP_LOGIN_RATE_LIMIT: RateLimitOptions = { limit: 30, windowMs: 60_000 };

/** 利用者データのサーバーの設定（createServerApp の appBackend） */
export interface AppBackendOptions {
  /** PostgreSQL への接続（閉じるのは渡した側） */
  readonly sql: SqlClient;
  /** 公開の面のオリジン（'http://localhost:8787'・'https://app.example.jp'。戻り先 URL と、ログイン後に戻る先） */
  readonly origin: string;
  /** 外部ログインの提供元（LINE・Google。秘密は環境変数から読んだもの） */
  readonly providers: readonly OidcProviderConfig[];
  /** にせの提供元（開発用ログイン）を足すか。デモの版でだけ効く */
  readonly mockLogin?: boolean;
  /**
   * 地図タップの移動（デモの歩行。徒歩より速い）からの訪問を受け付ける＝移動の妥当性を確かめない。自分の PC 用（scripts/dev/app-local.mjs）。
   * 開発用ログインを出しているとき（デモの版で mockLogin）だけ効く。本番の版では効かない（SEC-24、DI-14 を外さない）。
   */
  readonly demoWalk?: boolean;
  /** fetch（テストで差し替える。省略時は Node の fetch） */
  readonly fetchFn?: FetchFn;
  /** ログインの回数制限（テストで変える） */
  readonly loginLimit?: RateLimitOptions;
}

/** 組み立ての依存（serverContainer が渡す） */
export interface AppBackendDeps {
  readonly mode: 'demo' | 'production';
  readonly clock: Clock;
  /** スポットのマスタ（距離の判定に使う） */
  readonly spots: SpotRepository;
  readonly trust: RequestTrust;
  /** 実時刻（エポックミリ秒。テストで固定する） */
  readonly nowMs?: () => number;
}

/** 組み立てた利用者データのサーバー */
export interface AppBackend {
  /** 公開の面に足す API */
  readonly routes: readonly Route[];
  readonly auth: AppAuthService;
  /** 定期的な掃除（失効したセッション・ログイン途中の値） */
  maintain(): Promise<void>;
}

/**
 * Node の fetch を FetchFn の形にする。
 * @returns FetchFn
 */
function nodeFetch(): FetchFn {
  return (url, init) => fetch(url, { method: init.method, signal: init.signal, ...(init.headers === undefined ? {} : { headers: init.headers }), ...(init.body === undefined ? {} : { body: init.body }) });
}

/**
 * DB につながるかを返す API（監視用）。
 * @param sql PostgreSQL への接続
 * @returns Route
 */
function healthRoute(sql: SqlClient): Route {
  return {
    method: 'GET', pattern: /^\/api\/app\/health$/, write: false,
    /** DB に1回問い合わせて結果を返す */
    handle: async (ctx) => {
      const log = logger.fn('health');
      try {
        await sql.query('SELECT 1');
        return log.exit(sendResult(ctx.res, ok({ status: 'ok', database: 'ok' })));
      } catch (error) {
        log.error('DB につながりません', { message: error instanceof Error ? error.message : 'unknown' });
        return log.exit(sendFailure(ctx.res, 'STORAGE_FAILED', 'データベースにつながりません'), 'failed');
      }
    },
  };
}

/**
 * 利用者データのサーバーを組み立てる。
 * @param options 接続・オリジン・提供元
 * @param deps 版（デモ／本番）・時計・何を信じるか
 * @returns 成功: API と掃除。失敗: STORAGE_FAILED（DB の準備）/ INVALID_INPUT（提供元が1つも無い）
 * @sideEffect DB の形を今の版まで進める
 */
export async function createAppBackend(options: AppBackendOptions, deps: AppBackendDeps): Promise<Result<AppBackend>> {
  const log = logger.fn('createAppBackend', { mode: deps.mode, providers: options.providers.length, mockLogin: options.mockLogin === true });
  const migrated = await migrate(options.sql);
  if (!migrated.ok) return log.fail(migrated);
  /** サーバーの時計の今（エポックミリ秒） */
  const nowMs = (): number => epochMsOf(deps.clock.now());
  const mock = deps.mode === 'demo' && options.mockLogin === true ? createMockOidcProvider({ origin: options.origin, trust: deps.trust, nowMs }) : undefined;
  const providers = [...options.providers, ...(mock === undefined ? [] : [mock.config])];
  if (providers.length === 0) return log.fail(fail(AppError.of('INVALID_INPUT', '外部ログインの提供元が1つも設定されていません')));
  const auth = new AppAuthService({ store: new PgAppAuthStore(options.sql), clock: deps.clock, providers, origin: options.origin, fetchFn: options.fetchFn ?? nodeFetch() });
  const loginLimiter = new FixedWindowRateLimiter({ ...(options.loginLimit ?? APP_LOGIN_RATE_LIMIT), ...(deps.nowMs === undefined ? {} : { nowMs: deps.nowMs }) });
  const scoped = new ScopedSqlClient(options.sql);
  const play = { travelers: new PgTravelerRepository(scoped), ledgers: new PgPointLedgerRepository(scoped), spots: deps.spots, clock: deps.clock };
  const routes = [
    healthRoute(options.sql),
    ...appAuthRoutes({ auth, origin: options.origin, trust: deps.trust, loginLimiter }),
    ...appPlayRoutes({
      auth,
      ensureTraveler: (travelerId) => ensureServerTraveler(play.travelers, travelerId),
      findLedger: (travelerId) => play.ledgers.find(travelerId),
      playFor: (travelerId, position) => buildAppPlayServices(play, travelerId, position),
      atomically: (travelerId, work) => scoped.atomically(travelerId, work),
      spots: deps.spots,
      clock: deps.clock,
      skipMoveCheck: mock !== undefined && options.demoWalk === true,
    }),
    ...(mock?.routes ?? []),
  ];
  return log.exit(ok({
    routes,
    auth,
    /** 失効したセッション・ログイン途中の値を消す */
    maintain: async (): Promise<void> => {
      await auth.maintain();
    },
  }), `routes=${routes.length} schema=${migrated.value.to}`);
}
