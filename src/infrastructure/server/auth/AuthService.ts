/**
 * @file ログイン・セッション・アカウント管理の手順（infrastructure/server/auth 層。docs/09 CMS-A04〜A07、§4.1）
 * - ログイン：相手ごとの回数制限（SEC-18）→ アカウントを探す → パスワードを照合（知らない ID でも同じ計算）→
 *   「ID＋相手」の失敗が続けばロック（CMS-A06。LoginThrottle。ほかの相手＝本人は締め出さない）→ 成功したら新しいセッションを発行する（SEC-19）。
 *   失敗の応答は、知らない ID・違うパスワード・ロック中のどれでも同じ 401 と同じ文（ID の有無を漏らさない）
 * - セッション：トークンの SHA-256 で探し、期限（12 時間）と最後の操作（60 分）を確かめ、停止されたアカウントは通さない。
 *   本番の版ではデモのアカウントのセッションを通さない（デモの DB をそのまま使ってしまったとき用）
 * - アカウント管理：運営者だけ（呼び出し側の経路がロールを確かめる。ここでも入力を検証する）
 * すべての書き込みは cms_auth_log に残す（SEC-24）。パスワード・IP・メールは記録しない（SEC-25）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseSpotId } from '@/Common/types/Id';
import { epochMsOf, instantFromEpochMs, parseInstant } from '@/Common/utils/date';
import type { Instant } from '@/Common/utils/date';
import { codePointLength, hasControlChars } from '@/Common/utils/guards';
import type {
  CmsAccountDto,
  CmsAccountStatus,
  CmsChangePasswordInput,
  CmsDemoLoginInput,
  CmsLoginInput,
  CmsRole,
  CreateCmsAccountInput,
  ResetCmsAccountPasswordInput,
  SetCmsAccountStatusInput,
  UpdateCmsAccountShopsInput,
} from '@/application/dto/CmsAuthDto';
import type { Clock } from '@/domain/ports/Clock';
import type { IdGenerator } from '@/domain/ports/IdGenerator';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import { LoginThrottle } from '@/infrastructure/server/auth/LoginThrottle';
import { hashPassword, needsRehash, UNUSABLE_PASSWORD_HASH, validateNewPassword, verifyPassword } from '@/infrastructure/server/auth/passwordHash';
import { ACCOUNT_ID_PATTERN } from '@/infrastructure/server/auth/principal';
import type { Principal } from '@/infrastructure/server/auth/principal';
import { newSessionToken, SESSION_IDLE_MS, SESSION_TTL_MS, sessionIdOf } from '@/infrastructure/server/auth/sessionCookie';
import type { FixedWindowRateLimiter, RateLimitOptions } from '@/infrastructure/server/http/FixedWindowRateLimiter';
import type { AccountRecord, SqliteAuthStore } from '@/infrastructure/server/sqlite/SqliteAuthStore';

const logger = createLogger('infrastructure/server/auth/AuthService');

/** 同じ ID＋同じ相手で、ログインの失敗がこの回数続いたらロックする（CMS-A06。仮） */
export const LOGIN_FAILURES_BEFORE_LOCK = 5;
/** ロックの長さ（ミリ秒。15 分。仮） */
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
/** ログインの失敗の文（知らない ID・違うパスワード・ロック中で同じ） */
export const LOGIN_FAILED_MESSAGE = 'ID かパスワードが違います。何度も失敗したときは、しばらくしてからお試しください';
/** ログインの試みの回数制限（1つの相手につき1分に10回。SEC-18） */
export const LOGIN_RATE_LIMIT: RateLimitOptions = { limit: 10, windowMs: 60_000 };
/** 最後の操作の日時を書き直す間隔（ミリ秒。要求のたびに書かない） */
const TOUCH_INTERVAL_MS = 60_000;
/** 記録の保持期間（ミリ秒。3年（仮）＝docs/09 §6.4） */
export const AUTH_LOG_RETENTION_MS = 3 * 365 * 24 * 60 * 60 * 1000;
/** デモの運営者のログインID と、デモの店舗のログインID の接頭辞 */
export const DEMO_OPERATOR_LOGIN_ID = 'demo.operator';
const DEMO_SHOP_LOGIN_PREFIX = 'demo.';
/** ログインID の書式（英小文字・数字・. _ @ -。3〜64 字。大文字は小文字にそろえる） */
const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._@-]{2,63}$/;
/** 表示名の長さ */
const DISPLAY_NAME_MAX = 30;
/** 1つのアカウントが担当できる店舗の数（仮） */
const MAX_SHOPS_PER_ACCOUNT = 20;
/** 操作者（ログイン前・コマンドライン） */
export const ANONYMOUS_ACTOR = 'anonymous';

