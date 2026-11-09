/**
 * @file デモメニュー画面（presentation/screens/Demo 層。ルート '#/demo'、デモビルドのみ）
 * 右上の歯車の長押しで開く発表用の操作: 日付進行・ライバル行動・旅人切替・位置リセット（CLAUDE.md 6.9、wireframes/09_demo_menu）。
 * services.demo が無い（本番ビルド）ときは何も操作させずに地図へ戻す（SEC-02 の画面側の守り）。
 * 上部バーは「× 閉じる」（data-testid="demo-close"、ルーターの戻る）とタイトル。現在のデモ日付・旅人を表示する。
 */
import '@/presentation/screens/Demo/DemoMenuScreen.css';
import type { AppStatusDto, TownStateDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import type { Result } from '@/Common/result/Result';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import { statusDateText } from '@/presentation/App/StatusBar';
import { createDateAdvancePanel } from '@/presentation/screens/Demo/DateAdvancePanel';
import { DemoActionRunner } from '@/presentation/screens/Demo/demoAction';
import type { DemoPanelDeps } from '@/presentation/screens/Demo/demoAction';
import { TRAVELER_PROFILE_LABELS } from '@/presentation/screens/Demo/demoModel';
import { createResetPositionPanel } from '@/presentation/screens/Demo/ResetPositionPanel';
import { createRivalActionPanel } from '@/presentation/screens/Demo/RivalActionPanel';
import { createTravelerSwitchPanel } from '@/presentation/screens/Demo/TravelerSwitchPanel';

const logger = createLogger('presentation/screens/Demo/DemoMenuScreen');

/** デモでないビルドで開かれたときの案内 */
export const DEMO_ONLY_MESSAGE = 'デモビルドでのみ利用できます';

/**
 * デモメニュー画面を作る。
 * @param ctx 画面コンテキスト
 * @param params ルートのパラメータ（なし）
 * @returns 画面
 */
export function createDemoMenuScreen(ctx: AppContext, params: Readonly<Record<string, string>>): Screen {
  const log = logger.fn('createDemoMenuScreen', { keys: Object.keys(params) });
  const controller = new DemoMenuController(ctx);
  const screen: Screen = {
    mount: (root: HTMLElement): Promise<void> => controller.mount(root),
    unmount: (): void => controller.unmount(),
  };
  return log.exit(screen);
}

/**
 * 上部バー（「× 閉じる」とタイトル）を作る。右端は歯車のために空けておく（.top-bar の余白）。
 * @param onClose 閉じるが押されたとき
 * @returns header 要素
 */
function createDemoTopBar(onClose: () => void): HTMLElement {
  const log = logger.fn('createDemoTopBar');
  const close = h(
    'button',
    { class: 'top-bar__back', attrs: { type: 'button', 'data-testid': 'demo-close', 'aria-label': 'デモメニューを閉じる' }, on: { click: userAction('demo-close', onClose) } },
    [h('span', { class: 'top-bar__back-icon', attrs: { 'aria-hidden': 'true' } }, [createIcon('close')]), h('span', { class: 'top-bar__back-label', text: '閉じる' })],
  );
  const titles = h('div', { class: 'top-bar__titles' }, [h('h1', { class: 'top-bar__title', text: 'デモメニュー' }), h('p', { class: 'top-bar__subtitle', text: '発表用の操作' })]);
  return log.exit(h('header', { class: 'top-bar', attrs: { 'data-testid': 'top-bar' } }, [close, titles]));
}

/**
 * 見出しと値の1行（デモ日付・旅人）を作る。
 * @param label 見出し
 * @param value 値の要素
 * @returns div 要素
 */
function createInfoRow(label: string, value: HTMLElement): HTMLElement {
  return h('div', { class: 'demo-kv' }, [h('span', { class: 'demo-kv__key', text: label }), value]);
}

/** デモメニューの読込・描画を受け持つ */
class DemoMenuController {
  private readonly ctx: AppContext;
  private readonly runner: DemoActionRunner;
  private readonly dateValue: HTMLElement;
  private readonly profileValue: HTMLElement;
  /** 画面を離れた（以降の非同期結果は捨てる） */
  private disposed = false;

  /**
   * メニューの部品を用意する。
   * @param ctx 画面コンテキスト
   */
  constructor(ctx: AppContext) {
    const log = logger.fn('constructor', { isDemo: ctx.services.isDemo });
    this.ctx = ctx;
    this.runner = new DemoActionRunner(ctx.toast);
    this.dateValue = h('b', { class: 'demo-kv__value', attrs: { 'data-testid': 'demo-date' }, text: '…' });
    this.profileValue = h('b', { class: 'demo-kv__value', attrs: { 'data-testid': 'demo-profile' }, text: '…' });
    log.exit(undefined);
  }

  /**
   * メニューを表示する。デモでなければ案内を出して地図へ戻す。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加し、services.status・services.town を呼ぶ
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount', { isDemo: this.ctx.services.isDemo });
    root.append(createDemoTopBar((): void => this.ctx.router.back()));
    const demo = this.ctx.services.demo;
    if (!this.ctx.services.isDemo || demo === undefined) {
      root.append(h('p', { class: 'screen-message', attrs: { 'data-testid': 'demo-unavailable' }, text: DEMO_ONLY_MESSAGE }));
      this.ctx.toast.show(DEMO_ONLY_MESSAGE, { kind: 'error' });
      this.ctx.router.navigate('#/map', { replace: true });
      return log.exit(undefined, 'デモでないため地図へ');
    }
    const body = h('div', { class: ['screen-scroll', 'demo-menu'], attrs: { 'data-testid': 'demo-menu', 'data-load': 'loading' } });
    root.append(body);
    const [status, town] = await Promise.all([this.ctx.services.status.execute(), this.ctx.services.town.execute()]);
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    this.showStatus(status);
    const deps: DemoPanelDeps = { ctx: this.ctx, demo, runner: this.runner, onStatusChanged: (): Promise<void> => this.refreshStatus() };
    const districts = districtsOf(town);
    body.append(
      h('div', { class: 'demo-info' }, [createInfoRow('デモ日付', this.dateValue), createInfoRow('冒険者', this.profileValue)]),
      createDateAdvancePanel(deps),
      createRivalActionPanel(deps, districts),
      createTravelerSwitchPanel(deps, status.ok ? status.value.travelerProfile : undefined),
      createResetPositionPanel(deps, districts),
      h('p', { class: ['hint', 'demo-note'], text: '発表用の操作。本番ビルドでは表示されません。' }),
    );
    body.dataset.load = 'ready';
    log.exit(undefined);
  }

  /**
   * 後始末する（以降の非同期結果を捨てる）。
   */
  unmount(): void {
    const log = logger.fn('unmount');
    this.disposed = true;
    log.exit(undefined);
  }

  /**
   * デモ日付・旅人の表示を読み直す（日付進行の後）。
   * @sideEffect services.status を呼び、表示を書き換える
   */
  private async refreshStatus(): Promise<void> {
    const log = logger.fn('refreshStatus');
    const status = await this.ctx.services.status.execute();
    if (!this.disposed) this.showStatus(status);
    log.exit(undefined);
  }

  /**
   * デモ日付（進めていれば「（+n日）」付き）と旅人の種類を表示する。
   * @param status services.status の結果
   * @sideEffect 表示要素の textContent を書き換える
   */
  private showStatus(status: Result<AppStatusDto>): void {
    const log = logger.fn('showStatus', { ok: status.ok });
    if (!status.ok) {
      this.dateValue.textContent = '読み込めませんでした';
      this.profileValue.textContent = '—';
      return log.fail(undefined, status.error.code);
    }
    this.dateValue.textContent = statusDateText(status.value);
    this.dateValue.dataset.today = status.value.today;
    this.profileValue.textContent = TRAVELER_PROFILE_LABELS[status.value.travelerProfile];
    log.exit(undefined);
  }
}

/**
 * 町の状態から地区の ID と名前を取り出す（失敗なら空＝ライバル行動は既定の天満地区だけ、位置リセットは既定の地区名）。
 * @param town services.town の結果
 * @returns 地区の ID と名前
 */
function districtsOf(town: Result<TownStateDto>): { readonly id: string; readonly name: string }[] {
  const log = logger.fn('districtsOf', { ok: town.ok });
  if (!town.ok) return log.exit([]);
  return log.exit(town.value.districts.map((d) => ({ id: d.id, name: d.name })));
}
