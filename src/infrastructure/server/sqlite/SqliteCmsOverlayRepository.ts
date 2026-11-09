/**
 * @file 店舗CMS の登録内容の SQLite リポジトリ（infrastructure/server/sqlite 層。CmsOverlayRepository の連携サーバー版。docs/09 §7.3）
 * フェーズ1の LocalStorageCmsOverlayRepository と同じ約束を守る：
 * - 版数による楽観ロック（読んだときの版数と違えば CONFLICT＝DI-10）
 * - 読み書きの両方で、保存データと同じ parseStoredCmsOverlay にかける（DI-01）
 * 加えて、保存のたびに変更履歴（前の値と後の値）を同じトランザクションで残し（DI-20）、確定したら DB の変更通知を出す
 * （公開スナップショットの SSE がそれを受けて、利用者アプリへ新しい版番号を知らせる）。
 * 1回の要求ごとに作り、操作者（actor）をそのつど渡す（フェーズ2ではログイン中のアカウント）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { CmsOverlay, CmsOverlayData, CmsOverlayRepository } from '@/application/ports/CmsOverlayRepository';
import type { Clock } from '@/domain/ports/Clock';
import { diffCmsOverlay } from '@/infrastructure/server/sqlite/cmsAuditDiff';
import type { CmsDatabase, CmsDatabaseState } from '@/infrastructure/server/sqlite/CmsDatabase';
import { parseStoredCmsOverlay } from '@/infrastructure/storage/schema/cmsOverlayParser';

const logger = createLogger('infrastructure/server/sqlite/SqliteCmsOverlayRepository');

/** リポジトリの依存 */
export interface SqliteCmsOverlayRepositoryDeps {
  readonly db: CmsDatabase;
  /** 操作した人（変更履歴に残す。デモは 'demo'） */
  readonly actor: string;
  /** 保存日時・変更履歴の日時に使う時計（実時刻） */
  readonly clock: Clock;
}

/** 保存の結果（トランザクションの中で決める。保存後の状態は確定後の通知にそのまま使う） */
type SaveOutcome = { readonly kind: 'conflict'; readonly actual: number } | { readonly kind: 'saved'; readonly state: CmsDatabaseState };

/**
 * DB の失敗を作る。
 * @param reason 理由
 * @param cause 元の例外（ログ用）
 * @returns STORAGE_FAILED
 */
function storageFailed(reason: string, cause?: unknown): Result<never, AppError<'STORAGE_FAILED'>> {
  return fail(AppError.of('STORAGE_FAILED', '保存先を読み書きできませんでした', { reason }, cause));
}

/** 店舗CMS の登録内容の SQLite リポジトリ */
export class SqliteCmsOverlayRepository implements CmsOverlayRepository {
  /**
   * リポジトリを作る。
   * @param deps DB・操作者・時計
   */
  constructor(private readonly deps: SqliteCmsOverlayRepositoryDeps) {}

  /**
   * 今の登録内容を表から読み、検証する（トランザクションの中からも呼ぶ）。
   * @returns 成功: 登録内容。失敗: INVALID_INPUT（表の中身が壊れている）
   * @throws SQLite の例外
   */
  private readCurrent(): Result<{ readonly overlay: CmsOverlay; readonly state: CmsDatabaseState }> {
    const log = logger.fn('readCurrent');
    const state = this.deps.db.readState();
    const parsed = parseStoredCmsOverlay({ version: state.version, data: this.deps.db.readRows() });
    return parsed.ok ? log.exit(ok({ overlay: parsed.value, state })) : log.fail(parsed);
  }

  /**
   * 登録内容を読む。
   * @returns 成功: 登録内容（未保存なら版数 0 の空）。失敗: STORAGE_FAILED
   */
  async load(): Promise<Result<CmsOverlay>> {
    const log = logger.fn('load');
    try {
      const current = this.readCurrent();
      if (!current.ok) {
        log.error('DB の登録内容が検証に通りません', { rule: current.error.details?.['rule'] });
        return log.fail(storageFailed('invalidRows'));
      }
      return log.exit(ok(current.value.overlay), `version=${current.value.overlay.version}`);
    } catch (error) {
      log.error('DB を読めませんでした');
      return log.fail(storageFailed('read', error));
    }
  }

