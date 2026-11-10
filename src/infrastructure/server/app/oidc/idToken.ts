/**
 * @file ID トークン（JWT）の検証（infrastructure/server/app/oidc 層。docs/12 §5、SEC-19）
 * 外部ログインの相手が発行した ID トークンから、利用者の ID（sub）だけを取り出す。Node 標準の node:crypto だけで検証する。
 * 確かめること：署名（HS256＝クライアントの秘密／RS256・ES256＝相手の公開鍵）、発行者（iss）、宛先（aud・azp）、期限（exp）、nonce。
 * - 受け付ける署名方式は提供元の設定に書いたものだけ（'none' や設定に無い方式は拒否＝方式のすり替え対策）
 * - 失敗の理由は details.rule に規則名だけを入れる。トークン・sub はログにも失敗にも入れない（SEC-25）
 */
import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';

const logger = createLogger('infrastructure/server/app/oidc/idToken');

/** 受け付けられる署名方式 */
export type IdTokenAlg = 'HS256' | 'RS256' | 'ES256';

/** ID トークンの長さの上限（文字） */
const MAX_TOKEN_LENGTH = 16 * 1024;
/** 時計のずれとして許す秒数 */
const CLOCK_SKEW_SEC = 60;
/** sub の長さの上限 */
const MAX_SUBJECT_LENGTH = 255;
/** JWT の1区切りの書式（base64url） */
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 検証で照らし合わせる値 */
export interface IdTokenExpectation {
  /** 発行者（iss） */
  readonly issuer: string;
  /** 自分のクライアントID（aud） */
  readonly clientId: string;
  /** ログインを始めたときに作った nonce */
  readonly nonce: string;
  /** 今の時刻（エポック秒） */
  readonly nowSec: number;
  /** 受け付ける署名方式 */
  readonly algs: readonly IdTokenAlg[];
  /** HS256 の鍵（クライアントの秘密） */
  readonly hmacSecret: string;
  /** RS256・ES256 の公開鍵（JWKS）を読む */
  readonly loadKeys: () => Promise<Result<readonly JsonWebKey[]>>;
}

/** 区切った JWT */
interface JwtParts {
  readonly header: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  /** 署名の対象（ヘッダー.本体） */
  readonly signingInput: string;
  readonly signature: Buffer;
}

/**
 * ログインの失敗を作る（利用者向けの文は理由によらず同じ）。
 * @param rule 破った規則名
 * @returns LOGIN_FAILED の失敗
 */
function rejected(rule: string): Result<never> {
  return fail(AppError.of('LOGIN_FAILED', 'ログインできませんでした。もう一度お試しください', { rule }));
}

/**
 * 値がオブジェクト（配列でない）か。
 * @param value 未検証の値
 * @returns オブジェクトなら true
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * base64url の JSON の区切りを読む。
 * @param segment 区切り
 * @returns オブジェクト（読めなければ undefined）
 */
function decodeJsonSegment(segment: string): Readonly<Record<string, unknown>> | undefined {
  const log = logger.fn('decodeJsonSegment', { length: segment.length });
  const parsed = parseJsonText(Buffer.from(segment, 'base64url').toString('utf8'), 'IdTokenSegment');
  const value = parsed.ok && isRecord(parsed.value) ? parsed.value : undefined;
  log.exit(undefined, value === undefined ? 'unreadable' : 'ok'); // 中身（sub など）はログに出さない
  return value;
}

/**
 * JWT を3つに区切って読む（署名はまだ確かめない）。
 * @param token ID トークン
 * @returns 成功: 区切った JWT。失敗: LOGIN_FAILED
 */
function splitJwt(token: string): Result<JwtParts> {
  const log = logger.fn('splitJwt', { length: token.length });
  const segments = token.split('.');
  const [head, body, sign] = segments;
  if (token.length > MAX_TOKEN_LENGTH || segments.length !== 3 || head === undefined || body === undefined || sign === undefined) return log.fail(rejected('shape'));
  if (![head, body, sign].every((s) => SEGMENT_PATTERN.test(s))) return log.fail(rejected('encoding'));
  const header = decodeJsonSegment(head);
  const payload = decodeJsonSegment(body);
  if (header === undefined || payload === undefined) return log.fail(rejected('json'));
  log.exit(undefined, 'ok'); // 中身（sub など）はログに出さない
  return ok({ header, payload, signingInput: `${head}.${body}`, signature: Buffer.from(sign, 'base64url') });
}

/**
 * HS256 の署名を確かめる。
 * @param parts 区切った JWT
 * @param secret クライアントの秘密
 * @returns 正しければ true
 */
function verifyHmac(parts: JwtParts, secret: string): boolean {
  const log = logger.fn('verifyHmac');
  const expected = createHmac('sha256', secret).update(parts.signingInput).digest();
  return log.exit(secret.length > 0 && expected.length === parts.signature.length && timingSafeEqual(expected, parts.signature));
}

