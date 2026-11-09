/**
 * @file マイ街画面（presentation/screens/MyTown 層。ルート '#/mytown'）
 * 「街に通うほど、自分だけの街が育つ」を、文字ではなく絵で体感させる画面（CLAUDE.md 6.6、基準 C 再訪動機）。
 * 構成（上から）:
 * 1. ヒーロー: 画面幅いっぱいの線画の街並み（雲・桜・旗が動き、色あせた地区は「待ってるよ」）。上に「○○の街」
 * 2. アバターのひと言（吹き出し）＋地図で向かう → 数字（アイコン＋大きな数字）
 * 3. タブ: 街（次のごほうび＝アイコンとブロックのゲージ／地区のようす＝ミニチュアのタイル）／コレクション／着せ替え
 * 訪問はここではできない（歩かずに稼げる仕組みは作らない＝CLAUDE.md 5 章）。「地図で向かう」で地図へ送る。
 */
import '@/presentation/screens/MyTown/MyTownScreen.css';
import type { DistrictCardDto, MapDataDto, MyTownDto } from '@/application/dto/Dto';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import type { AvatarLook } from '@/presentation/screens/MyTown/avatarArt';
import { createCollection } from '@/presentation/screens/MyTown/Collection';
import { createDistrictTiles } from '@/presentation/screens/MyTown/DistrictTiles';
import type { DistrictTilesHandle } from '@/presentation/screens/MyTown/DistrictTiles';
import { createDressPanel } from '@/presentation/screens/MyTown/DressPanel';
import { createGoalRail } from '@/presentation/screens/MyTown/GoalRail';
import { avatarDistrictIndexOf, avatarLookOf, builtSlotsOf, fadeFilterOf, headlineOf, profileStatsOf, rewardGoalsOf, sceneKindOf, stageTextOf } from '@/presentation/screens/MyTown/myTownModel';
import type { TownHeadline } from '@/presentation/screens/MyTown/myTownModel';
import { createPortrait } from '@/presentation/screens/MyTown/MyTownProfile';
import { createSprite } from '@/presentation/screens/MyTown/pixelSprites';
import type { SpriteName } from '@/presentation/screens/MyTown/pixelSprites';
import { createTownStrip } from '@/presentation/screens/MyTown/TownStrip';
import type { TownStripHandle } from '@/presentation/screens/MyTown/TownStrip';
import type { StripDistrictVm } from '@/presentation/screens/MyTown/townStripArt';

const logger = createLogger('presentation/screens/MyTown/MyTownScreen');

/** タブ */
type MyTownTab = 'town' | 'collection' | 'dress';

/** タブの表示名 */
const TAB_LABEL: Readonly<Record<MyTownTab, string>> = { town: '街', collection: 'コレクション', dress: '着せ替え' };

/** 画面の描画に使うデータ一式 */
interface MyTownData {
  readonly town: MyTownDto;
  /** 地区ID → テーマ（街並みの絵の種類を決める） */
  readonly themes: ReadonlyMap<string, string>;
}

/**
 * マイ街画面を作る。
 * @param ctx 画面コンテキスト
 * @returns 画面
 */
export function createMyTownScreen(ctx: AppContext): Screen {
  const log = logger.fn('createMyTownScreen');
  const controller = new MyTownController(ctx);
  return log.exit({
    mount: (root: HTMLElement): Promise<void> => controller.mount(root),
    unmount: (): void => controller.unmount(),
  });
}

/**
 * 地図データから地区ID → テーマの対応を作る。
 * @param map 地図データ
 * @returns 対応表
 */
function themesOf(map: MapDataDto): ReadonlyMap<string, string> {
  const log = logger.fn('themesOf', { count: map.districts.length });
  return log.exit(new Map(map.districts.map((d) => [d.id, d.theme])));
}

/**
 * 地区カードを街並みの描画モデルにする。
 * @param card 地区カード
 * @param theme 地区のテーマ
 * @returns 描画モデル
 */
function toStripDistrict(card: DistrictCardDto, theme: string): StripDistrictVm {
  const log = logger.fn('toStripDistrict', { id: card.id, theme });
  const stage = stageTextOf(card);
  return log.exit({
    name: card.shortName,
    color: card.color,
    scene: sceneKindOf(theme),
    builtSlots: builtSlotsOf(card.buildings),
    filter: fadeFilterOf(card.fade),
    isUnvisited: card.fade.kind === 'never',
    level: card.level,
    visitedToday: card.fade.daysSinceVisit === 0,
    isWaiting: card.fade.kind === 'soon' || card.fade.kind === 'fading',
    note: stage.isWarn ? stage.text : undefined,
  });
}

