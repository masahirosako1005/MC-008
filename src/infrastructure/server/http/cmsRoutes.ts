/**
 * @file 店舗CMS の API（infrastructure/server/http 層。デモの版だけ。docs/09 §7.3）
 * CMS の画面（HttpCmsServices）から呼ばれ、フェーズ1と同じ application のユースケースをサーバー側で動かす。
 * 規則（協力店だけ・字数・期間・同時掲載の上限・二重登録の防止・楽観ロック）は、ユースケースがサーバー側で確かめる（SEC-03）。
 * ここでは「本文の形」と「デモの日付のずらし日数」だけを確かめてからユースケースへ渡す（DI-01、SEC-16）。
 *
 * ログインはまだ無い（フェーズ2。docs/09 CMS-A01〜A07）。店舗は道筋のスポットID で選ぶ（デモの「店を選ぶ」と同じ）。
 * フェーズ2では、スポットID をログイン中のアカウントの担当店舗と照らし合わせる（SEC-01）。
 */
import type { IncomingMessage } from 'node:http';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { CmsServices } from '@/application/CmsServices';
import type { RegisterShopEventInput, SaveShopInfoInput, WithdrawShopEventInput } from '@/application/dto/CmsDto';
import { DEMO_OFFSET_HEADER } from '@/infrastructure/api/apiRoutes';
import { REGISTER_SHOP_EVENT_BODY_SHAPE, SAVE_SHOP_INFO_BODY_SHAPE, WITHDRAW_SHOP_EVENT_BODY_SHAPE } from '@/infrastructure/api/schema/cmsApiShapes';
import { parseWithShape } from '@/infrastructure/api/schema/shape';
import type { Shape } from '@/infrastructure/api/schema/shape';
import type { Route, RouteContext } from '@/infrastructure/server/http/createApiHandler';
import { readJsonBody, sendResult } from '@/infrastructure/server/http/httpIo';
import { parseDemoOffsetDays } from '@/infrastructure/storage/schema/parsers';

const logger = createLogger('infrastructure/server/http/cmsRoutes');

/** 店舗CMS の API の依存 */
export interface CmsRouteDeps {
  /** デモの日付のずらし日数に合わせたユースケース一式を作る（1回の要求ごと） */
  readonly servicesFor: (offsetDays: number) => CmsServices;
}

/** 道筋の中の ID（形はユースケースが確かめる） */
const ID = '([A-Za-z0-9_-]{1,64})';
/** 店舗の道筋の先頭 */
const SHOPS = '^/api/cms/shops';

/** ユースケースを呼ぶ関数 */
type Runner = (services: CmsServices, ctx: RouteContext) => Promise<Result<unknown, AppError>>;

/**
 * デモの日付のずらし日数をヘッダーから読む（無ければ 0）。
 * @param req 要求
 * @returns 成功: 0〜MAX_DEMO_OFFSET_DAYS の整数。失敗: INVALID_INPUT
 */
function demoOffsetOf(req: IncomingMessage): Result<number> {
  const log = logger.fn('demoOffsetOf');
  const raw = req.headers[DEMO_OFFSET_HEADER];
  if (raw === undefined) return log.exit(ok(0));
  const days = typeof raw === 'string' ? parseDemoOffsetDays(raw) : undefined;
  if (days?.ok === true) return log.exit(days);
  return log.fail(fail(AppError.of('INVALID_INPUT', 'デモの日付が正しくありません', { field: DEMO_OFFSET_HEADER })));
}

/**
 * 本文を読み、形を確かめる。
 * @param req 要求
 * @param s 形
 * @param kind 何の本文か
 * @returns 成功: 本文。失敗: UNSUPPORTED_MEDIA_TYPE / PAYLOAD_TOO_LARGE / INVALID_INPUT
 */
async function bodyOf<T>(req: IncomingMessage, s: Shape, kind: string): Promise<Result<T>> {
  const log = logger.fn('bodyOf', { kind });
  const raw = await readJsonBody(req);
  if (!raw.ok) return log.fail(raw);
  const parsed = parseWithShape<T>(raw.value, s, kind);
  return parsed.ok ? log.exit(parsed) : log.fail(parsed);
}

/**
 * 道筋の値を取り出す（正規表現で一致しているので必ずある）。
 * @param ctx 要求の文脈
 * @param index 何番目か
 * @returns 値
 */
function param(ctx: RouteContext, index: number): string {
  return ctx.params[index] ?? '';
}

/**
 * 1つの API を作る。
 * @param spec 方法・道筋・書込系か・ユースケースを呼ぶ関数
 * @param deps 依存
 * @returns Route
 */
