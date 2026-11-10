/**
 * @file ランク画面（presentation/screens/Rank 層。ルート '#/rank'。下部タブ「ランク」）
 * ゲームのステータス画面として、画面全体を暗いゲームの UI にし、言葉より絵と動きで見せる（2026-11-09 ユーザー指示
 * 「テキストが多すぎる・ゲーム感が薄い」「インパクトを強烈に」「40点→90点にかっこよく」）。基準 C。
 * 1. ステータスパネル（rankHero.ts）: 紋章の登場演出・3Dに傾く紋章・ランクロードを歩くアバター
 * 1.5 NEXT（rankNext.ts）: ランクアップと次の特典まで「あと○EXP」のゲージ、特典ロード（2026-11-10 ユーザー指示「可視化」）
 * 1.6 クーポン（rankCoupons.ts）: 持っているチケット（タップで QR）と、もうすぐもらえるクーポン（タップでお店へ）（2026-11-10 ユーザー指示）
 * 2. ステータス: アイコンと大きな数字のマス（画面に入ると数え上がる）
 * 3. 今月のリーグ: 3つのメダル（順位の数字・つやが走る）。タップでランキングへ
 * 4. ポイント: もらい方の3つの札と獲得ログ
 * 下のまとまりは画面に入るとせり上がって現れる。訪問はここではできない（CLAUDE.md 5 章）。ランクは下がらない（盾の印）。
 * 動きは prefers-reduced-motion: no-preference のときだけ（CSS と rankFx の両方で判定）。
 */
