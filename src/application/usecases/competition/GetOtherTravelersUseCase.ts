/**
 * @file 地図に出す「ほかの旅人」を返すユースケース（application 層・読取系）
 * 実在ユーザーの代わりに、模擬ライバル（マスタ rivals.json・docs/08 D9）を「よく来る地区」に置く。
 * - 背景活動（patterns）を持つ地区ごとに1人分を返す
 * - 地区の主になっているライバルは、背景活動が無い地区でもその地区に置く（デモの「ライバル行動」で奪った地区）
 * 位置は地区単位だけを返す。細かい表示位置は presentation が地区内のスポットから決める（個人の移動履歴は扱わない＝CLAUDE.md 10）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { DistrictId } from '@/Common/types/Id';
import type { UseCase } from '@/application/AppServices';
import type { OtherTravelerDto } from '@/application/dto/Dto';
import { standingsOf } from '@/application/usecases/shared/LordStandings';
import { loadWorld } from '@/application/usecases/shared/World';
import type { World, WorldDeps } from '@/application/usecases/shared/World';
import type { Rival } from '@/domain/competition/Rival';

const logger = createLogger('application/usecases/competition/GetOtherTravelersUseCase');

/** 依存（旅人の世界を読むための一式） */
export type GetOtherTravelersDeps = WorldDeps;

/**
 * 地区ごとの主（ライバルが主のときだけ）を引ける Map を作る。
 * @param world 旅人の世界
 * @returns 地区ID → 主のライバルID
 */
function rivalLordsOf(world: World): Map<DistrictId, string> {
  const log = logger.fn('rivalLordsOf', { today: world.today });
  const lords = new Map<DistrictId, string>();
  for (const standing of standingsOf(world)) {
    if (standing.holder?.type === 'rival') lords.set(standing.districtId, standing.holder.rivalId);
  }
  return log.exit(lords, `${lords.size}地区`);
}

/**
 * ライバル1人が地図に出る地区（背景活動の地区＋主になっている地区。重複なし・背景活動の順）を返す。
 * @param rival ライバル
 * @param lords 地区ID → 主のライバルID
 * @returns 地区ID の配列
 */
export function districtsOfRival(rival: Rival, lords: ReadonlyMap<DistrictId, string>): DistrictId[] {
  const log = logger.fn('districtsOfRival', { rivalId: rival.id });
  const ids: DistrictId[] = rival.patterns.map((p) => p.districtId);
  for (const [districtId, lordId] of lords) if (lordId === rival.id && !ids.includes(districtId)) ids.push(districtId);
  return log.exit(ids, `${ids.length}地区`);
}

/**
 * 表示名から、アイコンに描く1文字を返す（「冒険者」「旅人」の接頭辞は除く）。
 * @param name 表示名（例: おまいり番長）
 * @returns 1文字（例: お）。取れなければ「？」
 */
export function initialOf(name: string): string {
  const log = logger.fn('initialOf');
  const body = name.replace(/^(冒険者|旅人)(?=.)/u, '');
  return log.exit(Array.from(body)[0] ?? '？');
}

/** 地図に出す「ほかの旅人」を返すユースケース */
export class GetOtherTravelersUseCase implements UseCase<void, readonly OtherTravelerDto[]> {
  /**
   * @param deps 旅人の世界を読むための依存
   */
  constructor(private readonly deps: GetOtherTravelersDeps) {}

  /**
   * ほかの旅人を、ライバルの順・地区の順で返す。
   * @returns 成功: ほかの旅人の一覧（空もありうる）。失敗: 世界の読み込みエラー
   * @sideEffect なし（読み取りのみ）
   */
  async execute(): Promise<Result<readonly OtherTravelerDto[]>> {
    const log = logger.fn('execute');
    const world = await loadWorld(this.deps);
    if (!world.ok) return log.fail(world, world.error.code);
    const lords = rivalLordsOf(world.value);
    const travelers: OtherTravelerDto[] = [];
    for (const rival of world.value.rivals) {
      for (const districtId of districtsOfRival(rival, lords)) {
        travelers.push({ key: `${rival.id}:${districtId}`, name: rival.name, initial: initialOf(rival.name), districtId, isLord: lords.get(districtId) === rival.id });
      }
    }
    return log.exit(ok(travelers), `${travelers.length}人`);
  }
}
