/**
 * @file 地区ごとの「地区の主」の状況をまとめる（application 層の共通部品）
 * LordshipBoard（誰が主か・取り返し中か）と直近30日の回数（LordPolicy.collectLordCounts）を合わせ、
 * 地図・地区カード・再訪理由（RevisitReasonPolicy の LordshipSnapshot）で同じ数字を使えるようにする（D2・D7・D8）。
 * 集計期間は LordPolicy.lordWindow（今日を含む LORD_WINDOW_DAYS=30 暦日）。旅人の表示名は「あなた」。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId } from '@/Common/types/Id';
import type { World } from '@/application/usecases/shared/World';
import { holderKey, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';
import type { LordHolder } from '@/domain/competition/LordHolder';
import { collectLordCounts, lordWindow, visitsNeededToReclaim } from '@/domain/competition/LordPolicy';
import type { LordCount } from '@/domain/competition/LordPolicy';
import type { Rival } from '@/domain/competition/Rival';
import type { LordshipSnapshot } from '@/domain/revisit/RevisitReasonPolicy';

const logger = createLogger('application/usecases/shared/LordStandings');

/** 旅人（自分）が主のときの表示名 */
export const TRAVELER_LORD_NAME = 'あなた';

/** 1地区分の「地区の主」の状況 */
export interface LordStanding {
  readonly districtId: DistrictId;
  /** いまの主（盤に記録された主。主なしなら無し） */
  readonly holder?: LordHolder;
  /** 主の表示名（旅人は「あなた」、ライバルはマスタの名前。主なし・不明なライバルなら無し） */
  readonly lordName?: string;
  /** 旅人自身が主か */
  readonly isMe: boolean;
  /** 主の座をライバルに奪われ、まだ取り返していない（盤の lostByTraveler。true なら主はライバル） */
  readonly lostByTraveler: boolean;
  /** 主の直近30日の訪問回数（主なしなら 0） */
  readonly lordCount: number;
  /** 旅人の直近30日の訪問回数 */
  readonly myCount: number;
  /** 主になる（取り返す）のに必要な訪問回数（自分が主なら 0、それ以外は 主の回数 − 自分の回数 + 1、最小1＝D8） */
  readonly needed: number;
}

/**
 * 主の表示名を返す（旅人は「あなた」、ライバルはマスタの名前）。
 * @param holder 主（undefined は主なし）
 * @param rivals すべてのライバル
 * @returns 表示名。主なし・マスタに無いライバルなら undefined
 */
export function lordNameOf(holder: LordHolder | undefined, rivals: readonly Rival[]): string | undefined {
  const log = logger.fn('lordNameOf', { holder: holder === undefined ? undefined : holderKey(holder) });
  if (holder === undefined) return log.exit(undefined);
  if (holder.type === 'traveler') return log.exit(TRAVELER_LORD_NAME);
  const rival = rivals.find((candidate) => candidate.id === holder.rivalId);
  if (rival === undefined) log.warn('マスタに無いライバルが主になっている', { rivalId: holder.rivalId });
  return log.exit(rival?.name);
}

/**
 * 候補ごとの回数から、指定した人の回数を取り出す。
 * @param counts 候補ごとの回数（LordPolicy.collectLordCounts の結果）
 * @param holder 取り出す人（undefined は主なし）
 * @returns 回数（主なし・候補に無ければ 0）
 */
function countOf(counts: readonly LordCount[], holder: LordHolder | undefined): number {
  return holder === undefined ? 0 : (counts.find((entry) => holderKey(entry.holder) === holderKey(holder))?.count ?? 0);
}

/**
 * 1地区分の「地区の主」の状況を作る。
 * @param world 旅人の世界
 * @param districtId 地区ID
 * @returns 状況（凍結済み）
 * @see docs/08 D7, D8
 */
export function standingOf(world: World, districtId: DistrictId): LordStanding {
  const log = logger.fn('standingOf', { districtId, today: world.today });
  const counts = collectLordCounts({ districtId, visits: world.traveler.visits, rivals: world.rivals, actions: world.actions, window: lordWindow(world.today) });
  const holder = world.board.holderOf(districtId);
  const isMe = holder?.type === 'traveler';
  const lordCount = countOf(counts, holder);
  const myCount = countOf(counts, TRAVELER_HOLDER);
  const lordName = lordNameOf(holder, world.rivals);
  const standing: LordStanding = Object.freeze({
    districtId,
    ...(holder === undefined ? {} : { holder }),
    ...(lordName === undefined ? {} : { lordName }),
    isMe,
    lostByTraveler: !isMe && world.board.isLostByTraveler(districtId),
    lordCount,
    myCount,
    needed: isMe ? 0 : visitsNeededToReclaim(lordCount, myCount),
  });
  return log.exit(standing);
}

/**
 * 全地区（SpotRepository.allDistricts の順）の「地区の主」の状況を作る。
 * @param world 旅人の世界
 * @returns 地区ごとの状況（地区の表示順）
 */
export function standingsOf(world: World): LordStanding[] {
  const log = logger.fn('standingsOf', { today: world.today });
  const standings = world.spots.allDistricts().map((district) => standingOf(world, district.id));
  return log.exit(standings);
}

/**
 * 状況の配列を地区ID で引ける Map にする。
 * @param standings 地区ごとの状況
 * @returns 地区ID → 状況
 */
export function standingsByDistrict(standings: readonly LordStanding[]): Map<DistrictId, LordStanding> {
  return new Map(standings.map((standing) => [standing.districtId, standing]));
}

/**
 * 状況を RevisitReasonPolicy に渡す LordshipSnapshot に変換する。
 * @param standing 1地区分の状況
 * @returns LordshipSnapshot（凍結済み）
 */
export function toLordshipSnapshot(standing: LordStanding): LordshipSnapshot {
  const log = logger.fn('toLordshipSnapshot', { districtId: standing.districtId });
  const snapshot: LordshipSnapshot = Object.freeze({
    districtId: standing.districtId,
    ...(standing.lordName === undefined ? {} : { lordName: standing.lordName }),
    isMe: standing.isMe,
    lostByTraveler: standing.lostByTraveler,
    lordCount: standing.lordCount,
    myCount: standing.myCount,
  });
  return log.exit(snapshot);
}

/**
 * 全地区の状況を LordshipSnapshot の配列にする（RevisitReasonPolicy.collect の lordships 用）。
 * @param world 旅人の世界
 * @returns 地区ごとの LordshipSnapshot（地区の表示順）
 */
export function lordshipSnapshotsOf(world: World): LordshipSnapshot[] {
  const log = logger.fn('lordshipSnapshotsOf', { today: world.today });
  return log.exit(standingsOf(world).map(toLordshipSnapshot));
}
