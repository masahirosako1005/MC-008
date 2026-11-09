/**
 * @file テスト用のアバターの装いのリポジトリ（application/testing 層。メモリのみ）
 * AvatarRepository の偽物。旅人ごとに装いを Map に持つ。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import type { AvatarRepository, AvatarState } from '@/application/ports/AvatarRepository';

const logger = createLogger('application/testing/InMemoryAvatarRepository');

/** メモリ上のアバターの装いのリポジトリ */
export class InMemoryAvatarRepository implements AvatarRepository {
  private readonly states = new Map<TravelerId, AvatarState>();

  /**
   * 装いを読む。
   * @param travelerId 旅人ID
   * @returns 装い（未保存なら空）
   */
  async load(travelerId: TravelerId): Promise<Result<AvatarState>> {
    const log = logger.fn('load', { travelerId });
    return log.exit(ok(this.states.get(travelerId) ?? {}));
  }

  /**
   * 装いを保存する。
   * @param travelerId 旅人ID
   * @param state 装い
   * @returns 成功: void
   * @sideEffect メモリの Map を書き換える
   */
  async save(travelerId: TravelerId, state: AvatarState): Promise<Result<void>> {
    const log = logger.fn('save', { travelerId, heldItemId: state.heldItemId });
    this.states.set(travelerId, Object.freeze({ ...state }));
    return log.exit(okVoid());
  }
}