/** AuthService の依存 */
export interface AuthServiceDeps {
  readonly store: SqliteAuthStore;
  /** 実時刻の時計（セッションの期限はデモの日付進行の影響を受けない） */
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** 店舗の存在を確かめる */
  readonly spots: SpotRepository;
  readonly mode: 'demo' | 'production';
  /** ログインの試みの回数制限 */
  readonly loginLimiter: FixedWindowRateLimiter;
}

/** ログインの結果 */
export interface LoginOutcome {
  readonly principal: Principal;
  /** Cookie に入れるトークン（DB には SHA-256 だけを置く） */
  readonly token: string;
}

/**
 * DB の失敗を作る。
 * @param reason 理由
 * @param cause 元の例外（ログ用）
 * @returns STORAGE_FAILED
 */
function storageFailed(reason: string, cause?: unknown): Result<never> {
  return fail(AppError.of('STORAGE_FAILED', '保存先を読み書きできませんでした', { reason }, cause));
}

/**
 * ログインの失敗（ID の有無を明かさない同じ文）を作る。
 * @returns AUTH_FAILED
 */
function authFailed(): Result<never> {
  return fail(AppError.of('AUTH_FAILED', LOGIN_FAILED_MESSAGE));
}

/**
 * 入力の不正を作る。
 * @param message 利用者向けの文
 * @param field 欄
 * @returns INVALID_INPUT
 */
function invalidField(message: string, field: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', message, { field }));
}

/**
 * ログインID を正規化して検証する（前後の空白を除き、小文字にそろえる）。
 * @param raw 入力
 * @returns 成功: 正規化した ID。失敗: INVALID_INPUT
 */
export function normalizeLoginId(raw: unknown): Result<string> {
  const log = logger.fn('normalizeLoginId');
  if (typeof raw !== 'string') return log.fail(invalidField('ID を入力してください', 'loginId'));
  const id = raw.normalize('NFC').trim().toLowerCase();
  if (!LOGIN_ID_PATTERN.test(id)) return log.fail(invalidField('ID は英数字と . _ @ - で3〜64文字です', 'loginId'));
  return log.exit(ok(id));
}

/**
 * 表示名を検証する（NFC・1〜30 字・制御文字なし＝DI-17）。
 * @param raw 入力
 * @returns 成功: 表示名。失敗: INVALID_INPUT
 */
function validateDisplayName(raw: unknown): Result<string> {
  const log = logger.fn('validateDisplayName');
  if (typeof raw !== 'string') return log.fail(invalidField('表示名を入力してください', 'displayName'));
  const name = raw.normalize('NFC').trim();
  const length = codePointLength(name);
  if (length < 1 || length > DISPLAY_NAME_MAX || hasControlChars(name)) return log.fail(invalidField(`表示名は1〜${DISPLAY_NAME_MAX}文字です`, 'displayName'));
  return log.exit(ok(name));
}

/**
 * アカウントID の書式を確かめる。
 * @param raw 入力
 * @returns 成功: ID。失敗: INVALID_INPUT
 */
export function parseAccountId(raw: unknown): Result<string> {
  const log = logger.fn('parseAccountId');
  if (typeof raw !== 'string' || !ACCOUNT_ID_PATTERN.test(raw)) return log.fail(invalidField('アカウントの ID が正しくありません', 'accountId'));
  return log.exit(ok(raw));
}

/**
 * 日時の文字列を検証して Instant にする（DB から読んだ値）。
 * @param raw 文字列
 * @returns Instant（壊れていれば undefined）
 */
function instantOf(raw: string | undefined): Instant | undefined { // audit-ignore: fnlog-missing 値の変換だけの純粋なヘルパー（parseInstant が記録する）
  if (raw === undefined) return undefined;
  const parsed = parseInstant(raw);
  return parsed.ok ? parsed.value : undefined;
}

/**
 * アカウントを画面用の DTO にする（パスワードのハッシュは入れない）。
 * @param account アカウント
 * @param locked いまロック中の相手がいるか
 * @returns DTO
 */
