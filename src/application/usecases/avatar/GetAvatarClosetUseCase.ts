/**
 * @file アバター画面（着せ替え）のデータを返すユースケース（application 層・読取系）
 * すべての部品について「持っているか・NEW か・手に入れ方・進み具合」を返す。所持は訪問記録から毎回導出し、保存しない（docs/08 D4, D16）。
 * 保存された装い・マイコーデは、持っていない部品を外して返す（旅人切替などで残った部品を信用しない）。書込みはしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { AvatarClosetDto, AvatarCoordDto, AvatarPartDto } from '@/application/dto/Dto';
import type { AvatarRepository, AvatarState } from '@/application/ports/AvatarRepository';
import { outfitOfState, unlockHintOf, unlockUnitOf, wardrobeOf } from '@/application/usecases/avatar/avatarWardrobe';
import type { Wardrobe } from '@/application/usecases/avatar/avatarWardrobe';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import type { WorldDeps } from '@/application/usecases/shared/World';
import { AVATAR_CATALOG, MAX_COORDS } from '@/domain/avatar/AvatarCatalog';
import { normalizeOutfit, partProgressOf } from '@/domain/avatar/AvatarUnlockPolicy';
import { rankOf } from '@/domain/reward/TravelerRank';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/avatar/GetAvatarClosetUseCase');

/** GetAvatarClosetUseCase の依存 */
export type GetAvatarClosetDeps = Pick<WorldDeps, 'session' | 'travelers' | 'ledgers' | 'spots'> & { readonly avatars: AvatarRepository };

/**
 * 地区ID → 短い名前を引く関数を作る。
 * @param spots マスタ参照
 * @returns 引く関数（知らない ID はそのまま返す）
 */
function districtNamer(spots: SpotRepository): (id: string) => string {
  const log = logger.fn('districtNamer');
  const names = new Map<string, string>(spots.allDistricts().map((d) => [d.id, d.shortName]));
  return log.exit((id: string): string => names.get(id) ?? id);
}

/**
 * すべての部品を DTO にする（カタログの表示順）。
 * @param wardrobe 実績と持っている部品
 * @param seen 見た部品
 * @param spots マスタ参照（地区名）
 * @returns 部品の DTO
 */
function partDtosOf(wardrobe: Wardrobe, seen: ReadonlySet<string>, spots: SpotRepository): AvatarPartDto[] {
  const log = logger.fn('partDtosOf', { owned: wardrobe.owned.size, seen: seen.size });
  const nameOf = districtNamer(spots);
  const parts = AVATAR_CATALOG.map((p): AvatarPartDto => {
    const progress = partProgressOf(p, wardrobe.progress);
    const base = {
      id: p.id, slot: p.slot, name: p.name, rarity: p.rarity, owned: progress.unlocked,
      isNew: progress.unlocked && p.unlock.kind !== 'free' && !seen.has(p.id),
      hint: unlockHintOf(p.unlock, nameOf), current: progress.current, target: progress.target, unit: unlockUnitOf(p.unlock),
    };
    return Object.freeze(p.unlock.kind === 'districtVisits' ? { ...base, districtId: p.unlock.districtId } : base);
  });
  return log.exit(parts);
}

/**
 * マイコーデを DTO にする（MAX_COORDS 枠。持っていない部品は外す）。
 * @param state 保存された装い
 * @param owned 持っている部品
 * @returns マイコーデ
 */
function coordDtosOf(state: AvatarState, owned: ReadonlySet<string>): AvatarCoordDto[] {
  const log = logger.fn('coordDtosOf', { saved: state.coords?.length });
  const coords = Array.from({ length: MAX_COORDS }, (_, index): AvatarCoordDto => {
    const saved = state.coords?.[index];
    return Object.freeze(saved === undefined || saved === null ? { index } : { index, partIds: normalizeOutfit(saved, owned) });
  });
  return log.exit(coords);
}

/** アバター画面のデータを返す */
export class GetAvatarClosetUseCase implements UseCase<void, AvatarClosetDto> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人・台帳・マスタ・装いのリポジトリ
   */
  constructor(private readonly deps: GetAvatarClosetDeps) {}

  /**
   * アバター画面のデータを返す。
   * @returns 成功: AvatarClosetDto（凍結済み）。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect セッション・旅人・台帳・装いのリポジトリを読む（書込みはしない）
   */
  async execute(): Promise<Result<AvatarClosetDto>> {
    const log = logger.fn('execute');
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    const [ledger, avatar] = await Promise.all([this.deps.ledgers.find(traveler.value.id), this.deps.avatars.load(traveler.value.id)]);
    if (!ledger.ok) return log.fail(ledger);
    if (!avatar.ok) return log.fail(avatar);
    const wardrobe = wardrobeOf(traveler.value.visits, this.deps.spots);
    const points = Number(ledger.value.balance());
    const dto: AvatarClosetDto = Object.freeze({
      nickname: traveler.value.nickname,
      rankName: rankOf(points).name,
      points,
      totalVisits: traveler.value.visits.length,
      outfit: outfitOfState(avatar.value, wardrobe.owned),
      coords: Object.freeze(coordDtosOf(avatar.value, wardrobe.owned)),
      parts: Object.freeze(partDtosOf(wardrobe, avatar.value.seenPartIds === undefined ? wardrobe.owned : new Set(avatar.value.seenPartIds), this.deps.spots)),
      needsSeenBaseline: avatar.value.seenPartIds === undefined,
    });
    log.debug('アバター', { owned: wardrobe.owned.size, outfit: dto.outfit.length });
    return log.exit(ok(dto));
  }
}
