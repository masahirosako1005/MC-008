/**
 * @file 利用者のログインの API（infrastructure/server/app 層。docs/12 §5・§6 段階1）
 *
 * | 方法と道筋 | 内容 |
 * |---|---|
 * | GET /api/app/auth/providers | 使える提供元の一覧 |
 * | GET /api/app/auth/<提供元>/start | ログインを始める（相手の同意の画面へ移動） |
 * | GET /api/app/auth/<提供元>/callback | 相手からの戻り（セッションの Cookie を出してアプリへ移動） |
 * | POST /api/app/auth/logout | ログアウト |
 * | GET /api/app/me | ログイン中の利用者（未ログインは 401） |
 *
 * 利用者のセッションは非同期（PostgreSQL）で確かめるので、createApiHandler の auth（店舗CMS 用・同期）は使わず、ここで確かめる。
 * 戻り先はいつも設定のオリジン（要求の値で移動先を決めない＝オープンリダイレクト対策）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { AppAuthService, AppPrincipal } from '@/infrastructure/server/app/AppAuthService';
import { LOGIN_STATE_TTL_MS } from '@/infrastructure/server/app/AppAuthService';
import { appCookieOf, appCookieTokenOf } from '@/infrastructure/server/app/appSessionCookie';
import { isSecureRequest } from '@/infrastructure/server/auth/requestOrigin';
import type { RequestTrust } from '@/infrastructure/server/auth/requestOrigin';
import type { Route, RouteContext } from '@/infrastructure/server/http/createApiHandler';
import type { FixedWindowRateLimiter } from '@/infrastructure/server/http/FixedWindowRateLimiter';
import { sendFailure, sendResult } from '@/infrastructure/server/http/httpIo';

const logger = createLogger('infrastructure/server/app/appAuthRoutes');

/** ログインの API の依存 */
export interface AppAuthRouteDeps {
  readonly auth: AppAuthService;
  /** アプリの画面のオリジン（ログインの後に戻る先） */
  readonly origin: string;
  readonly trust: RequestTrust;
  /** ログインの開始・戻りの回数制限（1つの相手ごと） */
  readonly loginLimiter: FixedWindowRateLimiter;
}

/**
 * 別の URL へ移動させる応答を書く。
 * @param res 応答
 * @param location 移動先
 * @param cookies 付ける Set-Cookie
 * @sideEffect 応答を書き終える
 */
function redirect(res: ServerResponse, location: string, cookies: readonly string[]): void {
  const log = logger.fn('redirect', { cookies: cookies.length });
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(cookies.length > 0 ? { 'Set-Cookie': [...cookies] } : {}) });
  res.end();
  log.exit(undefined);
}

/**
 * 要求の URL から問い合わせの値を読む。
 * @param req 要求
 * @param name 名前
 * @returns 値（無ければ undefined）
 */
function queryOf(req: IncomingMessage, name: string): string | undefined {
  return new URL(req.url ?? '/', 'http://server.invalid').searchParams.get(name) ?? undefined;
}

/**
 * ログイン中の利用者を確かめる（未ログイン・失敗なら応答を書いて undefined）。段階2以降の API もこれを使う。
 * @param ctx 要求の文脈
 * @param auth ログイン
 * @returns ログイン中の利用者（応答済みなら undefined）
 * @sideEffect 断るときは応答を書き終える
 */
export async function requireAppPrincipal(ctx: RouteContext, auth: AppAuthService): Promise<AppPrincipal | undefined> {
  const log = logger.fn('requireAppPrincipal');
  const resolved = await auth.authenticate(appCookieTokenOf(ctx.req, 'session'));
  if (!resolved.ok) {
    sendResult(ctx.res, resolved);
    return log.exit(undefined, 'unavailable');
  }
  if (resolved.value === undefined) sendFailure(ctx.res, 'UNAUTHENTICATED', 'ログインしてください');
  log.exit(undefined, resolved.value === undefined ? 'unauthenticated' : 'ok');
  return resolved.value;
}

/**
 * ログインを始める（state の Cookie を出して、相手の同意の画面へ移動）。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect 応答を書き終える。DB にログイン途中の値を書く
 */
