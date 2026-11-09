/**
 * @file 近くのリスト（地図の上から開く一覧。presentation/screens/Map/town 層）
 * 2026-11-09 ユーザー指示「近くのものの表示が地図下部に出ているけど、上部にボタン設置して、リスト表示できるようにしてほしい」。
 * 地図の下シートをやめ、上部の「近く」ボタンで開く一覧にした。中身は下シートと同じ部品（近くのスポット・クエスト・地区のようす）をタブで切り替える。
 * 開くたび・地図のデータが変わるたびに nearby・reasons・town を並列に読み直す。押したスポットは地図でそこへ向かい（MapScreen）、一覧は閉じる。
 */
import type { NearbySpotDto, RevisitReasonDto, TownStateDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';
import type { AppContext } from '@/presentation/App/AppContext';
import { createDistrictCardList } from '@/presentation/screens/Map/Sheet/DistrictCardList';
import { createNearbySpotList } from '@/presentation/screens/Map/Sheet/NearbySpotList';
import { createRevisitReasonList } from '@/presentation/screens/Map/Sheet/RevisitReasonList';
import { UNKNOWN_SPOT_MESSAGE } from '@/presentation/screens/Map/Sheet/sheetModel';
import { createMapUiIcon } from '@/presentation/screens/Map/town/mapUiIcons';
import '@/presentation/screens/Map/Sheet/MapSheet.css';
import '@/presentation/screens/Map/town/mapTownUi.css';

const logger = createLogger('presentation/screens/Map/town/NearbyPanel');

/** 近くのスポットを何件まで出すか */
export const NEARBY_PANEL_LIMIT = 12;

/** タブの種類 */
export type NearbyTab = 'nearby' | 'quest' | 'district';

/** タブの見出し */
const TABS: readonly { readonly id: NearbyTab; readonly label: string }[] = [
  { id: 'nearby', label: '近く' },
  { id: 'quest', label: 'クエスト' },
  { id: 'district', label: '地区' },
];

/** 一覧の操作 */
export interface NearbyPanelHandle {
  /** 上部に置く「近く」ボタン */
  readonly button: HTMLButtonElement;
  /** 一覧（地図の領域に重ねる） */
  readonly element: HTMLElement;
  /** 開いていれば読み直す（閉じていれば次に開くときに読む） */
  refresh(): void;
  isOpen(): boolean;
  close(): void;
}

/** 一覧からの要求 */
export interface NearbyPanelHandlers {
  onSpot(spotId: string): void;
  onDistrict(districtId: string): void;
}

/** 一覧に出すデータ */
interface PanelData {
  readonly nearby: readonly NearbySpotDto[];
  readonly reasons: readonly RevisitReasonDto[];
  readonly town: TownStateDto;
}

/**
 * 「近く」ボタンと一覧を作る（最初は閉じている）。
 * @param ctx 画面コンテキスト
 * @param handlers スポット・地区が押されたとき
 * @returns 操作
 */
export function createNearbyPanel(ctx: AppContext, handlers: NearbyPanelHandlers): NearbyPanelHandle {
  const log = logger.fn('createNearbyPanel');
  return log.exit(new NearbyPanel(ctx, handlers));
}

/** 近くのリストの本体 */
class NearbyPanel implements NearbyPanelHandle {
  readonly button: HTMLButtonElement;
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<NearbyTab, HTMLButtonElement>();
  private readonly count: HTMLElement;
  private tab: NearbyTab = 'nearby';
  private open = false;
  private data: PanelData | undefined;
  private seq = 0;

  /**
   * ボタンと一覧の DOM を作る。
   * @param ctx 画面コンテキスト
   * @param handlers スポット・地区が押されたとき
   */
  constructor(
    private readonly ctx: AppContext,
    private readonly handlers: NearbyPanelHandlers,
  ) {
    this.count = h('span', { class: 'map-nearby-open__count', attrs: { 'aria-hidden': 'true' }, text: '' });
    this.button = h(
      'button',
      {
        class: ['map-filter-bar__prefs', 'map-nearby-open'],
        attrs: { type: 'button', 'aria-expanded': 'false', 'aria-label': '近くのリスト', 'data-testid': 'map-nearby-open' },
        on: { click: userAction('map-nearby-open', () => this.toggle()) },
      },
      [createMapUiIcon('pin', 16, 'map-filter-bar__icon'), h('span', { class: 'map-filter-bar__label', text: '近く' }), this.count],
    );
    const tabs = h(
      'div',
      { class: 'map-nearby__tabs', attrs: { role: 'tablist' } },
      TABS.map((t) => {
        const b = h('button', {
          class: 'map-nearby__tab',
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(t.id === this.tab), 'data-tab': t.id },
          text: t.label,
          on: { click: userAction('map-nearby-tab', () => this.selectTab(t.id)) },
        });
        this.tabButtons.set(t.id, b);
        return b;
      }),
    );
    const close = h('button', { class: 'map-nearby__close', attrs: { type: 'button', 'aria-label': '閉じる', 'data-testid': 'map-nearby-close' }, on: { click: userAction('map-nearby-close', () => this.close()) } }, [createIcon('close')]);
    this.body = h('div', { class: 'map-nearby__body' });
    this.element = h('section', { class: 'map-nearby', attrs: { 'data-testid': 'map-nearby', 'aria-label': '近くのリスト', 'data-open': '0' } }, [h('div', { class: 'map-nearby__head' }, [tabs, close]), this.body]);
    this.element.hidden = true;
  }

  /**
   * 開いているか。
   * @returns 開いていれば true
   */
  isOpen(): boolean {
    return this.open;
  }

  /**
   * 開く・閉じるを切り替える。
   * @sideEffect 一覧を開閉する
   */
  private toggle(): void {
    const log = logger.fn('toggle', { open: this.open });
    if (this.open) this.close();
    else this.show();
    log.exit(undefined);
  }

  /**
   * 開いて読み直す。
   * @sideEffect 一覧を出し、データを読む
   */
  private show(): void {
    const log = logger.fn('show');
    this.open = true;
    this.element.hidden = false;
    this.element.dataset.open = '1';
    this.button.setAttribute('aria-expanded', 'true');
    this.button.dataset.active = '1';
    if (this.data === undefined) this.body.replaceChildren(h('p', { class: ['hint', 'map-sheet__empty'], text: '読み込み中…' }));
    else this.render();
    void this.load();
    log.exit(undefined);
  }

  /**
   * 閉じる。
   * @sideEffect 一覧を隠す
   */
  close(): void {
    const log = logger.fn('close', { open: this.open });
    this.open = false;
    this.element.hidden = true;
    this.element.dataset.open = '0';
    this.button.setAttribute('aria-expanded', 'false');
    delete this.button.dataset.active;
    log.exit(undefined);
  }

  /**
   * 開いていれば読み直す。閉じていてもボタンの件数は更新する。
   * @sideEffect データを読む
   */
  refresh(): void {
    const log = logger.fn('refresh', { open: this.open });
    void this.load();
    log.exit(undefined);
  }

  /**
   * タブを切り替える。
   * @param tab タブ
   * @sideEffect 中身を描き直す
   */
  private selectTab(tab: NearbyTab): void {
    const log = logger.fn('selectTab', { tab });
    this.tab = tab;
    for (const [id, b] of this.tabButtons) b.setAttribute('aria-selected', String(id === tab));
    this.render();
    log.exit(undefined);
  }

  /**
   * nearby・reasons・town を並列に読み、開いていれば描き直す（古い応答は捨てる）。
   * @sideEffect services を呼ぶ
   */
  private async load(): Promise<void> {
    const seq = ++this.seq;
    const log = logger.fn('load', { seq });
    const s = this.ctx.services;
    const [nearby, reasons, town] = await Promise.all([s.nearby.execute({ limit: NEARBY_PANEL_LIMIT }), s.reasons.execute(), s.town.execute()]);
    if (seq !== this.seq) return log.exit(undefined, '古い読み込み');
    if (!nearby.ok || !reasons.ok || !town.ok) {
      if (this.open && this.data === undefined) this.body.replaceChildren(h('p', { class: ['hint', 'map-sheet__empty'], text: '読み込めませんでした' }));
      return log.fail(undefined, '読み込み失敗');
    }
    this.data = { nearby: nearby.value, reasons: reasons.value, town: town.value };
    const visitable = nearby.value.filter((n) => n.canVisit).length;
    this.count.textContent = visitable > 0 ? String(visitable) : '';
    this.count.hidden = visitable === 0;
    if (this.open) this.render();
    log.exit(undefined, `近く ${nearby.value.length}・クエスト ${reasons.value.length}`);
  }

  /**
   * 今のタブの中身を描く。
   * @sideEffect 中身を差し替える
   */
  private render(): void {
    const log = logger.fn('render', { tab: this.tab });
    const data = this.data;
    if (data === undefined) return log.exit(undefined);
    /**
     * 項目が押されたら一覧を閉じてから要求を伝える受け口を作る。
     * @param fn 要求を伝える処理
     * @returns 受け口
     */
    const pick = (fn: (v: string) => void) => (v: string): void => { // audit-ignore: fnlog-missing 一覧の項目ごとの小さな受け口
      this.close();
      fn(v);
    };
    let content: HTMLElement;
    if (this.tab === 'nearby') {
      content = createNearbySpotList(data.nearby, { onSpot: pick((id) => this.handlers.onSpot(id)), onUnknown: (): void => this.ctx.toast.show(UNKNOWN_SPOT_MESSAGE, { kind: 'info' }) });
    } else if (this.tab === 'quest') {
      content = createRevisitReasonList(data.reasons, (target): void => {
        this.close();
        if (target.kind === 'spot') this.handlers.onSpot(target.id);
        else this.handlers.onDistrict(target.id);
      });
    } else content = createDistrictCardList(data.town.districts, pick((id) => this.handlers.onDistrict(id)));
    this.body.replaceChildren(content);
    this.body.scrollTop = 0;
    log.exit(undefined);
  }
}