/**
 * 公開鍵 1 つで署名を確かめる（鍵が壊れていれば false）。
 * @param parts 区切った JWT
 * @param alg 署名方式
 * @param jwk 公開鍵
 * @returns 正しければ true
 */
function verifyWithKey(parts: JwtParts, alg: 'RS256' | 'ES256', jwk: JsonWebKey): boolean {
  const log = logger.fn('verifyWithKey', { alg });
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const data = Buffer.from(parts.signingInput);
    const valid = alg === 'RS256'
      ? verify('RSA-SHA256', data, key, parts.signature)
      : verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, parts.signature);
    return log.exit(valid);
  } catch (error) {
    log.warn('公開鍵を使えません', { message: error instanceof Error ? error.message : 'unknown' });
    return log.exit(false);
  }
}

/**
 * その署名方式に使える鍵か（種類と kid）。
 * @param jwk 公開鍵
 * @param alg 署名方式
 * @param kid ヘッダーの kid（無ければ種類だけで選ぶ）
 * @returns 使えるなら true
 */
function isKeyFor(jwk: JsonWebKey, alg: 'RS256' | 'ES256', kid: unknown): boolean { // audit-ignore: fnlog-missing 鍵ごとに呼ぶ小さな判定（verifySignature で記録する）
  const typed = alg === 'RS256' ? jwk.kty === 'RSA' : jwk.kty === 'EC' && jwk.crv === 'P-256';
  return typed && (typeof kid !== 'string' || jwk['kid'] === kid);
}

/**
 * 署名を確かめる。
 * @param parts 区切った JWT
 * @param expect 照らし合わせる値
 * @returns 成功: void。失敗: LOGIN_FAILED（alg・signature・keys）
 */
async function verifySignature(parts: JwtParts, expect: IdTokenExpectation): Promise<Result<void>> {
  const alg = parts.header['alg'];
  const log = logger.fn('verifySignature', { alg });
  const allowed = expect.algs.find((a) => a === alg);
  if (allowed === undefined) return log.fail(rejected('alg'));
  if (allowed === 'HS256') return verifyHmac(parts, expect.hmacSecret) ? log.exit(ok(undefined)) : log.fail(rejected('signature'));
  const keys = await expect.loadKeys();
  if (!keys.ok) return log.fail(rejected('keys'));
  const valid = keys.value.filter((jwk) => isKeyFor(jwk, allowed, parts.header['kid'])).some((jwk) => verifyWithKey(parts, allowed, jwk));
  return valid ? log.exit(ok(undefined)) : log.fail(rejected('signature'));
}

/**
 * 宛先（aud・azp）が自分か。
 * @param payload 本体
 * @param clientId 自分のクライアントID
 * @returns 自分宛てなら true
 */
function isAudience(payload: Readonly<Record<string, unknown>>, clientId: string): boolean { // audit-ignore: fnlog-missing 小さな判定（checkClaims で記録する）
  const aud: unknown = payload['aud'];
  if (aud === clientId) return true;
  if (!Array.isArray(aud) || !aud.includes(clientId)) return false;
  return aud.length === 1 || payload['azp'] === clientId;
}

/**
 * 本体の中身（発行者・宛先・期限・nonce・sub）を確かめる。
 * @param payload 本体
 * @param expect 照らし合わせる値
 * @returns 成功: sub。失敗: LOGIN_FAILED（details.rule に破った規則）
 */
function checkClaims(payload: Readonly<Record<string, unknown>>, expect: IdTokenExpectation): Result<string> {
  const log = logger.fn('checkClaims');
  const { exp, sub } = payload;
  if (payload['iss'] !== expect.issuer) return log.fail(rejected('iss'));
  if (!isAudience(payload, expect.clientId)) return log.fail(rejected('aud'));
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp + CLOCK_SKEW_SEC < expect.nowSec) return log.fail(rejected('exp'));
  if (payload['nonce'] !== expect.nonce) return log.fail(rejected('nonce'));
  if (typeof sub !== 'string' || sub.length === 0 || sub.length > MAX_SUBJECT_LENGTH) return log.fail(rejected('sub'));
  log.exit(undefined, 'ok'); // sub はログに出さない
  return ok(sub);
}

/**
 * ID トークンを検証し、利用者の ID（sub）を返す。
 * @param token ID トークン（相手のトークンの窓口から受け取ったもの）
 * @param expect 照らし合わせる値
 * @returns 成功: sub。失敗: LOGIN_FAILED（details.rule に破った規則）
 */
export async function verifyIdToken(token: string, expect: IdTokenExpectation): Promise<Result<string>> {
  const log = logger.fn('verifyIdToken', { length: token.length });
  const parts = splitJwt(token);
  if (!parts.ok) return log.fail(parts);
  const signed = await verifySignature(parts.value, expect);
  if (!signed.ok) return log.fail(signed);
  const sub = checkClaims(parts.value.payload, expect);
  if (!sub.ok) return log.fail(sub);
  log.exit(undefined, 'ok'); // sub はログに出さない
  return sub;
}
