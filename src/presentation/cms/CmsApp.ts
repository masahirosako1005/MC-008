/**
 * @file 店舗CMS のシェル（presentation/cms 層。docs/09 §5・§7.2 フェーズ1）
 * 上部バー（ロゴ・「デモ」のメニュー・ページのタブ・お店の切り替え・アプリを開く）と本文。ルートは '#/<スポットID>/<ページ>'。
 * - デモ用のもの（デモの日付・リセット、スマホでは「アプリを開く」も）は「デモ」の札のメニューにまとめる（業務の画面に並べない）
 * - 本文は各画面が「左：見え方／右：フォーム」で組む。スマホ幅では見え方を全画面のシート（dialog）で開く（openPreview）。
 *   開いている間は後ろ（上部バー・本文へ移動・フォーム）を inert にし、Tab はシートの中だけを回る。Esc・×で閉じて「見え方」ボタンに戻る
 * - 通知は一度に1つだけ（前のものを消してから出す）
 * - 保存前の入力（draft）はページやお店を移っても残す。お店の情報だけは、未保存のまま移るときに確認し、タブに点を付ける
 * - ページを移ったら見出し（h1）にフォーカスを移す
 */
import '@/Common/ui/styles/tokens.css';
import '@/Common/ui/styles/base.css';
import '@/Common/ui/styles/components.css';
import '@/presentation/cms/cms.css';
import type { CmsShopInfoDto, CmsShopSummaryDto } from '@/application/dto/CmsDto';
import type { CmsServices } from '@/application/CmsServices';
import { createLogger } from '@/Common/logging/logger';
import { clear, h } from '@/Common/ui/dom';
import { openModal } from '@/Common/ui/Modal';
import { ToastHost } from '@/Common/ui/Toast';
import { CMS_PAGE_LABELS, CMS_PAGE_SHORT_LABELS, CMS_PAGES, cmsHashOf, parseCmsHash } from '@/presentation/cms/cmsRoute';
import type { CmsPage, CmsRoute } from '@/presentation/cms/cmsRoute';
import { APP_WINDOW_NAME, icon, markDanger, mdDate } from '@/presentation/cms/cmsUi';
import type { CmsContext, CmsNotifier, CmsScreen } from '@/presentation/cms/cmsUi';
import { renderCmsDataScreen } from '@/presentation/cms/screens/Data/CmsDataScreen';
import { renderCmsEventsScreen } from '@/presentation/cms/screens/Events/CmsEventsScreen';
import { renderCmsHomeScreen } from '@/presentation/cms/screens/Home/CmsHomeScreen';
import { renderCmsInfoScreen } from '@/presentation/cms/screens/Info/CmsInfoScreen';

const logger = createLogger('presentation/cms/CmsApp');

/** PC の配置になる幅（cms.css の @media (max-width: 959px) と合わせる） */
const WIDE_QUERY = '(min-width: 960px)';

/** Tab で移れる要素の選び方（シートの中を回すときに使う） */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** ページごとの画面 */
const SCREENS: Readonly<Record<CmsPage, CmsScreen>> = {
  home: renderCmsHomeScreen,
  info: renderCmsInfoScreen,
  events: renderCmsEventsScreen,
  data: renderCmsDataScreen,
};

/** 未保存の確認をするページと、その入力中の値の用途 */
const GUARDED_DRAFT: Readonly<Partial<Record<CmsPage, string>>> = { info: 'info' };

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
 * 「デモ」のメニューの開け閉めを結びつける（開くと最初の項目へフォーカス。Esc・外側のクリック・項目を選ぶと閉じ、Esc ならボタンにフォーカスを戻す）。
 * @param wrap メニューとボタンを含む要素（外側のクリックの判定に使う）
 * @param button 開け閉めのボタン
 * @param menu メニュー
 * @returns 閉じる関数（restoreFocus が true ならボタンにフォーカスを戻す）
 * @sideEffect 開いている間だけ document に click・keydown のリスナを付ける
 */
