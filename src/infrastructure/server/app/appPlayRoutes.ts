/**
 * @file 利用者の発見・訪問・購入・チケット・状態の API（infrastructure/server/app 層。docs/12 §6 段階2）
 *
 * | 方法と道筋 | 本文 | 内容 |
 * |---|---|---|
 * | POST /api/app/discoveries | { operationId, position } | 申告された位置の周りの未発見スポットを発見済みにする |
 * | POST /api/app/visits | { operationId, spotId, position } | 訪問（クエスト達成）。距離・1日1回・EXP はサーバーが決める |
 * | POST /api/app/purchases | { operationId, spotId, position } | お店での購入の EXP（お店の近く・同じ日の上限はサーバーが決める） |
 * | POST /api/app/tickets/use | { operationId, ticketId, position } | チケット（クーポン）を使用済みにする |
 * | GET /api/app/state | — | 旅人の記録（発見・訪問・クーポン利用）と EXP の台帳 |
 *
 * position は { lat, lng, accuracyM }。端末から受け取るのは「どこで・何を」だけで、EXP・回数・日時は受け取らない（SEC-21）。
 * どれもログインが要る。旅人はセッションから決める（SEC-01）。位置は保存もログもしない（PRV-03）。
 * 書き込みは旅人ごとに1つのトランザクションにまとめ、途中で失敗したら全部を取り消す（訪問だけ残って EXP が付かない、を作らない＝DI-12）。
 * 訪問・購入・チケットは、前回の訪問からの移動としてありえる位置かも確かめる（DI-14）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { Traveler } from '@/domain/exploration/Traveler';
import type { Clock } from '@/domain/ports/Clock';
import type { PointLedger } from '@/domain/reward/PointLedger';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import type { AppPlayServices, ClaimedPosition } from '@/infrastructure/di/appPlay';
import { requireAppPrincipal } from '@/infrastructure/server/app/appAuthRoutes';
import type { AppAuthService } from '@/infrastructure/server/app/AppAuthService';
import { checkPlausibleMove } from '@/infrastructure/server/app/visitPlausibility';
import type { Route, RouteContext } from '@/infrastructure/server/http/createApiHandler';
import { readJsonBody, sendFailure, sendResult } from '@/infrastructure/server/http/httpIo';

const logger = createLogger('infrastructure/server/app/appPlayRoutes');

/** 申告を受け付ける測位精度の上限（メートル。これより粗い値は入力として不正。訪問できる精度の判定は domain が行う） */
const MAX_CLAIMED_ACCURACY_M = 100_000;

/** 本文（JSON のオブジェクト。項目は未検証） */
type RawBody = Readonly<Record<string, unknown>>;

/** 1つの書き込みの中身（ユースケースの実行） */
type PlayAction = (play: AppPlayServices, raw: RawBody) => Promise<Result<object>>;

/** 発見・訪問・状態の API の依存 */
export interface AppPlayRouteDeps {
  readonly auth: AppAuthService;
  /** 旅人が無ければ作って返す */
  readonly ensureTraveler: (travelerId: TravelerId) => Promise<Result<Traveler>>;
  /** 旅人の台帳を読む */
  readonly findLedger: (travelerId: TravelerId) => Promise<Result<PointLedger>>;
  /** 1回の要求で使うユースケースを組み立てる */
  readonly playFor: (travelerId: TravelerId, position: ClaimedPosition) => AppPlayServices;
  /** 旅人ごとに1つのトランザクションにまとめて実行する（keep が false・中の保存が失敗なら取り消して例外） */
  readonly atomically: <T>(travelerId: TravelerId, work: () => Promise<{ readonly value: T; readonly keep: boolean }>) => Promise<T>;
  /** スポットのマスタ（移動の妥当性に使う） */
  readonly spots: SpotRepository;
  readonly clock: Clock;
  /** 移動の妥当性を確かめない（自分の PC 用。地図タップの移動＝デモの歩行は徒歩より速く、続けて訪問すると TOO_FAST になるため。本番では必ず false） */
  readonly skipMoveCheck?: boolean;
}

