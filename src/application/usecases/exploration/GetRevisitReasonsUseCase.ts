/**
 * @file 「次に訪れる理由」（期限・取り返し・色あせ・未訪問）を表示順に返すユースケース（application 層・読取系）
 * 下シート（つまみ＝いちばん強い1件、半分＝再訪理由カード）で使う。並び順は domain の RevisitReasonPolicy（CLAUDE.md 4.5 の優先順）。
 * 文言の日本語化は ReasonText に集約する。状態＋今日から毎回導出し、保存しない（DI-05）。書込みはしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { RevisitReasonDto } from '@/application/dto/Dto';
import { lordshipSnapshotsOf } from '@/application/usecases/shared/LordStandings';
import { reasonDtosOf } from '@/application/usecases/shared/ReasonText';
import { discoveredSpotIdsOf, loadWorld } from '@/application/usecases/shared/World';
import type { World, WorldDeps } from '@/application/usecases/shared/World';
import { RevisitReasonPolicy } from '@/domain/revisit/RevisitReasonPolicy';
import type { RevisitReason } from '@/domain/revisit/RevisitReason';

const logger = createLogger('application/usecases/exploration/GetRevisitReasonsUseCase');

/** GetRevisitReasonsUseCase の依存（旅人の世界を読む一式） */
export type GetRevisitReasonsDeps = WorldDeps;

/**
 * 旅人の世界から再訪理由を集める（並べ替え済み）。
 * 発見済みには訪問済みも含める。利用済みのクーポンの期限は知らせない。
 * @param world 旅人の世界
 * @returns 再訪理由（表示順）
 */
function reasonsOf(world: World): RevisitReason[] {
  const log = logger.fn('reasonsOf', { today: world.today });
  const { traveler, spots } = world;
  const reasons = RevisitReasonPolicy.collect({
    today: world.today,
    spots: spots.allSpots(),
    districts: spots.allDistricts(),
    shopEvents: spots.allShopEvents(),
    visits: traveler.visits,
    discoveredSpotIds: discoveredSpotIdsOf(traveler),
    lordships: lordshipSnapshotsOf(world),
    redeemedShopEventIds: new Set(traveler.redemptions.map((redemption) => redemption.shopEventId)),
  });
  return log.exit(reasons, `${reasons.length}件`);
}

/** 再訪理由を返す */
export class GetRevisitReasonsUseCase implements UseCase<void, readonly RevisitReasonDto[]> {
  /**
   * 依存を受け取る。
   * @param deps 旅人の世界を読む一式（セッション・各リポジトリ・マスタ・時計）
   */
  constructor(private readonly deps: GetRevisitReasonsDeps) {}

  /**
   * 今日時点の再訪理由を表示順（期限＞取り返し＞色あせ＞未訪問）に返す。
   * @returns 成功: 再訪理由カードの DTO（凍結済みの配列。無ければ空）。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect セッション・旅人・地区の主・ライバル行動のリポジトリを読む（書込みはしない）
   */
  async execute(): Promise<Result<readonly RevisitReasonDto[]>> {
    const log = logger.fn('execute');
    const world = await loadWorld(this.deps);
    if (!world.ok) return log.fail(world);
    const dtos = reasonDtosOf(reasonsOf(world.value), world.value.spots);
    log.debug('再訪理由', { kinds: dtos.map((dto) => dto.kind) });
    return log.exit(ok(Object.freeze(dtos)));
  }
}
