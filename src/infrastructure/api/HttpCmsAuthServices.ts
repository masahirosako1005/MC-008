/**
 * @file ログイン・アカウントのサービスを連携サーバー経由で使う実装（infrastructure/api 層。CmsAuthServices の HTTP 版）
 * セッションは Cookie（HttpOnly）なので、ここではトークンを扱わない。fetch は credentials: 'same-origin' で Cookie を送る（requestApi）。
 * 応答は形を検証してから画面へ渡す（DI-01）。権限の確認はサーバーが行う（SEC-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { CmsAccountServices, CmsAuthServices } from '@/application/CmsAuthServices';
import type {
  CmsAccountDto,
  CmsChangePasswordInput,
  CmsDemoLoginInput,
  CmsLoginInput,
  CmsPrincipalDto,
  CreateCmsAccountInput,
  ResetCmsAccountPasswordInput,
  SetCmsAccountStatusInput,
  UpdateCmsAccountShopsInput,
} from '@/application/dto/CmsAuthDto';
import { AUTH_PATHS, cmsAccountPath } from '@/infrastructure/api/apiAuthRoutes';
import { requestApi } from '@/infrastructure/api/requestApi';
import type { ApiClientDeps, ApiRequest } from '@/infrastructure/api/requestApi';
import { CMS_ACCOUNT_LIST_SHAPE, CMS_ACCOUNT_RESPONSE_SHAPE, CMS_PRINCIPAL_SHAPE } from '@/infrastructure/api/schema/authApiShapes';
import { parseWithShape } from '@/infrastructure/api/schema/shape';
import type { Shape } from '@/infrastructure/api/schema/shape';

const logger = createLogger('infrastructure/api/HttpCmsAuthServices');

/** HTTP 版の設定 */
export interface HttpCmsAuthServicesOptions {
  /** デモの版か（デモのログインを出す） */
  readonly demo: boolean;
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

/**
 * API を1回呼ぶユースケースを作る。
 * @param deps API 呼び出しの依存
 * @param toRequest 入力 → 呼び出し
 * @param parse 応答の value の検証
 * @returns ユースケース
 */
function authUseCase<I, O>(deps: ApiClientDeps, toRequest: (input: I) => ApiRequest, parse: (raw: unknown) => Result<O>): UseCase<I, O> {
  return {
    /**
     * サーバーを呼び、応答を検証して返す。
     * @param input 入力
     * @returns 成功: 検証済みの値。失敗: サーバーの AppError（UNAUTHENTICATED・AUTH_FAILED など）/ NETWORK_FAILED / INVALID_RESPONSE
     * @sideEffect ネットワーク（ログインは Cookie を受け取る）
     */
    async execute(input: I): Promise<Result<O, AppError>> {
      const req = toRequest(input);
      const log = logger.fn('execute', { method: req.method, path: req.path });
      const answered = await requestApi(deps, req);
      if (!answered.ok) return log.fail(answered);
      const parsed = parse(answered.value);
      return parsed.ok ? log.exit(parsed) : log.fail(parsed);
    },
  };
}

/**
 * アカウント管理の呼び出しを作る。
 * @param deps API 呼び出しの依存
 * @returns CmsAccountServices
 */
function accountServices(deps: ApiClientDeps): CmsAccountServices {
  const log = logger.fn('accountServices');
  const account = byShape<CmsAccountDto>(CMS_ACCOUNT_RESPONSE_SHAPE, 'CmsAccountDto');
  return log.exit({
    list: authUseCase<void, readonly CmsAccountDto[]>(deps, () => ({ method: 'GET', path: AUTH_PATHS.accounts }), byShape(CMS_ACCOUNT_LIST_SHAPE, 'CmsAccountDto[]')),
    create: authUseCase<CreateCmsAccountInput, CmsAccountDto>(deps, (i) => ({
      method: 'POST', path: AUTH_PATHS.accounts, body: { loginId: i.loginId, displayName: i.displayName, role: i.role, shopIds: i.shopIds, password: i.password },
    }), account),
    updateShops: authUseCase<UpdateCmsAccountShopsInput, CmsAccountDto>(deps, (i) => ({ method: 'PUT', path: cmsAccountPath(i.accountId, 'shops'), body: { shopIds: i.shopIds } }), account),
    setStatus: authUseCase<SetCmsAccountStatusInput, CmsAccountDto>(deps, (i) => ({ method: 'PUT', path: cmsAccountPath(i.accountId, 'status'), body: { status: i.status } }), account),
    resetPassword: authUseCase<ResetCmsAccountPasswordInput, void>(deps, (i) => ({ method: 'POST', path: cmsAccountPath(i.accountId, 'password'), body: { newPassword: i.newPassword } }), parseVoid),
  });
}

/**
 * 連携サーバー経由の CmsAuthServices を作る。
 * @param deps fetch・起点（CMS の API と同じもの）
 * @param opts デモか
 * @returns CmsAuthServices
 */
export function createHttpCmsAuthServices(deps: ApiClientDeps, opts: HttpCmsAuthServicesOptions): CmsAuthServices {
  const log = logger.fn('createHttpCmsAuthServices', { demo: opts.demo });
  const principal = byShape<CmsPrincipalDto>(CMS_PRINCIPAL_SHAPE, 'CmsPrincipalDto');
  return log.exit(Object.freeze({
    me: authUseCase<void, CmsPrincipalDto>(deps, () => ({ method: 'GET', path: AUTH_PATHS.me }), principal),
    login: authUseCase<CmsLoginInput, CmsPrincipalDto>(deps, (i) => ({ method: 'POST', path: AUTH_PATHS.login, body: { loginId: i.loginId, password: i.password } }), principal),
    logout: authUseCase<void, void>(deps, () => ({ method: 'POST', path: AUTH_PATHS.logout, body: {} }), parseVoid),
    changePassword: authUseCase<CmsChangePasswordInput, void>(deps, (i) => ({
      method: 'POST', path: AUTH_PATHS.passwordChange, body: { currentPassword: i.currentPassword, newPassword: i.newPassword },
    }), parseVoid),
    ...(opts.demo ? {
      demoLogin: authUseCase<CmsDemoLoginInput, CmsPrincipalDto>(deps, (i) => ({
        method: 'POST', path: AUTH_PATHS.demoLogin, body: { role: i.role, ...(i.spotId === undefined ? {} : { spotId: i.spotId }) },
      }), principal),
    } : {}),
    accounts: accountServices(deps),
  }));
}