function bindDemoMenu(wrap: HTMLElement, button: HTMLButtonElement, menu: HTMLElement): (restoreFocus?: boolean) => void {
  const log = logger.fn('bindDemoMenu');
  /** 外側のクリックで閉じる */
  const onClick = (event: MouseEvent): void => { if (!(event.target instanceof Node) || !wrap.contains(event.target)) setOpen(false); }; // audit-ignore: fnlog-missing クリックのたびに呼ぶ判定
  /** Esc で閉じてボタンに戻る */
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false, true); }; // audit-ignore: fnlog-missing キーを押すたびに呼ぶ判定
  /** 開け閉めする */
  const setOpen = (open: boolean, restoreFocus = false): void => {
    const openLog = logger.fn('setDemoMenuOpen', { open });
    if ((menu.hidden === true) !== open) return openLog.exit(undefined, 'same');
    menu.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      document.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      [...menu.querySelectorAll<HTMLElement>('.cms-demo__item')].find((el) => el.getClientRects().length > 0)?.focus();
      return openLog.exit(undefined);
    }
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    if (restoreFocus) button.focus();
    return openLog.exit(undefined);
  };
  button.addEventListener('click', () => setOpen(menu.hidden === true));
  return log.exit((restoreFocus = false) => setOpen(false, restoreFocus));
}

/** 店舗CMS のシェル */
export class CmsApp {
  private readonly shell = h('div', { class: 'cms-app', attrs: { 'data-modal-host': true } });
  private readonly header = h('header', { class: 'cms-topbar' });
  private readonly main = h('main', { class: 'cms-main', attrs: { 'data-testid': 'cms-main' } });
  /** 本文へ移動（ハッシュはルートに使うので、リンクではなくボタンでフォーカスを移す） */
  private readonly skip = h('button', { class: 'cms-skip', attrs: { type: 'button' }, text: '本文へ移動', on: { click: () => this.main.focus() } });
  private readonly toastHost: ToastHost;
  private readonly notifier: CmsNotifier;
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
  /** いま表示しているルートと店 */
  private current: { readonly route: CmsRoute; readonly info: CmsShopInfoDto } | undefined;

  /**
   * シェルを組み立てる。
   * @param root 入れる要素（#cms）
   * @param services 店舗CMS のサービス
   */
  constructor(private readonly root: HTMLElement, private readonly services: CmsServices) {
    const toastLayer = h('div', { class: 'cms-toast-host' });
    this.toastHost = new ToastHost(toastLayer);
    this.notifier = {
      show: (message, kind = 'success'): void => {
        this.toastHost.clear();
        this.toastHost.show(message, { kind });
      },
    };
    this.main.tabIndex = -1;
    this.shell.addEventListener('cms-close-preview', () => this.setPreviewOpen(false, true));
    // PC の幅に広げたら、シートは閉じる（PC では見え方が左に常に出ている）
    if (typeof window.matchMedia === 'function') window.matchMedia(WIDE_QUERY).addEventListener('change', (event) => { if (event.matches) this.setPreviewOpen(false, false); });
    this.shell.append(this.skip, this.header, this.main, toastLayer);
    this.root.replaceChildren(this.shell);
  }

  /** シートを開いている間のキー（Esc で閉じる。Tab はシートの中だけを回す） */
  private readonly onPreviewKey = (event: KeyboardEvent): void => { // audit-ignore: fnlog-missing キーを押すたびに呼ぶ振り分け（ログは setPreviewOpen・keepFocusInSheet が出す）
    if (event.key === 'Escape') this.setPreviewOpen(false, true);
    else if (event.key === 'Tab') this.keepFocusInSheet(event);
  };

  /**
   * Tab・Shift+Tab でシートの端から出るときに、反対の端へ回す（シートの外にフォーカスがあれば中へ戻す）。
   * @param event Tab の keydown
   * @sideEffect 端のときだけ既定の移動を止めてフォーカスを移す
   */
  private keepFocusInSheet(event: KeyboardEvent): void {
    const log = logger.fn('keepFocusInSheet', { shift: event.shiftKey });
    const sheet = this.main.querySelector<HTMLElement>('.cms-layout__preview');
    const items = sheet === null ? [] : [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && el.closest('[inert]') === null);
    const first = items[0];
    const last = items[items.length - 1];
    if (sheet === null || first === undefined || last === undefined) return log.exit(undefined, 'none');
    const active = document.activeElement;
    const inside = active instanceof Node && sheet.contains(active);
    const next = event.shiftKey ? (!inside || active === first ? last : undefined) : (!inside || active === last ? first : undefined);
    if (next === undefined) return log.exit(undefined, 'pass');
    event.preventDefault();
    next.focus();
    return log.exit(undefined, 'wrap');
  }

