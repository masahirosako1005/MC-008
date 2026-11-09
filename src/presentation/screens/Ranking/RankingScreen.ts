/**
 * @file ランキング画面（presentation/screens/Ranking 層。ルート '#/ranking'）
 * 月間3リーグ（かよい／はじめまして／ルーキー）をタブで切り替え、表彰台（上位3名）＋リストを出す（CLAUDE.md 4.6・6.7、wireframes/07_ranking）。
 * 見やすさのため、文字は最小限にして絵と動きで見せる:
 * - 上部は「ランキングどどーん！」のステージ（rankingStage.ts）。表彰台・エモート・あなた帯（順位・レース・出かける）
 * - リスト: 順位・アバター・名前・数だけ。すぐ上／すぐ後ろのライバルはエモート（！／炎）、地区の主はアバターの王冠で示す
 * - 報酬: メダル＋順位＋景品の1行ずつと、キープ報酬（「表彰台を24時間キープ → 表彰台の旗」）
 * - 地区の主（かよいリーグのみ）: 5地区を小さなタイルで（地区名・主のアバター・あなた／あと○回）
 * - リーグのルール（3リーグの比較表）は一番下にたたんでおく
 * 初めての人でも活躍できるよう、最初に開くタブは「あなたが一番上位のリーグ」。基準 C。
 * 動きは prefers-reduced-motion: no-preference のときだけ（CSS 側と、順位の入れ替え演出の両方で判定）。
 */
import '@/presentation/screens/Ranking/RankingScreen.css';
import type { KeepRewardDto, LeagueDto, LeagueIdDto, RankingDto, RankingEntryDto, RankingLordDto, RewardPrizeDto, RewardTierDto } from '@/application/dto/Dto';
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
  listEntriesOf,
  lordStatusOf,
  metricShortOf,
  myEmoteOf,
  myEntryOf,
  raceLabelOf,
  rankChangeOf,
  rivalMarkOf,
  tabRankLabel,
  tierPrizeTextOf,
} from '@/presentation/screens/Ranking/rankingModel';
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

/** 順位が上がったとき、昨日の順位を見せてから今日の順位に入れ替えるまでの時間（ms。ステージの着地が終わるころ） */
const RANK_SWAP_DELAY_MS = 1600;

/** アバターの拡大率（1 で高さ約 70px） */
const AVATAR_SCALE = { row: 0.42, me: 0.72, rival: 0.34, lord: 0.46 } as const;

/** メダルの頭文字 */
const MEDAL_GLYPH: Readonly<Record<'gold' | 'silver' | 'bronze', string>> = { gold: '金', silver: '銀', bronze: '銅' };

/** 景品の種類 → 線アイコン（メダルは丸い札、飾りはリーグごと） */
const PRIZE_ICONS: Readonly<Record<'title' | 'stamp' | 'flag' | 'trophy', IconName>> = { title: 'crown', stamp: 'footprints', flag: 'flag', trophy: 'star' };

/** リーグの飾り（表彰台の景品）の線アイコン */
const ITEM_ICONS: Readonly<Record<LeagueIdDto, IconName>> = { kayoi: 'lantern', hajimete: 'flag', rookie: 'tree' };

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
 * 動きを減らす設定か。
 * @returns 減らす設定なら true
 */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 景品の丸い印（メダルは金・銀・銅の色札、それ以外は線アイコン）を作る。
 * @param prize 景品
 * @param leagueId リーグ（飾りのアイコンを選ぶ）
 * @returns 要素（飾り。読み上げない）
 */
