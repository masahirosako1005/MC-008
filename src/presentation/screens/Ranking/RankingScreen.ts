/**
 * @file ランキング画面（presentation/screens/Ranking 層。ルート '#/ranking'）
 * 月間3リーグ（かよい／はじめまして／ルーキー）をタブで切り替え、表彰台（上位3名）＋リストを出す（CLAUDE.md 4.6・6.7、wireframes/07_ranking）。
 * 見やすさのため、文字は最小限にして絵と動きで見せる:
 * - 上部は「ランキングどどーん！」のステージ（rankingStage.ts）。表彰台・エモート・あなた帯（順位・レース・出かける）
 * - リスト: 順位・アバター・名前・数だけ。すぐ上／すぐ後ろのライバルはエモート（！／炎）、地区の主はアバターの王冠で示す
 * - 報酬はアバターの部品（メダル・称号・月桂冠・旗・トロフィー）。「この順位まではこれがもらえる」を順位表の上で見せて競わせる:
 *   表彰台の台に1〜3位の報酬の絵、リストに段の帯（「4〜5位 → 月桂冠」。次の段には「あと○回」）、あなた帯に次の報酬までの数
 * - 報酬: 報酬の絵＋順位＋名前の1行ずつと、キープ報酬（「表彰台を24時間キープ → 表彰台の旗」）。手に入れた報酬にはチェック
 * - 報酬を手に入れたら全画面の演出（rankingPrizes.createPrizeGet）。「着る」でアバター画面へ
 * - 地区の主（かよいリーグのみ）: 5地区を小さなタイルで（地区名・主のアバター・あなた／あと○回）
 * - リーグのルール（3リーグの比較表）は一番下にたたんでおく
 * 初めての人でも活躍できるよう、最初に開くタブは「あなたが一番上位のリーグ」。基準 C。
 * 動きは prefers-reduced-motion: no-preference のときだけ（CSS 側と、順位の入れ替え演出の両方で判定）。
 */
