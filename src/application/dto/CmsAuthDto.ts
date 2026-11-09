/**
 * @file 店舗CMS のログイン・アカウントの DTO（application 層 → presentation/cms。docs/09 CMS-A04〜A07、§1.2）
 * プリミティブだけで構成する（docs/01 §3-6）。パスワードは入力の DTO にだけ現れ、応答の DTO には決して入れない（SEC-19）。
 */

/** ロール（docs/09 §1.1。店舗＝ShopOwner、運営者＝Operator） */
export type CmsRole = 'shopOwner' | 'operator';

/** アカウントの状態（CMS-A07。停止しても掲載中の内容は残る） */
export type CmsAccountStatus = 'active' | 'suspended';

/** ログイン中の人（サーバーのセッションから決まる。画面はこれで出し分けるが、権限の確認はサーバーが行う＝SEC-03） */
export interface CmsPrincipalDto {
  readonly accountId: string;
  readonly loginId: string;
  readonly displayName: string;
  readonly role: CmsRole;
  /** 担当する店舗のスポットID（運営者は空＝すべての店舗） */
  readonly shopIds: readonly string[];
  /** デモ用のアカウントか（デモの「店を選ぶ」で入ったもの。パスワードでは入れない） */
  readonly demo: boolean;
}

/** ログインの入力 */
export interface CmsLoginInput {
  readonly loginId: string;
  readonly password: string;
}

/** 自分のパスワードを変える入力 */
export interface CmsChangePasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/** デモのログイン（デモの版だけ。運営者か、1つの店舗の担当者として入る） */
export interface CmsDemoLoginInput {
  readonly role: CmsRole;
  /** 店舗の担当者として入るときのスポットID */
  readonly spotId?: string;
}

/** アカウント（運営者の一覧用。パスワードは入れない） */
export interface CmsAccountDto {
  readonly id: string;
  readonly loginId: string;
  readonly displayName: string;
  readonly role: CmsRole;
  readonly status: CmsAccountStatus;
  readonly shopIds: readonly string[];
  readonly demo: boolean;
  /** ログインの失敗が続いて、いま一時的に入れないか */
  readonly locked: boolean;
  /** 作った日時（ISO） */
  readonly createdAt: string;
  /** 最後にログインした日時（ISO。無ければ未ログイン） */
  readonly lastLoginAt?: string;
}

/** アカウントを作る入力（運営者） */
export interface CreateCmsAccountInput {
  readonly loginId: string;
  readonly displayName: string;
  readonly role: CmsRole;
  readonly shopIds: readonly string[];
  /** 最初のパスワード（本人が後で変える） */
  readonly password: string;
}

/** 担当店舗を変える入力（運営者） */
export interface UpdateCmsAccountShopsInput {
  readonly accountId: string;
  readonly shopIds: readonly string[];
}

/** 停止・再開の入力（運営者。CMS-A07） */
export interface SetCmsAccountStatusInput {
  readonly accountId: string;
  readonly status: CmsAccountStatus;
}

/** パスワードを設定し直す入力（運営者。CMS-A04 の再設定） */
export interface ResetCmsAccountPasswordInput {
  readonly accountId: string;
  readonly newPassword: string;
}
