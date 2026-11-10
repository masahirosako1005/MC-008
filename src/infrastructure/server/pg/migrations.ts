/**
 * @file PostgreSQL の形の版と、版を進める手順（infrastructure/server/pg 層。docs/12 §4、DI-15）
 * 版は schema_migrations の表で持ち、古い DB は順に進める。DB のほうが新しければ進めずに失敗する（古いサーバーで新しい DB を壊さない）。
 * 複数のサーバーが同時に起動しても二重に進めないよう、トランザクションの間だけ有効なアドバイザリロックを取る。
 *
 * | 版 | 表 | 中身 |
 * |---|---|---|
 * | 1 | travelers | 旅人（表示名・プロフィール・楽観ロックの版数） |
 * | 1 | traveler_discoveries / traveler_visits / traveler_redemptions | 発見・訪問・クーポン利用（追記だけ。更新はトリガーで拒否） |
 * | 1 | traveler_operations | 処理済みの操作ID（直近の分。DI-07） |
 * | 1 | point_ledgers / ledger_entries | ポイント台帳（追記だけ＝DI-06） |
 * | 2 | app_users / app_user_identities | 利用者と、外部ログイン（提供元＋sub）との対応 |
 * | 2 | app_sessions / app_login_states | セッションと、ログイン途中の state・nonce・PKCE |
 *
 * 保存するのはスポットID・地区ID・日時・暦日だけで、生の座標は持たない（PRV-03、SEC-13）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { SqlClient, SqlExecutor } from '@/infrastructure/server/pg/SqlClient';

const logger = createLogger('infrastructure/server/pg/migrations');

/** アドバイザリロックの鍵（このアプリの形の版の更新用。値に意味はない） */
const MIGRATION_LOCK_KEY = 808_001;

/** 形の版 1：旅人と台帳 */
const SCHEMA_V1 = `
CREATE FUNCTION forbid_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'append-only table: %', TG_TABLE_NAME;
END
$fn$;

CREATE TABLE travelers (
  traveler_id text PRIMARY KEY CHECK (traveler_id ~ '^t_[0-9a-z]{2,40}$'),
  nickname text NOT NULL CHECK (char_length(nickname) <= 80),
  profile text NOT NULL CHECK (profile IN ('first', 'regular', 'user')),
  version integer NOT NULL CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE traveler_discoveries (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  traveler_id text NOT NULL REFERENCES travelers ON DELETE CASCADE,
  spot_id text NOT NULL,
  district_id text NOT NULL,
  discovered_at timestamptz NOT NULL,
  UNIQUE (traveler_id, spot_id)
);
CREATE TRIGGER traveler_discoveries_no_update BEFORE UPDATE ON traveler_discoveries FOR EACH ROW EXECUTE FUNCTION forbid_update();

CREATE TABLE traveler_visits (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  traveler_id text NOT NULL REFERENCES travelers ON DELETE CASCADE,
  spot_id text NOT NULL,
  district_id text NOT NULL,
  visited_at timestamptz NOT NULL,
  local_date date NOT NULL,
  operation_id text NOT NULL,
  UNIQUE (traveler_id, spot_id, local_date),
  UNIQUE (traveler_id, operation_id)
);
CREATE INDEX traveler_visits_by_district_date ON traveler_visits (district_id, local_date);
CREATE INDEX traveler_visits_by_spot_date ON traveler_visits (spot_id, local_date);
CREATE INDEX traveler_visits_by_date ON traveler_visits (local_date);
CREATE TRIGGER traveler_visits_no_update BEFORE UPDATE ON traveler_visits FOR EACH ROW EXECUTE FUNCTION forbid_update();

CREATE TABLE traveler_redemptions (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  traveler_id text NOT NULL REFERENCES travelers ON DELETE CASCADE,
  shop_event_id text NOT NULL,
  spot_id text NOT NULL,
  redeemed_at timestamptz NOT NULL,
  operation_id text NOT NULL,
  UNIQUE (traveler_id, shop_event_id)
);
CREATE INDEX traveler_redemptions_by_event ON traveler_redemptions (shop_event_id);
CREATE TRIGGER traveler_redemptions_no_update BEFORE UPDATE ON traveler_redemptions FOR EACH ROW EXECUTE FUNCTION forbid_update();

CREATE TABLE traveler_operations (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  traveler_id text NOT NULL REFERENCES travelers ON DELETE CASCADE,
  operation_id text NOT NULL,
  UNIQUE (traveler_id, operation_id)
);

CREATE TABLE point_ledgers (
  traveler_id text PRIMARY KEY CHECK (traveler_id ~ '^t_[0-9a-z]{2,40}$'),
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  traveler_id text NOT NULL REFERENCES point_ledgers ON DELETE CASCADE,
  entry_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('visit', 'welcomeBack', 'purchase')),
  points integer NOT NULL CHECK (points >= 0),
  district_id text NOT NULL,
  spot_id text NOT NULL,
  at timestamptz NOT NULL,
  local_date date NOT NULL,
  UNIQUE (traveler_id, entry_id)
);
CREATE INDEX ledger_entries_by_date ON ledger_entries (local_date);
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_update();
`;

