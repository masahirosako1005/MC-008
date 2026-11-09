/**
 * @file 店舗CMS のシェル（presentation/cms 層。docs/09 §5・§7.2 フェーズ1）
 * 上部に「お店の切り替え（デモではログインの代わり＝CMS-A09）」「デモの今日」「使い方」「アプリを開く」、
 * その下にページの切り替え（スマホ幅でも4つが1行）、本文、トースト（画面の下）。ルートは '#/<スポットID>/<ページ>'。
 * 初めての人がつまずかないための仕組みもここに置く：
 * - 保存前の入力（draft）はページやお店を移っても消さない。タブを閉じる・再読み込みするときは確認する
 * - ページを移ったら見出し（h1）にフォーカスを移す（読み上げ・キーボード操作の起点）
 * - 各ページを開いたことを覚え、ホームの「はじめにやること」の進み具合に使う
 */
import '@/Common/ui/styles/tokens.css';
import '@/Common/ui/styles/base.css';
import '@/Common/ui/styles/components.css';
import '@/presentation/cms/cms.css';
import type { CmsShopInfoDto, CmsShopSummaryDto } from '@/application/dto/CmsDto';
import type { CmsServices } from '@/application/CmsServices';
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { clear, h } from '@/Common/ui/dom';
import { ToastHost } from '@/Common/ui/Toast';
import { openCmsGuide } from '@/presentation/cms/cmsGuide';
import { CMS_PAGE_LABELS, CMS_PAGES, cmsHashOf, parseCmsHash } from '@/presentation/cms/cmsRoute';
import type { CmsPage, CmsRoute } from '@/presentation/cms/cmsRoute';
import { APP_WINDOW_NAME, shortDate } from '@/presentation/cms/cmsUi';
import type { CmsContext, CmsScreen } from '@/presentation/cms/cmsUi';
import { renderCmsDataScreen } from '@/presentation/cms/screens/Data/CmsDataScreen';
import { renderCmsEventsScreen } from '@/presentation/cms/screens/Events/CmsEventsScreen';
import { renderCmsHomeScreen } from '@/presentation/cms/screens/Home/CmsHomeScreen';
import { renderCmsInfoScreen } from '@/presentation/cms/screens/Info/CmsInfoScreen';

const logger = createLogger('presentation/cms/CmsApp');

/** ページごとの画面 */
const SCREENS: Readonly<Record<CmsPage, CmsScreen>> = {
  home: renderCmsHomeScreen,
  info: renderCmsInfoScreen,
  events: renderCmsEventsScreen,
  data: renderCmsDataScreen,
};

/**
 * 最初に開く店を選ぶ（協力店の先頭。無ければ店の先頭）。
 * @param shops 店の一覧
 * @returns スポットID（店が無ければ undefined）
 */
export function defaultShopId(shops: readonly CmsShopSummaryDto[]): string | undefined {
  const log = logger.fn('defaultShopId', { count: shops.length });
  return log.exit((shops.find((s) => s.partner) ?? shops[0])?.id);
}

/**
 * お店の切り替えの選択肢の文字を作る（例「南森町ベーカリー｜協力店・掲載中1件」）。
 * @param shop 店
 * @returns 文字
 */
export function shopOptionText(shop: CmsShopSummaryDto): string {
  const log = logger.fn('shopOptionText', { id: shop.id });
  const notes = [shop.partner ? '協力店' : undefined, shop.openEvents > 0 ? `掲載中${shop.openEvents}件` : undefined, shop.edited ? '情報を更新済み' : undefined].filter(Boolean);
  return log.exit(notes.length > 0 ? `${shop.name}｜${notes.join('・')}` : shop.name);
}

/** 店舗CMS のシェル */
export class CmsApp {
  private readonly shell = h('div', { class: 'cms-app', attrs: { 'data-modal-host': true } });
  private readonly header = h('header', { class: 'cms-header' });
  private readonly nav = h('nav', { class: 'cms-nav', attrs: { 'aria-label': 'ページ' } });
  private readonly main = h('main', { class: 'cms-main', attrs: { 'data-testid': 'cms-main' } });
  private readonly toast: ToastHost;
  private shops: readonly CmsShopSummaryDto[] = [];
  /** 入力中の値（キー: スポットID + ':' + 用途） */
  private readonly drafts = new Map<string, object>();
  /** 保存していない変更があるもの（キーは drafts と同じ） */
  private readonly dirty = new Set<string>();
  /** お店ごとに開いたページ */
  private readonly seen = new Map<string, Set<CmsPage>>();
  /** 表示の世代（読み込み中に次の切り替えが来たら古い方を捨てる） */
  private token = 0;
  /** 直前に表示したお店とページ（同じなら描き直しでフォーカスを動かさない） */
  private shown: string | undefined;

