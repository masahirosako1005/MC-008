/**
 * @file ログイン中の人（infrastructure/server/auth 層。docs/09 §1.2）
 * セッションから決まる「誰が・どのロールで・どの店舗を担当しているか」。API はこれで権限を確かめる（SEC-01、SEC-03）。
 * 道筋や本文に入っている店舗ID は信用せず、必ずここの担当店舗と照らし合わせる。
 */
import type { CmsPrincipalDto, CmsRole } from '@/application/dto/CmsAuthDto';

/** アカウントID の書式（'u_' + 英数字） */
export const ACCOUNT_ID_PATTERN = /^u_[0-9a-z]{4,64}$/;

/** ログイン中の人 */
export interface Principal {
  readonly accountId: string;
  readonly loginId: string;
  readonly displayName: string;
  readonly role: CmsRole;
  /** 担当する店舗（運営者は空＝すべて） */
  readonly shopIds: ReadonlySet<string>;
  /** デモ用のアカウントか */
  readonly demo: boolean;
  /** このログインのセッション ID（DB の値。ログアウト・パスワード変更で使う） */
  readonly sessionId: string;
}

/**
 * その店舗を扱えるか（運営者はすべて、店舗は担当する店舗だけ＝SEC-01）。
 * @param principal ログイン中の人
 * @param spotId 店舗のスポットID
 * @returns 扱えるなら true
 */
export function canAccessShop(principal: Principal, spotId: string): boolean {
  return principal.role === 'operator' || principal.shopIds.has(spotId);
}

/**
 * 画面へ返す形にする（セッション ID は入れない）。
 * @param principal ログイン中の人
 * @returns DTO
 */
export function principalDtoOf(principal: Principal): CmsPrincipalDto { // audit-ignore: fnlog-missing 形を写すだけの純粋なヘルパー（呼び出し元が記録する）
  return {
    accountId: principal.accountId,
    loginId: principal.loginId,
    displayName: principal.displayName,
    role: principal.role,
    shopIds: [...principal.shopIds],
    demo: principal.demo,
  };
}
