/**
 * @file 「いま訪問できるか」と、できない理由の文言を決める共通部品（application 層）
 * 近隣リストの canVisit とスポット詳細の訪問ボタン（canVisit・visitBlockedReason・metersToVisit）で同じ判定を使う。
 * 判定の中身は domain の Traveler.visit と同じ規則（1日1回＝DI-08、精度 MAX_ACCURACY_M 以下＝DI-14、VISIT_RADIUS_M 以内）。
 * 位置が取れないときは訪問不可にする（デモ位置に切り替えない＝SEC-27）。最終判定は VisitSpotUseCase が改めて行う（表示値を信用しない＝SEC-21）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { SpotId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import { roundToInt } from '@/Common/utils/number';
import { MAX_ACCURACY_M, VISIT_RADIUS_M } from '@/domain/exploration/constants';
import { isWithinVisitRadius } from '@/domain/exploration/DiscoveryRule';
import type { Traveler } from '@/domain/exploration/Traveler';

const logger = createLogger('application/usecases/exploration/VisitAvailability');

/** 訪問できない理由の種類（判定順: 今日訪問済み → 位置なし → 精度不足 → 範囲外） */
export type VisitBlock = 'visitedToday' | 'noPosition' | 'lowAccuracy' | 'outOfRange';

/** visitAvailabilityOf の入力 */
export interface VisitAvailabilityInput {
  readonly traveler: Traveler;
  readonly spotId: SpotId;
  /** 今日（Clock.today()） */
  readonly today: LocalDate;
  /** 現在地からスポットまでの距離（メートル、整数）。位置が取れないときは undefined */
  readonly meters?: number;
  /** 測位精度（メートル）。位置が取れないときは undefined */
  readonly accuracyM?: number;
}

/** 訪問できるかの判定結果 */
export interface VisitAvailability {
  readonly canVisit: boolean;
  /** 訪問できない理由（canVisit=true なら無し） */
  readonly block?: VisitBlock;
  /** 訪問できない理由の文言（canVisit=true なら無し） */
  readonly reason?: string;
  /** 範囲外のとき、あと何 m 近づけば訪問できるか */
  readonly metersToVisit?: number;
}

/** 理由ごとの文言（範囲外は距離を含むので別に組み立てる） */
const BLOCK_MESSAGES: Readonly<Record<Exclude<VisitBlock, 'outOfRange'>, string>> = {
  visitedToday: '今日はもう訪問しました（1日1回）',
  noPosition: '現在地を取得できません',
  lowAccuracy: '現在地の精度が低いため訪問できません',
};

/**
 * 測位精度が訪問の判定に使えるか判定する（Traveler.visit の LOW_ACCURACY と同じ基準）。
 * @param accuracyM 測位精度（メートル）
 * @returns 0 以上 MAX_ACCURACY_M 以下の有限数なら true
 */
export function isAccuracyUsable(accuracyM: number): boolean {
  return Number.isFinite(accuracyM) && accuracyM >= 0 && accuracyM <= MAX_ACCURACY_M;
}

/**
 * 訪問できない理由を判定する（今日訪問済み → 位置なし → 精度不足 → 範囲外の順。今日訪問済みは位置に関係なく確定するので先に見る）。
 * @param input 旅人・スポット・今日・距離・精度
 * @returns 理由。訪問できるなら undefined
 */
function visitBlockOf(input: VisitAvailabilityInput): VisitBlock | undefined {
  const log = logger.fn('visitBlockOf', { spotId: input.spotId, meters: input.meters, accuracyM: input.accuracyM });
  if (input.traveler.hasVisitedOn(input.spotId, input.today)) return log.exit('visitedToday');
  if (input.meters === undefined || input.accuracyM === undefined) return log.exit('noPosition');
  if (!isAccuracyUsable(input.accuracyM)) return log.exit('lowAccuracy');
  if (!isWithinVisitRadius(input.meters)) return log.exit('outOfRange');
  return log.exit(undefined);
}

/**
 * いま訪問できるかと、できない理由の文言・あと何 m かを返す。
 * @param input 旅人・スポット・今日・距離（任意）・精度（任意）
 * @returns 判定結果（凍結済み）
 */
export function visitAvailabilityOf(input: VisitAvailabilityInput): VisitAvailability {
  const log = logger.fn('visitAvailabilityOf', { spotId: input.spotId, today: input.today });
  const block = visitBlockOf(input);
  if (block === undefined) return log.exit(Object.freeze({ canVisit: true }));
  if (block !== 'outOfRange') return log.exit(Object.freeze({ canVisit: false, block, reason: BLOCK_MESSAGES[block] }));
  // 範囲外は meters があるときだけ判定される（visitBlockOf）。半径ちょうど＋1m 未満の丸め差でも「あと1m」以上を示す
  const metersToVisit = Math.max(1, roundToInt(input.meters ?? 0) - VISIT_RADIUS_M);
  return log.exit(Object.freeze({ canVisit: false, block, reason: `あと${metersToVisit}m近づくと達成できます`, metersToVisit }));
}
