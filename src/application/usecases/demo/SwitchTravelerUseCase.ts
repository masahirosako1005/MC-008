/**
 * @file デモの旅人切替ユースケース（application 層・デモ専用）
 * 日付のずらしを 0 に戻し（D13）、対象プロフィールの旅人・台帳・地区の主・ライバル行動を消してシードを今日基準で作り直し、
 * アクティブな旅人を切り替えて、位置を開始地区（DEMO_START_DISTRICT_ID_TEXT＝南森町・天満宮地区）の入口へ戻す（docs/08 §4.4, §9.3）。何度やっても同じ状態から実演を始められる。
 * isDemoBuild が false なら DEMO_DISABLED で拒否する（SEC-02）。呼び出しは warn ログで記録する（DI-20）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { SwitchTravelerInput, SwitchTravelerOutput } from '@/application/dto/Dto';
import type { DemoControl } from '@/application/ports/DemoControl';
import { demoDisabled, isDemoEnabled } from '@/application/usecases/demo/demoGuard';
import type { DemoSwitch } from '@/application/usecases/demo/demoGuard';
import { startEntranceOf } from '@/application/usecases/demo/demoPosition';
import { isDemoProfile } from '@/application/usecases/demo/demoSeeds';
import { installDemoSeed } from '@/application/usecases/demo/installDemoSeed';
import type { DemoSeedStoreDeps } from '@/application/usecases/demo/installDemoSeed';
import type { Clock } from '@/domain/ports/Clock';

const logger = createLogger('application/usecases/demo/SwitchTravelerUseCase');

/** SwitchTravelerUseCase の依存 */
export interface SwitchTravelerDeps extends DemoSeedStoreDeps, DemoSwitch {
  readonly clock: Clock;
  readonly demoControl: DemoControl;
}

/** デモの旅人切替 */
export class SwitchTravelerUseCase implements UseCase<SwitchTravelerInput, SwitchTravelerOutput> {
  private readonly enabled: boolean;

  /**
   * ユースケースを作る。
   * @param deps リポジトリ・ライバル・マスタ・時計・デモ操作・有効フラグ（省略時 isDemoBuild）
   */
  constructor(private readonly deps: SwitchTravelerDeps) {
    this.enabled = isDemoEnabled(deps);
  }

  /**
   * 旅人を切り替える（データを今日基準のシードで作り直す）。
   * @param input プロフィール（'first' 初回の人 / 'regular' 通い慣れた人）
   * @returns 成功: 旅人ID とプロフィール。失敗: DEMO_DISABLED／INVALID_INPUT（プロフィール不正）／DISTRICT_NOT_FOUND（開始地区が無い）／
   *          SPOT_NOT_FOUND（シードのスポットが無い）／STORAGE_FAILED／CONFLICT
   * @sideEffect DemoControl.resetOffset・setPosition。デモの旅人のデータを削除して保存し直し、SessionRepository.save
   * @see docs/08 §4.4, §4.5, D13、docs/05 SEC-02、docs/06 DI-20, DI-23
   */
  async execute(input: SwitchTravelerInput): Promise<Result<SwitchTravelerOutput>> {
    const log = logger.fn('execute', { profile: input.profile });
    log.warn('デモ操作: 旅人切替', { profile: input.profile, enabled: this.enabled });
    if (!this.enabled) return log.fail(demoDisabled());
    const profile: unknown = input.profile;
    if (!isDemoProfile(profile)) return log.fail(fail(AppError.of('INVALID_INPUT', '旅人の種類が正しくありません')));
    const entrance = startEntranceOf(this.deps.spots);
    if (!entrance.ok) return log.fail(entrance);
    const reset = this.deps.demoControl.resetOffset();
    if (!reset.ok) return log.fail(reset);
    const traveler = await installDemoSeed(this.deps, { profile, today: this.deps.clock.today() });
    if (!traveler.ok) return log.fail(traveler);
    this.deps.demoControl.setPosition(entrance.value);
    log.info('旅人を切り替えた', { travelerId: traveler.value.id, profile, visits: traveler.value.visits.length });
    return log.exit(ok(Object.freeze({ travelerId: traveler.value.id, profile })));
  }
}
