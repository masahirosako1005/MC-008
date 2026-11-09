/**
 * @file 店舗CMS の登録内容の localStorage リポジトリ（infrastructure/storage 層。CmsOverlayRepository の実装）
 * キー: P+'cms.overlay'（デモは nnishi.demo.cms.overlay＝DI-23）。保存形式は封筒 { schemaVersion, version, data }（docs/08 §5）。
 * 同じオリジンの CMS 画面と利用者アプリ（別タブ）が同じキーを読み書きする。版数で同時編集を検出する（DI-10）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok, okVoid } from '@/Common/result/Result';
import type { AppError, Result } from '@/Common/result/Result';
import { EMPTY_CMS_OVERLAY } from '@/application/ports/CmsOverlayRepository';
import type { CmsOverlay, CmsOverlayData, CmsOverlayRepository } from '@/application/ports/CmsOverlayRepository';
import type { StorageRepositoryDeps } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { parseStoredCmsOverlay } from '@/infrastructure/storage/schema/cmsOverlayParser';
import { EnvelopeStore } from '@/infrastructure/storage/schema/EnvelopeStore';
import { CMS_OVERLAY_KEY } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/storage/LocalStorageCmsOverlayRepository');

/** 店舗CMS の登録内容の localStorage リポジトリ */
export class LocalStorageCmsOverlayRepository implements CmsOverlayRepository {
  private readonly envelopes: EnvelopeStore;

  /**
   * リポジトリを作る。
   * @param deps キー・値ストアと接頭辞（STORAGE_PREFIX）
   */
  constructor(deps: StorageRepositoryDeps) {
    this.envelopes = new EnvelopeStore(deps);
  }

  /**
   * 保存キー（接頭辞つき）を返す。別タブの書き込みを監視するときに使う。
   * @returns 例: 'nnishi.demo.cms.overlay'
   */
  storageKey(): string {
    return this.envelopes.keyOf(CMS_OVERLAY_KEY);
  }

  /**
   * 登録内容を読む。
   * @returns 成功: 登録内容（未保存なら EMPTY_CMS_OVERLAY）。失敗: STORAGE_FAILED（読めないデータは退避済み）
   * @sideEffect 読めないデータを退避する
   */
  async load(): Promise<Result<CmsOverlay>> {
    const log = logger.fn('load');
    const loaded = this.envelopes.read(CMS_OVERLAY_KEY, parseStoredCmsOverlay);
    if (!loaded.ok) return log.fail(loaded);
    const overlay = loaded.value ?? EMPTY_CMS_OVERLAY;
    return log.exit(ok(overlay), `version=${overlay.version} edits=${overlay.spotEdits.length} events=${overlay.shopEvents.length}`);
  }

  /**
   * 登録内容を保存する（読んだときの版数と違えば CONFLICT）。
   * @param data 保存する中身
   * @param expectedVersion 読んだときの版数（未保存なら 0）
   * @returns 成功: 保存後の登録内容。失敗: CONFLICT / STORAGE_FAILED
   * @sideEffect localStorage に書き込む（別タブの利用者アプリに storage イベントが届く）
   */
  async save(data: CmsOverlayData, expectedVersion: number): Promise<Result<CmsOverlay, AppError<'CONFLICT' | 'STORAGE_FAILED'>>> {
    const log = logger.fn('save', { expectedVersion, edits: data.spotEdits.length, events: data.shopEvents.length });
    const stored = { spotEdits: data.spotEdits, shopEvents: data.shopEvents, processedOperationIds: data.processedOperationIds };
    const written = this.envelopes.writeVersioned({ suffix: CMS_OVERLAY_KEY, expectedVersion, build: () => stored });
    if (!written.ok) return log.fail(written);
    return log.exit(ok(Object.freeze({ ...stored, version: written.value })), `version=${written.value}`);
  }

  /**
   * 登録内容を消す。
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect localStorage から消す
   */
  async clear(): Promise<Result<void>> {
    const log = logger.fn('clear');
    const removed = this.envelopes.remove(CMS_OVERLAY_KEY);
    return removed.ok ? log.exit(okVoid()) : log.fail(removed);
  }
}
