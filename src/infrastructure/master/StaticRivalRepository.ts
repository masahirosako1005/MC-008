/**
 * @file 検証済みの模擬ライバル（rivals.json）の参照（infrastructure/master 層。RivalRepository の実装）
 * 起動後は同期・不変。並び順は ID 昇順で固定する（ランキング・主の判定を再現可能にする＝DI-05）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { RivalId } from '@/Common/types/Id';
import type { Rival } from '@/domain/competition/Rival';
import type { RivalRepository } from '@/domain/competition/RivalRepository';

const logger = createLogger('infrastructure/master/StaticRivalRepository');

/** 模擬ライバルの参照 */
export class StaticRivalRepository implements RivalRepository {
  private readonly rivals: readonly Rival[];
  private readonly byId: ReadonlyMap<RivalId, Rival>;

  /**
   * 参照を作る（ID 昇順に並べ替える）。
   * @param rivals 検証済みのライバル（Rival.of を通した値）
   */
  constructor(rivals: readonly Rival[]) {
    const log = logger.fn('constructor', { count: rivals.length });
    this.rivals = Object.freeze([...rivals].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
    this.byId = new Map(this.rivals.map((r) => [r.id, r]));
    log.exit(undefined);
  }

  /**
   * すべてのライバルを ID 昇順で返す。
   * @returns ライバル
   */
  allRivals(): readonly Rival[] {
    return this.rivals;
  }

  /**
   * ID でライバルを探す。
   * @param id ライバルID
   * @returns ライバル（無ければ undefined）
   */
  findRival(id: RivalId): Rival | undefined {
    return this.byId.get(id);
  }
}