async function handleStart(deps: AppAuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('handleStart', { provider: ctx.params[0] });
  if (!deps.loginLimiter.tryTake(ctx.clientKey)) return log.exit(sendFailure(ctx.res, 'RATE_LIMITED', '操作が多すぎます。少し待ってからお試しください'), 'rateLimited');
  const started = await deps.auth.startLogin(ctx.params[0] ?? '');
  if (!started.ok) return log.exit(sendResult(ctx.res, started), started.error.code);
  const cookie = appCookieOf('login', started.value.state, { secure: isSecureRequest(ctx.req, deps.trust), maxAgeSec: LOGIN_STATE_TTL_MS / 1000 });
  return log.exit(redirect(ctx.res, started.value.url, [cookie]));
}

/**
 * 相手からの戻りを処理する（成功ならセッションの Cookie を出す。どちらでもアプリへ移動）。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect 応答を書き終える。DB に利用者・セッションを書く
 */
async function handleCallback(deps: AppAuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('handleCallback', { provider: ctx.params[0] });
  const secure = isSecureRequest(ctx.req, deps.trust);
  const clearLogin = appCookieOf('login', '', { secure, maxAgeSec: 0 });
  if (!deps.loginLimiter.tryTake(ctx.clientKey)) return log.exit(redirect(ctx.res, `${deps.origin}/?login=failed`, [clearLogin]), 'rateLimited');
  const done = await deps.auth.completeLogin(ctx.params[0] ?? '', {
    code: queryOf(ctx.req, 'code'), state: queryOf(ctx.req, 'state'), cookieState: appCookieTokenOf(ctx.req, 'login'),
  });
  if (!done.ok) {
    log.warn('ログインに失敗（SEC-24）', { code: done.error.code, rule: done.error.details?.['rule'] });
    return log.exit(redirect(ctx.res, `${deps.origin}/?login=failed`, [clearLogin]), 'failed');
  }
  const session = appCookieOf('session', done.value.token, { secure, maxAgeSec: done.value.maxAgeSec });
  return log.exit(redirect(ctx.res, `${deps.origin}/?login=ok`, [session, clearLogin]), 'ok');
}

/**
 * ログアウトする。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect 応答を書き終える。DB からセッションを削除する
 */
async function handleLogout(deps: AppAuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('handleLogout');
  const result = await deps.auth.logout(appCookieTokenOf(ctx.req, 'session'));
  ctx.res.setHeader('Set-Cookie', appCookieOf('session', '', { secure: isSecureRequest(ctx.req, deps.trust), maxAgeSec: 0 }));
  return log.exit(sendResult(ctx.res, result.ok ? ok({ loggedOut: true }) : result));
}

/**
 * ログイン中の利用者を返す。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect 応答を書き終える
 */
async function handleMe(deps: AppAuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('handleMe');
  const principal = await requireAppPrincipal(ctx, deps.auth);
  if (principal === undefined) return log.exit(undefined, 'unauthenticated');
  const providers = await deps.auth.linkedProviders(principal);
  return log.exit(sendResult(ctx.res, providers.ok ? ok({ travelerId: principal.travelerId, providers: providers.value }) : providers));
}

/**
 * 利用者のログインの API の一覧を作る。
 * @param deps 依存
 * @returns Route の一覧
 */
export function appAuthRoutes(deps: AppAuthRouteDeps): readonly Route[] {
  const log = logger.fn('appAuthRoutes', { providers: deps.auth.providers().length });
  return log.exit([
    { method: 'GET', pattern: /^\/api\/app\/auth\/providers$/, write: false, handle: async (ctx) => sendResult(ctx.res, ok({ providers: deps.auth.providers() })) },
    { method: 'GET', pattern: /^\/api\/app\/auth\/([a-z]{2,16})\/start$/, write: false, handle: (ctx) => handleStart(deps, ctx) },
    { method: 'GET', pattern: /^\/api\/app\/auth\/([a-z]{2,16})\/callback$/, write: false, handle: (ctx) => handleCallback(deps, ctx) },
    { method: 'POST', pattern: /^\/api\/app\/auth\/logout$/, write: true, handle: (ctx) => handleLogout(deps, ctx) },
    { method: 'GET', pattern: /^\/api\/app\/me$/, write: false, handle: (ctx) => handleMe(deps, ctx) },
  ]);
}
