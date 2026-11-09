/**
 * @file 地図画面（presentation/screens/Map 層）
 * 3段階ズーム（広域・地区・近接）、デモの歩行と発見、地区の成長・色あせの Canvas 描画、下シートをまとめる（CLAUDE.md 6.2、docs/08 §6）。
 * データは services.map／services.position から取得する（mount 時・歩行停止時・発見時）。ズーム状態は ctx.ui に保ち、画面をまたいで復元する。
 * 読み上げ・E2E 用に、canvas の上へ不可視のスポット一覧（data-testid="map-spot"／"map-district"、data-x/y は canvas 内 CSS px）を置く。
 */
import '@/presentation/screens/Map/MapScreen.css';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { textScaleFactor } from '@/Common/ui/a11y/textScale';
import { beginFrame, createCanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSize, CanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { h } from '@/Common/ui/dom';
import { createTopBar } from '@/Common/ui/TopBar';
import { userAction } from '@/Common/ui/userAction';
import type { DiscoveredSpotDto, OtherTravelerDto } from '@/application/dto/Dto';
import { DISCOVERY_RADIUS_M } from '@/domain/exploration/constants';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import { DISCOVERY_RING_MS, MAP_COLORS, drawMap, pulseActive } from '@/presentation/screens/Map/MapCanvas';
import type { DiscoveryRing, DistrictPulse } from '@/presentation/screens/Map/MapCanvas';
import {
  CAMERA_TRANSITION_MS,
  buildMapViewModel,
  cameraFor,
  distanceMeters,
  districtAt,
  easeInOutCubic,
  findDistrict,
  hitTestDistrict,
  hitTestSpot,
  interpolateCamera,
  isInView,
  project,
  screenDistricts,
  screenSpots,
  spotAriaLabel,
  unproject,
} from '@/presentation/screens/Map/MapViewModel';
import type { Camera, LatLng, MapDistrictVm, MapSpotVm, MapViewModel, ScreenDistrict, ScreenSpot, Viewport } from '@/presentation/screens/Map/MapViewModel';
import { MAP_SHEET_PEEK_REM, createMapSheet } from '@/presentation/screens/Map/Sheet/MapSheet';
import type { MapSheetHandle } from '@/presentation/screens/Map/Sheet/MapSheet';
import { createWalker, discoverNearby } from '@/presentation/screens/Map/Walker';
import type { Walker } from '@/presentation/screens/Map/Walker';
import { WIDE_ZOOM, backLabelOf, initialZoomState, nextZoomState } from '@/presentation/screens/Map/ZoomState';
import type { ZoomState } from '@/presentation/screens/Map/ZoomState';
import { createZoomToggle, middleDistrictOf } from '@/presentation/screens/Map/ZoomToggle';
import type { ZoomToggleHandle } from '@/presentation/screens/Map/ZoomToggle';
import { AVATAR_DOT_PX, SELF_AVATAR_SCALE, drawPeople, hitTestPerson, personMessageOf, placeTravelers, walkPhaseOf } from '@/presentation/screens/Map/mapPeople';
import { avatarLookOfTown, avatarSpriteFor } from '@/presentation/shared/avatarSprite';
import type { AvatarLook } from '@/presentation/shared/avatarSprite';
import type { PlacedPerson } from '@/presentation/screens/Map/mapPeople';

const logger = createLogger('presentation/screens/Map/MapScreen');

/** 広域の上部バーの見出し（舞台＝大阪・南森町周辺。docs/08 §9） */
export const MAP_TITLE = '南森町周辺';
/** 下シートのつまみの高さ（rem）。地図の下シートの実際のつまみ（MapSheet の MAP_SHEET_PEEK_REM）と同じ値を使う */
export const SHEET_PEEK_REM = MAP_SHEET_PEEK_REM;
/** 本番（GPS）で現在地と発見判定を取り直す間隔（ミリ秒） */
export const POSITION_POLL_MS = 5000;
/** ルートのフォントサイズが取れないときの既定（px） */
const DEFAULT_ROOT_FONT_PX = 16;

/**
 * 地図画面を作る。params.districtId があれば地区ズームで開く（無ければ ctx.ui の状態を復元、初回は広域）。
 * @param ctx 画面コンテキスト
 * @param params ルートのパラメータ（districtId は検証済み）
 * @returns 画面
 */
export function createMapScreen(ctx: AppContext, params: Readonly<Record<string, string>>): Screen {
  const log = logger.fn('createMapScreen', { districtId: params.districtId });
  return log.exit(new MapScreenController(ctx, params.districtId));
}

/**
 * 下シートのつまみで隠れる高さ（CSS px）を返す（ルートのフォントサイズ × SHEET_PEEK_REM）。
 * @returns 高さ（CSS px）
 */
function sheetPeekPx(): number {
  const log = logger.fn('sheetPeekPx');
  const raw = typeof getComputedStyle === 'function' ? Number.parseFloat(getComputedStyle(document.documentElement).fontSize) : Number.NaN;
  return log.exit((Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ROOT_FONT_PX) * SHEET_PEEK_REM);
}

/**
 * 画面座標を小数1桁に丸める（data-x/y 用）。
 * @param value CSS px
 * @returns 丸めた値
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 地図画面の本体（状態・DOM・描画ループ・歩行を持つ） */
class MapScreenController implements Screen {
  private zoomState: ZoomState;
  private topBar: HTMLElement | undefined;
  private srList: HTMLUListElement | undefined;
  private message: HTMLElement | undefined;
  private surface: CanvasSurface | undefined;
  private size: CanvasSize | undefined;
  private bottomInset = 0;
  private sheet: MapSheetHandle | undefined;
  private zoomToggle: ZoomToggleHandle | undefined;
  private walker: Walker | undefined;
  private vm: MapViewModel | undefined;
  /** ほかの旅人（地区単位。services.travelers が無い・失敗したときは空） */
  private travelers: readonly OtherTravelerDto[] = [];
  /** 直近のフレームで画面に置いたほかの旅人（タップ判定に使う） */
  private placedPeople: readonly PlacedPerson[] = [];
  /** 現在地（描画専用。保存・ログ出力しない） */
  private position: LatLng | undefined;
  /** カメラ遷移の開始カメラ（遷移中だけ） */
  private cameraFrom: Camera | undefined;
  private transitionStart = 0;
  private rings: DiscoveryRing[] = [];
  private pulse: DistrictPulse | undefined;
  private rafId: number | undefined;
  private pollTimer: number | undefined;
  private polling = false;
  private readonly unsubscribers: (() => void)[] = [];
  private destroyed = false;
  /** データ読み込みの世代（古い応答を捨てる） */
  private loadSeq = 0;
  /** 自分のアバターの装い（マイ街と同じ。読み込むまでは undefined＝人型のバッジ） */
  private avatarLook: AvatarLook | undefined;
  /** アバターが左を向いているか（最後に歩いた向きを保つ） */
  private facingLeft = false;

  /**
   * 地図画面を作る（DOM は mount で作る）。
   * @param ctx 画面コンテキスト
   * @param routeDistrictId ルートの地区ID（無ければ undefined）
   */
  constructor(
    private readonly ctx: AppContext,
    routeDistrictId: string | undefined,
  ) {
    this.zoomState = initialZoomState(routeDistrictId, { zoom: ctx.ui.zoom, districtId: ctx.ui.districtId });
  }

  /**
   * 上部バー・地図・スポット一覧・下シートを作り、データを読み込んで描く。
   * @param root 画面のルート要素（div.screen）
   * @sideEffect DOM を作る。イベント購読・歩行（デモ）または位置の定期取得（本番）を始める。services.map/position を呼ぶ
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount', { zoom: this.zoomState.zoom, districtId: this.zoomState.districtId, isDemo: this.ctx.services.isDemo });
    if (this.destroyed) return log.exit(undefined, 'unmount 済み');
    this.buildDom(root);
    this.subscribeEvents();
    if (this.ctx.services.demo !== undefined) {
      this.walker = createWalker(this.ctx, {
        onStep: (position): void => this.handleWalkStep(position),
        onDiscovered: (spots): void => this.handleDiscovered(spots),
        onStop: (arrived): void => this.handleWalkStop(arrived),
      });
    } else {
      this.startPolling();
    }
    this.saveZoom();
    void this.loadAvatar();
    await this.loadData();
    log.exit(undefined);
  }

  /**
   * 自分のアバターの装い（マイ街と同じ）を読み込む。取れなければ人型のバッジのまま描く。
   * 装いは訪問・着せ替えで変わるが、どちらも別画面の操作なので、地図を開くたびに1回読めば足りる。
   * @sideEffect services.myTown を呼ぶ。描画を予約する
   */
  private async loadAvatar(): Promise<void> {
    const log = logger.fn('loadAvatar');
    const town = await this.ctx.services.myTown.execute();
    if (this.destroyed) return log.exit(undefined, 'unmount 済み');
    if (!town.ok) return log.fail(undefined, town.error.code);
    this.avatarLook = avatarLookOfTown(town.value);
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * 描画ループ・タイマー・購読・歩行・下シート・canvas を止めて片付ける（mount 完了前でも安全）。
   * @sideEffect requestAnimationFrame・setInterval を取り消し、購読を解除する
   */
  unmount(): void {
    const log = logger.fn('unmount', { zoom: this.zoomState.zoom });
    this.destroyed = true;
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.walker?.destroy();
    for (const off of this.unsubscribers.splice(0)) off();
    this.sheet?.destroy();
    this.surface?.destroy();
    this.surface = undefined;
    log.exit(undefined);
  }

  // -------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------

  /**
   * 上部バー・地図領域（canvas・スポット一覧・案内・「広域／詳細」切替）・下シートを作る。
   * @param root 画面のルート要素
   * @sideEffect root に子要素を追加し、canvas のクリックを購読する
   */
  private buildDom(root: HTMLElement): void {
    const log = logger.fn('buildDom');
    const area = h('div', { class: 'map-area', attrs: { 'data-testid': 'map-area' } });
    this.topBar = this.createHeader();
    this.srList = h('ul', { class: 'sr-only map-sr-list', attrs: { 'aria-label': '地図に表示中のスポット', 'data-testid': 'map-spot-list' } });
    this.message = h('p', { class: 'map-area__message', attrs: { 'data-testid': 'map-message', role: 'status' }, text: '地図を読み込んでいます…' });
    this.sheet = createMapSheet(this.ctx, {
      onSpot: (spotId): void => this.ctx.router.navigate(`#/spot/${spotId}`),
      onDistrict: (districtId): void => this.focusDistrict(districtId),
    });
    root.append(this.topBar, area, this.sheet.element);
    this.bottomInset = sheetPeekPx();
    this.surface = createCanvasSurface(area, {
      onResize: (size): void => this.handleResize(size),
      testId: 'map-canvas',
      ariaLabel: '南森町周辺の地図',
      className: 'map-canvas',
    });
    this.zoomToggle = createZoomToggle({
      onWide: (): void => this.showWide(),
      onMiddle: (): void => this.showMiddle(),
      onDetail: (): void => this.showDetail(),
    });
    area.append(this.srList, this.message, this.zoomToggle.element);
    this.surface?.canvas.addEventListener('click', (event) => this.handleCanvasClick(event));
    if (this.surface === undefined) this.showMessage('この端末では地図を描けませんでした。');
    this.updateCanvasState();
    log.exit(undefined);
  }

  /**
   * 今のズームに合う上部バーを作る（広域は「南森町周辺」、地区・近接は戻るボタン＋地区名 Lv）。
   * @returns header 要素
   */
  private createHeader(): HTMLElement {
    const log = logger.fn('createHeader', { zoom: this.zoomState.zoom, districtId: this.zoomState.districtId });
    const backLabel = backLabelOf(this.zoomState);
    if (backLabel === undefined) return log.exit(createTopBar({ title: MAP_TITLE, subtitle: '地区をタップすると拡大します' }));
    const district = this.focusedDistrict();
    return log.exit(
      createTopBar({
        title: district?.title ?? '現在地の周辺',
        subtitle: district?.subtitle,
        back: { label: backLabel, testId: 'map-back', onClick: (): void => this.handleBack() },
      }),
    );
  }

  /**
   * 上部バーを今のズームに合わせて作り直す。
   * @sideEffect 上部バーの要素を差し替える
   */
  private renderHeader(): void {
    const log = logger.fn('renderHeader', { zoom: this.zoomState.zoom });
    const next = this.createHeader();
    this.topBar?.replaceWith(next);
    this.topBar = next;
    log.exit(undefined);
  }

  /**
   * 読み上げ・E2E 用のスポット一覧を作り直す（最終カメラでの画面座標。広域は地区ボタンも並べる）。
   * @sideEffect スポット一覧の子要素を置き換える
   */
  private renderSpotList(): void {
    const log = logger.fn('renderSpotList', { zoom: this.zoomState.zoom });
    const list = this.srList;
    const vm = this.vm;
    const vp = this.viewport();
    if (list === undefined || vm === undefined || vp === undefined) return log.exit(undefined, '準備中');
    const camera = cameraFor(this.zoomState, vm, this.position, vp);
    const buttons: HTMLElement[] = [];
    if (this.zoomState.zoom === 'wide') for (const d of screenDistricts(vm, camera, vp)) buttons.push(this.districtButton(d));
    for (const s of screenSpots(vm, this.zoomState.zoom, camera, vp)) if (isInView(s, vp)) buttons.push(this.spotButton(s));
    list.replaceChildren(...buttons.map((button) => h('li', {}, [button])));
    log.exit({ items: buttons.length });
  }

  /**
   * スポット一覧のボタンを作る（押すとスポット詳細。未発見は案内のトースト）。
   * @param s 画面座標つきのスポット
   * @returns button 要素
   */
  private spotButton(s: ScreenSpot): HTMLButtonElement {
    const log = logger.fn('spotButton', { spotId: s.spot.id, status: s.spot.status });
    const meters = this.position === undefined ? undefined : distanceMeters(this.position, s.spot.position);
    const attrs = {
      type: 'button',
      'data-testid': 'map-spot',
      'data-spot-id': s.spot.id,
      'data-status': s.spot.status,
      'data-kind': s.spot.kind,
      'data-x': round1(s.x),
      'data-y': round1(s.y),
      'aria-label': spotAriaLabel(s.spot, meters),
    };
    return log.exit(h('button', { attrs, on: { click: userAction('map-spot', () => this.openSpot(s.spot)) } }));
  }

  /**
   * 広域の地区ボタンを作る（押すと地区ズーム）。data-x/y はポリゴンの重心。
   * @param d 画面座標つきの地区
   * @returns button 要素
   */
  private districtButton(d: ScreenDistrict): HTMLButtonElement {
    const log = logger.fn('districtButton', { districtId: d.district.id });
    const attrs = {
      type: 'button',
      'data-testid': 'map-district',
      'data-district-id': d.district.id,
      'data-level': d.district.level,
      'data-fade': d.district.fadeKind,
      'data-x': round1(d.anchor.x),
      'data-y': round1(d.anchor.y),
      'aria-label': `${d.district.title}${d.district.subtitle === undefined ? '' : ` ${d.district.subtitle}`}`,
    };
    return log.exit(h('button', { attrs, on: { click: userAction('map-district', () => this.focusDistrict(d.district.id)) } }));
  }

  /**
   * canvas の data-* に今の状態（ズーム・地区・歩行中・読み込み済み）を出す（E2E が待ち合わせに使う）。「広域／詳細」切替の押下状態も合わせる。
   * @sideEffect canvas の data 属性と切替ボタンの aria-pressed を変更する
   */
  private updateCanvasState(): void {
    const log = logger.fn('updateCanvasState', { zoom: this.zoomState.zoom });
    this.zoomToggle?.update(this.zoomState.zoom);
    const canvas = this.surface?.canvas;
    if (canvas === undefined) return log.exit(undefined);
    canvas.dataset.zoom = this.zoomState.zoom;
    canvas.dataset.walking = String(this.walker?.isWalking() === true);
    canvas.dataset.ready = String(this.vm !== undefined);
    if (this.zoomState.districtId === undefined) delete canvas.dataset.districtId;
    else canvas.dataset.districtId = this.zoomState.districtId;
    log.exit(undefined);
  }

  /**
   * 地図の上に案内文を出す（undefined で消す）。
   * @param text 案内文
   * @sideEffect 案内要素の文言と表示を変更する
   */
  private showMessage(text: string | undefined): void {
    const log = logger.fn('showMessage', { visible: text !== undefined });
    if (this.message === undefined) return log.exit(undefined);
    this.message.textContent = text ?? '';
    this.message.hidden = text === undefined;
    log.exit(undefined);
  }

  // -------------------------------------------------------------------------
  // データ
  // -------------------------------------------------------------------------

  /**
   * 地図データ・現在地・ほかの旅人を取得して描き直し、下シートも更新する（古い応答は捨てる）。
   * ほかの旅人が取れなくても地図は描く（ほかの旅人を描かないだけ）。
   * @sideEffect services.map・services.position・services.travelers・下シートの refresh を呼ぶ
   */
  private async loadData(): Promise<void> {
    const seq = ++this.loadSeq;
    const log = logger.fn('loadData', { seq });
    const [map, position, travelers] = await Promise.all([
      this.ctx.services.map.execute(),
      this.ctx.services.position.execute(),
      this.ctx.services.travelers?.execute(),
    ]);
    if (this.destroyed || seq !== this.loadSeq) return log.exit(undefined, '古い読み込みを捨てました');
    if (!map.ok) {
      this.showMessage('地図を読み込めませんでした。少し待ってから開き直してください。');
      this.ctx.toast.show('地図を読み込めませんでした', { kind: 'error' });
      return log.fail(undefined, map.error.code);
    }
    if (!position.ok) log.warn('現在地を取得できませんでした', { code: position.error.code });
    else if (this.walker?.isWalking() !== true) this.position = { lat: position.value.lat, lng: position.value.lng };
    if (travelers !== undefined && !travelers.ok) log.warn('ほかの旅人を取得できませんでした', { code: travelers.error.code });
    this.travelers = travelers?.ok === true ? travelers.value : [];
    this.applyViewModel(buildMapViewModel(map.value));
    void this.sheet?.refresh();
    log.exit(undefined);
  }

  /**
   * 新しい描画データを反映する（ズームの補正・パルスの再生・上部バーと一覧の更新・再描画）。
   * @param vm 描画データ
   * @sideEffect 画面の状態と DOM を更新し、描画を予約する
   */
  private applyViewModel(vm: MapViewModel): void {
    const log = logger.fn('applyViewModel', { districts: vm.districts.length, spots: vm.spots.length });
    this.vm = vm;
    this.showMessage(undefined);
    this.normalizeZoom(vm);
    this.consumePulse(vm);
    this.renderHeader();
    this.renderSpotList();
    this.updateCanvasState();
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * ズーム状態をデータに合わせて補正する（無い地区→広域、現在地の無い近接→地区、近接は現在地の地区に合わせる）。
   * @param vm 描画データ
   * @sideEffect ズーム状態と ctx.ui を更新する
   */
  private normalizeZoom(vm: MapViewModel): void {
    const log = logger.fn('normalizeZoom', { zoom: this.zoomState.zoom, districtId: this.zoomState.districtId });
    const id = this.zoomState.districtId;
    if (id !== undefined && findDistrict(vm, id) === undefined) this.zoomState = WIDE_ZOOM;
    if (this.zoomState.zoom === 'near' && this.position === undefined) this.zoomState = nextZoomState(this.zoomState, { type: 'back' });
    if (this.zoomState.zoom === 'near' && this.position !== undefined) {
      this.zoomState = nextZoomState(this.zoomState, { type: 'locate', districtId: districtAt(vm, this.position) });
    }
    this.saveZoom();
    log.exit({ zoom: this.zoomState.zoom, districtId: this.zoomState.districtId });
  }

  /**
   * ctx.ui.pulseDistrictId があれば地区パルスを一度だけ再生して消す。
   * @param vm 描画データ
   * @sideEffect ctx.ui.pulseDistrictId を消す
   */
  private consumePulse(vm: MapViewModel): void {
    const log = logger.fn('consumePulse', { districtId: this.ctx.ui.pulseDistrictId });
    const id = this.ctx.ui.pulseDistrictId;
    if (id === undefined || findDistrict(vm, id) === undefined) return log.exit(undefined);
    this.ctx.ui.pulseDistrictId = undefined;
    this.pulse = { districtId: id, startedAt: performance.now() };
    log.exit(undefined);
  }

  /**
   * 地区の成長・復活イベントを購読し、地図表示中ならパルスで知らせる。
   * @sideEffect services.events に購読を登録する（unmount で解除）
   */
  private subscribeEvents(): void {
    const log = logger.fn('subscribeEvents');
    const events = this.ctx.services.events;
    this.unsubscribers.push(
      events.subscribe('DistrictGrown', (event): void => this.handleDistrictChanged(event.districtId)),
      events.subscribe('DistrictRevived', (event): void => this.handleDistrictChanged(event.districtId)),
    );
    this.subscribeFontLoads();
    log.exit(undefined);
  }

  /**
   * Web フォント（丸ゴシック）の読み込みが終わったら地図を描き直す（Canvas の文字は最初の1枚だけ代替フォントで描かれるため）。
   * @sideEffect document.fonts に loadingdone のリスナを登録する（unmount で解除）
   */
  private subscribeFontLoads(): void {
    const log = logger.fn('subscribeFontLoads');
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (fonts === undefined || typeof fonts.addEventListener !== 'function') return log.exit(undefined, 'FontFaceSet なし');
    /**
     * フォントの読み込み後に地図を描き直す。
     * @sideEffect 次のフレームの描画を予約する
     */
    const redraw = (): void => this.requestDraw();
    fonts.addEventListener('loadingdone', redraw);
    this.unsubscribers.push((): void => fonts.removeEventListener('loadingdone', redraw));
    void fonts.ready.then(redraw);
    log.exit(undefined);
  }

  /**
   * 地区が成長・復活したらパルスを予約してデータを読み直す。
   * @param districtId 地区ID
   * @sideEffect ctx.ui.pulseDistrictId を設定し、データを読み直す
   */
  private handleDistrictChanged(districtId: string): void {
    const log = logger.fn('handleDistrictChanged', { districtId });
    if (this.destroyed) return log.exit(undefined);
    this.ctx.ui.pulseDistrictId = districtId;
    void this.loadData();
    log.exit(undefined);
  }

  /**
   * 本番（GPS）で現在地と発見判定を定期的に取り直す。
   * @sideEffect setInterval を登録する（unmount で解除）
   */
  private startPolling(): void {
    const log = logger.fn('startPolling', { intervalMs: POSITION_POLL_MS });
    this.pollTimer = window.setInterval(() => void this.pollPosition(), POSITION_POLL_MS);
    log.exit(undefined);
  }

  /**
   * 現在地を取り直して発見判定を呼ぶ（本番のみ。前回が終わっていなければ何もしない）。
   * @sideEffect services.position・services.discover を呼ぶ。発見したらリング演出とデータの読み直し
   */
  private async pollPosition(): Promise<void> {
    const log = logger.fn('pollPosition', { busy: this.polling });
    if (this.polling || this.destroyed) return log.exit(undefined);
    this.polling = true;
    try {
      const result = await this.ctx.services.position.execute();
      if (this.destroyed) return log.exit(undefined);
      if (!result.ok) return log.fail(undefined, result.error.code);
      this.handleWalkStep({ lat: result.value.lat, lng: result.value.lng });
      const found = await discoverNearby(this.ctx);
      if (found.length > 0 && !this.destroyed) this.handleDiscovered(found);
      log.exit({ found: found.length });
    } finally {
      this.polling = false;
    }
  }

  // -------------------------------------------------------------------------
  // 操作
  // -------------------------------------------------------------------------

  /**
   * canvas のタップを処理する（広域は地区ズーム、地区・近接はスポット詳細または歩行）。
   * @param event クリックイベント
   * @sideEffect 相関ID を発行する。ズーム・遷移・歩行を行う
   */
  private handleCanvasClick(event: MouseEvent): void {
    setCorrelationId();
    const log = logger.fn('handleCanvasClick', { zoom: this.zoomState.zoom });
    const canvas = this.surface?.canvas;
    const vm = this.vm;
    const vp = this.viewport();
    if (canvas === undefined || vm === undefined || vp === undefined) return log.exit(undefined, '準備中');
    const rect = canvas.getBoundingClientRect();
    const tap = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const camera = this.displayCamera(performance.now(), vm, vp);
    if (this.zoomState.zoom === 'wide') this.tapWide(tap, vm, camera, vp);
    else this.tapZoomed(tap, vm, camera, vp);
    log.exit(undefined);
  }

  /**
   * 広域でのタップ: 地区ポリゴンの中なら地区ズームへ。
   * @param tap タップした点（canvas 内 CSS px）
   * @param vm 描画データ
   * @param camera 表示中のカメラ
   * @param vp 描画領域
   * @sideEffect ズームを変える。地区外ならトーストで案内する
   */
  private tapWide(tap: Point2D, vm: MapViewModel, camera: Camera, vp: Viewport): void {
    const log = logger.fn('tapWide');
    const hit = hitTestDistrict(screenDistricts(vm, camera, vp), tap);
    if (hit === undefined) {
      this.ctx.toast.show('地区をタップすると拡大します');
      return log.exit(undefined, '地区の外');
    }
    this.focusDistrict(hit.district.id);
    log.exit(undefined);
  }

  /**
   * 地区・近接でのタップ: スポット（22px 以内）ならスポット詳細、ほかの旅人ならその人の案内、それ以外はデモならそこへ歩く
   * （人が歩く速さで。中間＝地区ズームは表示を保ち、詳細＝近接は現在地を追いかける）。
   * 本番（GPS）は歩かず、地区ズームなら近接に切り替えるだけ。
   * @param tap タップした点（canvas 内 CSS px）
   * @param vm 描画データ
   * @param camera 表示中のカメラ
   * @param vp 描画領域
   * @sideEffect 遷移・ズーム変更・歩行開始・トースト表示を行う
   */
  private tapZoomed(tap: Point2D, vm: MapViewModel, camera: Camera, vp: Viewport): void {
    const log = logger.fn('tapZoomed', { zoom: this.zoomState.zoom });
    const hit = hitTestSpot(screenSpots(vm, this.zoomState.zoom, camera, vp), tap);
    if (hit !== undefined) {
      this.openSpot(hit.spot);
      return log.exit(undefined, 'スポット');
    }
    const person = hitTestPerson(this.placedPeople, tap);
    if (person !== undefined) {
      this.ctx.toast.show(personMessageOf(person.traveler, findDistrict(vm, person.traveler.districtId)?.name));
      return log.exit(undefined, 'ほかの旅人');
    }
    const here = this.position;
    if (this.walker === undefined) {
      if (here !== undefined && this.zoomState.zoom === 'district') this.setZoom(nextZoomState(this.zoomState, { type: 'walk', districtId: districtAt(vm, here) }));
      else this.ctx.toast.show('現在地はGPSで更新されます');
      return log.exit(undefined, '本番は歩かない');
    }
    const target = unproject(camera, vp, tap);
    const from = here ?? target;
    // 中間（地区ズーム）は表示を変えずに歩く（地図の上を人が歩いて見える）。詳細は現在地を追いかけて地区名を合わせる
    if (this.zoomState.zoom === 'near') this.setZoom(nextZoomState(this.zoomState, { type: 'walk', districtId: districtAt(vm, from) }));
    // 表示中の縮尺を渡し、どの表示でも画面上で同じ速さで歩かせる
    this.walker.walkTo(from, target, camera.metersPerPx);
    this.updateCanvasState();
    log.exit(undefined, '歩行');
  }

  /**
   * スポット詳細へ移る（未発見は名前を出さず、近づくよう案内する）。
   * @param spot スポット
   * @sideEffect ルーターで '#/spot/<id>' へ移る、またはトーストを出す
   */
  private openSpot(spot: MapSpotVm): void {
    const log = logger.fn('openSpot', { spotId: spot.id, status: spot.status });
    if (spot.status === 'unknown') {
      this.ctx.toast.show(`${DISCOVERY_RADIUS_M}m以内に近づくと見つかります`);
      return log.exit(undefined, '未発見');
    }
    this.ctx.router.navigate(`#/spot/${spot.id}`);
    log.exit(undefined);
  }

  /**
   * 地区ズームにする（広域の地区タップ・下シートの地区カード・スポット一覧の地区ボタン）。
   * @param districtId 地区ID
   * @sideEffect ズームを変える
   */
  private focusDistrict(districtId: string): void {
    const log = logger.fn('focusDistrict', { districtId });
    this.setZoom(nextZoomState(this.zoomState, { type: 'selectDistrict', districtId }));
    log.exit(undefined);
  }

  /**
   * 上部バーの戻る（近接→地区→広域）。
   * @sideEffect ズームを変える
   */
  private handleBack(): void {
    const log = logger.fn('handleBack', { zoom: this.zoomState.zoom });
    this.setZoom(nextZoomState(this.zoomState, { type: 'back' }));
    log.exit(undefined);
  }

  /**
   * 「広域」切替: 市全体を表示する（すでに広域なら何もしない）。
   * @sideEffect ズームを変える
   */
  private showWide(): void {
    const log = logger.fn('showWide', { zoom: this.zoomState.zoom });
    if (this.zoomState.zoom === 'wide') return log.exit(undefined, '広域のまま');
    this.setZoom(nextZoomState(this.zoomState, { type: 'reset' }));
    log.exit(undefined);
  }

  /**
   * 「中間」切替: 地区全体を表示する（いま見ている地区 → 現在地の地区 → 現在地にいちばん近い地区）。決められなければ案内だけ出す。
   * @sideEffect ズームを変える、またはトーストを出す
   */
  private showMiddle(): void {
    const log = logger.fn('showMiddle', { zoom: this.zoomState.zoom });
    const vm = this.vm;
    if (vm === undefined) return log.exit(undefined, '準備中');
    if (this.zoomState.zoom === 'district') return log.exit(undefined, '中間のまま');
    const here = this.position;
    const districtId = middleDistrictOf(vm.districts, this.zoomState.districtId, here, here === undefined ? undefined : districtAt(vm, here));
    if (districtId === undefined) {
      this.ctx.toast.show('地区をタップすると、その地区を表示します');
      return log.exit(undefined, '地区を決められない');
    }
    this.focusDistrict(districtId);
    log.exit(undefined);
  }

  /**
   * 「詳細」切替: 現在地のまわり（近接）を表示する。現在地が分からなければ案内だけ出す。
   * @sideEffect ズームを変える、またはトーストを出す
   */
  private showDetail(): void {
    const log = logger.fn('showDetail', { zoom: this.zoomState.zoom });
    const here = this.position;
    const vm = this.vm;
    if (here === undefined || vm === undefined) {
      this.ctx.toast.show('現在地を確認できると、まわりを詳しく表示できます');
      return log.exit(undefined, '現在地なし');
    }
    if (this.zoomState.zoom === 'near') return log.exit(undefined, '詳細のまま');
    this.setZoom(nextZoomState(this.zoomState, { type: 'detail', districtId: districtAt(vm, here) }));
    log.exit(undefined);
  }

  /**
   * ズーム状態を変え、表示中のカメラから新しいカメラへ 350ms で遷移させる。
   * @param next 次のズーム状態
   * @sideEffect ctx.ui・上部バー・スポット一覧・canvas の data 属性を更新し、描画を予約する
   */
  private setZoom(next: ZoomState): void {
    const log = logger.fn('setZoom', { from: this.zoomState.zoom, to: next.zoom, districtId: next.districtId });
    const vm = this.vm;
    const vp = this.viewport();
    if (vm !== undefined && vp !== undefined) {
      const now = performance.now();
      this.cameraFrom = this.displayCamera(now, vm, vp);
      this.transitionStart = now;
    }
    this.zoomState = next;
    this.saveZoom();
    this.renderHeader();
    this.renderSpotList();
    this.updateCanvasState();
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * ズーム状態を ctx.ui に保存する（画面をまたいで復元するため）。
   * @sideEffect ctx.ui.zoom・ctx.ui.districtId を書き換える
   */
  private saveZoom(): void {
    const log = logger.fn('saveZoom', { zoom: this.zoomState.zoom, districtId: this.zoomState.districtId });
    this.ctx.ui.zoom = this.zoomState.zoom;
    this.ctx.ui.districtId = this.zoomState.districtId;
    log.exit(undefined);
  }

  // -------------------------------------------------------------------------
  // 歩行の通知
  // -------------------------------------------------------------------------

  /**
   * 1刻み進んだ（または本番で現在地が更新された）: 現在地を更新し、近接なら地区名を合わせて描き直す。
   * @param position 新しい現在地
   * @sideEffect 現在地・ズーム状態を更新し、描画を予約する
   */
  private handleWalkStep(position: LatLng): void {
    const log = logger.fn('handleWalkStep', { zoom: this.zoomState.zoom });
    this.position = position;
    const vm = this.vm;
    if (vm !== undefined) {
      const next = nextZoomState(this.zoomState, { type: 'locate', districtId: districtAt(vm, position) });
      if (next !== this.zoomState) {
        this.zoomState = next;
        this.saveZoom();
        this.renderHeader();
        this.updateCanvasState();
      }
    }
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * スポットを発見した: 発見リングを再生し、データを読み直して「？」をシルエットにする（トーストは表示済み）。
   * @param spots 新しく発見したスポット
   * @sideEffect リング演出を始め、データを読み直す
   */
  private handleDiscovered(spots: readonly DiscoveredSpotDto[]): void {
    const log = logger.fn('handleDiscovered', { count: spots.length });
    const now = performance.now();
    for (const spot of spots) this.rings.push({ spotId: spot.id, startedAt: now });
    void this.loadData();
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * 歩行が終わった: データ（地図・現在地・下シート）を読み直す。
   * @param arrived 目的地に着いたら true
   * @sideEffect データを読み直し、canvas の data 属性を更新する
   */
  private handleWalkStop(arrived: boolean): void {
    const log = logger.fn('handleWalkStop', { arrived });
    this.updateCanvasState();
    void this.loadData();
    log.exit(undefined);
  }

  // -------------------------------------------------------------------------
  // 描画
  // -------------------------------------------------------------------------

  /**
   * canvas の大きさが変わった: 大きさを覚え、一覧を作り直して描き直す（遷移は打ち切る）。
   * @param size 新しい大きさ
   * @sideEffect スポット一覧を作り直し、描画を予約する
   */
  private handleResize(size: CanvasSize): void {
    const log = logger.fn('handleResize', { width: size.width, height: size.height, dpr: size.dpr });
    this.size = size;
    this.cameraFrom = undefined;
    this.renderSpotList();
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * 描画領域（下シートのつまみで隠れる高さを含む）を返す。
   * @returns 描画領域（canvas がまだ無ければ undefined）
   */
  private viewport(): Viewport | undefined { // audit-ignore: fnlog-missing 毎フレーム描画
    if (this.size === undefined) return undefined;
    return { width: this.size.width, height: this.size.height, bottomInset: this.bottomInset };
  }

  /**
   * 表示中のカメラを返す（遷移中は開始カメラから目標カメラへイージングで補間。終われば遷移を消す）。
   * @param t 現在時刻（performance.now()）
   * @param vm 描画データ
   * @param vp 描画領域
   * @returns カメラ
   */
  private displayCamera(t: number, vm: MapViewModel, vp: Viewport): Camera { // audit-ignore: fnlog-missing 毎フレーム描画
    const target = cameraFor(this.zoomState, vm, this.position, vp);
    if (this.cameraFrom === undefined) return target;
    const progress = (t - this.transitionStart) / CAMERA_TRANSITION_MS;
    if (progress >= 1) {
      this.cameraFrom = undefined;
      return target;
    }
    return interpolateCamera(this.cameraFrom, target, easeInOutCubic(progress));
  }

  /**
   * 次のフレームでの描画を予約する（予約済みなら何もしない）。
   * @sideEffect requestAnimationFrame を登録する
   */
  private requestDraw(): void { // audit-ignore: fnlog-missing 毎フレーム描画
    if (this.destroyed || this.rafId !== undefined) return;
    this.rafId = requestAnimationFrame(() => this.drawFrame());
  }

  /**
   * 1フレーム描く（地図のあとに、ほかの旅人と自分のアイコンを重ねる）。カメラ遷移・発見リング・地区パルス・歩行が続いていれば次のフレームも予約する。
   * @sideEffect canvas に描画する。ほかの旅人の画面位置（タップ判定用）を更新する。描画に失敗したら error ログを残す
   */
  private drawFrame(): void { // audit-ignore: fnlog-missing 毎フレーム描画
    this.rafId = undefined;
    const surface = this.surface;
    const size = this.size;
    const vp = this.viewport();
    if (this.destroyed || surface === undefined || size === undefined || vp === undefined) return;
    const t = performance.now();
    beginFrame(surface.ctx, size);
    const vm = this.vm;
    if (vm === undefined) return this.drawEmpty(surface.ctx, size);
    this.rings = this.rings.filter((ring) => t - ring.startedAt < DISCOVERY_RING_MS);
    if (!pulseActive(this.pulse, t)) this.pulse = undefined;
    // 歩行中は記録の刻み（10m）を待たず、時間に合わせてなめらかに進んだ位置を描く（カメラ追従・80m円・自分のアイコン）
    const live = this.walker?.livePosition(t);
    if (live !== undefined) this.position = live;
    const camera = this.displayCamera(t, vm, vp);
    const zoom = this.zoomState.zoom;
    const textScale = textScaleFactor();
    const walkPhase = live === undefined ? undefined : walkPhaseOf(t);
    const heading = this.walker?.heading();
    if (heading !== undefined && heading !== 0) this.facingLeft = heading < 0;
    const avatar = this.avatarLook === undefined ? undefined : avatarSpriteFor(this.avatarLook, { scale: SELF_AVATAR_SCALE[zoom], dotPx: AVATAR_DOT_PX, dpr: size.dpr });
    try {
      drawMap(
        surface.ctx,
        {
          vm,
          camera,
          viewport: vp,
          zoom,
          focusDistrictId: this.zoomState.districtId,
          position: this.position,
          footprints: this.ctx.ui.footprints,
          rings: this.rings,
          pulse: this.pulse,
          textScale,
        },
        t,
      );
      const self = this.position === undefined ? undefined : project(camera, vp, this.position);
      // 広域ではほかの旅人を描かない（ピン・地区の札・名前と重なるため。地区・詳細に拡大すると出る）
      this.placedPeople = placeTravelers(zoom === 'wide' ? [] : this.travelers, vm, { camera, viewport: vp, zoom, self });
      drawPeople(surface.ctx, { people: this.placedPeople, self, zoom, textScale, walkPhase, avatar, facingLeft: this.facingLeft, dpr: size.dpr });
    } catch (error) {
      this.reportDrawError(error);
      return;
    }
    if (this.cameraFrom !== undefined || this.rings.length > 0 || this.pulse !== undefined || this.walker?.isWalking() === true) this.requestDraw();
  }

  /**
   * データ読み込み前の背景（陸の色）を描く。
   * @param ctx 2D コンテキスト
   * @param size canvas の大きさ
   * @sideEffect canvas に描画する
   */
  private drawEmpty(ctx: CanvasRenderingContext2D, size: CanvasSize): void { // audit-ignore: fnlog-missing 毎フレーム描画
    ctx.fillStyle = MAP_COLORS.land;
    ctx.fillRect(0, 0, size.width, size.height);
  }

  /**
   * 描画の例外を記録する（描画ループは止める。次の操作・データ更新で再開する）。
   * @param error 捕捉した例外
   * @sideEffect error ログを残す
   */
  private reportDrawError(error: unknown): void {
    const log = logger.fn('reportDrawError', { zoom: this.zoomState.zoom });
    log.error('地図の描画に失敗しました', { error });
    log.exit(undefined);
  }

  /**
   * 注目している地区を返す。
   * @returns 地区（無ければ undefined）
   */
  private focusedDistrict(): MapDistrictVm | undefined {
    const id = this.zoomState.districtId;
    const log = logger.fn('focusedDistrict', { districtId: id });
    return log.exit(this.vm === undefined || id === undefined ? undefined : findDistrict(this.vm, id), id);
  }
}
