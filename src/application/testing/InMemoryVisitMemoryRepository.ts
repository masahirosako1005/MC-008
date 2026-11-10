/**
 * @file テスト用の訪問の思い出のリポジトリ（application/testing 層。メモリのみ）
 * VisitMemoryRepository の偽物。旅人ごとに思い出の一覧を Map に持つ。failNextSave で次の保存を1回だけ失敗させられる。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import type { VisitMemory, VisitMemoryRepository } from '@/application/ports/VisitMemoryRepository';

const logger = createLogger('application/testing/InMemoryVisitMemoryRepository');

/** メモリ上の訪問の思い出のリポジトリ */
export class InMemoryVisitMemoryRepository implements VisitMemoryRepository {
  private readonly byTraveler = new Map<TravelerId, readonly VisitMemory[]>();
  /** 次の saveAll を失敗させるか */
  failNextSave = false;
  /** saveAll が成功した回数 */
  saveCount = 0;

  /**
   * 思い出をすべて読む。
   * @param travelerId 旅人ID
   * @returns 思い出の一覧（未保存なら空）
   */
  async list(travelerId: TravelerId): Promise<Result<readonly VisitMemory[]>> {
    const log = logger.fn('list', { travelerId });
    return log.exit(ok(this.byTraveler.get(travelerId) ?? []));
  }

  /**
   * 思い出をまとめて保存する。
   * @param travelerId 旅人ID
   * @param memories 思い出の一覧
   * @returns 成功: void。失敗: STORAGE_FAILED（failNextSave のとき）
   * @sideEffect メモリの Map を書き換える
   */
  async saveAll(travelerId: TravelerId, memories: readonly VisitMemory[]): Promise<Result<void>> {
    const log = logger.fn('saveAll', { travelerId, count: memories.length });
    if (this.failNextSave) {
      this.failNextSave = false;
      return log.fail(fail(AppError.of('STORAGE_FAILED', '保存に失敗しました（テスト）')));
    }
    this.byTraveler.set(travelerId, Object.freeze([...memories]));
    this.saveCount += 1;
    return log.exit(okVoid());
  }
}
