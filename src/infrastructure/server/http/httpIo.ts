/**
 * @file 連携サーバーの HTTP の読み書き（infrastructure/server/http 層の境界）
 * - 応答：JSON の封筒 { ok, value | error }。失敗は code・message・文字/数値/真偽だけの details を返し、
 *   例外の中身・スタックは出さない（OWASP A10、SEC-08）
 * - 本文：Content-Type が application/json のものだけを、大きさの上限つきで読む（SEC-18。ほかのサイトからの単純な送信も防ぐ＝SEC-28）
 * - 書込系の要求は、Origin が自分のオリジンと同じときだけ受け付ける（SEC-28）
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { isRecord } from '@/Common/utils/guards';
import type { ApiEnvelope, ApiErrorDetails } from '@/infrastructure/api/apiRoutes';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';

const logger = createLogger('infrastructure/server/http/httpIo');

/** 要求の本文の上限（バイト） */
export const MAX_BODY_BYTES = 16 * 1024;

/** API の応答に付けるヘッダー（SEC-04, SEC-29） */
export const API_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
});

/** 失敗コード → HTTP ステータス（ここに無いものは 422＝規則に合わない） */
const STATUS_BY_CODE: Readonly<Record<string, number>> = Object.freeze({
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  AUTH_FAILED: 401,
  FORBIDDEN: 403,
  FORBIDDEN_SHOP: 403,
  FORBIDDEN_ORIGIN: 403,
  FORBIDDEN_HOST: 403,
  NOT_FOUND: 404,
  SPOT_NOT_FOUND: 404,
  ACCOUNT_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  LOGIN_ID_TAKEN: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  STORAGE_FAILED: 503,
  STREAM_FULL: 503,
});

/**
 * 失敗コードの HTTP ステータスを返す。
 * @param code 失敗コード
 * @returns ステータス
 */
export function statusOf(code: string): number {
  return STATUS_BY_CODE[code] ?? 422;
}

/**
 * JSON を返す。
 * @param res 応答
 * @param status ステータス
 * @param body 本文（JSON にする）
 * @param headers 足すヘッダー
 * @sideEffect 応答を書き終える
 */
export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): void {
  const log = logger.fn('sendJson', { status });
  if (res.headersSent) return log.exit(undefined, 'alreadySent');
  const tooLarge = status === statusOf('PAYLOAD_TOO_LARGE');
  // 大きすぎる本文は読み終えずに断るので、応答を送ったらつながりごと閉じる（残りを送り続けさせない）
  res.writeHead(status, { ...API_RESPONSE_HEADERS, ...headers, ...(tooLarge ? { Connection: 'close' } : {}) });
  if (tooLarge) res.on('finish', () => res.req.destroy());
  res.end(JSON.stringify(body));
  return log.exit(undefined);
}

/**
 * 失敗の補足から、文字・数値・真偽だけを残す。
 * @param details 補足
 * @returns 補足（無ければ undefined）
 */
function publicDetails(details: AppError['details']): ApiErrorDetails | undefined {
  const log = logger.fn('publicDetails');
  if (details === undefined) return log.exit(undefined);
  const entries = Object.entries(details).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v));
  // 境界での型付け：直前の filter で値を文字・数値・真偽に絞ってある
  return log.exit(entries.length === 0 ? undefined : (Object.fromEntries(entries) as ApiErrorDetails));
}

/**
 * ユースケースの結果を封筒にして返す。
 * @param res 応答
 * @param result 結果
 * @sideEffect 応答を書き終える
 */
export function sendResult(res: ServerResponse, result: Result<unknown, AppError>): void {
  const log = logger.fn('sendResult', { ok: result.ok });
  if (result.ok) {
    const body: ApiEnvelope<unknown> = result.value === undefined ? { ok: true } : { ok: true, value: result.value };
    sendJson(res, 200, body);
    return log.exit(undefined);
  }
  const { code, message } = result.error;
  const details = publicDetails(result.error.details);
  const body: ApiEnvelope<never> = { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } };
  sendJson(res, statusOf(code), body);
  return log.exit(undefined, code);
}

/**
 * 失敗を返す（ユースケースを呼ぶ前の失敗）。
 * @param res 応答
 * @param code 失敗コード
 * @param message 利用者向けのメッセージ
 * @sideEffect 応答を書き終える
 */
export function sendFailure(res: ServerResponse, code: string, message: string): void {
  sendResult(res, fail(AppError.of(code, message)));
}

/**
 * 本文を上限つきで集める。
 * @param req 要求
 * @param limit 上限（バイト）
 * @returns 成功: 本文のバイト列。失敗: PAYLOAD_TOO_LARGE（超えた時点で返す）/ INVALID_INPUT（途中で切れた）
 * @sideEffect 要求のストリームを読む。上限を超えたら読むのをやめる（つながりは sendJson が 413 のあとで閉じる）
 */
