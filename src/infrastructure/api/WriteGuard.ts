/**
 * @file 書込系の要求の二重登録を防ぐ（infrastructure/api 層。DI-07 を HTTP でも守る。docs/09 §7.3）
 * CMS の画面は、押すたびに新しい操作ID を作る。ブラウザだけで動かしていたときは保存が一瞬で終わるので問題なかったが、
 * サーバー経由では待ち時間があり、次の2つで同じ内容が2回登録されうる。画面を変えずに、ここで防ぐ。
 * - 連打：同じ内容の要求が送信中なら、新しく送らずに同じ結果を返す
 * - 結果が分からない失敗（つながらない・時間切れ・応答が壊れている・サーバー内部の失敗）のあとに同じ内容を送り直す：
 *   前と同じ操作ID で送る。前の要求がサーバーで保存済みなら、サーバーは二重に登録せず今の状態を返す
 * 「同じ内容」は、方法・道筋・本文（操作ID を除く）が同じもの。
 */
import { createLogger } from '@/Common/logging/logger';
import type { Result } from '@/Common/result/Result';
import { isRecord } from '@/Common/utils/guards';
import { requestApi } from '@/infrastructure/api/requestApi';
import type { ApiClientDeps, ApiRequest } from '@/infrastructure/api/requestApi';

const logger = createLogger('infrastructure/api/WriteGuard');

/** 結果が分からない失敗のコード（サーバーで保存されたかもしれない） */
const OUTCOME_UNKNOWN_CODES: ReadonlySet<string> = new Set(['NETWORK_FAILED', 'INVALID_RESPONSE', 'INTERNAL']);
/** 操作ID を覚えておく内容の数の上限 */
const MAX_REMEMBERED = 50;

/** 書込系の要求の二重登録を防ぐ */
export class WriteGuard {
  /** 内容 → 送信中の要求 */
  private readonly inflight = new Map<string, Promise<Result<unknown>>>();
  /** 内容 → 結果が分からなかった要求の操作ID */
  private readonly unknownOutcome = new Map<string, string>();

  /**
   * 要求を送る（同じ内容が送信中なら同じ結果を共有し、結果が分からなかった内容は前と同じ操作ID で送り直す）。
   * @param deps API 呼び出しの依存
   * @param req 書込系の要求（本文に operationId を持つ）
   * @returns サーバーの応答
   * @sideEffect ネットワーク
   */
  async send(deps: ApiClientDeps, req: ApiRequest): Promise<Result<unknown>> {
    const log = logger.fn('send', { method: req.method, path: req.path });
    const body = isRecord(req.body) ? req.body : {};
    const key = `${req.method} ${req.path} ${JSON.stringify({ ...body, operationId: undefined })}`;
    const running = this.inflight.get(key);
    if (running !== undefined) return log.exit(await running, 'shared');
    const previous = this.unknownOutcome.get(key);
    const operationId = previous ?? (typeof body['operationId'] === 'string' ? body['operationId'] : undefined);
    const sending = requestApi(deps, operationId === undefined ? req : { ...req, body: { ...body, operationId } });
    this.inflight.set(key, sending);
    try {
      const result = await sending;
      this.remember(key, !result.ok && OUTCOME_UNKNOWN_CODES.has(result.error.code) ? operationId : undefined);
      return log.exit(result, previous === undefined ? 'sent' : 'resent');
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * 結果が分からなかった内容の操作ID を覚える（分かったら忘れる）。
   * @param key 内容
   * @param operationId 覚える操作ID（undefined なら忘れる）
   * @sideEffect 覚える数が上限を超えたら古いものを捨てる
   */
  private remember(key: string, operationId: string | undefined): void {
    const log = logger.fn('remember', { unknown: operationId !== undefined });
    this.unknownOutcome.delete(key);
    if (operationId !== undefined) this.unknownOutcome.set(key, operationId);
    const oldest = this.unknownOutcome.keys().next();
    if (this.unknownOutcome.size > MAX_REMEMBERED && oldest.done !== true) this.unknownOutcome.delete(oldest.value);
    log.exit(undefined);
  }
}