function route(spec: { method: Route['method']; pattern: string; write: boolean; run: Runner }, deps: CmsRouteDeps): Route {
  return {
    method: spec.method,
    pattern: new RegExp(`${spec.pattern}$`),
    write: spec.write,
    handle: async (ctx) => {
      const log = logger.fn('handle', { method: spec.method, pattern: spec.pattern });
      const offset = demoOffsetOf(ctx.req);
      if (!offset.ok) return log.exit(sendResult(ctx.res, offset), 'offset');
      const result = await spec.run(deps.servicesFor(offset.value), ctx);
      sendResult(ctx.res, result);
      return log.exit(undefined, result.ok ? 'ok' : result.error.code);
    },
  };
}

/**
 * 営業時間・便利情報を保存する。
 * @param services ユースケース一式
 * @param ctx 要求の文脈
 * @returns ユースケースの結果
 */
async function saveShopInfo(services: CmsServices, ctx: RouteContext): Promise<Result<unknown, AppError>> {
  const log = logger.fn('saveShopInfo');
  const body = await bodyOf<Omit<SaveShopInfoInput, 'spotId'>>(ctx.req, SAVE_SHOP_INFO_BODY_SHAPE, 'SaveShopInfoBody');
  return log.exit(body.ok ? await services.saveShopInfo.execute({ ...body.value, spotId: param(ctx, 0) }) : body);
}

/**
 * クーポン・イベントを登録する。
 * @param services ユースケース一式
 * @param ctx 要求の文脈
 * @returns ユースケースの結果
 */
async function registerShopEvent(services: CmsServices, ctx: RouteContext): Promise<Result<unknown, AppError>> {
  const log = logger.fn('registerShopEvent');
  const body = await bodyOf<Omit<RegisterShopEventInput, 'spotId'>>(ctx.req, REGISTER_SHOP_EVENT_BODY_SHAPE, 'RegisterShopEventBody');
  return log.exit(body.ok ? await services.registerShopEvent.execute({ ...body.value, spotId: param(ctx, 0) }) : body);
}

/**
 * クーポン・イベントを取り下げる。
 * @param services ユースケース一式
 * @param ctx 要求の文脈
 * @returns ユースケースの結果
 */
async function withdrawShopEvent(services: CmsServices, ctx: RouteContext): Promise<Result<unknown, AppError>> {
  const log = logger.fn('withdrawShopEvent');
  const body = await bodyOf<Pick<WithdrawShopEventInput, 'operationId'>>(ctx.req, WITHDRAW_SHOP_EVENT_BODY_SHAPE, 'WithdrawShopEventBody');
  return log.exit(body.ok ? await services.withdrawShopEvent.execute({ ...body.value, spotId: param(ctx, 0), shopEventId: param(ctx, 1) }) : body);
}

/**
 * デモのやり直し（登録内容をすべて消す）。本文は空のオブジェクトを JSON で送る（ほかのサイトからの単純な送信を防ぐ）。
 * @param services ユースケース一式
 * @param ctx 要求の文脈
 * @returns ユースケースの結果
 */
async function resetDemo(services: CmsServices, ctx: RouteContext): Promise<Result<unknown, AppError>> {
  const log = logger.fn('resetDemo');
  const body = await readJsonBody(ctx.req);
  return log.exit(body.ok ? await services.resetDemo.execute() : body);
}

/**
 * 店舗CMS の API の一覧を作る（デモの版だけで登録する）。
 * @param deps 依存
 * @returns Route の一覧
 */
export function cmsRoutes(deps: CmsRouteDeps): readonly Route[] {
  const log = logger.fn('cmsRoutes');
  return log.exit([
    route({ method: 'GET', pattern: SHOPS, write: false, run: (s) => s.shops.execute() }, deps),
    route({ method: 'GET', pattern: `${SHOPS}/${ID}`, write: false, run: (s, ctx) => s.shopInfo.execute({ spotId: param(ctx, 0) }) }, deps),
    route({ method: 'PUT', pattern: `${SHOPS}/${ID}/info`, write: true, run: saveShopInfo }, deps),
    route({ method: 'POST', pattern: `${SHOPS}/${ID}/events`, write: true, run: registerShopEvent }, deps),
    route({ method: 'POST', pattern: `${SHOPS}/${ID}/events/${ID}/withdraw`, write: true, run: withdrawShopEvent }, deps),
    route({ method: 'GET', pattern: `${SHOPS}/${ID}/visit-stats`, write: false, run: (s, ctx) => s.visitStats.execute({ spotId: param(ctx, 0) }) }, deps),
    route({ method: 'POST', pattern: '^/api/cms/demo/reset', write: true, run: resetDemo }, deps),
  ]);
}
