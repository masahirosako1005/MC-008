/**
 * @file 利用者・外部ログイン・セッションの保存（PostgreSQL。infrastructure/server/app 層。docs/12 §4.2 の版 2、§5）
 * SQL だけを受け持つ。手順と検証は AppAuthService が行う。メソッドは DB の例外をそのまま投げる（AppAuthService が Result に変える）。
 * 日時は Instant の文字列で受け取り、SQL の中で timestamptz にする（DB の時計を使わない＝DI-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { Instant } from '@/Common/utils/date';
import type { SqlClient } from '@/infrastructure/server/pg/SqlClient';

const logger = createLogger('infrastructure/server/app/PgAppAuthStore');

/** ログイン途中の値 */
export interface LoginStateRow {
  readonly provider: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

/** 利用者 */
export interface AppUserRow {
  readonly userId: string;
  readonly travelerId: string;
}

/** 有効なセッション */
export interface AppSessionRow extends AppUserRow {
  /** 最後の操作の記録が古い（更新したほうがよい） */
  readonly stale: boolean;
}

/** 新しく作るときの利用者 */
export interface NewAppUser extends AppUserRow {
  readonly provider: string;
  /** 提供元の中での利用者ID（sub） */
  readonly subject: string;
  readonly now: Instant;
}

/**
 * 行から文字列の列を読む。
 * @param row 行
 * @param column 列名
 * @returns 文字列（無ければ空文字）
 */
function textOf(row: Readonly<Record<string, unknown>> | undefined, column: string): string { // audit-ignore: fnlog-missing 列ごとに呼ぶ小さな変換（各メソッドで記録する）
  const value = row?.[column];
  return typeof value === 'string' ? value : '';
}

/** 利用者・外部ログイン・セッションの保存 */
export class PgAppAuthStore {
  /**
   * 作る。
   * @param client PostgreSQL への接続
   */
  constructor(private readonly client: SqlClient) {}

  /**
   * ログイン途中の値を保存する。
   * @param stateId state の SHA-256
   * @param row 提供元・nonce・PKCE の検証子
   * @param expiresAt 失効する時刻
   * @sideEffect DB に書き込む
   */
  async saveLoginState(stateId: string, row: LoginStateRow, expiresAt: Instant): Promise<void> {
    const log = logger.fn('saveLoginState', { provider: row.provider });
    await this.client.query(
      'INSERT INTO app_login_states (state_id, provider, nonce, code_verifier, expires_at) VALUES ($1, $2, $3, $4, $5::timestamptz)',
      [stateId, row.provider, row.nonce, row.codeVerifier, expiresAt],
    );
    log.exit(undefined);
  }

  /**
   * ログイン途中の値を取り出して消す（1回だけ使える）。
   * @param stateId state の SHA-256
   * @param now 今の時刻
   * @returns 値（無い・失効済みなら undefined）
   * @sideEffect DB から削除する
   */
  async takeLoginState(stateId: string, now: Instant): Promise<LoginStateRow | undefined> {
    const log = logger.fn('takeLoginState');
    const rows = await this.client.query(
      'DELETE FROM app_login_states WHERE state_id = $1 AND expires_at > $2::timestamptz RETURNING provider, nonce, code_verifier',
      [stateId, now],
    );
    const row = rows[0];
    log.exit(undefined, row === undefined ? 'none' : 'found'); // nonce・検証子はログに出さない
    return row === undefined ? undefined : { provider: textOf(row, 'provider'), nonce: textOf(row, 'nonce'), codeVerifier: textOf(row, 'code_verifier') };
  }

  /**
   * 外部ログインの利用者を探す。いなければ作る（同時に2回届いても利用者は1人だけ）。
   * @param candidate いなかったときに作る利用者
   * @returns 利用者（既にいればその人）と、新しく作ったか
   * @sideEffect DB に書き込む（最終ログインの更新、または利用者の作成）
   */
  async findOrCreateUser(candidate: NewAppUser): Promise<AppUserRow & { readonly created: boolean }> {
    const log = logger.fn('findOrCreateUser', { provider: candidate.provider });
    const result = await this.client.transaction(async (tx) => {
      await tx.query('INSERT INTO app_users (user_id, traveler_id, created_at, last_login_at) VALUES ($1::uuid, $2, $3::timestamptz, $3::timestamptz)',
        [candidate.userId, candidate.travelerId, candidate.now]);
      const linked = await tx.query(
        `INSERT INTO app_user_identities (provider, subject, user_id, created_at) VALUES ($1, $2, $3::uuid, $4::timestamptz)
         ON CONFLICT (provider, subject) DO NOTHING RETURNING user_id`,
        [candidate.provider, candidate.subject, candidate.userId, candidate.now],
      );
      if (linked.length > 0) return { userId: candidate.userId, travelerId: candidate.travelerId, created: true };
      await tx.query('DELETE FROM app_users WHERE user_id = $1::uuid', [candidate.userId]);
      const existing = await tx.query(
        `UPDATE app_users u SET last_login_at = $3::timestamptz FROM app_user_identities i
         WHERE i.provider = $1 AND i.subject = $2 AND u.user_id = i.user_id RETURNING u.user_id::text AS user_id, u.traveler_id`,
        [candidate.provider, candidate.subject, candidate.now],
      );
      if (existing[0] === undefined) throw new Error('app_user_identities: 対応する利用者がいない');
      return { userId: textOf(existing[0], 'user_id'), travelerId: textOf(existing[0], 'traveler_id'), created: false };
    });
    return log.exit(result, result.created ? 'created' : 'existing');
  }

