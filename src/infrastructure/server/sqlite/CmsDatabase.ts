/**
 * @file 連携サーバーの DB（infrastructure/server/sqlite 層。Node 標準の node:sqlite。docs/09 §7.3、U1 の決定）
 * SQL はこのファイルだけに書く。中身の検証（parse）と版数・監査の手順は SqliteCmsOverlayRepository が受け持つ。
 *
 * | 表 | 中身 |
 * |---|---|
 * | cms_meta | 版番号（overlay.version）と保存日時（overlay.savedAt） |
 * | cms_spot_edits | スポットの編集（営業時間・便利情報） |
 * | cms_shop_events | CMS で登録したクーポン・イベント（取り下げても消さない＝CMS-E08） |
 * | cms_processed_operations | 処理済みの操作ID（二重登録の防止＝DI-07） |
 * | cms_audit_log | 変更履歴（いつ・誰が・何を・前と後＝DI-20。追記だけ） |
 *
 * 形の版は PRAGMA user_version で持つ（DI-15）。このクラスのメソッドは SQLite の例外をそのまま投げる（呼び出し側が Result に変える）。
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseInstant } from '@/Common/utils/date';
import type { Instant } from '@/Common/utils/date';
import type { CmsOverlayData } from '@/application/ports/CmsOverlayRepository';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';
import { uuid } from '@/infrastructure/random/CryptoIdGenerator';

const logger = createLogger('infrastructure/server/sqlite/CmsDatabase');

/** 今の形の版 */
export const CMS_DB_SCHEMA_VERSION = 1;
/** DB ごとの ID の長さ（英数字） */
const DB_ID_LENGTH = 12;

/** 形の版 1 */
const SCHEMA_V1 = `
CREATE TABLE cms_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE cms_spot_edits (
  spot_id TEXT PRIMARY KEY, position INTEGER NOT NULL, hours TEXT, amenities_json TEXT, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE cms_shop_events (
  id TEXT PRIMARY KEY, position INTEGER NOT NULL, spot_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, created_at TEXT NOT NULL, withdrawn_on TEXT
) STRICT;
CREATE INDEX cms_shop_events_by_spot ON cms_shop_events (spot_id);
CREATE TABLE cms_processed_operations (position INTEGER PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE) STRICT;
CREATE TABLE cms_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  target_type TEXT NOT NULL, target_id TEXT NOT NULL, before_json TEXT, after_json TEXT, overlay_version INTEGER NOT NULL
) STRICT;
`;

/** 版番号と保存日時（書くときの値） */
export interface CmsDatabaseWrite {
  readonly version: number;
  readonly savedAt: Instant;
}

/** DB の今の状態 */
export interface CmsDatabaseState {
  /**
   * DB ごとの ID（DB のファイルを作ったときに決まる）。ファイルを消して作り直すと版番号は 0 からになるので、
   * 版番号だけでなくこの ID も合わせて「どの版か」を見分ける（配った版番号と食い違わないように）
   */
  readonly dbId: string;
  readonly version: number;
  readonly savedAt?: Instant;
}

/** 変更履歴の1件 */
export interface CmsAuditEntry {
  readonly at: Instant;
  /** 操作した人（フェーズ2はアカウントID。デモは 'demo'） */
  readonly actor: string;
  /** 例 'shopEvent.register' */
  readonly action: string;
  readonly targetType: 'spot' | 'shopEvent' | 'overlay';
  readonly targetId: string;
  readonly before?: unknown;
  readonly after?: unknown;
  /** 変更後の版番号 */
  readonly overlayVersion: number;
}

/** 表から読んだ登録内容（未検証。parseStoredCmsOverlay にかける） */
export interface CmsRawRows {
  readonly spotEdits: readonly Record<string, unknown>[];
  readonly shopEvents: readonly Record<string, unknown>[];
  readonly processedOperationIds: readonly unknown[];
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
 * JSON の列を読む（壊れていれば null を返し、後の検証で落とす）。
 * @param value 列の値
 * @returns JSON の値（NULL なら undefined）
 */
function jsonColumn(value: SQLOutputValue | undefined): unknown { // audit-ignore: fnlog-missing 行ごとに多数回呼ぶ小さな変換（readRows で記録する）
  const raw = text(value);
  if (raw === undefined) return undefined;
  const parsed = parseJsonText(raw, 'CmsDatabaseColumn');
  return parsed.ok ? parsed.value : null;
}

/**
 * 省略できる項目を持つオブジェクトを作る（undefined の項目は入れない）。
 * @param fields 項目
 * @returns undefined を除いたオブジェクト
 */
function compact(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}

/** 連携サーバーの DB */
export class CmsDatabase {
  private readonly listeners = new Set<(state: CmsDatabaseState) => void>();

  /**
   * 開いた接続を受け取る（open から作る）。
   * @param connection node:sqlite の接続
   */
  private constructor(private readonly connection: DatabaseSync) {}

