/**
 * @file ログイン・アカウントの API（infrastructure/server/http 層。docs/09 CMS-A04〜A07、§1.2、SEC-19）
 * - ログイン：本文の形を確かめ、AuthService に渡す。成功したら HttpOnly の Cookie にセッションのトークンを入れる
 * - ログアウト・自分のパスワード変更：セッションが要る（createApiHandler が確かめる）
 * - デモのログイン：デモの版だけ。しかも、中継を通らず自分の PC から直接つないできたときだけ受け付ける（requestOrigin.isDirectLoopback）。
 *   LAN に出したとき、同じネットワークの人が運営者になれないようにするため。同じ PC の中継（nginx・ngrok・ポート転送）を通ったものも断る
 * - アカウント管理：運営者だけ（Route.auth='operator'）。操作者はログイン中のアカウントID
 */
import type { IncomingMessage } from 'node:http';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type {
  CmsAccountStatus,
  CmsChangePasswordInput,
  CmsDemoLoginInput,
  CmsLoginInput,
  CmsRole,
  CreateCmsAccountInput,
} from '@/application/dto/CmsAuthDto';
import { AUTH_PATHS } from '@/infrastructure/api/apiAuthRoutes';
import {
  ACCOUNT_SHOPS_BODY_SHAPE,
  ACCOUNT_STATUS_BODY_SHAPE,
  CHANGE_PASSWORD_BODY_SHAPE,
  CREATE_ACCOUNT_BODY_SHAPE,
  DEMO_LOGIN_BODY_SHAPE,
  LOGIN_BODY_SHAPE,
  RESET_PASSWORD_BODY_SHAPE,
} from '@/infrastructure/api/schema/authApiShapes';
import { parseWithShape } from '@/infrastructure/api/schema/shape';
import type { Shape } from '@/infrastructure/api/schema/shape';
import type { AuthService, LoginOutcome } from '@/infrastructure/server/auth/AuthService';
import { principalDtoOf } from '@/infrastructure/server/auth/principal';
import type { Principal } from '@/infrastructure/server/auth/principal';
import { isDirectLoopback, isSecureRequest } from '@/infrastructure/server/auth/requestOrigin';
import type { RequestTrust } from '@/infrastructure/server/auth/requestOrigin';
import { expiredSessionCookieOf, SESSION_TTL_MS, sessionCookieOf } from '@/infrastructure/server/auth/sessionCookie';
import type { Route, RouteContext } from '@/infrastructure/server/http/createApiHandler';
import { readJsonBody, sendResult } from '@/infrastructure/server/http/httpIo';

const logger = createLogger('infrastructure/server/http/authRoutes');

/** ログインの API の依存 */
export interface AuthRouteDeps {
  readonly auth: AuthService;
  readonly mode: 'demo' | 'production';
  /** Cookie に Secure を付けるかの判断に使う */
  readonly trust: RequestTrust;
}

/** アカウントの道筋 */
const ACCOUNT = '^/api/cms/accounts/([A-Za-z0-9_-]{1,80})';

/**
 * 道筋の文字列を、先頭から末尾まで一致させる正規表現にする。
 * @param path 道筋
 * @returns 正規表現
 */
