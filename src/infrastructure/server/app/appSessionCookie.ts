/**
 * @file 利用者のセッションと、ログイン途中の state の Cookie（infrastructure/server/app 層。docs/12 §5、SEC-19、SEC-28）
 * - app_session：セッションのトークン。HttpOnly・SameSite=Strict・Path=/api。https では Secure
 * - app_login：ログイン途中の state。HttpOnly・SameSite=Lax・Path=/api/app/auth・10分。
 *   相手（LINE・Google）からの戻りは「ほかのサイトからの移動」なので、Strict だと送られない。Lax にする
 * 店舗CMS の Cookie（cms_session）とは名前を分ける。トークンはログに出さない。
 */
import type { IncomingMessage } from 'node:http';
import { createLogger } from '@/Common/logging/logger';
import { isSessionToken, parseCookieHeader } from '@/infrastructure/server/auth/sessionCookie';

const logger = createLogger('infrastructure/server/app/appSessionCookie');

/** セッションの Cookie の名前 */
export const APP_SESSION_COOKIE = 'app_session';
/** ログイン途中の state の Cookie の名前 */
export const APP_LOGIN_COOKIE = 'app_login';
/** セッションの Cookie を送る道筋 */
const SESSION_PATH = '/api';
/** ログイン途中の Cookie を送る道筋 */
const LOGIN_PATH = '/api/app/auth';

/** Cookie の種類 */
type CookieKind = 'session' | 'login';

/** Cookie の付け方 */
export interface AppCookieOptions {
  /** https のときだけ送る印（Secure）を付けるか */
  readonly secure: boolean;
  /** 有効期間（秒。0 で消す） */
  readonly maxAgeSec: number;
}

/**
 * 要求から、その種類の Cookie のトークンを取り出す。
 * @param req 要求
 * @param kind 種類
 * @returns トークン（無い・書式が違うときは undefined）
 */
export function appCookieTokenOf(req: IncomingMessage, kind: CookieKind): string | undefined {
  const log = logger.fn('appCookieTokenOf', { kind });
  const raw = parseCookieHeader(req.headers.cookie).get(kind === 'session' ? APP_SESSION_COOKIE : APP_LOGIN_COOKIE);
  const token = isSessionToken(raw) ? raw : undefined;
  log.exit(undefined, token === undefined ? 'none' : 'found'); // トークンはログに出さない
  return token;
}

/**
 * Set-Cookie の値を作る。
 * @param kind 種類
 * @param token トークン（消すときは空文字）
 * @param opts Secure・有効期間
 * @returns Set-Cookie の値
 */
export function appCookieOf(kind: CookieKind, token: string, opts: AppCookieOptions): string {
  const log = logger.fn('appCookieOf', { kind, secure: opts.secure, maxAgeSec: opts.maxAgeSec });
  const parts = kind === 'session'
    ? [`${APP_SESSION_COOKIE}=${token}`, `Path=${SESSION_PATH}`, 'HttpOnly', 'SameSite=Strict']
    : [`${APP_LOGIN_COOKIE}=${token}`, `Path=${LOGIN_PATH}`, 'HttpOnly', 'SameSite=Lax'];
  parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`);
  if (opts.secure) parts.push('Secure');
  log.exit(undefined, 'ok'); // トークンを含むのでログに出さない
  return parts.join('; ');
}