function accountDtoOf(account: AccountRecord, locked: boolean): CmsAccountDto { // audit-ignore: fnlog-missing 形を写すだけの純粋なヘルパー（呼び出し元が記録する）
  return {
    id: account.id, loginId: account.loginId, displayName: account.displayName, role: account.role, status: account.status,
    shopIds: [...account.shopIds], demo: account.demo, locked,
    createdAt: account.createdAt, ...(account.lastLoginAt === undefined ? {} : { lastLoginAt: account.lastLoginAt }),
  };
}

/** ログイン・セッション・アカウント管理 */
export class AuthService {
  /** ID＋相手ごとの失敗の数え方 */
  private readonly throttle: LoginThrottle;

  /**
   * 依存を受け取る。
   * @param deps 表・時計・ID・マスタ・モード・回数制限
   */
  constructor(private readonly deps: AuthServiceDeps) {
    this.throttle = new LoginThrottle({ maxFailures: LOGIN_FAILURES_BEFORE_LOCK, lockMs: LOGIN_LOCK_MS, nowMs: () => epochMsOf(deps.clock.now()) });
  }

  /**
   * アカウントを画面用の DTO にする（ロック中かを足す）。
   * @param account アカウント
   * @returns DTO
   */
  private dtoOf(account: AccountRecord): CmsAccountDto {
    return accountDtoOf(account, this.throttle.hasLockFor(account.loginId));
  }

  /**
   * 今の日時を返す。
   * @returns Instant
   */
  private now(): Instant {
    return this.deps.clock.now();
  }

  /**
   * ログイン・アカウントの記録を残す（失敗しても処理は止めない）。
   * @param actor 操作した人
   * @param action 操作
   * @param targetId 対象
   * @param detail 補足
   * @sideEffect cms_auth_log に追記する
   */
  private record(actor: string, action: string, targetId: string, detail?: Readonly<Record<string, string | number | boolean>>): void {
    const log = logger.fn('record', { action, targetId });
    try {
      this.deps.store.appendAuthLog({ at: this.now(), actor, action, targetId, ...(detail === undefined ? {} : { detail }) });
    } catch (error) {
      log.error('ログインの記録を書けませんでした', { action, message: error instanceof Error ? error.message : 'unknown' });
    }
    log.exit(undefined);
  }

  /**
   * アカウントからログイン中の人を作る。
   * @param account アカウント
   * @param sessionId セッション ID
   * @returns Principal
   */
  private principalOf(account: AccountRecord, sessionId: string): Principal { // audit-ignore: fnlog-missing 形を写すだけの純粋なヘルパー（呼び出し元が記録する）
    return {
      accountId: account.id, loginId: account.loginId, displayName: account.displayName, role: account.role,
      shopIds: new Set(account.shopIds), demo: account.demo, sessionId,
    };
  }

  /**
   * 新しいセッションを発行する。
   * @param account アカウント
   * @returns Principal とトークン
   * @sideEffect cms_sessions に追記する
   */
  private issueSession(account: AccountRecord): LoginOutcome {
    const log = logger.fn('issueSession', { accountId: account.id });
    const token = newSessionToken();
    const id = sessionIdOf(token);
    const now = this.now();
    const expiresAt = instantFromEpochMs(epochMsOf(now) + SESSION_TTL_MS);
    this.deps.store.insertSession({ id, accountId: account.id, createdAt: now, expiresAt, lastSeenAt: now });
    log.exit(undefined, 'issued'); // トークンはログに出さない
    return { principal: this.principalOf(account, id), token };
  }

  /**
   * Cookie のトークンからログイン中の人を決める（期限切れ・取り消し・停止は「ログインしていない」）。
   * @param token Cookie のトークン（無ければ undefined）
   * @returns 成功: Principal（ログインしていなければ undefined）。失敗: STORAGE_FAILED
   * @sideEffect 最後の操作の日時を進める。期限切れなら取り消す
   */
  authenticate(token: string | undefined): Result<Principal | undefined> {
    const log = logger.fn('authenticate', { hasToken: token !== undefined });
    if (token === undefined) return log.exit(ok(undefined), 'noToken');
    try {
      const id = sessionIdOf(token);
      const session = this.deps.store.findSession(id);
      if (session === undefined || session.revokedAt !== undefined) return log.exit(ok(undefined), 'noSession');
      const now = this.now();
      const nowMs = epochMsOf(now);
      const expiresAt = instantOf(session.expiresAt);
      const lastSeenAt = instantOf(session.lastSeenAt);
      if (expiresAt === undefined || lastSeenAt === undefined || epochMsOf(expiresAt) <= nowMs || nowMs - epochMsOf(lastSeenAt) > SESSION_IDLE_MS) {
        this.deps.store.revokeSession(id, now);
        return log.exit(ok(undefined), 'expired');
      }
      const account = this.deps.store.findAccountById(session.accountId);
      if (account === undefined || account.status !== 'active') return log.exit(ok(undefined), 'inactive');
      if (account.demo && this.deps.mode !== 'demo') {
        log.warn('本番の版でデモのアカウントのセッションを断りました');
        return log.exit(ok(undefined), 'demoAccount');
      }
      if (nowMs - epochMsOf(lastSeenAt) > TOUCH_INTERVAL_MS) this.deps.store.touchSession(id, now);
      return log.exit(ok(this.principalOf(account, id)), account.role);
    } catch (error) {
      log.error('セッションを読めませんでした');
      return log.fail(storageFailed('session', error));
    }
  }