/** 検証した本文 */
interface PlayBody {
  readonly raw: RawBody;
  readonly position: ClaimedPosition;
}

/**
 * 申告された位置を検証する。
 * @param raw 未検証の値（{ lat, lng, accuracyM }）
 * @returns 成功: 位置。失敗: INVALID_INPUT
 */
function parsePosition(raw: unknown): Result<ClaimedPosition> {
  const log = logger.fn('parsePosition'); // 位置はログに出さない（PRV-03）
  const point = GeoPoint.fromUnknown(raw);
  if (!point.ok) return log.fail(point);
  const accuracyM = (raw as { accuracyM?: unknown }).accuracyM; // fromUnknown がオブジェクトと確認済み
  if (typeof accuracyM !== 'number' || !Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > MAX_CLAIMED_ACCURACY_M) {
    return log.fail(fail(AppError.of('INVALID_INPUT', '位置の値が正しくありません', { kind: 'accuracyM' })));
  }
  log.exit(undefined, 'ok');
  return ok({ point: point.value, accuracyM });
}

/**
 * 本文（JSON のオブジェクトと position）を読む。
 * @param ctx 要求の文脈
 * @returns 成功: 本文と位置。失敗: INVALID_INPUT など
 * @sideEffect 要求のストリームを読む
 */
async function readPlayBody(ctx: RouteContext): Promise<Result<PlayBody>> {
  const log = logger.fn('readPlayBody');
  const body = await readJsonBody(ctx.req);
  if (!body.ok) return log.fail(body);
  const value = body.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return log.fail(fail(AppError.of('INVALID_INPUT', '送る内容が正しくありません')));
  const raw = value as RawBody; // オブジェクトと確認済み。項目はユースケースが検証する
  const position = parsePosition(raw['position']);
  if (!position.ok) return log.fail(position);
  log.exit(undefined, 'ok');
  return ok({ raw, position: position.value });
}

/**
 * 旅人を用意し、（必要なら）移動の妥当性を確かめてから、ユースケースを実行する。1つのトランザクションの中で呼ぶ。
 * @param deps 依存
 * @param travelerId ログイン中の旅人ID
 * @param body 検証した本文
 * @param job 実行するユースケースと、移動の妥当性を確かめるか
 * @returns value: 応答にする結果（成功ならイベントつき）／keep: 確定してよいか（訪問後の処理が失敗していたら false）
 * @sideEffect DB に書く（旅人の作成・記録・EXP）
 */
async function runPlay(deps: AppPlayRouteDeps, travelerId: TravelerId, body: PlayBody, job: { readonly action: PlayAction; readonly checkMove: boolean }): Promise<{ readonly value: Result<object>; readonly keep: boolean }> {
  const log = logger.fn('runPlay', { travelerId, checkMove: job.checkMove });
  const traveler = await deps.ensureTraveler(travelerId);
  if (!traveler.ok) return log.exit({ value: traveler, keep: false }, traveler.error.code);
  if (job.checkMove && deps.skipMoveCheck !== true) {
    const ledger = await deps.findLedger(travelerId);
    if (!ledger.ok) return log.exit({ value: ledger, keep: false }, ledger.error.code);
    const plausible = checkPlausibleMove(traveler.value, ledger.value.entries, deps.spots, body.position, deps.clock.now());
    if (!plausible.ok) return log.exit({ value: plausible, keep: true }, 'tooFast');
  }
  const play = deps.playFor(travelerId, body.position);
  const result = await job.action(play, body.raw);
  const keep = play.handlerFailures() === 0;
  return log.exit({ value: result.ok ? ok({ ...result.value, events: play.events() }) : result, keep }, result.ok ? 'ok' : result.error.code);
}

/**
 * 書き込みの API を処理する（ログイン → 本文 → 1つのトランザクションで実行 → 応答）。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @param job 実行するユースケースと、移動の妥当性を確かめるか
 * @sideEffect 応答を書き終える。DB に書く（失敗したら何も残さない）
 */