import { prefersReducedMotion } from '@/Common/ui/a11y/reducedMotion';
import '@/presentation/screens/Ranking/RankingScreen.css';
import type { KeepRewardDto, LeagueDto, LeagueIdDto, RankingDto, RankingEntryDto, RankingLordDto, RewardTierDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import { createTopBar } from '@/Common/ui/TopBar';
import { userAction } from '@/Common/ui/userAction';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import {
  countLabel,
  districtShortOf,
  gaugePercentOf,
  hotLabelOf,
  keepChipOf,
  keepGoalTextOf,
  keepPercentOf,
  listItemsOf,
  lordStatusOf,
  metricShortOf,
  myEmoteOf,
  myEntryOf,
  newPrizesOf,
  nextGapLabelOf,
  raceLabelOf,
  rankChangeOf,
  rivalMarkOf,
  tabRankLabel,
  tierOfRank,
  tierUpOf,
} from '@/presentation/screens/Ranking/rankingModel';
import { createPrizeGet, createPrizeStrip, createTierBand, PRIZE_SIZE } from '@/presentation/screens/Ranking/rankingPrizes';
import type { RankChange } from '@/presentation/screens/Ranking/rankingModel';
import { createEmote, createStage } from '@/presentation/screens/Ranking/rankingStage';
import type { AvatarMaker } from '@/presentation/screens/Ranking/rankingStage';
import { createAvatarImage } from '@/presentation/shared/avatarImage';
import { avatarLookOfTown } from '@/presentation/shared/avatarSprite';
import type { AvatarLook } from '@/presentation/shared/avatarSprite';
import { personLookOf } from '@/presentation/shared/personLook';

const logger = createLogger('presentation/screens/Ranking/RankingScreen');

/** リーグの記号（文字の飾り）→ 線のアイコン（docs/08 §10.2：記号文字ではなく icons.ts の線アイコンを使う） */
const LEAGUE_ICONS: Readonly<Record<string, IconName>> = { '♛': 'crown', '✦': 'compass', '❀': 'sparkle' };

/**
 * リーグの記号に対応する線アイコンの名前を返す（知らない記号は星）。
 * @param glyph リーグの記号（LeagueDto.icon）
 * @returns アイコンの名前
 */
function leagueIconName(glyph: string): IconName { // audit-ignore: fnlog-missing 表示ごとに呼ぶ純粋な対応表の参照
  return LEAGUE_ICONS[glyph] ?? 'star';
}

/** 順位が上がったとき、昨日の順位を見せてから今日の順位に入れ替えるまでの時間（ms。表示から 1.0 秒以内に今日の順位にする） */
const RANK_SWAP_DELAY_MS = 450;

/** この起動の中でステージの登場の演出を見せたか（2回目以降・タブの切替は、落下を省いて短いフェードだけにする） */
let stageSeen = false;

/** アバターの拡大率（1 で高さ約 70px） */
const AVATAR_SCALE = { row: 0.42, me: 0.72, rival: 0.34, lord: 0.46 } as const;

/** 報酬獲得の演出を出すまでの時間（ms。ステージの着地が終わってから） */
const PRIZE_GET_DELAY_MS = 1200;

/** この起動中に獲得の演出を出した部品ID（アバター画面で見るまで NEW のままなので、ランキングを開くたびに繰り返さない） */
const celebratedPartIds = new Set<string>();

/** 報酬一覧の要素ID（「報酬」で飛ぶ先） */
const REWARDS_ID = 'ranking-rewards';

/**
 * ランキング画面を作る。
 * @param ctx 画面コンテキスト
 * @returns 画面
 */
export function createRankingScreen(ctx: AppContext): Screen {
  const log = logger.fn('createRankingScreen');
  const controller = new RankingController(ctx);
  return log.exit({
    mount: (root: HTMLElement): Promise<void> => controller.mount(root),
    unmount: (): void => controller.unmount(),
  });
}

/**
 * 順位変化のバッジを作る（上がった・下がったときだけ。「昨日と同じ」は出さない）。
 * @param change 変化
 * @returns 要素（上下していなければ undefined）
 */
function createChangeBadge(change: RankChange): HTMLElement | undefined {
  const log = logger.fn('createChangeBadge', { kind: change.kind, diff: change.diff });
  if (change.kind !== 'up' && change.kind !== 'down') return log.exit(undefined);
  return log.exit(
    h('span', {
      class: 'me-strip__change',
      dataset: { kind: change.kind },
      attrs: { 'data-testid': 'ranking-change', 'aria-label': `昨日から${change.diff}位${change.kind === 'up' ? '上がった' : '下がった'}` },
      text: `${change.kind === 'up' ? '▲' : '▼'}${change.diff}`,
    }),
  );
}

/**
 * 進み具合の細いバーを作る（キープ報酬）。
 * @param keep キープ報酬
 * @returns 要素
 */
function createKeepBar(keep: KeepRewardDto): HTMLElement { // audit-ignore: fnlog-missing キープ報酬ごとに呼ぶ DOM 組立て（呼び出し側でログ）
  const fill = h('span', { class: 'keep-bar__fill' });
  setStyle(fill, '--keep', `${keepPercentOf(keep)}%`);
  return h('span', { class: 'keep-bar', attrs: { role: 'img', 'aria-label': `${keep.hours}時間のうち${keep.heldHours}時間キープ` } }, [fill]);
}

/**
 * リストの1行を作る（順位・アバター・名前・数。すぐ上は「！」、すぐ後ろは炎のエモート）。
 * @param entry 行
 * @param league リーグ
 * @param avatar アバターを作る関数
 * @returns 要素
 */
function rankingRow(entry: RankingEntryDto, league: LeagueDto, avatar: AvatarMaker): HTMLElement { // audit-ignore: fnlog-missing リストの行ごとに呼ぶ DOM 組立て（呼び出し側 render でログ）
  const mark = rivalMarkOf(entry, league);
  const label = mark === 'target' ? 'すぐ上のライバル' : mark === 'chaser' ? 'すぐ後ろのライバル' : undefined;
  return h(
    'li',
    {
      class: ['ranking-row', entry.isMe ? 'ranking-row--me' : undefined],
      dataset: { mark },
      attrs: { 'data-testid': entry.isMe ? 'ranking-row-me' : 'ranking-row', ...(label === undefined ? {} : { 'aria-label': `${entry.rank}位 ${entry.name}（${label}）` }) },
    },
    [
      h('span', { class: 'ranking-row__rank', text: String(entry.rank) }),
      avatar(entry, AVATAR_SCALE.row, 'ranking-row__badge'),
      h('span', { class: 'ranking-row__name', text: entry.name }),
      mark === undefined ? undefined : h('span', { class: 'ranking-row__emote' }, [createEmote(mark === 'target' ? 'exclaim' : 'fire', 0)]),
      h('span', { class: 'ranking-row__count', text: countLabel(entry.count, league.unit) }),
    ],
  );
}

/**
 * 表彰台より下のリストを作る。順位報酬の段の帯（「4〜5位 → 月桂冠」）をはさみ、次にねらえる段には「あと○回」を出す。
 * 次の段が表彰台（リストに帯が無い）のときは、先頭に「表彰台まで あと○回」。
 * @param league リーグ
 * @param avatar アバターを作る関数
 * @param base あなたの装い（報酬の絵に使う）
 * @returns 要素（4位以下がいなければ undefined）
 */
function createList(league: LeagueDto, avatar: AvatarMaker, base: readonly string[]): HTMLElement | undefined {
  const log = logger.fn('createList', { leagueId: league.id });
  const items = listItemsOf(league);
  if (!items.some((item) => item.kind === 'row')) return log.exit(undefined);
  const gap = league.podiumGap;
  const nextInList = items.some((item) => item.kind === 'band' && item.state === 'next');
  const gapLabel = nextGapLabelOf(league);
  return log.exit(
    h('div', { class: 'ranking-list-wrap' }, [
      gap === undefined || gap === 0 || nextInList ? undefined : h('p', { class: 'rk-podium-line', attrs: { 'data-testid': 'podium-line' } }, [createIcon('arrowUp'), `表彰台まで あと${countLabel(gap, league.unit)}`]),
      h('ol', { class: 'ranking-list', attrs: { 'aria-label': '4位以下' } }, items.map((item) => (item.kind === 'band' ? createTierBand(item.tier, base, item.state, gapLabel) : rankingRow(item.entry, league, avatar)))),
    ]),
  );
}

/**
 * 順位報酬の1段（順位・報酬の絵・名前）を作る。名前は主役の報酬を1行、残りを小さく1行（どちらも折り返さず、入らなければ省略）。
 * @param tier 段
 * @param base あなたの装い（報酬の絵に使う）
 * @returns 要素
 */
function rewardTierRow(tier: RewardTierDto, base: readonly string[]): HTMLElement { // audit-ignore: fnlog-missing 段ごとに呼ぶ DOM 組立て（呼び出し側 createRewards でログ）
  const [lead, ...others] = tier.prizes;
  return h('li', { class: ['rk-row', tier.isMine ? 'rk-row--mine' : undefined], attrs: { 'data-testid': 'reward-tier', 'aria-label': `${tier.label} ${tier.prizes.map((p) => p.name).join('・')}${tier.isMine ? '（いまの順位）' : ''}` } }, [
    h('span', { class: 'rk-row__head', attrs: { 'aria-hidden': 'true' } }, [
      h('strong', { class: 'rk-row__rank', text: tier.label }),
      tier.isMine ? h('span', { class: 'rk-row__mine', text: 'いまココ' }) : undefined,
    ]),
    createPrizeStrip(tier.prizes, base, PRIZE_SIZE.card, true),
    h('span', { class: 'rk-row__names', attrs: { 'aria-hidden': 'true' } }, [
      h('strong', { class: 'rk-row__lead', text: lead?.name ?? '' }),
      others.length === 0 ? undefined : h('span', { class: 'rk-row__sub', text: others.map((p) => p.name).join('・') }),
    ]),
  ]);
}

/**
 * キープ報酬の1行（上に条件「表彰台を24時間キープ」、下に主役の報酬の名前。右に状態）を作る。
 * @param keep キープ報酬
 * @param base あなたの装い（報酬の絵に使う）
 * @returns 要素
 */
function keepRow(keep: KeepRewardDto, base: readonly string[]): HTMLElement { // audit-ignore: fnlog-missing キープ報酬ごとに呼ぶ DOM 組立て（呼び出し側 createRewards でログ）
  const status = keep.state === 'achieved' ? '獲得！' : keep.state === 'keeping' ? `あと${keep.remainingHours}時間` : undefined;
  const prizes = keep.prizes ?? [keep.prize];
  return h('li', { class: ['rk-row', 'rk-row--keep'], dataset: { state: keep.state }, attrs: { 'data-testid': `keep-${keep.id}`, 'aria-label': `${keepGoalTextOf(keep)}で ${prizes.map((prize) => prize.name).join('・')}${status === undefined ? '' : `（${status}）`}` } }, [
    createPrizeStrip(prizes, base, PRIZE_SIZE.card, true),
    h('span', { class: 'rk-row__names', attrs: { 'aria-hidden': 'true' } }, [
      h('span', { class: 'rk-row__sub', text: keepGoalTextOf(keep) }),
      h('strong', { class: 'rk-row__lead', text: keep.prize.name }),
      keep.state === 'keeping' ? createKeepBar(keep) : undefined,
    ]),
    status === undefined ? undefined : h('span', { class: 'rk-row__status', attrs: { 'aria-hidden': 'true' }, text: status }),
  ]);
}

/**
 * 今月の報酬（順位報酬とキープ報酬）を1枚のカードにまとめる。
 * @param dto ランキング
 * @param league リーグ
 * @param base あなたの装い（報酬の絵に使う）
 * @returns 要素（報酬が無ければ undefined）
 */
function createRewards(dto: RankingDto, league: LeagueDto, base: readonly string[]): HTMLElement | undefined {
  const log = logger.fn('createRewards', { leagueId: league.id });
  const rewards = league.rewards;
  if (rewards === undefined) return log.exit(undefined, '報酬なし');
  return log.exit(
    h('section', { class: 'rk-card', dataset: { league: league.id }, attrs: { id: REWARDS_ID, 'data-testid': 'ranking-rewards', 'aria-labelledby': `${REWARDS_ID}-title` } }, [
      h('h3', { class: 'rk-card__title', attrs: { id: `${REWARDS_ID}-title` } }, [
        createIcon('rank'),
        '報酬',
        dto.closeLabel === undefined ? undefined : h('span', { class: 'rk-card__note', attrs: { 'data-testid': 'ranking-period' }, text: `${dto.closeLabel} 締め` }),
      ]),
      league.joined ? undefined : h('p', { class: 'rk-card__muted', text: '見学中のため対象外' }),
      h('ol', { class: 'rk-rows' }, rewards.tiers.map((t) => rewardTierRow(t, base))),
      h('ul', { class: ['rk-rows', 'rk-rows--keep'], attrs: { 'aria-label': 'キープ報酬' } }, rewards.keeps.map((k) => keepRow(k, base))),
    ]),
  );
}

/** ランキング画面の読込・描画・タブ切替を受け持つ */
class RankingController {
  private readonly ctx: AppContext;
  private readonly body: HTMLElement;
  private dto: RankingDto | undefined;
  private selected: LeagueIdDto = 'kayoi';
  /** あなたのアバターの装い（マイ街と同じ。読めなければ undefined＝星のバッジ） */
  private myLook: AvatarLook | undefined;
  /** 地区の主の名前（ほかの旅人のアバターに王冠をかぶせる。地図と同じ見た目にする） */
  private lordNames: ReadonlySet<string> = new Set();
  /** 名前 → アバターのキー（地区の主タイルでアバターを出すため。全リーグの行から集める） */
  private avatarKeys: ReadonlyMap<string, string> = new Map();
  /** 「リーグのルール」を開いているか（タブを切り替えても保つ） */
  private rulesOpen = false;
  /** 順位の入れ替え演出のタイマー */
  private swapTimer: ReturnType<typeof setTimeout> | undefined;
  /** あなたの装い（報酬の絵は、これに報酬を着せて描く。読めなければ既定の姿） */
  private myOutfit: readonly string[] = [];
  /** 画面のルート（報酬獲得の演出を重ねる） */
  private root: HTMLElement | undefined;
  /** 報酬獲得の演出（出ていなければ undefined）と、出すまでのタイマー */
  private prizeGet: HTMLElement | undefined;
  private prizeGetTimer: ReturnType<typeof setTimeout> | undefined;
  /** 画面を離れた（以降の非同期結果は捨てる） */
  private disposed = false;

  /**
   * 骨組みを作る。
   * @param ctx 画面コンテキスト
   */
  constructor(ctx: AppContext) {
    const log = logger.fn('constructor');
    this.ctx = ctx;
    this.body = h('div', { class: ['screen-scroll', 'ranking'], attrs: { 'data-testid': 'ranking', 'data-load': 'loading' } });
    log.exit(undefined);
  }

  /**
   * 上部バーと本文を置き、ランキングとあなたのアバター（マイ街・着せ替え）を読み込んで描く。
   * 手に入れてまだ見ていない報酬があれば、ステージの着地のあとに獲得の演出を出す。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加し、services.ranking／myTown／avatar を呼ぶ。演出のタイマーを登録する
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount');
    this.root = root;
    root.append(createTopBar({ title: 'ランキング' }), this.body);
    const [result, town, closet] = await Promise.all([this.ctx.services.ranking.execute(), this.ctx.services.myTown.execute(), this.ctx.services.avatar.execute()]);
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (!result.ok) {
      this.body.dataset.load = 'error';
      this.body.replaceChildren(h('p', { class: 'screen-message', text: result.error.message }));
      return log.fail(undefined, result.error.code);
    }
    if (town.ok) {
      this.myLook = avatarLookOfTown(town.value);
      this.myOutfit = town.value.avatarPartIds;
    } else log.warn('マイ街を読めないため、あなたのアバターは星のバッジにする', { code: town.error.code });
    this.dto = result.value;
    this.lordNames = new Set(result.value.lords.flatMap((l) => (l.lordName === undefined || l.isMe ? [] : [l.lordName])));
    this.avatarKeys = new Map(result.value.leagues.flatMap((l) => l.entries.map((e): [string, string] => [e.name, e.avatarKey])));
    this.selected = result.value.recommendedLeagueId;
    this.render();
    if (closet.ok) this.schedulePrizeGet(result.value, new Set(closet.value.parts.filter((part) => part.owned && part.isNew).map((part) => part.id)));
    else log.warn('着せ替えを読めないため、報酬獲得の演出は出さない', { code: closet.error.code });
    log.exit(undefined);
  }

  /**
   * 手に入れてまだ見ていない報酬があれば、獲得の演出を予約する（この起動中に出したものは繰り返さない）。
   * @param dto ランキング
   * @param newPartIds 手に入れてまだ見ていない部品ID
   * @sideEffect タイマーを登録する
   */
  private schedulePrizeGet(dto: RankingDto, newPartIds: ReadonlySet<string>): void {
    const prizes = newPrizesOf(dto, newPartIds).filter((prize) => prize.partId !== undefined && !celebratedPartIds.has(prize.partId));
    const log = logger.fn('schedulePrizeGet', { prizes: prizes.length });
    if (prizes.length === 0) return log.exit(undefined, '新しい報酬なし');
    this.prizeGetTimer = setTimeout(() => {
      this.prizeGetTimer = undefined;
      if (this.disposed || this.root === undefined) return;
      for (const prize of prizes) if (prize.partId !== undefined) celebratedPartIds.add(prize.partId);
      this.prizeGet = createPrizeGet(prizes, this.myOutfit, {
        onWear: (): void => {
          this.closePrizeGet();
          this.ctx.router.navigate('#/avatar');
        },
        onClose: (): void => this.closePrizeGet(),
      });
      this.root.append(this.prizeGet);
    }, prefersReducedMotion() ? 0 : PRIZE_GET_DELAY_MS);
    log.exit(undefined);
  }

  /**
   * 報酬獲得の演出をとじる。
   * @sideEffect 演出の要素を外す
   */
  private closePrizeGet(): void {
    const log = logger.fn('closePrizeGet', { open: this.prizeGet !== undefined });
    this.prizeGet?.remove();
    this.prizeGet = undefined;
    log.exit(undefined);
  }

  /**
   * 後始末する（演出のタイマーを止め、以降の非同期結果を捨てる）。
   * @sideEffect タイマーを解除する
   */
  unmount(): void {
    const log = logger.fn('unmount');
    this.disposed = true;
    this.clearSwapTimer();
    if (this.prizeGetTimer !== undefined) clearTimeout(this.prizeGetTimer);
    this.prizeGetTimer = undefined;
    this.closePrizeGet();
    log.exit(undefined);
  }

  /**
   * 順位の入れ替え演出のタイマーを止める。
   * @sideEffect タイマーを解除する
   */
  private clearSwapTimer(): void { // audit-ignore: fnlog-missing 描画・後始末のたびに呼ぶタイマー解除だけの小さな処理
    if (this.swapTimer !== undefined) clearTimeout(this.swapTimer);
    this.swapTimer = undefined;
  }

  /**
   * 参加者のアバターを作る（あなたはマイ街の装い、ほかの人は地図と同じ決め方。画像が作れなければ頭文字・星のバッジ）。
   * @param entry 参加者
   * @param scale 拡大率
   * @param fallbackClass 画像が作れないときのバッジの class
   * @returns 要素
   */
  private avatarOf(entry: RankingEntryDto, scale: number, fallbackClass = 'rk-avatar--badge'): HTMLElement { // audit-ignore: fnlog-missing 参加者ごとに呼ぶ DOM 組立て（画像化は createAvatarImage でログ）
    const look = entry.isMe ? this.myLook : personLookOf(entry.avatarKey, this.lordNames.has(entry.name));
    const img = look === undefined ? undefined : createAvatarImage(look, scale);
    if (img !== undefined) return h('span', { class: 'rk-avatar', attrs: { 'aria-hidden': 'true' } }, [img]);
    return entry.isMe
      ? h('span', { class: fallbackClass, attrs: { 'aria-hidden': 'true' } }, [createIcon('star')])
      : h('span', { class: fallbackClass, attrs: { 'aria-hidden': 'true' }, text: entry.name.replace(/^(冒険者|旅人)/, '').slice(0, 1) });
  }

  /**
   * 報酬一覧までスクロールする。
   * @sideEffect 本文をスクロールする
   */
  private scrollToRewards(): void {
    const log = logger.fn('scrollToRewards');
    const target = this.body.querySelector<HTMLElement>(`#${REWARDS_ID}`);
    if (target === null) return log.exit(undefined, '報酬なし');
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    log.exit(undefined);
  }

  /**
   * タブを切り替える。
   * @param id 選ぶリーグ
   * @sideEffect 本文を描き直す
   */
  private select(id: LeagueIdDto): void {
    const log = logger.fn('select', { id });
    if (this.selected === id) return log.exit(undefined, '選択済み');
    this.selected = id;
    this.render();
    this.body.scrollTop = 0;
    log.exit(undefined);
  }

  /**
   * 本文を描く（リーグタブ → ステージ → リスト → 報酬 → 地区の主（かよいのみ） → リーグのルール）。
   * @sideEffect 本文の中身を差し替え、順位アップなら入れ替え演出を始める
   */
  private render(): void {
    const dto = this.dto;
    const log = logger.fn('render', { selected: this.selected });
    if (dto === undefined) return log.exit(undefined, '未読込');
    const league = dto.leagues.find((l) => l.id === this.selected) ?? dto.leagues[0];
    if (league === undefined) return log.exit(undefined, 'リーグなし');
    this.clearSwapTimer();
    const avatar: AvatarMaker = this.avatarOf.bind(this);
    const base = this.myOutfit;
    const tierUp = tierUpOf(league);
    this.body.dataset.league = league.id;
    this.body.dataset.quick = stageSeen ? '1' : '0';
    stageSeen = true;
    this.body.replaceChildren(
      this.createTabs(dto, league.id),
      h('section', { class: 'ranking__panel', attrs: { role: 'tabpanel', 'data-testid': 'ranking-panel', 'data-league': league.id } }, [
        createStage({
          dto,
          league,
          avatar,
          meStrip: this.createMeStrip(league),
          onRewards: (): void => this.scrollToRewards(),
          leagueIcon: leagueIconName(league.icon),
          prizeOf: this.podiumPrizeOf.bind(this, league),
          ...(tierUp === undefined ? {} : { tierUp: createPrizeStrip(tierUp.prizes, base, PRIZE_SIZE.band) }),
        }),
        createList(league, avatar, base),
        createRewards(dto, league, base),
      ]),
      ...(league.id === 'kayoi' ? [this.createLords(dto.lords)] : []),
      this.createLeagueRules(dto, league),
    );
    this.body.dataset.load = 'ready';
    log.exit(undefined);
  }

  /**
   * 表彰台の台の正面に出す、その順位でもらえる報酬の絵を作る。
   * @param league リーグ
   * @param rank 順位
   * @returns 要素（その順位の段が無ければ undefined）
   */
  private podiumPrizeOf(league: LeagueDto, rank: number): HTMLElement | undefined { // audit-ignore: fnlog-missing 表彰台の3枠ぶん呼ぶ DOM 組立て（絵は createPrizeStrip でログ）
    const tier = tierOfRank(league, rank);
    return tier === undefined ? undefined : createPrizeStrip(tier.prizes, this.myOutfit, PRIZE_SIZE.podium);
  }

  /**
   * リーグのルール（3リーグの比較表）を、たたんだ状態で作る。行をタップするとそのリーグへ切り替える。開閉はタブを切り替えても保つ。
   * @param dto ランキング
   * @param league 選択中のリーグ
   * @returns 要素（details）
   * @sideEffect 開閉のたびに rulesOpen を更新する
   */
  private createLeagueRules(dto: RankingDto, league: LeagueDto): HTMLElement {
    const log = logger.fn('createLeagueRules', { leagueId: league.id, open: this.rulesOpen });
    const rules = h('details', { class: 'rk-rules', attrs: { 'data-testid': 'league-compare' } }, [
      h('summary', { class: 'rk-rules__summary' }, [createIcon('info'), 'リーグのルール']),
      h('div', { class: 'league-compare__table', attrs: { role: 'table', 'aria-label': '3つのリーグのちがい' } }, [
        h('div', { class: ['league-compare__row', 'league-compare__row--head'], attrs: { role: 'row' } }, [
          h('span', { attrs: { role: 'columnheader' }, text: 'リーグ' }),
          h('span', { attrs: { role: 'columnheader' }, text: '競うもの' }),
          h('span', { attrs: { role: 'columnheader' }, text: '参加できる人' }),
        ]),
        ...dto.leagues.map((l) =>
          h(
            'button',
            {
              class: 'league-compare__row',
              dataset: { league: l.id },
              attrs: { type: 'button', role: 'row', 'aria-current': l.id === league.id ? 'true' : 'false', 'data-testid': `league-compare-${l.id}` },
              on: { click: userAction(`league-compare-${l.id}`, (): void => this.select(l.id)) },
            },
            [
              h('span', { class: 'league-compare__name', attrs: { role: 'cell' } }, [h('strong', { text: l.shortName }), h('small', { text: tabRankLabel(l) })]),
              h('span', { attrs: { role: 'cell' }, text: metricShortOf(l) }),
              h('span', { attrs: { role: 'cell' }, text: l.eligibility ?? '' }),
            ],
          ),
        ),
      ]),
      league.membershipNote === undefined ? undefined : h('p', { class: 'rk-rules__note', text: league.membershipNote }),
    ]);
    rules.open = this.rulesOpen;
    rules.addEventListener('toggle', () => {
      this.rulesOpen = rules.open;
    });
    return log.exit(rules);
  }

  /**
   * すぐ上のライバルまでのレース（トラック・ゴールにライバルのアバター・一言）を作る。
   * @param league リーグ（参加中）
   * @returns 要素
   */
  private createRace(league: LeagueDto): HTMLElement {
    const log = logger.fn('createRace', { leagueId: league.id });
    const above = league.rivalAbove;
    const rivalEntry = above === undefined ? undefined : league.entries.find((e) => e.name === above.name && e.rank === above.rank);
    const fill = h('span', { class: 'race__fill' });
    setStyle(fill, '--race', `${gaugePercentOf(league)}%`);
    const hot = hotLabelOf(league);
    const keep = keepChipOf(league);
    const next = league.nextPrize;
    const nextGap = nextGapLabelOf(league);
    return log.exit(
      h('div', { class: 'race' }, [
        h('span', { class: 'race__track', attrs: { role: 'img', 'aria-label': above === undefined ? '1位を独走中' : `${above.rank}位 ${above.name}までの進み具合 ${gaugePercentOf(league)}%` } }, [
          fill,
          h('span', { class: 'race__goal' }, [
            rivalEntry === undefined ? h('span', { class: 'race__crown' }, [createIcon('crown')]) : this.avatarOf(rivalEntry, AVATAR_SCALE.rival, 'race__badge'),
          ]),
        ]),
        h('p', { class: 'race__label' }, [
          h('strong', { text: raceLabelOf(league) }),
          hot === undefined ? undefined : h('span', { class: ['race__chip', 'race__chip--hot'], text: hot }),
          keep === undefined ? undefined : h('span', { class: ['race__chip', 'race__chip--keep'], text: keep }),
          next === undefined || nextGap === undefined
            ? undefined
            : h('span', { class: ['race__chip', 'race__chip--prize'], attrs: { 'data-testid': 'ranking-next-prize', 'aria-label': `${nextGap}で${next.label}の報酬 ${next.prizes.map((prize) => prize.name).join('・')}` } }, [
                createPrizeStrip(next.prizes, this.myOutfit, PRIZE_SIZE.chip),
              ]),
        ]),
      ]),
    );
  }

  /**
   * ステージ下段の「あなた」帯（アバター＋エモート・大きな順位・変化・レース・出かけるボタン）を作る。
   * 順位が上がっていれば、昨日の順位を出してから今日の順位へ入れ替える（動きを減らす設定なら最初から今日の順位）。
   * @param league リーグ
   * @returns 要素
   * @sideEffect 順位アップのとき入れ替えのタイマーを登録する
   */
  private createMeStrip(league: LeagueDto): HTMLElement {
    const log = logger.fn('createMeStrip', { leagueId: league.id, joined: league.joined });
    const me = myEntryOf(league);
    const go = h('button', { class: 'me-strip__go', attrs: { type: 'button', 'data-testid': 'ranking-go-map', 'aria-label': '順位を上げに出かける（地図へ）' }, on: { click: userAction('ranking-go-map', (): void => this.ctx.router.navigate('#/map')) } }, [
      createIcon('navigate'),
      '出かける',
    ]);
    const guestEntry: RankingEntryDto = { rank: 0, name: 'あなた', isMe: true, count: league.myCount, lordOf: [], avatarKey: 'traveler' };
    const figure = h('span', { class: 'me-strip__figure' }, [createEmote(myEmoteOf(league), 3), this.avatarOf(me ?? guestEntry, AVATAR_SCALE.me, 'me-strip__badge')]);
    if (me === undefined) {
      return log.exit(
        h('div', { class: ['me-strip', 'me-strip--guest'], attrs: { 'data-testid': 'ranking-my-card' } }, [
          figure,
          h('p', { class: 'me-strip__guest' }, [h('strong', { text: '見学中' })]),
          go,
        ]),
      );
    }
    const change = rankChangeOf(league);
    const animate = change.kind === 'up' && !prefersReducedMotion();
    const rankNumber = h('span', { class: 'me-strip__num', attrs: { 'data-testid': 'ranking-my-rank' }, text: String(animate ? (league.myRankYesterday ?? me.rank) : me.rank) });
    const strip = h('div', { class: ['me-strip', me.rank <= 3 ? 'me-strip--podium' : undefined], attrs: { 'data-testid': 'ranking-my-card' } }, [
      figure,
      h('p', { class: 'me-strip__rank', attrs: { 'aria-label': `あなたは${me.rank}位（${countLabel(me.count, league.unit)}）` } }, [
        rankNumber,
        h('span', { class: 'me-strip__unit', attrs: { 'aria-hidden': 'true' }, text: '位' }),
        createChangeBadge(change),
      ]),
      go,
      this.createRace(league),
    ]);
    if (animate) {
      this.swapTimer = setTimeout(() => {
        this.swapTimer = undefined;
        rankNumber.textContent = String(me.rank);
        rankNumber.classList.add('me-strip__num--pop');
      }, RANK_SWAP_DELAY_MS);
    }
    return log.exit(strip);
  }

  /**
   * リーグタブを作る（全画面共通の切替 .seg。リーグの色は小さな点・名前・あなたの順位）。
   * @param dto ランキング
   * @param selected 選択中のリーグ
   * @returns 要素
   */
  private createTabs(dto: RankingDto, selected: LeagueIdDto): HTMLElement {
    const log = logger.fn('createTabs', { selected });
    const tabs = dto.leagues.map((l) =>
      h(
        'button',
        {
          class: ['seg__item', 'league-seg__item'],
          dataset: { league: l.id },
          attrs: { type: 'button', role: 'tab', 'aria-selected': l.id === selected ? 'true' : 'false', 'data-testid': `league-tab-${l.id}` },
          on: { click: userAction(`league-tab-${l.id}`, (): void => this.select(l.id)) },
        },
        [h('span', { class: 'league-seg__dot', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'league-seg__name', text: l.shortName }), h('span', { class: 'league-seg__rank', text: tabRankLabel(l) })],
      ),
    );
    return log.exit(h('div', { class: ['seg', 'league-seg'], attrs: { role: 'tablist', 'aria-label': 'リーグ' } }, tabs));
  }

  /**
   * 地区の主の1タイル（地区名・主のアバター・あなた／あと○回）を作る。タップで地区ズームの地図へ。
   * @param lord 地区の主の状況
   * @returns 要素
   */
  private lordTile(lord: RankingLordDto): HTMLElement { // audit-ignore: fnlog-missing 5地区ぶん呼ぶ DOM 組立て（呼び出し側 createLords でログ）
    const status = lordStatusOf(lord);
    const short = districtShortOf(lord);
    const lordEntry: RankingEntryDto | undefined =
      lord.lordName === undefined ? undefined : { rank: 0, name: lord.lordName, isMe: lord.isMe, count: lord.lordCount, lordOf: [], avatarKey: this.avatarKeys.get(lord.lordName) ?? lord.lordName };
    return h(
      'button',
      {
        class: 'rk-lord',
        dataset: { tone: status.tone },
        attrs: { type: 'button', 'data-testid': 'ranking-lord-card', 'aria-label': `${lord.districtName} 領主：${lord.lordName ?? 'なし'}。${status.tone === 'me' ? 'あなたが領主' : `領主まで${status.text}`}` },
        on: { click: userAction('ranking-lord', (): void => this.ctx.router.navigate(`#/map/${lord.districtId}`)) },
      },
      [
        h('span', { class: 'rk-lord__district', text: short }),
        h('span', { class: 'rk-lord__figure', attrs: { 'aria-hidden': 'true' } }, [
          lordEntry === undefined ? h('span', { class: 'rk-lord__empty', text: '？' }) : this.avatarOf(lordEntry, AVATAR_SCALE.lord, 'rk-lord__badge'),
        ]),
        h('span', { class: 'rk-lord__status', text: status.text }),
      ],
    );
  }

  /**
   * 地区の主（直近30日）を小さなタイルの列で作る。
   * @param lords 地区ごとの状況
   * @returns 要素
   */
  private createLords(lords: readonly RankingLordDto[]): HTMLElement {
    const log = logger.fn('createLords', { lords: lords.length });
    return log.exit(
      h('section', { class: ['rk-card', 'rk-card--lords'], attrs: { 'data-testid': 'ranking-lords', 'aria-label': '地区の領主（直近30日）' } }, [
        h('h3', { class: 'rk-card__title' }, [createIcon('crown'), '地区の領主']),
        h('div', { class: 'rk-lords' }, lords.map((lord) => this.lordTile(lord))),
      ]),
    );
  }
}
