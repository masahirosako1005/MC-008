/**
 * @file 開発用のにせのログイン提供元（OpenID Connect。infrastructure/server/app/oidc 層。docs/12 §5）
 * LINE・Google の登録が無くても、自分の PC で本物と同じ流れ（同意の画面 → コード → トークンの窓口 → ID トークンの検証）を通せるようにする。
 * - デモの版で、起動時に指定したときだけ登録する。本番の版には入らない（MUST-8、SEC-02）
 * - 中継を通らない自分の PC からの要求だけに応える（LAN には出さない）
 * - 署名の鍵（ES256）は起動のたびに作る。コードは1回だけ・1分で失効。PKCE（S256）を確かめる
 * 相手役なので、ここの検証は本物の提供元がすることの最小限。利用者アプリ側の検証（AppAuthService・idToken）は本物と同じものが動く。
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLogger } from '@/Common/logging/logger';
import type { OidcProviderConfig } from '@/infrastructure/server/app/oidc/OidcClient';
import { randomToken } from '@/infrastructure/server/app/oidc/OidcClient';
import { isDirectLoopback } from '@/infrastructure/server/auth/requestOrigin';
import type { RequestTrust } from '@/infrastructure/server/auth/requestOrigin';
import type { Route, RouteContext } from '@/infrastructure/server/http/createApiHandler';
import { sendFailure, sendJson } from '@/infrastructure/server/http/httpIo';

const logger = createLogger('infrastructure/server/app/oidc/mockOidcProvider');

/** にせの提供元の道筋の頭 */
const MOCK_PATH = '/api/dev-oidc';
/** にせの提供元のクライアントID と秘密（開発用の固定値。本物の秘密ではない） */
const MOCK_CLIENT_ID = 'machiquest-local';
const MOCK_CLIENT_SECRET = 'machiquest-local-dev-only'; // audit-ignore: secret-pattern 開発用のにせの提供元の固定値。本物の秘密ではない（本番の版のファイルにも含まれるが、にせの提供元はデモの版でしか組み立てず、本番は --mock-login で起動しない）
/** 鍵の ID */
const MOCK_KEY_ID = 'mock-es256';
/** コードの有効期間（ミリ秒） */
const CODE_TTL_MS = 60_000;
/** 選べるテスト用の利用者 */
const MOCK_USERS: readonly { readonly id: string; readonly label: string }[] = [
  { id: '1', label: 'テスト冒険者 1' },
  { id: '2', label: 'テスト冒険者 2' },
  { id: '3', label: 'テスト冒険者 3' },
];
/** トークンの窓口が受け取る本文の上限（バイト） */
const MAX_FORM_BYTES = 8 * 1024;
/** 覚えておくコードの数の上限 */
const MAX_PENDING_CODES = 200;

/** 出したコードに結び付けた値 */
interface PendingCode {
  readonly subject: string;
  readonly nonce: string;
  readonly codeChallenge: string;
  readonly expiresAtMs: number;
}

/** にせの提供元の依存 */
export interface MockOidcDeps {
  /** 公開の面のオリジン（自分自身。'http://localhost:8787'） */
  readonly origin: string;
  readonly trust: RequestTrust;
  /** 実時刻（エポックミリ秒） */
  readonly nowMs: () => number;
}

/** にせの提供元 */
export interface MockOidcProvider {
  /** 利用者アプリ側に渡す提供元の設定 */
  readonly config: OidcProviderConfig;
  /** 登録する API */
  readonly routes: readonly Route[];
}

/**
 * JWT の区切りを作る。
 * @param value JSON にする値
 * @returns base64url
 */
function segmentOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * ID トークンを作って署名する（ES256）。
 * @param privateKey 署名の鍵
 * @param claims 本体
 * @returns JWT
 */
function signIdToken(privateKey: KeyObject, claims: Readonly<Record<string, unknown>>): string {
  const log = logger.fn('signIdToken');
  const input = `${segmentOf({ alg: 'ES256', typ: 'JWT', kid: MOCK_KEY_ID })}.${segmentOf(claims)}`;
  const signature = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  log.exit(undefined, 'ok');
  return `${input}.${signature}`;
}

/**
 * フォーム形式の本文を上限つきで読む。
 * @param req 要求
 * @returns 項目（大きすぎれば undefined）
 * @sideEffect 要求のストリームを読む
 */
async function readForm(req: IncomingMessage): Promise<URLSearchParams | undefined> {
  const log = logger.fn('readForm');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer; // node:http の本文は Buffer で届く
    size += part.length;
    if (size > MAX_FORM_BYTES) return log.exit(undefined, 'tooLarge');
    chunks.push(part);
  }
  log.exit(undefined, 'ok'); // 中身（コード・秘密）はログに出さない
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/**
 * 利用者を選ぶ画面（リンクだけの HTML）を書く。値は URL の符号化をして href に入れる。
 * @param res 応答
 * @param query 同意の画面に届いた問い合わせ
 * @sideEffect 応答を書き終える
 */
