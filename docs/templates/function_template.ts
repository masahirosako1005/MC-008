/**
 * @file 関数・ユースケースの雛形（コピーして使う）
 * 規約: docs/03_coding_standards.md, docs/04_comment_and_logging.md
 * 1) ファイル先頭に @file コメント
 * 2) すべての関数に日本語 JSDoc（何を・なぜ・引数・戻り値・副作用）
 * 3) 関数先頭で logger.fn()、戻りは log.exit() / log.fail()
 * 4) 失敗は Result で返す。例外は境界（infrastructure）でのみ捕捉
 */
import { createLogger } from '../../src/Common/logging/logger';          // 実装時は '@/Common/logging/logger'
import type { Result } from '../../src/Common/result/Result';
import { ok, fail, AppError } from '../../src/Common/result/Result';

const logger = createLogger('domain/exploration/DiscoveryRule');

// ---------------------------------------------------------------------------
// A. 純粋関数（domain 層）の雛形
// ---------------------------------------------------------------------------

/** 訪問成立とみなす最大距離（メートル）。constants.ts に置く */
export const VISIT_RADIUS_M = 40;

/**
 * 旅人とスポットの距離が訪問半径（VISIT_RADIUS_M = 40m）以内か判定する。
 * QR風訪問の成立条件。発見（80m）とは別ルールなので混同しないこと。
 * @param distanceMeters 旅人とスポットの距離（メートル、0以上の整数）
 * @returns 40m以内なら true
 * @see docs/01_architecture.md §2 探索コンテキスト
 */
export function isWithinVisitRadius(distanceMeters: number): boolean {
  const log = logger.fn('isWithinVisitRadius', { distanceMeters });
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return log.fail(false, '不正な距離');
  }
  return log.exit(distanceMeters <= VISIT_RADIUS_M);
}

// ---------------------------------------------------------------------------
// B. ユースケース（application 層）の雛形
// ---------------------------------------------------------------------------

/** 入力DTO: プリミティブのみ。operationId は冪等性のため必須（DI-07） */
export interface VisitSpotInput {
  readonly operationId: string;
  readonly travelerId: string;
  readonly spotId: string;
}

/** 出力DTO */
export interface VisitSpotOutput {
  readonly awardedPoints: number;
  readonly districtRevived: boolean;
}

/** 失敗コード。@returns に列挙する */
export type VisitSpotErrorCode = 'OUT_OF_RANGE' | 'ALREADY_VISITED_TODAY' | 'FACILITY_NOT_FOUND' | 'GEO_UNAVAILABLE';

/** 依存はインターフェースで受け取る（コンストラクタ注入） */
interface Deps {
  readonly geo: { current(): Promise<Result<{ lat: number; lng: number; accuracyM: number }>> };
  readonly clock: { now(): Date };
  readonly travelers: { findById(id: string): Promise<unknown>; save(t: unknown, expectedVersion: number): Promise<Result<void>> };
}

const ucLogger = createLogger('application/VisitSpotUseCase');

/**
 * スポット訪問ユースケース。
 * 現在地を取得し、40m以内なら訪問を記録して加点し、SpotVisited を発行する。
 * 同じ operationId の再実行は no-op（冪等）。
 * @sideEffect TravelerRepository.save、EventBus.publish(SpotVisited)
 * @see docs/06_data_integrity_checklist.md DI-07, DI-10, DI-14
 */
export class VisitSpotUseCase {
  constructor(private readonly deps: Deps) {}

  /**
   * 訪問を実行する。
   * @param input 操作ID・旅人ID・スポットID
   * @returns 成功: 加点・復活有無。失敗: OUT_OF_RANGE / ALREADY_VISITED_TODAY / FACILITY_NOT_FOUND / GEO_UNAVAILABLE
   */
  async execute(input: VisitSpotInput): Promise<Result<VisitSpotOutput, AppError<VisitSpotErrorCode>>> {
    const log = ucLogger.fn('execute', input);

    const geo = await this.deps.geo.current();
    if (!geo.ok) return log.fail(fail(AppError.of('GEO_UNAVAILABLE', '現在地を取得できません')));
    log.debug('現在地取得', { accuracyM: geo.value.accuracyM }); // 座標そのものは出さない（LG-03）

    // ... 距離計算 → isWithinVisitRadius → traveler.visit() → save(expectedVersion) → publish ...

    return log.exit(ok({ awardedPoints: 10, districtRevived: false }));
  }
}
