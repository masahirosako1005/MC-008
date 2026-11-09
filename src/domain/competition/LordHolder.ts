/**
 * @file 地区の主（その座にいる人）の型（domain/competition 層）
 * 主は「旅人（自分）」か「ライバル」のどちらか。比較・キー化・保存データからの復元をここに集約する。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseRivalId } from '@/Common/types/Id';
import type { RivalId } from '@/Common/types/Id';
import { isRecord } from '@/Common/utils/guards';

const logger = createLogger('domain/competition/LordHolder');

/** 地区の主 */
export type LordHolder = { readonly type: 'traveler' } | { readonly type: 'rival'; readonly rivalId: RivalId };

/** 旅人（自分）が主であることを表す値 */
export const TRAVELER_HOLDER: { readonly type: 'traveler' } = Object.freeze({ type: 'traveler' });

/**
 * ライバルが主であることを表す値を作る。
 * @param rivalId ライバルID
 * @returns 凍結済み LordHolder
 */
export function rivalHolder(rivalId: RivalId): LordHolder {
  return Object.freeze({ type: 'rival', rivalId });
}

/**
 * 2つの主が同じ人か判定する（どちらも undefined＝主なし、も同じとみなす）。
 * @param a 1つ目（undefined は主なし）
 * @param b 2つ目（undefined は主なし）
 * @returns 同じなら true
 */
export function sameHolder(a: LordHolder | undefined, b: LordHolder | undefined): boolean {
  const log = logger.fn('sameHolder', { a, b });
  if (a === undefined || b === undefined) return log.exit(a === b);
  if (a.type === 'traveler' || b.type === 'traveler') return log.exit(a.type === b.type);
  return log.exit(a.rivalId === b.rivalId);
}

/**
 * 主を一意な文字列キーにする（Map のキー・ランキング参加者のキー用）。
 * @param holder 主
 * @returns 旅人は 'traveler'、ライバルは 'rival:<rivalId>'
 */
export function holderKey(holder: LordHolder): string {
  return holder.type === 'traveler' ? 'traveler' : `rival:${holder.rivalId}`;
}

/**
 * 主が旅人（自分）か判定する。
 * @param holder 主（undefined は主なし）
 * @returns 旅人なら true
 */
export function isTravelerHolder(holder: LordHolder | undefined): boolean {
  return holder !== undefined && holder.type === 'traveler';
}

/**
 * 未検証の値（保存データ）から主を復元する（DI-01）。
 * @param raw 未検証の値（{ type: 'traveler' } または { type: 'rival', rivalId }）
 * @returns 成功: LordHolder。失敗: INVALID_INPUT
 */
export function parseLordHolder(raw: unknown): Result<LordHolder> {
  const log = logger.fn('parseLordHolder');
  if (isRecord(raw) && raw['type'] === 'traveler') return log.exit(ok(TRAVELER_HOLDER));
  if (isRecord(raw) && raw['type'] === 'rival') {
    const rivalId = parseRivalId(raw['rivalId']);
    return rivalId.ok ? log.exit(ok(rivalHolder(rivalId.value))) : log.fail(rivalId);
  }
  return log.fail(fail(AppError.of('INVALID_INPUT', '地区の主のデータが正しくありません', { kind: 'LordHolder' })));
}