  /**
   * シェルを組み立てる。
   * @param root 入れる要素（#cms）
   * @param services 店舗CMS のサービス
   */
  constructor(private readonly root: HTMLElement, private readonly services: CmsServices) {
    const toastHost = h('div', { class: 'cms-toast-host' });
    this.toast = new ToastHost(toastHost);
    // ハッシュはルートに使うので、本文へ移動はリンクではなくボタンでフォーカスを移す
    const skip = h('button', { class: 'cms-skip', attrs: { type: 'button' }, text: '本文へ移動', on: { click: () => this.main.focus() } });
    this.main.tabIndex = -1;
    this.shell.append(skip, this.header, this.nav, this.main, toastHost);
    this.root.replaceChildren(this.shell);
  }

  /**
   * 起動する（店の一覧を読み、ハッシュの変化を監視して最初の画面を出す）。
   * @sideEffect hashchange・beforeunload を監視し、画面を描く
   */
  async start(): Promise<void> {
    const log = logger.fn('start');
    const shops = await this.services.shops.execute();
    if (!shops.ok) {
      this.main.replaceChildren(h('p', { class: 'cms-error', text: `${shops.error.message}。ページを読み込み直してください。` }));
      return log.fail(undefined, shops.error.code);
    }
    this.shops = shops.value;
    window.addEventListener('hashchange', () => void this.show());
    window.addEventListener('beforeunload', (event) => {
      if (this.dirty.size > 0) event.preventDefault();
    });
    await this.show();
    return log.exit(undefined);
  }

  /**
   * 今のハッシュの画面を出す（店が無い・不正なら既定の店へ）。
   * @sideEffect 本文・上部・ページの切り替えを描き直す
   */
  private async show(): Promise<void> {
    const log = logger.fn('show', { hash: window.location.hash });
    const route = parseCmsHash(window.location.hash);
    const token = ++this.token;
    const fallback = defaultShopId(this.shops);
    if (route.spotId === undefined) return log.exit(this.redirect(fallback, route.page));
    this.main.setAttribute('aria-busy', 'true');
    const info = await this.services.shopInfo.execute({ spotId: route.spotId });
    if (token !== this.token) return log.exit(undefined, 'stale');
    this.main.removeAttribute('aria-busy');
    if (!info.ok) {
      this.toast.show('このお店は開けませんでした。最初のお店に戻ります', { kind: 'error' });
      return log.exit(route.spotId === fallback ? undefined : this.redirect(fallback, route.page));
    }
    this.render(route, info.value);
    return log.exit(undefined);
  }

  /**
   * 既定の店へ移る（履歴は置き換える）。
   * @param spotId 移る先の店
   * @param page ページ
   * @sideEffect location.hash を置き換える
   */
  private redirect(spotId: string | undefined, page: CmsPage): void {
    const log = logger.fn('redirect', { spotId, page });
    if (spotId === undefined) {
      this.main.replaceChildren(h('p', { class: 'cms-error', text: 'お店が登録されていません' }));
      return log.exit(undefined);
    }
    window.location.replace(cmsHashOf(spotId, page));
    return log.exit(undefined);
  }

  /**
   * 画面に渡す文脈を作る。
   * @param route ルート
   * @param info 店の情報
   * @returns 文脈
   */
  private contextOf(route: CmsRoute, info: CmsShopInfoDto): CmsContext {
    const log = logger.fn('contextOf', { spotId: info.id });
    /** 入力中の値のキー（お店ごとに分ける） */
    const keyOf = (key: string): string => `${info.id}:${key}`;
    return log.exit({
      services: this.services,
      toast: this.toast,
      info,
      go: (page): void => window.location.assign(cmsHashOf(info.id, page)),
      update: (next): void => {
        this.render(route, next);
        void this.refreshShops(route, next);
      },
      draft: <T extends object>(key: string, init: () => T): T => {
        const existing = this.drafts.get(keyOf(key));
        if (existing !== undefined) return existing as T;
        const created = init();
        this.drafts.set(keyOf(key), created);
        return created;
      },
      discardDraft: (key): void => {
        this.drafts.delete(keyOf(key));
        this.dirty.delete(keyOf(key));
      },
      setDirty: (key, isDirty): void => {
        if (isDirty) this.dirty.add(keyOf(key));
        else this.dirty.delete(keyOf(key));
      },
      hasSeen: (page): boolean => this.seen.get(info.id)?.has(page) === true,
      openGuide: (): void => openCmsGuide(this.shell),
    });
  }

