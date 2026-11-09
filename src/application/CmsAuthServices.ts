/**
 * @file 店舗CMS のログインとアカウント管理の入口（application 層。docs/09 CMS-A04〜A07）
 * 連携サーバーにつなぐとき（VITE_CMS_BACKEND=server）だけ CmsServices.auth に入る。ブラウザだけの CMS（フェーズ1）には無い。
 * 画面はこれで「ログインしているか」「運営者か」を知るが、権限の確認はサーバーが行う（SEC-01、SEC-03）。
 */
import type { UseCase } from '@/application/AppServices';
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

/** アカウント管理（運営者だけ。サーバーがロールを確かめる） */
export interface CmsAccountServices {
  readonly list: UseCase<void, readonly CmsAccountDto[]>;
  readonly create: UseCase<CreateCmsAccountInput, CmsAccountDto>;
  readonly updateShops: UseCase<UpdateCmsAccountShopsInput, CmsAccountDto>;
  readonly setStatus: UseCase<SetCmsAccountStatusInput, CmsAccountDto>;
  readonly resetPassword: UseCase<ResetCmsAccountPasswordInput, void>;
}

/** ログインとアカウント */
export interface CmsAuthServices {
  /** ログイン中の人（していなければ UNAUTHENTICATED） */
  readonly me: UseCase<void, CmsPrincipalDto>;
  /** ログインする（失敗は AUTH_FAILED / ACCOUNT_LOCKED / RATE_LIMITED） */
  readonly login: UseCase<CmsLoginInput, CmsPrincipalDto>;
  readonly logout: UseCase<void, void>;
  /** 自分のパスワードを変える（ほかの端末のログインは切れる） */
  readonly changePassword: UseCase<CmsChangePasswordInput, void>;
  /** デモの版だけ：運営者か店舗の担当者として入る（CMS-A09 の「店を選ぶ」を、本物のセッションで再現する） */
  readonly demoLogin?: UseCase<CmsDemoLoginInput, CmsPrincipalDto>;
  readonly accounts: CmsAccountServices;
}
