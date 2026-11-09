/**
 * @file デモのライバル行動ユースケース（application 層・デモ専用）
 * 今日付のライバル行動（RivalActionVisit）を「max(現職の回数, 旅人の回数) + 1 − ライバルの現在回数」件（最小1）追記し、
 * その地区の主を再判定する（docs/08 §4.4、D7〜D9）。旅人が主なら奪われて「取り返し」理由が出る（実演手順5）。
 * 同じ operationId の行動は1回しか追記しない（DI-07）。isDemoBuild が false なら DEMO_DISABLED（SEC-02）。呼び出しは warn ログ（DI-20）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId, parseOperationId, parseRivalId } from '@/Common/types/Id';
import type { OperationId } from '@/Common/types/Id';
import type { UseCase } from '@/application/AppServices';
import type { SimulateRivalInput, SimulateRivalOutput } from '@/application/dto/Dto';
import type { UpdateDistrictLordUseCase } from '@/application/usecases/competition/UpdateDistrictLordUseCase';
import { DEMO_DEFAULT_RIVAL_DISTRICT_ID_TEXT, DEMO_DEFAULT_RIVAL_ID_TEXT } from '@/application/usecases/demo/constants';
import { demoDisabled, isDemoEnabled } from '@/application/usecases/demo/demoGuard';
import type { DemoSwitch } from '@/application/usecases/demo/demoGuard';
import { loadWorld } from '@/application/usecases/shared/World';
import type { World, WorldDeps } from '@/application/usecases/shared/World';
import { holderKey, rivalHolder, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';
import type { LordHolder } from '@/domain/competition/LordHolder';
import { collectLordCounts, lordWindow } from '@/domain/competition/LordPolicy';
import type { LordCount } from '@/domain/competition/LordPolicy';
import { RivalActionVisit } from '@/domain/competition/Rival';
import type { Rival } from '@/domain/competition/Rival';
import type { District } from '@/domain/town/District';

const logger = createLogger('application/usecases/demo/SimulateRivalUseCase');

/** SimulateRivalUseCase の依存 */
export interface SimulateRivalDeps extends WorldDeps, DemoSwitch {
  /** 行動を記録した後にその地区の主を再判定する */
  readonly updateLords: Pick<UpdateDistrictLordUseCase, 'execute'>;
}

/** 検証済みの入力 */
interface RivalTarget {
  readonly operationId: OperationId;
  readonly rival: Rival;
  readonly district: District;
}

/**
 * 候補ごとの回数から、指定した人の回数を取り出す。
 * @param counts 候補ごとの回数
 * @param holder 取り出す人（undefined は主なし）
 * @returns 回数（主なし・候補に無ければ 0）
 */
function countOf(counts: readonly LordCount[], holder: LordHolder | undefined): number {
  return holder === undefined ? 0 : (counts.find((entry) => holderKey(entry.holder) === holderKey(holder))?.count ?? 0);
}

/** デモのライバル行動 */
export class SimulateRivalUseCase implements UseCase<SimulateRivalInput, SimulateRivalOutput> {
  private readonly enabled: boolean;

  /**
   * ユースケースを作る。
   * @param deps WorldDeps・主の再判定・有効フラグ（省略時 isDemoBuild）
   */
  constructor(private readonly deps: SimulateRivalDeps) {
    this.enabled = isDemoEnabled(deps);
  }

  /**
   * ライバルに今日付の訪問を足して、その地区の主を再判定する。
   * @param input 操作ID・ライバルID（既定 r_taro）・地区ID（既定 d_tenma＝天満地区。docs/08 §9.3）
   * @returns 成功: 地区・ライバル名・主が交代したか。失敗: DEMO_DISABLED／INVALID_INPUT（ID 不正・未知のライバル）／DISTRICT_NOT_FOUND／
   *          TRAVELER_NOT_FOUND／STORAGE_FAILED／CONFLICT
   * @sideEffect RivalActionRepository.append。主が交代すれば LordshipRepository.save と DistrictLordChanged の発行
   * @see docs/08 §4.4, D7, D8, D9、docs/05 SEC-02、docs/06 DI-07, DI-20
   */
  async execute(input: SimulateRivalInput): Promise<Result<SimulateRivalOutput>> {
    const log = logger.fn('execute', { rivalId: input.rivalId, districtId: input.districtId, operationId: input.operationId });
    log.warn('デモ操作: ライバル行動', { rivalId: input.rivalId, districtId: input.districtId, enabled: this.enabled });
    if (!this.enabled) return log.fail(demoDisabled());
    const target = this.parseTarget(input);
    if (!target.ok) return log.fail(target);
    const world = await loadWorld(this.deps);
    if (!world.ok) return log.fail(world);
    const appended = await this.appendAction(world.value, target.value);
    if (!appended.ok) return log.fail(appended);
    const { rival, district } = target.value;
    const lords = await this.deps.updateLords.execute({ districtIds: [district.id] });
    if (!lords.ok) return log.fail(lords);
    const changed = lords.value.changed.some((event) => event.districtId === district.id);
    log.info('ライバル行動', { rivalId: rival.id, districtId: district.id, changed });
    return log.exit(ok(Object.freeze({ districtId: district.id, districtName: district.name, rivalName: rival.name, changed })));
  }

