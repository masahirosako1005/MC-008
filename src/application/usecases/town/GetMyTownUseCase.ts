/**
 * @file マイ街（アバター・カード・アイテム・ランク・5地区）を返すユースケース（application 層・読取系）
 * カード・アイテム・ランクは訪問記録と台帳から毎回導出し、保存しない（docs/08 D4, D11, D16）。保存するのはアバターの装いだけ。
 * 報酬は「網羅」ではなく「通い」に出す（CLAUDE.md 4.6）。網羅率は返さない。書込みはしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { ItemId } from '@/Common/types/Id';
import { formatJpDate } from '@/Common/utils/date';
import type { UseCase } from '@/application/AppServices';
import type { MyTownCardDto, MyTownDto, MyTownItemDto, MyTownLockedItemDto, MyTownNextCardDto } from '@/application/dto/Dto';
import type { AvatarRepository } from '@/application/ports/AvatarRepository';
import { districtViewsOf, toDistrictCardDto } from '@/application/usecases/shared/DistrictView';
import type { DistrictView } from '@/application/usecases/shared/DistrictView';
import { loadWorld } from '@/application/usecases/shared/World';
import type { World, WorldDeps } from '@/application/usecases/shared/World';
import { lockedItemHintOf } from '@/application/usecases/town/itemHints';
import { cardsOf } from '@/domain/reward/CardPolicy';
import { ITEM_DEFINITIONS, itemsOf } from '@/domain/reward/ItemPolicy';
import type { EarnedItem } from '@/domain/reward/ItemPolicy';
import { rankOf } from '@/domain/reward/TravelerRank';

const logger = createLogger('application/usecases/town/GetMyTownUseCase');

/** GetMyTownUseCase の依存（旅人の世界＋装い） */
export type GetMyTownDeps = WorldDeps & { readonly avatars: AvatarRepository };

/**
 * 地区ごとの獲得済みカードを DTO にする（地区の表示順・銀→金の順）。
 * @param world 旅人の世界
 * @param views 地区の表示用ビュー（表示順）
 * @returns 獲得済みカード
 */
function cardDtosOf(world: World, views: readonly DistrictView[]): MyTownCardDto[] {
  const log = logger.fn('cardDtosOf', { districts: views.length });
  const cards = views.flatMap((view) =>
    cardsOf(world.traveler.visits, view.district.id).map((card) => ({
      districtId: view.district.id,
      districtName: view.district.name,
      rank: card.rank,
      earnedOn: formatJpDate(card.earnedOn),
    })),
  );
  return log.exit(cards);
}

/**
 * 次に狙えるカードを DTO にする（残り回数の少ない順）。
 * @param views 地区の表示用ビュー
 * @returns 次に狙えるカード
 */
function nextCardDtosOf(views: readonly DistrictView[]): MyTownNextCardDto[] {
  const log = logger.fn('nextCardDtosOf', { districts: views.length });
  const next = views.flatMap((view) =>
    view.nextCard === undefined
      ? []
      : [{ districtId: view.district.id, districtName: view.district.name, rank: view.nextCard.rank, remainingVisits: view.nextCard.remainingVisits }],
  );
  return log.exit(next.sort((a, b) => a.remainingVisits - b.remainingVisits));
}

/**
 * 獲得済み・未獲得のアイテムを DTO にする。持っていないアイテムが装いに残っていたら（旅人切替など）持っていない扱いにする。
 * @param earned 獲得済みアイテム
 * @param heldItemId 保存された装い
 * @returns 獲得済み・未獲得・実際に持っているアイテム
 */
function itemDtosOf(earned: readonly EarnedItem[], heldItemId: ItemId | undefined): { items: MyTownItemDto[]; locked: MyTownLockedItemDto[]; held?: string } {
  const log = logger.fn('itemDtosOf', { earned: earned.length, heldItemId });
  const held = earned.some((i) => i.itemId === heldItemId) ? heldItemId : undefined;
  const items = earned.map((i) => ({ itemId: i.itemId, name: i.name, earnedOn: formatJpDate(i.earnedOn), isHeld: i.itemId === held }));
  const owned = new Set<string>(earned.map((i) => i.itemId));
  const locked = ITEM_DEFINITIONS.filter((d) => !owned.has(d.rawId)).map((d) => ({ itemId: d.rawId, name: d.name, hint: lockedItemHintOf(d.key) }));
  return log.exit(held === undefined ? { items, locked } : { items, locked, held });
}

/** マイ街を返す */
export class GetMyTownUseCase implements UseCase<void, MyTownDto> {
  /**
   * 依存を受け取る。
   * @param deps 旅人の世界を読む一式と、アバターの装いのリポジトリ
   */
  constructor(private readonly deps: GetMyTownDeps) {}

  /**
   * マイ街の全体を返す。
   * @returns 成功: MyTownDto（凍結済み）。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect セッション・旅人・台帳・地区の主・ライバル行動・装いのリポジトリを読む（書込みはしない）
   */
  async execute(): Promise<Result<MyTownDto>> {
    const log = logger.fn('execute');
    const world = await loadWorld(this.deps);
    if (!world.ok) return log.fail(world);
    const travelerId = world.value.traveler.id;
    const [ledger, avatar] = await Promise.all([this.deps.ledgers.find(travelerId), this.deps.avatars.load(travelerId)]);
    if (!ledger.ok) return log.fail(ledger);
    if (!avatar.ok) return log.fail(avatar);
    const views = districtViewsOf(world.value).sort((a, b) => a.district.order - b.district.order);
    const points = Number(ledger.value.balance());
    const earned = itemsOf({ visits: world.value.traveler.visits, spots: this.deps.spots.allSpots(), shopEvents: this.deps.spots.allShopEvents() });
    const items = itemDtosOf(earned, avatar.value.heldItemId);
    const rank = rankOf(points);
    const dto: MyTownDto = Object.freeze({
      nickname: world.value.traveler.nickname,
      rank: Object.freeze({ name: rank.name, nextAt: rank.nextAt, remaining: rank.remaining }),
      points,
      totalVisits: world.value.traveler.visits.length,
      districts: Object.freeze(views.map(toDistrictCardDto)),
      cards: Object.freeze(cardDtosOf(world.value, views)),
      nextCards: Object.freeze(nextCardDtosOf(views)),
      items: Object.freeze(items.items),
      lockedItems: Object.freeze(items.locked),
      heldItemId: items.held,
    });
    log.debug('マイ街', { points, rank: rank.name, cards: dto.cards.length, items: dto.items.length, held: dto.heldItemId });
    return log.exit(ok(dto));
  }
}
