/**
 * @file アプリのシェル（presentation/App 層）
 * スマホ枠（幅 500px 以上は 390×844 の枠を中央、狭い画面は全画面）、ステータスバー、画面領域、下部タブ、
 * 右上の歯車、トースト層、演出層を組み立て、ルート変化のたびに画面を unmount／mount する（docs/08 §6）。
 * 共通スタイル（tokens/base/components.css）はここで読み込む。
 */
import '@/Common/ui/styles/tokens.css';
import '@/Common/ui/styles/base.css';
import '@/Common/ui/styles/components.css';
import type { AppServices } from '@/application/AppServices';
import { createLogger } from '@/Common/logging/logger';
import { applyTextScale } from '@/Common/ui/a11y/textScale';
import { createButton } from '@/Common/ui/Button';
import { clear, h } from '@/Common/ui/dom';
import { createTabBar } from '@/Common/ui/TabBar';
import type { TabBarHandle, TabItem } from '@/Common/ui/TabBar';
import { ToastHost } from '@/Common/ui/Toast';
import { createTopBar } from '@/Common/ui/TopBar';
import type { AppContext } from '@/presentation/App/AppContext';
import { AppRouter } from '@/presentation/App/AppRouter';
import type { RouteMatch, RouteName } from '@/presentation/App/AppRouter';
import { createGearMenu } from '@/presentation/App/GearMenu';
import type { Screen, ScreenFactory } from '@/presentation/App/Screen';
import { createStatusBar } from '@/presentation/App/StatusBar';
import type { StatusBarHandle } from '@/presentation/App/StatusBar';
import { createDemoMenuScreen } from '@/presentation/screens/Demo/DemoMenuScreen';
import { createEffectHost } from '@/presentation/screens/Effects/EffectHost';
import { createMapScreen } from '@/presentation/screens/Map/MapScreen';
import { createMyTownScreen } from '@/presentation/screens/MyTown/MyTownScreen';
import { createPlaceholderScreen } from '@/presentation/screens/Placeholder/PlaceholderScreen';
import { createRankingScreen } from '@/presentation/screens/Ranking/RankingScreen';
import { createSpotDetailScreen } from '@/presentation/screens/Spot/SpotDetailScreen';
import { createZukanScreen } from '@/presentation/screens/Zukan/ZukanScreen';

const logger = createLogger('presentation/App/App');

/** 下部タブ（CLAUDE.md 6.1。id はルートのパスと同じ） */
export const TAB_ITEMS: readonly TabItem[] = [
  { id: 'map', label: '地図', icon: '◎', testId: 'tab-map' },
  { id: 'zukan', label: '図鑑', icon: '▤', testId: 'tab-zukan' },
  { id: 'mytown', label: 'マイ街', icon: '⌂', testId: 'tab-mytown' },
  { id: 'ranking', label: 'ランキング', icon: '♛', testId: 'tab-ranking' },
];

/** ルートごとの画面ファクトリ（PoC で後回しの画面は準備中画面） */
const SCREEN_FACTORIES: Readonly<Record<RouteName, ScreenFactory>> = {
  map: createMapScreen,
  spot: createSpotDetailScreen,
  demo: createDemoMenuScreen,
  zukan: createZukanScreen,
  mytown: createMyTownScreen,
  ranking: createRankingScreen,
  settings: createPlaceholderScreen('settings'),
};

/** ルートごとに選択中にするタブ（スポット詳細は地図から来るので地図タブ。設定・デモはどれも選ばない） */
const TAB_FOR_ROUTE: Readonly<Record<RouteName, string | undefined>> = {
  map: 'map',
  spot: 'map',
  zukan: 'zukan',
  mytown: 'mytown',
  ranking: 'ranking',
  settings: undefined,
  demo: undefined,
};

/**
 * ルートに対応するタブID を返す。
 * @param name ルート名
 * @returns タブID（どれも選ばないときは undefined）
 */
