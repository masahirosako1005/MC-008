/**
 * @file ランク画面の表示用モデル（presentation/screens/Rank 層の純粋関数）
 * RankStatusDto・RankingDto・AppStatusDto と、いま適用中の文字の大きさから、絵で見せるための数値と短いラベルを作る。DOM は触らない。
 * ランクは累計ポイントで決まり下がらない（CLAUDE.md 5）ので、「あと何ptで次の段」だけを前向きに見せる。網羅率は出さない。
 */
import type { AppStatusDto, LeagueIdDto, RankPointHistoryDto, RankStatusDto, RankingDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { TEXT_SCALE_LABELS } from '@/Common/ui/a11y/textScale';
import type { TextScale } from '@/Common/ui/a11y/textScale';
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
 * 最近のポイント1行のアイコン（おかえり＝きらめき、お店＝店、名所＝星）。
 * @param entry 最近のポイント
 * @returns アイコンの名前
 */
export function historyIconOf(entry: RankPointHistoryDto): IconName {
  const log = logger.fn('historyIconOf', { kind: entry.kind, spotKind: entry.spotKind });
  if (entry.kind === 'welcomeBack') return log.exit('sparkle');
  return log.exit(entry.spotKind === 'shop' ? 'shop' : 'star');
}

/** 設定状況の1マス */
export interface SettingTile {
  readonly key: 'textScale' | 'traveler' | 'location' | 'date' | 'storage' | 'build';
  /** 線のアイコン（glyph があればそちらを出す） */
  readonly icon?: IconName;
  /** アイコンの代わりの文字（文字の大きさの 'Aa'） */
  readonly glyph?: string;
  /** 読み上げ用の名前 */
  readonly label: string;
  /** 短い値 */
  readonly value: string;
  /** 値に添える小さな札（'+30日'・'デモ'） */
  readonly badge?: string;
}

/** settingTilesOf の入力 */
export interface SettingTilesInput {
  /** アプリ状態（読めなかったら undefined） */
  readonly status: AppStatusDto | undefined;
  /** いま適用中の文字の大きさ */
  readonly textScale: TextScale;
  /** デモビルドか */
  readonly isDemo: boolean;
  readonly nickname: string;
}

/**
 * 設定状況のマスを作る（文字の大きさ・旅人・位置情報・日付・記録の保存先・版）。言葉は短く、アイコンで伝える。
 * 位置座標そのものは出さない（地区単位・端末内が原則＝CLAUDE.md 10）。
 * @param input アプリ状態・文字の大きさ・デモか・表示名
 * @returns マス（表示順）
 */
export function settingTilesOf(input: SettingTilesInput): SettingTile[] {
  const log = logger.fn('settingTilesOf', { textScale: input.textScale, isDemo: input.isDemo, hasStatus: input.status !== undefined });
  const status = input.status;
  const offset = status?.dayOffset ?? 0;
  const tiles: SettingTile[] = [
    { key: 'textScale', glyph: 'Aa', label: '文字の大きさ', value: TEXT_SCALE_LABELS[input.textScale] },
    { key: 'traveler', icon: 'person', label: '冒険者', value: input.nickname, badge: status !== undefined && status.travelerProfile !== 'user' ? 'デモ' : undefined },
    { key: 'location', icon: 'pin', label: '位置情報', value: input.isDemo ? 'タップ歩行' : 'GPS' },
    { key: 'date', icon: 'calendar', label: '日付', value: status === undefined ? '—' : shortDateOf(status.today), badge: offset > 0 ? `+${offset}日` : undefined },
    { key: 'storage', icon: 'phone', label: '記録の保存先', value: '端末内' },
    { key: 'build', icon: 'info', label: '版', value: input.isDemo ? 'デモ版' : '本番' },
  ];
  return log.exit(tiles);
}
