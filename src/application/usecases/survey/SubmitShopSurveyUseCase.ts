/**
 * @file お店のアンケートに答えるユースケース（application/usecases/survey 層・書込系）
 * 入力を信用しない（SEC-16）：お店（名所ではない）であること・選択肢にある値だけ・ひとことの字数を確かめる。
 * 答えられるのは、そのお店を訪問したことのある旅人だけ（来店した人の声だけを集める。旅人は入力ではなくセッションから決める＝SEC-01）。
 * 同じ送信（operationId）を何度送っても1件だけ残る（DI-07）。回答は匿名で、旅人ID・位置は保存しない（PRV-03）。
 * 答えても EXP・カード・図鑑は変わらない（歩かずに稼げる仕組みは作らない＝CLAUDE.md 5）。ひとことの中身はログに出さない。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseOperationId, parseSpotId } from '@/Common/types/Id';
import { isRecord } from '@/Common/utils/guards';
import type { UseCase } from '@/application/AppServices';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import type { SurveyResponseRepository } from '@/application/ports/SurveyResponseRepository';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import { parseSurveyAnswers } from '@/application/usecases/survey/shopSurvey';
import type { SubmitShopSurveyInput } from '@/application/usecases/survey/shopSurvey';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import type { Clock } from '@/domain/ports/Clock';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/survey/SubmitShopSurveyUseCase');

/** 訪問していないお店のアンケートに答えようとしたときの失敗コード */
export const SURVEY_VISIT_REQUIRED = 'SURVEY_VISIT_REQUIRED';

/** SubmitShopSurveyUseCase の依存 */
export interface SubmitShopSurveyDeps {
  readonly spots: SpotRepository;
  readonly session: SessionRepository;
  readonly travelers: TravelerRepository;
  readonly surveys: SurveyResponseRepository;
  readonly clock: Clock;
}

/** お店のアンケートに答える */
export class SubmitShopSurveyUseCase implements UseCase<SubmitShopSurveyInput, void> {
  /**
   * 依存を受け取る。
   * @param deps スポットの参照・セッション・旅人リポジトリ・回答の保存先・時計
   */
  constructor(private readonly deps: SubmitShopSurveyDeps) {}

  /**
   * 回答を保存する。
   * @param input 操作ID・お店・答え
   * @returns 成功: void。失敗: INVALID_INPUT／SPOT_NOT_FOUND（無い・名所）／SURVEY_VISIT_REQUIRED（訪問していない）／TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect 回答の保存先に1件足す
   */
  async execute(input: SubmitShopSurveyInput): Promise<Result<void>> {
    const log = logger.fn('execute', { spotId: isRecord(input) ? input.spotId : undefined });
    if (!isRecord(input)) return log.fail(fail(AppError.of('INVALID_INPUT', 'アンケートの内容が正しくありません', { rule: 'shape' })));
    const operationId = parseOperationId(input.operationId);
    if (!operationId.ok) return log.fail(operationId);
    const spotId = parseSpotId(input.spotId);
    if (!spotId.ok) return log.fail(spotId);
    const spot = this.deps.spots.findSpot(spotId.value);
    if (spot === undefined || spot.kind !== 'shop') return log.fail(fail(AppError.of('SPOT_NOT_FOUND', 'お店が見つかりません', { spotId: spotId.value })));
    const answers = parseSurveyAnswers(input);
    if (!answers.ok) return log.fail(answers);
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    if (!traveler.value.hasVisited(spotId.value)) return log.fail(fail(AppError.of(SURVEY_VISIT_REQUIRED, 'アンケートはクエスト達成後に答えられます', { spotId: spotId.value })));
    const saved = await this.deps.surveys.append(Object.freeze({ ...answers.value, id: operationId.value, spotId: spotId.value, answeredAt: this.deps.clock.now() }));
    if (!saved.ok) return log.fail(saved);
    return log.exit(okVoid());
  }
}
