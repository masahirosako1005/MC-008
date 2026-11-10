/**
 * @file ID トークンの検証のテスト（infrastructure/server/app/oidc 層・テスト。SEC-19）
 * 署名方式ごとの成功と、方式のすり替え・宛先・期限・nonce・改ざんの拒否を確かめる。
 */
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ok } from '@/Common/result/Result';
import { verifyIdToken } from '@/infrastructure/server/app/oidc/idToken';
import type { IdTokenExpectation } from '@/infrastructure/server/app/oidc/idToken';

const NOW_SEC = 1_800_000_000;
const SECRET = 'channel-secret-for-test'; // audit-ignore: secret-pattern テスト用の固定値（本物の秘密ではない）
const CLAIMS = { iss: 'https://issuer.example', aud: 'client-1', sub: 'user-123', nonce: 'nonce-1', exp: NOW_SEC + 300 };

/** テスト用: JWT の区切り */
function seg(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** テスト用: HS256 の JWT */
function hs256(claims: unknown, secret = SECRET, header: unknown = { alg: 'HS256', typ: 'JWT' }): string {
  const input = `${seg(header)}.${seg(claims)}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}

/** テスト用: RS256／ES256 の JWT */
function signed(alg: 'RS256' | 'ES256', key: KeyObject, claims: unknown, kid = 'k1'): string {
  const input = `${seg({ alg, kid })}.${seg(claims)}`;
  const signature = alg === 'RS256' ? sign('RSA-SHA256', Buffer.from(input), key) : sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

/** テスト用: 照らし合わせる値 */
function expectation(over: Partial<IdTokenExpectation> = {}): IdTokenExpectation {
  return {
    issuer: CLAIMS.iss, clientId: CLAIMS.aud, nonce: CLAIMS.nonce, nowSec: NOW_SEC, algs: ['HS256'], hmacSecret: SECRET,
    loadKeys: async () => ok([]), ...over,
  };
}

/** テスト用: 失敗の規則名 */
async function ruleOf(token: string, over: Partial<IdTokenExpectation> = {}): Promise<unknown> {
  const result = await verifyIdToken(token, expectation(over));
  return result.ok ? 'ok' : result.error.details?.['rule'];
}

describe('verifyIdToken', () => {
  it('HS256 の正しいトークンから sub を取り出す', async () => {
    expect(await verifyIdToken(hs256(CLAIMS), expectation())).toEqual({ ok: true, value: 'user-123' });
  });

  it('RS256・ES256 は公開鍵（kid の合うもの）で確かめる', async () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const keys: JsonWebKey[] = [
      { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'k1' },
      { ...other.publicKey.export({ format: 'jwk' }), kid: 'k0' },
      { ...ec.publicKey.export({ format: 'jwk' }), kid: 'k1' },
    ];
    const loadKeys = async () => ok(keys);
    expect(await ruleOf(signed('RS256', rsa.privateKey, CLAIMS), { algs: ['RS256'], loadKeys })).toBe('ok');
    expect(await ruleOf(signed('ES256', ec.privateKey, CLAIMS), { algs: ['ES256'], loadKeys })).toBe('ok');
    expect(await ruleOf(signed('ES256', other.privateKey, CLAIMS), { algs: ['ES256'], loadKeys })).toBe('signature');
  });

  it("設定に無い署名方式・'none' は拒否する（方式のすり替え）", async () => {
    expect(await ruleOf(`${seg({ alg: 'none' })}.${seg(CLAIMS)}.AA`)).toBe('alg');
    expect(await ruleOf(hs256(CLAIMS), { algs: ['RS256'] })).toBe('alg');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(await ruleOf(signed('RS256', rsa.privateKey, CLAIMS))).toBe('alg');
  });

  it('秘密が違う・本体を書き換えたトークンは署名で拒否する', async () => {
    expect(await ruleOf(hs256(CLAIMS, 'another-secret'))).toBe('signature');
    const [head, , signature] = hs256(CLAIMS).split('.');
    expect(await ruleOf(`${head}.${seg({ ...CLAIMS, sub: 'someone-else' })}.${signature}`)).toBe('signature');
  });

  it('発行者・宛先・期限・nonce・sub を確かめる', async () => {
    expect(await ruleOf(hs256({ ...CLAIMS, iss: 'https://evil.example' }))).toBe('iss');
    expect(await ruleOf(hs256({ ...CLAIMS, aud: 'another-client' }))).toBe('aud');
    expect(await ruleOf(hs256({ ...CLAIMS, aud: ['client-1', 'x'] }))).toBe('aud');
    expect(await ruleOf(hs256({ ...CLAIMS, aud: ['client-1', 'x'], azp: 'client-1' }))).toBe('ok');
    expect(await ruleOf(hs256({ ...CLAIMS, exp: NOW_SEC - 61 }))).toBe('exp');
    expect(await ruleOf(hs256({ ...CLAIMS, nonce: 'replayed' }))).toBe('nonce');
    expect(await ruleOf(hs256({ ...CLAIMS, sub: '' }))).toBe('sub');
  });

  it('形の壊れたトークンは拒否する', async () => {
    expect(await ruleOf('abc')).toBe('shape');
    expect(await ruleOf('a.b.c d')).toBe('encoding');
    expect(await ruleOf(`${seg('text')}.${seg(CLAIMS)}.AA`)).toBe('json');
  });
});
