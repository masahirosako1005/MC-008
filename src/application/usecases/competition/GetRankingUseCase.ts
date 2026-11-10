/**
 * @file 月間リーグのランキングを返すユースケース（application 層・読取系）
 * 3リーグ（かよい／はじめまして／ルーキー）それぞれにダミー参加者10人と「あなた」を並べ、Ranking.from で順位をつける（D10）。
 * 初めての人でも活躍できるよう、あなたが一番上位のリーグを最初に開くタブとして返し、「あと何回で何位」を添える。基準 C。
 * 下段に地区の主の状況（直近30日・取り返しまでの回数）を返す（CLAUDE.md 6.7、wireframes/07_ranking）。書込みはしない。
 * リーグの違いが分かるよう「競うもの」「参加できる人」を返し、期間と報酬（順位報酬・○時間キープでもらえるキープ報酬）を添える。
 * 報酬はアバターの部品。段ごとの順位の範囲・手に入れたか・次の報酬までの数を返し、画面が順位表の上に「ここまでこの報酬」を出せるようにする。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { addDays, daysBetween, endOfMonth, formatJpDate, monthKeyOf, startOfMonth } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import type { UseCase } from '@/application/AppServices';
import type { LeagueDto, LeagueIdDto, RankingDto, RankingEntryDto, RankingLordDto, RankingRivalDto } from '@/application/dto/Dto';
import { earnedLeagueRewardIdsOf } from '@/application/usecases/competition/leagueAwards';
import { leagueRewardsOf, nextPrizeOf } from '@/application/usecases/competition/leagueRewards';
import { heldSinceOf, ME_KEY, myRankWith, participantsOf } from '@/application/usecases/competition/leagueStanding';
import { standingsOf, TRAVELER_LORD_NAME } from '@/application/usecases/shared/LordStandings';
import type { LordStanding } from '@/application/usecases/shared/LordStandings';
import { loadWorld } from '@/application/usecases/shared/World';
import type { World, WorldDeps } from '@/application/usecases/shared/World';
import { ROOKIE_PERIOD_DAYS } from '@/domain/competition/constants';
import { daysLeftInMonth, isRookie, LEAGUE_IDS, leagueScoreOf, rookieGraduationDateOf } from '@/domain/competition/League';
import type { LeagueId, LeagueRecords } from '@/domain/competition/League';
import { Ranking } from '@/domain/competition/Ranking';

export { heldSinceOf } from '@/application/usecases/competition/leagueStanding';

const logger = createLogger('application/usecases/competition/GetRankingUseCase');

/** 「あと何回で」を探す上限（これ以上離れていたら一般的な励ましにする） */
const NEXT_STEP_SEARCH_LIMIT = 30;

/** リーグの見出し文言（仮） */
interface LeagueCopy {
  readonly name: string;
  readonly shortName: string;
  readonly icon: string;
  readonly tagline: string;
  readonly rule: string;
  /** 競うもの */
  readonly metric: string;
  /** 参加できる人 */
  readonly eligibility: string;
  /** タブに添える違いの一言 */
  readonly tabHint: string;
  readonly unit: string;
}

/** リーグごとの文言（仮） */
const LEAGUE_COPY: Readonly<Record<LeagueId, LeagueCopy>> = Object.freeze({
  kayoi: {
    name: 'かよいリーグ',
    shortName: 'かよい',
    icon: '♛',
    tagline: '同じ街に何度も通う人が有利。通い慣れた人どうしの勝負',
    rule: '今月通った回数で順位を決めます',
    metric: '今月 通った回数（同じ場所も毎回数える）',
    eligibility: 'だれでも',
    tabHint: '通った回数',
    unit: '回',
  },
  hajimete: {
    name: 'はじめましてリーグ',
    shortName: 'はじめまして',
    icon: '✦',
    tagline: '行ったことのない場所へ足をのばす人が有利。初めての人ほど上位に届きます',
    rule: '今月の新しい場所の数で順位を決めます',
    metric: '今月 新しい場所の数（2回目からは数えない）',
    eligibility: 'だれでも',
    tabHint: '新しい場所の数',
    unit: 'か所',
  },
  rookie: {
    name: 'ルーキーリーグ',
    shortName: 'ルーキー',
    icon: '❀',
    tagline: '始めたばかりの人だけで、同じスタートラインから競えます',
    rule: '今月通った回数で順位を決めます',
    metric: '今月 通った回数（かよいリーグと同じ数え方）',
    eligibility: `はじめて${ROOKIE_PERIOD_DAYS}日以内`,
    tabHint: `${ROOKIE_PERIOD_DAYS}日以内の人`,
    unit: '回',
  },
});

