/**
 * @file デモの旅人のデータを作り直して保存する（application 層）
 * 旅人切替（SwitchTravelerUseCase）と、デモビルド初回起動の旅人準備（EnsureTravelerUseCase）で使う（docs/08 §4.4, D13, D14）。
 * 対象プロフィールの旅人・台帳・地区の主・ライバル行動を削除してから、シード（demoSeeds）を今日基準で作って保存し、アクティブにする。
 * 削除するのはデモの固定 ID の旅人のデータだけ（本番の旅人には触れない。デモはストレージ名前空間も別＝DI-23）。
 */
import { createLogger } from '@/Common/logging/logger';
import { okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import { buildDemoSeed } from '@/application/usecases/demo/demoSeeds';
import type { DemoProfile } from '@/application/usecases/demo/demoSeeds';
import { persistNewTraveler } from '@/application/usecases/session/TravelerSetup';
import type { TravelerStoreDeps } from '@/application/usecases/session/TravelerSetup';
import type { RivalActionRepository } from '@/domain/competition/RivalRepository';
import type { Traveler } from '@/domain/exploration/Traveler';

const logger = createLogger('application/usecases/demo/installDemoSeed');

/** デモの旅人を作り直すための依存 */
export interface DemoSeedStoreDeps extends TravelerStoreDeps {
  /** ライバル行動（旅人の世界に属するので一緒に消す） */
  readonly rivalActions: RivalActionRepository;
}

/** installDemoSeed の入力 */
export interface DemoSeedRequest {
  readonly profile: DemoProfile;
  /** 今日（T）。シードはここを基準に作る */
  readonly today: LocalDate;
}

/**
 * デモの旅人の保存データ（旅人・台帳・地区の主・ライバル行動）をすべて消す。
 * @param deps リポジトリ
 * @param travelerId デモの旅人ID
 * @returns 成功: void。失敗: STORAGE_FAILED
 * @sideEffect TravelerRepository.delete・PointLedgerRepository.delete・LordshipRepository.delete・RivalActionRepository.clear
 */
async function clearDemoTraveler(deps: DemoSeedStoreDeps, travelerId: TravelerId): Promise<Result<void>> {
  const log = logger.fn('clearDemoTraveler', { travelerId });
  const results = [
    await deps.travelers.delete(travelerId),
    await deps.ledgers.delete(travelerId),
    await deps.lordships.delete(travelerId),
    await deps.rivalActions.clear(travelerId),
  ];
  for (const result of results) {
    if (!result.ok) return log.fail(result);
  }
  return log.exit(okVoid());
}

/**
 * デモの旅人を今日基準のシードで作り直し、アクティブな旅人にする。
 * @param deps リポジトリ・ライバル・マスタ
 * @param request プロフィール・今日
 * @returns 成功: 保存後の旅人。失敗: SPOT_NOT_FOUND（シードのスポットがマスタに無い）／INVALID_INPUT／STORAGE_FAILED／CONFLICT
 * @sideEffect デモの旅人のデータを削除して保存し直す。SessionRepository.save
 * @see docs/08 §4.4, §4.5, D13, D14
 */
export async function installDemoSeed(deps: DemoSeedStoreDeps, request: DemoSeedRequest): Promise<Result<Traveler>> {
  const log = logger.fn('installDemoSeed', { profile: request.profile, today: request.today });
  const seed = buildDemoSeed(request.profile, { today: request.today, spots: deps.spots });
  if (!seed.ok) return log.fail(seed);
  const cleared = await clearDemoTraveler(deps, seed.value.traveler.id);
  if (!cleared.ok) return log.fail(cleared);
  const saved = await persistNewTraveler(deps, { traveler: seed.value.traveler, ledger: seed.value.ledger, today: request.today });
  if (!saved.ok) return log.fail(saved);
  return log.exit(saved);
}