async function handleWrite(deps: AppPlayRouteDeps, ctx: RouteContext, job: { readonly action: PlayAction; readonly checkMove: boolean }): Promise<void> {
  const log = logger.fn('handleWrite');
  const principal = await requireAppPrincipal(ctx, deps.auth);
  if (principal === undefined) return log.exit(undefined, 'unauthenticated');
  const body = await readPlayBody(ctx);
  if (!body.ok) return log.exit(sendResult(ctx.res, body), body.error.code);
  try {
    const result = await deps.atomically(principal.travelerId, () => runPlay(deps, principal.travelerId, body.value, job));
    return log.exit(sendResult(ctx.res, result), result.ok ? 'ok' : result.error.code);
  } catch (error) {
    log.error('書き込みを取り消しました（何も残していません）', { message: error instanceof Error ? error.message : 'unknown' });
    return log.exit(sendFailure(ctx.res, 'STORAGE_FAILED', '保存できませんでした。もう一度お試しください'), 'rolledBack');
  }
}

/**
 * 旅人の記録と EXP の台帳を返す。
 * @param deps 依存
 * @param ctx 要求の文脈
 * @sideEffect 応答を書き終える。旅人が無ければ作る
 */
async function handleState(deps: AppPlayRouteDeps, ctx: RouteContext): Promise<void> {
  const log = logger.fn('handleState');
  const principal = await requireAppPrincipal(ctx, deps.auth);
  if (principal === undefined) return log.exit(undefined, 'unauthenticated');
  const traveler = await deps.ensureTraveler(principal.travelerId);
  if (!traveler.ok) return log.exit(sendResult(ctx.res, traveler), traveler.error.code);
  const ledger = await deps.findLedger(principal.travelerId);
  if (!ledger.ok) return log.exit(sendResult(ctx.res, ledger), ledger.error.code);
  return log.exit(sendResult(ctx.res, ok({ traveler: traveler.value.toState(), ledger: ledger.value.toState(), balance: ledger.value.balance() })));
}

// 本文の項目は未検証のままユースケースへ渡す（ユースケースが parse で検証する＝DI-01）
/** 発見 */
const DISCOVER: PlayAction = (play, raw) => play.discover.execute({ operationId: raw['operationId'] as string });
/** 訪問 */
const VISIT: PlayAction = (play, raw) => play.visit.execute({ operationId: raw['operationId'] as string, spotId: raw['spotId'] as string });
/** 購入 */
const PURCHASE: PlayAction = (play, raw) => play.purchase.execute({ operationId: raw['operationId'] as string, spotId: raw['spotId'] as string });
/** チケットを使う */
const USE_TICKET: PlayAction = (play, raw) => play.useTicket.execute({ operationId: raw['operationId'] as string, ticketId: raw['ticketId'] as string });

/**
 * 発見・訪問・購入・チケット・状態の API の一覧を作る。
 * @param deps 依存
 * @returns Route の一覧
 */
export function appPlayRoutes(deps: AppPlayRouteDeps): readonly Route[] {
  const log = logger.fn('appPlayRoutes');
  return log.exit([
    { method: 'POST', pattern: /^\/api\/app\/discoveries$/, write: true, handle: (ctx) => handleWrite(deps, ctx, { action: DISCOVER, checkMove: false }) },
    { method: 'POST', pattern: /^\/api\/app\/visits$/, write: true, handle: (ctx) => handleWrite(deps, ctx, { action: VISIT, checkMove: true }) },
    { method: 'POST', pattern: /^\/api\/app\/purchases$/, write: true, handle: (ctx) => handleWrite(deps, ctx, { action: PURCHASE, checkMove: true }) },
    { method: 'POST', pattern: /^\/api\/app\/tickets\/use$/, write: true, handle: (ctx) => handleWrite(deps, ctx, { action: USE_TICKET, checkMove: true }) },
    { method: 'GET', pattern: /^\/api\/app\/state$/, write: false, handle: (ctx) => handleState(deps, ctx) },
  ]);
}
