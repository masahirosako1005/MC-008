/**
 * @file 連携サーバーの要求の振り分け（infrastructure/server/http 層。docs/09 §7.3）
 * - /api/ で始まる要求：Host が localhost・IP アドレス・運用で決めた名前のものだけ受け付ける（DNS リバインディング対策）。
 *   道筋と方法で Route を選ぶ。書込系は「同じオリジンか」と「回数制限」を先に確かめる（SEC-28, SEC-18）。読取系にも回数制限をかける。
 *   ログインが要る Route は、Cookie のセッションからログイン中の人を決め、無ければ 401、ロールが足りなければ 403（SEC-01, SEC-03）
 * - それ以外：画面のフォルダが指定されていれば配る（1つのオリジンで画面と API を配る）
 * - https のときは、名前でつながる相手に HSTS を付ける（localhost・IP には付けない＝ほかの開発サーバーを巻き込まない。SEC-05）
 * 想定外の例外はここで受け止め、中身を出さずに 500 を返す（OWASP A10）。
 */
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { createLogger } from '@/Common/logging/logger';
import type { Result } from '@/Common/result/Result';
import { API_PREFIX } from '@/infrastructure/api/apiRoutes';
import type { Principal } from '@/infrastructure/server/auth/principal';
import { clientAddressOf } from '@/infrastructure/server/auth/requestOrigin';
import type { RequestTrust } from '@/infrastructure/server/auth/requestOrigin';
import type { FixedWindowRateLimiter } from '@/infrastructure/server/http/FixedWindowRateLimiter';
import { hostNameOf, isAllowedHost, isSameOrigin, sendFailure, sendResult } from '@/infrastructure/server/http/httpIo';
import type { StaticHandler } from '@/infrastructure/server/http/staticFiles';

const logger = createLogger('infrastructure/server/http/createApiHandler');

/** HSTS の値（1年。サブドメインも） */
const HSTS_VALUE = 'max-age=31536000; includeSubDomains';
/** 何も信じない（中継なし・TLS なし） */
const NO_TRUST: RequestTrust = Object.freeze({ trustProxy: false, tls: false });

/** Route に必要なログイン（無ければ誰でも使える） */
export type RouteAuth = 'session' | 'operator';

/** 1つの要求の文脈 */
export interface RouteContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  /** 道筋の正規表現で取り出した値（スポットID など。未検証） */
  readonly params: readonly string[];
  /** 相手の識別子（IP アドレス。回数制限の鍵） */
  readonly clientKey: string;
  /** ログイン中の人（auth のある Route では必ずある） */
  readonly principal?: Principal;
}

/** 1つの API */
export interface Route {
  readonly method: 'GET' | 'POST' | 'PUT';
  /** 道筋（先頭から末尾まで一致させる正規表現） */
  readonly pattern: RegExp;
  /** 書込系か（同じオリジンの確認と書込系の回数制限をかける） */
  readonly write: boolean;
  /** 必要なログイン（'session'：ログイン中なら誰でも／'operator'：運営者だけ） */
  readonly auth?: RouteAuth;
  /** 処理して応答を書き終える */
  readonly handle: (ctx: RouteContext) => Promise<void>;
}

/** 振り分けの依存 */
export interface ApiHandlerDeps {
  readonly routes: readonly Route[];
  /** 書込系の回数制限 */
  readonly writeLimiter: FixedWindowRateLimiter;
  /** 読取系の回数制限（省略時はかけない） */
  readonly readLimiter?: FixedWindowRateLimiter;
  /** Cookie からログイン中の人を決める（省略時は auth のある Route がすべて 401） */
  readonly authenticate?: (req: IncomingMessage) => Result<Principal | undefined>;
  /** 画面を配る関数（順に試す。省略時は API だけ） */
  readonly staticHandlers?: readonly StaticHandler[];
  /** X-Forwarded-* を信じるか・TLS か */
  readonly trust?: RequestTrust;
  /** 本番で使うホスト名（localhost・IP 以外で受け付けるもの） */
  readonly allowedHosts?: readonly string[];
  /** HSTS を付けるか（https で配るとき） */
  readonly hsts?: boolean;
}

/**
 * 要求の URL からパスを取り出す。
 * @param url 要求の URL（'/api/cms/shops?x=1' など）
 * @returns パス（読めなければ '/'）
 */
function pathnameOf(url: string | undefined): string {
  const log = logger.fn('pathnameOf');
  try {
    return log.exit(new URL(url ?? '/', 'http://server.invalid').pathname);
  } catch {
    log.warn('URL を読めません');
    return log.exit('/');
  }
}

/**
 * Host が名前（localhost・IP アドレス以外）か。HSTS を付けてよい相手の判定に使う。
 * @param req 要求
 * @returns 名前なら true
 */
function isNamedHost(req: IncomingMessage): boolean { // audit-ignore: fnlog-missing 要求ごとに呼ぶ小さな判定（handleRequest で記録する）
  const name = hostNameOf(req);
  return name !== undefined && name !== 'localhost' && isIP(name) === 0;
}

/**
 * 同じオリジンか・回数制限の中かを確かめる（断ったら応答を書いて false）。
 * @param deps 依存
 * @param route 選んだ Route
 * @param ctx 要求の文脈
 * @returns 通してよければ true
 * @sideEffect 断るときは応答を書き終える
 */
