/**
 * @file 公開の API（infrastructure/server/http 層。利用者アプリが読む。docs/09 APP-01〜03）
 * - GET /api/health：動作確認
 * - GET /api/public/cms-snapshot：公開スナップショット。ETag（版番号）で、変わっていなければ 304 を返す
 * - GET /api/public/cms-snapshot/stream：版番号の変化を SSE で知らせる
 * どれも読むだけで、本番の版でも使える（書込系の CMS の API はデモの版だけ＝cmsRoutes.ts）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { API_PATHS } from '@/infrastructure/api/apiRoutes';
import type { PublicCmsSnapshot } from '@/infrastructure/api/schema/publicCmsSnapshot';
import type { Route, RouteContext } from '@/infrastructure/server/http/createApiHandler';
import { snapshotEtagOf } from '@/infrastructure/api/schema/publicCmsSnapshot';
import type { SnapshotMarker } from '@/infrastructure/api/schema/publicCmsSnapshot';
import { API_RESPONSE_HEADERS, clientKeyOf, sendFailure, sendJson, sendResult } from '@/infrastructure/server/http/httpIo';
import type { SnapshotStream } from '@/infrastructure/server/http/SnapshotStream';

const logger = createLogger('infrastructure/server/http/publicRoutes');

/** 公開の API の依存 */
export interface PublicRouteDeps {
  readonly mode: 'demo' | 'production';
  /** 今の公開スナップショット */
  readonly snapshot: () => Promise<Result<PublicCmsSnapshot>>;
  /** 今の印（DB の ID と版番号） */
  readonly currentMarker: () => Result<SnapshotMarker>;
  readonly stream: SnapshotStream;
}

/**
 * 今の様子を返す（動作確認用）。
 * @param deps 依存
 * @param ctx 要求と応答
 * @sideEffect 応答を書き終える
 */
async function serveHealth(deps: PublicRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('serveHealth');
  const marker = deps.currentMarker();
  if (!marker.ok) return log.exit(sendResult(ctx.res, marker), marker.error.code);
  sendResult(ctx.res, ok({ status: 'ok', mode: deps.mode, dbId: marker.value.dbId, snapshotVersion: marker.value.version, streams: deps.stream.size }));
  return log.exit(undefined);
}

/**
 * SSE をつなぐ（上限に達していれば 503）。
 * @param deps 依存
 * @param ctx 要求と応答
 * @sideEffect 応答を開いたままにする
 */
async function serveStream(deps: PublicRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('serveStream');
  const marker = deps.currentMarker();
  if (!marker.ok) return log.exit(sendResult(ctx.res, marker), marker.error.code);
  if (!deps.stream.attach({ req: ctx.req, res: ctx.res, clientKey: clientKeyOf(ctx.req) }, marker.value)) {
    return log.exit(sendFailure(ctx.res, 'STREAM_FULL', 'いまは込み合っています'), 'full');
  }
  return log.exit(undefined);
}

/**
 * 道筋の文字列を、先頭から末尾まで一致させる正規表現にする。
 * @param path 道筋
 * @returns 正規表現
 */
function exactly(path: string): RegExp {
  return new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/**
 * 公開スナップショットを返す（ETag が同じなら 304）。
 * @param deps 依存
 * @param ctx 要求と応答
 * @sideEffect 応答を書き終える
 */
async function serveSnapshot(deps: PublicRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('serveSnapshot');
  const snapshot = await deps.snapshot();
  if (!snapshot.ok) return log.exit(sendResult(ctx.res, snapshot), snapshot.error.code);
  const etag = snapshotEtagOf(snapshot.value);
  const headers = { ETag: etag, 'Cache-Control': 'no-cache' };
  if (ctx.req.headers['if-none-match'] === etag) {
    ctx.res.writeHead(304, { ...API_RESPONSE_HEADERS, ...headers });
    ctx.res.end();
    return log.exit(undefined, 'notModified');
  }
  sendJson(ctx.res, 200, snapshot.value, headers);
  return log.exit(undefined, `version=${snapshot.value.version}`);
}

/**
 * 公開の API の一覧を作る。
 * @param deps 依存
 * @returns Route の一覧
 */
export function publicRoutes(deps: PublicRouteDeps): readonly Route[] {
  const log = logger.fn('publicRoutes', { mode: deps.mode });
  return log.exit([
    { method: 'GET', pattern: exactly(API_PATHS.health), write: false, handle: (ctx) => serveHealth(deps, ctx) },
    { method: 'GET', pattern: exactly(API_PATHS.publicSnapshot), write: false, handle: (ctx) => serveSnapshot(deps, ctx) },
    { method: 'GET', pattern: exactly(API_PATHS.publicSnapshotStream), write: false, handle: (ctx) => serveStream(deps, ctx) },
  ]);
}