  /**
   * DB を開き、形を今の版にそろえる。
   * @param path ファイルの場所（':memory:' でメモリ上）
   * @returns 成功: DB。失敗: STORAGE_FAILED（開けない・形の版が新しすぎる）
   * @sideEffect フォルダとファイルを作る
   */
  static open(path: string): Result<CmsDatabase> {
    const log = logger.fn('open', { memory: path === ':memory:' });
    try {
      if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
      const connection = new DatabaseSync(path);
      connection.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
      const migrated = CmsDatabase.migrate(connection);
      if (!migrated.ok) {
        connection.close();
        return log.fail(migrated);
      }
      return log.exit(ok(new CmsDatabase(connection)));
    } catch (error) {
      log.error('DB を開けませんでした');
      return log.fail(fail(AppError.of('STORAGE_FAILED', 'データベースを開けませんでした', undefined, error)));
    }
  }

  /**
   * 形の版をそろえる（今は版 1 だけ）。
   * @param connection 接続
   * @returns 成功: void。失敗: STORAGE_FAILED（このプログラムより新しい版）
   * @sideEffect 表を作り、user_version を書く
   */
  private static migrate(connection: DatabaseSync): Result<void> {
    const log = logger.fn('migrate');
    const current = Number(connection.prepare('PRAGMA user_version').get()?.['user_version'] ?? 0);
    if (current > CMS_DB_SCHEMA_VERSION) {
      return log.fail(fail(AppError.of('STORAGE_FAILED', 'データベースの版が新しすぎます', { current, supported: CMS_DB_SCHEMA_VERSION })));
    }
    if (current === 0) {
      connection.exec(`BEGIN; ${SCHEMA_V1} PRAGMA user_version = ${CMS_DB_SCHEMA_VERSION}; COMMIT;`);
      log.info('データベースの表を作りました', { version: CMS_DB_SCHEMA_VERSION });
    }
    // DB ごとの ID（無ければ作る。推測されにくい乱数＝SEC-12。公開してよい値）
    connection.prepare("INSERT OR IGNORE INTO cms_meta (key, value) VALUES ('db.id', ?)").run(uuid().replace(/-/g, '').slice(0, DB_ID_LENGTH));
    return log.exit(ok(undefined));
  }

  /**
   * 今の状態（DB の ID・版番号・保存日時）を読む。
   * @returns 版番号（未保存は 0）と保存日時
   * @throws SQLite の例外（Result が要るときは tryReadState を使う）
   */
  readState(): CmsDatabaseState {
    const log = logger.fn('readState');
    const rows = this.connection.prepare("SELECT key, value FROM cms_meta WHERE key IN ('db.id', 'overlay.version', 'overlay.savedAt')").all();
    const meta = new Map(rows.map((row) => [text(row['key']), text(row['value'])]));
    const version = Number.parseInt(meta.get('overlay.version') ?? '0', 10);
    const rawSavedAt = meta.get('overlay.savedAt');
    const savedAt = rawSavedAt === undefined ? undefined : parseInstant(rawSavedAt);
    return log.exit({
      dbId: meta.get('db.id') ?? 'unknown', version: Number.isSafeInteger(version) ? version : 0, ...(savedAt?.ok === true ? { savedAt: savedAt.value } : {}),
    });
  }

  /**
   * 今の状態を読む（失敗を Result で返す）。
   * @returns 成功: 状態。失敗: STORAGE_FAILED
   */
  tryReadState(): Result<CmsDatabaseState> {
    const log = logger.fn('tryReadState');
    try {
      return log.exit(ok(this.readState()));
    } catch (error) {
      log.error('DB の状態を読めませんでした');
      return log.fail(fail(AppError.of('STORAGE_FAILED', '保存先を読み書きできませんでした', { reason: 'state' }, error)));
    }
  }

