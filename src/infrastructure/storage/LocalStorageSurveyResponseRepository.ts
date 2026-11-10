/**
 * @file お店のアンケートの回答の localStorage リポジトリ（infrastructure/storage 層。SurveyResponseRepository の実装）
 * キー: P+'cms.surveys'（デモは nnishi.demo.cms.surveys）。保存形式は封筒 { schemaVersion, version, data: { items: [...] } }（docs/08 §5）。
 * 同じオリジンの利用者アプリ（回答を足す）と店舗CMS（読む）が同じキーを使う。'cms.' で始まるので、利用者の書き出し・全削除には入らない。
 * 読込時に ID・日時・答えを検証する（DI-01）。読めないデータは EnvelopeStore が退避し、空として扱う。
 * 足すときは「読む → 足す → 書く」を同期で行う（localStorage は同期 API なので、同じタブの中では割り込まれない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseOperationId, parseSpotId } from '@/Common/types/Id';
import { parseInstant } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import { SURVEY_RESPONSE_LIMIT } from '@/application/ports/SurveyResponseRepository';
import type { SurveyResponseRepository } from '@/application/ports/SurveyResponseRepository';
import { parseSurveyAnswers } from '@/application/usecases/survey/shopSurvey';
import type { SurveyResponse } from '@/application/usecases/survey/shopSurvey';
import type { StorageRepositoryDeps } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { EnvelopeStore } from '@/infrastructure/storage/schema/EnvelopeStore';
import type { StoredRecord } from '@/infrastructure/storage/schema/storageSchema';
import { SURVEY_RESPONSES_KEY } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/storage/LocalStorageSurveyResponseRepository');

/**
 * 形式違反の失敗値を作る。
 * @param rule 違反した規則
 * @returns INVALID_INPUT の失敗
 */
function invalid(rule: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', '保存データの形式が正しくありません', { kind: 'SurveyResponse', rule }));
}

/**
 * 保存データの1件を回答として検証する。
 * @param raw 未検証の値
 * @returns 成功: 回答（凍結済み）。失敗: INVALID_INPUT
 */
function parseResponse(raw: unknown): Result<SurveyResponse> {
  const log = logger.fn('parseResponse');
  if (!isRecord(raw)) return log.fail(invalid('shape'));
  const id = parseOperationId(raw['id']);
  const spotId = parseSpotId(raw['spotId']);
  const answeredAt = parseInstant(raw['answeredAt']);
  if (!id.ok || !spotId.ok || !answeredAt.ok) return log.fail(invalid('key'));
  const answers = parseSurveyAnswers(raw);
  if (!answers.ok) return log.fail(answers);
  return log.exit(ok(Object.freeze({ ...answers.value, id: id.value, spotId: spotId.value, answeredAt: answeredAt.value })));
}

/**
 * 保存レコードの中身を回答の一覧として検証する。
 * @param record 保存レコード
 * @returns 成功: 回答の一覧（凍結済み）。失敗: INVALID_INPUT
 */
export function parseStoredSurveyResponses(record: StoredRecord): Result<readonly SurveyResponse[]> {
  const log = logger.fn('parseStoredSurveyResponses', { version: record.version });
  const items = isRecord(record.data) ? record.data['items'] : undefined;
  if (!Array.isArray(items) || items.length > SURVEY_RESPONSE_LIMIT) return log.fail(invalid('items'));
  const responses: SurveyResponse[] = [];
  for (const item of items) {
    const parsed = parseResponse(item);
    if (!parsed.ok) return log.fail(parsed);
    responses.push(parsed.value);
  }
  return log.exit(ok(Object.freeze(responses)), `count=${responses.length}`);
}

/** アンケートの回答の localStorage リポジトリ */
export class LocalStorageSurveyResponseRepository implements SurveyResponseRepository {
  private readonly envelopes: EnvelopeStore;

  /**
   * リポジトリを作る。
   * @param deps キー・値ストアと接頭辞（STORAGE_PREFIX）
   */
  constructor(deps: StorageRepositoryDeps) {
    this.envelopes = new EnvelopeStore(deps);
  }

  /**
   * 回答をすべて読む。
   * @returns 成功: 回答の一覧（古い → 新しい。未保存なら空）。失敗: STORAGE_FAILED（読めないデータは退避済み）
   * @sideEffect 読めないデータを退避する
   */
  async list(): Promise<Result<readonly SurveyResponse[]>> {
    const log = logger.fn('list');
    const loaded = this.envelopes.read(SURVEY_RESPONSES_KEY, parseStoredSurveyResponses);
    if (!loaded.ok) return log.fail(loaded);
    return log.exit(ok(loaded.value ?? []), `count=${loaded.value?.length ?? 0}`);
  }

  /**
   * 回答を1件足す（同じ id があれば何もしない。上限を超えたら古いものから落とす）。
   * @param response 回答
   * @returns 成功: void。失敗: STORAGE_FAILED（容量超過など）
   * @sideEffect localStorage に書き込む
   */
  async append(response: SurveyResponse): Promise<Result<void>> {
    const log = logger.fn('append', { spotId: response.spotId });
    const loaded = this.envelopes.read(SURVEY_RESPONSES_KEY, parseStoredSurveyResponses);
    if (!loaded.ok) return log.fail(loaded);
    const current = loaded.value ?? [];
    if (current.some((r) => r.id === response.id)) return log.exit(okVoid(), 'duplicate');
    const version = this.envelopes.storedVersion(SURVEY_RESPONSES_KEY);
    const items = [...current, response].slice(-SURVEY_RESPONSE_LIMIT).map((r) => ({ ...r }));
    const written = this.envelopes.write(SURVEY_RESPONSES_KEY, { version: (version.ok ? version.value : 0) + 1, data: { items } });
    if (!written.ok) return log.fail(written);
    return log.exit(okVoid(), `count=${items.length}`);
  }

  /**
   * 回答をすべて消す。
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect localStorage から消す
   */
  async clear(): Promise<Result<void>> {
    const log = logger.fn('clear');
    const removed = this.envelopes.remove(SURVEY_RESPONSES_KEY);
    return removed.ok ? log.exit(okVoid()) : log.fail(removed);
  }
}
