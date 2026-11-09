/**
 * @file セッション（アクティブな旅人）の localStorage リポジトリ（infrastructure/storage 層。SessionRepository の実装）
 * キー: P+'session'。保存形式は封筒 { schemaVersion, version, data: { activeTravelerId? } }（docs/08 §5）。
 * ユースケースは入力の travelerId を信用せず、ここから旅人を解決する（SEC-01）。読込時は旅人ID の正規表現を検証する（DI-01）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { SessionRepository, SessionState } from '@/application/ports/SessionRepository';
import type { StorageRepositoryDeps } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { EnvelopeStore } from '@/infrastructure/storage/schema/EnvelopeStore';
import { parseStoredSession } from '@/infrastructure/storage/schema/parsers';
import { SESSION_KEY } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/storage/LocalStorageSessionRepository');

/** セッションの localStorage リポジトリ */
export class LocalStorageSessionRepository implements SessionRepository {
  private readonly envelopes: EnvelopeStore;

  /**
   * リポジトリを作る。
   * @param deps キー・値ストアと接頭辞（STORAGE_PREFIX）
   */
  constructor(deps: StorageRepositoryDeps) {
    this.envelopes = new EnvelopeStore(deps);
  }

  /**
   * セッションを読む。
   * @returns 成功: セッション（未保存なら空の SessionState）。失敗: STORAGE_FAILED（読めないデータは退避済み）
   * @sideEffect 読めないデータを退避する
   */
  async load(): Promise<Result<SessionState>> {
    const log = logger.fn('load');
    const loaded = this.envelopes.read(SESSION_KEY, parseStoredSession);
    if (!loaded.ok) return log.fail(loaded);
    return log.exit(ok(loaded.value ?? {}), `hasTraveler=${loaded.value?.activeTravelerId !== undefined}`);
  }

  /**
   * セッションを保存する（単一の書き手なので版数は比較せず、保存済みの版数+1 で上書き）。
   * @param state 保存するセッション
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect localStorage に書き込む
   */
  async save(state: SessionState): Promise<Result<void>> {
    const log = logger.fn('save', { activeTravelerId: state.activeTravelerId });
    const current = this.envelopes.storedVersion(SESSION_KEY);
    const version = current.ok ? current.value : 0;
    const data = state.activeTravelerId === undefined ? {} : { activeTravelerId: state.activeTravelerId };
    const written = this.envelopes.write(SESSION_KEY, { version: version + 1, data });
    if (!written.ok) return log.fail(written);
    return log.exit(okVoid());
  }
}