  /**
   * スマホ幅の「見え方」のシートを開け閉めする（dialog として扱う）。
   * 開くとき：シートに role="dialog"・aria-modal を付け、後ろ（上部バー・本文へ移動・フォーム）を inert にし、ページのスクロールを止めて×へフォーカスを移す。
   * 閉じるとき：それらをすべて外し、restoreFocus なら見えている「見え方」ボタンへフォーカスを戻す。
   * @param open 開くなら true
   * @param restoreFocus 閉じたあと「見え方」ボタンへフォーカスを戻すか（描き直しのときは false）
   * @sideEffect shell・html のクラス、シートとフォームの属性、document の keydown リスナを変える
   */
  private setPreviewOpen(open: boolean, restoreFocus: boolean): void {
    const log = logger.fn('setPreviewOpen', { open, restoreFocus });
    const sheet = this.main.querySelector<HTMLElement>('.cms-layout__preview');
    const form = this.main.querySelector<HTMLElement>('.cms-layout__form');
    const wasOpen = this.shell.classList.contains('cms-app--preview-open');
    this.shell.classList.toggle('cms-app--preview-open', open);
    document.documentElement.classList.toggle('cms-scroll-lock', open);
    for (const el of [this.header, this.skip, form]) if (el !== null) el.inert = open;
    if (open) {
      sheet?.setAttribute('role', 'dialog');
      sheet?.setAttribute('aria-modal', 'true');
      document.addEventListener('keydown', this.onPreviewKey);
      sheet?.querySelector<HTMLElement>('[data-testid="cms-close-preview"]')?.focus();
      return log.exit(undefined);
    }
    sheet?.removeAttribute('role');
    sheet?.removeAttribute('aria-modal');
    document.removeEventListener('keydown', this.onPreviewKey);
    if (restoreFocus && wasOpen) [...this.main.querySelectorAll<HTMLElement>('[data-testid="cms-open-preview"]')].find((el) => el.getClientRects().length > 0)?.focus();
    return log.exit(undefined);
  }

  /**
   * 起動する（店の一覧を読み、ハッシュの変化を監視して最初の画面を出す）。
   * @sideEffect hashchange・beforeunload を監視し、画面を描く
   */
  async start(): Promise<void> {
    const log = logger.fn('start');
    const shops = await this.services.shops.execute();
    if (!shops.ok) {
      this.main.replaceChildren(h('p', { class: 'cms-error', text: '読み込めませんでした' }));
      return log.fail(undefined, shops.error.code);
    }
    this.shops = shops.value;
    window.addEventListener('hashchange', () => void this.show());
    window.addEventListener('beforeunload', (event) => {
      if (this.dirty.size === 0) return;
      event.preventDefault();
      // 古い仕様のブラウザ（Chromium 系の一部）は returnValue が空でないと確認を出さない
      event.returnValue = 'unsaved';
    });
    await this.show();
    return log.exit(undefined);
  }

