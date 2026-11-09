/**
 * @file ランキング画面の表示用の純粋関数（presentation/screens/Ranking 層）
 * 表彰台の並び（2位・1位・3位）、リスト部分、あなたの行の取り出し、地区の主カード・報酬（順位報酬・キープ報酬）の文言を作る。DOM に触れない（テスト対象）。
 */
import type { KeepRewardDto, LeagueDto, RankingEntryDto, RankingLordDto, RewardPrizeDto, RewardTierDto } from '@/application/dto/Dto';
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

/**
 * 競うものの短い言い方（'今月 通った回数（同じ場所も毎回数える）' → '通った回数'）。
 * @param league リーグ
 * @returns 短い言い方（無ければ順位の決め方）
 */
export function metricShortOf(league: LeagueDto): string {
  const log = logger.fn('metricShortOf', { leagueId: league.id });
  if (league.metric === undefined) return log.exit(league.rule);
  return log.exit(league.metric.replace(/^今月\s*/, '').replace(/（.*）$/, ''));
}

/**
 * いまの順位でもらえる順位報酬の段を返す。
 * @param league リーグ
 * @returns 段（もらえる段が無い・不参加なら undefined）
 */
export function myRewardTierOf(league: LeagueDto): RewardTierDto | undefined {
  const log = logger.fn('myRewardTierOf', { leagueId: league.id });
  return log.exit(league.rewards?.tiers.find((t) => t.isMine));
}

/**
 * 景品の名前を「・」でつなぐ。
 * @param prizes 景品
 * @returns '銅メダル・銅の提灯'
 */
export function prizeNamesOf(prizes: readonly RewardPrizeDto[]): string { // audit-ignore: fnlog-missing 名前をつなぐだけの純粋な小物
  return prizes.map((p) => p.name).join('・');
}

/**
 * キープ報酬の文言。
 * @param keep キープ報酬
 * @returns 'キープ中！あと6時間で「表彰台の旗」' など
 */
export function keepTextOf(keep: KeepRewardDto): string {
  const log = logger.fn('keepTextOf', { id: keep.id, state: keep.state });
  if (keep.state === 'achieved') return log.exit(`${keep.goalLabel}を${keep.hours}時間キープ ─ 「${keep.prize.name}」を獲得しました`);
  if (keep.state === 'keeping') return log.exit(`${keep.goalLabel}をキープ中！ あと${keep.remainingHours}時間で「${keep.prize.name}」`);
  return log.exit(`${keep.goalLabel}を${keep.hours}時間キープすると「${keep.prize.name}」がもらえます`);
}

/**
 * キープの進み具合（0〜100）。
 * @param keep キープ報酬
 * @returns 百分率（整数）
 */
export function keepPercentOf(keep: KeepRewardDto): number {
  const log = logger.fn('keepPercentOf', { id: keep.id, state: keep.state });
  if (keep.state === 'achieved') return log.exit(100);
  if (keep.state === 'not-yet' || keep.hours <= 0) return log.exit(0);
  return log.exit(Math.max(2, Math.min(99, Math.round((keep.heldHours / keep.hours) * 100))));
}

/**
 * バトルカードに出すキープ報酬（キープ中のうち獲得に一番近いもの。キープ中が無ければ次にねらえるもの）。
 * @param league リーグ
 * @returns キープ報酬（すべて獲得済み・不参加・報酬なしなら undefined）
 */
export function focusKeepOf(league: LeagueDto): KeepRewardDto | undefined {
  const log = logger.fn('focusKeepOf', { leagueId: league.id });
  if (league.myRank === undefined || league.rewards === undefined) return log.exit(undefined);
  const keeping = league.rewards.keeps.filter((k) => k.state === 'keeping').sort((a, b) => a.remainingHours - b.remainingHours)[0];
  return log.exit(keeping ?? league.rewards.keeps.find((k) => k.state === 'not-yet'));
}

/** 表彰台・あなたの頭の上に出すエモート（吹き出しの絵） */
export type EmoteKind = 'note' | 'exclaim' | 'fire' | 'sweat' | 'sparkle' | 'heart';

/**
 * あなたのエモート（今日順位が上がった→キラキラ／すぐ後ろが1差以内→汗／1位→♪／それ以外→闘志）。
 * @param league リーグ
 * @returns エモート（不参加は heart）
 */
export function myEmoteOf(league: LeagueDto): EmoteKind {
  const log = logger.fn('myEmoteOf', { leagueId: league.id, myRank: league.myRank });
  if (league.myRank === undefined) return log.exit('heart');
  if (rankChangeOf(league).kind === 'up') return log.exit('sparkle');
  if (league.rivalBelow !== undefined && league.rivalBelow.gap <= 1) return log.exit('sweat');
  if (league.myRank === 1) return log.exit('note');
  return log.exit('fire');
}