  /**
   * 上部・ページの切り替え・本文を描く。ページを移ったときだけ見出しにフォーカスを移す。
   * @param route ルート（店は検証済み）
   * @param info 店の情報
   * @sideEffect DOM を描き直す
   */
  private render(route: CmsRoute, info: CmsShopInfoDto): void {
    const log = logger.fn('render', { page: route.page, spotId: info.id });
    const ctx = this.contextOf(route, info);
    this.renderHeader(route, info);
    this.renderNav(route, info.id);
    clear(this.main);
    this.main.append(SCREENS[route.page](ctx));
    const seen = this.seen.get(info.id) ?? new Set<CmsPage>();
    seen.add(route.page);
    this.seen.set(info.id, seen);
    const place = `${info.id}/${route.page}`;
    if (this.shown !== undefined && this.shown !== place) {
      this.main.querySelector<HTMLElement>('.cms-page__title')?.focus();
      window.scrollTo({ top: 0 });
    }
    this.shown = place;
    log.exit(undefined);
  }

  /**
   * 店の一覧（掲載数・更新済みの印）を読み直し、上部を描き直す。
   * @param route ルート
   * @param info 店の情報
   * @sideEffect 上部を描き直す
   */
  private async refreshShops(route: CmsRoute, info: CmsShopInfoDto): Promise<void> {
    const log = logger.fn('refreshShops');
    const shops = await this.services.shops.execute();
    if (!shops.ok) return log.fail(undefined, shops.error.code);
    this.shops = shops.value;
    this.renderHeader(route, info);
    return log.exit(undefined);
  }

  /**
   * お店の切り替え（地区ごとのまとまり）を作る。
   * @param route ルート
   * @param info 店の情報
   * @returns select 要素
   */
  private shopSelect(route: CmsRoute, info: CmsShopInfoDto): HTMLSelectElement {
    const log = logger.fn('shopSelect', { spotId: info.id });
    const groups = new Map<string, CmsShopSummaryDto[]>();
    for (const shop of this.shops) groups.set(shop.districtName, [...(groups.get(shop.districtName) ?? []), shop]);
    const select = h('select', { class: 'cms-input cms-shop-select', attrs: { id: 'cms-shop', 'data-testid': 'cms-shop-select' } },
      [...groups].map(([district, shops]) => h('optgroup', { attrs: { label: district } }, shops.map((s) =>
        h('option', { attrs: { value: s.id, selected: s.id === info.id }, text: shopOptionText(s) })))));
    select.addEventListener('change', () => window.location.assign(cmsHashOf(select.value, route.page)));
    return log.exit(select);
  }

  /**
   * 上部（タイトル・お店の切り替え・デモの今日・使い方・アプリを開く）を描く。
   * @param route ルート
   * @param info 店の情報
   * @sideEffect 上部を描き直す
   */
  private renderHeader(route: CmsRoute, info: CmsShopInfoDto): void {
    const log = logger.fn('renderHeader', { spotId: info.id });
    const guide = createButton({ label: '使い方', icon: '?', variant: 'ghost', testId: 'cms-open-guide', onClick: () => openCmsGuide(this.shell) });
    this.header.replaceChildren(
      h('div', { class: 'cms-header__brand' }, [
        h('span', { class: 'cms-header__title', text: 'かよいまち お店の管理画面' }),
        h('span', { class: 'cms-badge cms-badge--ink', text: 'デモ' }),
      ]),
      h('div', { class: 'cms-header__shop' }, [h('label', { class: 'cms-header__label', attrs: { for: 'cms-shop' }, text: 'お店（デモ用の切り替え）' }), this.shopSelect(route, info)]),
      h('div', { class: 'cms-header__tools' }, [
        h('p', { class: 'cms-header__date', attrs: { 'data-testid': 'cms-today', title: 'アプリのデモの日付です' }, text: `デモの今日 ${shortDate(info.today)}` }),
        guide,
        h('a', { class: 'cms-link', attrs: { href: './', target: APP_WINDOW_NAME, 'data-testid': 'cms-open-app' }, text: 'アプリを開く ↗' }),
      ]),
    );
    log.exit(undefined);
  }

  /**
   * ページの切り替えを描く。
   * @param route ルート
   * @param spotId 店
   * @sideEffect ページの切り替えを描き直す
   */
  private renderNav(route: CmsRoute, spotId: string): void {
    const log = logger.fn('renderNav', { page: route.page });
    this.nav.replaceChildren(...CMS_PAGES.map((page) => h('a', {
      class: ['cms-nav__item', page === route.page && 'cms-nav__item--active'],
      attrs: { href: cmsHashOf(spotId, page), 'aria-current': page === route.page ? 'page' : undefined, 'data-testid': `cms-nav-${page}` },
      text: CMS_PAGE_LABELS[page],
    })));
    log.exit(undefined);
  }
}
