/**
 * @file ランク画面（presentation/screens/Rank 層。ルート '#/rank'。下部タブ「ランク」）
 * ゲームのステータス画面として、画面全体を暗いゲームの UI にし、言葉より絵と動きで見せる（2026-11-09 ユーザー指示
 * 「テキストが多すぎる・ゲーム感が薄い」「インパクトを強烈に」「40点→90点にかっこよく」）。基準 C。
 * 1. ステータスパネル（rankHero.ts）: 紋章の登場演出・3Dに傾く紋章・ランクロードを歩くアバター
 * 2. ステータス: アイコンと大きな数字のマス（画面に入ると数え上がる）
 * 3. 今月のリーグ: 3つのメダル（順位の数字・つやが走る）。タップでランキングへ
 * 4. ポイント: もらい方の3つの札と獲得ログ
 * 5. 設定: アイコンと短い値のマス。歯車で設定画面へ（変更は設定画面で行う）
 * 下のまとまりは画面に入るとせり上がって現れる。訪問はここではできない（CLAUDE.md 5 章）。ランクは下がらない（盾の印）。
 * 動きは prefers-reduced-motion: no-preference のときだけ（CSS と rankFx の両方で判定）。
 */
import '@/presentation/screens/Rank/RankScreen.css';
import type { AppStatusDto, MyTownDto, RankStatusDto, RankingDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { currentTextScale } from '@/Common/ui/a11y/textScale';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import { createTopBar } from '@/Common/ui/TopBar';
import { userAction } from '@/Common/ui/userAction';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import { attachTilt, createCounterRunner, observeReveal } from '@/presentation/screens/Rank/rankFx';
import type { CounterRunner } from '@/presentation/screens/Rank/rankFx';
import { createHero } from '@/presentation/screens/Rank/rankHero';
import { historyIconOf, leagueMedalsOf, settingTilesOf, shortDateOf } from '@/presentation/screens/Rank/rankModel';
import type { LeagueMedal, SettingTile } from '@/presentation/screens/Rank/rankModel';
import { createAvatarImage } from '@/presentation/shared/avatarImage';
import { avatarLookOfTown } from '@/presentation/shared/avatarSprite';

const logger = createLogger('presentation/screens/Rank/RankScreen');

/** 累計ポイントを数え上げる時間（ms） */
const COUNT_UP_MS = 900;

/** 累計ポイントの数え上げを始めるまでの待ち（ms。紋章が落ちて名前が押されたあと＝CSS の演出の時間とそろえる） */
const COUNT_UP_DELAY_MS = 850;

/** 下のまとまりの数字を数え上げる時間（ms） */
const STAT_COUNT_MS = 700;

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
  readonly status: AppStatusDto | undefined;
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
    { icon: 'crown', value: dto.lordDistricts.length, label: '地区の主', tone: 'gold' },
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
 * ポイントのもらい方の札3つを作る。
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
  ];
  return log.exit(
    h(
      'ul',
      { class: 'rank-rules', attrs: { 'aria-label': `名所${rules.landmarkPoints}pt、お店${rules.shopPoints}pt、色あせた地区に戻るとその日${rules.welcomeBackMultiplier}倍` } },
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
      h('span', { class: 'rank-log__spot', text: entry.spotName }),
      h('span', { class: 'rank-log__date', text: shortDateOf(entry.date) }),
      h('strong', { class: 'rank-log__points', text: `+${entry.points}` }),
    ]),
  );
  const list = rows.length === 0 ? h('p', { class: 'rank-log__empty' }, [createIcon('footprints'), 'まだ0pt。歩いて訪れよう']) : h('ol', { class: 'rank-log', attrs: { 'aria-label': '最近のポイント' } }, rows);
  return log.exit(h('section', { class: ['rank-card', 'rank-reveal'], attrs: { 'data-testid': 'rank-points-log' } }, [sectionHead('coin', 'ポイント'), createRuleTokens(dto), list]));
}

/**
 * 設定状況のマス1つを作る。
 * @param tile マス
 * @param index 並びの番号（現れる順）
 * @returns 要素
 */