  /**
   * トランザクションの中で、版数を確かめて書き換え、変更履歴を残す。
   * @param data 検証済みの登録内容
   * @param expectedVersion 読んだときの版数
   * @returns 保存の結果
   * @throws SQLite の例外・表の中身が壊れているとき（呼び出し側でトランザクションごと取り消す）
   */
  private writeInTransaction(data: CmsOverlayData, expectedVersion: number): SaveOutcome {
    const log = logger.fn('writeInTransaction', { expectedVersion });
    const before = this.readCurrent();
    if (!before.ok) throw new Error('DB の登録内容が検証に通りません');
    const { overlay, state } = before.value;
    if (overlay.version !== expectedVersion) return log.exit({ kind: 'conflict', actual: overlay.version });
    const version = overlay.version + 1;
    const at = this.deps.clock.now();
    this.deps.db.replaceRows(data);
    this.deps.db.writeState({ version, savedAt: at });
    this.deps.db.appendAudit(diffCmsOverlay(overlay, data).map((change) => ({ ...change, at, actor: this.deps.actor, overlayVersion: version })));
    return log.exit({ kind: 'saved', state: { dbId: state.dbId, version, savedAt: at } });
  }

  /**
   * 登録内容を保存する（読んだときの版数と違えば CONFLICT）。
   * @param data 保存する中身
   * @param expectedVersion 読んだときの版数
   * @returns 成功: 保存後の登録内容（版数+1）。失敗: CONFLICT / STORAGE_FAILED
   * @sideEffect DB を書き換え、変更履歴を追記し、変更を知らせる
   */
  async save(data: CmsOverlayData, expectedVersion: number): Promise<Result<CmsOverlay, AppError<'CONFLICT' | 'STORAGE_FAILED'>>> {
    const log = logger.fn('save', { expectedVersion, edits: data.spotEdits.length, events: data.shopEvents.length });
    const checked = parseStoredCmsOverlay({ version: expectedVersion, data });
    if (!checked.ok) return log.fail(storageFailed('invalidData'));
    let outcome: SaveOutcome;
    try {
      outcome = this.deps.db.inTransaction(() => this.writeInTransaction(checked.value, expectedVersion));
    } catch (error) {
      log.error('DB に保存できませんでした');
      return log.fail(storageFailed('write', error));
    }
    if (outcome.kind === 'conflict') {
      return log.fail(fail(AppError.of('CONFLICT', '他の操作で更新されています。もう一度お試しください', { expectedVersion, actual: outcome.actual })));
    }
    this.deps.db.notifyChange(outcome.state);
    const { spotEdits, shopEvents, processedOperationIds } = checked.value;
    const { version } = outcome.state;
    return log.exit(ok(Object.freeze({ spotEdits, shopEvents, processedOperationIds, version })), `version=${version}`);
  }

  /**
   * 登録内容をすべて消す（デモのやり直し）。版数は戻さずに進める（配った版番号と食い違わないように）。
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect DB を空にし、変更履歴に1件残し、変更を知らせる
   */
  async clear(): Promise<Result<void>> {
    const log = logger.fn('clear');
    let cleared: CmsDatabaseState;
    try {
      cleared = this.deps.db.inTransaction(() => {
        const state = this.deps.db.readState();
        const before = this.deps.db.readRows();
        const next = { dbId: state.dbId, version: state.version + 1, savedAt: this.deps.clock.now() };
        this.deps.db.replaceRows({ spotEdits: [], shopEvents: [], processedOperationIds: [] });
        this.deps.db.writeState(next);
        const counts = { spotEdits: before.spotEdits.length, shopEvents: before.shopEvents.length };
        this.deps.db.appendAudit([{ action: 'overlay.clear', targetType: 'overlay', targetId: 'all', before: counts, at: next.savedAt, actor: this.deps.actor, overlayVersion: next.version }]);
        return next;
      });
    } catch (error) {
      log.error('DB を空にできませんでした');
      return log.fail(storageFailed('clear', error));
    }
    this.deps.db.notifyChange(cleared);
    return log.exit(okVoid());
  }
}
