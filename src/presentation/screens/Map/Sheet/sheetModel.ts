/**
 * @file 地図下シートの表示用の純粋関数（presentation/screens/Map/Sheet 層）
 * 再訪理由の並べ替え・タップ先の決定・スポットカードの補足文・地区カードの文言を DOM から切り離し、単体テストできるようにする。
 * 達成率（％・全n件中m件）は作らない（CLAUDE.md 6.5）。未発見スポットの名前は出さない（B）。
 */
import type { DistrictCardDto, NearbySpotDto, RevisitReasonDto, RevisitReasonKindDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { REVISIT_REASON_ORDER } from '@/Common/ui/cards/RevisitReasonCard';
import { UNKNOWN_SPOT_NAME } from '@/Common/ui/cards/SpotCard';
import { formatDistance } from '@/Common/ui/format';
import { DISCOVERY_RADIUS_M } from '@/domain/exploration/constants';
import { lastVisitLabel, STATUS_LABELS } from '@/presentation/shared/labels';

const logger = createLogger('presentation/screens/Map/Sheet/sheetModel');

/** シートの項目をタップしたときの行き先 */
export type SheetTarget = { readonly kind: 'spot'; readonly id: string } | { readonly kind: 'district'; readonly id: string };

/** 近隣スポットとして取得する件数（docs/08 §6） */
export const NEARBY_LIMIT = 8;

/** 訪問できるスポットに付けるバッジ */
export const CAN_VISIT_BADGE = '訪問できます';

/** 未発見スポットをタップしたときの案内 */
export const UNKNOWN_SPOT_MESSAGE = 'まだ見つけていないスポットです。近づくと発見できます';

/** 全画面の注記（色あせは見た目だけ＝CLAUDE.md 4.3） */
export const LEVEL_NEVER_DROPS_NOTE = '色あせても、Lv・育てた街・カードは減りません';

/**
 * 再訪理由の表示優先順位（小さいほど先）を返す。未知の種別は最後。
 * @param kind 再訪理由の種別
 * @returns 0 以上の順位
 */
function reasonRank(kind: RevisitReasonKindDto): number { // audit-ignore: fnlog-missing sort の比較関数から要素数ぶん呼ぶ純粋な順位ヘルパー（呼び出し側 sortReasons でまとめてログ）
  const index = REVISIT_REASON_ORDER.indexOf(kind);
  return index < 0 ? REVISIT_REASON_ORDER.length : index;
}

/**
 * 再訪理由を優先順（期限＞取り返し＞色あせ＞未訪問＞新着）に並べる。同じ種別の中では元の順を保つ。
 * @param reasons application から届いた再訪理由
 * @returns 並べ替えた新しい配列（元の配列は変えない）
 */
export function sortReasons(reasons: readonly RevisitReasonDto[]): RevisitReasonDto[] {
  const log = logger.fn('sortReasons', { count: reasons.length });
  const sorted = [...reasons].sort((a, b) => reasonRank(a.kind) - reasonRank(b.kind));
  return log.exit(sorted);
}

/**
 * いちばん強い再訪理由（優先順の先頭）を返す。
 * @param reasons 再訪理由
 * @returns 先頭の理由。無ければ undefined
 */
export function strongestReason(reasons: readonly RevisitReasonDto[]): RevisitReasonDto | undefined {
  const log = logger.fn('strongestReason', { count: reasons.length });
  return log.exit(sortReasons(reasons)[0]);
}

/**
 * 再訪理由カードのタップ先を決める。期限・未訪問でスポットが分かればスポット詳細、それ以外は地区。
 * @param reason 再訪理由
 * @returns 行き先
 */
export function reasonTarget(reason: RevisitReasonDto): SheetTarget {
  const log = logger.fn('reasonTarget', { kind: reason.kind, districtId: reason.districtId, hasSpot: reason.spotId !== undefined });
  const spotFirst = reason.kind === 'deadline' || reason.kind === 'unvisited';
  if (spotFirst && reason.spotId !== undefined) return log.exit({ kind: 'spot', id: reason.spotId });
  return log.exit({ kind: 'district', id: reason.districtId });
}

/**
 * いちばん近いスポットを返す（距離が同じなら先に来たもの）。
 * @param spots 近隣スポット
 * @returns いちばん近いスポット。無ければ undefined
 */
export function nearestSpot(spots: readonly NearbySpotDto[]): NearbySpotDto | undefined {
  const log = logger.fn('nearestSpot', { count: spots.length });
  let best: NearbySpotDto | undefined;
  for (const spot of spots) {
    if (best === undefined || spot.meters < best.meters) best = spot;
  }
  return log.exit(best);
}

/**
 * スポットの表示名を返す（未発見は名前を出さない）。
 * @param spot 近隣スポット
 * @returns 名前または '？？？'
 */
export function spotDisplayName(spot: Pick<NearbySpotDto, 'status' | 'name'>): string {
  return spot.status === 'unknown' || spot.name === undefined ? UNKNOWN_SPOT_NAME : spot.name;
}

/**
 * スポットカードの補足文（状態・通った回数・クーポン）を作る。距離は SpotCard が先頭に付ける。
 * @param spot 近隣スポット
 * @returns 例 '訪問2回 ・ クーポン・イベントあり'／'発見済み・未訪問'
 */
export function nearbySubtitle(spot: NearbySpotDto): string {
  const log = logger.fn('nearbySubtitle', { spotId: spot.id, status: spot.status });
  const parts = [spot.status === 'visited' ? `訪問${spot.visitCount}回` : STATUS_LABELS[spot.status]];
  if (spot.status !== 'unknown' && spot.hasActiveShopEvent) parts.push('クーポン・イベントあり');
  return log.exit(parts.join(' ・ '));
}

/**
 * つまみに出す「いちばん近いスポット」の2行の文言を作る。
 * 未発見なら名前を伏せたまま「近くに未発見のスポット」「あと n m で発見」と期待を持たせる（発見は DISCOVERY_RADIUS_M 以内。B）。
 * @param spot いちばん近いスポット
 * @returns 1行目（名前）と2行目（距離・状態）
 */
export function nearestSpotLines(spot: NearbySpotDto): { readonly title: string; readonly sub: string } {
  const log = logger.fn('nearestSpotLines', { spotId: spot.id, meters: spot.meters });
  if (spot.status === 'unknown') {
    const toFind = Math.max(0, Math.ceil(spot.meters - DISCOVERY_RADIUS_M));
    const hint = toFind > 0 ? `あと${formatDistance(toFind)}で発見` : 'もうすぐ発見';
    return log.exit({ title: '近くに未発見のスポット', sub: [hint, spot.districtName].join(' ・ ') });
  }
  const sub = [formatDistance(spot.meters), STATUS_LABELS[spot.status], spot.districtName].join(' ・ ');
  return log.exit({ title: `いちばん近い：${spotDisplayName(spot)}`, sub });
}

/**
 * 地区カードの「主」の文言を作る。
 * @param district 地区カード
 * @returns '主：あなた'／'主：おまいり番長'。主がいなければ undefined
 */
export function lordLabelOf(district: Pick<DistrictCardDto, 'lordName' | 'isLordMe'>): string | undefined {
  const log = logger.fn('lordLabelOf', { isLordMe: district.isLordMe, hasLord: district.lordName !== undefined });
  if (district.isLordMe) return log.exit('領主：あなた');
  return log.exit(district.lordName === undefined || district.lordName.length === 0 ? undefined : `領主：${district.lordName}`);
}

/**
 * 地区カードの2行目（最終訪問・次の目標）を作る。
 * @param district 地区カード
 * @returns 例 '最終訪問 23日前 ・ 次の目標：あと1回で銀カード'
 */
export function districtSubText(district: Pick<DistrictCardDto, 'fade' | 'nextGoalText'>): string {
  const log = logger.fn('districtSubText', { fade: district.fade.kind });
  const parts = [lastVisitLabel(district.fade), district.nextGoalText].filter((text) => text.length > 0);
  return log.exit(parts.join(' ・ '));
}
