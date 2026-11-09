/**
 * @file パスワードのハッシュ化と照合（infrastructure/server/auth 層。SEC-19）
 * Node 標準の scrypt を使う（依存パッケージを増やさない＝U1。OWASP Password Storage Cheat Sheet の scrypt の推奨値 N=2^15・r=8・p=3）。
 * 保存する文字列は 'scrypt$N$r$p$<salt>$<key>'（salt・key は base64url）。引数を一緒に残すので、後で強くしても古いものを照合できる。
 * 照合は長さの等しいバイト列を timingSafeEqual で比べる。知らない ID でも同じ計算をして、応答時間で ID の有無が分からないようにする。
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { codePointLength, hasControlChars } from '@/Common/utils/guards';

const logger = createLogger('infrastructure/server/auth/passwordHash');

/** パスワードの長さ（文字数。コードポイントで数える） */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** パスワードでは入れないアカウント（デモのアカウント）のしるし */
export const UNUSABLE_PASSWORD_HASH = '!';

/** scrypt の引数 */
interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

/** 今の引数（OWASP の推奨の1つ。メモリ約 32MiB） */
const CURRENT_PARAMS: ScryptParams = Object.freeze({ N: 1 << 15, r: 8, p: 3 });
/** 導出する鍵の長さ（バイト） */
const KEY_LENGTH = 32;
/** salt の長さ（バイト） */
const SALT_LENGTH = 16;
/** scrypt に許すメモリ（バイト。128 × N × r より大きくする） */
const MAX_MEMORY = 128 * 1024 * 1024;
/** 引数の上限（保存された値が壊れていても、巨大な計算をしない） */
const MAX_N = 1 << 20;
const MAX_R_P = 32;
/** 知らない ID のときに使う固定の salt（時間をそろえるためだけ。鍵は使わない） */
const DUMMY_SALT = Buffer.alloc(SALT_LENGTH, 7);

/**
 * scrypt で鍵を導出する。
 * @param password パスワード（NFC 正規化済み）
 * @param salt salt
 * @param params 引数
 * @returns 導出した鍵
 */
function deriveKey(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const log = logger.fn('deriveKey', { N: params.N, r: params.r, p: params.p });
  return log.exit(new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: params.N, r: params.r, p: params.p, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  }));
}

/**
 * 新しいパスワードの決まりを確かめ、NFC に正規化して返す（DI-17）。
 * @param raw 入力されたパスワード
 * @returns 成功: 正規化したパスワード。失敗: INVALID_INPUT（details.field='password'）
 */
export function validateNewPassword(raw: unknown): Result<string> {
  const log = logger.fn('validateNewPassword');
  if (typeof raw !== 'string') return log.fail(fail(AppError.of('INVALID_INPUT', 'パスワードを入力してください', { field: 'password' })));
  const password = raw.normalize('NFC');
  const length = codePointLength(password);
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    return log.fail(fail(AppError.of('INVALID_INPUT', `パスワードは${PASSWORD_MIN_LENGTH}〜${PASSWORD_MAX_LENGTH}文字にしてください`, { field: 'password', min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })));
  }
  if (hasControlChars(password) || password.trim().length === 0) {
    return log.fail(fail(AppError.of('INVALID_INPUT', 'パスワードに使えない文字があります', { field: 'password' })));
  }
  return log.exit(ok(password));
}

/**
 * パスワードをハッシュ化して、保存する文字列にする。
 * @param password パスワード（validateNewPassword を通したもの）
 * @returns 'scrypt$N$r$p$<salt>$<key>'
 * @sideEffect 乱数で salt を作る
 */
export async function hashPassword(password: string): Promise<string> {
  const log = logger.fn('hashPassword');
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password.normalize('NFC'), salt, CURRENT_PARAMS);
  const { N, r, p } = CURRENT_PARAMS;
  return log.exit(`scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`);
}

/** 保存された文字列を分けたもの */
interface StoredHash {
  readonly params: ScryptParams;
  readonly salt: Buffer;
  readonly key: Buffer;
}

/**
 * 保存された文字列を分ける。
 * @param stored 保存された文字列
 * @returns 分けたもの（形が違えば undefined）
 */
function parseStoredHash(stored: string): StoredHash | undefined {
  const log = logger.fn('parseStoredHash');
  const [scheme, rawN, rawR, rawP, rawSalt, rawKey, ...rest] = stored.split('$');
  if (scheme !== 'scrypt' || rest.length > 0 || rawSalt === undefined || rawKey === undefined) return log.exit(undefined, 'format');
  const [N, r, p] = [Number(rawN), Number(rawR), Number(rawP)];
  const isPowerOfTwo = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0;
  if (!isPowerOfTwo || N > MAX_N || !Number.isInteger(r) || r < 1 || r > MAX_R_P || !Number.isInteger(p) || p < 1 || p > MAX_R_P) return log.exit(undefined, 'params');
  const salt = Buffer.from(rawSalt, 'base64url');
  const key = Buffer.from(rawKey, 'base64url');
  if (salt.length < 8 || key.length !== KEY_LENGTH) return log.exit(undefined, 'length');
  return log.exit({ params: { N, r, p }, salt, key });
}

/**
 * パスワードが保存された文字列と合うか確かめる。
 * 合わないとき・形が壊れているとき・パスワードでは入れないアカウントのときも、同じ計算をしてから false を返す（応答時間をそろえる）。
 * @param password 入力されたパスワード
 * @param stored 保存された文字列（UNUSABLE_PASSWORD_HASH なら常に false）
 * @returns 合えば true
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const log = logger.fn('verifyPassword', { usable: stored !== UNUSABLE_PASSWORD_HASH });
  const parsed = stored === UNUSABLE_PASSWORD_HASH ? undefined : parseStoredHash(stored);
  const normalized = password.normalize('NFC');
  if (parsed === undefined) {
    await deriveKey(normalized, DUMMY_SALT, CURRENT_PARAMS);
    return log.exit(false, 'noHash');
  }
  const key = await deriveKey(normalized, parsed.salt, parsed.params);
  return log.exit(key.length === parsed.key.length && timingSafeEqual(key, parsed.key));
}

/**
 * 保存された文字列が今の引数より弱いか（ログイン成功時にかけ直す目安）。
 * @param stored 保存された文字列
 * @returns 今の引数と違えば true（壊れている・パスワードでは入れないものは false）
 */
export function needsRehash(stored: string): boolean {
  const log = logger.fn('needsRehash');
  const parsed = stored === UNUSABLE_PASSWORD_HASH ? undefined : parseStoredHash(stored);
  if (parsed === undefined) return log.exit(false);
  const { N, r, p } = parsed.params;
  return log.exit(N !== CURRENT_PARAMS.N || r !== CURRENT_PARAMS.r || p !== CURRENT_PARAMS.p);
}
