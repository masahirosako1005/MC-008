/**
 * @file 店舗CMS のサービスを連携サーバー経由で使う実装（infrastructure/api 層。CmsServices の HTTP 版。docs/09 §7.3）
 * CMS の画面は CmsServices だけを見るので、LocalStorage 版（フェーズ1）と差し替えても画面は変わらない。
 * 規則（協力店だけ・字数・期間・同時掲載の上限・二重登録の防止）はサーバー側のユースケースが確かめる（SEC-03）。
 * ここでは応答の形を検証してから画面へ渡す（DI-01）。
 * デモの日付進行（DemoClock のずらし日数）は、ヘッダーでサーバーへ伝える（サーバーがデモのときだけ読む）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { CmsServices } from '@/application/CmsServices';
import type {
  CmsShopInfoDto,
  CmsShopInput,
  CmsShopSummaryDto,
  CmsVisitStatsDto,
  RegisterShopEventInput,
  SaveShopInfoInput,
  WithdrawShopEventInput,
} from '@/application/dto/CmsDto';
import { API_PATHS, cmsShopPath, cmsWithdrawPath, DEMO_OFFSET_HEADER } from '@/infrastructure/api/apiRoutes';
import { requestApi } from '@/infrastructure/api/requestApi';
import type { ApiClientDeps, ApiRequest } from '@/infrastructure/api/requestApi';
import { CMS_SHOP_INFO_SHAPE, CMS_SHOP_LIST_SHAPE, CMS_VISIT_STATS_SHAPE } from '@/infrastructure/api/schema/cmsApiShapes';
import { parseWithShape } from '@/infrastructure/api/schema/shape';
import type { Shape } from '@/infrastructure/api/schema/shape';
import { WriteGuard } from '@/infrastructure/api/WriteGuard';

const logger = createLogger('infrastructure/api/HttpCmsServices');

/** HTTP 版の依存 */
export interface HttpCmsServicesDeps extends Omit<ApiClientDeps, 'headers'> {
  /** デモの日付のずらし日数（デモの CMS だけが渡す） */
  readonly demoOffsetDays?: () => number;
}

/**
 * 応答の value を検証する関数を作る。
 * @param s 形
 * @param kind 何の値か
 * @returns 検証する関数
 */
function byShape<O>(s: Shape, kind: string): (raw: unknown) => Result<O> {
  return (raw) => parseWithShape<O>(raw, s, kind);
}

/**
 * 値を返さない応答を検証する。
 * @param raw 応答の value
 * @returns 成功: void。失敗: INVALID_RESPONSE
 */
function parseVoid(raw: unknown): Result<void> {
  return raw === undefined ? ok(undefined) : fail(AppError.of('INVALID_RESPONSE', 'サーバーの応答が正しくありません'));
}

/** API の呼び出し口（読取系はそのまま、書込系は二重登録の防止を通す） */
interface ApiClient {
  readonly deps: ApiClientDeps;
  readonly guard: WriteGuard;
}

/**
 * API を1回呼ぶユースケースを作る。
 * @param client API の呼び出し口
 * @param toRequest 入力 → 呼び出し
 * @param parse 応答の value の検証
 * @returns ユースケース
 */
function apiUseCase<I, O>(client: ApiClient, toRequest: (input: I) => ApiRequest, parse: (raw: unknown) => Result<O>): UseCase<I, O> {
  return {
    /**
     * サーバーのユースケースを呼び、応答を検証して返す。
     * @param input 入力
     * @returns 成功: 検証済みの値。失敗: サーバーの AppError / NETWORK_FAILED / INVALID_RESPONSE / INVALID_INPUT
     * @sideEffect ネットワーク（書込系はサーバーの登録内容を変える）
     */
    async execute(input: I): Promise<Result<O, AppError>> {
      const req = toRequest(input);
      const log = logger.fn('execute', { method: req.method, path: req.path });
      const answered = req.method === 'GET' ? await requestApi(client.deps, req) : await client.guard.send(client.deps, req);
      if (!answered.ok) return log.fail(answered);
      const parsed = parse(answered.value);
      return parsed.ok ? log.exit(parsed) : log.fail(parsed);
    },
  };
}

/**
 * 毎回付けるヘッダーを作る（デモの日付のずらし日数）。
 * @param deps 依存
 * @returns ヘッダーを返す関数（デモでなければ undefined）
 */
function headersOf(deps: HttpCmsServicesDeps): (() => Readonly<Record<string, string>>) | undefined {
  const log = logger.fn('headersOf', { demo: deps.demoOffsetDays !== undefined });
  const offset = deps.demoOffsetDays;
  if (offset === undefined) return log.exit(undefined);
  return log.exit(() => ({ [DEMO_OFFSET_HEADER]: String(offset()) }));
}

/**
 * 連携サーバー経由の CmsServices を作る。
 * @param deps fetch・起点・デモの日付のずらし日数
 * @returns CmsServices
 */
export function createHttpCmsServices(deps: HttpCmsServicesDeps = {}): CmsServices {
  const log = logger.fn('createHttpCmsServices', { baseUrl: deps.baseUrl ?? '' });
  const headers = headersOf(deps);
  const client: ApiClient = { deps: { ...deps, ...(headers === undefined ? {} : { headers }) }, guard: new WriteGuard() };
  const info = byShape<CmsShopInfoDto>(CMS_SHOP_INFO_SHAPE, 'CmsShopInfoDto');
  return log.exit(Object.freeze({
    shops: apiUseCase<void, readonly CmsShopSummaryDto[]>(client, () => ({ method: 'GET', path: API_PATHS.cmsShops }), byShape(CMS_SHOP_LIST_SHAPE, 'CmsShopSummaryDto[]')),
    shopInfo: apiUseCase<CmsShopInput, CmsShopInfoDto>(client, (i) => ({ method: 'GET', path: cmsShopPath(i.spotId) }), info),
    saveShopInfo: apiUseCase<SaveShopInfoInput, CmsShopInfoDto>(client, (i) => ({
      method: 'PUT', path: cmsShopPath(i.spotId, 'info'), body: { hours: i.hours, amenities: i.amenities, operationId: i.operationId },
    }), info),
    registerShopEvent: apiUseCase<RegisterShopEventInput, CmsShopInfoDto>(client, (i) => ({
      method: 'POST', path: cmsShopPath(i.spotId, 'events'),
      body: { kind: i.kind, title: i.title, description: i.description, start: i.start, end: i.end, operationId: i.operationId },
    }), info),
    withdrawShopEvent: apiUseCase<WithdrawShopEventInput, CmsShopInfoDto>(client, (i) => ({
      method: 'POST', path: cmsWithdrawPath(i.spotId, i.shopEventId), body: { operationId: i.operationId },
    }), info),
    visitStats: apiUseCase<CmsShopInput, CmsVisitStatsDto>(client, (i) => ({ method: 'GET', path: cmsShopPath(i.spotId, 'visit-stats') }), byShape(CMS_VISIT_STATS_SHAPE, 'CmsVisitStatsDto')),
    resetDemo: apiUseCase<void, void>(client, () => ({ method: 'POST', path: API_PATHS.cmsDemoReset, body: {} }), parseVoid),
  }));
}