export function tabIdForRoute(name: RouteName): string | undefined {
  return TAB_FOR_ROUTE[name];
}

/** シェルの DOM 部品 */
interface ShellParts {
  readonly viewport: HTMLElement;
  readonly phone: HTMLElement;
  readonly main: HTMLElement;
  readonly screenRoot: HTMLElement;
  readonly effectLayer: HTMLElement;
}

/**
 * シェルの骨組み（スマホ枠・画面領域・演出層）を作る。
 * @returns DOM 部品
 */
function buildShellParts(): ShellParts {
  const log = logger.fn('buildShellParts');
  const screenRoot = h('div', { class: 'screen-root', attrs: { 'data-testid': 'screen-root' } });
  const main = h('main', { class: 'app-main' }, [screenRoot]);
  const effectLayer = h('div', { class: 'effect-layer', attrs: { 'data-testid': 'effect-layer' } });
  const phone = h('div', { class: 'phone', attrs: { 'data-testid': 'phone', 'data-modal-host': true } });
  const viewport = h('div', { class: 'app-viewport' }, [phone]);
  return log.exit({ viewport, phone, main, screenRoot, effectLayer });
}

/** アプリのシェル */
export class App {
  private readonly root: HTMLElement;
  private readonly services: AppServices;
  private readonly router: AppRouter;
  private readonly parts: ShellParts;
  private readonly statusBar: StatusBarHandle;
  private readonly tabBar: TabBarHandle;
  private readonly toast: ToastHost;
  private readonly ctx: AppContext;
  private currentScreen: Screen | undefined;
  /** 画面切替の世代（mount 待ちの間に次の切替が来たら古い方の後処理をしない） */
  private routeToken = 0;
  private started = false;

  /**
   * シェルを組み立てる（root にはまだ追加しない）。
   * @param root アプリを入れる要素（#app）
   * @param services presentation が使う唯一のサービス一覧
   */
  constructor(root: HTMLElement, services: AppServices) {
    const log = logger.fn('constructor', { isDemo: services.isDemo });
    this.root = root;
    this.services = services;
    this.router = new AppRouter({ isDemo: services.isDemo && services.demo !== undefined });
    this.parts = buildShellParts();
    this.statusBar = createStatusBar();
    this.tabBar = createTabBar({ tabs: TAB_ITEMS, onSelect: (id): void => this.router.navigate(`#/${id}`) });
    const gear = createGearMenu({
      isDemo: services.isDemo,
      onTap: (): void => this.router.navigate('#/settings'),
      onLongPress: (): void => this.router.navigate('#/demo'),
    });
    this.parts.main.append(gear.element);
    this.parts.phone.append(this.statusBar.element, this.parts.main, this.tabBar.element);
    this.toast = new ToastHost(this.parts.phone);
    this.parts.phone.append(this.parts.effectLayer);
    this.ctx = {
      services,
      router: this.router,
      toast: this.toast,
      effects: createEffectHost(this.parts.effectLayer, services),
      ui: { zoom: 'wide', footprints: [], sheetState: 'peek' },
      refreshStatus: (): Promise<void> => this.refreshStatus(),
    };
    log.exit(undefined);
  }

  /**
   * アプリを起動する。文字の大きさを適用し、ステータスを読み込み、ルーターを開始して最初の画面を出す。
   * @sideEffect root の中身を置き換え、hashchange を監視し始める
   */
  async start(): Promise<void> {
    const log = logger.fn('start', { isDemo: this.services.isDemo });
    if (this.started) return log.exit(undefined, '起動済み');
    this.started = true;
    applyTextScale('normal');
    this.root.replaceChildren(this.parts.viewport);
    this.router.onChange((route) => void this.showRoute(route));
    this.services.demo?.onCatalogChanged?.(() => this.onCatalogChanged());
    await this.refreshStatus();
    this.router.start();
    log.info('アプリを起動しました', { route: this.router.current().name });
    log.exit(undefined);
  }

