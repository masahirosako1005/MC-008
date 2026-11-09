/**
 * @file ランキング画面（presentation/screens/Ranking 層。ルート '#/ranking'）
 * 月間3リーグ（かよい／はじめまして／ルーキー）をタブで切り替え、表彰台（上位3名）＋リストを出す（CLAUDE.md 4.6・6.7、wireframes/07_ranking）。
 * 「競いたくなる」ための見せ方:
 * - 決着までのカウントダウンと、月末に表彰台の3名へメダル（金・銀・銅。色は 08 演出の金・銀カードとそろえる）
 * - あなたのバトルカード: 大きな順位、昨日からの順位変化（上がったら数字が入れ替わる演出）、すぐ上のライバルまでのゲージ、すぐ後ろの迫り具合
 * - 表彰台の王冠・せり上がり、リストの「表彰台ライン」と「ねらい目／追ってくる」札
 * 初めての人でも活躍できるよう、最初に開くタブは「あなたが一番上位のリーグ」。かよいリーグでは下段に地区の主を出す。基準 C。
 * 動きは prefers-reduced-motion: no-preference のときだけ（CSS 側と、順位の入れ替え演出の両方で判定）。
 */
import '@/presentation/screens/Ranking/RankingScreen.css';
import type { LeagueDto, LeagueIdDto, RankingDto, RankingEntryDto, RankingLordDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { createReasonTag } from '@/Common/ui/cards/RevisitReasonCard';
import { h, setStyle } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import { createTopBar } from '@/Common/ui/TopBar';
import { userAction } from '@/Common/ui/userAction';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import {
  chaserTextOf,
  countLabel,
  gaugePercentOf,
  listEntriesOf,
  lordGoalText,
  myEntryOf,
  podiumSlotsOf,
  rankChangeOf,
  rivalMarkOf,
  tabRankLabel,
} from '@/presentation/screens/Ranking/rankingModel';
import type { PodiumSlot, RankChange } from '@/presentation/screens/Ranking/rankingModel';

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

/** 順位が上がったとき、昨日の順位を見せてから今日の順位に入れ替えるまでの時間（ms） */
const RANK_SWAP_DELAY_MS = 700;

/** 表彰台の順位ごとのメダル名 */
const MEDAL_LABEL: Readonly<Record<PodiumSlot['place'], string>> = { first: '金', second: '銀', third: '銅' };

/** 紙吹雪の粒の数（自分が表彰台・順位アップのとき） */
const CONFETTI_COUNT = 14;

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
 * 「主：地区」タグを作る。
 * @param districts 地区の短い名前
 * @returns タグ要素の配列
 */
function lordTags(districts: readonly string[]): HTMLElement[] {
  return districts.map((d) => h('span', { class: ['tag', 'tag--accent', 'ranking__lord-tag'], text: `主：${d}` }));
}

/**
 * 紙吹雪（飾り。読み上げない）を作る。
 * @returns 要素
 */
function createConfetti(): HTMLElement {
  const log = logger.fn('createConfetti');
  const pieces = Array.from({ length: CONFETTI_COUNT }, (_, i) =>
    h('span', { class: 'confetti__piece', style: { '--i': String(i), '--x': `${((i * 37) % 100) - 50}`, '--r': `${(i * 53) % 360}deg` } }),
  );
  return log.exit(h('span', { class: 'confetti', attrs: { 'aria-hidden': 'true' } }, pieces));
}

/**
 * 決着までのカウントダウン帯を作る。
 * @param dto ランキング
 * @returns 要素
 */
function createFinaleBanner(dto: RankingDto): HTMLElement {
  const log = logger.fn('createFinaleBanner', { daysLeft: dto.daysLeft });
  return log.exit(
    h('div', { class: 'finale', attrs: { 'data-testid': 'ranking-finale' } }, [
      h('span', { class: 'finale__flag', attrs: { 'aria-hidden': 'true' } }, [createIcon('flag')]),
      h('span', { class: 'finale__text' }, [`${dto.monthLabel}の決着まで `, h('strong', { class: 'finale__days', text: `あと${dto.daysLeft}日` })]),
      h('span', { class: 'finale__prize', text: '表彰台の3名にメダル' }),
    ]),
  );
}

/**
 * 順位変化のバッジを作る。
 * @param change 変化
 * @returns 要素（変化が無い・昨日の順位が無いときは undefined）
 */
function createChangeBadge(change: RankChange): HTMLElement | undefined {
  const log = logger.fn('createChangeBadge', { kind: change.kind, diff: change.diff });
  if (change.kind === 'none') return log.exit(undefined);
  const text = change.kind === 'up' ? `▲${change.diff} 順位アップ！` : change.kind === 'down' ? `▼${change.diff}` : '昨日と同じ';
  return log.exit(h('span', { class: 'battle__change', dataset: { kind: change.kind }, attrs: { 'data-testid': 'ranking-change' }, text }));
}

/**
 * すぐ上のライバルまでのゲージ部分を作る。
 * @param league リーグ
 * @returns 要素
 */
function createGauge(league: LeagueDto): HTMLElement {
  const log = logger.fn('createGauge', { leagueId: league.id });
  const above = league.rivalAbove;
  const label =
    above === undefined
      ? h('span', { class: 'battle__target' }, [h('strong', { text: '1位を独走中！' }), ' このまま逃げ切ろう'])
      : h('span', { class: 'battle__target' }, [
          `${above.rank}位 ${above.name}（${countLabel(above.count, league.unit)}）まで `,
          h('strong', { class: 'battle__gap', text: `あと${countLabel(above.gap, league.unit)}` }),
        ]);
  const fill = h('span', { class: 'gauge__fill' });
  setStyle(fill, '--gauge', `${gaugePercentOf(league)}%`);
  return log.exit(
    h('div', { class: 'battle__gauge-wrap' }, [
      label,
      h('span', { class: 'gauge', attrs: { role: 'img', 'aria-label': above === undefined ? '1位' : `${above.name}までの進み具合 ${gaugePercentOf(league)}%` } }, [fill]),
    ]),
  );
}

/**
 * 表彰台の1枠を作る。
 * @param slot 枠
 * @param unit 単位
 * @returns 要素
 */
function podiumSlot(slot: PodiumSlot, unit: string): HTMLElement { // audit-ignore: fnlog-missing 表彰台の3枠ぶん呼ぶ DOM 組立て（呼び出し側 createPodium でログ）
  const { entry } = slot;
  return h('li', { class: ['podium__slot', entry.isMe ? 'podium__slot--me' : undefined], dataset: { place: slot.place, lordDistrict: entry.lordOf[0] }, attrs: { 'data-testid': 'podium-slot' } }, [
    slot.place === 'first' ? h('span', { class: 'podium__crown', attrs: { 'aria-hidden': 'true' } }, [createIcon('crown')]) : undefined,
    entry.isMe ? h('span', { class: 'podium__you', text: 'YOU' }) : undefined,
    entry.isMe
      ? h('span', { class: 'podium__face', attrs: { 'aria-hidden': 'true' } }, [createIcon('star')])
      : h('span', { class: 'podium__face', attrs: { 'aria-hidden': 'true' }, text: entry.name.replace(/^旅人/, '').slice(0, 1) }),
    h('span', { class: 'podium__name', text: entry.name }),
    h('span', { class: 'podium__count', text: countLabel(entry.count, unit) }),
    ...lordTags(entry.lordOf),
    h('span', { class: 'podium__block', attrs: { 'aria-label': `${entry.rank}位・${MEDAL_LABEL[slot.place]}メダル` } }, [
      h('span', { class: 'podium__medal', attrs: { 'aria-hidden': 'true' }, text: MEDAL_LABEL[slot.place] }),
      h('span', { class: 'podium__rank', attrs: { 'aria-hidden': 'true' }, text: String(entry.rank) }),
    ]),
  ]);
}

/**
 * 表彰台を作る（あなたが乗っていれば紙吹雪）。
 * @param league リーグ
 * @returns 要素
 */
function createPodium(league: LeagueDto): HTMLElement {
  const log = logger.fn('createPodium', { leagueId: league.id });
  const slots = podiumSlotsOf(league.entries);
  const meOnPodium = slots.some((s) => s.entry.isMe);
  return log.exit(
    h('div', { class: 'podium-stage' }, [
      meOnPodium ? createConfetti() : undefined,
      h('ol', { class: 'podium', attrs: { 'aria-label': '表彰台（上位3名）', 'data-testid': 'podium' } }, slots.map((slot) => podiumSlot(slot, league.unit))),
    ]),
  );
}

/**
 * リストの1行を作る。
 * @param entry 行
 * @param league リーグ
 * @returns 要素
 */
function rankingRow(entry: RankingEntryDto, league: LeagueDto): HTMLElement { // audit-ignore: fnlog-missing リストの行ごとに呼ぶ DOM 組立て（呼び出し側 render でログ）
  const mark = rivalMarkOf(entry, league);
  return h(
    'li',
    { class: ['ranking-row', entry.isMe ? 'ranking-row--me' : undefined], dataset: { mark }, attrs: { 'data-testid': entry.isMe ? 'ranking-row-me' : 'ranking-row' } },
    [
      h('span', { class: 'ranking-row__rank', text: String(entry.rank) }),
      h('span', { class: 'ranking-row__name', text: entry.name }),
      mark === 'target' ? h('span', { class: ['tag', 'ranking-row__mark'], text: 'ねらい目' }) : undefined,
      mark === 'chaser' ? h('span', { class: ['tag', 'ranking-row__mark'], text: '追ってくる' }) : undefined,
      ...lordTags(entry.lordOf),
      h('span', { class: 'ranking-row__count', text: countLabel(entry.count, league.unit) }),
    ],
  );
}

/**
 * 表彰台より下のリストを作る（先頭に「表彰台ライン」とあと何回で乗れるか）。
 * @param league リーグ
 * @returns 要素（4位以下がいなければ undefined）
 */
function createList(league: LeagueDto): HTMLElement | undefined {
  const log = logger.fn('createList', { leagueId: league.id });
  const rows = listEntriesOf(league.entries);
  if (rows.length === 0) return log.exit(undefined);
  const gap = league.podiumGap;
  const lineText = gap === undefined ? '表彰台ライン' : gap === 0 ? '表彰台ライン ── あなたは表彰台！' : `表彰台ライン ── あと${countLabel(gap, league.unit)}で乗れる`;
  return log.exit(
    h('div', { class: 'ranking-list-wrap' }, [
      h('p', { class: 'podium-line', attrs: { 'data-testid': 'podium-line' } }, [h('span', { class: 'podium-line__icon', attrs: { 'aria-hidden': 'true' } }, [createIcon('arrowUp')]), lineText]),
      h('ol', { class: 'ranking-list', attrs: { 'aria-label': '4位以下' } }, rows.map((e) => rankingRow(e, league))),
    ]),
  );
}

/**
 * 地区の主カードを作る（タップで地区ズームの地図へ）。
 * @param lord 地区の主の状況
 * @param onOpen タップ時の処理
 * @returns 要素
 */
function createLordCard(lord: RankingLordDto, onOpen: () => void): HTMLElement {
  const log = logger.fn('createLordCard', { districtId: lord.districtId });
  const card = h(
    'button',
    { class: ['card', 'lord-card', lord.isMe ? 'lord-card--me' : undefined], attrs: { type: 'button', 'data-testid': 'ranking-lord-card' }, on: { click: userAction('ranking-lord', onOpen) } },
    [
      h('span', { class: 'lord-card__crown', attrs: { 'aria-hidden': 'true' } }, [createIcon('crown')]),
      h('span', { class: 'lord-card__body' }, [
        h('span', { class: 'lord-card__title' }, [
          h('strong', { text: lord.districtName }),
          ` 主：${lord.lordName ?? 'なし'}`,
          lord.lordName === undefined || lord.isMe ? '' : `（${lord.lordCount}回）`,
        ]),
        h('span', { class: 'lord-card__sub', text: lordGoalText(lord) }),
      ]),
      lord.lost ? createReasonTag('reclaim', 'small') : undefined,
      h('span', { class: 'card-chevron', attrs: { 'aria-hidden': 'true' } }, [createIcon('chevronRight')]),
    ],
  );
  return log.exit(card);
}

/** ランキング画面の読込・描画・タブ切替を受け持つ */
class RankingController {
  private readonly ctx: AppContext;
  private readonly body: HTMLElement;
  private dto: RankingDto | undefined;
  private selected: LeagueIdDto = 'kayoi';
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
   * 上部バーと本文を置き、ランキングを読み込んで描く。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加し、services.ranking を呼ぶ
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount');
    root.append(createTopBar({ title: 'ランキング' }), this.body);
    const result = await this.ctx.services.ranking.execute();
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (!result.ok) {
      this.body.dataset.load = 'error';
      this.body.replaceChildren(h('p', { class: 'screen-message', text: result.error.message }));
      return log.fail(undefined, result.error.code);
    }
    this.dto = result.value;
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
   * 本文を描く（決着帯 → リーグタブ → 説明 → バトルカード → 表彰台 → リスト → 地区の主）。
   * @sideEffect 本文の中身を差し替え、順位アップなら入れ替え演出を始める
   */
  private render(): void {
    const dto = this.dto;
    const log = logger.fn('render', { selected: this.selected });
    if (dto === undefined) return log.exit(undefined, '未読込');
    const league = dto.leagues.find((l) => l.id === this.selected) ?? dto.leagues[0];
    if (league === undefined) return log.exit(undefined, 'リーグなし');
    this.clearSwapTimer();
    this.body.replaceChildren(
      createFinaleBanner(dto),
      this.createTabs(dto, league.id),
      h('section', { class: 'ranking__panel', attrs: { role: 'tabpanel', 'data-testid': 'ranking-panel', 'data-league': league.id } }, [
        h('p', { class: 'ranking__tagline' }, [h('span', { class: 'ranking__icon', attrs: { 'aria-hidden': 'true' } }, [createIcon(leagueIconName(league.icon))]), league.tagline]),
        this.createBattleCard(league),
        createPodium(league),
        createList(league),
        h('p', { class: 'hint ranking__rule', text: `${league.rule}。ポイントは順位に関係ありません` }),
      ]),
      ...(league.id === 'kayoi' ? [this.createLords(dto.lords)] : []),
    );
    this.body.dataset.load = 'ready';
    log.exit(undefined);
  }

  /**
   * あなたのバトルカード（順位・昨日からの変化・ライバルまでのゲージ・次の一歩・出発ボタン）を作る。
   * 順位が上がっていれば、昨日の順位を出してから今日の順位へ入れ替える（動きを減らす設定なら最初から今日の順位）。
   * @param league リーグ
   * @returns 要素
   * @sideEffect 順位アップのとき入れ替えのタイマーを登録する
   */
  private createBattleCard(league: LeagueDto): HTMLElement {
    const log = logger.fn('createBattleCard', { leagueId: league.id, joined: league.joined });
    const me = myEntryOf(league);
    if (me === undefined) {
      return log.exit(
        h('section', { class: ['battle', 'battle--guest'], attrs: { 'data-testid': 'ranking-my-card' } }, [
          h('p', { class: 'battle__guest-title', text: 'このリーグは見学中' }),
          h('p', { class: 'battle__next', text: league.nextStepText }),
          league.membershipNote === undefined ? undefined : h('p', { class: 'battle__note', text: league.membershipNote }),
        ]),
      );
    }
    const change = rankChangeOf(league);
    const animate = change.kind === 'up' && !prefersReducedMotion();
    const rankNumber = h('span', { class: 'battle__rank-num', attrs: { 'data-testid': 'ranking-my-rank' }, text: String(animate ? (league.myRankYesterday ?? me.rank) : me.rank) });
    const chaser = chaserTextOf(league);
    const card = h('section', { class: ['battle', change.kind === 'up' ? 'battle--up' : undefined, me.rank <= 3 ? 'battle--podium' : undefined], attrs: { 'data-testid': 'ranking-my-card' } }, [
      change.kind === 'up' ? createConfetti() : undefined,
      h('div', { class: 'battle__head' }, [h('span', { class: 'battle__league' }, [createIcon(leagueIconName(league.icon)), league.name]), createChangeBadge(change)]),
      h('div', { class: 'battle__main' }, [
        h('p', { class: 'battle__rank', attrs: { 'aria-label': `あなたは${me.rank}位` } }, [rankNumber, h('span', { class: 'battle__rank-unit', text: '位' })]),
        h('p', { class: 'battle__count' }, [h('strong', { text: String(me.count) }), league.unit, h('small', { text: '今月' })]),
      ]),
      createGauge(league),
      h('p', { class: 'battle__next', text: league.nextStepText }),
      chaser === undefined ? undefined : h('p', { class: ['battle__chaser', league.rivalBelow?.gap !== undefined && league.rivalBelow.gap <= 1 ? 'battle__chaser--hot' : undefined], text: chaser }),
      league.membershipNote === undefined ? undefined : h('p', { class: 'battle__note', text: league.membershipNote }),
      createButton({ label: '順位を上げに出かける', variant: 'primary', testId: 'ranking-go-map', onClick: (): void => this.ctx.router.navigate('#/map') }),
    ]);
    if (animate) {
      this.swapTimer = setTimeout(() => {
        this.swapTimer = undefined;
        rankNumber.textContent = String(me.rank);
        rankNumber.classList.add('battle__rank-num--pop');
      }, RANK_SWAP_DELAY_MS);
    }
    return log.exit(card);
  }

  /**
   * リーグタブを作る（各タブにあなたの順位を添える）。
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
          attrs: { type: 'button', role: 'tab', 'aria-selected': l.id === selected ? 'true' : 'false', 'data-testid': `league-tab-${l.id}` },
          on: { click: userAction(`league-tab-${l.id}`, (): void => this.select(l.id)) },
        },
        [
          h('span', { class: 'league-tab__name' }, [createIcon(leagueIconName(l.icon)), l.shortName]),
          h('span', { class: 'league-tab__rank', text: tabRankLabel(l) }),
        ],
      ),
    );
    return log.exit(h('div', { class: 'league-tabs', attrs: { role: 'tablist', 'aria-label': 'リーグ' } }, tabs));
  }

  /**
   * 地区の主の一覧を作る。
   * @param lords 地区ごとの状況
   * @returns 要素
   */
  private createLords(lords: readonly RankingLordDto[]): HTMLElement {
    const log = logger.fn('createLords', { lords: lords.length });
    return log.exit(
      h('section', { class: 'ranking__lords', attrs: { 'data-testid': 'ranking-lords' } }, [
        h('h3', { class: 'sheet-section-title', text: '地区の主（直近30日）── 王座を奪え' }),
        ...lords.map((lord) => createLordCard(lord, (): void => this.ctx.router.navigate(`#/map/${lord.districtId}`))),
      ]),
    );
  }
}
