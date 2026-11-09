/**
 * @file セッションのトークンと Cookie のテスト（SEC-19、SEC-28）
 */
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  expiredSessionCookieOf,
  isSessionToken,
  newSessionToken,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  sessionCookieOf,
  sessionIdOf,
  sessionTokenOf,
} from '@/infrastructure/server/auth/sessionCookie';

/** テスト用: Cookie ヘッダーだけを持つ要求 */
function requestWithCookie(cookie: string | undefined): IncomingMessage {
  return { headers: cookie === undefined ? {} : { cookie } } as unknown as IncomingMessage;
}

describe('sessionCookie', () => {
  it('トークンは base64url の 43 文字で毎回違い、DB には SHA-256 だけを置く', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(isSessionToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(sessionIdOf(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionIdOf(a)).not.toBe(sessionIdOf(b));
    expect(sessionIdOf(a)).toBe(sessionIdOf(a));
  });

  it('Cookie ヘッダーから名前ごとの値を取り出す（同じ名前は最初のもの。壊れた部分は飛ばす）', () => {
    const cookies = parseCookieHeader(' a=1; cms_session=tok; =bad; noeq ; a=2; b=x=y ');
    expect(cookies.get('a')).toBe('1');
    expect(cookies.get('cms_session')).toBe('tok');
    expect(cookies.get('b')).toBe('x=y');
    expect(cookies.has('')).toBe(false);
    expect(parseCookieHeader(undefined).size).toBe(0);
    expect(parseCookieHeader('x'.repeat(9000)).size).toBe(0);
  });

  it('要求からは書式の正しいトークンだけを取り出す', () => {
    const token = newSessionToken();
    expect(sessionTokenOf(requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`))).toBe(token);
    expect(sessionTokenOf(requestWithCookie(`${SESSION_COOKIE_NAME}=short`))).toBeUndefined();
    expect(sessionTokenOf(requestWithCookie(`${SESSION_COOKIE_NAME}=${token}'; DROP`))).toBeUndefined();
    expect(sessionTokenOf(requestWithCookie(undefined))).toBeUndefined();
  });

  it('Set-Cookie は HttpOnly・SameSite=Strict・Path=/api で、https のときだけ Secure', () => {
    const token = newSessionToken();
    const plain = sessionCookieOf(token, { secure: false, maxAgeSec: 43200 });
    expect(plain).toBe(`cms_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=43200`);
    expect(sessionCookieOf(token, { secure: true, maxAgeSec: 43200 })).toContain('; Secure');
    expect(expiredSessionCookieOf(true)).toBe('cms_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0; Secure');
  });
});
