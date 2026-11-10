/**
 * @file 起動時にアクティブな旅人を用意するユースケース（application 層）
 * 起動時に1回だけ呼ぶ。セッションの旅人が保存済みなら何もしない（デモビルドで、保存済みの「通い慣れた人」が今のシードより古いときだけ作り直す）。無ければ（D14）:
 * - デモビルド: 「通い慣れた人」のシードを作る（旅人切替 regular と同じ＝installDemoSeed）。
 *   VITE_DEMO_START=first でビルドしたとき（空の状態で始めるデモ。scripts/dev/demo-fresh.mjs）は「初回の人」を作る
 * - 本番ビルド: 端末ID（'t_' ＋ UUID の16進）で新しい旅人（profile 'user'）を作り、地区の主の初期状態を計算して保存する
 * どちらもセッションのアクティブな旅人にする（以降のユースケースはセッションから旅人を解決する＝SEC-01）。
 */
import { DEMO_START_PROFILE, isDemoBuild } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { travelerIdFromUuid } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import type { UseCase } from '@/application/AppServices';
import { isRegularSeedOutdated } from '@/application/usecases/demo/demoSeeds';
import { installDemoSeed } from '@/application/usecases/demo/installDemoSeed';
import type { DemoSeedStoreDeps } from '@/application/usecases/demo/installDemoSeed';
import { persistNewTraveler } from '@/application/usecases/session/TravelerSetup';
import { DEFAULT_NICKNAME } from '@/domain/exploration/constants';
import { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerProfile } from '@/domain/exploration/Traveler';
import type { Clock } from '@/domain/ports/Clock';
import { PointLedger } from '@/domain/reward/PointLedger';

const logger = createLogger('application/usecases/session/EnsureTravelerUseCase');

/** EnsureTravelerUseCase の依存 */
export interface EnsureTravelerDeps extends DemoSeedStoreDeps {
  readonly clock: Clock;
  /** 本番の端末ID の元になる UUID を返す（container で crypto.randomUUID を渡す。ids.newId は使わない） */
  readonly uuid: () => string;
  /** デモビルドか（省略時は isDemoBuild）。true なら「通い慣れた人」を作る */
  readonly demo?: boolean;
}

/** EnsureTravelerUseCase の出力 */
export interface EnsureTravelerOutput {
  readonly travelerId: string;
  readonly profile: TravelerProfile;
  /** 今回新しく作った（false なら既存の旅人をそのまま使う） */
  readonly created: boolean;
}

/**
 * 旅人から出力を作る。
 * @param traveler 旅人
 * @param created 今回作ったか
 * @returns 出力（凍結済み）
 */
function outputOf(traveler: Traveler, created: boolean): EnsureTravelerOutput {
  return Object.freeze({ travelerId: traveler.id, profile: traveler.profile, created });
}

/** 起動時に旅人を用意するユースケース */
export class EnsureTravelerUseCase implements UseCase<void, EnsureTravelerOutput> {
  private readonly demo: boolean;

  /**
   * ユースケースを作る。
   * @param deps リポジトリ・ライバル・マスタ・時計・UUID 発行・デモか
   */
  constructor(private readonly deps: EnsureTravelerDeps) {
    this.demo = deps.demo ?? isDemoBuild;
  }

  /**
   * アクティブな旅人を用意する（保存済みなら何もしない。デモビルドで「通い慣れた人」のシードが古ければ作り直す）。
   * @returns 成功: 旅人ID・プロフィール・作ったか。失敗: STORAGE_FAILED（読込・保存）／CONFLICT／INVALID_INPUT（UUID が不正）／SPOT_NOT_FOUND（デモのシード）
   * @sideEffect 旅人が無ければ TravelerRepository・PointLedgerRepository・LordshipRepository・SessionRepository に保存する
   * @see docs/08 D14, §4.5
   */
  async execute(): Promise<Result<EnsureTravelerOutput>> {
    const log = logger.fn('execute', { demo: this.demo });
    const existing = await this.findExisting();
    if (!existing.ok) return log.fail(existing);
    if (existing.value !== undefined) {
      if (!this.demo || !isRegularSeedOutdated(existing.value)) return log.exit(ok(outputOf(existing.value, false)), '既存の旅人');
      log.info('保存済みの「通い慣れた人」が今のシードより古いため作り直す', { travelerId: existing.value.id, visits: existing.value.visits.length });
    }
    const today = this.deps.clock.today();
    const created = this.demo ? await installDemoSeed(this.deps, { profile: DEMO_START_PROFILE, today }) : await this.createUser(today);
    if (!created.ok) return log.fail(created);
    log.info('旅人を新しく作成', { travelerId: created.value.id, profile: created.value.profile });
    return log.exit(ok(outputOf(created.value, true)));
  }

  /**
   * セッションのアクティブな旅人を読む（セッションに無い・保存されていなければ undefined）。
   * @returns 成功: 旅人または undefined。失敗: STORAGE_FAILED（セッション・旅人の読込。壊れたデータを上書きしない）
   * @sideEffect SessionRepository.load・TravelerRepository.findById（読むだけ）
   */
  private async findExisting(): Promise<Result<Traveler | undefined>> {
    const log = logger.fn('findExisting');
    const session = await this.deps.session.load();
    if (!session.ok) return log.fail(session);
    const travelerId = session.value.activeTravelerId;
    if (travelerId === undefined) return log.exit(ok(undefined), 'セッションに旅人なし');
    const found = await this.deps.travelers.findById(travelerId);
    if (!found.ok) return log.fail(found);
    if (found.value === undefined) log.warn('セッションの旅人が保存されていないため作り直す', { travelerId });
    return log.exit(ok(found.value));
  }

  /**
   * 本番の新しい旅人（端末ID・profile 'user'・記録なし）を作って保存する。
   * @param today 今日（主の初期状態の集計期間の終端）
   * @returns 成功: 保存後の旅人。失敗: INVALID_INPUT（UUID が不正）／STORAGE_FAILED／CONFLICT
   * @sideEffect persistNewTraveler（旅人・主の初期状態・セッションを保存）
   */
  private async createUser(today: LocalDate): Promise<Result<Traveler>> {
    const log = logger.fn('createUser', { today });
    const travelerId = travelerIdFromUuid(this.deps.uuid());
    if (!travelerId.ok) return log.fail(travelerId);
    const traveler = Traveler.create(travelerId.value, DEFAULT_NICKNAME, 'user');
    return log.exit(await persistNewTraveler(this.deps, { traveler, ledger: PointLedger.empty(travelerId.value), today }));
  }
}
