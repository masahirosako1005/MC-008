/**
 * @file アバターの着せ替えを保存するユースケース（application 層・書込系）
 * 装い・マイコーデ・見た部品（NEW の印）を保存する。入力を信用せず（SEC-16）、持っていない・知らない部品は外して保存する。
 * 同じ入力を何度送っても結果は同じ（冪等＝DI-07）。部品の所持（訪問記録から導出）は変えない。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { SaveAvatarInput, SaveAvatarOutput } from '@/application/dto/Dto';
import { MAX_OUTFIT_PARTS, MAX_SEEN_PARTS } from '@/application/ports/AvatarRepository';
import type { AvatarRepository, AvatarState } from '@/application/ports/AvatarRepository';
import { outfitOfState, wardrobeOf } from '@/application/usecases/avatar/avatarWardrobe';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import type { WorldDeps } from '@/application/usecases/shared/World';
import { MAX_COORDS, avatarPartOf } from '@/domain/avatar/AvatarCatalog';
import { normalizeOutfit } from '@/domain/avatar/AvatarUnlockPolicy';

const logger = createLogger('application/usecases/avatar/SaveAvatarUseCase');

/** SaveAvatarUseCase の依存 */
export type SaveAvatarDeps = Pick<WorldDeps, 'session' | 'travelers' | 'ledgers' | 'spots' | 'clock'> & { readonly avatars: AvatarRepository };

/**
 * 入力の形を確かめる（配列の長さ・コーデの枠番号）。
 * @param input 入力
 * @returns 正しければ undefined、違えば理由
 */
function invalidReasonOf(input: SaveAvatarInput): string | undefined {
  const log = logger.fn('invalidReasonOf');
  if (input.outfit !== undefined && (!Array.isArray(input.outfit) || input.outfit.length > MAX_OUTFIT_PARTS)) return log.exit('outfit');
  if (input.seenPartIds !== undefined && (!Array.isArray(input.seenPartIds) || input.seenPartIds.length > MAX_SEEN_PARTS)) return log.exit('seen');
  const coord = input.coord;
  if (coord !== undefined && (!Number.isInteger(coord.index) || coord.index < 0 || coord.index >= MAX_COORDS)) return log.exit('coord');
  if (coord?.partIds != null && (!Array.isArray(coord.partIds) || coord.partIds.length > MAX_OUTFIT_PARTS)) return log.exit('coord');
  return log.exit(undefined);
}

/**
 * 見た部品を足す（定義のある部品だけ・重複なし・上限まで）。
 * @param before 保存済みの見た部品
 * @param added 新しく見た部品
 * @returns 合わせた見た部品
 */
function mergeSeen(before: readonly string[] | undefined, added: readonly unknown[]): readonly string[] {
  const log = logger.fn('mergeSeen', { before: before?.length, added: added.length });
  const merged = new Set(before ?? []);
  for (const id of added) if (typeof id === 'string' && avatarPartOf(id) !== undefined) merged.add(id);
  return log.exit([...merged].slice(0, MAX_SEEN_PARTS));
}

/** アバターの着せ替えを保存する */
export class SaveAvatarUseCase implements UseCase<SaveAvatarInput, SaveAvatarOutput> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人・台帳とマスタ（所持の判定用）・装いのリポジトリ
   */
  constructor(private readonly deps: SaveAvatarDeps) {}

  /**
   * 装い・マイコーデ・見た部品を保存する。
   * @param input 保存する内容（省略した項目は変えない）
   * @returns 成功: 保存後の装い。失敗: INVALID_INPUT（形の違う入力）／TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect 台帳を読み（所持の判定）、装いのリポジトリに書き込む
   */
  async execute(input: SaveAvatarInput): Promise<Result<SaveAvatarOutput>> {
    const log = logger.fn('execute', { outfit: input.outfit?.length, coord: input.coord?.index, seen: input.seenPartIds?.length });
    const reason = invalidReasonOf(input);
    if (reason !== undefined) return log.fail(fail(AppError.of('INVALID_INPUT', '着せ替えの内容が正しくありません', { rule: reason })));
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    const [current, ledger] = await Promise.all([this.deps.avatars.load(traveler.value.id), this.deps.ledgers.find(traveler.value.id)]);
    if (!current.ok) return log.fail(current);
    if (!ledger.ok) return log.fail(ledger);
    const { owned } = wardrobeOf(traveler.value, this.deps.spots, this.deps.clock, Number(ledger.value.balance()));
    const outfit = input.outfit === undefined ? outfitOfState(current.value, owned) : normalizeOutfit(input.outfit, owned);
    const coords = [...(current.value.coords ?? [])];
    while (coords.length < MAX_COORDS) coords.push(null);
    if (input.coord !== undefined) coords[input.coord.index] = input.coord.partIds === null ? null : normalizeOutfit(input.coord.partIds, owned);
    const next: AvatarState = {
      partIds: outfit,
      coords: coords.slice(0, MAX_COORDS),
      seenPartIds: input.seenPartIds === undefined ? current.value.seenPartIds ?? [] : mergeSeen(current.value.seenPartIds, input.seenPartIds),
    };
    const saved = await this.deps.avatars.save(traveler.value.id, next);
    if (!saved.ok) return log.fail(saved);
    return log.exit(ok(Object.freeze({ outfit })));
  }
}
