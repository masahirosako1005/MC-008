/**
 * @file 店舗CMS の API（infrastructure/server/http 層。docs/09 §7.3、§1.2）
 * CMS の画面（HttpCmsServices）から呼ばれ、フェーズ1と同じ application のユースケースをサーバー側で動かす。
 * 規則（協力店だけ・字数・期間・同時掲載の上限・二重登録の防止・楽観ロック）は、ユースケースがサーバー側で確かめる（SEC-03）。
 * ここでは「ログイン中の人がその店舗を扱えるか」「本文の形」「デモの日付のずらし日数」を確かめてからユースケースへ渡す（SEC-01、DI-01、SEC-16）。
 *
 * - すべての API にログインが要る（Route.auth。createApiHandler が 401/403 を返す）
 * - 店舗の API は、道筋のスポットID をログイン中の人の担当店舗と照らし合わせる（運営者はすべての店舗）。合わなければ 403
 * - 店舗の一覧は、担当する店舗だけを返す（運営者はすべて）
 * - デモのやり直しは、デモの版の運営者だけ
 * - デモの日付のずらし日数（ヘッダー）は、デモの版だけが読む
 */
import type { IncomingMessage } from 'node:http';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { CmsServices } from '@/application/CmsServices';
import type { CmsShopSummaryDto, RegisterShopEventInput, SaveShopInfoInput, WithdrawShopEventInput } from '@/application/dto/CmsDto';
import { DEMO_OFFSET_HEADER } from '@/infrastructure/api/apiRoutes';
import { REGISTER_SHOP_EVENT_BODY_SHAPE, SAVE_SHOP_INFO_BODY_SHAPE, WITHDRAW_SHOP_EVENT_BODY_SHAPE } from '@/infrastructure/api/schema/cmsApiShapes';
import { parseWithShape } from '@/infrastructure/api/schema/shape';
import type { Shape } from '@/infrastructure/api/schema/shape';
import { canAccessShop } from '@/infrastructure/server/auth/principal';
import type { Principal } from '@/infrastructure/server/auth/principal';
import type { Route, RouteAuth, RouteContext } from '@/infrastructure/server/http/createApiHandler';
import { readJsonBody, sendResult } from '@/infrastructure/server/http/httpIo';
import { parseDemoOffsetDays } from '@/infrastructure/storage/schema/parsers';

const logger = createLogger('infrastructure/server/http/cmsRoutes');

/** 店舗CMS の API の依存 */
export interface CmsRouteDeps {
  /** demo: デモの日付のずらし日数とデモのやり直しを受け付ける */
  readonly mode: 'demo' | 'production';
  /**
   * ユースケース一式を作る（1回の要求ごと）。
   * @param offsetDays デモの日付のずらし日数（本番は常に 0）
   * @param actor 変更履歴に残す操作者（ログイン中のアカウントID）
   */
  readonly servicesFor: (offsetDays: number, actor: string) => CmsServices;
}

/** 道筋の中の ID（形はユースケースが確かめる） */
const ID = '([A-Za-z0-9_-]{1,64})';
/** 店舗の道筋の先頭 */
const SHOPS = '^/api/cms/shops';

/** 権限の範囲：list＝担当する店舗だけに絞る／shop＝道筋の店舗を担当しているか／operator＝運営者だけ */
type Scope = 'list' | 'shop' | 'operator';

/** ユースケースを呼ぶ関数 */
type Runner = (services: CmsServices, ctx: RouteContext, principal: Principal) => Promise<Result<unknown, AppError>>;

/** 1つの API の定義 */
interface RouteSpec {
  readonly method: Route['method'];
  readonly pattern: string;
  readonly write: boolean;
  readonly scope: Scope;
  readonly run: Runner;
}

/**
 * デモの日付のずらし日数をヘッダーから読む（デモの版だけ。無ければ 0）。
 * @param req 要求
 * @param mode 版
 * @returns 成功: 0〜MAX_DEMO_OFFSET_DAYS の整数。失敗: INVALID_INPUT
 */
