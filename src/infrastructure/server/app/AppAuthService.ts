/**
 * @file 利用者（冒険者）のログイン（infrastructure/server/app 層。docs/12 §5、SEC-19）
 * 外部ログイン（OpenID Connect の認可コード＋PKCE）で利用者を確かめ、セッションを出す。パスワードは持たない。
 * - state は推測できない乱数で、DB にはハッシュだけを置き、1回だけ使える（10分で失効）。ブラウザの Cookie とも照らし合わせる
 *   （ほかの人が始めたログインの続きを踏ませる攻撃＝ログイン CSRF の対策）
 * - セッションのトークンも DB にはハッシュだけ。期限は「ログインから 30日」と「最後の操作から 14日」の短い方（仮）
 * - 提供元から受け取るのは sub だけ。利用者には内部の ID と旅人ID を新しく割り当てる（sub を旅人ID にしない）
 * 店舗CMS のログイン（auth/AuthService。ID＋パスワード）とは表も Cookie も別。
 */
import type { JsonWebKey } from 'node:crypto';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { travelerIdFromUuid } from '@/Common/types/Id';
import type { TravelerId } from '@/Common/types/Id';
import { epochMsOf, instantFromEpochMs } from '@/Common/utils/date';
import type { Instant } from '@/Common/utils/date';
import type { Clock } from '@/domain/ports/Clock';
import { uuid } from '@/infrastructure/random/CryptoIdGenerator';
import { verifyIdToken } from '@/infrastructure/server/app/oidc/idToken';
import { authorizationUrlOf, codeChallengeOf, exchangeCode, JwksCache, PROVIDER_ID_PATTERN, randomToken } from '@/infrastructure/server/app/oidc/OidcClient';
import type { FetchFn, OidcProviderConfig } from '@/infrastructure/server/app/oidc/OidcClient';
import type { PgAppAuthStore } from '@/infrastructure/server/app/PgAppAuthStore';
import { isSessionToken, newSessionToken, sessionIdOf } from '@/infrastructure/server/auth/sessionCookie';

const logger = createLogger('infrastructure/server/app/AppAuthService');

/** ログイン途中の state の有効期間（ミリ秒。10分） */
export const LOGIN_STATE_TTL_MS = 10 * 60 * 1000;
/** ログインからのセッションの有効期間（ミリ秒。30日＝仮） */
export const APP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 最後の操作からのセッションの有効期間（ミリ秒。14日＝仮） */
export const APP_SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
/** 最後の操作の時刻を書き直す間隔（ミリ秒。要求のたびに DB へ書かない） */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
/** 相手から戻ってきたコードの長さの上限 */
const MAX_CODE_LENGTH = 2048;

/** ログイン中の利用者 */
export interface AppPrincipal {
  /** 内部の利用者ID（UUID） */
  readonly userId: string;
  readonly travelerId: TravelerId;
  /** このログインのセッション ID（トークンのハッシュ） */
  readonly sessionId: string;
}

/** 画面に出す提供元 */
export interface AppLoginProvider {
  readonly id: string;
  readonly label: string;
}

/** ログインを始めた結果 */
export interface LoginStart {
  /** 相手の同意の画面の URL */
  readonly url: string;
  /** ブラウザの Cookie に持たせる state（戻ってきたときに照らし合わせる） */
  readonly state: string;
}

/** 相手から戻ってきた値 */
export interface LoginCallback {
  readonly code: unknown;
  readonly state: unknown;
  /** ブラウザの Cookie に持たせておいた state */
  readonly cookieState: string | undefined;
}

/** ログインが済んだ結果 */
export interface LoginSession {
  /** セッションのトークン（Cookie にだけ入れる） */
  readonly token: string;
  readonly maxAgeSec: number;
  readonly travelerId: TravelerId;
  /** 初めてのログインか */
  readonly created: boolean;
}

/** AppAuthService の依存 */
export interface AppAuthDeps {
  readonly store: PgAppAuthStore;
  readonly clock: Clock;
  readonly providers: readonly OidcProviderConfig[];
  /** 公開の面のオリジン（'https://app.example.jp'。戻り先 URL を作る。要求の Host は使わない） */
  readonly origin: string;
  readonly fetchFn: FetchFn;
}

/**
 * ログインの失敗を作る（利用者向けの文は理由によらず同じ。理由は details.rule）。
 * @param rule 破った規則名
 * @returns LOGIN_FAILED の失敗
 */
function loginFailed(rule: string): Result<never> {
  return fail(AppError.of('LOGIN_FAILED', 'ログインできませんでした。もう一度お試しください', { rule }));
}

/**
 * DB の失敗を作る。
 * @param error DB の例外
 * @returns STORAGE_FAILED の失敗
 */
function storageFailed(error: unknown): Result<never> {
  const log = logger.fn('storageFailed');
  log.error('DB の失敗', { message: error instanceof Error ? error.message : 'unknown' });
  return log.exit(fail(AppError.of('STORAGE_FAILED', 'サーバーで問題が起きました。少し待ってからお試しください', undefined, error)));
}