function settingTile(tile: SettingTile, index: number): HTMLElement { // audit-ignore: fnlog-missing 設定のマスごとに呼ぶ DOM 組立て（呼び出し側 createSettings でログ）
  return h('li', { class: 'rank-setting', dataset: { key: tile.key }, style: { '--i': String(index) }, attrs: { 'aria-label': `${tile.label}：${tile.value}${tile.badge === undefined ? '' : `（${tile.badge}）`}` } }, [
    h('span', { class: 'rank-setting__icon', attrs: { 'aria-hidden': 'true' } }, [tile.glyph ?? (tile.icon === undefined ? '' : createIcon(tile.icon))]),
    h('span', { class: 'rank-setting__value', attrs: { 'aria-hidden': 'true', 'data-testid': `rank-setting-${tile.key}` }, text: tile.value }),
    tile.badge === undefined ? undefined : h('span', { class: 'rank-setting__badge', attrs: { 'aria-hidden': 'true' }, text: tile.badge }),
  ]);
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
   * 上部バーと本文を置き、ランク・ランキング・アプリ状態・マイ街（アバターの装い）を読み込んで描く。
   * ランクが読めなければ案内だけを出す。ほかが読めなくてもランクは出す（アバターは人のアイコンに）。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加し、services.rankStatus・ranking・status・myTown を呼ぶ
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount');
    root.append(createTopBar({ title: 'ランク' }), this.body);
    const s = this.ctx.services;
    const [rank, ranking, status, town] = await Promise.all([s.rankStatus.execute(), s.ranking.execute(), s.status.execute(), s.myTown.execute()]);
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (!rank.ok) {
      this.body.dataset.load = 'error';
      this.body.replaceChildren(h('p', { class: 'screen-message', text: rank.error.message }));
      return log.fail(undefined, rank.error.code);
    }
    for (const [name, r] of [['ranking', ranking], ['status', status], ['myTown', town]] as const) if (!r.ok) log.warn('読めませんでした', { name, code: r.error.code });
    this.render({ rank: rank.value, ranking: ranking.ok ? ranking.value : undefined, status: status.ok ? status.value : undefined, town: town.ok ? town.value : undefined });
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
    const log = logger.fn('render', { hasRanking: data.ranking !== undefined, hasStatus: data.status !== undefined, hasTown: data.town !== undefined });
    const avatar = data.town === undefined ? undefined : createAvatarImage(avatarLookOfTown(data.town), AVATAR_SCALE);
    avatar?.classList.add('rank-road__avatar');
    const hero = createHero(data.rank, avatar, userAction('rank-skip-intro', (): void => this.skipIntro(hero.element)));
    const cards = [createStats(data.rank), this.createLeagues(data.ranking), createPoints(data.rank), this.createSettings(data)];
    this.body.replaceChildren(hero.element, ...cards);
    this.body.dataset.load = 'ready';
    this.counters.count(hero.points, data.rank.points, COUNT_UP_DELAY_MS, () => hero.points.classList.add('rank-hero__num--done'));
    this.cleanups.push(
      attachTilt(hero.element, hero.tilt),
      observeReveal(cards, (card) => card.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => this.statCounters.count(el, Number(el.dataset.count ?? '0')))),
    );
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

  /**
   * 設定状況（アイコンと短い値のマス）と、設定画面へ行く歯車を作る。
   * 文字の大きさは、いま画面に適用されている値を読む（設定画面で変えるとここにも反映される）。
   * @param data 画面のデータ
   * @returns 要素
   */
  private createSettings(data: RankData): HTMLElement {
    const log = logger.fn('createSettings');
    const tiles = settingTilesOf({ status: data.status, textScale: currentTextScale(), isDemo: this.ctx.services.isDemo, nickname: data.rank.nickname });
    const gear = h('button', { class: 'rank-head__gear', attrs: { type: 'button', 'aria-label': '設定を変える', 'data-testid': 'rank-open-settings' }, on: { click: userAction('rank-open-settings', (): void => this.ctx.router.navigate('#/settings')) } }, [
      createIcon('gear'),
      h('span', { text: '変更' }),
    ]);
    return log.exit(h('section', { class: ['rank-card', 'rank-reveal'], attrs: { 'data-testid': 'rank-settings' } }, [sectionHead('gear', '設定', gear), h('ul', { class: 'rank-settings' }, tiles.map(settingTile))]));
  }
}
