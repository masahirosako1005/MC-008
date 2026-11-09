/**
 * @file アバターに持たせるアイテムを選ぶユースケース（application 層・書込系）
 * 持っているアイテム（訪問記録から導出）だけを選べる。持っていないアイテム・不正な ID は INVALID_INPUT（SEC-16 と同じく入力を信用しない）。
 * 同じ選択を何度送っても結果は同じ（冪等＝DI-07）。itemId を省略するとカメラ（既定の姿）に戻す。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseItemId } from '@/Common/types/Id';
import type { UseCase } from '@/application/AppServices';
import type { EquipItemInput, EquipItemOutput } from '@/application/dto/Dto';
import type { AvatarRepository } from '@/application/ports/AvatarRepository';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import type { WorldDeps } from '@/application/usecases/shared/World';
import { itemsOf } from '@/domain/reward/ItemPolicy';

const logger = createLogger('application/usecases/town/EquipAvatarItemUseCase');

/** EquipAvatarItemUseCase の依存 */
export type EquipAvatarItemDeps = Pick<WorldDeps, 'session' | 'travelers' | 'spots'> & { readonly avatars: AvatarRepository };

/** アバターに持たせるアイテムを選ぶ */
export class EquipAvatarItemUseCase implements UseCase<EquipItemInput, EquipItemOutput> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人・スポット（アイテムの判定用）・装いのリポジトリ
   */
  constructor(private readonly deps: EquipAvatarItemDeps) {}

  /**
   * 持たせるアイテムを保存する。
   * @param input 持たせるアイテム（省略でカメラ）
   * @returns 成功: 保存した装い。失敗: INVALID_INPUT（不正な ID・持っていない）／TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect 装いのリポジトリに書き込む
   */
  async execute(input: EquipItemInput): Promise<Result<EquipItemOutput>> {
    const log = logger.fn('execute', { itemId: input.itemId });
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    if (input.itemId === undefined) {
      const cleared = await this.deps.avatars.save(traveler.value.id, {});
      return cleared.ok ? log.exit(ok({})) : log.fail(cleared);
    }
    const itemId = parseItemId(input.itemId);
    if (!itemId.ok) return log.fail(itemId);
    const owned = itemsOf({ visits: traveler.value.visits, spots: this.deps.spots.allSpots(), shopEvents: this.deps.spots.allShopEvents() });
    if (!owned.some((i) => i.itemId === itemId.value)) {
      return log.fail(fail(AppError.of('INVALID_INPUT', 'まだ持っていないアイテムです', { itemId: itemId.value })), '未所持');
    }
    const saved = await this.deps.avatars.save(traveler.value.id, { heldItemId: itemId.value });
    if (!saved.ok) return log.fail(saved);
    return log.exit(ok({ heldItemId: itemId.value }));
  }
}
