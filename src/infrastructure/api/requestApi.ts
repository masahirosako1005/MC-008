/**
 * @file 連携サーバーへの HTTP 呼び出し（infrastructure/api 層の境界。docs/09 §7.3）
 * fetch を Result に変える。try/catch はここだけに置く（docs/03 §5）。
 * - requestApi: CMS の API（封筒 { ok, value | error } の応答）を呼び、value を取り出す
 * - requestJsonDocument: 封筒の無い JSON 文書（公開スナップショット）を取る
 * 応答は「外部データ」なので、呼び出し側が形を検証してから使う（DI-01）。同じオリジンだけに送る（SEC-07）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { isRecord } from '@/Common/utils/guards';
import type { ApiErrorDetails } from '@/infrastructure/api/apiRoutes';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';

const logger = createLogger('infrastructure/api/requestApi');

/** 応答を待つ時間の既定（ミリ秒） */
export const API_TIMEOUT_MS = 8000;

/** fetch と同じ形の関数（テストで差し替える） */
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** API 呼び出しの依存 */
export interface ApiClientDeps {
  /** 省略時はブラウザの fetch */
  readonly fetch?: FetchFn;
  /** 起点（既定は ''＝同じオリジン。テストでは 'http://127.0.0.1:ポート'） */
  readonly baseUrl?: string;
  /** 毎回付けるヘッダー（デモの日付進行など） */
  readonly headers?: () => Readonly<Record<string, string>>;
  /** 応答を待つ時間（ミリ秒） */
  readonly timeoutMs?: number;
}

/** 1回の呼び出し */
export interface ApiRequest {
  readonly method: 'GET' | 'POST' | 'PUT';
  /** apiRoutes.ts の道筋 */
  readonly path: string;
  /** JSON にして送る本文 */
  readonly body?: unknown;
}

/** 受け取った応答 */
interface RawResponse {
  readonly status: number;
  readonly text: string;
}

/**
 * ブラウザの fetch を呼ぶ（this を window に保つため、関数として包む）。
 * @param input URL
 * @param init 要求の設定
 * @returns 応答
 */
const browserFetch: FetchFn = (input, init) => fetch(input, init);

/**
 * つながらないときの失敗を作る。
 * @param cause 元の例外（ログ用）
 * @returns NETWORK_FAILED
 */
function networkFailed(cause?: unknown): Result<never> {
  return fail(AppError.of('NETWORK_FAILED', 'サーバーにつながりませんでした。時間をおいてもう一度お試しください', undefined, cause));
}

/**
 * 応答の形が正しくないときの失敗を作る。
 * @param status HTTP ステータス
 * @returns INVALID_RESPONSE
 */
function invalidResponse(status: number): Result<never> {
  return fail(AppError.of('INVALID_RESPONSE', 'サーバーの応答が正しくありません', { status }));
}

/**
 * 要求を送り、本文を文字列で受け取る。
 * @param deps 依存
 * @param req 呼び出し
 * @returns 成功: ステータスと本文。失敗: NETWORK_FAILED（つながらない・時間切れ）
 * @sideEffect ネットワーク
 */
async function send(deps: ApiClientDeps, req: ApiRequest): Promise<Result<RawResponse>> {
  const log = logger.fn('send', { method: req.method, path: req.path });
  const headers: Record<string, string> = { accept: 'application/json', ...(deps.headers?.() ?? {}) };
  const init: RequestInit = { method: req.method, headers, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(deps.timeoutMs ?? API_TIMEOUT_MS) };
  if (req.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(req.body);
  }
  try {
    const response = await (deps.fetch ?? browserFetch)(`${deps.baseUrl ?? ''}${req.path}`, init);
    const text = await response.text();
    return log.exit(ok({ status: response.status, text }), `status=${response.status}`);
  } catch (error) {
    log.warn('連携サーバーにつながりませんでした', { path: req.path });
    return log.fail(networkFailed(error));
  }
}

/**
 * 失敗の補足から、文字・数値・真偽だけを残す（内部情報を画面へ流さない）。
 * @param raw 未検証の補足
 * @returns 補足（無ければ undefined）
 */
function safeDetails(raw: unknown): ApiErrorDetails | undefined {
  const log = logger.fn('safeDetails');
  if (!isRecord(raw)) return log.exit(undefined);
  const entries = Object.entries(raw).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v));
  // 境界での型付け：直前の filter で値を文字・数値・真偽に絞ってある
  return log.exit(entries.length === 0 ? undefined : (Object.fromEntries(entries) as ApiErrorDetails));
}

/**
 * 封筒を開く。
 * @param body JSON.parse の結果
 * @param status HTTP ステータス
 * @returns 成功: value（無ければ undefined）。失敗: サーバーが返した AppError / INVALID_RESPONSE
 */
function openEnvelope(body: unknown, status: number): Result<unknown> {
  const log = logger.fn('openEnvelope', { status });
  if (!isRecord(body)) return log.fail(invalidResponse(status));
  if (body['ok'] === true && status >= 200 && status < 300) return log.exit(ok(body['value']));
  const error = body['error'];
  if (body['ok'] !== false || !AppError.isAppError(error)) return log.fail(invalidResponse(status));
  return log.fail(fail(AppError.of(error.code, error.message, { ...safeDetails(error.details), status })));
}

/**
 * CMS の API を呼び、封筒の value を返す。
 * @param deps 依存
 * @param req 呼び出し
 * @returns 成功: value（未検証）。失敗: サーバーの AppError（details.status つき）/ NETWORK_FAILED / INVALID_RESPONSE
 * @sideEffect ネットワーク
 */
export async function requestApi(deps: ApiClientDeps, req: ApiRequest): Promise<Result<unknown>> {
  const log = logger.fn('requestApi', { method: req.method, path: req.path });
  const sent = await send(deps, req);
  if (!sent.ok) return log.fail(sent);
  const parsed = parseJsonText(sent.value.text, 'ApiEnvelope');
  if (!parsed.ok) return log.fail(invalidResponse(sent.value.status));
  const opened = openEnvelope(parsed.value, sent.value.status);
  return opened.ok ? log.exit(opened) : log.fail(opened);
}

/**
 * 封筒の無い JSON 文書を取る（200 だけを成功とする）。
 * @param deps 依存
 * @param path apiRoutes.ts の道筋
 * @returns 成功: JSON（未検証）。失敗: NETWORK_FAILED / INVALID_RESPONSE（200 以外・JSON でない）
 * @sideEffect ネットワーク
 */
export async function requestJsonDocument(deps: ApiClientDeps, path: string): Promise<Result<unknown>> {
  const log = logger.fn('requestJsonDocument', { path });
  const sent = await send(deps, { method: 'GET', path });
  if (!sent.ok) return log.fail(sent);
  if (sent.value.status !== 200) return log.fail(invalidResponse(sent.value.status));
  const parsed = parseJsonText(sent.value.text, 'ApiDocument');
  return parsed.ok ? log.exit(parsed) : log.fail(invalidResponse(sent.value.status));
}