/**
 * 数字の帯（アイコン＋大きな数字）を作る。
 * @param dto マイ街
 * @returns 要素
 */
function createStats(dto: MyTownDto): HTMLElement {
  const log = logger.fn('createStats', { totalVisits: dto.totalVisits });
  const lords = dto.districts.filter((d) => d.isLordMe).length;
  /**
   * 数字1つを作る。
   * @param icon アイコン
   * @param value 数字
   * @param caption 説明（小さく）
   * @returns 要素
   */
  const stat = (icon: SpriteName, value: string, caption: string): HTMLElement =>
    h('div', { class: 'mytown-stat', attrs: { 'aria-label': `${caption} ${value}` } }, [createSprite(icon, 3), h('b', { class: 'mytown-stat__value', text: value }), h('span', { class: 'mytown-stat__caption', text: caption })]);
  return log.exit(h('div', { class: 'mytown-stats' }, [
    stat('foot', `${dto.totalVisits}`, '通った'),
    stat('card', `${dto.cards.length}`, 'カード'),
    stat('crown', `${lords}`, '主'),
    stat('coin', dto.points.toLocaleString('ja-JP'), dto.rank.name),
  ]));
}

/** マイ街画面の状態と描画 */
class MyTownController {
  private readonly ctx: AppContext;
  private readonly body: HTMLElement;
  private data: MyTownData | undefined;
  private tab: MyTownTab = 'town';
  private centerIndex: number | undefined;
  private strip: TownStripHandle | undefined;
  private tiles: DistrictTilesHandle | undefined;
  private panel: HTMLElement | undefined;
  /** 画面を離れた（以降の非同期結果は捨てる） */
  private disposed = false;

  /**
   * 骨組みを作る。
   * @param ctx 画面コンテキスト
   */
  constructor(ctx: AppContext) {
    const log = logger.fn('constructor');
    this.ctx = ctx;
    this.body = h('div', { class: ['screen-scroll', 'mytown'], attrs: { 'data-testid': 'mytown', 'data-load': 'loading' } }, [
      h('p', { class: 'screen-message', text: '街を読み込み中…' }),
    ]);
    log.exit(undefined);
  }

  /**
   * 本文を置き、データを読み込んで描く（ヒーローが主役なので上部バーは置かない）。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加し、services.myTown／map を呼ぶ
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount');
    root.append(this.body);
    const failed = await this.load();
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (failed !== undefined) {
      this.body.dataset.load = 'error';
      this.body.replaceChildren(h('p', { class: 'screen-message', text: failed }));
      return log.fail(undefined, '読み込み失敗');
    }
    this.render();
    log.exit(undefined);
  }

  /**
   * マイ街と地区のテーマを読み込んで this.data に入れる。
   * @returns 失敗したら利用者向けのメッセージ、成功なら undefined
   * @sideEffect services を呼び、this.data を更新する
   */
  private async load(): Promise<string | undefined> {
    const log = logger.fn('load');
    const [town, map] = await Promise.all([this.ctx.services.myTown.execute(), this.ctx.services.map.execute()]);
    if (!town.ok) return log.fail(town.error.message, town.error.code);
    if (!map.ok) return log.fail(map.error.message, map.error.code);
    this.data = { town: town.value, themes: themesOf(map.value) };
    return log.exit(undefined);
  }

  /**
   * 後始末する（街並みのループ・監視を止め、以降の非同期結果を捨てる）。
   * @sideEffect requestAnimationFrame と ResizeObserver を解除する
   */
  unmount(): void {
    const log = logger.fn('unmount');
    this.disposed = true;
    this.strip?.destroy();
    this.strip = undefined;
    log.exit(undefined);
  }

  /**
   * 地区ごとの描画モデル（地区ID → モデル）。
   * @param data 画面のデータ一式
   * @returns 対応表
   */
  private stripDistricts(data: MyTownData): Map<string, StripDistrictVm> {
    const log = logger.fn('stripDistricts', { count: data.town.districts.length });
    return log.exit(new Map(data.town.districts.map((c) => [c.id, toStripDistrict(c, data.themes.get(c.id) ?? '')])));
  }