  /**
   * ログインの失敗を数える（同期的。並行して届いた失敗も数え漏れない）。上限に達したらロックし、記録に残す。
   * @param key ID＋相手の鍵
   * @param targetId 記録に残す対象（アカウントID。知らない ID なら '-'）
   * @param reason 理由
   * @sideEffect LoginThrottle を書き換え、記録を残す
   */
  private countFailure(key: string, targetId: string, reason: 'unknown' | 'mismatch' | 'suspended'): void {
    const log = logger.fn('countFailure', { targetId, reason });
    const outcome = this.throttle.recordFailure(key);
    this.record(targetId === '-' ? ANONYMOUS_ACTOR : targetId, 'login.failed', targetId, { reason, failures: outcome.failures });
    if (outcome.locked) {
      log.warn('ログインの失敗が続いたため、この相手からの ID をロックしました', { targetId, failures: outcome.failures });
      this.record(targetId === '-' ? ANONYMOUS_ACTOR : targetId, 'login.locked', targetId);
    }
    log.exit(undefined);
  }

  /**
   * ログインする。失敗は理由によらず同じ AUTH_FAILED（ID の有無を漏らさない）。
   * @param input ID とパスワード
   * @param clientKey 相手の識別子（回数制限・ロックの鍵。記録には残さない）
   * @returns 成功: Principal とトークン。失敗: RATE_LIMITED / AUTH_FAILED / STORAGE_FAILED
   * @sideEffect 失敗の数・ロック・最終ログイン・セッションを書き、記録を残す
   */
  async login(input: CmsLoginInput, clientKey: string): Promise<Result<LoginOutcome>> {
    const log = logger.fn('login');
    if (!this.deps.loginLimiter.tryTake(clientKey)) {
      this.record(ANONYMOUS_ACTOR, 'login.rateLimited', '-');
      return log.fail(fail(AppError.of('RATE_LIMITED', 'ログインの回数が多すぎます。少し待ってからお試しください')));
    }
    const loginId = normalizeLoginId(input.loginId);
    if (!loginId.ok || typeof input.password !== 'string') {
      await verifyPassword('', UNUSABLE_PASSWORD_HASH);
      return log.fail(authFailed(), 'format');
    }
    const key = LoginThrottle.keyOf(loginId.value, clientKey);
    if (this.throttle.isLocked(key)) {
      await verifyPassword(input.password, UNUSABLE_PASSWORD_HASH);
      this.record(ANONYMOUS_ACTOR, 'login.lockedAttempt', '-');
      return log.fail(authFailed(), 'locked');
    }
    try {
      const account = this.deps.store.findAccountByLoginId(loginId.value);
      if (account === undefined) {
        await verifyPassword(input.password, UNUSABLE_PASSWORD_HASH);
        this.countFailure(key, '-', 'unknown');
        return log.fail(authFailed(), 'unknown');
      }
      const outcome = await this.loginKnown(account, input.password, key);
      return outcome.ok ? log.exit(outcome, 'ok') : log.fail(outcome, outcome.error.code); // 成功の値（トークン）はログに出さない
    } catch (error) {
      log.error('ログインの処理で DB の失敗');
      return log.fail(storageFailed('login', error));
    }
  }