/** 利用者（冒険者）のログイン */
export class AppAuthService {
  private readonly jwks: JwksCache;

  /**
   * 作る。
   * @param deps 保存先・時計・提供元の設定・オリジン・fetch
   */
  constructor(private readonly deps: AppAuthDeps) {
    this.jwks = new JwksCache(deps.fetchFn, () => epochMsOf(deps.clock.now()));
  }

  /**
   * 今から ms ミリ秒ずらした時刻を返す。
   * @param ms ずらす量（負なら過去）
   * @returns Instant
   */
  private at(ms: number): Instant {
    return instantFromEpochMs(epochMsOf(this.deps.clock.now()) + ms);
  }

  /**
   * 提供元の設定を探す。
   * @param providerId 提供元の ID（未検証）
   * @returns 設定（無ければ undefined）
   */
  private providerOf(providerId: string): OidcProviderConfig | undefined {
    return PROVIDER_ID_PATTERN.test(providerId) ? this.deps.providers.find((p) => p.id === providerId) : undefined;
  }

  /**
   * 相手に登録する戻り先 URL。
   * @param providerId 提供元の ID
   * @returns URL
   */
  redirectUriOf(providerId: string): string {
    return `${this.deps.origin}/api/app/auth/${providerId}/callback`;
  }

  /**
   * 使える提供元の一覧。
   * @returns ID と画面に出す名前
   */
  providers(): readonly AppLoginProvider[] {
    return this.deps.providers.map((p) => ({ id: p.id, label: p.label }));
  }

  /**
   * ログインを始める（state・nonce・PKCE を作って保存し、相手の同意の画面の URL を返す）。
   * @param providerId 提供元の ID（道筋の値。未検証）
   * @returns 成功: URL と state。失敗: NOT_FOUND（知らない提供元）/ STORAGE_FAILED
   * @sideEffect DB にログイン途中の値を書く
   */
  async startLogin(providerId: string): Promise<Result<LoginStart>> {
    const log = logger.fn('startLogin', { providerId });
    const config = this.providerOf(providerId);
    if (config === undefined) return log.fail(fail(AppError.of('NOT_FOUND', 'このログイン方法は使えません')));
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();
    try {
      await this.deps.store.saveLoginState(sessionIdOf(state), { provider: config.id, nonce, codeVerifier }, this.at(LOGIN_STATE_TTL_MS));
    } catch (error) {
      return log.fail(storageFailed(error));
    }
    const url = authorizationUrlOf(config, { redirectUri: this.redirectUriOf(config.id), state, nonce, codeChallenge: codeChallengeOf(codeVerifier) });
    log.exit(undefined, 'ok'); // state を含むのでログに出さない
    return ok({ url, state });
  }

