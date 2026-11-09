/**
 * @file 地区の主を再判定して、交代があれば保存・通知するユースケース兼イベントハンドラ（application 層）
 * docs/08 §4.2 の3番目: SpotVisited → その地区だけ再判定 → DistrictLordChanged。
 * 日付進行（AdvanceDateUseCase）・ライバル行動（SimulateRivalUseCase）からは execute で指定地区（省略時は全地区）を再判定する。
 * 判定は D7（挑戦者は現職を上回ったときだけ交代）。旅人→ライバルの交代で「取り返し」中になる（D8）。
 * 交代が無ければ保存もイベントもしない。交代があれば盤を1回だけ保存（楽観ロック＝DI-10, DI-12）してから通知する。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId } from '@/Common/types/Id';
import type { DistrictId } from '@/Common/types/Id';
import type { EventBus } from '@/application/events/EventBus';
import type { EventFactory } from '@/application/events/EventFactory';
import { recalculateLords } from '@/application/usecases/competition/recalculateLords';
import type { LordChange } from '@/application/usecases/competition/recalculateLords';
import { lordNameOf } from '@/application/usecases/shared/LordStandings';
import { loadWorld } from '@/application/usecases/shared/World';
import type { World, WorldDeps } from '@/application/usecases/shared/World';
import type { DistrictLordChanged, SpotVisited } from '@/domain/events/DomainEvent';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/competition/UpdateDistrictLordUseCase');

/** マスタに名前が無いライバルの表示名 */
const UNKNOWN_LORD_NAME = 'ライバル';

/** UpdateDistrictLordUseCase の依存 */
export interface UpdateDistrictLordDeps extends WorldDeps {
  /** DistrictLordChanged の発行先 */
  readonly events: Pick<EventBus, 'publish'>;
  /** イベントのメタ情報を付ける工場（container で共有） */
  readonly eventFactory: EventFactory;
}

/** execute の入力 */
export interface UpdateDistrictLordInput {
  /** 再判定する地区ID（未検証の文字列。省略時は全地区） */
  readonly districtIds?: readonly string[];
}

/** execute の出力 */
export interface UpdateDistrictLordOutput {
  /** 発行した DistrictLordChanged（交代が無ければ空） */
  readonly changed: readonly DistrictLordChanged[];
}

/**
 * 入力の地区ID を検証し、マスタにある地区ID にする（省略時は全地区）。
 * @param spots マスタ参照
 * @param raw 未検証の地区ID（省略可）
 * @returns 成功: 地区ID（入力順）。失敗: INVALID_INPUT（形式が不正）／DISTRICT_NOT_FOUND（マスタに無い）
 * @see docs/05_security_checklist.md SEC-16
 */
function parseDistrictIds(spots: SpotRepository, raw: readonly string[] | undefined): Result<DistrictId[]> {
  const log = logger.fn('parseDistrictIds', { count: raw?.length });
  if (raw === undefined) return log.exit(ok(spots.allDistricts().map((district) => district.id)));
  const ids: DistrictId[] = [];
  for (const text of raw) {
    const id = parseDistrictId(text);
    if (!id.ok) return log.fail(id);
    if (spots.findDistrict(id.value) === undefined) {
      return log.fail(fail(AppError.of('DISTRICT_NOT_FOUND', '地区が見つかりません', { districtId: id.value })));
    }
    ids.push(id.value);
  }
  return log.exit(ok(ids));
}

/** 地区の主を再判定するユースケース（SpotVisited のハンドラも兼ねる） */
export class UpdateDistrictLordUseCase {
  /**
   * ユースケースを作る。
   * @param deps WorldDeps（セッション・旅人・台帳・盤・ライバル行動・ライバル・マスタ・時計）＋イベントバス・イベント工場
   */
  constructor(private readonly deps: UpdateDistrictLordDeps) {}

