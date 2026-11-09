/**
 * @file ライバル行動（デモの追加訪問）の localStorage リポジトリ（infrastructure/storage 層。RivalActionRepository の実装）
 * キー: P+'rivalActions.'+旅人ID。保存形式は封筒 { schemaVersion, version, data: { travelerId, actions } }（docs/08 §5）。
 * 追記専用。同じ operationId の行動は2回目以降を無視する（DI-07）。旅人ごとの世界に属し、旅人切替・全削除で消える。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import { RivalActionVisit } from '@/domain/competition/Rival';
import type { RivalActionRepository } from '@/domain/competition/RivalRepository';
import type { StorageRepositoryDeps } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { EnvelopeStore } from '@/infrastructure/storage/schema/EnvelopeStore';
import { parseStoredRivalActions } from '@/infrastructure/storage/schema/parsers';
import type { RivalActionListState } from '@/infrastructure/storage/schema/parsers';
import { rivalActionsKeyOf } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/storage/LocalStorageRivalActionRepository');

/** 読み込んだ一覧と版数 */
interface LoadedActions {
  readonly version: number;
  readonly actions: readonly RivalActionVisit[];
}

/** ライバル行動の localStorage リポジトリ */
export class LocalStorageRivalActionRepository implements RivalActionRepository {
  private readonly envelopes: EnvelopeStore;

  /**
   * リポジトリを作る。
   * @param deps キー・値ストアと接頭辞（STORAGE_PREFIX）
   */
  constructor(deps: StorageRepositoryDeps) {
    this.envelopes = new EnvelopeStore(deps);
  }

  /**
   * 一覧と版数を読む（未保存なら版数0の空）。
   * @param travelerId 旅人ID
   * @returns 成功: 版数と古い順の行動。失敗: STORAGE_FAILED（読めないデータは退避済み）
   * @sideEffect 読めないデータを退避する
   */
  private load(travelerId: TravelerId): Result<LoadedActions> {
    const log = logger.fn('load', { travelerId });
    const loaded = this.envelopes.read(rivalActionsKeyOf(travelerId), (record) => {
      const actions = parseStoredRivalActions(record, travelerId);
      return actions.ok ? ok({ version: record.version, actions: actions.value }) : actions;
    });
    if (!loaded.ok) return log.fail(loaded);
    return log.exit(ok(loaded.value ?? { version: 0, actions: [] }));
  }

  /**
   * 旅人の世界のライバル行動を古い順に返す。
   * @param travelerId 旅人ID
   * @returns 成功: 行動の一覧（未保存なら空）。失敗: STORAGE_FAILED
   * @sideEffect 読めないデータを退避する
   */
  async list(travelerId: TravelerId): Promise<Result<readonly RivalActionVisit[]>> {
    const log = logger.fn('list', { travelerId });
    const loaded = this.load(travelerId);
    if (!loaded.ok) return log.fail(loaded);
    return log.exit(ok(loaded.value.actions), `count=${loaded.value.actions.length}`);
  }

  /**
   * ライバル行動を1件追記する。同じ operationId の行動が保存済みなら何もしない（DI-07）。
   * @param travelerId 旅人ID
   * @param action 追記する行動（回数は1以上の整数）
   * @returns 成功: void。失敗: INVALID_INPUT（回数が不正）/ CONFLICT / STORAGE_FAILED
   * @sideEffect localStorage に書き込む
   */
  async append(travelerId: TravelerId, action: RivalActionVisit): Promise<Result<void>> {
    const log = logger.fn('append', { travelerId, rivalId: action.rivalId, districtId: action.districtId, count: action.count });
    const checked = RivalActionVisit.of(action);
    if (!checked.ok) return log.fail(checked);
    const loaded = this.load(travelerId);
    if (!loaded.ok) return log.fail(loaded);
    const operationId = checked.value.operationId;
    if (operationId !== undefined && loaded.value.actions.some((a) => a.operationId === operationId)) {
      return log.exit(okVoid(), 'duplicateOperation');
    }
    const state: RivalActionListState = { travelerId, actions: [...loaded.value.actions, checked.value] };
    const written = this.envelopes.writeVersioned({
      suffix: rivalActionsKeyOf(travelerId),
      expectedVersion: loaded.value.version,
      build: () => state,
    });
    if (!written.ok) return log.fail(written);
    return log.exit(okVoid());
  }

  /**
   * 旅人の世界のライバル行動をすべて消す（旅人切替・全データ削除用）。
   * @param travelerId 旅人ID
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect localStorage から削除する
   */
  async clear(travelerId: TravelerId): Promise<Result<void>> {
    const log = logger.fn('clear', { travelerId });
    const removed = this.envelopes.remove(rivalActionsKeyOf(travelerId));
    return removed.ok ? log.exit(removed) : log.fail(removed);
  }
}
