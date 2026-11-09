/**
 * @file ランキング画面の表示用の純粋関数（presentation/screens/Ranking 層）
 * 表彰台の並び（2位・1位・3位）、リスト部分、あなたの行の取り出し、地区の主カードの文言を作る。DOM に触れない（テスト対象）。
 */
import type { LeagueDto, RankingEntryDto, RankingLordDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/screens/Ranking/rankingModel');

/** 表彰台に乗せる人数 */
export const PODIUM_SIZE = 3;

/** 表彰台の1枠 */
export interface PodiumSlot {
  readonly entry: RankingEntryDto;
  /** 'first' | 'second' | 'third'（台の高さに使う） */
  readonly place: 'first' | 'second' | 'third';
}

/** 表彰台の場所（順位から） */
const PLACE_BY_RANK: Readonly<Record<number, PodiumSlot['place']>> = { 1: 'first', 2: 'second', 3: 'third' };

/**
 * 表彰台の枠を左から並べる（2位・1位・3位）。同順位が多いときも上位3人までを使う。
 * @param entries 順位の昇順の行
 * @returns 左から並べた枠（人数が少なければ短い）
 */
export function podiumSlotsOf(entries: readonly RankingEntryDto[]): PodiumSlot[] {
  const log = logger.fn('podiumSlotsOf', { entries: entries.length });
  const top = entries.slice(0, PODIUM_SIZE).map((entry, i): PodiumSlot => ({ entry, place: PLACE_BY_RANK[Math.min(entry.rank, i + 1)] ?? 'third' }));
  const [first, second, third] = top;
  return log.exit([second, first, third].filter((slot): slot is PodiumSlot => slot !== undefined));
}

/**
 * 表彰台より下のリスト部分を返す。
 * @param entries 順位の昇順の行
 * @returns 4人目以降
 */
export function listEntriesOf(entries: readonly RankingEntryDto[]): RankingEntryDto[] {
  const log = logger.fn('listEntriesOf', { entries: entries.length });
  return log.exit(entries.slice(PODIUM_SIZE));
}

/**
 * あなたの行を返す。
 * @param league リーグ
 * @returns あなたの行（不参加なら undefined）
 */
export function myEntryOf(league: LeagueDto): RankingEntryDto | undefined {
  const log = logger.fn('myEntryOf', { leagueId: league.id });
  return log.exit(league.entries.find((e) => e.isMe));
}

/**
 * 数値の表示（'12回' / '3か所'）。
 * @param count 数値
 * @param unit 単位
 * @returns 表示文字列
 */
export function countLabel(count: number, unit: string): string {
  return `${count}${unit}`;
}

/**
 * タブに出すあなたの順位（'4位'。参加していないリーグは '対象外'）。
 * @param league リーグ
 * @returns 表示文字列
 */
export function tabRankLabel(league: LeagueDto): string {
  return league.myRank === undefined ? '対象外' : `${league.myRank}位`;
}

/**
 * 地区の主カードの2行目（自分の回数と次の目標）。
 * @param lord 地区の主の状況
 * @returns 文言
 */
export function lordGoalText(lord: RankingLordDto): string {
  const log = logger.fn('lordGoalText', { districtId: lord.districtId, isMe: lord.isMe, lost: lord.lost });
  if (lord.isMe) return log.exit(`あなたが主です（${lord.myCount}回）`);
  if (lord.lordName === undefined) return log.exit(`まだ主がいません・あと${lord.needed}回で主に`);
  if (lord.lost) return log.exit(`あなた ${lord.myCount}回・取り返しまで あと${lord.needed}回`);
  return log.exit(`あなた ${lord.myCount}回・あと${lord.needed}回で主に`);
}

/** 昨日からの順位の変化 */
export interface RankChange {
  readonly kind: 'up' | 'down' | 'same' | 'none';
  /** 何位動いたか（0以上） */
  readonly diff: number;
}

/**
 * 昨日からの順位の変化を返す。
 * @param league リーグ
 * @returns 変化（昨日の順位が無ければ none）
 */
export function rankChangeOf(league: LeagueDto): RankChange {
  const log = logger.fn('rankChangeOf', { leagueId: league.id, now: league.myRank, before: league.myRankYesterday });
  if (league.myRank === undefined || league.myRankYesterday === undefined) return log.exit({ kind: 'none', diff: 0 });
  const diff = league.myRankYesterday - league.myRank;
  if (diff > 0) return log.exit({ kind: 'up', diff });
  if (diff < 0) return log.exit({ kind: 'down', diff: -diff });
  return log.exit({ kind: 'same', diff: 0 });
}

/**
 * すぐ上のライバルまでのゲージ（0〜100）。1位なら 100。
 * @param league リーグ
 * @returns 百分率（整数）
 */
export function gaugePercentOf(league: LeagueDto): number {
  const log = logger.fn('gaugePercentOf', { leagueId: league.id });
  const above = league.rivalAbove;
  if (above === undefined || above.count <= 0) return log.exit(100);
  return log.exit(Math.max(4, Math.min(100, Math.round((league.myCount / above.count) * 100))));
}

/** リストの行に付けるライバル札 */
export type RivalMark = 'target' | 'chaser' | undefined;

/**
 * 行がすぐ上（ねらい目）・すぐ下（追ってくる）のライバルかを返す。
 * @param entry 行
 * @param league リーグ
 * @returns 札の種類
 */
export function rivalMarkOf(entry: RankingEntryDto, league: LeagueDto): RivalMark { // audit-ignore: fnlog-missing リストの行ごとに呼ぶ純粋な判定
  if (entry.isMe) return undefined;
  if (league.rivalAbove !== undefined && entry.name === league.rivalAbove.name && entry.rank === league.rivalAbove.rank) return 'target';
  if (league.rivalBelow !== undefined && entry.name === league.rivalBelow.name && entry.rank === league.rivalBelow.rank) return 'chaser';
  return undefined;
}

/**
 * すぐ下のライバルとの関係の文言。
 * @param league リーグ
 * @returns 文言（すぐ下がいなければ undefined）
 */
export function chaserTextOf(league: LeagueDto): string | undefined {
  const log = logger.fn('chaserTextOf', { leagueId: league.id });
  const below = league.rivalBelow;
  if (below === undefined) return log.exit(undefined);
  if (below.gap === 0) return log.exit(`${below.name}と同点！ 1${league.unit}でも多く`);
  if (below.gap === 1) return log.exit(`${below.name}が${below.gap}${league.unit}差まで迫っています`);
  return log.exit(`すぐ後ろの${below.name}とは${below.gap}${league.unit}差`);
}