function createPrizeMark(prize: RewardPrizeDto, leagueId: LeagueIdDto): HTMLElement { // audit-ignore: fnlog-missing 景品ごとに呼ぶ DOM 組立て（呼び出し側 createRewards でログ）
  if (prize.kind === 'gold' || prize.kind === 'silver' || prize.kind === 'bronze') {
    return h('span', { class: 'rk-mark', dataset: { medal: prize.kind }, attrs: { 'aria-hidden': 'true' }, text: MEDAL_GLYPH[prize.kind] });
  }
  return h('span', { class: 'rk-mark', dataset: { kind: prize.kind }, attrs: { 'aria-hidden': 'true' } }, [createIcon(prize.kind === 'item' ? ITEM_ICONS[leagueId] : PRIZE_ICONS[prize.kind])]);
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
 * 表彰台より下のリストを作る（先頭に「表彰台まで あと○回」）。
 * @param league リーグ
 * @param avatar アバターを作る関数
 * @returns 要素（4位以下がいなければ undefined）
 */
function createList(league: LeagueDto, avatar: AvatarMaker): HTMLElement | undefined {
  const log = logger.fn('createList', { leagueId: league.id });
  const rows = listEntriesOf(league.entries);
  if (rows.length === 0) return log.exit(undefined);
  const gap = league.podiumGap;
  return log.exit(
    h('div', { class: 'ranking-list-wrap' }, [
      gap === undefined || gap === 0 ? undefined : h('p', { class: 'rk-podium-line', attrs: { 'data-testid': 'podium-line' } }, [createIcon('arrowUp'), `表彰台まで あと${countLabel(gap, league.unit)}`]),
      h('ol', { class: 'ranking-list', attrs: { 'aria-label': '4位以下' } }, rows.map((e) => rankingRow(e, league, avatar))),
    ]),
  );
}

/**
 * 順位報酬の1段（メダル・順位・景品の1行）を作る。
 * @param tier 段
 * @param leagueId リーグ
 * @returns 要素
 */
function rewardTierRow(tier: RewardTierDto, leagueId: LeagueIdDto): HTMLElement { // audit-ignore: fnlog-missing 段ごとに呼ぶ DOM 組立て（呼び出し側 createRewards でログ）
  const head = tier.prizes[0];
  return h('li', { class: ['rk-row', tier.isMine ? 'rk-row--mine' : undefined], attrs: { 'data-testid': 'reward-tier' } }, [
    head === undefined ? h('span', { class: 'rk-mark' }) : createPrizeMark(head, leagueId),
    h('strong', { class: 'rk-row__rank', text: tier.label }),
    h('span', { class: 'rk-row__text', text: tierPrizeTextOf(tier) }),
    tier.isMine ? h('span', { class: 'rk-row__mine', text: 'いまココ' }) : undefined,
  ]);
}

/**
 * キープ報酬の1行（「表彰台を24時間キープ → 表彰台の旗」と状態）を作る。
 * @param keep キープ報酬
 * @param leagueId リーグ
 * @returns 要素
 */
function keepRow(keep: KeepRewardDto, leagueId: LeagueIdDto): HTMLElement { // audit-ignore: fnlog-missing キープ報酬ごとに呼ぶ DOM 組立て（呼び出し側 createRewards でログ）
  const status = keep.state === 'achieved' ? '獲得！' : keep.state === 'keeping' ? `あと${keep.remainingHours}時間` : undefined;
  return h('li', { class: ['rk-row', 'rk-row--keep'], dataset: { state: keep.state }, attrs: { 'data-testid': `keep-${keep.id}` } }, [
    createPrizeMark(keep.prize, leagueId),
    h('span', { class: 'rk-row__keep' }, [
      h('span', { class: 'rk-row__text' }, [keepGoalTextOf(keep), h('span', { class: 'rk-row__arrow', attrs: { 'aria-label': 'で' }, text: ' → ' }), h('strong', { text: keep.prize.name })]),
      keep.state === 'keeping' ? createKeepBar(keep) : undefined,
    ]),
    status === undefined ? undefined : h('span', { class: 'rk-row__status', text: status }),
  ]);
}

/**
 * 今月の報酬（順位報酬とキープ報酬）を1枚のカードにまとめる。
 * @param dto ランキング
 * @param league リーグ
 * @returns 要素（報酬が無ければ undefined）
 */
function createRewards(dto: RankingDto, league: LeagueDto): HTMLElement | undefined {
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
      h('ol', { class: 'rk-rows' }, rewards.tiers.map((t) => rewardTierRow(t, league.id))),
      h('ul', { class: ['rk-rows', 'rk-rows--keep'], attrs: { 'aria-label': 'キープ報酬' } }, rewards.keeps.map((k) => keepRow(k, league.id))),
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
   * 上部バーと本文を置き、ランキングとあなたのアバター（マイ街）を読み込んで描く。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加し、services.ranking／myTown を呼ぶ
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount');
    root.append(createTopBar({ title: 'ランキング' }), this.body);
    const [result, town] = await Promise.all([this.ctx.services.ranking.execute(), this.ctx.services.myTown.execute()]);
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (!result.ok) {
      this.body.dataset.load = 'error';
      this.body.replaceChildren(h('p', { class: 'screen-message', text: result.error.message }));
      return log.fail(undefined, result.error.code);
    }
    if (town.ok) this.myLook = avatarLookOfTown(town.value);
    else log.warn('マイ街を読めないため、あなたのアバターは星のバッジにする', { code: town.error.code });
    this.dto = result.value;
    this.lordNames = new Set(result.value.lords.flatMap((l) => (l.lordName === undefined || l.isMe ? [] : [l.lordName])));
    this.avatarKeys = new Map(result.value.leagues.flatMap((l) => l.entries.map((e): [string, string] => [e.name, e.avatarKey])));
    this.selected = result.value.recommendedLeagueId;
    this.render();
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
    this.body.dataset.league = league.id;
    this.body.replaceChildren(
      this.createTabs(dto, league.id),
      h('section', { class: 'ranking__panel', attrs: { role: 'tabpanel', 'data-testid': 'ranking-panel', 'data-league': league.id } }, [
        createStage({ dto, league, avatar, meStrip: this.createMeStrip(league), onRewards: (): void => this.scrollToRewards(), leagueIcon: leagueIconName(league.icon) }),
        createList(league, avatar),
        createRewards(dto, league),
      ]),
      ...(league.id === 'kayoi' ? [this.createLords(dto.lords)] : []),
      this.createLeagueRules(dto, league),
    );
    this.body.dataset.load = 'ready';
    log.exit(undefined);
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
   * リーグタブを作る（リーグの色・アイコン・名前・あなたの順位）。
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
          class: ['league-tab', l.id === dto.recommendedLeagueId ? 'league-tab--recommended' : undefined],
          dataset: { league: l.id },
          attrs: { type: 'button', role: 'tab', 'aria-selected': l.id === selected ? 'true' : 'false', 'data-testid': `league-tab-${l.id}` },
          on: { click: userAction(`league-tab-${l.id}`, (): void => this.select(l.id)) },
        },
        [h('span', { class: 'league-tab__name' }, [createIcon(leagueIconName(l.icon)), l.shortName]), h('span', { class: 'league-tab__rank', text: tabRankLabel(l) })],
      ),
    );
    return log.exit(h('div', { class: 'league-tabs', attrs: { role: 'tablist', 'aria-label': 'リーグ' } }, tabs));
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