/** 同率のとき最初に開くタブの優先（初めての人向けのリーグを先に） */
const RECOMMEND_PRIORITY: readonly LeagueId[] = ['rookie', 'hajimete', 'kayoi'];

/** GetRankingUseCase の依存 */
export type GetRankingDeps = WorldDeps;

/**
 * 次の一歩の文言（「あと1回で4位」など）を作る。
 * @param leagueId リーグ
 * @param myCount あなたの数値
 * @param myRank あなたの順位
 * @param today 今日
 * @returns 文言
 */
function nextStepTextOf(leagueId: LeagueId, myCount: number, myRank: number, today: LocalDate): string {
  const log = logger.fn('nextStepTextOf', { leagueId, myCount, myRank });
  const unit = LEAGUE_COPY[leagueId].unit;
  if (myRank === 1) return log.exit('1位です！このまま通って守りましょう');
  for (let extra = 1; extra <= NEXT_STEP_SEARCH_LIMIT; extra++) {
    const rank = myRankWith(leagueId, myCount + extra, today);
    if (rank >= myRank) continue;
    const action = leagueId === 'hajimete' ? `まだ行ったことのないスポットをあと${extra}か所` : `あと${extra}${unit}`;
    return log.exit(`${action}で${rank}位に上がれます`);
  }
  return log.exit('一歩ずつ通って順位を上げましょう');
}

/**
 * ランキングの行に「主：地区」タグをつける（かよいリーグのみ）。
 * @param leagueId リーグ
 * @param name 参加者の名前
 * @param isMe あなたか
 * @param lordTags 主の名前 → 地区の短い名前の一覧
 * @returns 地区の短い名前の一覧
 */
function lordTagsFor(leagueId: LeagueId, name: string, isMe: boolean, lordTags: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const log = logger.fn('lordTagsFor', { leagueId, isMe });
  if (leagueId !== 'kayoi') return log.exit([]);
  return log.exit(lordTags.get(isMe ? TRAVELER_LORD_NAME : name) ?? []);
}

/**
 * ライバル1人分の DTO を作る。
 * @param e 順位表の行
 * @param gap 追いつくまでの数／あなたとの差
 * @returns RankingRivalDto（凍結済み）
 */
function rival(e: RankingEntryDto, gap: number): RankingRivalDto { // audit-ignore: fnlog-missing 1リーグにつき2回だけ呼ぶ小さな詰め替え（呼び出し側 competitionOf でログ）
  return Object.freeze({ name: e.name, rank: e.rank, count: e.count, gap });
}

/** 競り合いの情報（LeagueDto の一部） */
type Competition = Pick<LeagueDto, 'myRankYesterday' | 'rivalAbove' | 'rivalBelow' | 'podiumGap'>;

/** 表彰台に乗れる順位 */
const PODIUM_RANK = 3;

/**
 * 競り合いの情報（昨日の順位・すぐ上／下のライバル・表彰台までの数）を作る。
 * ダミーの数値は固定なので、昨日との違いはあなたの記録の変化だけから生まれる（今日訪れると順位が上がって見える）。
 * @param leagueId リーグ
 * @param records あなたの記録
 * @param today 今日
 * @param entries 今日の順位表（あなたを含む）
 * @returns Competition（該当しない項目は含めない）
 */
function competitionOf(leagueId: LeagueId, records: LeagueRecords, today: LocalDate, entries: readonly RankingEntryDto[]): Competition {
  const log = logger.fn('competitionOf', { leagueId, today });
  const meIndex = entries.findIndex((e) => e.isMe);
  const me = entries[meIndex];
  if (me === undefined) return log.exit({}, '不参加');
  const yesterday = addDays(today, -1);
  const myRankYesterday = monthKeyOf(yesterday) === monthKeyOf(today) ? myRankWith(leagueId, leagueScoreOf(leagueId, records, yesterday), today) : undefined;
  const above = entries.slice(0, meIndex).reverse().find((e) => e.count > me.count);
  const below = entries[meIndex + 1];
  const third = entries[PODIUM_RANK - 1];
  const podiumGap = me.rank <= PODIUM_RANK || third === undefined ? 0 : Math.max(1, third.count - me.count);
  return log.exit({
    ...(myRankYesterday === undefined ? {} : { myRankYesterday }),
    ...(above === undefined ? {} : { rivalAbove: rival(above, above.count - me.count) }),
    ...(below === undefined ? {} : { rivalBelow: rival(below, me.count - below.count) }),
    podiumGap,
  });
}