  /**
   * 画面全体（ヒーロー・アバターのひと言・数字・タブ）を描く。
   * @sideEffect 本文の DOM を作り直し、街並みを作り直す
   */
  private render(): void {
    const log = logger.fn('render', { tab: this.tab });
    const data = this.data;
    if (data === undefined) return log.exit(undefined);
    this.strip?.destroy();
    this.tiles = undefined;
    const look = avatarLookOf(profileStatsOf(data.town.districts), data.town.heldItemId);
    const headline = headlineOf(data.town.districts);
    const hero = this.createHero(data, look, headline);
    this.panel = h('div', { class: 'mytown-panel', attrs: { role: 'tabpanel' } });
    this.body.dataset.load = 'ready';
    this.body.replaceChildren(hero, this.createHeadline(headline, look), createStats(data.town), this.createTabs(), this.panel);
    this.renderPanel(look);
    log.exit(undefined);
  }

  /**
   * ヒーロー（画面幅いっぱいの線画の街並み＋「○○の街」）を作る。
   * @param data 画面のデータ一式
   * @param look アバターの装い
   * @param headline 見出し（アバターのセリフ・最初に見せる地区）
   * @returns 要素
   */
  private createHero(data: MyTownData, look: AvatarLook, headline: TownHeadline): HTMLElement {
    const log = logger.fn('createHero');
    const cards = data.town.districts;
    const byId = this.stripDistricts(data);
    const focus = headline.districtId === undefined ? -1 : cards.findIndex((c) => c.id === headline.districtId);
    this.strip = createTownStrip({
      districts: cards.map((c) => byId.get(c.id) ?? toStripDistrict(c, '')),
      avatarIndex: focus >= 0 ? focus : avatarDistrictIndexOf(cards),
      avatarLook: look,
      avatarSay: headline.say,
      initialIndex: this.centerIndex ?? (focus >= 0 ? focus : avatarDistrictIndexOf(cards)),
      onCenterChange: (i: number): void => this.onCenterChange(i),
    });
    const title = h('div', { class: 'mytown-hero__title' }, [
      h('p', { class: 'mytown-hero__kicker', text: 'MY TOWN' }),
      h('h1', { class: 'mytown-hero__name', text: `${data.town.nickname}の街` }),
    ]);
    return log.exit(h('section', { class: 'mytown-hero', attrs: { 'aria-label': 'あなたの街の全景' } }, [this.strip.element, title]));
  }

  /**
   * アバターのひと言（吹き出し）＋地図で向かうボタンを作る。
   * @param headline 見出し
   * @param look アバターの装い（顔を出す）
   * @returns 要素
   */
  private createHeadline(headline: TownHeadline, look: AvatarLook): HTMLElement {
    const log = logger.fn('createHeadline', { districtId: headline.districtId, isUrgent: headline.isUrgent });
    const districtId = headline.districtId;
    return log.exit(h('section', { class: ['mytown-headline', headline.isUrgent ? 'mytown-headline--urgent' : undefined], attrs: { 'data-testid': 'mytown-headline' } }, [
      h('div', { class: 'mytown-headline__row' }, [
        createPortrait(look, { width: 72, height: 80, scale: 1 }),
        h('p', { class: 'mytown-headline__bubble', text: headline.text }),
      ]),
      districtId === undefined ? undefined : createButton({ label: '地図で向かう', variant: 'primary', size: 'large', testId: 'mytown-headline-go', onClick: (): void => this.ctx.router.navigate(`#/map/${districtId}`) }),
    ]));
  }

  /**
   * タブ（街／コレクション／着せ替え）を作る。
   * @returns 要素
   */
  private createTabs(): HTMLElement {
    const log = logger.fn('createTabs', { tab: this.tab });
    const icons: Readonly<Record<MyTownTab, IconName>> = { town: 'mytown', collection: 'card', dress: 'shirt' };
    const tabs = (Object.keys(TAB_LABEL) as MyTownTab[]).map((key) => {
      const button = h('button', {
        class: 'mytown-tab',
        attrs: { type: 'button', role: 'tab', 'aria-selected': key === this.tab ? 'true' : 'false', 'data-testid': `mytown-tab-${key}` },
      }, [createIcon(icons[key]), TAB_LABEL[key]]);
      button.addEventListener('click', () => this.selectTab(key));
      return button;
    });
    return log.exit(h('nav', { class: 'mytown-tabs', attrs: { role: 'tablist', 'aria-label': 'マイ街の表示' } }, tabs));
  }

