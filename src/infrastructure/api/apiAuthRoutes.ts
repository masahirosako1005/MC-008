/**
 * @file ログイン・アカウントの API の道筋（infrastructure/api 層。サーバーとブラウザで共有する契約。docs/09 CMS-A04〜A07）
 * apiRoutes.ts（公開・店舗CMS の道筋）と同じ考え方で、ここ1か所で決める。
 *
 * | 道筋 | 用途 | 必要なもの | 使える版 |
 * |---|---|---|---|
 * | POST /api/auth/login | ログイン（Cookie を発行） | — | 両方 |
 * | POST /api/auth/logout | ログアウト（Cookie を消す） | セッション | 両方 |
 * | GET  /api/auth/me | ログイン中の人 | セッション | 両方 |
 * | POST /api/auth/password | 自分のパスワードを変える | セッション | 両方 |
 * | POST /api/auth/demo-login | 運営者か店舗の担当者として入る | — | デモだけ |
 * | GET  /api/cms/accounts | アカウントの一覧 | 運営者 | 両方 |
 * | POST /api/cms/accounts | アカウントを作る | 運営者 | 両方 |
 * | PUT  /api/cms/accounts/:id/shops | 担当店舗を変える | 運営者 | 両方 |
 * | PUT  /api/cms/accounts/:id/status | 停止・再開 | 運営者 | 両方 |
 * | POST /api/cms/accounts/:id/password | パスワードを設定し直す | 運営者 | 両方 |
 */

/** 固定の道筋 */
export const AUTH_PATHS = Object.freeze({
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  me: '/api/auth/me',
  passwordChange: '/api/auth/password',
  demoLogin: '/api/auth/demo-login',
  accounts: '/api/cms/accounts',
});

/** アカウントの下の道筋 */
export type CmsAccountSubPath = 'shops' | 'status' | 'password';

/**
 * アカウントの道筋を作る（ID は URL 用に符号化する。中身の検証はサーバーが行う）。
 * @param accountId アカウントID
 * @param sub 下の道筋
 * @returns 例: '/api/cms/accounts/u_xxxx/shops'
 */
export function cmsAccountPath(accountId: string, sub: CmsAccountSubPath): string {
  return `${AUTH_PATHS.accounts}/${encodeURIComponent(accountId)}/${sub}`;
}