  /**
   * 見つかったアカウントでログインを続ける。照合の後にもう一度ロックを確かめる（照合中に別の要求がロックしたとき）。
   * @param account アカウント
   * @param password 入力されたパスワード
   * @param key ID＋相手の鍵
   * @returns 成功: Principal とトークン。失敗: AUTH_FAILED
   * @sideEffect 失敗の数・ロック・最終ログイン・セッションを書き、記録を残す
   */
  private async loginKnown(account: AccountRecord, password: string, key: string): Promise<Result<LoginOutcome>> {
    const log = logger.fn('loginKnown', { accountId: account.id, status: account.status });
    const matched = await verifyPassword(password, account.passwordHash);
    if (!matched || account.status !== 'active') {
      this.countFailure(key, account.id, matched ? 'suspended' : 'mismatch');
      return log.fail(authFailed(), matched ? 'suspended' : 'mismatch');
    }
    if (this.throttle.isLocked(key)) {
      this.record(account.id, 'login.lockedAttempt', account.id);
      return log.fail(authFailed(), 'lockedAfterVerify');
    }
    this.throttle.clear(key);
    const now = this.now();
    const rehash = needsRehash(account.passwordHash) ? await hashPassword(password) : undefined;
    this.deps.store.updateAccount(account.id, { lastLoginAt: now, updatedAt: now, ...(rehash === undefined ? {} : { passwordHash: rehash }) });
    const outcome = this.issueSession(account);
    this.record(account.id, 'login.success', account.id, { role: account.role });
    log.exit(undefined, 'ok');
    return ok(outcome);
  }

  /**
   * ログアウトする（セッションを取り消す）。
   * @param principal ログイン中の人
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect cms_sessions を書き換え、記録を残す
   */
  logout(principal: Principal): Result<void> {
    const log = logger.fn('logout', { accountId: principal.accountId });
    try {
      this.deps.store.revokeSession(principal.sessionId, this.now());
      this.record(principal.accountId, 'logout', principal.accountId);
      return log.exit(okVoid());
    } catch (error) {
      log.error('ログアウトで DB の失敗');
      return log.fail(storageFailed('logout', error));
    }
  }

  /**
   * 自分のパスワードを変える（今のパスワードを確かめ、ほかの端末のセッションを切る）。
   * @param principal ログイン中の人
   * @param input 今のパスワードと新しいパスワード
   * @returns 成功: void。失敗: AUTH_FAILED（今のパスワードが違う）/ INVALID_INPUT / FORBIDDEN（デモのアカウント）/ STORAGE_FAILED
   * @sideEffect cms_accounts・cms_sessions を書き換え、記録を残す
   */
  async changePassword(principal: Principal, input: CmsChangePasswordInput): Promise<Result<void>> {
    const log = logger.fn('changePassword', { accountId: principal.accountId });
    if (principal.demo) return log.fail(fail(AppError.of('FORBIDDEN', 'デモのアカウントではパスワードを変えられません')));
    try {
      const account = this.deps.store.findAccountById(principal.accountId);
      if (account === undefined) return log.fail(fail(AppError.of('UNAUTHENTICATED', 'ログインし直してください')));
      if (!(await verifyPassword(input.currentPassword, account.passwordHash))) {
        this.record(account.id, 'password.changeFailed', account.id);
        return log.fail(fail(AppError.of('AUTH_FAILED', '今のパスワードが違います', { field: 'currentPassword' })));
      }
      const next = validateNewPassword(input.newPassword);
      if (!next.ok) return log.fail(next);
      if (next.value === input.currentPassword.normalize('NFC')) return log.fail(invalidField('今と違うパスワードにしてください', 'newPassword'));
      const now = this.now();
      this.deps.store.updateAccount(account.id, { passwordHash: await hashPassword(next.value), updatedAt: now });
      const revoked = this.deps.store.revokeSessionsOfAccount(account.id, now, principal.sessionId);
      this.record(account.id, 'password.change', account.id, { revokedSessions: revoked });
      return log.exit(okVoid());
    } catch (error) {
      log.error('パスワードの変更で DB の失敗');
      return log.fail(storageFailed('password', error));
    }
  }