  /**
   * 今のハッシュの画面を出す（店が無い・不正なら既定の店へ）。
   * @sideEffect 本文・上部バーを描き直す
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
      this.notifier.show('お店を開けませんでした', 'error');
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
      this.main.replaceChildren(h('p', { class: 'cms-error', text: 'お店がありません' }));
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
      toast: this.notifier,
      info,
      go: (page): void => this.guardLeave(() => window.location.assign(cmsHashOf(info.id, page))),
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
        const before = this.dirty.has(keyOf(key));
        if (isDirty) this.dirty.add(keyOf(key));
        else this.dirty.delete(keyOf(key));
        if (before !== isDirty) this.renderHeader(route, info);
      },
      hasSeen: (page): boolean => this.seen.get(info.id)?.has(page) === true,
      openPreview: (): void => {
        this.setPreviewOpen(true, false);
        // シートが見えてから、見え方の列に「開いた」と知らせる（枠の中を対象の部分まで動かし直す）
        requestAnimationFrame(() => this.main.querySelector('.cms-preview-col')?.dispatchEvent(new Event('cms-preview-opened')));
      },
    });
  }

  /**
   * 上部バーと本文を描く。ページを移ったときだけ見出しにフォーカスを移す。
   * @param route ルート（店は検証済み）
   * @param info 店の情報
   * @sideEffect DOM を描き直す
   */
  private render(route: CmsRoute, info: CmsShopInfoDto): void {
    const log = logger.fn('render', { page: route.page, spotId: info.id });
    this.current = { route, info };
    const ctx = this.contextOf(route, info);
    this.renderHeader(route, info);
    this.main.querySelectorAll('[data-dispose]').forEach((el) => el.dispatchEvent(new Event('cms-dispose')));
    this.setPreviewOpen(false, false);
    clear(this.main);
    this.main.dataset.page = route.page;
    this.main.append(SCREENS[route.page](ctx));
    const seen = this.seen.get(info.id) ?? new Set<CmsPage>();
    seen.add(route.page);
    this.seen.set(info.id, seen);
    const place = `${info.id}/${route.page}`;
    if (this.shown !== undefined && this.shown !== place) {
      this.main.querySelector<HTMLElement>('.cms-title__text')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
    this.shown = place;
    log.exit(undefined);
  }

  /**
   * 店の一覧を読み直す。
   * @param route ルート
   * @param info 店の情報
   * @sideEffect 上部バーを描き直す
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
   * お店の切り替え（協力店・その他に分ける。店名だけ）を作る。
   * @param route ルート
   * @param info 店の情報
   * @returns select 要素
   */
  private shopSelect(route: CmsRoute, info: CmsShopInfoDto): HTMLSelectElement {
    const log = logger.fn('shopSelect', { spotId: info.id });
    const groups = [{ label: '協力店', shops: this.shops.filter((s) => s.partner) }, { label: 'その他', shops: this.shops.filter((s) => !s.partner) }];
    const select = h('select', { class: 'cms-select cms-topbar__shop', attrs: { 'aria-label': 'お店を切り替え', 'data-testid': 'cms-shop-select' } },
      groups.map((g) => h('optgroup', { attrs: { label: g.label } }, g.shops.map((s) => h('option', { attrs: { value: s.id, selected: s.id === info.id }, text: s.name })))));
    select.addEventListener('change', () => {
      const next = cmsHashOf(select.value, route.page);
      this.guardLeave(() => window.location.assign(next), () => { select.value = info.id; });
    });
    return log.exit(select);
  }

  /**
   * ページのタブを作る（未保存の変更があるタブには点）。
   * @param route ルート
   * @param spotId 店
   * @returns nav 要素
   */
  private tabs(route: CmsRoute, spotId: string): HTMLElement {
    const log = logger.fn('tabs', { page: route.page });
    const items = CMS_PAGES.map((page) => {
      const href = cmsHashOf(spotId, page);
      const draftKey = GUARDED_DRAFT[page];
      const unsaved = draftKey !== undefined && this.dirty.has(`${spotId}:${draftKey}`);
      return h('a', {
        class: ['cms-tab', page === route.page && 'cms-tab--active', unsaved && 'cms-tab--dirty'],
        attrs: { href, 'aria-current': page === route.page ? 'page' : undefined, 'data-testid': `cms-nav-${page}` },
        on: { click: (event) => { event.preventDefault(); if (page !== route.page) this.guardLeave(() => window.location.assign(href)); } },
      }, [
        h('span', { class: 'cms-tab__long', text: CMS_PAGE_LABELS[page] }),
        h('span', { class: 'cms-tab__short', attrs: { 'aria-hidden': 'true' }, text: CMS_PAGE_SHORT_LABELS[page] }),
        unsaved ? h('span', { class: 'cms-visually-hidden', text: '（未保存の変更あり）' }) : undefined,
      ]);
    });
    return log.exit(h('nav', { class: 'cms-tabs', attrs: { 'aria-label': 'ページ' } }, items));
  }

  /**
   * 上部バー（ロゴ・「デモ」のメニュー・タブ・お店の切り替え・アプリを開く）を描く。
   * @param route ルート
   * @param info 店の情報
   * @sideEffect 上部バーを描き直す
   */
  private renderHeader(route: CmsRoute, info: CmsShopInfoDto): void {
    const log = logger.fn('renderHeader', { spotId: info.id });
    this.header.replaceChildren(
      this.brand(info),
      this.tabs(route, info.id),
      h('div', { class: 'cms-topbar__tools' }, [
        h('span', { class: 'cms-selectwrap' }, [this.shopSelect(route, info), icon('chevronRight', 'cms-selectwrap__icon')]),
        h('a', { class: 'cms-topbar__app', attrs: { href: './', target: APP_WINDOW_NAME, 'data-testid': 'cms-open-app' } }, ['アプリを開く', icon('arrowRight', 'cms-icon-external')]),
      ]),
    );
    log.exit(undefined);
  }

  /**
   * ロゴと「デモ」のメニュー（デモの日付・アプリを開く（スマホだけ）・リセット）を作る。
   * @param info 店の情報
   * @returns 要素
   */
  private brand(info: CmsShopInfoDto): HTMLElement {
    const log = logger.fn('brand', { today: info.today });
    const button = h('button', { class: 'cms-demo', attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'cms-demo-menu', 'aria-label': 'デモのメニュー', 'data-testid': 'cms-demo' } }, [
      h('span', { class: 'cms-demo__pill' }, ['デモ', icon('chevronRight', 'cms-demo__caret')]),
    ]);
    const menu = h('div', { class: 'cms-demo__menu', attrs: { id: 'cms-demo-menu', hidden: true, 'data-testid': 'cms-demo-menu' } }, [
      h('p', { class: 'cms-demo__date', attrs: { 'data-testid': 'cms-today' }, text: `デモの日付 ${mdDate(info.today)}` }),
      h('a', { class: 'cms-demo__item cms-only-narrow', attrs: { href: './', target: APP_WINDOW_NAME, 'data-testid': 'cms-demo-app' }, on: { click: () => close() } }, ['アプリを開く', icon('arrowRight', 'cms-icon-external')]),
      h('button', { class: 'cms-demo__item', attrs: { type: 'button', 'data-testid': 'cms-reset' }, text: 'リセット', on: { click: () => { close(); this.confirmReset(); } } }),
    ]);
    const wrap = h('div', { class: 'cms-topbar__brand' }, [h('span', { class: 'cms-topbar__logo', text: 'まちクエ お店管理' }), button, menu]);
    const close = bindDemoMenu(wrap, button, menu);
    return log.exit(wrap);
  }