function exactly(path: string): RegExp {
  return new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/**
 * 本文を読み、形を確かめる。
 * @param req 要求
 * @param s 形
 * @param kind 何の本文か
 * @returns 成功: 本文。失敗: UNSUPPORTED_MEDIA_TYPE / PAYLOAD_TOO_LARGE / INVALID_INPUT
 */
async function bodyOf<T>(req: IncomingMessage, s: Shape, kind: string): Promise<Result<T>> {
  const log = logger.fn('bodyOf', { kind });
  const raw = await readJsonBody(req);
  if (!raw.ok) return log.fail(raw);
  const parsed = parseWithShape<T>(raw.value, s, kind);
  return parsed.ok ? log.exit(parsed) : log.fail(parsed);
}

/**
 * ログイン中の人を取り出す（auth のある Route では必ずある）。
 * @param ctx 要求の文脈
 * @returns 成功: Principal。失敗: UNAUTHENTICATED
 */
function principalOf(ctx: RouteContext): Result<Principal> {
  return ctx.principal === undefined ? fail(AppError.of('UNAUTHENTICATED', 'ログインしてください')) : ok(ctx.principal);
}

/**
 * ログインの結果を Cookie と応答にする。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @param outcome ログインの結果
 * @sideEffect Set-Cookie を付けて応答を書き終える
 */
function sendLogin(deps: AuthRouteDeps, ctx: RouteContext, outcome: Result<LoginOutcome>): void {
  const log = logger.fn('sendLogin', { ok: outcome.ok });
  if (outcome.ok) {
    ctx.res.setHeader('Set-Cookie', sessionCookieOf(outcome.value.token, { secure: isSecureRequest(ctx.req, deps.trust), maxAgeSec: SESSION_TTL_MS / 1000 }));
    sendResult(ctx.res, ok(principalDtoOf(outcome.value.principal)));
    return log.exit(undefined);
  }
  sendResult(ctx.res, outcome);
  return log.exit(undefined, outcome.error.code);
}

/**
 * ログインする。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect セッションを作り、Cookie を付ける
 */
async function login(deps: AuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('login');
  const body = await bodyOf<CmsLoginInput>(ctx.req, LOGIN_BODY_SHAPE, 'LoginBody');
  if (!body.ok) return log.exit(sendResult(ctx.res, body), 'body');
  sendLogin(deps, ctx, await deps.auth.login(body.value, ctx.clientKey));
  return log.exit(undefined);
}

/**
 * ログアウトする。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect セッションを取り消し、Cookie を消す
 */
async function logout(deps: AuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('logout');
  const principal = principalOf(ctx);
  if (!principal.ok) return log.exit(sendResult(ctx.res, principal), 'noPrincipal');
  const result = deps.auth.logout(principal.value);
  if (result.ok) ctx.res.setHeader('Set-Cookie', expiredSessionCookieOf(isSecureRequest(ctx.req, deps.trust)));
  sendResult(ctx.res, result);
  return log.exit(undefined);
}

/**
 * 自分のパスワードを変える。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect パスワードを書き換え、ほかの端末のセッションを切る
 */
async function changePassword(deps: AuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('changePassword');
  const principal = principalOf(ctx);
  if (!principal.ok) return log.exit(sendResult(ctx.res, principal), 'noPrincipal');
  const body = await bodyOf<CmsChangePasswordInput>(ctx.req, CHANGE_PASSWORD_BODY_SHAPE, 'ChangePasswordBody');
  if (!body.ok) return log.exit(sendResult(ctx.res, body), 'body');
  sendResult(ctx.res, await deps.auth.changePassword(principal.value, body.value));
  return log.exit(undefined);
}

/**
 * デモのログイン（デモの版・自分の PC からだけ）。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect セッションを作り、Cookie を付ける
 */
async function demoLogin(deps: AuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('demoLogin');
  if (!isDirectLoopback(ctx.req, deps.trust)) {
    log.warn('自分の PC から直接ではないデモのログインを断りました');
    return log.exit(sendResult(ctx.res, fail(AppError.of('FORBIDDEN', 'デモのログインはこの PC からだけ使えます'))), 'remote');
  }
  const body = await bodyOf<CmsDemoLoginInput>(ctx.req, DEMO_LOGIN_BODY_SHAPE, 'DemoLoginBody');
  if (!body.ok) return log.exit(sendResult(ctx.res, body), 'body');
  sendLogin(deps, ctx, deps.auth.demoLogin(body.value));
  return log.exit(undefined);
}

/**
 * アカウントを作る（運営者）。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect cms_accounts に追記する
 */
async function createAccount(deps: AuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('createAccount');
  const principal = principalOf(ctx);
  if (!principal.ok) return log.exit(sendResult(ctx.res, principal), 'noPrincipal');
  const body = await bodyOf<CreateCmsAccountInput & { readonly role: CmsRole }>(ctx.req, CREATE_ACCOUNT_BODY_SHAPE, 'CreateAccountBody');
  if (!body.ok) return log.exit(sendResult(ctx.res, body), 'body');
  sendResult(ctx.res, await deps.auth.createAccount(principal.value.accountId, body.value));
  return log.exit(undefined);
}

/**
 * 担当店舗を変える（運営者）。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect cms_account_shops を書き換える
 */
async function updateShops(deps: AuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('updateShops');
  const principal = principalOf(ctx);
  if (!principal.ok) return log.exit(sendResult(ctx.res, principal), 'noPrincipal');
  const body = await bodyOf<{ readonly shopIds: readonly string[] }>(ctx.req, ACCOUNT_SHOPS_BODY_SHAPE, 'AccountShopsBody');
  if (!body.ok) return log.exit(sendResult(ctx.res, body), 'body');
  sendResult(ctx.res, deps.auth.updateAccountShops(principal.value.accountId, { accountId: ctx.params[0] ?? '', shopIds: body.value.shopIds }));
  return log.exit(undefined);
}

/**
 * 停止・再開する（運営者）。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect cms_accounts・cms_sessions を書き換える
 */
async function setStatus(deps: AuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('setStatus');
  const principal = principalOf(ctx);
  if (!principal.ok) return log.exit(sendResult(ctx.res, principal), 'noPrincipal');
  const body = await bodyOf<{ readonly status: CmsAccountStatus }>(ctx.req, ACCOUNT_STATUS_BODY_SHAPE, 'AccountStatusBody');
  if (!body.ok) return log.exit(sendResult(ctx.res, body), 'body');
  sendResult(ctx.res, deps.auth.setAccountStatus(principal.value.accountId, { accountId: ctx.params[0] ?? '', status: body.value.status }));
  return log.exit(undefined);
}

/**
 * パスワードを設定し直す（運営者）。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect cms_accounts・cms_sessions を書き換える
 */
async function resetPassword(deps: AuthRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('resetPassword');
  const principal = principalOf(ctx);
  if (!principal.ok) return log.exit(sendResult(ctx.res, principal), 'noPrincipal');
  const body = await bodyOf<{ readonly newPassword: string }>(ctx.req, RESET_PASSWORD_BODY_SHAPE, 'ResetPasswordBody');
  if (!body.ok) return log.exit(sendResult(ctx.res, body), 'body');
  sendResult(ctx.res, await deps.auth.resetAccountPassword(principal.value.accountId, { accountId: ctx.params[0] ?? '', newPassword: body.value.newPassword }));
  return log.exit(undefined);
}

/**
 * ログイン・アカウントの API の一覧を作る。
 * @param deps 依存
 * @returns Route の一覧（デモのログインはデモの版だけ）
 */
export function authRoutes(deps: AuthRouteDeps): readonly Route[] {
  const log = logger.fn('authRoutes', { mode: deps.mode });
  const routes: Route[] = [
    { method: 'POST', pattern: exactly(AUTH_PATHS.login), write: true, handle: (ctx) => login(deps, ctx) },
    { method: 'POST', pattern: exactly(AUTH_PATHS.logout), write: true, auth: 'session', handle: (ctx) => logout(deps, ctx) },
    { method: 'GET', pattern: exactly(AUTH_PATHS.me), write: false, auth: 'session', handle: async (ctx) => sendResult(ctx.res, principalOf(ctx).ok ? ok(principalDtoOf(ctx.principal as Principal)) : principalOf(ctx)) },
    { method: 'POST', pattern: exactly(AUTH_PATHS.passwordChange), write: true, auth: 'session', handle: (ctx) => changePassword(deps, ctx) },
    { method: 'GET', pattern: exactly(AUTH_PATHS.accounts), write: false, auth: 'operator', handle: async (ctx) => sendResult(ctx.res, deps.auth.listAccounts()) },
    { method: 'POST', pattern: exactly(AUTH_PATHS.accounts), write: true, auth: 'operator', handle: (ctx) => createAccount(deps, ctx) },
    { method: 'PUT', pattern: new RegExp(`${ACCOUNT}/shops$`), write: true, auth: 'operator', handle: (ctx) => updateShops(deps, ctx) },
    { method: 'PUT', pattern: new RegExp(`${ACCOUNT}/status$`), write: true, auth: 'operator', handle: (ctx) => setStatus(deps, ctx) },
    { method: 'POST', pattern: new RegExp(`${ACCOUNT}/password$`), write: true, auth: 'operator', handle: (ctx) => resetPassword(deps, ctx) },
  ];
  if (deps.mode === 'demo') routes.push({ method: 'POST', pattern: exactly(AUTH_PATHS.demoLogin), write: true, handle: (ctx) => demoLogin(deps, ctx) });
  return log.exit(routes, `count=${routes.length}`);
}