  /**
   * デモの版だけ：運営者か店舗の担当者として入る（アカウントが無ければ作る。パスワードでは入れない）。
   * @param input ロールと店舗
   * @returns 成功: Principal とトークン。失敗: DEMO_DISABLED / INVALID_INPUT / SPOT_NOT_FOUND / STORAGE_FAILED
   * @sideEffect アカウントとセッションを作り、記録を残す
   */
  demoLogin(input: CmsDemoLoginInput): Result<LoginOutcome> {
    const log = logger.fn('demoLogin', { role: input.role, spotId: input.spotId });
    if (this.deps.mode !== 'demo') return log.fail(fail(AppError.of('DEMO_DISABLED', 'デモの版だけで使えます')));
    const shops = input.role === 'operator' ? ok<readonly string[]>([]) : this.validateShopIds(input.spotId === undefined ? [] : [input.spotId]);
    if (!shops.ok) return log.fail(shops);
    if (input.role === 'shopOwner' && shops.value.length === 0) return log.fail(invalidField('店舗を選んでください', 'spotId'));
    const loginId = input.role === 'operator' ? DEMO_OPERATOR_LOGIN_ID : `${DEMO_SHOP_LOGIN_PREFIX}${shops.value[0] ?? ''}`;
    try {
      const now = this.now();
      const existing = this.deps.store.findAccountByLoginId(loginId);
      const account = existing ?? this.createDemoAccount(loginId, input.role, shops.value, now);
      if (account.status !== 'active') return log.fail(fail(AppError.of('FORBIDDEN', 'このデモのアカウントは停止されています')));
      const outcome = this.issueSession(account);
      this.record(account.id, 'login.demo', account.id, { role: account.role });
      log.exit(undefined, 'ok');
      return ok(outcome);
    } catch (error) {
      log.error('デモのログインで DB の失敗');
      return log.fail(storageFailed('demoLogin', error));
    }
  }

  /**
   * デモのアカウントを作る。
   * @param loginId ログインID
   * @param role ロール
   * @param shopIds 店舗
   * @param now 今
   * @returns 作ったアカウント
   * @sideEffect cms_accounts に追記する
   */
  private createDemoAccount(loginId: string, role: CmsRole, shopIds: readonly string[], now: Instant): AccountRecord {
    const log = logger.fn('createDemoAccount', { role, shops: shopIds.length });
    const shopName = shopIds[0] === undefined ? undefined : this.deps.spots.findSpot(parseSpotId(shopIds[0]).ok ? (shopIds[0] as never) : (shopIds[0] as never))?.name;
    const account: AccountRecord = {
      id: this.deps.ids.newId('u'), loginId, passwordHash: UNUSABLE_PASSWORD_HASH, role,
      displayName: role === 'operator' ? '運営者（デモ）' : `${shopName ?? '店舗'}（デモ）`, status: 'active', demo: true, failedLogins: 0,
      createdAt: now, updatedAt: now, shopIds,
    };
    this.deps.store.insertAccount(account);
    return log.exit(account);
  }

  /**
   * 担当店舗の ID を検証する（書式・存在・店舗であること・重複なし・上限）。
   * @param raw 入力
   * @returns 成功: 店舗の ID。失敗: INVALID_INPUT / SPOT_NOT_FOUND
   */
  private validateShopIds(raw: readonly unknown[]): Result<readonly string[]> {
    const log = logger.fn('validateShopIds', { count: raw.length });
    if (raw.length > MAX_SHOPS_PER_ACCOUNT) return log.fail(invalidField(`担当できる店舗は${MAX_SHOPS_PER_ACCOUNT}件までです`, 'shopIds'));
    const ids: string[] = [];
    for (const item of raw) {
      const id = parseSpotId(item);
      if (!id.ok) return log.fail(invalidField('店舗の ID が正しくありません', 'shopIds'));
      const spot = this.deps.spots.findSpot(id.value);
      if (spot === undefined || spot.kind !== 'shop') return log.fail(fail(AppError.of('SPOT_NOT_FOUND', '店舗が見つかりません', { spotId: id.value })));
      if (!ids.includes(id.value)) ids.push(id.value);
    }
    return log.exit(ok(Object.freeze(ids)));
  }

  /**
   * アカウントの一覧を返す（運営者）。
   * @returns 成功: 一覧。失敗: STORAGE_FAILED
   */
  listAccounts(): Result<readonly CmsAccountDto[]> {
    const log = logger.fn('listAccounts');
    try {
      return log.exit(ok(this.deps.store.listAccounts().map((a) => this.dtoOf(a))));
    } catch (error) {
      log.error('アカウントの一覧で DB の失敗');
      return log.fail(storageFailed('accounts', error));
    }
  }