  /**
   * デモのデータを消す確認を出す（「消す」は朱にせず、白地に誤りの色の文字）。
   * @sideEffect 確認のモーダルを開く
   */
  private confirmReset(): void {
    const log = logger.fn('confirmReset');
    const modal = openModal({
      title: 'デモのデータを消しますか？', body: '', host: this.shell, testId: 'cms-reset-modal',
      actions: [
        { label: 'やめる', variant: 'secondary', testId: 'cms-reset-cancel', onClick: (): void => undefined },
        { label: '消す', variant: 'secondary', testId: 'cms-reset-confirm', onClick: (): void => { void this.reset(); } },
      ],
    });
    markDanger(modal, 'cms-reset-confirm');
    log.exit(undefined);
  }

  /**
   * デモのデータを消し、入力中の値・未保存の印・開いたページの記録も空にして、今のページを描き直す。
   * @sideEffect 店舗CMS の登録内容を消し、通知を出して画面を描き直す
   */
  private async reset(): Promise<void> {
    const log = logger.fn('reset');
    const result = await this.services.resetDemo.execute();
    if (!result.ok) {
      this.notifier.show('消せませんでした', 'error');
      return log.fail(undefined, result.error.code);
    }
    this.drafts.clear();
    this.dirty.clear();
    this.seen.clear();
    this.notifier.show('リセットしました');
    this.shown = undefined;
    await this.show();
    return log.exit(undefined);
  }

  /**
   * 未保存の変更があるまま別のページ・お店へ移ろうとしたら確認する（無ければすぐ移る。「破棄して移動」は朱にしない）。
   * @param proceed 移る処理
   * @param onStay 移らなかったときの処理（お店の切り替えを元に戻すなど）
   * @sideEffect 必要なら確認のモーダルを開く
   */
  private guardLeave(proceed: () => void, onStay?: () => void): void {
    const log = logger.fn('guardLeave', { page: this.current?.route.page });
    const page = this.current?.route.page;
    const key = page === undefined ? undefined : GUARDED_DRAFT[page];
    const spotId = this.current?.info.id;
    if (spotId === undefined || key === undefined || !this.dirty.has(`${spotId}:${key}`)) {
      proceed();
      return log.exit(undefined, 'clean');
    }
    let leaving = false;
    const modal = openModal({
      title: '未保存の変更があります', body: '', host: this.shell, testId: 'cms-leave-modal',
      onClose: () => { if (!leaving) onStay?.(); },
      actions: [
        { label: '戻る', variant: 'secondary', testId: 'cms-leave-back', onClick: (): void => undefined },
        {
          label: '破棄して移動', variant: 'secondary', testId: 'cms-leave-anyway',
          onClick: (): void => {
            leaving = true;
            this.drafts.delete(`${spotId}:${key}`);
            this.dirty.delete(`${spotId}:${key}`);
            proceed();
          },
        },
      ],
    });
    markDanger(modal, 'cms-leave-anyway');
    return log.exit(undefined, 'asked');
  }
}
