/**
 * @file セッションのトークンと Cookie（infrastructure/server/auth 層。SEC-19、SEC-28）
 * - トークン：32 バイトの暗号学的乱数（base64url）。ブラウザには Cookie でだけ渡す
 * - DB にはトークンそのものではなく SHA-256 を保存する（DB が漏れてもセッションを乗っ取れない）
 * - Cookie：HttpOnly・SameSite=Strict・Path=/api（画面の配信には送らない）。https か、TLS を終端する中継の後ろでは Secure
 * 有効期限は「ログインから 12 時間」と「最後の操作から 60 分」の短い方（CMS-A06）。
 */
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('infrastructure/server/auth/sessionCookie');

/** Cookie の名前 */
export const SESSION_COOKIE_NAME = 'cms_session';
/** Cookie を送る道筋（API だけ） */
export const SESSION_COOKIE_PATH = '/api';
/** ログインからの有効期間（ミリ秒。12 時間） */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** 最後の操作からの有効期間（ミリ秒。60 分） */
export const SESSION_IDLE_MS = 60 * 60 * 1000;

/** トークンの長さ（バイト）と、base64url にしたときの書式 */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Cookie ヘッダーの長さの上限（それより長いものは読まない） */
const MAX_COOKIE_HEADER_LENGTH = 8 * 1024;

/**
 * 新しいセッションのトークンを作る。
 * @returns base64url の 43 文字
 * @sideEffect 乱数を使う
 */
export function newSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * トークンから DB に保存するセッション ID（SHA-256 の16進）を作る。
 * @param token トークン
 * @returns 64 文字の16進
 */
export function sessionIdOf(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * トークンの書式か確かめる。
 * @param raw 未検証の値
 * @returns base64url の 43 文字なら true
 */
export function isSessionToken(raw: unknown): raw is string {
  return typeof raw === 'string' && TOKEN_PATTERN.test(raw);
}

/**
 * Cookie ヘッダーを名前 → 値に分ける（同じ名前は最初のものを使う。値の復号はしない）。
 * @param header Cookie ヘッダー
 * @returns 名前 → 値
 */
export function parseCookieHeader(header: string | undefined): ReadonlyMap<string, string> {
  const log = logger.fn('parseCookieHeader', { length: header?.length ?? 0 });
  const cookies = new Map<string, string>();
  if (header === undefined || header.length > MAX_COOKIE_HEADER_LENGTH) return log.exit(cookies, 'none');
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name.length > 0 && !cookies.has(name)) cookies.set(name, part.slice(eq + 1).trim());
  }
  return log.exit(cookies, `count=${cookies.size}`);
}

/**
 * 要求からセッションのトークンを取り出す。
 * @param req 要求
 * @returns トークン（無い・書式が違うときは undefined）
 */
export function sessionTokenOf(req: IncomingMessage): string | undefined {
  const log = logger.fn('sessionTokenOf');
  const raw = parseCookieHeader(req.headers.cookie).get(SESSION_COOKIE_NAME);
  return log.exit(isSessionToken(raw) ? raw : undefined, raw === undefined ? 'none' : 'found');
}

/** Cookie の付け方 */
export interface SessionCookieOptions {
  /** https のときだけ送る印（Secure）を付けるか */
  readonly secure: boolean;
  /** 有効期間（秒） */
  readonly maxAgeSec: number;
}

/**
 * セッションの Cookie（Set-Cookie の値）を作る。
 * @param token トークン
 * @param opts Secure・有効期間
 * @returns Set-Cookie の値
 */
export function sessionCookieOf(token: string, opts: SessionCookieOptions): string {
  const log = logger.fn('sessionCookieOf', { secure: opts.secure, maxAgeSec: opts.maxAgeSec });
  const parts = [`${SESSION_COOKIE_NAME}=${token}`, `Path=${SESSION_COOKIE_PATH}`, 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`];
  if (opts.secure) parts.push('Secure');
  return log.exit(parts.join('; '));
}

/**
 * セッションの Cookie を消す Set-Cookie の値を作る（ログアウト）。
 * @param secure Secure を付けるか（付けたときと同じにする）
 * @returns Set-Cookie の値
 */
export function expiredSessionCookieOf(secure: boolean): string {
  return sessionCookieOf('', { secure, maxAgeSec: 0 });
}