  /**
   * 相手から戻ってきたコードを確かめ、利用者を決めてセッションを作る。
   * @param providerId 提供元の ID（道筋の値。未検証）
   * @param callback コード・state・Cookie の state
   * @returns 成功: セッションのトークン。失敗: LOGIN_FAILED（details.rule に理由）/ STORAGE_FAILED
   * @sideEffect 相手のトークンの窓口へつなぐ。DB に利用者・セッションを書く
   */
  async completeLogin(providerId: string, callback: LoginCallback): Promise<Result<LoginSession>> {
    const log = logger.fn('completeLogin', { providerId });
    const config = this.providerOf(providerId);
    const { code, state } = callback;
    if (config === undefined) return log.fail(loginFailed('provider'));
    if (!isSessionToken(state) || state !== callback.cookieState) return log.fail(loginFailed('state'));
    if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) return log.fail(loginFailed('code'));
    try {
      const pending = await this.deps.store.takeLoginState(sessionIdOf(state), this.deps.clock.now());
      if (pending === undefined || pending.provider !== config.id) return log.fail(loginFailed('stateUnknown'));
      const subject = await this.subjectOf(config, code, pending);
      if (!subject.ok) return log.fail(subject);
      const session = await this.openSession(config.id, subject.value);
      log.exit(undefined, session.created ? 'created' : 'existing'); // トークンはログに出さない
      return ok(session);
    } catch (error) {
      return log.fail(storageFailed(error));
    }
  }

  /**
   * コードを ID トークンに交換し、検証して sub を取り出す。
   * @param config 提供元の設定
   * @param code 認可コード
   * @param pending ログインを始めたときの nonce・PKCE の検証子
   * @returns 成功: sub。失敗: LOGIN_FAILED
   * @sideEffect 相手へつなぐ
   */
  private async subjectOf(config: OidcProviderConfig, code: string, pending: { readonly nonce: string; readonly codeVerifier: string }): Promise<Result<string>> {
    const log = logger.fn('subjectOf', { provider: config.id });
    const idToken = await exchangeCode(config, { code, redirectUri: this.redirectUriOf(config.id), codeVerifier: pending.codeVerifier }, this.deps.fetchFn);
    if (!idToken.ok) return log.fail(idToken);
    const subject = await verifyIdToken(idToken.value, {
      issuer: config.issuer, clientId: config.clientId, nonce: pending.nonce, algs: config.algs, hmacSecret: config.clientSecret,
      nowSec: Math.floor(epochMsOf(this.deps.clock.now()) / 1000),
      loadKeys: (): Promise<Result<readonly JsonWebKey[]>> => this.jwks.keysOf(config),
    });
    if (!subject.ok) return log.fail(subject);
    log.exit(undefined, 'ok'); // sub はログに出さない
    return subject;
  }

  /**
   * 利用者を探し（いなければ作り）、セッションを作る。
   * @param providerId 提供元の ID
   * @param subject 提供元の中での利用者ID（sub）
   * @returns セッション
   * @throws DB の例外・ID の発行の失敗
   * @sideEffect DB に利用者・セッションを書く
   */
  private async openSession(providerId: string, subject: string): Promise<LoginSession> {
    const log = logger.fn('openSession', { providerId });
    const userId = uuid();
    const newTravelerId = travelerIdFromUuid(uuid());
    if (!newTravelerId.ok) throw new Error('旅人ID を作れません');
    const now = this.deps.clock.now();
    const user = await this.deps.store.findOrCreateUser({ provider: providerId, subject, userId, travelerId: newTravelerId.value, now });
    const travelerId = travelerIdFromUuid(user.travelerId.slice(2));
    if (!travelerId.ok) throw new Error('保存済みの旅人ID が正しくありません');
    const token = newSessionToken();
    await this.deps.store.createSession(sessionIdOf(token), user.userId, { now, expiresAt: this.at(APP_SESSION_TTL_MS) });
    log.info('ログイン', { provider: providerId, created: user.created });
    log.exit(undefined, 'ok'); // トークンはログに出さない
    return { token, maxAgeSec: Math.floor(APP_SESSION_TTL_MS / 1000), travelerId: travelerId.value, created: user.created };
  }

  /**
   * Cookie のトークンからログイン中の利用者を決める。
   * @param token セッションのトークン（無ければ undefined）
   * @returns 成功: ログイン中の利用者（未ログイン・失効なら undefined）。失敗: STORAGE_FAILED
   * @sideEffect 最後の操作の時刻を進める（5分に1回まで）
   */
  async authenticate(token: string | undefined): Promise<Result<AppPrincipal | undefined>> {
    const log = logger.fn('authenticate', { hasToken: token !== undefined });
    if (!isSessionToken(token)) return log.exit(ok(undefined), 'none');
    const sessionId = sessionIdOf(token);
    try {
      const now = this.deps.clock.now();
      const session = await this.deps.store.findSession(sessionId, { now, idleCutoff: this.at(-APP_SESSION_IDLE_MS), touchCutoff: this.at(-TOUCH_INTERVAL_MS) });
      if (session === undefined) return log.exit(ok(undefined), 'expired');
      const travelerId = travelerIdFromUuid(session.travelerId.slice(2));
      if (!travelerId.ok) return log.fail(storageFailed(new Error('保存済みの旅人ID が正しくありません')));
      if (session.stale) await this.deps.store.touchSession(sessionId, now);
      log.exit(undefined, 'ok');
      return ok({ userId: session.userId, travelerId: travelerId.value, sessionId });
    } catch (error) {
      return log.fail(storageFailed(error));
    }
  }

  /**
   * 利用者がつないでいる提供元の一覧を返す。
   * @param principal ログイン中の利用者
   * @returns 成功: 提供元の ID。失敗: STORAGE_FAILED
   */
  async linkedProviders(principal: AppPrincipal): Promise<Result<readonly string[]>> {
    const log = logger.fn('linkedProviders');
    try {
      return log.exit(ok(await this.deps.store.providersOf(principal.userId)));
    } catch (error) {
      return log.fail(storageFailed(error));
    }
  }

  /**
   * ログアウトする（そのセッションを消す）。
   * @param token セッションのトークン
   * @returns 成功: void（もともと無くても成功）。失敗: STORAGE_FAILED
   * @sideEffect DB からセッションを削除する
   */
  async logout(token: string | undefined): Promise<Result<void>> {
    const log = logger.fn('logout', { hasToken: token !== undefined });
    if (!isSessionToken(token)) return log.exit(okVoid(), 'none');
    try {
      await this.deps.store.deleteSession(sessionIdOf(token));
      return log.exit(okVoid());
    } catch (error) {
      return log.fail(storageFailed(error));
    }
  }

  /**
   * 失効したセッションとログイン途中の値を消す（定期的な掃除）。
   * @returns 消した件数（失敗したら 0）
   * @sideEffect DB から削除する
   */
  async maintain(): Promise<{ readonly sessions: number; readonly states: number }> {
    const log = logger.fn('maintain');
    try {
      return log.exit(await this.deps.store.deleteExpired(this.deps.clock.now(), this.at(-APP_SESSION_IDLE_MS)));
    } catch (error) {
      log.error('掃除で DB の失敗', { message: error instanceof Error ? error.message : 'unknown' });
      return log.exit({ sessions: 0, states: 0 }, 'failed');
    }
  }
}