  /**
   * 指定した地区（省略時は全地区）の主を今日の時点で再判定する（日付進行・ライバル行動の後に呼ぶ）。
   * @param input 地区ID（省略可）
   * @returns 成功: 発行した DistrictLordChanged。失敗: INVALID_INPUT／DISTRICT_NOT_FOUND／TRAVELER_NOT_FOUND／STORAGE_FAILED／CONFLICT
   * @sideEffect 交代があれば LordshipRepository.save と EventBus.publish（DistrictLordChanged）
   * @see docs/08 §4.4, D7, D8
   */
  async execute(input: UpdateDistrictLordInput = {}): Promise<Result<UpdateDistrictLordOutput>> {
    const log = logger.fn('execute', { districtIds: input.districtIds });
    const districtIds = parseDistrictIds(this.deps.spots, input.districtIds);
    if (!districtIds.ok) return log.fail(districtIds);
    const world = await loadWorld(this.deps);
    if (!world.ok) return log.fail(world);
    const changed = await this.update(world.value, districtIds.value);
    if (!changed.ok) return log.fail(changed);
    return log.exit(ok(Object.freeze({ changed: changed.value })));
  }

  /**
   * SpotVisited を受け、訪問した地区だけ主を再判定する。
   * @param event SpotVisited
   * @returns 成功: void。失敗: INVALID_INPUT（イベントの旅人がセッションと違う）／DISTRICT_NOT_FOUND／TRAVELER_NOT_FOUND／STORAGE_FAILED／CONFLICT
   * @sideEffect 交代があれば LordshipRepository.save と EventBus.publish（DistrictLordChanged）
   * @see docs/08 §4.2
   */
  async handle(event: SpotVisited): Promise<Result<void>> {
    const log = logger.fn('handle', { eventId: event.eventId, districtId: event.districtId, operationId: event.operationId });
    const world = await loadWorld(this.deps);
    if (!world.ok) return log.fail(world);
    if (world.value.traveler.id !== event.travelerId) {
      return log.fail(fail(AppError.of('INVALID_INPUT', '訪問の記録が見つかりません。もう一度お試しください', { kind: 'SpotVisited', rule: 'travelerMismatch' })));
    }
    if (this.deps.spots.findDistrict(event.districtId) === undefined) {
      return log.fail(fail(AppError.of('DISTRICT_NOT_FOUND', '地区が見つかりません', { districtId: event.districtId })));
    }
    const changed = await this.update(world.value, [event.districtId]);
    if (!changed.ok) return log.fail(changed);
    return log.exit(okVoid());
  }

  /**
   * 地区の主を再判定し、交代があれば盤を保存してイベントを発行する。
   * @param world 旅人の世界
   * @param districtIds 再判定する地区（検証済み）
   * @returns 成功: 発行した DistrictLordChanged。失敗: STORAGE_FAILED／CONFLICT（盤の保存）
   * @sideEffect 交代があれば LordshipRepository.save と EventBus.publish
   */
  private async update(world: World, districtIds: readonly DistrictId[]): Promise<Result<DistrictLordChanged[]>> {
    const log = logger.fn('update', { districts: districtIds.length, today: world.today });
    const recalculated = recalculateLords({
      board: world.board, districtIds, today: world.today, visits: world.traveler.visits, rivals: world.rivals, actions: world.actions,
    });
    if (recalculated.changes.length === 0) return log.exit(ok([]), '交代なし');
    const saved = await this.deps.lordships.save(recalculated.board, world.board.version);
    if (!saved.ok) return log.fail(saved);
    const events = recalculated.changes.map((change) => this.toEvent(world, change));
    await this.deps.events.publish(events);
    log.info('地区の主が交代', { changes: events.map((e) => ({ districtId: e.districtId, toName: e.toName })) });
    return log.exit(ok(events));
  }

  /**
   * 主の交代を DistrictLordChanged にする（旅人の表示名は「あなた」、ライバルはマスタの名前）。
   * @param world 旅人の世界（ライバルの名前を引く）
   * @param change 主の交代
   * @returns DistrictLordChanged
   * @sideEffect EventFactory の sequence を進める
   */
  private toEvent(world: World, change: LordChange): DistrictLordChanged {
    const log = logger.fn('toEvent', { districtId: change.districtId });
    const fromName = lordNameOf(change.from, world.rivals);
    const event = this.deps.eventFactory.create(world.traveler.id, {
      type: 'DistrictLordChanged',
      districtId: change.districtId,
      ...(change.from === undefined ? {} : { from: change.from }),
      to: change.to,
      ...(fromName === undefined ? {} : { fromName }),
      toName: lordNameOf(change.to, world.rivals) ?? UNKNOWN_LORD_NAME,
      travelerCount: change.travelerCount,
      lordCount: change.lordCount,
    });
    return log.exit(event);
  }
}