  /**
   * タブを切り替える（ヒーローはそのまま、タブの中身だけ描き直す）。
   * @param key 選ぶタブ
   * @sideEffect タブの見た目と中身を変える
   */
  private selectTab(key: MyTownTab): void {
    setCorrelationId();
    const log = logger.fn('selectTab', { key });
    if (this.tab === key || this.data === undefined) return log.exit(undefined, '選択済み');
    this.tab = key;
    this.body.querySelectorAll('.mytown-tab').forEach((b) => b.setAttribute('aria-selected', b.getAttribute('data-testid') === `mytown-tab-${key}` ? 'true' : 'false'));
    this.renderPanel(avatarLookOf(profileStatsOf(this.data.town.districts), this.data.town.heldItemId));
    log.exit(undefined);
  }

  /**
   * 選んでいるタブの中身を描く。
   * @param look アバターの装い
   * @sideEffect タブの中身の DOM を作り直す
   */
  private renderPanel(look: AvatarLook): void {
    const log = logger.fn('renderPanel', { tab: this.tab });
    const data = this.data;
    if (data === undefined || this.panel === undefined) return log.exit(undefined);
    this.tiles = undefined;
    if (this.tab === 'collection') this.panel.replaceChildren(createCollection(data.town, this.stripDistricts(data)));
    else if (this.tab === 'dress') this.panel.replaceChildren(this.createDressTab(data, look));
    else this.panel.replaceChildren(...this.createTownTab(data));
    log.exit(undefined);
  }

  /**
   * 街タブ（次のごほうび・地区のようす）を作る。
   * @param data 画面のデータ一式
   * @returns 要素の並び
   */
  private createTownTab(data: MyTownData): HTMLElement[] {
    const log = logger.fn('createTownTab');
    /**
     * 地図でその地区を開く。
     * @param id 地区ID
     */
    const go = (id: string): void => this.ctx.router.navigate(`#/map/${id}`);
    this.tiles = createDistrictTiles({
      cards: data.town.districts,
      districts: this.stripDistricts(data),
      selectedIndex: this.centerIndex ?? 0,
      onSelect: (i: number): void => {
        this.strip?.scrollToDistrict(i);
        this.body.scrollTo({ top: 0, behavior: 'smooth' });
      },
      onOpenMap: go,
    });
    const rail = createGoalRail(rewardGoalsOf(data.town), go);
    return log.exit(rail === undefined ? [this.tiles.element] : [rail, this.tiles.element]);
  }

  /**
   * 着せ替えタブを作る。
   * @param data 画面のデータ一式
   * @param look アバターの装い
   * @returns 要素
   */
  private createDressTab(data: MyTownData, look: AvatarLook): HTMLElement {
    const log = logger.fn('createDressTab', { items: data.town.items.length });
    return log.exit(createDressPanel({
      dto: data.town,
      look,
      onEquip: (itemId: string | undefined): Promise<void> => this.equip(itemId),
      onLocked: (name: string, hint: string): void => this.ctx.toast.show(`${name}の手に入れ方：${hint}`),
    }));
  }

  /**
   * アバターに持たせるものを保存し、読み直して描き直す（街のアバターにも反映）。
   * @param itemId 持たせるアイテム（undefined はカメラ）
   * @sideEffect services.equipItem・myTown を呼び、画面を描き直す。失敗はトーストで伝える
   */
  private async equip(itemId: string | undefined): Promise<void> {
    const log = logger.fn('equip', { itemId });
    const saved = await this.ctx.services.equipItem.execute(itemId === undefined ? {} : { itemId });
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (!saved.ok) {
      this.ctx.toast.show(saved.error.message, { kind: 'error' });
      return log.fail(undefined, saved.error.code);
    }
    const town = await this.ctx.services.myTown.execute();
    if (this.disposed || this.data === undefined) return log.exit(undefined);
    if (!town.ok) return log.fail(undefined, town.error.code);
    const scrollTop = this.body.scrollTop;
    this.data = { ...this.data, town: town.value };
    this.render();
    this.body.scrollTop = scrollTop;
    this.ctx.toast.show('アバターの持ち物を変えました', { kind: 'success' });
    log.exit(undefined);
  }

  /**
   * ヒーローの中央の地区が変わったら、地区のようすのタイルの選択を合わせる。
   * @param index 地区のインデックス
   * @sideEffect タイルの選択表示を変える
   */
  private onCenterChange(index: number): void {
    const log = logger.fn('onCenterChange', { index });
    this.centerIndex = index;
    this.tiles?.select(index);
    log.exit(undefined);
  }
}
