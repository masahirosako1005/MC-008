/**
 * @file アカウント・セッション・ログインの記録の表（infrastructure/server/sqlite 層。docs/09 CMS-A04〜A07、§4.1、SEC-19、SEC-24）
 * CmsDatabase と同じ SQLite ファイルの中の、ログインに関する表の SQL をここに集める（登録内容の表は CmsDatabase.ts）。
 *
 * | 表 | 中身 |
 * |---|---|
 * | cms_accounts | アカウント（ログインID・パスワードのハッシュ・ロール・状態・失敗回数とロック・デモ用か） |
 * | cms_account_shops | アカウントが担当する店舗 |
 * | cms_sessions | セッション（トークンの SHA-256・有効期限・最後の操作・取り消し） |
 * | cms_auth_log | ログイン・権限エラー・アカウントの変更の記録（追記だけ。IP・パスワード・メールは書かない） |
 *
 * メソッドは SQLite の例外をそのまま投げる（AuthService が Result に変える）。読んだ行は AuthService が検証してから使う。
 */
import type { SQLOutputValue, StatementSync } from 'node:sqlite';
import { createLogger } from '@/Common/logging/logger';
import type { CmsAccountStatus, CmsRole } from '@/application/dto/CmsAuthDto';

const logger = createLogger('infrastructure/server/sqlite/SqliteAuthStore');

/** DB への入口（CmsDatabase が実装する） */
export interface AuthDbAccess {
  /**
   * SQL を準備する。
   * @param sql SQL（プレースホルダは ?）
   */
  prepare(sql: string): StatementSync;
  /**
   * 仕事を1つのトランザクションで行う。
   * @param work 仕事
   */
  inTransaction<T>(work: () => T): T;
}

/** 形の版 2 で足す表（CmsDatabase.migrate が流す） */
export const AUTH_SCHEMA_V2 = `
CREATE TABLE cms_accounts (
  id TEXT PRIMARY KEY, login_id TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL,
  display_name TEXT NOT NULL, status TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT, last_login_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE cms_account_shops (account_id TEXT NOT NULL, spot_id TEXT NOT NULL, PRIMARY KEY (account_id, spot_id)) STRICT;
CREATE TABLE cms_sessions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL, revoked_at TEXT
) STRICT;
CREATE INDEX cms_sessions_by_account ON cms_sessions (account_id);
CREATE TABLE cms_auth_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  target_id TEXT NOT NULL, detail_json TEXT
) STRICT;
`;

/** アカウントの行 */
export interface AccountRecord {
  readonly id: string;
  readonly loginId: string;
  readonly passwordHash: string;
  readonly role: CmsRole;
  readonly displayName: string;
  readonly status: CmsAccountStatus;
  readonly demo: boolean;
  readonly failedLogins: number;
  /** ロックが解ける日時（ISO。ロックされていなければ無い） */
  readonly lockedUntil?: string;
  readonly lastLoginAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly shopIds: readonly string[];
}

/** アカウントの新規作成の入力（shopIds を含む） */
export type NewAccountRecord = Omit<AccountRecord, 'failedLogins' | 'lockedUntil' | 'lastLoginAt'>;

/** アカウントの書き換え（指定した項目だけ。null は消す） */
export interface AccountPatch {
  readonly passwordHash?: string;
  readonly status?: CmsAccountStatus;
  readonly displayName?: string;
  readonly failedLogins?: number;
  readonly lockedUntil?: string | null;
  readonly lastLoginAt?: string;
  readonly updatedAt: string;
}

/** セッションの行 */
export interface SessionRecord {
  readonly id: string;
  readonly accountId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastSeenAt: string;
  readonly revokedAt?: string;
}