function passGuards(deps: ApiHandlerDeps, route: Route, ctx: Omit<RouteContext, 'params'>): boolean {
  const log = logger.fn('passGuards', { write: route.write });
  if (route.write && !isSameOrigin(ctx.req)) {
    log.warn('ほかのオリジンからの書き込みを断りました');
    sendFailure(ctx.res, 'FORBIDDEN_ORIGIN', 'この画面からは保存できません');
    return log.exit(false, 'origin');
  }
  const limiter = route.write ? deps.writeLimiter : deps.readLimiter;
  if (limiter !== undefined && !limiter.tryTake(ctx.clientKey)) {
    log.warn('要求の回数が多すぎるため断りました', { write: route.write });
    sendFailure(ctx.res, 'RATE_LIMITED', '操作が多すぎます。少し待ってからお試しください');
    return log.exit(false, 'rateLimited');
  }
  return log.exit(true);
}

/**
 * Route に必要なログインを確かめ、ログイン中の人を返す（断ったら応答を書く）。
 * @param deps 依存
 * @param route 選んだ Route
 * @param ctx 要求の文脈
 * @returns ok: 通してよい（principal はログイン中の人。auth の無い Route では undefined）／ok でなければ応答済み
 * @sideEffect 断るときは応答を書き終える
 */
function resolvePrincipal(deps: ApiHandlerDeps, route: Route, ctx: Omit<RouteContext, 'params'>): { readonly ok: true; readonly principal?: Principal } | { readonly ok: false } {
  const log = logger.fn('resolvePrincipal', { auth: route.auth });
  if (route.auth === undefined) return log.exit({ ok: true });
  const resolved = deps.authenticate?.(ctx.req);
  if (resolved === undefined || !resolved.ok) {
    if (resolved === undefined) sendFailure(ctx.res, 'UNAUTHENTICATED', 'ログインしてください');
    else sendResult(ctx.res, resolved);
    return log.exit({ ok: false }, 'unavailable');
  }
  const principal = resolved.value;
  if (principal === undefined) {
    sendFailure(ctx.res, 'UNAUTHENTICATED', 'ログインしてください');
    return log.exit({ ok: false }, 'unauthenticated');
  }
  if (route.auth === 'operator' && principal.role !== 'operator') {
    log.warn('運営者だけの操作を店舗のアカウントが呼びました（SEC-03）', { accountId: principal.accountId });
    sendFailure(ctx.res, 'FORBIDDEN', 'この操作は運営者だけができます');
    return log.exit({ ok: false }, 'forbidden');
  }
  return log.exit({ ok: true, principal }, principal.role);
}

/**
 * API の要求を Route に振り分ける。
 * @param deps 依存
 * @param ctx 要求と応答
 * @param pathname パス
 * @sideEffect 応答を書き終える
 */
async function dispatch(deps: ApiHandlerDeps, ctx: Omit<RouteContext, 'params'>, pathname: string): Promise<void> {
  const log = logger.fn('dispatch', { method: ctx.req.method, pathname });
  const matched = deps.routes.flatMap((route) => {
    const m = route.pattern.exec(pathname);
    return m === null ? [] : [{ route, params: m.slice(1) }];
  });
  if (matched.length === 0) return log.exit(sendFailure(ctx.res, 'NOT_FOUND', 'API が見つかりません'), 'notFound');
  const hit = matched.find((m) => m.route.method === ctx.req.method);
  if (hit === undefined) {
    ctx.res.setHeader('Allow', [...new Set(matched.map((m) => m.route.method))].join(', '));
    return log.exit(sendFailure(ctx.res, 'METHOD_NOT_ALLOWED', 'この方法では使えません'), 'method');
  }
  if (!passGuards(deps, hit.route, ctx)) return log.exit(undefined, 'guard');
  const resolved = resolvePrincipal(deps, hit.route, ctx);
  if (!resolved.ok) return log.exit(undefined, 'auth');
  await hit.route.handle({ ...ctx, params: hit.params, ...(resolved.principal === undefined ? {} : { principal: resolved.principal }) });
  return log.exit(undefined);
}

/**
 * 1つの要求を処理する。
 * @param deps 依存
 * @param req 要求
 * @param res 応答
 * @sideEffect 応答を書き終える
 */
async function handleRequest(deps: ApiHandlerDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const log = logger.fn('handleRequest', { method: req.method });
  const pathname = pathnameOf(req.url);
  try {
    if (deps.hsts === true && isNamedHost(req)) res.setHeader('Strict-Transport-Security', HSTS_VALUE);
    if (pathname.startsWith(API_PREFIX)) {
      if (!isAllowedHost(req, deps.allowedHosts)) {
        log.warn('許可していない名前での要求を断りました（DNS リバインディング対策）', { pathname });
        return log.exit(sendFailure(res, 'FORBIDDEN_HOST', 'このアドレスからは使えません'), 'host');
      }
      await dispatch(deps, { req, res, clientKey: clientAddressOf(req, deps.trust ?? NO_TRUST) }, pathname);
      if (pathname.startsWith('/api/cms/') || pathname.startsWith('/api/auth/') || res.statusCode >= 400) log.info('API', { method: req.method, pathname, status: res.statusCode });
      return log.exit(undefined);
    }
    for (const serve of deps.staticHandlers ?? []) {
      if (await serve(req, res, pathname)) return log.exit(undefined, 'static');
    }
    return log.exit(sendFailure(res, 'NOT_FOUND', 'ページが見つかりません'), 'notFound');
  } catch (error) {
    log.error('要求の処理で例外', { pathname, message: error instanceof Error ? error.message : 'unknown' });
    return log.exit(sendFailure(res, 'INTERNAL', 'サーバーで問題が起きました'));
  }
}

/**
 * node:http の要求ハンドラを作る。
 * @param deps API の一覧・回数制限・ログイン・画面の配信
 * @returns 要求ハンドラ
 */
export function createApiHandler(deps: ApiHandlerDeps): RequestListener {
  const log = logger.fn('createApiHandler', { routes: deps.routes.length, static: deps.staticHandlers?.length ?? 0, auth: deps.authenticate !== undefined });
  return log.exit((req, res) => void handleRequest(deps, req, res));
}
