/**
 * @file 外部ログインの相手（OpenID Connect の提供元）とのやり取り（infrastructure/server/app/oidc 層。docs/12 §5）
 * 認可コード＋PKCE。サーバーが相手のトークンの窓口と話し、端末には相手のトークンを渡さない。
 * - 要求するのは 'openid' だけ（メール・氏名・写真を受け取らない＝PRV-06）
 * - 相手の URL は設定に書いたものだけ（外から来た URL へはつながない＝SSRF 対策）。応答は時間切れと大きさの上限つきで読む
 * - コード・トークン・秘密はログに出さない（SEC-25）
 */
import { createHash, randomBytes } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';
import type { IdTokenAlg } from '@/infrastructure/server/app/oidc/idToken';

const logger = createLogger('infrastructure/server/app/oidc/OidcClient');

/** 相手の応答を待つ時間の上限（ミリ秒） */
const FETCH_TIMEOUT_MS = 5_000;
/** 相手の応答の大きさの上限（文字） */
const MAX_RESPONSE_LENGTH = 64 * 1024;
/** 公開鍵（JWKS）を覚えておく時間（ミリ秒） */
const JWKS_CACHE_MS = 60 * 60 * 1000;
/** 提供元の ID の書式 */
export const PROVIDER_ID_PATTERN = /^[a-z]{2,16}$/;

/** 提供元の設定 */
export interface OidcProviderConfig {
  /** 提供元の ID（'line'・'google'・'mock'。道筋と DB に使う） */
  readonly id: string;
  /** 画面に出す名前 */
  readonly label: string;
  /** 発行者（ID トークンの iss） */
  readonly issuer: string;
  /** 同意の画面の URL */
  readonly authorizationEndpoint: string;
  /** トークンの窓口の URL */
  readonly tokenEndpoint: string;
  /** 公開鍵（JWKS）の URL */
  readonly jwksUri: string;
  readonly clientId: string;
  /** クライアントの秘密（環境変数から。ログに出さない） */
  readonly clientSecret: string;
  /** 受け付ける ID トークンの署名方式 */
  readonly algs: readonly IdTokenAlg[];
}

/** fetch の形（テストで差し替える） */
export type FetchFn = (url: string, init: { readonly method: string; readonly headers?: Readonly<Record<string, string>>; readonly body?: string; readonly signal: AbortSignal }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}>;

/**
 * 相手とのやり取りの失敗を作る（利用者向けの文は理由によらず同じ）。
 * @param rule 失敗した手順
 * @returns LOGIN_FAILED の失敗
 */
function providerFailed(rule: string): Result<never> {
  return fail(AppError.of('LOGIN_FAILED', 'ログインできませんでした。もう一度お試しください', { rule }));
}

/**
 * 推測できない乱数の文字列（state・nonce・PKCE の検証子）を作る。
 * @returns base64url の 43 文字
 * @sideEffect 乱数を使う
 */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * PKCE のチャレンジ（検証子の SHA-256）を作る。
 * @param codeVerifier 検証子
 * @returns base64url のチャレンジ
 */
