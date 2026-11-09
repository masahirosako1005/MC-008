/**
 * @file ログイン・アカウントの API で受け渡す JSON の形（infrastructure/api/schema 層。サーバーとブラウザで共有する契約）
 * - 応答（サーバー → CMS 画面）：application/dto/CmsAuthDto.ts の DTO と同じ構造。パスワードのハッシュは決して含めない
 * - リクエストの本文（CMS 画面 → サーバー）：サーバー側が形を確かめてから AuthService へ渡す（DI-01、SEC-16）。
 *   パスワードの決まり（長さなど）は AuthService が確かめる
 */
import { shape } from '@/infrastructure/api/schema/shape';
import type { Shape } from '@/infrastructure/api/schema/shape';

const { array, literal, object, optional } = shape;

/** ロール */
const ROLE_SHAPE: Shape = literal('shopOwner', 'operator');

/** CmsPrincipalDto */
export const CMS_PRINCIPAL_SHAPE: Shape = object({
  accountId: 'string',
  loginId: 'string',
  displayName: 'string',
  role: ROLE_SHAPE,
  shopIds: array('string'),
  demo: 'boolean',
});

/** CmsAccountDto */
const CMS_ACCOUNT_SHAPE: Shape = object({
  id: 'string',
  loginId: 'string',
  displayName: 'string',
  role: ROLE_SHAPE,
  status: literal('active', 'suspended'),
  shopIds: array('string'),
  demo: 'boolean',
  locked: 'boolean',
  createdAt: 'string',
  lastLoginAt: optional('string'),
});

/** CmsAccountDto（1件） */
export const CMS_ACCOUNT_RESPONSE_SHAPE: Shape = CMS_ACCOUNT_SHAPE;

/** CmsAccountDto[] */
export const CMS_ACCOUNT_LIST_SHAPE: Shape = array(CMS_ACCOUNT_SHAPE);

/** 本文：ログイン */
export const LOGIN_BODY_SHAPE: Shape = object({ loginId: 'string', password: 'string' });

/** 本文：自分のパスワードを変える */
export const CHANGE_PASSWORD_BODY_SHAPE: Shape = object({ currentPassword: 'string', newPassword: 'string' });

/** 本文：デモのログイン */
export const DEMO_LOGIN_BODY_SHAPE: Shape = object({ role: ROLE_SHAPE, spotId: optional('string') });

/** 本文：アカウントを作る */
export const CREATE_ACCOUNT_BODY_SHAPE: Shape = object({
  loginId: 'string',
  displayName: 'string',
  role: ROLE_SHAPE,
  shopIds: array('string'),
  password: 'string',
});

/** 本文：担当店舗を変える（accountId は道筋から取る） */
export const ACCOUNT_SHOPS_BODY_SHAPE: Shape = object({ shopIds: array('string') });

/** 本文：停止・再開（accountId は道筋から取る） */
export const ACCOUNT_STATUS_BODY_SHAPE: Shape = object({ status: literal('active', 'suspended') });

/** 本文：パスワードを設定し直す（accountId は道筋から取る） */
export const RESET_PASSWORD_BODY_SHAPE: Shape = object({ newPassword: 'string' });