function collectBody(req: IncomingMessage, limit: number): Promise<Result<Buffer>> {
  const log = logger.fn('collectBody', { limit });
  return new Promise((resolveBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    /** 1かたまり受け取る（上限を超えたら読むのをやめて断る） */
    const onData = (chunk: Buffer): void => { // audit-ignore: fnlog-missing 受け取るたびに呼ぶ小さな集計（collectBody で記録する）
      size += chunk.length;
      if (size <= limit) {
        chunks.push(chunk);
        return;
      }
      req.off('data', onData);
      req.pause();
      resolveBody(fail(AppError.of('PAYLOAD_TOO_LARGE', '送る内容が大きすぎます')));
    };
    req.on('data', onData);
    req.on('end', () => resolveBody(ok(Buffer.concat(chunks))));
    req.on('error', () => resolveBody(fail(AppError.of('INVALID_INPUT', '送る内容を受け取れませんでした'))));
    log.exit(undefined);
  });
}

/**
 * JSON の本文を読む。
 * @param req 要求
 * @param limit 上限（バイト。省略時は MAX_BODY_BYTES）
 * @returns 成功: JSON の値（未検証）。失敗: UNSUPPORTED_MEDIA_TYPE / PAYLOAD_TOO_LARGE / INVALID_INPUT
 * @sideEffect 要求のストリームを読む
 */
export async function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Result<unknown>> {
  const log = logger.fn('readJsonBody', { limit });
  if (!/^application\/json(\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    return log.fail(fail(AppError.of('UNSUPPORTED_MEDIA_TYPE', 'JSON で送ってください')));
  }
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) return log.fail(fail(AppError.of('PAYLOAD_TOO_LARGE', '送る内容が大きすぎます')));
  const body = await collectBody(req, limit);
  if (!body.ok) return log.fail(body);
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(body.value);
  } catch {
    log.warn('本文が UTF-8 ではありません');
    return log.fail(fail(AppError.of('INVALID_INPUT', '文字の形式が正しくありません')));
  }
  const parsed = parseJsonText(decoded, 'RequestBody');
  if (!parsed.ok) return log.fail(parsed);
  return isRecord(parsed.value) ? log.exit(parsed) : log.fail(fail(AppError.of('INVALID_INPUT', '送る内容の形が正しくありません')));
}

/**
 * Host ヘッダーからホスト名（ポートを除いた部分）を取り出す。
 * @param req 要求
 * @returns 小文字のホスト名（無ければ undefined）
 */
export function hostNameOf(req: IncomingMessage): string | undefined { // audit-ignore: fnlog-missing 要求ごとに呼ぶ文字列の切り出し（呼び出し元が記録する）
  const host = req.headers.host;
  if (host === undefined) return undefined;
  const bracketed = /^\[([0-9A-Fa-f:.]+)\](?::\d{1,5})?$/.exec(host);
  return (bracketed?.[1] ?? host.replace(/:\d{1,5}$/, '')).toLowerCase();
}

/**
 * Host ヘッダーが、DNS リバインディングに使えない名前か確かめる（'localhost'・IP アドレス・運用で決めたホスト名だけを許す）。
 * 攻撃者のドメイン名を 127.0.0.1 や LAN の IP に向け直すと、Origin と Host がどちらも攻撃者の名前でそろい、
 * isSameOrigin だけでは見分けられない。名前でつながる要求を断ることで防ぐ（SEC-28）。
 * @param req 要求
 * @param allowedHosts 本番で使うホスト名（--allowed-hosts。小文字で比べる）
 * @returns 許すなら true
 */
export function isAllowedHost(req: IncomingMessage, allowedHosts: readonly string[] = []): boolean {
  const log = logger.fn('isAllowedHost', { allowed: allowedHosts.length });
  const name = hostNameOf(req);
  if (name === undefined) return log.exit(false, 'noHost');
  return log.exit(name === 'localhost' || isIP(name) !== 0 || allowedHosts.some((h) => h.toLowerCase() === name));
}

/**
 * 書込系の要求が自分のオリジンから来たか確かめる（Origin が無い要求＝ブラウザ以外の道具は通す）。
 * @param req 要求
 * @returns 同じオリジン（または Origin なし）なら true
 */
export function isSameOrigin(req: IncomingMessage): boolean {
  const log = logger.fn('isSameOrigin');
  const origin = req.headers.origin;
  if (origin === undefined) return log.exit(true, 'noOrigin');
  try {
    return log.exit(new URL(origin).host === req.headers.host);
  } catch {
    log.warn('Origin を読めません');
    return log.exit(false);
  }
}

/**
 * 回数制限に使う相手の識別子（IP アドレス）を返す。ログには出さない（PRV）。
 * @param req 要求
 * @returns IP アドレス（分からなければ 'unknown'）
 */
export function clientKeyOf(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}