  /**
   * 店舗CMS（別タブの cms.html）で保存されたとき、今の画面を作り直して新しい営業時間・クーポンを出す（デモ。docs/09 §8.1）。
   * @sideEffect トーストを出し、今のルートを再表示する
   */
  private onCatalogChanged(): void {
    const log = logger.fn('onCatalogChanged', { route: this.router.current().name });
    this.toast.show('お店の情報が更新されました', { kind: 'info' });
    this.router.reload();
    log.exit(undefined);
  }

  /**
   * ステータスバー（時刻・日付・デモ表示）を最新にする。失敗したらトーストで知らせる。
   * @sideEffect services.status を呼び、ステータスバーを書き換える
   */
  private async refreshStatus(): Promise<void> {
    const log = logger.fn('refreshStatus');
    const result = await this.services.status.execute();
    if (!result.ok) {
      this.toast.show('アプリの状態を読み込めませんでした', { kind: 'error' });
      log.fail(undefined, result.error.code);
      return;
    }
    this.statusBar.update(result.value);
    log.exit(undefined);
  }

  /**
   * ルートに対応する画面に切り替える（今の画面を unmount → 新しい画面を mount）。
   * @param route 解決済みのルート
   * @sideEffect 画面領域の DOM を差し替え、タブの選択とステータスを更新する
   */
  private async showRoute(route: RouteMatch): Promise<void> {
    const log = logger.fn('showRoute', { name: route.name, params: route.params });
    const token = ++this.routeToken;
    this.unmountCurrent();
    this.tabBar.setActive(tabIdForRoute(route.name));
    const host = h('div', { class: 'screen', attrs: { 'data-testid': `screen-${route.name}`, 'data-route': route.name } });
    this.parts.screenRoot.append(host);
    this.parts.screenRoot.setAttribute('aria-busy', 'true');
    void this.refreshStatus();
    try {
      const screen = SCREEN_FACTORIES[route.name](this.ctx, route.params);
      this.currentScreen = screen;
      await screen.mount(host);
    } catch (error) {
      // 画面の境界：想定外の例外で真っ白にしないよう、記録して安全な案内に差し替える（内部情報は出さない）
      log.error('画面の表示に失敗しました', { name: route.name, error });
      if (token === this.routeToken) this.showScreenError(host);
    } finally {
      if (token === this.routeToken) this.parts.screenRoot.removeAttribute('aria-busy');
    }
    log.exit(undefined);
  }

  /**
   * 今の画面を unmount し、画面領域を空にする。
   * @sideEffect 画面の後始末を呼び、DOM を消す
   */
  private unmountCurrent(): void {
    const log = logger.fn('unmountCurrent', { hasScreen: this.currentScreen !== undefined });
    const screen = this.currentScreen;
    this.currentScreen = undefined;
    try {
      screen?.unmount();
    } catch (error) {
      log.error('画面の後始末に失敗しました', { error });
    }
    clear(this.parts.screenRoot);
    log.exit(undefined);
  }

  /**
   * 画面の表示に失敗したときの案内を出す。
   * @param host 画面のルート要素
   * @sideEffect host の中身を置き換える
   */
  private showScreenError(host: HTMLElement): void {
    const log = logger.fn('showScreenError');
    const back = createButton({
      label: '地図へ戻る',
      variant: 'primary',
      testId: 'error-back-map',
      onClick: (): void => (this.router.current().name === 'map' ? this.router.reload() : this.router.navigate('#/map', { replace: true })),
    });
    clear(host);
    host.append(
      createTopBar({ title: 'うまく表示できませんでした' }),
      h('div', { class: 'screen-scroll' }, [h('p', { class: 'screen-message', text: '画面を表示できませんでした。地図に戻ってやり直してください。' }), back]),
    );
    log.exit(undefined);
  }
}