  /**
   * 版番号と保存日時を書く。
   * @param state 版番号と保存日時
   * @sideEffect cms_meta を書き換える
   */
  writeState(state: CmsDatabaseWrite): void {
    const log = logger.fn('writeState', { version: state.version });
    const upsert = this.connection.prepare('INSERT INTO cms_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    upsert.run('overlay.version', String(state.version));
    upsert.run('overlay.savedAt', state.savedAt);
    log.exit(undefined);
  }

  /**
   * 登録内容を表から読む（未検証）。
   * @returns 表の中身
   */
  readRows(): CmsRawRows {
    const log = logger.fn('readRows');
    const edits = this.connection.prepare('SELECT spot_id, hours, amenities_json, updated_at FROM cms_spot_edits ORDER BY position').all();
    const events = this.connection.prepare(
      'SELECT id, spot_id, kind, title, description, start_date, end_date, created_at, withdrawn_on FROM cms_shop_events ORDER BY position',
    ).all();
    const operations = this.connection.prepare('SELECT operation_id FROM cms_processed_operations ORDER BY position').all();
    return log.exit({
      spotEdits: edits.map((r) => compact({ spotId: r['spot_id'], hours: text(r['hours']), amenities: jsonColumn(r['amenities_json']), updatedAt: r['updated_at'] })),
      shopEvents: events.map((r) => compact({
        id: r['id'], spotId: r['spot_id'], kind: r['kind'], title: r['title'], description: r['description'],
        start: r['start_date'], end: r['end_date'], createdAt: r['created_at'], withdrawnOn: text(r['withdrawn_on']),
      })),
      processedOperationIds: operations.map((r) => r['operation_id']),
    }, `edits=${edits.length} events=${events.length}`);
  }

  /**
   * 登録内容を丸ごと書き換える（トランザクションの中で呼ぶ）。
   * @param data 検証済みの登録内容
   * @sideEffect 3つの表を消して書き直す
   */
  replaceRows(data: CmsOverlayData): void {
    const log = logger.fn('replaceRows', { edits: data.spotEdits.length, events: data.shopEvents.length });
    this.connection.exec('DELETE FROM cms_spot_edits; DELETE FROM cms_shop_events; DELETE FROM cms_processed_operations;');
    const edit = this.connection.prepare('INSERT INTO cms_spot_edits (spot_id, position, hours, amenities_json, updated_at) VALUES (?, ?, ?, ?, ?)');
    data.spotEdits.forEach((e, i) => edit.run(e.spotId, i, e.hours ?? null, e.amenities === undefined ? null : JSON.stringify(e.amenities), e.updatedAt));
    const event = this.connection.prepare(
      'INSERT INTO cms_shop_events (id, position, spot_id, kind, title, description, start_date, end_date, created_at, withdrawn_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    data.shopEvents.forEach((e, i) => event.run(e.id, i, e.spotId, e.kind, e.title, e.description, e.start, e.end, e.createdAt, e.withdrawnOn ?? null));
    const operation = this.connection.prepare('INSERT INTO cms_processed_operations (position, operation_id) VALUES (?, ?)');
    data.processedOperationIds.forEach((id, i) => operation.run(i, id));
    log.exit(undefined);
  }

  /**
   * 変更履歴を追記する。
   * @param entries 変更履歴
   * @sideEffect cms_audit_log に追記する
   */
  appendAudit(entries: readonly CmsAuditEntry[]): void {
    const log = logger.fn('appendAudit', { count: entries.length });
    const insert = this.connection.prepare(
      'INSERT INTO cms_audit_log (at, actor, action, target_type, target_id, before_json, after_json, overlay_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const e of entries) {
      const before = e.before === undefined ? null : JSON.stringify(e.before);
      const after = e.after === undefined ? null : JSON.stringify(e.after);
      insert.run(e.at, e.actor, e.action, e.targetType, e.targetId, before, after, e.overlayVersion);
    }
    log.exit(undefined);
  }

  /**
   * 新しい順に変更履歴を読む（確認・テスト用）。
   * @param limit 件数
   * @returns 変更履歴（前と後は JSON を戻したもの）
   */
  recentAudit(limit: number): readonly CmsAuditEntry[] {
    const log = logger.fn('recentAudit', { limit });
    const rows = this.connection.prepare(
      'SELECT at, actor, action, target_type, target_id, before_json, after_json, overlay_version FROM cms_audit_log ORDER BY id DESC LIMIT ?',
    ).all(limit);
    return log.exit(rows.map((r) => compact({
      at: r['at'], actor: r['actor'], action: r['action'], targetType: r['target_type'], targetId: r['target_id'],
      before: jsonColumn(r['before_json']), after: jsonColumn(r['after_json']), overlayVersion: Number(r['overlay_version']),
    }) as unknown as CmsAuditEntry));
  }

  /**
   * 仕事を1つのトランザクションで行う（途中で例外なら全部取り消す）。
   * @param work 仕事
   * @returns 仕事の戻り値
   * @throws 仕事や SQLite の例外（取り消したあとで投げ直す）
   */
  inTransaction<T>(work: () => T): T {
    const log = logger.fn('inTransaction');
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.connection.exec('COMMIT');
      return log.exit(result);
    } catch (error) {
      this.connection.exec('ROLLBACK');
      log.warn('トランザクションを取り消しました');
      throw error;
    }
  }

  /**
   * 登録内容が変わったときに呼ぶ関数を登録する。
   * @param listener 新しい版番号と保存日時を受け取る関数
   * @returns 登録をやめる関数
   */
  onChange(listener: (state: CmsDatabaseState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 登録内容が変わったことを知らせる（トランザクションを確定したあとに呼ぶ）。
   * @param state 新しい版番号と保存日時
   * @sideEffect 登録された関数を呼ぶ
   */
  notifyChange(state: CmsDatabaseState): void {
    const log = logger.fn('notifyChange', { version: state.version, listeners: this.listeners.size });
    for (const listener of this.listeners) listener(state);
    log.exit(undefined);
  }

  /**
   * 接続を閉じる。
   * @sideEffect 以後は使えない
   */
  close(): void {
    const log = logger.fn('close');
    this.listeners.clear();
    this.connection.close();
    log.exit(undefined);
  }
}
