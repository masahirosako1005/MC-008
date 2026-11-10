/**
 * @file お店での購入の加点（domain/reward 層の純粋関数）
 * 2026-11-10 ユーザー指示「ポイントは、各ロケでチェックインや購入でしたもので獲得できるようにしたい」。
 * - 購入でポイントが付くのはお店（shop）だけ。訪問と同じく、現在地の精度が MAX_ACCURACY_M 以下で VISIT_RADIUS_M 以内であること（レジの QR はお店の中にある＝歩かずに稼げない）
 * - 1回 PURCHASE_POINTS。同じお店・同じ日は PURCHASE_LIMIT_PER_SPOT_PER_DAY 回まで。超えた購入は 0 点で、台帳に行を載せない
 * 台帳は追記専用なので、購入で残高が減ることはない（DI-06、CLAUDE.md 5章）。時刻・乱数は使わず、引数の台帳の行と暦日だけで決まる（DI-05）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError } from '@/Common/result/Result';
import type { SpotId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import { roundToInt } from '@/Common/utils/number';
import { isWithinVisitRadius } from '@/domain/exploration/DiscoveryRule';
import { MAX_ACCURACY_M, VISIT_RADIUS_M } from '@/domain/exploration/constants';
import { PURCHASE_LIMIT_PER_SPOT_PER_DAY, PURCHASE_POINTS } from '@/domain/reward/constants';
import type { LedgerEntry } from '@/domain/reward/LedgerEntry';
import type { Spot } from '@/domain/spot/Spot';

const logger = createLogger('domain/reward/PurchaseRewardPolicy');

/** 購入を受け付けない理由（お店ではない／精度が低い／お店から遠い） */
export type PurchaseErrorCode = 'NOT_SHOP' | 'LOW_ACCURACY' | 'OUT_OF_RANGE';

/** purchaseRejection の入力 */
export interface PurchaseCheckInput {
  /** 購入したスポット（種別だけを使う） */
  readonly spot: Pick<Spot, 'kind'>;
  /** 現在地からスポットまでの距離（メートル） */
  readonly meters: number;
  /** 現在地の精度（メートル） */
  readonly accuracyM: number;
}

/** purchaseRewardFor の結果 */
export interface PurchaseReward {
  /** 付くポイント（上限に達していれば 0） */
  readonly points: number;
  /** その日・そのお店の上限に達していて、ポイントが付かない */
  readonly limited: boolean;
}

/**
 * 購入を受け付けない理由を返す（お店か → 精度 → 距離の順。訪問と同じ半径・精度）。
 * @param input スポット・距離・精度
 * @returns 拒否理由。受け付けるなら undefined
 */
export function purchaseRejection(input: PurchaseCheckInput): AppError<PurchaseErrorCode> | undefined {
  const log = logger.fn('purchaseRejection', { kind: input.spot.kind, meters: input.meters, accuracyM: input.accuracyM });
  if (input.spot.kind !== 'shop') return log.exit(AppError.of('NOT_SHOP', 'お買い物のEXPはお店でだけもらえます'));
  if (!(Number.isFinite(input.accuracyM) && input.accuracyM >= 0 && input.accuracyM <= MAX_ACCURACY_M)) {
    return log.exit(AppError.of('LOW_ACCURACY', '現在地の精度が低いため記録できません。少し待ってからもう一度お試しください', { maxAccuracyM: MAX_ACCURACY_M }));
  }
  if (!isWithinVisitRadius(input.meters)) {
    const meters = Number.isFinite(input.meters) ? roundToInt(input.meters) : undefined;
    return log.exit(AppError.of('OUT_OF_RANGE', `お店から${VISIT_RADIUS_M}m以内で記録できます`, { meters, radiusM: VISIT_RADIUS_M }));
  }
  return log.exit(undefined);
}

/**
 * 台帳のうち、そのお店の購入の行を返す（暦日を渡せばその日だけ）。
 * @param entries 台帳の行
 * @param spotId お店
 * @param localDate 暦日（省略で全期間）
 * @returns 購入の行（古い順）
 */
export function purchaseEntriesAt(entries: readonly LedgerEntry[], spotId: SpotId, localDate?: LocalDate): LedgerEntry[] {
  const log = logger.fn('purchaseEntriesAt', { spotId, localDate });
  const rows = entries.filter((e) => e.kind === 'purchase' && e.spotId === spotId && (localDate === undefined || e.localDate === localDate));
  return log.exit(rows, `${rows.length} 件`);
}

/**
 * 今回の購入に付くポイントを決める（同じお店・同じ日の購入の行が上限に達していれば 0）。
 * @param entries これまでの台帳の行
 * @param spotId お店
 * @param localDate 今回の購入の JST 暦日
 * @returns ポイントと上限に達したか
 */
export function purchaseRewardFor(entries: readonly LedgerEntry[], spotId: SpotId, localDate: LocalDate): PurchaseReward {
  const log = logger.fn('purchaseRewardFor', { spotId, localDate });
  const today = purchaseEntriesAt(entries, spotId, localDate).length;
  if (today >= PURCHASE_LIMIT_PER_SPOT_PER_DAY) return log.exit({ points: 0, limited: true }, '今日の上限');
  return log.exit({ points: PURCHASE_POINTS, limited: false });
}