function sendChooser(res: ServerResponse, query: URLSearchParams): void {
  const log = logger.fn('sendChooser');
  const links = MOCK_USERS.map((user) => {
    const next = new URLSearchParams(query);
    next.set('user', user.id);
    return `<p><a href="${MOCK_PATH}/authorize?${next.toString().replace(/&/g, '&amp;')}">${user.label}</a></p>`;
  }).join('');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>開発用ログイン</title><h1>開発用ログイン</h1>${links}</html>`);
  log.exit(undefined);
}

/**
 * にせの提供元を作る。
 * @param deps オリジン・何を信じるか・時計
 * @returns 提供元の設定と API
 * @sideEffect 署名の鍵を作る
 */
export function createMockOidcProvider(deps: MockOidcDeps): MockOidcProvider { // audit-ignore: long-function 3つの小さなハンドラが鍵とコードの置き場を共有するため1つの関数にまとめている
  const log = logger.fn('createMockOidcProvider');
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const issuer = `${deps.origin}${MOCK_PATH}`;
  const redirectUri = `${deps.origin}/api/app/auth/mock/callback`;
  const pending = new Map<string, PendingCode>();

  /** 自分の PC からの直接の要求でなければ断る */
  const refuseRemote = (ctx: RouteContext): boolean => { // audit-ignore: fnlog-missing 要求ごとの小さな判定（各ハンドラで記録する）
    if (isDirectLoopback(ctx.req, deps.trust)) return false;
    sendFailure(ctx.res, 'FORBIDDEN', '開発用のログインはこの PC からだけ使えます');
    return true;
  };

  /** 同意の画面（利用者を選ばせ、選んだらコードを付けて戻す） */
  const authorize = async (ctx: RouteContext): Promise<void> => {
    const fnLog = logger.fn('authorize');
    if (refuseRemote(ctx)) return fnLog.exit(undefined, 'remote');
    const query = new URL(ctx.req.url ?? '/', 'http://server.invalid').searchParams;
    const state = query.get('state');
    const nonce = query.get('nonce');
    const codeChallenge = query.get('code_challenge');
    const valid = query.get('client_id') === MOCK_CLIENT_ID && query.get('redirect_uri') === redirectUri && query.get('response_type') === 'code'
      && query.get('code_challenge_method') === 'S256' && state !== null && nonce !== null && codeChallenge !== null;
    if (!valid) return fnLog.exit(sendFailure(ctx.res, 'INVALID_INPUT', 'ログインの要求が正しくありません'), 'invalid');
    const user = MOCK_USERS.find((u) => u.id === query.get('user'));
    if (user === undefined) return fnLog.exit(sendChooser(ctx.res, query), 'chooser');
    if (pending.size >= MAX_PENDING_CODES) pending.clear();
    const code = randomToken();
    pending.set(code, { subject: `mock-user-${user.id}`, nonce, codeChallenge, expiresAtMs: deps.nowMs() + CODE_TTL_MS });
    const back = new URL(redirectUri);
    back.searchParams.set('code', code);
    back.searchParams.set('state', state);
    ctx.res.writeHead(302, { Location: back.toString(), 'Cache-Control': 'no-store' });
    ctx.res.end();
    return fnLog.exit(undefined, 'issued');
  };

  /** トークンの窓口（コードと PKCE を確かめて ID トークンを返す） */
  const token = async (ctx: RouteContext): Promise<void> => {
    const fnLog = logger.fn('token');
    if (refuseRemote(ctx)) return fnLog.exit(undefined, 'remote');
    const form = await readForm(ctx.req);
    const code = form?.get('code') ?? '';
    const issued = pending.get(code);
    pending.delete(code);
    const verifier = form?.get('code_verifier') ?? '';
    const valid = form !== undefined && issued !== undefined && issued.expiresAtMs > deps.nowMs()
      && form.get('grant_type') === 'authorization_code' && form.get('client_id') === MOCK_CLIENT_ID && form.get('client_secret') === MOCK_CLIENT_SECRET
      && form.get('redirect_uri') === redirectUri && createHash('sha256').update(verifier, 'ascii').digest('base64url') === issued.codeChallenge;
    if (!valid) return fnLog.exit(sendJson(ctx.res, 400, { error: 'invalid_grant' }), 'invalid');
    const nowSec = Math.floor(deps.nowMs() / 1000);
    const idToken = signIdToken(privateKey, { iss: issuer, aud: MOCK_CLIENT_ID, sub: issued.subject, nonce: issued.nonce, iat: nowSec, exp: nowSec + 300 });
    return fnLog.exit(sendJson(ctx.res, 200, { token_type: 'Bearer', expires_in: 300, id_token: idToken }), 'issued');
  };

  /** 公開鍵（JWKS） */
  const jwks = async (ctx: RouteContext): Promise<void> => { // audit-ignore: fnlog-missing 固定の値を返すだけ
    if (refuseRemote(ctx)) return;
    sendJson(ctx.res, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: MOCK_KEY_ID, use: 'sig', alg: 'ES256' }] });
  };

  return log.exit({
    config: {
      id: 'mock', label: '開発用アカウント', issuer,
      authorizationEndpoint: `${issuer}/authorize`, tokenEndpoint: `${issuer}/token`, jwksUri: `${issuer}/jwks`,
      clientId: MOCK_CLIENT_ID, clientSecret: MOCK_CLIENT_SECRET, algs: ['ES256'],
    },
    routes: [
      { method: 'GET', pattern: /^\/api\/dev-oidc\/authorize$/, write: false, handle: authorize },
      { method: 'POST', pattern: /^\/api\/dev-oidc\/token$/, write: true, handle: token },
      { method: 'GET', pattern: /^\/api\/dev-oidc\/jwks$/, write: false, handle: jwks },
    ],
  });
}