  /**
   * セッションを作る。
   * @param sessionId トークンの SHA-256
   * @param userId 利用者ID
   * @param times 今の時刻と失効する時刻
   * @sideEffect DB に書き込む
   */
  async createSession(sessionId: string, userId: string, times: { readonly now: Instant; readonly expiresAt: Instant }): Promise<void> {
    const log = logger.fn('createSession');
    await this.client.query(
      'INSERT INTO app_sessions (session_id, user_id, created_at, last_seen_at, expires_at) VALUES ($1, $2::uuid, $3::timestamptz, $3::timestamptz, $4::timestamptz)',
      [sessionId, userId, times.now, times.expiresAt],
    );
    log.exit(undefined);
  }

  /**
   * 有効なセッションを探す（期限内で、最後の操作が idleCutoff より後）。
   * @param sessionId トークンの SHA-256
   * @param times 今の時刻・無操作の時間切れの境目・最後の操作を更新する境目
   * @returns セッションの利用者（無効なら undefined）
   */
  async findSession(sessionId: string, times: { readonly now: Instant; readonly idleCutoff: Instant; readonly touchCutoff: Instant }): Promise<AppSessionRow | undefined> {
    const log = logger.fn('findSession');
    const rows = await this.client.query(
      `SELECT u.user_id::text AS user_id, u.traveler_id, (s.last_seen_at < $4::timestamptz) AS stale
       FROM app_sessions s JOIN app_users u ON u.user_id = s.user_id
       WHERE s.session_id = $1 AND s.expires_at > $2::timestamptz AND s.last_seen_at > $3::timestamptz`,
      [sessionId, times.now, times.idleCutoff, times.touchCutoff],
    );
    const row = rows[0];
    if (row === undefined) return log.exit(undefined, 'none');
    return log.exit({ userId: textOf(row, 'user_id'), travelerId: textOf(row, 'traveler_id'), stale: row['stale'] === true });
  }

  /**
   * セッションの最後の操作の時刻を進める。
   * @param sessionId トークンの SHA-256
   * @param now 今の時刻
   * @sideEffect DB を更新する
   */
  async touchSession(sessionId: string, now: Instant): Promise<void> {
    const log = logger.fn('touchSession');
    await this.client.query('UPDATE app_sessions SET last_seen_at = $2::timestamptz WHERE session_id = $1', [sessionId, now]);
    log.exit(undefined);
  }

  /**
   * セッションを消す（ログアウト）。
   * @param sessionId トークンの SHA-256
   * @sideEffect DB から削除する
   */
  async deleteSession(sessionId: string): Promise<void> {
    const log = logger.fn('deleteSession');
    await this.client.query('DELETE FROM app_sessions WHERE session_id = $1', [sessionId]);
    log.exit(undefined);
  }

  /**
   * 利用者がつないでいる提供元の一覧を返す。
   * @param userId 利用者ID
   * @returns 提供元の ID（つないだ順）
   */
  async providersOf(userId: string): Promise<readonly string[]> {
    const log = logger.fn('providersOf');
    const rows = await this.client.query('SELECT provider FROM app_user_identities WHERE user_id = $1::uuid ORDER BY created_at, provider', [userId]);
    return log.exit(rows.map((row) => textOf(row, 'provider')));
  }

  /**
   * 失効したセッションとログイン途中の値を消す（定期的な掃除）。
   * @param now 今の時刻
   * @param idleCutoff 無操作の時間切れの境目
   * @returns 消した件数
   * @sideEffect DB から削除する
   */
  async deleteExpired(now: Instant, idleCutoff: Instant): Promise<{ readonly sessions: number; readonly states: number }> {
    const log = logger.fn('deleteExpired');
    const sessions = await this.client.query(
      'DELETE FROM app_sessions WHERE expires_at <= $1::timestamptz OR last_seen_at <= $2::timestamptz RETURNING 1', [now, idleCutoff]);
    const states = await this.client.query('DELETE FROM app_login_states WHERE expires_at <= $1::timestamptz RETURNING 1', [now]);
    return log.exit({ sessions: sessions.length, states: states.length });
  }
}
