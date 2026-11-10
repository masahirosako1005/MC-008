/**
 * @file ランク画面の表示用モデル（presentation/screens/Rank 層の純粋関数）
 * RankStatusDto・RankingDto から、絵で見せるための数値と短いラベルを作る。DOM は触らない。
 * ランクは累計ポイントで決まり下がらない（CLAUDE.md 5）ので、「あと何ptで次の段」だけを前向きに見せる。網羅率は出さない。
 */
import type { LeagueIdDto, RankPerkDto, RankPointHistoryDto, RankStatusDto, RankingDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import type { IconName } from '@/Common/ui/icons';

const logger = createLogger('presentation/screens/Rank/rankModel');

/** 次の段までの進み具合 */
export interface RankProgress {
  /** 今の段の中での進み具合 0..100（最上段は 100） */
  readonly percent: number;
  /** ランクロード全体の中でのアバターの位置 0..100（左端が最初の段、右端が最上段） */
  readonly roadPercent: number;
  readonly isTop: boolean;
}

/**
 * 今の段の中での進み具合と、ランクロード上のアバターの位置を返す。
 * @param dto ランク
 * @returns 進み具合
 */
export function rankProgressOf(dto: RankStatusDto): RankProgress {
  const log = logger.fn('rankProgressOf', { points: dto.points, index: dto.rank.index });
  const lastIndex = Math.max(1, dto.steps.length - 1);
  const { nextAt } = dto.rank;
  if (nextAt === undefined) return log.exit({ percent: 100, roadPercent: 100, isTop: true });
  const currentMin = dto.steps[dto.rank.index]?.min ?? 0;
  const span = nextAt - currentMin;
  const percent = span <= 0 ? 0 : Math.min(100, Math.max(0, Math.floor(((dto.points - currentMin) / span) * 100)));
  const roadPercent = Math.min(100, ((dto.rank.index + percent / 100) / lastIndex) * 100);
  return log.exit({ percent, roadPercent, isTop: false });
}

/** 「ランクアップ目前」を出す、今の段の中での進み具合（%）（表示の演出。ゲームの数値ルールではない） */
export const NEAR_RANKUP_PERCENT = 80;

/**
 * 次の段が目前か（今の段の 80% 以上まで来ている。最上段では出さない）。
 * @param progress 進み具合
 * @returns 目前なら true
 */
export function isNearRankUp(progress: RankProgress): boolean {
  const log = logger.fn('isNearRankUp', { percent: progress.percent, isTop: progress.isTop });
  return log.exit(!progress.isTop && progress.percent >= NEAR_RANKUP_PERCENT);
}

/** リーグのメダルの色（3位以内は金・銀・銅、それより下は無地、不参加は見学） */
export type MedalKind = 'gold' | 'silver' | 'bronze' | 'plain' | 'guest';

/** リーグ1つ分のメダル（ランク画面の「今月のリーグ」） */
export interface LeagueMedal {
  readonly id: LeagueIdDto;
  /** 'かよい' */
  readonly shortName: string;
  /** あなたの順位（不参加なら undefined） */
  readonly rank?: number;
  readonly medal: MedalKind;
  /** '5回' / '1か所' */
  readonly countText: string;
}

/** 順位ごとのメダル */
const MEDAL_BY_RANK: Readonly<Record<number, MedalKind>> = { 1: 'gold', 2: 'silver', 3: 'bronze' };

/**
 * ランキングから、リーグごとのあなたのメダルを作る（表示順のまま）。
 * @param ranking ランキング
 * @returns メダル
 */
export function leagueMedalsOf(ranking: RankingDto): LeagueMedal[] {
  const log = logger.fn('leagueMedalsOf', { leagues: ranking.leagues.length });
  const medals = ranking.leagues.map((league) => {
    const rank = league.joined ? league.myRank : undefined;
    const medal: MedalKind = rank === undefined ? 'guest' : (MEDAL_BY_RANK[rank] ?? 'plain');
    return { id: league.id, shortName: league.shortName, rank, medal, countText: `${league.myCount}${league.unit}` };
  });
  return log.exit(medals);
}

/**
 * 'YYYY-MM-DD' を '11/7' の形にする（読めなければそのまま）。
 * @param date 暦日
 * @returns 短い日付
 */
export function shortDateOf(date: string): string {
  const log = logger.fn('shortDateOf', { date });
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  if (m === null) return log.exit(date);
  return log.exit(`${Number(m[1])}/${Number(m[2])}`);
}

/**
 * 最近のポイント1行のアイコン（おかえり＝きらめき、お買い物＝コイン、お店＝店、名所＝星）。
 * @param entry 最近のポイント
 * @returns アイコンの名前
 */
export function historyIconOf(entry: RankPointHistoryDto): IconName {
  const log = logger.fn('historyIconOf', { kind: entry.kind, spotKind: entry.spotKind });
  if (entry.kind === 'welcomeBack') return log.exit('sparkle');
  if (entry.kind === 'purchase') return log.exit('coin');
  return log.exit(entry.spotKind === 'shop' ? 'shop' : 'star');
}

/**
 * 最近のポイント1行の名前（お買い物は「{お店}でお買い物」、それ以外はスポット名）。
 * @param entry 最近のポイント
 * @returns 行に出す名前
 */
export function historyTextOf(entry: RankPointHistoryDto): string {
  const log = logger.fn('historyTextOf', { kind: entry.kind });
  return log.exit(entry.kind === 'purchase' ? `${entry.spotName}でお買い物` : entry.spotName);
}

/** 「つぎの目標」のゲージ1本（ランクアップ・特典） */
export interface GoalGauge {
  /** ゲージの左端の累計 EXP（いまの段の下限、または直前の特典） */
  readonly from: number;
  /** ゲージの右端の累計 EXP（次の段、または次の特典） */
  readonly to: number;
  /** あと何 EXP（1 以上。最上段・全部獲得なら 0） */
  readonly remaining: number;
  /** ゲージの進み具合 0..100 */
  readonly percent: number;
}

/** ランクアップのゲージ */
export interface RankGoal extends GoalGauge {
  /** 次の段の添字（最上段ならいまの段） */
  readonly index: number;
  /** 次の段の名前（最上段ならいまの段の名前） */
  readonly name: string;
  readonly isTop: boolean;
}

/** 特典のゲージ */
export interface PerkGoal extends GoalGauge {
  readonly perk: RankPerkDto;
}

/** つぎの目標（ランクアップと次の特典） */
export interface NextGoals {
  readonly rank: RankGoal;
  /** 次の特典（特典が無い・全部獲得なら undefined） */
  readonly perk?: PerkGoal;
}

/**
 * from→to の間で、いまの EXP がどこまで来たか（0..100 の整数。切り捨て）。
 * @param points いまの累計 EXP
 * @param from 左端
 * @param to 右端
 * @returns 0..100
 */
function percentBetween(points: number, from: number, to: number): number { // audit-ignore: fnlog-missing ゲージごとに呼ぶ純粋な算術（呼び出し側 nextGoalsOf でログ）
  if (to <= from) return points >= to ? 100 : 0;
  return Math.min(100, Math.max(0, Math.floor(((points - from) / (to - from)) * 100)));
}

/**
 * ランクアップと次の特典まで「あと何 EXP」と、ゲージの進み具合を返す。
 * 特典のゲージは直前に手に入れた特典（無ければ 0）から次の特典まで。
 * @param dto ランク
 * @returns つぎの目標
 */
export function nextGoalsOf(dto: RankStatusDto): NextGoals {
  const log = logger.fn('nextGoalsOf', { points: dto.points, index: dto.rank.index, perks: dto.perks?.length });
  const from = dto.steps[dto.rank.index]?.min ?? 0;
  const { nextAt, remaining, nextName } = dto.rank;
  const rank: RankGoal =
    nextAt === undefined
      ? { from, to: from, remaining: 0, percent: 100, index: dto.rank.index, name: dto.rank.name, isTop: true }
      : { from, to: nextAt, remaining: remaining ?? Math.max(0, nextAt - dto.points), percent: percentBetween(dto.points, from, nextAt), index: dto.rank.index + 1, name: nextName ?? '', isTop: false };
  const perks = dto.perks ?? [];
  const next = perks.find((p) => p.state === 'next');
  if (next === undefined) return log.exit({ rank });
  const before = perks.filter((p) => p.state === 'earned').reduce((max, p) => Math.max(max, p.at), 0);
  const perk: PerkGoal = { from: before, to: next.at, remaining: Math.max(1, next.at - dto.points), percent: percentBetween(dto.points, before, next.at), perk: next };
  return log.exit({ rank, perk });
}

/**
 * 特典の並び（左から EXP の小さい順）で、各特典から次の特典までの線をどこまで塗るか（0..100）。
 * @param perks 特典（EXP の小さい順）
 * @param points いまの累計 EXP
 * @returns 各特典の右へ伸びる線の塗り（最後の特典は 0）
 */
export function perkLinkFillsOf(perks: readonly RankPerkDto[], points: number): number[] {
  const log = logger.fn('perkLinkFillsOf', { perks: perks.length, points });
  const fills = perks.map((perk, i) => {
    const next = perks[i + 1];
    return next === undefined ? 0 : percentBetween(points, perk.at, next.at);
  });
  return log.exit(fills);
}