/** 1リーグ分の DTO を作るのに使う、リーグ共通の材料 */
interface LeagueContext {
  /** あなたの記録 */
  readonly records: LeagueRecords;
  readonly today: LocalDate;
  /** いま（キープ報酬の経過時間に使う） */
  readonly now: Instant;
  /** これまでに手に入れた月間リーグの報酬ID */
  readonly earned: ReadonlySet<string>;
  /** 主の名前 → 地区の短い名前の一覧 */
  readonly lordTags: ReadonlyMap<string, readonly string[]>;
  /** 模擬ライバルの名前 → ライバルID（アバターの見た目を地図とそろえる） */
  readonly rivalIds: ReadonlyMap<string, string>;
}

/**
 * 1リーグ分の DTO を作る。
 * @param leagueId リーグ
 * @param c リーグ共通の材料
 * @returns LeagueDto（凍結済み）
 */
function leagueDtoOf(leagueId: LeagueId, c: LeagueContext): LeagueDto {
  const { records, today, lordTags } = c;
  const log = logger.fn('leagueDtoOf', { leagueId, today });
  const copy = LEAGUE_COPY[leagueId];
  const myCount = leagueScoreOf(leagueId, records, today);
  const joined = leagueId !== 'rookie' || isRookie(records, today);
  const ranking = Ranking.from({ participants: participantsOf(leagueId, joined ? myCount : undefined), asOf: today });
  const entries: RankingEntryDto[] = ranking.entries.map((e) =>
    Object.freeze({
      rank: e.rank,
      name: e.name,
      isMe: e.isMe,
      count: e.count,
      lordOf: Object.freeze([...lordTagsFor(leagueId, e.name, e.isMe, lordTags)]),
      avatarKey: e.isMe ? ME_KEY : (c.rivalIds.get(e.name) ?? e.name),
    }),
  );
  const myRank = entries.find((e) => e.isMe)?.rank;
  const membershipNote = membershipNoteOf(leagueId, records, today, joined);
  const rewards = leagueRewardsOf({
    leagueId,
    unit: copy.unit,
    myRank,
    myCount,
    now: c.now,
    heldSinceOf: (goal) => heldSinceOf(leagueId, records, today, goal),
    earned: c.earned,
  });
  const nextPrize = joined ? nextPrizeOf(rewards, entries, myCount) : undefined;
  const dto: LeagueDto = Object.freeze({
    id: leagueId,
    ...copy,
    rewards,
    ...(nextPrize === undefined ? {} : { nextPrize }),
    joined,
    ...(membershipNote === undefined ? {} : { membershipNote }),
    entries: Object.freeze(entries),
    ...(myRank === undefined ? {} : { myRank }),
    myCount,
    nextStepText: myRank === undefined ? 'ルーキーのみなさんを先輩として応援しましょう' : nextStepTextOf(leagueId, myCount, myRank, today),
    ...(joined ? competitionOf(leagueId, records, today, entries) : {}),
  });
  return log.exit(dto);
}

/**
 * 画面用の短い日付（'11/1（日）'）。
 * @param date LocalDate
 * @returns 'M/D（曜）'
 */
function shortJpDate(date: LocalDate): string { // audit-ignore: fnlog-missing formatJpDate（ログあり）の表示を短くするだけ
  return formatJpDate(date).slice(5).replace(/^0/, '').replace('/0', '/');
}

/**
 * 参加状況の補足（ルーキーリーグのみ。卒業まであと何日／卒業済み）。
 * @param leagueId リーグ
 * @param records あなたの記録
 * @param today 今日
 * @param joined 参加しているか
 * @returns 文言。補足が無ければ undefined
 */
function membershipNoteOf(leagueId: LeagueId, records: LeagueRecords, today: LocalDate, joined: boolean): string | undefined {
  const log = logger.fn('membershipNoteOf', { leagueId, joined });
  if (leagueId !== 'rookie') return log.exit(undefined);
  const graduation = rookieGraduationDateOf(records);
  if (graduation === undefined) return log.exit(`ようこそ！使いはじめてから${ROOKIE_PERIOD_DAYS}日間参加できます`);
  if (!joined) return log.exit(`${formatJpDate(graduation)}にルーキーを卒業しました`);
  return log.exit(`ルーキー卒業まであと${daysBetween(today, graduation)}日`);
}

/**
 * 地区の主の名前 → 主をつとめる地区の短い名前の一覧 を作る。
 * @param world 旅人の世界
 * @param standings 地区ごとの主の状況
 * @returns Map
 */
