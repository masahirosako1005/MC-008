/**
 * @file localStorage のキー一覧（infrastructure/storage 層）
 * 使うキーをここに集めて一覧化する（SEC-07）。実際のキーは接頭辞 P（STORAGE_PREFIX: デモ 'nnishi.demo.'／本番 'nnishi.'）＋ 下の suffix。
 * 生座標を含むキーは作らない（SEC-13, docs/08 D15）。デモ日付オフセット・debug フラグは接頭辞なしの固定キー（Common/constants/env）。
 */
import type { TravelerId } from '@/Common/types/Id';

/** P+'session'（アクティブな旅人） */
export const SESSION_KEY = 'session';

/** 旅人ごとのキーの区切り（P + 区切り + 旅人ID） */
export const TRAVELER_KEY_SEGMENT = 'traveler.';
/** ポイント台帳 */
export const LEDGER_KEY_SEGMENT = 'ledger.';
/** 地区の主の盤 */
export const LORDSHIP_KEY_SEGMENT = 'lordship.';
/** ライバル行動 */
export const RIVAL_ACTIONS_KEY_SEGMENT = 'rivalActions.';
/** アバターの装い（着せ替え） */
export const AVATAR_KEY_SEGMENT = 'avatar.';
/** P+'settings'（端末の表示設定＝文字の大きさ。旅人ごとではないので旅人を切り替えても残る） */
export const SETTINGS_KEY = 'settings';
/** P+'cms.overlay'（店舗CMS の登録内容。デモ専用＝nnishi.demo.cms.overlay。docs/09 §7.2） */
export const CMS_OVERLAY_KEY = 'cms.overlay';
/** P+'cms.snapshot'（連携サーバーから受け取った公開スナップショットの写し。取れないときに使う＝docs/09 APP-02。お店側のデータ） */
export const CMS_SNAPSHOT_KEY = 'cms.snapshot';

/**
 * アバターの装いのキー（接頭辞を除いた部分）を返す。
 * @param id 旅人ID
 * @returns 'avatar.' + id
 */
export function avatarKeyOf(id: TravelerId): string {
  return `${AVATAR_KEY_SEGMENT}${id}`;
}

/**
 * 旅人のキー（接頭辞を除いた部分）を返す。
 * @param id 旅人ID
 * @returns 'traveler.' + id
 */
export function travelerKeyOf(id: TravelerId): string {
  return `${TRAVELER_KEY_SEGMENT}${id}`;
}

/**
 * ポイント台帳のキー（接頭辞を除いた部分）を返す。
 * @param id 旅人ID
 * @returns 'ledger.' + id
 */
export function ledgerKeyOf(id: TravelerId): string {
  return `${LEDGER_KEY_SEGMENT}${id}`;
}

/**
 * 地区の主の盤のキー（接頭辞を除いた部分）を返す。
 * @param id 旅人ID
 * @returns 'lordship.' + id
 */
export function lordshipKeyOf(id: TravelerId): string {
  return `${LORDSHIP_KEY_SEGMENT}${id}`;
}

/**
 * ライバル行動のキー（接頭辞を除いた部分）を返す。
 * @param id 旅人ID
 * @returns 'rivalActions.' + id
 */
export function rivalActionsKeyOf(id: TravelerId): string {
  return `${RIVAL_ACTIONS_KEY_SEGMENT}${id}`;
}