import '@/presentation/screens/Rank/RankScreen.css';
import type { MyTownDto, RankStatusDto, RankingDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import { createTopBar } from '@/Common/ui/TopBar';
import { userAction } from '@/Common/ui/userAction';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import { openTicketWallet } from '@/presentation/screens/Map/town/TicketWallet';
import { createCouponBody } from '@/presentation/screens/Rank/rankCoupons';
import { attachTilt, createCounterRunner, observeReveal } from '@/presentation/screens/Rank/rankFx';
import type { CounterRunner } from '@/presentation/screens/Rank/rankFx';
import { createHero } from '@/presentation/screens/Rank/rankHero';
import { centerNextPerk, createNextBody } from '@/presentation/screens/Rank/rankNext';
import { historyIconOf, historyTextOf, leagueMedalsOf, shortDateOf } from '@/presentation/screens/Rank/rankModel';
import type { LeagueMedal } from '@/presentation/screens/Rank/rankModel';
import { createAvatarImage } from '@/presentation/shared/avatarImage';
import { avatarLookOfTown } from '@/presentation/shared/avatarSprite';

const logger = createLogger('presentation/screens/Rank/RankScreen');

/** 累計ポイントを数え上げる時間（ms） */
const COUNT_UP_MS = 400;

/** 累計ポイントの数え上げを始めるまでの待ち（ms。CSS の登場の演出とそろえ、表示から 1.0 秒以内に最後の数にする） */
const COUNT_UP_DELAY_MS = 150;

/** 下のまとまりの数字を数え上げる時間（ms） */
const STAT_COUNT_MS = 400;

/** この起動の中で登場の演出を見せたか（2回目以降に開いたときは落下・数え上げを省き、光だけにする） */
let introSeen = false;

/** アバターの拡大率（1 で高さ約 70px） */
const AVATAR_SCALE = 0.8;

/** ステータスのマス1つ */
interface StatTile {
  readonly icon: IconName;
  readonly value: number;
  readonly label: string;
  /** アイコンの台座の色（CSS の data-tone） */
  readonly tone: 'brand' | 'sea' | 'silver' | 'gold' | 'leaf';
  readonly unit?: string;
}

/** 画面の描画に使うデータ一式（ランク以外は読めなければ undefined） */
interface RankData {
  readonly rank: RankStatusDto;
  readonly ranking: RankingDto | undefined;
  readonly town: MyTownDto | undefined;
}

/**
 * ランク画面を作る。
 * @param ctx 画面コンテキスト
 * @returns 画面
 */
export function createRankScreen(ctx: AppContext): Screen {
  const log = logger.fn('createRankScreen');
  const controller = new RankController(ctx);
  return log.exit({
    mount: (root: HTMLElement): Promise<void> => controller.mount(root),
    unmount: (): void => controller.unmount(),
  });
}

/**
 * アイコン付きの短い見出しを作る（右へ光の線が伸びる）。
 * @param icon アイコン
 * @param title 見出し
 * @param extra 右端に置くもの
 * @returns 要素
 */
function sectionHead(icon: IconName, title: string, extra?: HTMLElement): HTMLElement { // audit-ignore: fnlog-missing まとまりごとに呼ぶ DOM 組立て（呼び出し側 render でログ）
  return h('div', { class: 'rank-head' }, [
    h('span', { class: 'rank-head__icon', attrs: { 'aria-hidden': 'true' } }, [createIcon(icon)]),
    h('h2', { class: 'rank-head__title', text: title }),
    extra,
  ]);
}

/**
 * ステータスのマスの並びを決める。
 * @param dto ランク
 * @returns マス
 */
function statTilesOf(dto: RankStatusDto): StatTile[] {
  const log = logger.fn('statTilesOf', { visits: dto.totalVisits });
  return log.exit([
    { icon: 'footprints', value: dto.totalVisits, label: '通った', tone: 'brand', unit: '回' },
    { icon: 'pin', value: dto.visitedSpots, label: 'スポット', tone: 'sea' },
    { icon: 'crown', value: dto.lordDistricts.length, label: '領主', tone: 'gold' },
    { icon: 'card', value: dto.silverCards, label: '銀カード', tone: 'silver', unit: '枚' },
    { icon: 'card', value: dto.goldCards, label: '金カード', tone: 'gold', unit: '枚' },
    { icon: 'calendar', value: dto.travelDays ?? 0, label: '旅の日数', tone: 'leaf', unit: dto.travelDays === undefined ? '日' : '日目' },
  ]);
}

/**
 * ステータス（アイコンと大きな数字のマス＋主の地区の札）を作る。数字は data-count を持ち、画面に入ると数え上がる。
 * @param dto ランク
 * @returns 要素
 */
function createStats(dto: RankStatusDto): HTMLElement {
  const log = logger.fn('createStats', { lords: dto.lordDistricts.length });
  const tiles = statTilesOf(dto).map((t, i) =>
    h('li', { class: 'rank-stat', dataset: { tone: t.tone }, style: { '--i': String(i) }, attrs: { 'aria-label': `${t.label} ${t.value}${t.unit ?? ''}` } }, [
      h('span', { class: 'rank-stat__icon', attrs: { 'aria-hidden': 'true' } }, [createIcon(t.icon)]),
      h('strong', { class: 'rank-stat__value', attrs: { 'aria-hidden': 'true' } }, [h('span', { dataset: { count: t.value }, text: String(t.value) }), t.unit === undefined ? undefined : h('small', { text: t.unit })]),
      h('span', { class: 'rank-stat__label', attrs: { 'aria-hidden': 'true' }, text: t.label }),
    ]),
  );
  const lords = dto.lordDistricts.map((name) => h('span', { class: 'rank-lord' }, [createIcon('crown'), name]));
  return log.exit(
    h('section', { class: ['rank-card', 'rank-reveal'], attrs: { 'data-testid': 'rank-stats' } }, [
      sectionHead('sparkle', 'ステータス'),
      h('ul', { class: 'rank-stats' }, tiles),
      lords.length === 0 ? undefined : h('p', { class: 'rank-lords' }, lords),
    ]),
  );
}

/**
 * リーグのメダル1つを作る。
 * @param medal メダル
 * @param index 並びの番号（現れる順・つやの時間差）
 * @param onOpen タップ時の処理
 * @returns 要素
 */
function medalButton(medal: LeagueMedal, index: number, onOpen: () => void): HTMLElement { // audit-ignore: fnlog-missing リーグごとに呼ぶ DOM 組立て（呼び出し側 createLeagues でログ）
  const disk =
    medal.rank === undefined
      ? h('span', { class: 'rank-medal__disk' }, [h('small', { text: '見学' })])
      : h('span', { class: 'rank-medal__disk' }, [h('strong', { text: String(medal.rank) }), h('small', { text: '位' })]);
  const label = medal.rank === undefined ? `${medal.shortName}リーグは見学中` : `${medal.shortName}リーグ ${medal.rank}位`;
  return h('li', {}, [
    h(
      'button',
      { class: 'rank-medal', dataset: { medal: medal.medal }, style: { '--i': String(index) }, attrs: { type: 'button', 'data-testid': 'rank-league', 'data-league': medal.id, 'aria-label': `${label}（今月${medal.countText}）` }, on: { click: onOpen } },
      [h('span', { class: 'rank-medal__ribbon', attrs: { 'aria-hidden': 'true' } }), disk, h('span', { class: 'rank-medal__name', text: medal.shortName }), h('span', { class: 'rank-medal__count', text: medal.countText })],
    ),
  ]);
}

/**
 * 今月のリーグのまとまり（見出し＋中身）を作る。
 * @param head 見出し
 * @param body 中身（メダル、または読めなかった案内）
 * @returns 要素
 */
function leagueSection(head: HTMLElement, body: HTMLElement): HTMLElement { // audit-ignore: fnlog-missing まとまりを包むだけの DOM 組立て（呼び出し側 createLeagues でログ）
  return h('section', { class: ['rank-card', 'rank-reveal'], attrs: { 'data-testid': 'rank-leagues' } }, [head, body]);
}

/**
 * ポイントのもらい方の札（名所・お店・おかえり・お買い物）を作る。
 * @param dto ランク
 * @returns 要素
 */
function createRuleTokens(dto: RankStatusDto): HTMLElement {
  const log = logger.fn('createRuleTokens');
  const { rules } = dto;
  const tokens: readonly (readonly [IconName, string, string])[] = [
    ['star', `+${rules.landmarkPoints}`, '名所'],
    ['shop', `+${rules.shopPoints}`, 'お店'],
    ['sparkle', `×${rules.welcomeBackMultiplier}`, 'おかえり'],
    ...(rules.purchasePoints === undefined ? [] : [['coin', `+${rules.purchasePoints}`, 'お買い物'] as const]),
  ];
  const purchaseText = rules.purchasePoints === undefined ? '' : `、お店でお買い物すると${rules.purchasePoints}EXP`;
  return log.exit(
    h(
      'ul',
      { class: 'rank-rules', style: { '--n': String(tokens.length) }, attrs: { 'aria-label': `名所${rules.landmarkPoints}EXP、お店${rules.shopPoints}EXP、色あせた地区に戻るとその日${rules.welcomeBackMultiplier}倍${purchaseText}` } },
      tokens.map(([icon, value, label], i) =>
        h('li', { class: 'rank-rule', style: { '--i': String(i) }, attrs: { 'aria-hidden': 'true' } }, [h('span', { class: 'rank-rule__icon' }, [createIcon(icon)]), h('strong', { class: 'rank-rule__value', text: value }), h('span', { class: 'rank-rule__label', text: label })]),
      ),
    ),
  );
}

/**
 * ポイント（もらい方の札＋獲得ログ）を作る。
 * @param dto ランク
 * @returns 要素
 */
function createPoints(dto: RankStatusDto): HTMLElement {
  const log = logger.fn('createPoints', { rows: dto.recent.length });
  const rows = dto.recent.map((entry, i) =>
    h('li', { class: 'rank-log__row', dataset: { kind: entry.kind }, style: { '--i': String(i) } }, [
      h('span', { class: 'rank-log__icon', attrs: { 'aria-hidden': 'true' } }, [createIcon(historyIconOf(entry))]),
      h('span', { class: 'rank-log__spot', text: historyTextOf(entry) }),
      h('span', { class: 'rank-log__date', text: shortDateOf(entry.date) }),
      h('strong', { class: 'rank-log__points', text: `+${entry.points}` }),
    ]),
  );
  const list = rows.length === 0 ? h('p', { class: 'rank-log__empty' }, [createIcon('footprints'), '0 EXP']) : h('ol', { class: 'rank-log', attrs: { 'aria-label': '最近のEXP' } }, rows);
  return log.exit(h('section', { class: ['rank-card', 'rank-reveal'], attrs: { 'data-testid': 'rank-points-log' } }, [sectionHead('coin', 'EXP'), createRuleTokens(dto), list]));
}

/**
 * NEXT（ランクアップと次の特典までのゲージ・特典ロード）を作る。
 * @param dto ランク
 * @param base いまの装い（特典の絵に使う）
 * @returns 要素
 */
function createNext(dto: RankStatusDto, base: readonly string[]): HTMLElement {
  const log = logger.fn('createNext', { points: dto.points });
  return log.exit(h('section', { class: ['rank-card', 'rank-reveal', 'rank-next'], attrs: { 'data-testid': 'rank-next-goals' } }, [sectionHead('flag', 'NEXT'), ...createNextBody(dto, base)]));
}

/** ランク画面の読込・描画・動きを受け持つ */
class RankController {
  private readonly ctx: AppContext;
  private readonly body: HTMLElement;
  private readonly counters: CounterRunner = createCounterRunner(COUNT_UP_MS);
  private readonly statCounters: CounterRunner = createCounterRunner(STAT_COUNT_MS);
  /** 片付け（傾き・出現の見張り）の関数 */
  private cleanups: (() => void)[] = [];
  /** 画面を離れた（以降の非同期結果は捨てる） */
  private disposed = false;
  /** 画面のルート（チケットの入れ物を重ねる先） */
  private root: HTMLElement | undefined;
  /** クーポンのカード（チケットを使ったら中身を差し替える） */
  private couponCard: HTMLElement | undefined;
  /** 開いているチケットの入れ物を閉じる関数 */
  private walletClose: (() => void) | undefined;

  /**
   * 骨組みを作る。
   * @param ctx 画面コンテキスト
   */
  constructor(ctx: AppContext) {
    const log = logger.fn('constructor');
    this.ctx = ctx;
    this.body = h('div', { class: ['screen-scroll', 'rank'], attrs: { 'data-testid': 'rank', 'data-load': 'loading' } });
    log.exit(undefined);
  }

  /**
   * 上部バーと本文を置き、ランク・ランキング・マイ街（アバターの装い）を読み込んで描く。
   * ランクが読めなければ案内だけを出す。ほかが読めなくてもランクは出す（アバターは人のアイコンに）。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加し、services.rankStatus・ranking・myTown を呼ぶ
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount');
    this.root = root;
    root.append(createTopBar({ title: 'ランク' }), this.body);
    const s = this.ctx.services;
    const [rank, ranking, town] = await Promise.all([s.rankStatus.execute(), s.ranking.execute(), s.myTown.execute()]);
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (!rank.ok) {
      this.body.dataset.load = 'error';
      this.body.replaceChildren(h('p', { class: 'screen-message', text: rank.error.message }));
      return log.fail(undefined, rank.error.code);
    }
    for (const [name, r] of [['ranking', ranking], ['myTown', town]] as const) if (!r.ok) log.warn('読めませんでした', { name, code: r.error.code });
    this.render({ rank: rank.value, ranking: ranking.ok ? ranking.value : undefined, town: town.ok ? town.value : undefined });
    log.exit(undefined);
  }

  /**
   * 後始末する（数え上げ・傾き・出現の見張りを止め、以降の非同期結果を捨てる）。
   * @sideEffect requestAnimationFrame を取り消し、イベントと IntersectionObserver を外す
   */
  unmount(): void {
    const log = logger.fn('unmount', { cleanups: this.cleanups.length });
    this.disposed = true;
    this.counters.stop();
    this.statCounters.stop();
    this.walletClose?.();
    this.walletClose = undefined;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    log.exit(undefined);
  }

  /**
   * 本文を描き、数え上げ・傾き・出現の見張りを始める。
   * @param data 画面のデータ
   * @sideEffect 本文の中身を差し替える
   */
  private render(data: RankData): void {
    const log = logger.fn('render', { hasRanking: data.ranking !== undefined, hasTown: data.town !== undefined });
    const avatar = data.town === undefined ? undefined : createAvatarImage(avatarLookOfTown(data.town), AVATAR_SCALE);
    avatar?.classList.add('rank-road__avatar');
    const hero = createHero(data.rank, avatar, userAction('rank-skip-intro', (): void => this.skipIntro(hero.element)));
    const next = createNext(data.rank, data.town?.avatarPartIds ?? []);
    const coupons = this.createCoupons(data.rank);
    const cards = [next, ...(coupons === undefined ? [] : [coupons]), createStats(data.rank), this.createLeagues(data.ranking), createPoints(data.rank)];
    this.body.replaceChildren(hero.element, ...cards);
    centerNextPerk(next);
    this.body.dataset.load = 'ready';
    const quick = introSeen;
    introSeen = true;
    if (quick) hero.element.classList.add('is-skip', 'is-quick');
    else this.counters.count(hero.points, data.rank.points, COUNT_UP_DELAY_MS, () => hero.points.classList.add('rank-hero__num--done'));
    this.cleanups.push(
      attachTilt(hero.element, hero.tilt),
      observeReveal(cards, (card) => {
        if (quick) return;
        card.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => this.statCounters.count(el, Number(el.dataset.count ?? '0')));
      }),
    );
    log.exit(undefined);
  }

  /**
   * クーポン（持っている・もうすぐ）のカードを作る。持っているチケットはタップで QR、もうすぐのクーポンはタップでお店の詳細へ。
   * @param dto ランク
   * @returns 要素（クーポンの情報が無ければ undefined）
   */
  private createCoupons(dto: RankStatusDto): HTMLElement | undefined {
    const log = logger.fn('createCoupons', { held: dto.coupons?.held.length, upcoming: dto.coupons?.upcoming.length });
    if (dto.coupons === undefined) return log.exit(undefined, 'クーポンの情報なし');
    const card = h('section', { class: ['rank-card', 'rank-reveal', 'rank-coupons'], attrs: { 'data-testid': 'rank-coupons' } }, this.couponChildren(dto));
    this.couponCard = card;
    return log.exit(card);
  }

  /**
   * クーポンのカードの中身（見出し＋持っている＋もうすぐ）を作る。
   * @param dto ランク（coupons があること）
   * @returns 子要素
   */
  private couponChildren(dto: RankStatusDto): HTMLElement[] {
    const log = logger.fn('couponChildren');
    if (dto.coupons === undefined) return log.exit([]);
    return log.exit([
      sectionHead('ticket', 'クーポン'),
      ...createCouponBody(dto.coupons, {
        onOpenTicket: (ticketId): void => this.openTicket(ticketId),
        onOpenSpot: (spotId): void => this.ctx.router.navigate(`#/spot/${spotId}`),
      }),
    ]);
  }

  /**
   * チケットの入れ物（地図と同じ）を画面の上に開き、すぐそのチケットの QR を見せる。
   * @param ticketId チケット
   * @sideEffect 画面に入れ物を重ねる
   */
  private openTicket(ticketId: string): void {
    const log = logger.fn('openTicket', { ticketId });
    if (this.root === undefined) return log.exit(undefined, '準備中');
    this.walletClose?.();
    this.walletClose = openTicketWallet(this.root, this.ctx, { focusTicketId: ticketId, onChanged: (): void => void this.refreshCoupons() });
    log.exit(undefined);
  }

  /**
   * チケットを使ったあと、クーポンのカードを読み直して差し替える。
   * @sideEffect services.rankStatus を呼び、クーポンのカードの中身を差し替える
   */
  private async refreshCoupons(): Promise<void> {
    const log = logger.fn('refreshCoupons');
    const rank = await this.ctx.services.rankStatus.execute();
    if (this.disposed || this.couponCard === undefined) return log.exit(undefined, '画面を離れた');
    if (!rank.ok) return log.fail(undefined, rank.error.code);
    this.couponCard.replaceChildren(...this.couponChildren(rank.value));
    log.exit(undefined);
  }

  /**
   * 登場の演出を飛ばす（盤のタップ。CLAUDE.md 6.8「スキップ可」）。演出を最後の姿にし、数え上げを最終の数にする。
   * @param hero ステータスパネル
   * @sideEffect hero に is-skip を付ける
   */
  private skipIntro(hero: HTMLElement): void {
    const log = logger.fn('skipIntro', { skipped: hero.classList.contains('is-skip') });
    if (hero.classList.contains('is-skip')) return log.exit(undefined, '飛ばし済み');
    hero.classList.add('is-skip');
    this.counters.finish();
    log.exit(undefined);
  }

  /**
   * 今月のリーグ（3つのメダル）を作る。タップでランキングへ。
   * @param ranking ランキング（読めなければ undefined）
   * @returns 要素
   */
  private createLeagues(ranking: RankingDto | undefined): HTMLElement {
    const log = logger.fn('createLeagues', { loaded: ranking !== undefined });
    const countdown = ranking === undefined ? undefined : h('span', { class: 'rank-head__pill' }, [createIcon('flag'), `あと${ranking.daysLeft}日`]);
    const head = sectionHead('crown', ranking === undefined ? '今月のリーグ' : `${ranking.monthLabel}のリーグ`, countdown);
    if (ranking === undefined) return log.exit(leagueSection(head, h('p', { class: 'rank-log__empty', text: '読み込めませんでした' })));
    const open = userAction('rank-open-ranking', (): void => this.ctx.router.navigate('#/ranking'));
    return log.exit(leagueSection(head, h('ul', { class: 'rank-medals' }, leagueMedalsOf(ranking).map((m, i) => medalButton(m, i, open)))));
  }
}