function lordTagsOf(world: World, standings: readonly LordStanding[]): Map<string, string[]> {
  const log = logger.fn('lordTagsOf', { districts: standings.length });
  const tags = new Map<string, string[]>();
  for (const s of standings) {
    if (s.lordName === undefined) continue;
    const shortName = world.spots.findDistrict(s.districtId)?.shortName ?? '';
    tags.set(s.lordName, [...(tags.get(s.lordName) ?? []), shortName]);
  }
  return log.exit(tags);
}

/**
 * 地区の主の状況を DTO にする（地区の表示順）。
 * @param world 旅人の世界
 * @param standings 地区ごとの主の状況
 * @returns RankingLordDto の配列（凍結済み）
 */
function lordDtosOf(world: World, standings: readonly LordStanding[]): readonly RankingLordDto[] {
  const log = logger.fn('lordDtosOf', { districts: standings.length });
  const order = new Map(world.spots.allDistricts().map((d) => [d.id, d.order]));
  const dtos = [...standings]
    .sort((a, b) => (order.get(a.districtId) ?? 0) - (order.get(b.districtId) ?? 0))
    .map((s) =>
      Object.freeze({
        districtId: s.districtId,
        districtName: world.spots.findDistrict(s.districtId)?.name ?? '',
        districtShortName: world.spots.findDistrict(s.districtId)?.shortName ?? '',
        ...(s.lordName === undefined ? {} : { lordName: s.lordName }),
        isMe: s.isMe,
        lost: s.lostByTraveler,
        lordCount: s.lordCount,
        myCount: s.myCount,
        needed: s.needed,
      }),
    );
  return log.exit(Object.freeze(dtos));
}

/**
 * 最初に開くリーグを選ぶ（参加中で順位が一番上。同順位なら初めての人向けのリーグを先に）。
 * @param leagues 全リーグ
 * @returns リーグID
 */
export function recommendLeague(leagues: readonly Pick<LeagueDto, 'id' | 'myRank'>[]): LeagueIdDto {
  const log = logger.fn('recommendLeague', { leagues: leagues.length });
  const candidates = leagues
    .filter((l): l is Pick<LeagueDto, 'id'> & { myRank: number } => l.myRank !== undefined)
    .sort((a, b) => a.myRank - b.myRank || RECOMMEND_PRIORITY.indexOf(a.id) - RECOMMEND_PRIORITY.indexOf(b.id));
  return log.exit(candidates[0]?.id ?? 'kayoi');
}

/** 月間リーグのランキングを返す */
export class GetRankingUseCase implements UseCase<void, RankingDto> {
  /**
   * 依存を受け取る。
   * @param deps 旅人の世界を読む依存
   */
  constructor(private readonly deps: GetRankingDeps) {}

  /**
   * 3リーグのランキング（報酬つき）と地区の主の状況を返す。
   * @returns 成功: RankingDto（凍結済み）。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect 各リポジトリと Clock.now を読む（書込みはしない）
   */
  async execute(): Promise<Result<RankingDto>> {
    const log = logger.fn('execute');
    const world = await loadWorld(this.deps);
    if (!world.ok) return log.fail(world);
    const { today, traveler } = world.value;
    const records: LeagueRecords = { visits: traveler.visits, discoveries: traveler.discoveries };
    const standings = standingsOf(world.value);
    const monthLabel = `${Number(today.slice(5, 7))}月`;
    const now = this.deps.clock.now();
    const context: LeagueContext = {
      records,
      today,
      now,
      earned: earnedLeagueRewardIdsOf(records, today, now),
      lordTags: lordTagsOf(world.value, standings),
      rivalIds: new Map(world.value.rivals.map((r) => [r.name, String(r.id)])),
    };
    const leagues = LEAGUE_IDS.map((id) => leagueDtoOf(id, context));
    const end = endOfMonth(today);
    const dto: RankingDto = Object.freeze({
      monthLabel,
      daysLeft: daysLeftInMonth(today),
      periodLabel: `${shortJpDate(startOfMonth(today))}〜${shortJpDate(end)}`,
      closeLabel: `${shortJpDate(end)}23:59`,
      deliveryLabel: shortJpDate(addDays(end, 1)),
      leagues: Object.freeze(leagues),
      recommendedLeagueId: recommendLeague(leagues),
      lords: lordDtosOf(world.value, standings),
    });
    log.debug('ランキング', { today, ranks: leagues.map((l) => `${l.id}:${l.myRank ?? '-'}`) });
    return log.exit(ok(dto));
  }
}