function demoOffsetOf(req: IncomingMessage, mode: CmsRouteDeps['mode']): Result<number> {
  const log = logger.fn('demoOffsetOf', { mode });
  const raw = req.headers[DEMO_OFFSET_HEADER];
  if (mode !== 'demo' || raw === undefined) return log.exit(ok(0));
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
 * 店舗の範囲を確かめる（道筋の店舗を担当しているか＝SEC-01）。
 * @param principal ログイン中の人
 * @param ctx 要求の文脈
 * @returns 成功: void。失敗: FORBIDDEN_SHOP
 */
function checkShopScope(principal: Principal, ctx: RouteContext): Result<void> {
  const log = logger.fn('checkShopScope', { accountId: principal.accountId, spotId: param(ctx, 0) });
  if (canAccessShop(principal, param(ctx, 0))) return log.exit(ok(undefined));
  log.warn('担当していない店舗への要求を断りました（SEC-01）', { accountId: principal.accountId });
  return log.fail(fail(AppError.of('FORBIDDEN_SHOP', 'この店舗は担当していません')));
}

/**
 * 店舗の一覧を担当する店舗だけに絞る（運営者はそのまま）。
 * @param principal ログイン中の人
 * @param result 一覧の結果
 * @returns 絞った結果
 */
function filterShops(principal: Principal, result: Result<unknown, AppError>): Result<unknown, AppError> {
  const log = logger.fn('filterShops', { role: principal.role });
  if (!result.ok || principal.role === 'operator' || !Array.isArray(result.value)) return log.exit(result);
  const shops = result.value as readonly CmsShopSummaryDto[];
  return log.exit(ok(shops.filter((s) => principal.shopIds.has(s.id))));
}

/**
 * 1つの API を作る。
 * @param spec 方法・道筋・書込系か・権限の範囲・ユースケースを呼ぶ関数
 * @param deps 依存
 * @returns Route
 */
function route(spec: RouteSpec, deps: CmsRouteDeps): Route {
  const auth: RouteAuth = spec.scope === 'operator' ? 'operator' : 'session';
  return {
    method: spec.method,
    pattern: new RegExp(`${spec.pattern}$`),
    write: spec.write,
    auth,
    handle: async (ctx) => {
      const log = logger.fn('handle', { method: spec.method, pattern: spec.pattern, scope: spec.scope });
      const principal = ctx.principal;
      if (principal === undefined) return log.exit(sendResult(ctx.res, fail(AppError.of('UNAUTHENTICATED', 'ログインしてください'))), 'noPrincipal');
      if (spec.scope === 'shop') {
        const scoped = checkShopScope(principal, ctx);
        if (!scoped.ok) return log.exit(sendResult(ctx.res, scoped), 'scope');
      }
      const offset = demoOffsetOf(ctx.req, deps.mode);
      if (!offset.ok) return log.exit(sendResult(ctx.res, offset), 'offset');
      const result = await spec.run(deps.servicesFor(offset.value, principal.accountId), ctx, principal);
      sendResult(ctx.res, spec.scope === 'list' ? filterShops(principal, result) : result);
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
 * 店舗CMS の API の一覧を作る（すべてログインが要る。デモのやり直しはデモの版だけ）。
 * @param deps 依存
 * @returns Route の一覧
 */
export function cmsRoutes(deps: CmsRouteDeps): readonly Route[] {
  const log = logger.fn('cmsRoutes', { mode: deps.mode });
  const routes: Route[] = [
    route({ method: 'GET', pattern: SHOPS, write: false, scope: 'list', run: (s) => s.shops.execute() }, deps),
    route({ method: 'GET', pattern: `${SHOPS}/${ID}`, write: false, scope: 'shop', run: (s, ctx) => s.shopInfo.execute({ spotId: param(ctx, 0) }) }, deps),
    route({ method: 'PUT', pattern: `${SHOPS}/${ID}/info`, write: true, scope: 'shop', run: saveShopInfo }, deps),
    route({ method: 'POST', pattern: `${SHOPS}/${ID}/events`, write: true, scope: 'shop', run: registerShopEvent }, deps),
    route({ method: 'POST', pattern: `${SHOPS}/${ID}/events/${ID}/withdraw`, write: true, scope: 'shop', run: withdrawShopEvent }, deps),
    route({ method: 'GET', pattern: `${SHOPS}/${ID}/visit-stats`, write: false, scope: 'shop', run: (s, ctx) => s.visitStats.execute({ spotId: param(ctx, 0) }) }, deps),
    route({ method: 'GET', pattern: `${SHOPS}/${ID}/survey`, write: false, scope: 'shop', run: (s, ctx) => s.survey.execute({ spotId: param(ctx, 0) }) }, deps),
  ];
  if (deps.mode === 'demo') routes.push(route({ method: 'POST', pattern: '^/api/cms/demo/reset', write: true, scope: 'operator', run: resetDemo }, deps));
  return log.exit(routes, `count=${routes.length}`);
}