  /**
   * 入力（操作ID・ライバルID・地区ID）を検証し、マスタのライバルと地区を引く。
   * @param input 入力
   * @returns 成功: 検証済みの対象。失敗: INVALID_INPUT（形式不正・未知のライバル）／DISTRICT_NOT_FOUND
   * @see docs/05_security_checklist.md SEC-16
   */
  private parseTarget(input: SimulateRivalInput): Result<RivalTarget> {
    const log = logger.fn('parseTarget', { rivalId: input.rivalId, districtId: input.districtId });
    const operationId = parseOperationId(input.operationId);
    if (!operationId.ok) return log.fail(operationId);
    const rivalId = parseRivalId(input.rivalId ?? DEMO_DEFAULT_RIVAL_ID_TEXT);
    if (!rivalId.ok) return log.fail(rivalId);
    const rival = this.deps.rivals.findRival(rivalId.value);
    if (rival === undefined) return log.fail(fail(AppError.of('INVALID_INPUT', 'ライバルが見つかりません', { rivalId: rivalId.value })));
    const districtId = parseDistrictId(input.districtId ?? DEMO_DEFAULT_RIVAL_DISTRICT_ID_TEXT);
    if (!districtId.ok) return log.fail(districtId);
    const district = this.deps.spots.findDistrict(districtId.value);
    if (district === undefined) return log.fail(fail(AppError.of('DISTRICT_NOT_FOUND', '地区が見つかりません', { districtId: districtId.value })));
    return log.exit(ok({ operationId: operationId.value, rival, district }));
  }

  /**
   * ライバルを主にするのに足りる回数の行動を今日付で追記する（同じ操作ID の行動が記録済みなら何もしない）。
   * 回数 = max(現職の回数, 旅人の回数) + 1 − ライバルの現在回数（最小1）。回数は直近30日（LordPolicy.lordWindow）。
   * @param world 旅人の世界
   * @param target 検証済みの対象
   * @returns 成功: void。失敗: INVALID_INPUT（回数が不正＝バグ）／STORAGE_FAILED
   * @sideEffect RivalActionRepository.append
   */
  private async appendAction(world: World, target: RivalTarget): Promise<Result<void>> {
    const log = logger.fn('appendAction', { rivalId: target.rival.id, districtId: target.district.id, operationId: target.operationId });
    if (world.actions.some((action) => action.operationId === target.operationId)) return log.exit(okVoid(), '処理済みの操作');
    const districtId = target.district.id;
    const counts = collectLordCounts({ districtId, visits: world.traveler.visits, rivals: world.rivals, actions: world.actions, window: lordWindow(world.today) });
    const incumbentCount = countOf(counts, world.board.holderOf(districtId));
    const travelerCount = countOf(counts, TRAVELER_HOLDER);
    const rivalCount = countOf(counts, rivalHolder(target.rival.id));
    const count = Math.max(1, Math.max(incumbentCount, travelerCount) + 1 - rivalCount);
    log.debug('追加回数', { incumbentCount, travelerCount, rivalCount, count });
    const action = RivalActionVisit.of({ rivalId: target.rival.id, districtId, localDate: world.today, count, operationId: target.operationId });
    if (!action.ok) return log.fail(action);
    const appended = await this.deps.rivalActions.append(world.traveler.id, action.value);
    if (!appended.ok) return log.fail(appended);
    return log.exit(okVoid());
  }
}