/**
 * 表彰台の人のエモート（すぐ上のライバル→「！」気づいた／すぐ後ろ→闘志／1位→♪余裕／ほか→キラキラ）。
 * @param entry 表彰台の人
 * @param league リーグ
 * @returns エモート
 */
export function podiumEmoteOf(entry: RankingEntryDto, league: LeagueDto): EmoteKind {
  const log = logger.fn('podiumEmoteOf', { leagueId: league.id, rank: entry.rank, isMe: entry.isMe });
  if (entry.isMe) return log.exit(myEmoteOf(league));
  const mark = rivalMarkOf(entry, league);
  if (mark === 'target') return log.exit('exclaim');
  if (mark === 'chaser') return log.exit('fire');
  return log.exit(entry.rank === 1 ? 'note' : 'sparkle');
}

/**
 * レースの一言（'あと2回で6位' / '独走中！' / '見学中'）。
 * @param league リーグ
 * @returns 文言
 */
export function raceLabelOf(league: LeagueDto): string {
  const log = logger.fn('raceLabelOf', { leagueId: league.id });
  if (league.myRank === undefined) return log.exit('見学中');
  const above = league.rivalAbove;
  if (above === undefined) return log.exit('独走中！');
  return log.exit(`あと${countLabel(above.gap, league.unit)}で${above.rank}位`);
}

/**
 * すぐ後ろが迫っているときの短い札（'同点！' / '1回差！'）。
 * @param league リーグ
 * @returns 札（迫っていなければ undefined）
 */
export function hotLabelOf(league: LeagueDto): string | undefined {
  const log = logger.fn('hotLabelOf', { leagueId: league.id });
  const below = league.rivalBelow;
  if (below === undefined || below.gap > 1) return log.exit(undefined);
  return log.exit(below.gap === 0 ? '同点！' : `${countLabel(below.gap, league.unit)}差！`);
}

/**
 * キープ中の短い札（'キープ あと6時間'）。
 * @param league リーグ
 * @returns 札（キープ中でなければ undefined）
 */
export function keepChipOf(league: LeagueDto): string | undefined {
  const log = logger.fn('keepChipOf', { leagueId: league.id });
  const keep = focusKeepOf(league);
  if (keep === undefined || keep.state !== 'keeping') return log.exit(undefined);
  return log.exit(`キープ あと${keep.remainingHours}時間`);
}

/**
 * 順位報酬の段の一言（メダルは丸い札で見せるので名前から外す。'称号「11月の常連王」・金の提灯'）。
 * @param tier 段
 * @returns 文言（メダル以外が無ければメダルの名前）
 */
export function tierPrizeTextOf(tier: RewardTierDto): string {
  const log = logger.fn('tierPrizeTextOf', { label: tier.label });
  const others = tier.prizes.filter((p) => p.kind !== 'gold' && p.kind !== 'silver' && p.kind !== 'bronze');
  return log.exit(prizeNamesOf(others.length > 0 ? others : tier.prizes));
}

/**
 * キープ報酬の条件の一言（'表彰台を24時間キープ'）。
 * @param keep キープ報酬
 * @returns 文言
 */
export function keepGoalTextOf(keep: KeepRewardDto): string {
  const log = logger.fn('keepGoalTextOf', { id: keep.id });
  return log.exit(`${keep.goalLabel.replace(/（.*）$/, '')}を${keep.hours}時間キープ`);
}

/** 地区の主タイルの下の札 */
export interface LordStatus {
  /** 'あなた' / 'あと2回' */
  readonly text: string;
  /** me: あなたが主／lost: 取り返し中／open: 主がいない／chase: 主をねらう */
  readonly tone: 'me' | 'lost' | 'open' | 'chase';
}

/**
 * 地区の主タイルの札（あなたが主→「あなた」、それ以外は主になるまでの回数）。
 * @param lord 地区の主の状況
 * @returns 札
 */
export function lordStatusOf(lord: RankingLordDto): LordStatus {
  const log = logger.fn('lordStatusOf', { districtId: lord.districtId, isMe: lord.isMe, lost: lord.lost });
  if (lord.isMe) return log.exit({ text: 'あなた', tone: 'me' });
  const text = `あと${lord.needed}回`;
  if (lord.lordName === undefined) return log.exit({ text, tone: 'open' });
  return log.exit({ text, tone: lord.lost ? 'lost' : 'chase' });
}

/**
 * 地区の短い名前（DTO に無ければ '南森町・天満宮地区' → '南森町'）。
 * @param lord 地区の主の状況
 * @returns 短い名前
 */
export function districtShortOf(lord: RankingLordDto): string {
  const log = logger.fn('districtShortOf', { districtId: lord.districtId });
  if (lord.districtShortName !== undefined && lord.districtShortName !== '') return log.exit(lord.districtShortName);
  return log.exit(lord.districtName.replace(/地区$/, '').split('・')[0] ?? lord.districtName);
}