export function codeChallengeOf(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

/** 同意の画面へ送るときの値 */
export interface AuthorizationRequest {
  /** 戻り先（相手に登録したものと同じ） */
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
}

/**
 * 同意の画面の URL を作る。
 * @param config 提供元の設定
 * @param request 戻り先・state・nonce・PKCE のチャレンジ
 * @returns URL
 */
export function authorizationUrlOf(config: OidcProviderConfig, request: AuthorizationRequest): string {
  const log = logger.fn('authorizationUrlOf', { provider: config.id });
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', request.redirectUri);
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('state', request.state);
  url.searchParams.set('nonce', request.nonce);
  url.searchParams.set('code_challenge', request.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  log.exit(undefined, 'ok'); // state・nonce を含むのでログに出さない
  return url.toString();
}

/**
 * 相手の応答（JSON のオブジェクト）を、時間切れと大きさの上限つきで読む。
 * @param fetchFn fetch
 * @param url 設定に書いた URL
 * @param init 方法・ヘッダー・本文
 * @returns 成功: JSON のオブジェクト（未検証）。失敗: LOGIN_FAILED
 * @sideEffect 相手へつなぐ
 */
async function fetchJsonObject(fetchFn: FetchFn, url: string, init: { readonly method: string; readonly headers?: Readonly<Record<string, string>>; readonly body?: string }): Promise<Result<Readonly<Record<string, unknown>>>> {
  const log = logger.fn('fetchJsonObject', { method: init.method });
  try {
    const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const text = await response.text();
    if (!response.ok) {
      log.warn('相手が失敗を返しました', { status: response.status });
      return log.fail(providerFailed('status'));
    }
    const parsed = text.length > MAX_RESPONSE_LENGTH ? undefined : parseJsonText(text, 'OidcResponse');
    const value: unknown = parsed?.ok === true ? parsed.value : undefined;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return log.fail(providerFailed('body'));
    log.exit(undefined, 'ok'); // 中身（トークン）はログに出さない
    return ok(value as Readonly<Record<string, unknown>>); // オブジェクトと確認済み。項目は呼び出し側が検証する
  } catch (error) {
    log.error('相手につながりません', { message: error instanceof Error ? error.message : 'unknown' });
    return log.fail(providerFailed('network'));
  }
}

/** コードの交換に使う値 */
export interface CodeExchange {
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}

/**
 * 認可コードを ID トークンに交換する。
 * @param config 提供元の設定
 * @param exchange コード・戻り先・PKCE の検証子
 * @param fetchFn fetch
 * @returns 成功: ID トークン（未検証。verifyIdToken にかける）。失敗: LOGIN_FAILED
 * @sideEffect 相手のトークンの窓口へつなぐ
 */
export async function exchangeCode(config: OidcProviderConfig, exchange: CodeExchange, fetchFn: FetchFn): Promise<Result<string>> {
  const log = logger.fn('exchangeCode', { provider: config.id });
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: exchange.code,
    redirect_uri: exchange.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: exchange.codeVerifier,
  }).toString();
  const response = await fetchJsonObject(fetchFn, config.tokenEndpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body,
  });
  if (!response.ok) return log.fail(response);
  const idToken = response.value['id_token'];
  if (typeof idToken !== 'string' || idToken.length === 0) return log.fail(providerFailed('idToken'));
  log.exit(undefined, 'ok'); // トークンはログに出さない
  return ok(idToken);
}

/** 相手の公開鍵（JWKS）を読んで覚えておく */
export class JwksCache {
  private readonly cached = new Map<string, { readonly keys: readonly JsonWebKey[]; readonly at: number }>();

  /**
   * 作る。
   * @param fetchFn fetch
   * @param nowMs 実時刻（エポックミリ秒）
   */
  constructor(private readonly fetchFn: FetchFn, private readonly nowMs: () => number) {}

  /**
   * 提供元の公開鍵を返す（1時間は覚えたものを使う）。
   * @param config 提供元の設定
   * @returns 成功: 公開鍵の一覧。失敗: LOGIN_FAILED
   * @sideEffect 相手の JWKS の URL へつなぐ
   */
  async keysOf(config: OidcProviderConfig): Promise<Result<readonly JsonWebKey[]>> {
    const log = logger.fn('keysOf', { provider: config.id });
    const hit = this.cached.get(config.id);
    if (hit !== undefined && this.nowMs() - hit.at < JWKS_CACHE_MS) return log.exit(ok(hit.keys), 'cached');
    const response = await fetchJsonObject(this.fetchFn, config.jwksUri, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) return log.fail(response);
    const raw: unknown = response.value['keys'];
    if (!Array.isArray(raw)) return log.fail(providerFailed('jwks'));
    const items: readonly unknown[] = raw;
    const keys = items.filter((k): k is JsonWebKey => typeof k === 'object' && k !== null && typeof (k as { kty?: unknown }).kty === 'string');
    this.cached.set(config.id, { keys, at: this.nowMs() });
    return log.exit(ok(keys), `keys=${keys.length}`);
  }
}

/**
 * Google の設定を作る。
 * @param clientId クライアントID
 * @param clientSecret クライアントの秘密
 * @returns 提供元の設定
 */
export function googleProvider(clientId: string, clientSecret: string): OidcProviderConfig { // audit-ignore: fnlog-missing 設定の値を並べるだけ（秘密をログに出さない）
  return {
    id: 'google', label: 'Google', issuer: 'https://accounts.google.com',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    clientId, clientSecret, algs: ['RS256'],
  };
}

/**
 * LINE ログインの設定を作る（ウェブのログインの ID トークンはチャネルの秘密による HS256）。
 * @param clientId チャネルID
 * @param clientSecret チャネルの秘密
 * @returns 提供元の設定
 */
export function lineProvider(clientId: string, clientSecret: string): OidcProviderConfig { // audit-ignore: fnlog-missing 設定の値を並べるだけ（秘密をログに出さない）
  return {
    id: 'line', label: 'LINE', issuer: 'https://access.line.me',
    authorizationEndpoint: 'https://access.line.me/oauth2/v2.1/authorize',
    tokenEndpoint: 'https://api.line.me/oauth2/v2.1/token',
    jwksUri: 'https://api.line.me/oauth2/v2.1/certs',
    clientId, clientSecret, algs: ['HS256', 'ES256'],
  };
}
