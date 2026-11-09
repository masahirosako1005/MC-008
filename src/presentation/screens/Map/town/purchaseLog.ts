/**
 * @file お買い物スタンプの記録（presentation/screens/Map/town 層。デモ）
 * 2026-11-09 ユーザー指示「購入も別の QR など」。レジの QR を読み取ると、そのお店の「お買い物スタンプ」が1つ増える。
 * いまのアプリには購入の記録・ポイントの仕組みが無いため、端末内（`${STORAGE_PREFIX}map.purchases`）だけに回数を残す。
 * EXP・ポイントは増やさない（通いの記録とは別。本番の購入ポイントは店頭 QR の発行方法（docs/09 の Q10）が決まってから）。
 * 読み込み時に形を検証し、壊れていれば空として扱う。
 */
import { createLogger } from '@/Common/logging/logger';
import { STORAGE_PREFIX } from '@/Common/constants/env';

const logger = createLogger('presentation/screens/Map/town/purchaseLog');

/** 1軒で記録する回数の上限 */
const MAX_COUNT = 999;
/** スポットID の形 */
const SPOT_ID = /^[a-z]_[a-z0-9_]+$/;

/**
 * 保存先のキー。
 * @returns キー
 */
export function purchaseLogKey(): string {
  const log = logger.fn('purchaseLogKey');
  return log.exit(`${STORAGE_PREFIX}map.purchases`);
}

/**
 * 記録を読む（壊れた値・例外は空）。
 * @returns スポットID → 回数
 */
export function loadPurchases(): Record<string, number> {
  const log = logger.fn('loadPurchases');
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(purchaseLogKey());
    if (raw === null) return log.exit({});
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return log.exit({}, '形が違う');
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(parsed as Record<string, unknown>)) {
      if (SPOT_ID.test(id) && typeof n === 'number' && Number.isInteger(n) && n > 0) out[id] = Math.min(MAX_COUNT, n);
    }
    return log.exit(out);
  } catch (error) {
    log.warn('お買い物の記録を読めませんでした', { error });
    return log.exit({});
  }
}

/**
 * お店のお買い物スタンプを1つ増やして保存する。
 * @param spotId スポットID
 * @returns 増やした後の回数
 * @sideEffect localStorage に書く
 */
export function addPurchase(spotId: string): number {
  const log = logger.fn('addPurchase', { spotId });
  if (!SPOT_ID.test(spotId)) return log.exit(0, 'ID が不正');
  const all = loadPurchases();
  const next = Math.min(MAX_COUNT, (all[spotId] ?? 0) + 1);
  all[spotId] = next;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(purchaseLogKey(), JSON.stringify(all));
  } catch (error) {
    log.warn('お買い物の記録を保存できませんでした', { error });
  }
  return log.exit(next);
}
