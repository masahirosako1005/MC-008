/**
 * @file 5地区の地区カード（成長Lv・色あせ状態・地区の主・次の目標）を返すユースケース（application 層・読取系）
 * 下シートの全画面（地区カード一覧）で使う。数字と「次の目標」文言は DistrictView に集約し、地図・マイ街と同じ値を出す（D2）。
 * 成長・色あせは訪問記録と今日から毎回導出し、保存しない（D4, DI-05）。書込みはしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { TownStateDto } from '@/application/dto/Dto';
import { districtViewsOf, toDistrictCardDto } from '@/application/usecases/shared/DistrictView';
import { loadWorld } from '@/application/usecases/shared/World';
import type { WorldDeps } from '@/application/usecases/shared/World';

const logger = createLogger('application/usecases/town/GetTownStateUseCase');

/** GetTownStateUseCase の依存（旅人の世界を読む一式） */
export type GetTownStateDeps = WorldDeps;

/** 5地区の地区カードを返す */
export class GetTownStateUseCase implements UseCase<void, TownStateDto> {
  /**
   * 依存を受け取る。
   * @param deps 旅人の世界を読む一式（セッション・各リポジトリ・マスタ・時計）
   */
  constructor(private readonly deps: GetTownStateDeps) {}

  /**
   * 全地区（order 順）の地区カードを返す。
   * @returns 成功: TownStateDto（凍結済み）。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect セッション・旅人・地区の主・ライバル行動のリポジトリを読む（書込みはしない）
   */
  async execute(): Promise<Result<TownStateDto>> {
    const log = logger.fn('execute');
    const world = await loadWorld(this.deps);
    if (!world.ok) return log.fail(world);
    const views = districtViewsOf(world.value).sort((a, b) => a.district.order - b.district.order);
    const dto: TownStateDto = Object.freeze({ districts: Object.freeze(views.map(toDistrictCardDto)) });
    log.debug('地区カード', { districts: dto.districts.map((card) => ({ id: card.id, level: card.level, fade: card.fade.kind, lordLost: card.lordLost })) });
    return log.exit(ok(dto));
  }
}
