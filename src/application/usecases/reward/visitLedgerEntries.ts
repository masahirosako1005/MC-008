/**
 * @file 1回の訪問の加点を台帳の行にする共通部品（application 層）
 * 基本点を `${operationId}:visit`、おかえりボーナスの差分（> 0 のとき）を `${operationId}:bonus` の行にする（docs/08 §3.6, D6）。
 * 行ID が操作ID から決まるので、同じ訪問を何度追記しても台帳には1回分しか載らない（DI-06, DI-07）。
 * AwardVisitRewardsUseCase（実際の訪問）と demoSeeds（デモの過去の訪問）で同じ計算を使う。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { createLedgerEntry } from '@/domain/reward/LedgerEntry';
import type { LedgerEntry } from '@/domain/reward/LedgerEntry';
import type { VisitReward } from '@/domain/reward/VisitRewardPolicy';

const logger = createLogger('application/usecases/reward/visitLedgerEntries');

/**
 * 訪問記録と加点（VisitRewardPolicy.rewardFor の結果）から台帳の行を作る。
 * @param record 訪問記録（操作ID・地区・スポット・日時・暦日を使う）
 * @param reward その訪問の加点
 * @returns 成功: 行（訪問行、ボーナスがあればボーナス行の順）。失敗: INVALID_INPUT（ポイントが不正＝計算のバグ）
 * @see docs/06_data_integrity_checklist.md DI-06, DI-07
 */
export function visitLedgerEntriesOf(record: VisitRecord, reward: VisitReward): Result<LedgerEntry[]> {
  const log = logger.fn('visitLedgerEntriesOf', { operationId: record.operationId, basePoints: reward.basePoints, bonusPoints: reward.bonusPoints });
  const common = { operationId: record.operationId, districtId: record.districtId, spotId: record.spotId, at: record.visitedAt, localDate: record.localDate };
  const visit = createLedgerEntry({ ...common, kind: 'visit', points: reward.basePoints });
  if (!visit.ok) return log.fail(visit);
  if (reward.bonusPoints <= 0) return log.exit(ok([visit.value]));
  const bonus = createLedgerEntry({ ...common, kind: 'welcomeBack', points: reward.bonusPoints });
  if (!bonus.ok) return log.fail(bonus);
  return log.exit(ok([visit.value, bonus.value]));
}