  /**
   * アカウントを作る（運営者・コマンドライン）。
   * @param actor 操作した人（アカウントID か 'cli'）
   * @param input ログインID・表示名・ロール・店舗・最初のパスワード
   * @returns 成功: 作ったアカウント。失敗: INVALID_INPUT / SPOT_NOT_FOUND / LOGIN_ID_TAKEN / STORAGE_FAILED
   * @sideEffect cms_accounts に追記し、記録を残す
   */
  async createAccount(actor: string, input: CreateCmsAccountInput): Promise<Result<CmsAccountDto>> {
    const log = logger.fn('createAccount', { role: input.role, shops: input.shopIds.length });
    const loginId = normalizeLoginId(input.loginId);
    if (!loginId.ok) return log.fail(loginId);
    if (loginId.value.startsWith(DEMO_SHOP_LOGIN_PREFIX)) return log.fail(invalidField('この ID は使えません', 'loginId'));
    const displayName = validateDisplayName(input.displayName);
    if (!displayName.ok) return log.fail(displayName);
    if (input.role !== 'operator' && input.role !== 'shopOwner') return log.fail(invalidField('ロールが正しくありません', 'role'));
    const shopIds = this.validateShopIds(input.shopIds);
    if (!shopIds.ok) return log.fail(shopIds);
    if (input.role === 'shopOwner' && shopIds.value.length === 0) return log.fail(invalidField('店舗を1つ以上選んでください', 'shopIds'));
    const password = validateNewPassword(input.password);
    if (!password.ok) return log.fail(password);
    try {
      if (this.deps.store.findAccountByLoginId(loginId.value) !== undefined) return log.fail(fail(AppError.of('LOGIN_ID_TAKEN', 'この ID はすでに使われています', { field: 'loginId' })));
      const now = this.now();
      const account: AccountRecord = {
        id: this.deps.ids.newId('u'), loginId: loginId.value, passwordHash: await hashPassword(password.value), role: input.role,
        displayName: displayName.value, status: 'active', demo: false, failedLogins: 0, createdAt: now, updatedAt: now,
        shopIds: input.role === 'operator' ? [] : shopIds.value,
      };
      this.deps.store.insertAccount(account);
      this.record(actor, 'account.create', account.id, { role: account.role, shops: account.shopIds.length });
      return log.exit(ok(this.dtoOf(account)));
    } catch (error) {
      log.error('アカウントの作成で DB の失敗');
      return log.fail(storageFailed('createAccount', error));
    }
  }

  /**
   * ID でアカウントを読む（運営者の操作の共通の手順）。
   * @param raw 入力の accountId
   * @returns 成功: アカウント。失敗: INVALID_INPUT / ACCOUNT_NOT_FOUND
   * @throws SQLite の例外
   */
  private requireAccount(raw: unknown): Result<AccountRecord> {
    const log = logger.fn('requireAccount');
    const id = parseAccountId(raw);
    if (!id.ok) return log.fail(id);
    const account = this.deps.store.findAccountById(id.value);
    if (account === undefined) return log.fail(fail(AppError.of('ACCOUNT_NOT_FOUND', 'アカウントが見つかりません')));
    return log.exit(ok(account));
  }

  /**
   * 担当店舗を変える（運営者）。
   * @param actor 操作した人
   * @param input アカウントと店舗
   * @returns 成功: 変えたあとのアカウント。失敗: INVALID_INPUT / ACCOUNT_NOT_FOUND / SPOT_NOT_FOUND / STORAGE_FAILED
   * @sideEffect cms_account_shops を書き換え、記録を残す
   */
  updateAccountShops(actor: string, input: UpdateCmsAccountShopsInput): Result<CmsAccountDto> {
    const log = logger.fn('updateAccountShops', { accountId: input.accountId, shops: input.shopIds.length });
    const shopIds = this.validateShopIds(input.shopIds);
    if (!shopIds.ok) return log.fail(shopIds);
    try {
      const account = this.requireAccount(input.accountId);
      if (!account.ok) return log.fail(account);
      if (account.value.role === 'shopOwner' && shopIds.value.length === 0) return log.fail(invalidField('店舗を1つ以上選んでください', 'shopIds'));
      const now = this.now();
      this.deps.store.replaceAccountShops(account.value.id, shopIds.value, now);
      this.record(actor, 'account.shops', account.value.id, { before: account.value.shopIds.length, after: shopIds.value.length });
      return log.exit(ok(this.dtoOf({ ...account.value, shopIds: shopIds.value, updatedAt: now })));
    } catch (error) {
      log.error('担当店舗の変更で DB の失敗');
      return log.fail(storageFailed('accountShops', error));
    }
  }

