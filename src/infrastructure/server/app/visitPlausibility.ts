/**
 * @file 申告された位置が、前回の行動（訪問・購入・チケットの利用）からの移動として物理的にありえるかの確認（infrastructure/server/app 層。DI-14、docs/12 §6 段階2）
 * 位置は端末の申告なので、座標を直接送るなりすましを完全には防げない。前回訪問したスポットから今回の位置まで、
 * 経過時間のあいだに移動できる距離（domain の isPlausibleMove。時速 MAX_PLAUSIBLE_SPEED_KMH＝仮）を超えていたら断る。
 * 「離れた地区を数秒おきに次々訪問する」稼ぎ方を割に合わなくするためのもの。前回の位置はスポットの位置で代用する
 * （座標を保存しないため＝PRV-03。訪問できる半径 VISIT_RADIUS_M を誤差として見込む）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { SpotId } from '@/Common/types/Id';
import type { Instant } from '@/Common/utils/date';
import { VISIT_RADIUS_M } from '@/domain/exploration/constants';
import { isPlausibleMove } from '@/domain/exploration/DiscoveryRule';
import type { Traveler } from '@/domain/exploration/Traveler';
import type { LedgerEntry } from '@/domain/reward/LedgerEntry';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import type { ClaimedPosition } from '@/infrastructure/di/appPlay';

const logger = createLogger('infrastructure/server/app/visitPlausibility');

/** 前回、サーバーが受け付けた行動（場所はスポットで代用。座標は持たない＝PRV-03） */
interface LastAction {
  readonly spotId: SpotId;
  readonly at: Instant;
}

/** さかのぼって確かめる時間（ミリ秒）。この間に受け付けた行動のすべてと照らす（直前の1件だけだと、短い移動をつないで遠くまで行ける） */
const RECENT_WINDOW_MS = 60 * 60 * 1000;
/** 今回の位置の誤差として見込む上限（メートル）。端末が申告する精度をそのまま足すと、大きく申告するほど遠くへ動けるため */
const CLAIMED_ACCURACY_CAP_M = 30;

/**
 * 訪問・チケットの利用・購入のうち、照らす相手（直近の時間内のすべてと、いちばん新しい1件）を返す。
 * 訪問だけを見ると、訪問をしない（購入・チケットだけの）利用者には移動の確認が一度も効かないため、3つとも見る。
 * @param traveler 旅人（訪問とチケットの利用を持つ）
 * @param entries EXP の台帳の行（購入はここにだけ残る）
 * @param nowMs 今の時刻（エポックミリ秒）
 * @returns 照らす行動（まだ何も無ければ空）
 */
function recentActionsOf(traveler: Traveler, entries: readonly LedgerEntry[], nowMs: number): readonly LastAction[] { // audit-ignore: fnlog-missing 記録から選ぶだけの純粋なヘルパー（checkPlausibleMove が記録する）
  const all: readonly LastAction[] = [
    ...traveler.visits.map((v) => ({ spotId: v.spotId, at: v.visitedAt })),
    ...traveler.redemptions.map((r) => ({ spotId: r.spotId, at: r.redeemedAt })),
    ...entries.filter((e) => e.kind === 'purchase').map((e) => ({ spotId: e.spotId, at: e.at })),
  ];
  const latest = all.reduce<LastAction | undefined>((best, c) => (best === undefined || Date.parse(c.at) > Date.parse(best.at) ? c : best), undefined);
  const recent = all.filter((a) => nowMs - Date.parse(a.at) <= RECENT_WINDOW_MS);
  return latest === undefined || recent.includes(latest) ? recent : [...recent, latest];
}

/**
 * これまでの行動（訪問・購入・チケットの利用）からの移動としてありえる位置か確かめる。
 * 直近 RECENT_WINDOW_MS の行動のすべてと照らし、1つでも速すぎれば断る。マスタに無いスポットの行動は飛ばす。
 * @param traveler 旅人（訪問・チケットの利用を持つ）
 * @param entries EXP の台帳の行（購入を見る）
 * @param spots スポットのマスタ
 * @param position 今回申告された位置
 * @param now 今の時刻（サーバーの時計）
 * @returns 成功: void（照らす行動がまだ無いときも成功）。失敗: TOO_FAST
 */
export function checkPlausibleMove(traveler: Traveler, entries: readonly LedgerEntry[], spots: SpotRepository, position: ClaimedPosition, now: Instant): Result<void> {
  const log = logger.fn('checkPlausibleMove', { visits: traveler.visits.length }); // 位置はログに出さない（PRV-03）
  const claimed = { point: position.point, accuracyM: Math.min(position.accuracyM, CLAIMED_ACCURACY_CAP_M), at: now };
  const tooFast = recentActionsOf(traveler, entries, Date.parse(now)).some((action) => {
    const spot = spots.findSpot(action.spotId);
    return spot !== undefined && !isPlausibleMove({ point: spot.point, accuracyM: VISIT_RADIUS_M, at: action.at }, claimed);
  });
  if (!tooFast) return log.exit(okVoid());
  log.warn('これまでの行動からの移動が速すぎる申告を断りました（SEC-24、DI-14）', { travelerId: traveler.id });
  return log.fail(fail(AppError.of('TOO_FAST', '移動が速すぎるため受け付けられませんでした。少し待ってからお試しください')));
}