/** ログイン・アカウントの記録の1件 */
export interface AuthLogEntry {
  readonly at: string;
  /** 操作した人（アカウントID。ログイン前は 'anonymous'、コマンドラインは 'cli'） */
  readonly actor: string;
  /** 例 'login.success'、'login.failed'、'account.create' */
  readonly action: string;
  /** 対象（アカウントID など。無ければ '-'） */
  readonly targetId: string;
  /** 補足（文字・数値・真偽だけ。個人情報は入れない） */
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * SQLite の値を文字列として読む。
 * @param value 列の値
 * @returns 文字列（NULL・ほかの型は undefined）
 */
function text(value: SQLOutputValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * ロールの列を読む（知らない値は店舗として扱わず、運営者でもない 'shopOwner' に倒さない＝そのまま返して AuthService が落とす）。
 * @param value 列の値
 * @returns ロール
 */
function roleOf(value: SQLOutputValue | undefined): CmsRole {
  return value === 'operator' ? 'operator' : 'shopOwner';
}

/** ログイン・アカウントの表 */
export class SqliteAuthStore {
  /**
   * 表への入口を受け取る。
   * @param db DB への入口
   */
  constructor(private readonly db: AuthDbAccess) {}

  /**
   * 行をアカウントにする（担当店舗も読む）。
   * @param row cms_accounts の行
   * @returns アカウント
   */
  private toAccount(row: Record<string, SQLOutputValue>): AccountRecord {
    const log = logger.fn('toAccount');
    const id = text(row['id']) ?? '';
    const shops = this.db.prepare('SELECT spot_id FROM cms_account_shops WHERE account_id = ? ORDER BY spot_id').all(id);
    const lockedUntil = text(row['locked_until']);
    const lastLoginAt = text(row['last_login_at']);
    return log.exit({
      id, loginId: text(row['login_id']) ?? '', passwordHash: text(row['password_hash']) ?? '', role: roleOf(row['role']),
      displayName: text(row['display_name']) ?? '', status: row['status'] === 'suspended' ? 'suspended' : 'active',
      demo: Number(row['is_demo']) === 1, failedLogins: Number(row['failed_logins']) || 0,
      ...(lockedUntil === undefined ? {} : { lockedUntil }), ...(lastLoginAt === undefined ? {} : { lastLoginAt }),
      createdAt: text(row['created_at']) ?? '', updatedAt: text(row['updated_at']) ?? '',
      shopIds: shops.map((s) => text(s['spot_id']) ?? '').filter((s) => s.length > 0),
    });
  }

  /**
   * ログインID でアカウントを探す。
   * @param loginId ログインID（正規化済み）
   * @returns アカウント（無ければ undefined）
   */
  findAccountByLoginId(loginId: string): AccountRecord | undefined {
    const log = logger.fn('findAccountByLoginId');
    const row = this.db.prepare('SELECT * FROM cms_accounts WHERE login_id = ?').get(loginId);
    return log.exit(row === undefined ? undefined : this.toAccount(row), row === undefined ? 'none' : 'found');
  }

  /**
   * ID でアカウントを探す。
   * @param id アカウントID
   * @returns アカウント（無ければ undefined）
   */
  findAccountById(id: string): AccountRecord | undefined {
    const log = logger.fn('findAccountById', { id });
    const row = this.db.prepare('SELECT * FROM cms_accounts WHERE id = ?').get(id);
    return log.exit(row === undefined ? undefined : this.toAccount(row), row === undefined ? 'none' : 'found');
  }

  /**
   * すべてのアカウントを返す（作った順）。
   * @returns アカウントの一覧
   */
  listAccounts(): readonly AccountRecord[] {
    const log = logger.fn('listAccounts');
    const rows = this.db.prepare('SELECT * FROM cms_accounts ORDER BY created_at, id').all();
    return log.exit(rows.map((row) => this.toAccount(row)), `count=${rows.length}`);
  }

  /**
   * アカウントの数を返す（最初の運営者を作るときの判定に使う）。
   * @returns 数
   */
  countAccounts(): number {
    return Number(this.db.prepare('SELECT COUNT(*) AS n FROM cms_accounts').get()?.['n'] ?? 0);
  }

  /**
   * アカウントを作る（担当店舗も一緒に）。
   * @param account 新しいアカウント
   * @sideEffect cms_accounts・cms_account_shops に追記する
   */
  insertAccount(account: NewAccountRecord): void {
    const log = logger.fn('insertAccount', { id: account.id, role: account.role, shops: account.shopIds.length });
    this.db.inTransaction(() => {
      this.db.prepare(
        'INSERT INTO cms_accounts (id, login_id, password_hash, role, display_name, status, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(account.id, account.loginId, account.passwordHash, account.role, account.displayName, account.status, account.demo ? 1 : 0, account.createdAt, account.updatedAt);
      this.writeShops(account.id, account.shopIds);
    });
    log.exit(undefined);
  }

  /**
   * 担当店舗を書く（置き換え。トランザクションの中で呼ぶ）。
   * @param accountId アカウントID
   * @param shopIds 店舗
   * @sideEffect cms_account_shops を書き換える
   */
  private writeShops(accountId: string, shopIds: readonly string[]): void {
    const log = logger.fn('writeShops', { accountId, shops: shopIds.length });
    this.db.prepare('DELETE FROM cms_account_shops WHERE account_id = ?').run(accountId);
    const insert = this.db.prepare('INSERT OR IGNORE INTO cms_account_shops (account_id, spot_id) VALUES (?, ?)');
    for (const spotId of shopIds) insert.run(accountId, spotId);
    log.exit(undefined);
  }

  /**
   * 担当店舗を置き換える。
   * @param accountId アカウントID
   * @param shopIds 店舗
   * @param updatedAt 更新日時
   * @sideEffect cms_account_shops を書き換え、updated_at を進める
   */
  replaceAccountShops(accountId: string, shopIds: readonly string[], updatedAt: string): void {
    const log = logger.fn('replaceAccountShops', { accountId, shops: shopIds.length });
    this.db.inTransaction(() => {
      this.writeShops(accountId, shopIds);
      this.db.prepare('UPDATE cms_accounts SET updated_at = ? WHERE id = ?').run(updatedAt, accountId);
    });
    log.exit(undefined);
  }

  /**
   * アカウントの項目を書き換える（指定した項目だけ）。
   * @param id アカウントID
   * @param patch 書き換える項目
   * @sideEffect cms_accounts を書き換える
   */
  updateAccount(id: string, patch: AccountPatch): void {
    const log = logger.fn('updateAccount', { id, fields: Object.keys(patch) });
    const sets: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [patch.updatedAt];
    if (patch.passwordHash !== undefined) { sets.push('password_hash = ?'); params.push(patch.passwordHash); }
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.displayName !== undefined) { sets.push('display_name = ?'); params.push(patch.displayName); }
    if (patch.failedLogins !== undefined) { sets.push('failed_logins = ?'); params.push(patch.failedLogins); }
    if (patch.lockedUntil !== undefined) { sets.push('locked_until = ?'); params.push(patch.lockedUntil); }
    if (patch.lastLoginAt !== undefined) { sets.push('last_login_at = ?'); params.push(patch.lastLoginAt); }
    params.push(id);
    this.db.prepare(`UPDATE cms_accounts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    log.exit(undefined);
  }

  /**
   * セッションを作る。
   * @param session セッション
   * @sideEffect cms_sessions に追記する
   */
  insertSession(session: SessionRecord): void {
    const log = logger.fn('insertSession', { accountId: session.accountId });
    this.db.prepare('INSERT INTO cms_sessions (id, account_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run(session.id, session.accountId, session.createdAt, session.expiresAt, session.lastSeenAt);
    log.exit(undefined);
  }

  /**
   * セッションを探す。
   * @param id セッション ID（トークンの SHA-256）
   * @returns セッション（無ければ undefined）
   */
  findSession(id: string): SessionRecord | undefined {
    const log = logger.fn('findSession');
    const row = this.db.prepare('SELECT * FROM cms_sessions WHERE id = ?').get(id);
    if (row === undefined) return log.exit(undefined, 'none');
    const revokedAt = text(row['revoked_at']);
    return log.exit({
      id: text(row['id']) ?? '', accountId: text(row['account_id']) ?? '', createdAt: text(row['created_at']) ?? '',
      expiresAt: text(row['expires_at']) ?? '', lastSeenAt: text(row['last_seen_at']) ?? '', ...(revokedAt === undefined ? {} : { revokedAt }),
    });
  }

  /**
   * 最後の操作の日時を進める。
   * @param id セッション ID
   * @param lastSeenAt 日時
   * @sideEffect cms_sessions を書き換える
   */
  touchSession(id: string, lastSeenAt: string): void {
    this.db.prepare('UPDATE cms_sessions SET last_seen_at = ? WHERE id = ?').run(lastSeenAt, id);
  }

  /**
   * セッションを取り消す（ログアウト）。
   * @param id セッション ID
   * @param at 日時
   * @sideEffect cms_sessions を書き換える
   */
  revokeSession(id: string, at: string): void {
    this.db.prepare('UPDATE cms_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(at, id);
  }

  /**
   * アカウントのセッションをまとめて取り消す（パスワード変更・停止）。
   * @param accountId アカウントID
   * @param at 日時
   * @param exceptId 残すセッション ID（自分のログインを残すとき）
   * @returns 取り消した数
   * @sideEffect cms_sessions を書き換える
   */
  revokeSessionsOfAccount(accountId: string, at: string, exceptId?: string): number {
    const log = logger.fn('revokeSessionsOfAccount', { accountId, keepOne: exceptId !== undefined });
    const result = exceptId === undefined
      ? this.db.prepare('UPDATE cms_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL').run(at, accountId)
      : this.db.prepare('UPDATE cms_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL AND id <> ?').run(at, accountId, exceptId);
    return log.exit(Number(result.changes));
  }

  /**
   * 期限切れ・取り消し済みのセッションを消す（定期的な掃除）。
   * @param before この日時より前に期限が切れたものを消す
   * @returns 消した数
   * @sideEffect cms_sessions から削除する
   */
  deleteSessionsExpiredBefore(before: string): number {
    const log = logger.fn('deleteSessionsExpiredBefore');
    const result = this.db.prepare('DELETE FROM cms_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)').run(before, before);
    return log.exit(Number(result.changes));
  }

  /**
   * ログイン・アカウントの記録を追記する。
   * @param entry 記録
   * @sideEffect cms_auth_log に追記する
   */
  appendAuthLog(entry: AuthLogEntry): void {
    const log = logger.fn('appendAuthLog', { action: entry.action });
    this.db.prepare('INSERT INTO cms_auth_log (at, actor, action, target_id, detail_json) VALUES (?, ?, ?, ?, ?)')
      .run(entry.at, entry.actor, entry.action, entry.targetId, entry.detail === undefined ? null : JSON.stringify(entry.detail));
    log.exit(undefined);
  }

  /**
   * 新しい順に記録を読む（確認・テスト用）。
   * @param limit 件数
   * @returns 記録
   */
  recentAuthLog(limit: number): readonly AuthLogEntry[] {
    const log = logger.fn('recentAuthLog', { limit });
    const rows = this.db.prepare('SELECT at, actor, action, target_id, detail_json FROM cms_auth_log ORDER BY id DESC LIMIT ?').all(limit);
    return log.exit(rows.map((row) => {
      const detail = text(row['detail_json']);
      return {
        at: text(row['at']) ?? '', actor: text(row['actor']) ?? '', action: text(row['action']) ?? '', targetId: text(row['target_id']) ?? '',
        ...(detail === undefined ? {} : { detail: JSON.parse(detail) as Readonly<Record<string, string | number | boolean>> }),
      };
    }));
  }

  /**
   * 古い記録を消す（保持期間の終わり。docs/09 §6.4 は3年（仮））。
   * @param before この日時より前の記録を消す
   * @returns 消した数
   * @sideEffect cms_auth_log から削除する
   */
  deleteAuthLogBefore(before: string): number {
    const log = logger.fn('deleteAuthLogBefore');
    const result = this.db.prepare('DELETE FROM cms_auth_log WHERE at < ?').run(before);
    return log.exit(Number(result.changes));
  }
}