  /**
   * 停止・再開する（運営者。停止するとそのアカウントのセッションはすべて切れる＝CMS-A07）。
   * @param actor 操作した人
   * @param input アカウントと状態
   * @returns 成功: 変えたあとのアカウント。失敗: INVALID_INPUT / ACCOUNT_NOT_FOUND / FORBIDDEN（自分を停止）/ STORAGE_FAILED
   * @sideEffect cms_accounts・cms_sessions を書き換え、記録を残す
   */
  setAccountStatus(actor: string, input: SetCmsAccountStatusInput): Result<CmsAccountDto> {
    const log = logger.fn('setAccountStatus', { accountId: input.accountId, status: input.status });
    const status: CmsAccountStatus | undefined = input.status === 'active' || input.status === 'suspended' ? input.status : undefined;
    if (status === undefined) return log.fail(invalidField('状態が正しくありません', 'status'));
    try {
      const account = this.requireAccount(input.accountId);
      if (!account.ok) return log.fail(account);
      if (status === 'suspended' && account.value.id === actor) return log.fail(fail(AppError.of('FORBIDDEN', '自分のアカウントは停止できません')));
      const now = this.now();
      this.deps.store.updateAccount(account.value.id, { status, updatedAt: now });
      const revoked = status === 'suspended' ? this.deps.store.revokeSessionsOfAccount(account.value.id, now) : 0;
      this.record(actor, status === 'suspended' ? 'account.suspend' : 'account.resume', account.value.id, { revokedSessions: revoked });
      return log.exit(ok(this.dtoOf({ ...account.value, status, updatedAt: now })));
    } catch (error) {
      log.error('停止・再開で DB の失敗');
      return log.fail(storageFailed('accountStatus', error));
    }
  }

  /**
   * パスワードを設定し直す（運営者・コマンドライン。そのアカウントのセッションはすべて切れる）。
   * 自分のパスワードは今のパスワードを確かめる changePassword でしか変えられない（席を離れた画面からの乗っ取りを防ぐ）。
   * @param actor 操作した人
   * @param input アカウントと新しいパスワード
   * @returns 成功: void。失敗: INVALID_INPUT / ACCOUNT_NOT_FOUND / FORBIDDEN（デモのアカウント・自分）/ STORAGE_FAILED
   * @sideEffect cms_accounts・cms_sessions を書き換え、記録を残す
   */
  async resetAccountPassword(actor: string, input: ResetCmsAccountPasswordInput): Promise<Result<void>> {
    const log = logger.fn('resetAccountPassword', { accountId: input.accountId });
    const password = validateNewPassword(input.newPassword);
    if (!password.ok) return log.fail(password);
    try {
      const account = this.requireAccount(input.accountId);
      if (!account.ok) return log.fail(account);
      if (account.value.demo) return log.fail(fail(AppError.of('FORBIDDEN', 'デモのアカウントにはパスワードを設定できません')));
      if (account.value.id === actor) return log.fail(fail(AppError.of('FORBIDDEN', '自分のパスワードは「アカウント」から今のパスワードを入れて変えてください')));
      const now = this.now();
      this.deps.store.updateAccount(account.value.id, { passwordHash: await hashPassword(password.value), updatedAt: now });
      const revoked = this.deps.store.revokeSessionsOfAccount(account.value.id, now);
      this.record(actor, 'password.reset', account.value.id, { revokedSessions: revoked });
      return log.exit(okVoid());
    } catch (error) {
      log.error('パスワードの再設定で DB の失敗');
      return log.fail(storageFailed('resetPassword', error));
    }
  }

  /**
   * 定期的な掃除（期限切れのセッションと、保持期間を過ぎた記録を消す）。
   * @returns 消した数（失敗したら 0）
   * @sideEffect cms_sessions・cms_auth_log から削除する
   */
  maintain(): { readonly sessions: number; readonly logs: number } {
    const log = logger.fn('maintain');
    try {
      const nowMs = epochMsOf(this.now());
      const sessions = this.deps.store.deleteSessionsExpiredBefore(instantFromEpochMs(nowMs));
      const logs = this.deps.store.deleteAuthLogBefore(instantFromEpochMs(nowMs - AUTH_LOG_RETENTION_MS));
      return log.exit({ sessions, logs });
    } catch (error) {
      log.error('ログインの表の掃除で DB の失敗', { message: error instanceof Error ? error.message : 'unknown' });
      return log.exit({ sessions: 0, logs: 0 }, 'failed');
    }
  }
}