/**
 * 形の版 2：利用者・外部ログイン・セッション（docs/12 §5）
 * 外部ログインから保存するのは「提供元＋その中での利用者ID（sub）」だけ（メール・氏名・写真は持たない＝PRV-06）。
 * セッションと、ログイン途中の state は、値そのものではなく SHA-256 を主キーにする（DB が漏れても使えない）。
 */
const SCHEMA_V2 = `
CREATE TABLE app_users (
  user_id uuid PRIMARY KEY,
  traveler_id text NOT NULL UNIQUE CHECK (traveler_id ~ '^t_[0-9a-z]{2,40}$'),
  created_at timestamptz NOT NULL,
  last_login_at timestamptz NOT NULL
);

CREATE TABLE app_user_identities (
  provider text NOT NULL CHECK (provider ~ '^[a-z]{2,16}$'),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX app_user_identities_by_user ON app_user_identities (user_id);

CREATE TABLE app_sessions (
  session_id text PRIMARY KEY CHECK (session_id ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES app_users ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX app_sessions_by_user ON app_sessions (user_id);
CREATE INDEX app_sessions_by_expiry ON app_sessions (expires_at);

CREATE TABLE app_login_states (
  state_id text PRIMARY KEY CHECK (state_id ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX app_login_states_by_expiry ON app_login_states (expires_at);
`;

/** 形の版ごとの SQL（古い DB はこの順に進める。出した版の SQL は書き換えず、次の版を足す） */
const MIGRATIONS: readonly { readonly version: number; readonly name: string; readonly sql: string }[] = [
  { version: 1, name: 'travelers-and-ledgers', sql: SCHEMA_V1 },
  { version: 2, name: 'app-users-and-sessions', sql: SCHEMA_V2 },
];

/** 今の形の版 */
export const PG_SCHEMA_VERSION = MIGRATIONS.length;

/** 版を進めた結果 */
export interface MigrationOutcome {
  /** 進める前の版（空の DB は 0） */
  readonly from: number;
  /** 進めた後の版 */
  readonly to: number;
}

/**
 * DB の今の版を読む（版の表が無ければ作る）。
 * @param tx トランザクション
 * @returns 今の版（空の DB は 0）
 */
async function readVersion(tx: SqlExecutor): Promise<number> {
  const log = logger.fn('readVersion');
  await tx.execScript(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const rows = await tx.query('SELECT coalesce(max(version), 0)::integer AS version FROM schema_migrations');
  const version = rows[0]?.['version'];
  return log.exit(typeof version === 'number' ? version : 0);
}

/**
 * DB の形を今の版まで進める（サーバーの起動時に1回呼ぶ）。途中で失敗したら何も変えない（DDL もトランザクションの中）。
 * @param client PostgreSQL への接続
 * @returns 成功: 進める前と後の版。失敗: STORAGE_FAILED（DB のほうが新しい・SQL の失敗）
 * @sideEffect 表・索引・トリガーを作る
 */
export async function migrate(client: SqlClient): Promise<Result<MigrationOutcome>> {
  const log = logger.fn('migrate', { target: PG_SCHEMA_VERSION });
  try {
    const outcome = await client.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      const from = await readVersion(tx);
      if (from > PG_SCHEMA_VERSION) return { from, to: from };
      for (const step of MIGRATIONS.filter((m) => m.version > from)) {
        await tx.execScript(step.sql);
        await tx.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [step.version, step.name]);
      }
      return { from, to: PG_SCHEMA_VERSION };
    });
    if (outcome.to > PG_SCHEMA_VERSION) {
      return log.fail(fail(AppError.of('STORAGE_FAILED', 'データベースの版がこのサーバーより新しいため起動できません', { db: outcome.to, server: PG_SCHEMA_VERSION })));
    }
    return log.exit(ok(outcome), `from=${outcome.from} to=${outcome.to}`);
  } catch (error) {
    log.error('形の版を進められなかった', { message: error instanceof Error ? error.message : 'unknown' });
    return log.fail(fail(AppError.of('STORAGE_FAILED', 'データベースを準備できませんでした', undefined, error)));
  }
}
