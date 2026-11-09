/**
 * @file 地図画面（presentation/screens/Map 層）— 2026-11-09 に作り直し
 * 実在の地理（OSM）ではなく、スポットの位置と地区の形から作ったオリジナルの「ドット絵の街」（town/townGenerator）を描く。
 * - ドラッグで地図を動かす・2本指やホイールで拡大縮小（town/mapCamera）。街は市域の外まで続くので、どこにも空白ができない
 * - お店をタップすると、自分のアイコンが道に沿ってそこまで歩き（town/townPath、デモ）、着いたらお店カードでチェックインできる（town/SpotCard）
 * - チェックインできる範囲の円（VISIT_RADIUS_M）の中なら、カードからチェックインできる
 * - 看板商品のアイコン・今日だけ・クーポンの印、便利情報フィルタ（今日だけ／ベビーカー／トイレ…）、好み・行きたいのハート（town/townScene）
 * - 陣取り: 訪問したスポットのまわりが自分の陣地になり、チェックインのたびに広がる演出（town/territory）
 * 下シート・広域／中間／詳細の切替・ほかの旅人・自分のアバターは従来の部品を使う。読み上げ・E2E 用に不可視のスポット一覧も置く。
 * 位置座標はログに出さない（件数・ID・距離だけ）。
 */
import '@/presentation/screens/Map/MapScreen.css';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { textScaleFactor } from '@/Common/ui/a11y/textScale';
import { beginFrame, createCanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSize, CanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { h, setStyle } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { createTopBar } from '@/Common/ui/TopBar';
import { userAction } from '@/Common/ui/userAction';
import type { DiscoveredSpotDto, MapDataDto, OtherTravelerDto, SpotDetailDto } from '@/application/dto/Dto';
import { VISIT_RADIUS_M } from '@/domain/exploration/constants';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import { boundsOf, buildMapViewModel, distanceMeters, districtAt, findDistrict, fitBounds, project, unproject, usableHeight } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, GeoBounds, LatLng, MapViewModel, Viewport } from '@/presentation/screens/Map/MapViewModel';
import { createWalker, discoverNearby } from '@/presentation/screens/Map/Walker';
import type { Walker } from '@/presentation/screens/Map/Walker';
import { createZoomToggle, middleDistrictOf } from '@/presentation/screens/Map/ZoomToggle';
import type { ZoomToggleHandle } from '@/presentation/screens/Map/ZoomToggle';
import { AVATAR_DOT_PX, SELF_AVATAR_SCALE, drawPeople, hitTestPerson, personMessageOf, placeTravelers, walkPhaseOf } from '@/presentation/screens/Map/mapPeople';
import type { PlacedPerson } from '@/presentation/screens/Map/mapPeople';
import { createMapFilterBar } from '@/presentation/screens/Map/town/MapFilterBar';
import { createNearbyPanel } from '@/presentation/screens/Map/town/NearbyPanel';
import type { NearbyPanelHandle } from '@/presentation/screens/Map/town/NearbyPanel';
import type { MapFilterBarHandle } from '@/presentation/screens/Map/town/MapFilterBar';
import { openMapPrefsPanel } from '@/presentation/screens/Map/town/MapPrefsPanel';
import { createSpotCard } from '@/presentation/screens/Map/town/SpotCard';
import type { SpotCardHandle, SpotCardPhase } from '@/presentation/screens/Map/town/SpotCard';
import { MapCameraController } from '@/presentation/screens/Map/town/mapCamera';
import { MapEffects } from '@/presentation/screens/Map/town/mapEffects';
import { CheckInShow, IMPACT_MS } from '@/presentation/screens/Map/town/checkinShow';
import { buzz, playCoin, playFanfare, playGrow, playPress, playStamp, unlockSound } from '@/presentation/screens/Map/town/mapSound';
import { openQrScan } from '@/presentation/screens/Map/town/QrScanSheet';
import type { QrScanKind } from '@/presentation/screens/Map/town/QrScanSheet';
import { addPurchase, loadPurchases } from '@/presentation/screens/Map/town/purchaseLog';
import { createSideShopList } from '@/presentation/screens/Map/town/SideShopList';
import type { SideShopItem, SideShopListHandle } from '@/presentation/screens/Map/town/SideShopList';
import { ShopVoices } from '@/presentation/screens/Map/town/shopVoices';
import { drawDistrictBlocks, drawRisingBuildings, drawSelfBeacon, riseDuration, risingBuildingsOf } from '@/presentation/screens/Map/town/townSceneExtras';
import type { RiseAnimation } from '@/presentation/screens/Map/town/townSceneExtras';
import { loadMapPrefs, saveMapPrefs, toggleWant } from '@/presentation/screens/Map/town/mapPrefs';
import type { MapFilterId, MapPrefs } from '@/presentation/screens/Map/town/mapPrefs';
import { DETAIL_MPP, buildSceneSpots, cardModelOf, filterCounts, filterMatcher, highlightColorOf, paintStateOf, tierOf } from '@/presentation/screens/Map/town/mapSceneModel';
import { createMapUiIcon } from '@/presentation/screens/Map/town/mapUiIcons';
import { computeTerritory, emptyTerritory, newlyClaimed } from '@/presentation/screens/Map/town/territory';
import type { TerritoryModel } from '@/presentation/screens/Map/town/territory';
import { generateTown } from '@/presentation/screens/Map/town/townGenerator';
import { routeTo } from '@/presentation/screens/Map/town/townPath';
import { TownRenderer, gridTransform } from '@/presentation/screens/Map/town/townRenderer';
import {
  drawAttribution,
  drawCheckInCircle,
  drawClaimAnimation,
  drawDiscoveryRing,
  drawDistrictLabels,
  drawRoute,
  drawSpots,
  drawTerritoryEdges,
  hitTestScene,
  placeSpots,
} from '@/presentation/screens/Map/town/townScene';
import type { ClaimAnimation, PlacedSpot, SceneInput, SceneSpot, SceneTier } from '@/presentation/screens/Map/town/townScene';
import { CELL_M } from '@/presentation/screens/Map/town/townTypes';
import type { TownGrid } from '@/presentation/screens/Map/town/townTypes';
import { growthToastMessage, visitToastMessage } from '@/presentation/screens/Spot/spotDetailModel';
import { avatarLookOfTown, avatarSpriteFor } from '@/presentation/shared/avatarSprite';
import type { AvatarLook } from '@/presentation/shared/avatarSprite';
import { newOperationId } from '@/presentation/shared/operation';

const logger = createLogger('presentation/screens/Map/MapScreen');

/** 広域の上部バーの見出し（舞台＝南森町周辺。docs/08 §9） */
export const MAP_TITLE = '南森町周辺';
/** 本番（GPS）で現在地と発見判定を取り直す間隔（ミリ秒） */
export const POSITION_POLL_MS = 5000;
/** 発見の輪の時間（ミリ秒） */
const DISCOVERY_RING_MS = 700;
/** 歩き出すときに寄る縮尺の範囲（1 CSS px あたりのメートル） */
const WALK_VIEW_MPP: readonly [number, number] = [0.45, 1.5];
/** カメラを合わせるとき、上のフィルタの列で隠れる高さ（CSS px） */
const FOCUS_TOP_PX = 56;
/** 現在地ボタンで、これより引いて見ていたら寄る（1 CSS px あたりのメートル） */
const LOCATE_MAX_MPP = 1.5;
/** 現在地ボタンで寄るときの縮尺 */
const LOCATE_MPP = 0.9;
/** チェックインのスタンプを見せてから全画面の演出へ移るまでの時間（ミリ秒） */
const CHECKIN_STAMP_HOLD_MS = 900;
/** チェックインのとき、カメラを寄せる倍率（縮尺に掛ける） */
const PUNCH_ZOOM = 0.86;
/** ボタンの波紋を見せてから読み取り画面を開くまで（ミリ秒） */
const QR_OPEN_DELAY_MS = 140;
/** コイン（mapEffects の coins と合わせる）: 飛び始め・飛ぶ時間・1枚ごとの間・枚数（ミリ秒・枚） */
const COIN_START_MS = 120;
const COIN_FLIGHT_MS = 700;
const COIN_GAP_MS = 72;
const COIN_COUNT = 7;

/**
 * カードの補足の行（便利施設の場所の説明、またはお店のお買い物スタンプの数）。
 * @param amenityNote 便利施設の補足
 * @param purchases お買い物スタンプの数
 * @returns note を含むオブジェクト（無ければ空）
 */
function noteField(amenityNote: string | undefined, purchases: number | undefined): { note?: string } {
  const log = logger.fn('noteField', { purchases });
  if (amenityNote !== undefined) return log.exit({ note: amenityNote });
  return log.exit(purchases !== undefined && purchases > 0 ? { note: `お買い物スタンプ ${purchases}個` } : {});
}

/** 日付ごとの、この端末で地図からチェックインした数（「今日 n 軒目！」用。メモリのみ） */
const comboByDate = new Map<string, number>();

/**
 * 今日のチェックインの数を1つ増やして返す。
 * @param today 今日（YYYY-MM-DD）
 * @returns 増やした後の数
 * @sideEffect 数を覚える
 */
function bumpCombo(today: string): number {
  const log = logger.fn('bumpCombo', { today });
  const next = (comboByDate.get(today) ?? 0) + 1;
  comboByDate.set(today, next);
  return log.exit(next);
}
/** 自分のアバターを標準より大きく描く倍率（街に埋もれないように） */
const SELF_AVATAR_BOOST = 1.35;
/** 右の列を作り直す間隔（フレーム） */
const SIDE_LIST_EVERY_FRAMES = 20;
/** 着いたとみなす距離（メートル。これより近ければ歩かない） */
const ALREADY_THERE_M = 8;
/** 読み上げ用の一覧を作り直す間隔（フレーム） */
const SR_LIST_EVERY_FRAMES = 45;

/**
 * 指定の時間だけ待つ（演出の間を取る）。
 * @param ms 待つ時間（ミリ秒）
 * @returns 待ち終わる Promise
 */
function wait(ms: number): Promise<void> {
  const log = logger.fn('wait', { ms });
  return log.exit(new Promise((resolve) => window.setTimeout(resolve, ms)));
}

/** 作った街（同じ地図データなら作り直さない） */
let townCache: { readonly key: string; readonly grid: TownGrid } | undefined;

/**
 * 地図データから街を返す（スポットの並びと市域が同じなら前に作った街を使い回す）。
 * @param dto 地図データ
 * @returns 街
 */
function townFor(dto: MapDataDto): TownGrid {
  const b = dto.bounds;
  const key = `${b.south},${b.west},${b.north},${b.east}|${dto.spots.map((s) => `${s.id}@${s.lat},${s.lng}`).join(';')}|${dto.backdrop.amenityPoints.length}`;
  const log = logger.fn('townFor', { spots: dto.spots.length, cached: townCache?.key === key });
  if (townCache?.key === key) return log.exit(townCache.grid);
  const grid = generateTown({
    bounds: b,
    districts: dto.districts.map((d) => ({ id: d.id, polygon: d.polygon })),
    spots: dto.spots.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, kind: s.kind, ...(s.category === undefined ? {} : { category: s.category }) })),
    amenities: dto.backdrop.amenityPoints.map((a) => ({ id: a.id, lat: a.lat, lng: a.lng })),
  });
  townCache = { key, grid };
  return log.exit(grid);
}

/**
 * 街の範囲（緯度経度）を返す（カメラをこの中に収める）。
 * @param grid 街
 * @returns 範囲
 */
function townBounds(grid: TownGrid): GeoBounds {
  const log = logger.fn('townBounds', { cols: grid.cols, rows: grid.rows });
  return log.exit({
    north: grid.originLat,
    west: grid.originLng,
    south: grid.originLat - (grid.rows * CELL_M) / 111_000,
    east: grid.originLng + (grid.cols * CELL_M) / grid.metersPerDegLng,
  });
}

/**
 * 地図画面を作る。params.districtId があればその地区を映して開く（無ければ前の表示を復元、初回は広域）。
 * @param ctx 画面コンテキスト
 * @param params ルートのパラメータ（districtId は検証済み）
 * @returns 画面
 */
export function createMapScreen(ctx: AppContext, params: Readonly<Record<string, string>>): Screen {
  const log = logger.fn('createMapScreen', { districtId: params.districtId });
  return log.exit(new MapScreenController(ctx, params.districtId));
}

/** お店カードで見ているスポット */
interface CardTarget {
  readonly spotId: string;
  phase: SpotCardPhase;
  detail?: SpotDetailDto;
}

/** 地図画面の本体（状態・DOM・描画ループ・歩行・カード） */
class MapScreenController implements Screen {
  private topBar: HTMLElement | undefined;
  private headerKey = '';
  private srList: HTMLUListElement | undefined;
  private message: HTMLElement | undefined;
  private surface: CanvasSurface | undefined;
  private size: CanvasSize | undefined;
  private bottomInset = 0;
  /** 近くのリスト（上部の「近く」ボタンで開く。2026-11-09 に下シートから置き換え） */
  private nearby: NearbyPanelHandle | undefined;
  private zoomToggle: ZoomToggleHandle | undefined;
  private filterBar: MapFilterBarHandle | undefined;
  private locateButton: HTMLButtonElement | undefined;
  private card: SpotCardHandle | undefined;
  private hud: { root: HTMLElement; count: HTMLElement; delta: HTMLElement } | undefined;
  private cameraCtl: MapCameraController | undefined;
  private walker: Walker | undefined;
  private dto: MapDataDto | undefined;
  private vm: MapViewModel | undefined;
  private grid: TownGrid | undefined;
  private renderer: TownRenderer | undefined;
  private territory: TerritoryModel | undefined;
  private spots: SceneSpot[] = [];
  private placed: PlacedSpot[] = [];
  private prefs: MapPrefs = loadMapPrefs();
  private filters: ReadonlySet<MapFilterId> = new Set();
  private travelers: readonly OtherTravelerDto[] = [];
  private placedPeople: readonly PlacedPerson[] = [];
  /** 現在地（描画専用。保存・ログ出力しない） */
  private position: LatLng | undefined;
  private cardTarget: CardTarget | undefined;
  /** 歩いて向かっているスポット */
  private walkTarget: string | undefined;
  /** 歩いている自分をカメラが追うか（利用者が地図を動かしたらやめる） */
  private following = false;
  private rings: { spotId: string; startedAt: number }[] = [];
  private claim: ClaimAnimation | undefined;
  /** 地図の上の演出（チェックイン・発見・到着・成長・土ぼこり） */
  private readonly fx = new MapEffects();
  /** 気持ちいいチェックインの演出（ピンの弾み・光・星・ごほうびの帯） */
  private readonly show = new CheckInShow();
  /** 地図の領域（QR の読み取り画面を重ねる先） */
  private area: HTMLElement | undefined;
  /** 開いている QR の読み取り画面を閉じる関数 */
  private qrClose: (() => void) | undefined;
  /** 読み上げ用の知らせ（ごほうびの帯の内容を伝える） */
  private announcer: HTMLElement | undefined;
  /** お店の声（吹き出し） */
  private readonly voices = new ShopVoices();
  /** 領地が広がった所で建物が建ち上がる演出 */
  private rise: RiseAnimation | undefined;
  /** 中間の表示で右側に出す「映っているお店」の列 */
  private sideList: SideShopListHandle | undefined;
  private rafId: number | undefined;
  private pollTimer: number | undefined;
  private polling = false;
  private checkingIn = false;
  private frames = 0;
  private readonly unsubscribers: (() => void)[] = [];
  private destroyed = false;
  private loadSeq = 0;
  private avatarLook: AvatarLook | undefined;
  private facingLeft = false;

  /**
   * 地図画面を作る（DOM は mount で作る）。
   * @param ctx 画面コンテキスト
   * @param routeDistrictId ルートの地区ID（無ければ undefined）
   */
  constructor(
    private readonly ctx: AppContext,
    private readonly routeDistrictId: string | undefined,
  ) {}

  /**
   * 上部バー・地図・フィルタ・カード・下シートを作り、データを読み込んで描く。
   * @param root 画面のルート要素
   * @sideEffect DOM を作る。イベント購読・歩行（デモ）または位置の定期取得（本番）を始める
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount', { isDemo: this.ctx.services.isDemo });
    if (this.destroyed) return log.exit(undefined, 'unmount 済み');
    this.buildDom(root);
    this.subscribeEvents();
    if (this.ctx.services.demo !== undefined) {
      this.walker = createWalker(this.ctx, {
        onStep: (position): void => this.handleWalkStep(position),
        onDiscovered: (spots): void => this.handleDiscovered(spots),
        onStop: (arrived): void => this.handleWalkStop(arrived),
      });
    } else this.startPolling();
    void this.loadAvatar();
    await this.loadData();
    log.exit(undefined);
  }

  /**
   * 描画ループ・タイマー・購読・歩行・下シート・canvas を片付ける。
   * @sideEffect requestAnimationFrame・setInterval を取り消し、購読を解除する
   */
  unmount(): void {
    const log = logger.fn('unmount');
    this.saveCamera();
    this.destroyed = true;
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.qrClose?.();
    this.walker?.destroy();
    this.cameraCtl?.destroy();
    for (const off of this.unsubscribers.splice(0)) off();
    this.surface?.destroy();
    this.surface = undefined;
    this.renderer?.dispose();
    log.exit(undefined);
  }

  // -------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------

  /**
   * 上部バー・地図領域（canvas・フィルタ・切替・陣地の札・カード・一覧）・下シートを作る。
   * @param root 画面のルート要素
   * @sideEffect root に子要素を追加する
   */
  private buildDom(root: HTMLElement): void {
    const log = logger.fn('buildDom');
    const area = h('div', { class: 'map-area', attrs: { 'data-testid': 'map-area' } });
    this.area = area;
    this.announcer = h('p', { class: 'sr-only', attrs: { role: 'status', 'aria-live': 'polite' } });
    area.append(this.announcer);
    this.topBar = createTopBar({ title: MAP_TITLE });
    this.srList = h('ul', { class: 'sr-only map-sr-list', attrs: { 'aria-label': '地図に表示中のスポット', 'data-testid': 'map-spot-list' } });
    this.message = h('p', { class: 'map-area__message', attrs: { 'data-testid': 'map-message', role: 'status' }, text: '街を描いています…' });
    this.nearby = createNearbyPanel(this.ctx, {
      onSpot: (spotId): void => this.selectSpotById(spotId),
      onDistrict: (districtId): void => this.flyToDistrict(districtId),
    });
    root.append(this.topBar, area);
    // 下シートは置かない（地図の下側は隠れない）
    this.bottomInset = 0;
    this.surface = createCanvasSurface(area, { onResize: (size): void => this.handleResize(size), testId: 'map-canvas', ariaLabel: '南森町周辺のドット絵の地図', className: 'map-canvas' });
    if (this.surface !== undefined) setStyle(this.surface.canvas, 'cursor', 'grab');
    this.zoomToggle = createZoomToggle({ onWide: (): void => this.showWide(), onMiddle: (): void => this.showMiddle(), onDetail: (): void => this.showDetail() });
    this.filterBar = createMapFilterBar({ onChange: (active): void => this.handleFilters(active), onOpenPrefs: (): void => this.openPrefs() });
    // 上部のチップ列の先頭に「近く」ボタンを置く
    const track = this.filterBar.element.querySelector('.map-filter-bar__track');
    if (track !== null) track.prepend(this.nearby.button);
    else this.filterBar.element.prepend(this.nearby.button);
    this.card = createSpotCard({
      onCheckIn: (id): void => this.startQr('checkin', id),
      onPurchase: (id): void => this.startQr('purchase', id),
      onDetail: (id): void => this.ctx.router.navigate(`#/spot/${id}`),
      onToggleWant: (id): void => this.toggleWant(id),
      onClose: (): void => this.closeCard(),
    });
    this.locateButton = h('button', {
      class: 'map-locate',
      attrs: { type: 'button', 'aria-label': '現在地', 'data-testid': 'map-locate' },
      on: { click: userAction('map-locate', () => void this.locateMe()) },
    }, [createIcon('navigate')]);
    this.sideList = createSideShopList((id): void => this.selectSpotById(id));
    area.append(this.srList, this.message, this.filterBar.element, this.sideList.element, this.zoomToggle.element, this.locateButton, this.createHud(), this.card.element, this.nearby.element);
    if (this.surface === undefined) this.showMessage('この端末では地図を描けませんでした。');
    log.exit(undefined);
  }

  /**
   * 陣地の札（左下。旗＋「あなたの陣地 n マス」＋増えた数）を作る。
   * @returns 札の要素
   */
  private createHud(): HTMLElement {
    const log = logger.fn('createHud');
    const count = h('span', { class: 'map-territory-hud__count', text: '0マス' });
    const delta = h('span', { class: 'map-territory-hud__delta', text: '' });
    const root = h('div', { class: 'map-territory-hud', attrs: { 'data-testid': 'map-territory', role: 'status', 'aria-live': 'polite' } }, [
      createMapUiIcon('flag', 16, 'map-territory-hud__icon'),
      h('span', { class: 'map-territory-hud__label', text: 'あなたの領地' }),
      count,
      delta,
    ]);
    root.hidden = true;
    this.hud = { root, count, delta };
    return log.exit(root);
  }

  /**
   * 陣地の札を更新する（増えたら「+n」を光らせる）。
   * @param gained 増えたマス（無ければ 0）
   * @sideEffect 札の文言・data 属性を変える
   */
  private updateHud(gained: number): void {
    const log = logger.fn('updateHud', { gained });
    const hud = this.hud;
    const territory = this.territory;
    if (hud === undefined || territory === undefined) return log.exit(undefined);
    hud.count.textContent = `${territory.mineCount.toLocaleString('ja-JP')}マス`;
    hud.root.hidden = territory.mineCount === 0;
    if (gained > 0) {
      hud.delta.textContent = `+${gained}`;
      delete hud.root.dataset.bump;
      void hud.root.offsetWidth;
      hud.root.dataset.bump = '1';
    }
    log.exit(undefined);
  }

  /**
   * 上部バーを、いま映している所に合わせて作り直す（広域は「南森町周辺」、寄ると真ん中の地区名と Lv）。
   * @param tier 寄り具合
   * @param districtId 真ん中の地区
   * @sideEffect 上部バーを差し替える
   */
  private renderHeader(tier: SceneTier, districtId: string | undefined): void { // audit-ignore: fnlog-missing 毎フレーム呼ぶ（変わったときだけ作り直す）
    const key = `${tier}|${districtId ?? ''}`;
    if (key === this.headerKey || this.vm === undefined) return;
    this.headerKey = key;
    const district = districtId === undefined ? undefined : findDistrict(this.vm, districtId);
    const next =
      tier === 'wide' || district === undefined
        ? createTopBar({ title: MAP_TITLE })
        : createTopBar({ title: district.title, ...(district.subtitle === undefined ? {} : { subtitle: district.subtitle }) });
    this.topBar?.replaceWith(next);
    this.topBar = next;
  }

  /**
   * 読み上げ・E2E 用のスポット一覧を作り直す（画面に置いたスポット）。
   * @sideEffect 一覧の子要素を置き換える
   */
  private renderSpotList(): void {
    const log = logger.fn('renderSpotList', { placed: this.placed.length });
    const list = this.srList;
    if (list === undefined) return log.exit(undefined);
    const items = this.placed.map((p) =>
      h('li', {}, [
        h('button', {
          attrs: {
            type: 'button',
            'data-testid': 'map-spot',
            'data-spot-id': p.spot.id,
            'data-status': p.spot.status,
            'data-kind': p.spot.kind,
            'data-x': Math.round(p.x * 10) / 10,
            'data-y': Math.round(p.y * 10) / 10,
            'aria-label': `${p.spot.name ?? 'まだ見つけていないスポット'}${p.spot.today === undefined ? '' : `（${p.spot.today.tag}）`}`,
          },
          on: { click: userAction('map-spot', () => this.selectSpot(p.spot)) },
        }),
      ]),
    );
    list.replaceChildren(...items);
    log.exit(undefined, `${items.length} 件`);
  }

  /**
   * 地図の上に案内文を出す（undefined で消す）。
   * @param text 案内文
   * @sideEffect 案内要素を変える
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
   * 自分のアバターの装い（マイ街と同じ）を読み込む。
   * @sideEffect services.myTown を呼ぶ
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
   * 地図データ・現在地・ほかの旅人を取得し、街・陣地・描くものを作り直す（古い応答は捨てる）。
   * @returns 読み込めたら true
   * @sideEffect services.map・position・travelers を呼び、下シートを更新する
   */
  private async loadData(): Promise<boolean> {
    const seq = ++this.loadSeq;
    const log = logger.fn('loadData', { seq });
    const [map, position, travelers] = await Promise.all([this.ctx.services.map.execute(), this.ctx.services.position.execute(), this.ctx.services.travelers?.execute()]);
    if (this.destroyed || seq !== this.loadSeq) return log.exit(false, '古い読み込みを捨てました');
    if (!map.ok) {
      this.showMessage('地図を読み込めませんでした。少し待ってから開き直してください。');
      this.ctx.toast.show('地図を読み込めませんでした', { kind: 'error' });
      return log.fail(false, map.error.code);
    }
    if (position.ok && this.walker?.isWalking() !== true) this.position = { lat: position.value.lat, lng: position.value.lng };
    this.travelers = travelers?.ok === true ? travelers.value : [];
    this.applyData(map.value);
    this.nearby?.refresh();
    return log.exit(true);
  }

  /**
   * 地図データを反映する（街は使い回し、陣地・描く状態・描くスポットを作り直す）。
   * @param dto 地図データ
   * @sideEffect 状態・カメラ・フィルタの件数・陣地の札を更新し、描画を始める
   */
  private applyData(dto: MapDataDto): void {
    const log = logger.fn('applyData', { spots: dto.spots.length });
    const vm = buildMapViewModel(dto);
    const grid = townFor(dto);
    this.dto = dto;
    this.vm = vm;
    this.grid = grid;
    this.territory = computeTerritory(grid, dto.spots, dto.districts);
    const state = paintStateOf(grid, vm, this.territory);
    if (this.renderer === undefined || this.renderer.grid !== grid) this.renderer = new TownRenderer(grid, state);
    else this.renderer.setPaintState(state);
    this.rebuildSpots();
    // 成長・地区の主の交代で見出し（Lv・主）が変わるので、上部バーを作り直す
    this.headerKey = '';
    this.ensureCamera(grid, vm);
    this.showMessage(undefined);
    this.updateHud(0);
    this.updateCanvasState();
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * 描くスポットとフィルタの件数を作り直す（好み・行きたいが変わったときも呼ぶ）。
   * @sideEffect this.spots とフィルタの件数を更新する
   */
  private rebuildSpots(): void {
    const log = logger.fn('rebuildSpots');
    const dto = this.dto;
    const vm = this.vm;
    const grid = this.grid;
    if (dto === undefined || vm === undefined || grid === undefined) return log.exit(undefined, '準備中');
    this.spots = buildSceneSpots(dto, vm, grid, this.prefs, this.ctx.services.isDemo);
    this.filterBar?.update(filterCounts(this.spots, this.prefs));
    log.exit(undefined);
  }

  /**
   * カメラ操作をまだ作っていなければ作る（ルートの地区 → 前の表示 → 広域の順で最初の表示を決める）。
   * @param grid 街
   * @param vm 描画データ
   * @sideEffect カメラ操作を作る
   */
  private ensureCamera(grid: TownGrid, vm: MapViewModel): void {
    const log = logger.fn('ensureCamera', { exists: this.cameraCtl !== undefined });
    const canvas = this.surface?.canvas;
    const vp = this.viewport();
    if (this.cameraCtl !== undefined || canvas === undefined || vp === undefined) return log.exit(undefined);
    const saved = this.ctx.ui.camera;
    const district = this.routeDistrictId === undefined ? undefined : findDistrict(vm, this.routeDistrictId);
    const initial = district !== undefined ? fitBounds(boundsOf(district.polygon), vp, 24) : saved !== undefined ? { ...saved } : fitBounds(vm.bounds, vp, 12);
    this.cameraCtl = new MapCameraController(canvas, townBounds(grid), initial, {
      onTap: (point): void => this.handleTap(point),
      onChange: (): void => this.requestDraw(),
      onUserMove: (): void => this.stopFollowing(),
    });
    this.cameraCtl.setViewport(vp);
    log.exit(undefined);
  }

  /**
   * 利用者が地図を動かしたので、歩いている自分を追うのをやめる。
   * @sideEffect 追従をやめる
   */
  private stopFollowing(): void { // audit-ignore: fnlog-missing ドラッグ中に何度も呼ぶ
    this.following = false;
  }

  /**
   * 地区の成長・復活を購読する。Web フォントの読み込み後にも描き直す。
   * @sideEffect services.events・document.fonts に購読を登録する（unmount で解除）
   */
  private subscribeEvents(): void {
    const log = logger.fn('subscribeEvents');
    const events = this.ctx.services.events;
    this.unsubscribers.push(
      events.subscribe('DistrictGrown', (): void => void this.loadData()),
      events.subscribe('DistrictRevived', (): void => void this.loadData()),
    );
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (fonts !== undefined && typeof fonts.addEventListener === 'function') {
      /**
       * フォントの読み込み後に描き直す。
       * @sideEffect 描画を予約する
       */
      const redraw = (): void => this.requestDraw();
      fonts.addEventListener('loadingdone', redraw);
      this.unsubscribers.push((): void => fonts.removeEventListener('loadingdone', redraw));
    }
    log.exit(undefined);
  }

  /**
   * 本番（GPS）で現在地と発見判定を定期的に取り直す。
   * @sideEffect setInterval を登録する
   */
  private startPolling(): void {
    const log = logger.fn('startPolling', { intervalMs: POSITION_POLL_MS });
    this.pollTimer = window.setInterval(() => void this.pollPosition(), POSITION_POLL_MS);
    log.exit(undefined);
  }

  /**
   * 現在地を取り直して発見判定を呼ぶ（本番のみ）。
   * @sideEffect services.position・services.discover を呼ぶ
   */
  private async pollPosition(): Promise<void> {
    const log = logger.fn('pollPosition', { busy: this.polling });
    if (this.polling || this.destroyed) return log.exit(undefined);
    this.polling = true;
    try {
      const result = await this.ctx.services.position.execute();
      if (this.destroyed) return log.exit(undefined);
      if (!result.ok) return log.fail(undefined, result.error.code);
      this.position = { lat: result.value.lat, lng: result.value.lng };
      this.requestDraw();
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
   * 地図のタップ（ドラッグではない）: スポット → カード（デモは歩いて向かう）、ほかの旅人 → 案内、広域の空き → その地区へ寄る、それ以外 → そこへ歩く（デモ）。
   * @param tap canvas 内の点
   * @sideEffect 相関ID を発行する。カード・歩行・カメラを変える
   */
  private handleTap(tap: Point2D): void {
    setCorrelationId();
    const log = logger.fn('handleTap');
    const vm = this.vm;
    const camera = this.cameraCtl?.current(performance.now());
    const vp = this.viewport();
    if (vm === undefined || camera === undefined || vp === undefined) return log.exit(undefined, '準備中');
    if (this.nearby?.isOpen() === true) {
      this.nearby.close();
      return log.exit(undefined, '近くのリストを閉じた');
    }
    const spot = hitTestScene(this.placed, tap);
    if (spot !== undefined) {
      this.selectSpot(spot);
      return log.exit(undefined, 'スポット');
    }
    const person = hitTestPerson(this.placedPeople, tap);
    if (person !== undefined) {
      this.ctx.toast.show(personMessageOf(person.traveler, findDistrict(vm, person.traveler.districtId)?.name));
      return log.exit(undefined, 'ほかの旅人');
    }
    if (this.card?.isOpen() === true) this.closeCard();
    const target = unproject(camera, vp, tap);
    if (tierOf(camera.metersPerPx) === 'wide') {
      const id = districtAt(vm, target);
      if (id !== undefined) this.flyToDistrict(id);
      else this.ctx.toast.show('地区をタップで拡大');
      return log.exit(undefined, '広域');
    }
    if (this.walker === undefined) {
      this.ctx.toast.show('現在地はGPSで更新されます');
      return log.exit(undefined, '本番は歩かない');
    }
    this.walkTo({ point: target }, undefined);
    log.exit(undefined, '歩行');
  }

  /**
   * スポットの ID で選ぶ（下シートの近くのスポットから）。地図に無ければスポット詳細へ。
   * @param spotId スポットID
   * @sideEffect カードを出し、デモなら歩き始める
   */
  private selectSpotById(spotId: string): void {
    const log = logger.fn('selectSpotById', { spotId });
    const spot = this.spots.find((s) => s.id === spotId);
    if (spot === undefined) {
      this.ctx.router.navigate(`#/spot/${spotId}`);
      return log.exit(undefined, '地図に無いので詳細へ');
    }
    this.selectSpot(spot);
    log.exit(undefined);
  }

  /**
   * スポットを選ぶ: カードを出し、デモなら道に沿ってそこまで歩く（もう着いていれば歩かない）。
   * @param spot 描くスポット
   * @sideEffect カード・歩行・カメラを変え、詳細を読み込む
   */
  private selectSpot(spot: SceneSpot): void {
    const log = logger.fn('selectSpot', { spotId: spot.id, status: spot.status, kind: spot.kind });
    const here = this.position;
    const near = here !== undefined && distanceMeters(here, spot.ll) <= ALREADY_THERE_M;
    const canWalk = this.walker !== undefined && !near && here !== undefined;
    // 先にカードを出してから歩き出す（カードで隠れない所に道筋と行き先が映るよう、カードの高さを使ってカメラを決める）
    this.cardTarget = { spotId: spot.id, phase: canWalk ? 'walking' : near ? 'arrived' : 'idle' };
    this.renderCard();
    const walking = canWalk && this.walkTo({ anchorId: spot.id }, spot.id);
    if (canWalk && !walking) {
      this.cardTarget.phase = 'idle';
      this.renderCard();
    }
    if (!canWalk) this.focusOn([spot.ll]);
    void this.refreshCardDetail();
    log.exit(undefined, walking ? '歩いて向かう' : '歩かない');
  }

  /**
   * カードで隠れない描画領域（自分を追うときに保つ範囲）。
   * @param vp 描画領域
   * @returns カードの上端より下を除いた描画領域
   */
  private focusViewport(vp: Viewport): Viewport { // audit-ignore: fnlog-missing 歩行の毎フレームで呼ぶ
    const bottom = this.visibleBottom(vp);
    return { ...vp, bottomInset: Math.max(0, vp.height - bottom) };
  }

  /**
   * 地図が見えている下端（カードが開いていればカードの上端、無ければ下シートのつまみの上）。
   * @param vp 描画領域
   * @returns 下端（canvas 内 CSS px）
   */
  private visibleBottom(vp: Viewport): number { // audit-ignore: fnlog-missing 歩行の毎フレームで呼ぶ
    const card = this.card;
    const top = card !== undefined && card.isOpen() ? card.element.offsetTop - 8 : Number.POSITIVE_INFINITY;
    return Math.max(120, Math.min(vp.height - vp.bottomInset, top));
  }

  /**
   * 点の集まり（道筋・スポット）が、カードと上のフィルタに隠れない所に収まるようカメラを飛ばす（今の寄り具合で収まれば寄り具合は変えない）。
   * @param points 映したい点
   * @returns 飛んだ先の縮尺（1 CSS px あたりのメートル）
   * @sideEffect カメラを飛ばす
   */
  private focusOn(points: readonly LatLng[]): number {
    const log = logger.fn('focusOn', { points: points.length });
    const camera = this.cameraCtl?.current(performance.now());
    const vp = this.viewport();
    if (camera === undefined || vp === undefined || points.length === 0) return log.exit(camera?.metersPerPx ?? DETAIL_MPP, '準備中');
    const top = FOCUS_TOP_PX;
    const bottom = this.visibleBottom(vp);
    const box = boundsOf(points);
    const widthM = (box.east - box.west) * (111_000 * Math.cos((box.north * Math.PI) / 180));
    const heightM = (box.north - box.south) * 111_000;
    const fit = Math.max(widthM / Math.max(1, vp.width - 70), heightM / Math.max(1, bottom - top - 70));
    const keep = camera.metersPerPx >= WALK_VIEW_MPP[0] && camera.metersPerPx <= WALK_VIEW_MPP[1] && fit <= camera.metersPerPx;
    const mpp = keep ? camera.metersPerPx : Math.min(WALK_VIEW_MPP[1], Math.max(WALK_VIEW_MPP[0], fit));
    const anchorY = usableHeight(vp) / 2;
    const desiredY = (top + bottom) / 2;
    const centerLat = (box.north + box.south) / 2 - ((anchorY - desiredY) * mpp) / 111_000;
    this.cameraCtl?.flyTo({ centerLat, centerLng: (box.east + box.west) / 2, metersPerPx: mpp });
    return log.exit(mpp, keep ? '寄り具合はそのまま' : '寄り具合を合わせた');
  }

  /**
   * 道に沿って歩き始める（道筋と行き先がカードに隠れない所に映るよう、カメラも動かす）。
   * @param target 行き先（スポットの敷地、または地図の1点）
   * @param spotId 向かうスポット（地図の1点なら undefined）
   * @returns 歩き始めたら true
   * @sideEffect 歩行を始め、カメラを動かす
   */
  private walkTo(target: { anchorId: string } | { point: LatLng }, spotId: string | undefined): boolean {
    const log = logger.fn('walkTo', { spotId });
    const grid = this.grid;
    const here = this.position;
    const walker = this.walker;
    const camera = this.cameraCtl?.current(performance.now());
    const vp = this.viewport();
    if (grid === undefined || here === undefined || walker === undefined || camera === undefined || vp === undefined) return log.exit(false, '準備中');
    const route = routeTo(grid, here, target);
    if (route === undefined || route.length < 2) {
      this.ctx.toast.show('そこへ行く道が見つかりませんでした');
      return log.exit(false, '道なし');
    }
    this.walkTarget = spotId;
    this.following = true;
    const mpp = this.focusOn(route);
    walker.walkPath(route, mpp);
    this.updateCanvasState();
    this.requestDraw();
    return log.exit(true, `曲がり角 ${route.length}`);
  }

  /**
   * お店カードを今の状態で描き直す（詳細が取れていれば詳細を使う）。
   * @sideEffect カードの中身を差し替える
   */
  private renderCard(): void {
    const log = logger.fn('renderCard', { spotId: this.cardTarget?.spotId });
    const target = this.cardTarget;
    const spot = target === undefined ? undefined : this.spots.find((s) => s.id === target.spotId);
    const dto = this.dto;
    const vm = this.vm;
    if (target === undefined || spot === undefined || dto === undefined || vm === undefined || this.card === undefined) return log.exit(undefined);
    const raw = dto.spots.find((s) => s.id === spot.id);
    const amenity = dto.backdrop.amenityPoints.find((a) => a.id === spot.id);
    const districtName = raw === undefined ? undefined : findDistrict(vm, raw.districtId)?.name;
    const model = cardModelOf(spot, {
      phase: target.phase,
      ...(this.position === undefined ? {} : { position: this.position }),
      truePosition: raw ?? amenity ?? spot.ll,
      ...(districtName === undefined ? {} : { districtName }),
      ...(target.detail === undefined ? {} : { detail: target.detail }),
      ...noteField(amenity?.note, loadPurchases()[spot.id]),
      ...(raw?.category === undefined ? {} : { category: raw.category }),
    });
    this.card.show(model);
    log.exit(undefined);
  }

  /**
   * カードのスポットの詳細（チェックインできるか・今日済みか）を読み込んで描き直す。未発見・便利施設は読まない。
   * @sideEffect services.spotDetail を呼び、カードを描き直す
   */
  private async refreshCardDetail(): Promise<void> {
    const target = this.cardTarget;
    const log = logger.fn('refreshCardDetail', { spotId: target?.spotId });
    const spot = target === undefined ? undefined : this.spots.find((s) => s.id === target.spotId);
    if (target === undefined || spot === undefined || spot.kind === 'toilet' || spot.status === 'unknown') return log.exit(undefined, '読まない');
    const result = await this.ctx.services.spotDetail.execute({ spotId: spot.id });
    if (this.destroyed || this.cardTarget !== target) return log.exit(undefined, '別のカードに変わった');
    if (!result.ok) return log.fail(undefined, result.error.code);
    target.detail = result.value;
    this.renderCard();
    log.exit(undefined, result.value.canVisit ? 'チェックインできる' : 'まだ');
  }

  /**
   * カードを閉じる。
   * @sideEffect カードを隠し、選択を外す
   */
  private closeCard(): void {
    const log = logger.fn('closeCard');
    this.cardTarget = undefined;
    this.card?.hide();
    log.exit(undefined);
  }

  /**
   * カードからチェックインする: 演出をため込み → 訪問 → 演出 → トースト → 地図を読み直して陣取りの演出 → カードを更新。
   * @param spotId スポットID
   * @sideEffect services.visit を呼ぶ（operationId 付き＝DI-07）。演出・トースト・陣取りの演出
   */
  private async checkIn(spotId: string): Promise<void> {
    const log = logger.fn('checkIn', { spotId });
    if (this.checkingIn) return log.exit(undefined, '実行中');
    this.checkingIn = true;
    this.card?.setBusy(true);
    try {
      const before = this.territory?.cells;
      const effects = this.ctx.effects;
      effects.beginCapture();
      const at = this.spots.find((s) => s.id === spotId)?.ll;
      const pressedAt = performance.now();
      // ため: ピンが縮み、カメラがお店へぐっと寄る（記録の応答を待たずに始める）
      if (at !== undefined) {
        this.show.start(spotId, at, pressedAt);
        this.punchCamera();
      }
      this.requestDraw();
      const result = await this.ctx.services.visit.execute({ operationId: newOperationId(), spotId });
      // 衝撃: スタンプ・白い光・揺れ・星・紙吹雪・「ドン」・振動。見せてから全画面の演出（カード獲得・復活など）へ
      if (result.ok && !result.value.duplicate && at !== undefined) {
        this.fx.add('checkin', at, { startAt: pressedAt });
        window.setTimeout(() => {
          playStamp();
          buzz([18, 40, 30]);
        }, Math.max(0, IMPACT_MS - (performance.now() - pressedAt)));
        await wait(CHECKIN_STAMP_HOLD_MS);
      }
      const summary = await effects.flush();
      if (!result.ok) {
        this.ctx.toast.show(result.error.message, { kind: 'error' });
        return log.fail(undefined, result.error.code);
      }
      if (result.value.duplicate) {
        this.ctx.toast.show('このクエストはすでに達成済みです', { kind: 'info' });
        await this.refreshCardDetail();
        return log.exit(undefined, '記録済み');
      }
      await this.rewardCheckIn(spotId, at, before, summary);
      log.exit(undefined);
    } catch (error) {
      log.error('チェックインで想定外の例外が起きました', { error });
      this.ctx.toast.show('クエストを達成できませんでした。もう一度お試しください', { kind: 'error' });
    } finally {
      this.checkingIn = false;
      this.card?.setBusy(false);
    }
  }

  /**
   * ごほうび: カードを閉じ、上から帯（EXP・領地・連続・成長）、領地が広がって建物が建ち、コインが「チャリン」と札へ入って数字が回る。
   * @param spotId チェックインしたお店
   * @param at お店の位置
   * @param before チェックイン前の領地
   * @param summary 演出のまとめ（ポイント・育った地区）
   * @sideEffect 地図を読み直し、演出・音・読み上げを出す
   */
  private async rewardCheckIn(spotId: string, at: LatLng | undefined, before: Uint8Array | undefined, summary: { readonly points: number; readonly bonusPoints: number; readonly grownDistrictIds: readonly string[] }): Promise<void> {
    const log = logger.fn('rewardCheckIn', { spotId });
    const fromCount = this.territory?.mineCount ?? 0;
    this.closeCard();
    const gained = (await this.loadData()) ? this.playClaim(spotId, before) : 0;
    const exp = summary.points + summary.bonusPoints;
    const combo = bumpCombo(this.dto?.today ?? '');
    const grown = summary.grownDistrictIds.map((id) => (this.vm === undefined ? undefined : findDistrict(this.vm, id))).find((d) => d !== undefined);
    const levelUp = grown === undefined ? undefined : `${grown.shortName} Lv${grown.level}`;
    this.show.showBanner({ exp, gained, combo, ...(levelUp === undefined ? {} : { levelUp }) }, performance.now());
    playFanfare(levelUp !== undefined);
    if (this.announcer !== undefined) this.announcer.textContent = `クエスト達成。+${exp} EXP${gained > 0 ? `、領地 +${gained}マス` : ''}${levelUp === undefined ? '' : `、${levelUp} に成長`}`;
    if (gained > 0) window.setTimeout(() => playGrow(6), 320);
    if (at !== undefined) this.playReward(at, fromCount);
    this.announceGrowth(summary.grownDistrictIds);
    log.exit(undefined, `+${exp}EXP・+${gained}マス・${combo}軒目`);
  }

  /**
   * カメラをお店へぐっと寄せ、少ししてから元の寄り具合へ戻す（押した手ごたえ）。
   * @sideEffect カメラを飛ばす
   */
  private punchCamera(): void {
    const log = logger.fn('punchCamera');
    const ctl = this.cameraCtl;
    const camera = ctl?.current(performance.now());
    if (ctl === undefined || camera === undefined) return log.exit(undefined);
    ctl.flyTo({ ...camera, metersPerPx: camera.metersPerPx * PUNCH_ZOOM }, 200);
    window.setTimeout(() => {
      const now = ctl.current(performance.now());
      ctl.flyTo({ ...now, metersPerPx: camera.metersPerPx }, 650);
    }, 1250);
    log.exit(undefined);
  }

  /**
   * QR の読み取り画面を開く（押した瞬間の「ポン」と波紋。読み取れたらチェックイン・購入へ）。
   * @param kind チェックインか購入か
   * @param spotId お店
   * @sideEffect 音を鳴らし、読み取り画面を開く
   */
  private startQr(kind: QrScanKind, spotId: string): void {
    const log = logger.fn('startQr', { kind, spotId });
    const area = this.area;
    if (area === undefined || this.qrClose !== undefined || this.checkingIn) return log.exit(undefined, '開けない');
    unlockSound();
    playPress();
    buzz(8);
    const button = this.card?.element.querySelector<HTMLElement>(kind === 'checkin' ? '[data-testid="spot-card-checkin"]' : '[data-testid="spot-card-purchase"]');
    if (button !== null && button !== undefined) {
      delete button.dataset.fx;
      void button.offsetWidth;
      button.dataset.fx = '1';
    }
    const name = this.spots.find((s) => s.id === spotId)?.name ?? '';
    window.setTimeout(() => {
      this.qrClose = openQrScan(area, {
        kind,
        spotId,
        spotName: name,
        demo: this.ctx.services.isDemo,
        onScanned: (): void => {
          this.qrClose = undefined;
          if (kind === 'checkin') void this.checkIn(spotId);
          else this.purchase(spotId);
        },
        onCancel: (): void => {
          this.qrClose = undefined;
        },
      });
    }, QR_OPEN_DELAY_MS);
    log.exit(undefined);
  }

  /**
   * 購入（レジの QR を読み取った後）: 「お買い上げ！」のスタンプ・帯・音。お買い物スタンプを端末に記録する（EXP は増やさない）。
   * @param spotId お店
   * @sideEffect お買い物スタンプを保存し、演出・音を出し、カードを描き直す
   */
  private purchase(spotId: string): void {
    const log = logger.fn('purchase', { spotId });
    const at = this.spots.find((s) => s.id === spotId)?.ll;
    const now = performance.now();
    const count = addPurchase(spotId);
    if (at !== undefined) {
      this.show.start(spotId, at, now);
      this.fx.add('checkin', at, { startAt: now, text: 'お買い|上げ！' });
    }
    window.setTimeout(() => {
      playStamp();
      buzz([14, 30, 20]);
    }, IMPACT_MS);
    window.setTimeout(() => {
      this.show.showBanner({ title: 'お買い物ありがとう！', note: `お買い物スタンプ ${count}個目`, exp: 0, gained: 0, combo: 0 }, performance.now());
      playFanfare(false);
      if (this.announcer !== undefined) this.announcer.textContent = `お買い物を記録しました。お買い物スタンプ ${count}個目`;
      this.renderCard();
    }, CHECKIN_STAMP_HOLD_MS);
    this.requestDraw();
    log.exit(undefined, `${count}個目`);
  }

  /**
   * チェックインのごほうびの演出（「+n pt」が浮かび、コインが陣地の札へ飛ぶ）。
   * @param at お店の位置
   * @param points 獲得ポイント（おかえりボーナスを含む）
   * @sideEffect 演出を登録する
   */
  private playReward(at: LatLng, fromCount: number): void {
    const log = logger.fn('playReward', { fromCount });
    const target = this.hudPoint();
    const start = performance.now() + COIN_START_MS;
    if (target !== undefined) this.fx.add('coins', at, { target, startAt: start });
    const toCount = this.territory?.mineCount ?? fromCount;
    // コインが札に入るたびに「チャリン」と札が弾み、領地のマス数が回って増える
    for (let i = 0; i < COIN_COUNT; i++) {
      window.setTimeout(() => {
        playCoin(i);
        this.bumpHud();
      }, COIN_START_MS + COIN_FLIGHT_MS + i * COIN_GAP_MS);
    }
    this.rollHud(fromCount, toCount, COIN_START_MS + COIN_FLIGHT_MS, COIN_GAP_MS * COIN_COUNT + 300);
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * 領地の札を弾ませる（コインが入ったとき）。
   * @sideEffect 札の data-bump を付け直す
   */
  private bumpHud(): void { // audit-ignore: fnlog-missing コインごとに呼ぶ小さな DOM 操作
    const root = this.hud?.root;
    if (root === undefined) return;
    delete root.dataset.bump;
    void root.offsetWidth;
    root.dataset.bump = '1';
  }

  /**
   * 領地のマス数を、from から to へ回して増やす（スロットのように数え上げる）。
   * @param from 前のマス数
   * @param to 後のマス数
   * @param delayMs 回し始めるまで（ミリ秒）
   * @param durationMs 回す時間（ミリ秒）
   * @sideEffect 札の文字を毎フレーム書き換える
   */
  private rollHud(from: number, to: number, delayMs: number, durationMs: number): void {
    const log = logger.fn('rollHud', { from, to });
    const hud = this.hud;
    if (hud === undefined || to === from) return log.exit(undefined);
    hud.count.textContent = `${from.toLocaleString('ja-JP')}マス`;
    hud.delta.textContent = `+${to - from}`;
    const start = performance.now() + delayMs;
    /**
     * 1フレーム分だけ数字を進める。
     * @sideEffect 札の文字を書き換え、続きを予約する
     */
    const step = (): void => { // audit-ignore: fnlog-missing 数え上げの毎フレーム処理
      if (this.destroyed) return;
      const k = Math.min(1, Math.max(0, (performance.now() - start) / durationMs));
      const value = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
      hud.count.textContent = `${value.toLocaleString('ja-JP')}マス`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    log.exit(undefined);
  }

  /**
   * 陣地の札の中心（canvas 内の CSS px）。札が無ければ左下の角。
   * @returns 画面座標（canvas が無ければ undefined）
   */
  private hudPoint(): Point2D | undefined {
    const log = logger.fn('hudPoint');
    const canvas = this.surface?.canvas;
    const hud = this.hud?.root;
    if (canvas === undefined) return log.exit(undefined);
    const base = canvas.getBoundingClientRect();
    if (hud === undefined || hud.hidden) return log.exit({ x: 40, y: base.height - this.bottomInset - 24 });
    const r = hud.getBoundingClientRect();
    return log.exit({ x: r.left - base.left + 22, y: r.top - base.top + r.height / 2 });
  }

  /**
   * 陣取りの演出を始める（増えたマスが無ければ何もしない）。
   * @param spotId チェックインしたスポット
   * @param before チェックイン前の陣地
   * @sideEffect 演出を始め、陣地の札を光らせる
   */
  private playClaim(spotId: string, before: Uint8Array | undefined): number {
    const log = logger.fn('playClaim', { spotId });
    const grid = this.grid;
    const territory = this.territory;
    const anchor = grid?.anchors.get(spotId);
    if (grid === undefined || territory === undefined || anchor === undefined) return log.exit(0, '準備中');
    const added = newlyClaimed(grid, before, territory.cells, anchor);
    if (added.cells.length === 0) return log.exit(0, '増えていない');
    // マス数はごほうびの帯が数え上げるので、地図の上には出さない（gained: 0）
    this.claim = { cells: added.cells, maxDist: added.maxDist, center: anchor, startedAt: performance.now(), gained: 0 };
    // 街が育つ: 新しく領地になった所の建物が、近い順に建ち上がる
    const buildings = risingBuildingsOf(grid, added.cells, anchor);
    if (buildings.length > 0) this.rise = { buildings, startedAt: performance.now() + 250 };
    this.requestDraw();
    return log.exit(added.cells.length, `+${added.cells.length} マス`);
  }

  /**
   * 成長した地区を「{地区}が Lv{n} に育ちました」で知らせる。
   * @param districtIds 成長した地区ID
   * @sideEffect services.town を呼び、トーストを出す
   */
  private announceGrowth(districtIds: readonly string[]): void {
    const log = logger.fn('announceGrowth', { districtIds });
    if (districtIds.length === 0) return log.exit(undefined);
    // 「育ちました」は帯に出すので、トーストは出さない。地区の上に花火と Lv の札
    for (const id of districtIds) {
      const d = this.vm === undefined ? undefined : findDistrict(this.vm, id);
      if (d !== undefined) this.fx.add('levelup', d.center, { text: `Lv${d.level}`, startAt: performance.now() + 900 });
    }
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * 行きたいを入れ替えて保存し、地図とカードに反映する。
   * @param id スポット・便利施設の ID
   * @sideEffect 好みを保存し、描くスポット・カードを更新する
   */
  private toggleWant(id: string): void {
    const log = logger.fn('toggleWant', { id });
    this.prefs = toggleWant(this.prefs, id);
    saveMapPrefs(this.prefs);
    this.rebuildSpots();
    this.renderCard();
    this.requestDraw();
    const on = this.prefs.wants.includes(id);
    this.ctx.toast.show(on ? '行きたいに追加' : '行きたいから外しました');
    log.exit(undefined, on ? '入れた' : '外した');
  }

  /**
   * 好み・行きたい場所のパネルを開く。
   * @sideEffect モーダルを開く。保存したら地図に反映する
   */
  private openPrefs(): void {
    const log = logger.fn('openPrefs');
    const names = this.prefs.wants.map((id) => ({ id, name: this.spots.find((s) => s.id === id)?.name ?? '（まだ見つけていないスポット）' }));
    openMapPrefsPanel({ prefs: this.prefs, wantNames: names, onSave: (prefs): void => this.applyPrefs(prefs) });
    log.exit(undefined);
  }

  /**
   * パネルで保存した好みを反映する。
   * @param prefs 新しい好み
   * @sideEffect 好みを保存し、地図を描き直す
   */
  private applyPrefs(prefs: MapPrefs): void {
    const log = logger.fn('applyPrefs', { interests: prefs.interests.length, wants: prefs.wants.length });
    this.prefs = prefs;
    saveMapPrefs(prefs);
    this.rebuildSpots();
    this.renderCard();
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * フィルタが変わった（合うものを光らせ、合わないものを薄くする）。
   * @param active 入っているフィルタ
   * @sideEffect 描き直す
   */
  private handleFilters(active: ReadonlySet<MapFilterId>): void {
    const log = logger.fn('handleFilters', { active: [...active].join(',') });
    this.filters = new Set(active);
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * 「広域」: 市全体を映す。
   * @sideEffect カメラを飛ばす
   */
  private showWide(): void {
    const log = logger.fn('showWide');
    const vm = this.vm;
    const vp = this.viewport();
    if (vm === undefined || vp === undefined) return log.exit(undefined, '準備中');
    this.following = false;
    this.cameraCtl?.flyTo(fitBounds(vm.bounds, vp, 12));
    log.exit(undefined);
  }

  /**
   * 「中間」: 地区全体を映す（真ん中の地区 → 現在地の地区 → 近い地区）。
   * @sideEffect カメラを飛ばす
   */
  private showMiddle(): void {
    const log = logger.fn('showMiddle');
    const vm = this.vm;
    const camera = this.cameraCtl?.current(performance.now());
    if (vm === undefined || camera === undefined) return log.exit(undefined, '準備中');
    const here = this.position;
    const centerId = districtAt(vm, { lat: camera.centerLat, lng: camera.centerLng });
    const id = middleDistrictOf(vm.districts, centerId, here, here === undefined ? undefined : districtAt(vm, here));
    if (id === undefined) {
      this.ctx.toast.show('地区をタップすると、その地区を表示します');
      return log.exit(undefined, '地区を決められない');
    }
    this.flyToDistrict(id);
    log.exit(undefined);
  }

  /**
   * 「詳細」: 自分のまわりを大きく映す（歩いていれば追いかける）。
   * @sideEffect カメラを飛ばす
   */
  private showDetail(): void {
    const log = logger.fn('showDetail');
    const here = this.position;
    if (here === undefined) {
      this.ctx.toast.show('現在地を取得できません');
      return log.exit(undefined, '現在地なし');
    }
    this.following = true;
    this.cameraCtl?.flyTo({ centerLat: here.lat, centerLng: here.lng, metersPerPx: DETAIL_MPP });
    log.exit(undefined);
  }

  /**
   * 現在地ボタン: 自分の位置を真ん中に映して追いかける（引きすぎていれば中間まで寄る。本番は位置を取り直してから）。
   * @sideEffect カメラを飛ばし、追従を始める。本番は services.position を呼ぶ
   */
  private async locateMe(): Promise<void> {
    const log = logger.fn('locateMe', { isDemo: this.ctx.services.isDemo });
    if (this.walker === undefined) {
      const result = await this.ctx.services.position.execute();
      if (this.destroyed) return log.exit(undefined, 'unmount 済み');
      if (result.ok) this.position = { lat: result.value.lat, lng: result.value.lng };
    }
    const here = this.position;
    const camera = this.cameraCtl?.current(performance.now());
    const vp = this.viewport();
    if (here === undefined || camera === undefined || vp === undefined) {
      this.ctx.toast.show('現在地を取得できません', { kind: 'error' });
      return log.exit(undefined, '現在地なし');
    }
    const mpp = camera.metersPerPx > LOCATE_MAX_MPP ? LOCATE_MPP : camera.metersPerPx;
    const anchorY = usableHeight(vp) / 2;
    const desiredY = (FOCUS_TOP_PX + this.visibleBottom(vp)) / 2;
    this.following = true;
    this.cameraCtl?.flyTo({ centerLat: here.lat - ((anchorY - desiredY) * mpp) / 111_000, centerLng: here.lng, metersPerPx: mpp });
    log.exit(undefined, mpp === camera.metersPerPx ? '寄り具合はそのまま' : '寄った');
  }

  /**
   * 地区全体が見える所へ飛ぶ。
   * @param districtId 地区ID
   * @sideEffect カメラを飛ばす
   */
  private flyToDistrict(districtId: string): void {
    const log = logger.fn('flyToDistrict', { districtId });
    const vm = this.vm;
    const vp = this.viewport();
    const district = vm === undefined ? undefined : findDistrict(vm, districtId);
    if (district === undefined || vp === undefined) return log.exit(undefined, '地区が無い');
    this.following = false;
    this.cameraCtl?.flyTo(fitBounds(boundsOf(district.polygon), vp, 24));
    log.exit(undefined);
  }

  // -------------------------------------------------------------------------
  // 歩行の通知
  // -------------------------------------------------------------------------

  /**
   * 1刻み進んだ: 現在地を更新する。
   * @param position 新しい現在地
   * @sideEffect 現在地を更新し、描画を予約する
   */
  private handleWalkStep(position: LatLng): void { // audit-ignore: fnlog-missing 歩行の刻みごとに呼ぶ（座標を扱うのでログに出さない）
    this.position = position;
    this.requestDraw();
  }

  /**
   * スポットを発見した: 発見の輪を出し、データを読み直す（カードが未発見のスポットなら名前が出る）。
   * @param spots 新しく発見したスポット
   * @sideEffect 輪を始め、データを読み直す
   */
  private handleDiscovered(spots: readonly DiscoveredSpotDto[]): void {
    const log = logger.fn('handleDiscovered', { count: spots.length });
    const now = performance.now();
    for (const spot of spots) {
      const at = this.spots.find((s) => s.id === spot.id)?.ll;
      if (at !== undefined) this.fx.add('discover', at, { startAt: now });
      else this.rings.push({ spotId: spot.id, startedAt: now });
    }
    this.requestDraw();
    void this.loadData().then(() => this.afterDiscovered(spots));
    log.exit(undefined);
  }

  /**
   * 発見のあと、カードが発見したスポットなら名前つきで描き直す。
   * @param spots 新しく発見したスポット
   * @sideEffect カードを描き直す
   */
  private afterDiscovered(spots: readonly DiscoveredSpotDto[]): void {
    const log = logger.fn('afterDiscovered', { count: spots.length });
    if (this.cardTarget !== undefined && spots.some((s) => s.id === this.cardTarget?.spotId)) {
      this.renderCard();
      void this.refreshCardDetail();
    }
    log.exit(undefined);
  }

  /**
   * 歩き終わった: 向かっていたスポットに着いたら、カードをチェックインできる状態にする。
   * @param arrived 目的地に着いたら true
   * @sideEffect データを読み直し、カードを更新する
   */
  private handleWalkStop(arrived: boolean): void {
    const log = logger.fn('handleWalkStop', { arrived, target: this.walkTarget });
    const target = this.walkTarget;
    this.walkTarget = undefined;
    this.updateCanvasState();
    void this.loadData().then(() => this.afterWalk(target, arrived));
    log.exit(undefined);
  }

  /**
   * 歩き終わってデータを読み直した後、カードを「着いた」にしてチェックインできるか確かめる。
   * @param target 向かっていたスポット
   * @param arrived 着いたか
   * @sideEffect カードを描き直す
   */
  private afterWalk(target: string | undefined, arrived: boolean): void {
    const log = logger.fn('afterWalk', { target, arrived });
    const card = this.cardTarget;
    if (target === undefined || card?.spotId !== target) return log.exit(undefined, 'カードが別');
    card.phase = arrived ? 'arrived' : 'idle';
    if (arrived && this.position !== undefined) this.fx.add('arrive', this.position);
    this.renderCard();
    void this.refreshCardDetail();
    log.exit(undefined);
  }

  // -------------------------------------------------------------------------
  // 描画
  // -------------------------------------------------------------------------

  /**
   * canvas の大きさが変わった。
   * @param size 新しい大きさ
   * @sideEffect カメラの描画領域を更新し、描画を予約する
   */
  private handleResize(size: CanvasSize): void {
    const log = logger.fn('handleResize', { width: size.width, height: size.height, dpr: size.dpr });
    this.size = size;
    const vp = this.viewport();
    if (vp !== undefined) this.cameraCtl?.setViewport(vp);
    if (this.cameraCtl === undefined && this.grid !== undefined && this.vm !== undefined) this.ensureCamera(this.grid, this.vm);
    this.requestDraw();
    log.exit(undefined);
  }

  /**
   * 描画領域（下シートのつまみで隠れる高さを含む）。
   * @returns 描画領域
   */
  private viewport(): Viewport | undefined { // audit-ignore: fnlog-missing 毎フレーム描画
    if (this.size === undefined) return undefined;
    return { width: this.size.width, height: this.size.height, bottomInset: this.bottomInset };
  }

  /**
   * canvas の data-* に今の状態（歩行中・読み込み済み）を出す（E2E の待ち合わせ用）。
   * @sideEffect canvas の data 属性を変える
   */
  private updateCanvasState(): void {
    const log = logger.fn('updateCanvasState');
    const canvas = this.surface?.canvas;
    if (canvas === undefined) return log.exit(undefined);
    canvas.dataset.walking = String(this.walker?.isWalking() === true);
    canvas.dataset.ready = String(this.vm !== undefined);
    log.exit(undefined);
  }

  /**
   * カメラを ctx.ui に覚える（画面をまたいで戻すため。ズーム段階と真ん中の地区も合わせる）。
   * @sideEffect ctx.ui を書き換える
   */
  private saveCamera(): void { // audit-ignore: fnlog-missing 毎フレーム呼ぶ（座標を扱うのでログに出さない）
    const camera = this.cameraCtl?.current(performance.now());
    if (camera === undefined) return;
    this.ctx.ui.camera = { centerLat: camera.centerLat, centerLng: camera.centerLng, metersPerPx: camera.metersPerPx };
    this.ctx.ui.zoom = tierOf(camera.metersPerPx);
    const id = this.vm === undefined ? undefined : districtAt(this.vm, { lat: camera.centerLat, lng: camera.centerLng });
    if (id === undefined) delete this.ctx.ui.districtId;
    else this.ctx.ui.districtId = id;
  }

  /**
   * 次のフレームの描画を予約する。
   * @sideEffect requestAnimationFrame を登録する
   */
  private requestDraw(): void { // audit-ignore: fnlog-missing 毎フレーム描画
    if (this.destroyed || this.rafId !== undefined) return;
    this.rafId = requestAnimationFrame(() => this.drawFrame());
  }

  /**
   * 1フレーム描く（地面 → 陣地の境界 → 陣取りの演出 → 地区の札 → 円と道筋 → スポット → 人）。動きがあれば次も予約する。
   * @sideEffect canvas に描く
   */
  private drawFrame(): void { // audit-ignore: fnlog-missing 毎フレーム描画
    this.rafId = undefined;
    const surface = this.surface;
    const size = this.size;
    const vp = this.viewport();
    const renderer = this.renderer;
    const ctl = this.cameraCtl;
    if (this.destroyed || surface === undefined || size === undefined || vp === undefined || renderer === undefined || ctl === undefined) return;
    const t = performance.now();
    const live = this.walker?.livePosition(t);
    if (live !== undefined) {
      this.position = live;
      this.fx.addDust(live, t);
      if (this.following) ctl.follow(live, (camera, ll) => project(camera, vp, ll), this.focusViewport(vp));
    }
    const camera = ctl.current(t);
    beginFrame(surface.ctx, size);
    const shake = this.fx.shake(t);
    if (shake.x !== 0 || shake.y !== 0) surface.ctx.translate(shake.x, shake.y);
    let busy = false;
    try {
      busy = renderer.draw(surface.ctx, camera, vp, size.dpr);
      this.drawOverlay(surface.ctx, camera, vp, t, size.dpr);
    } catch (error) {
      this.reportDrawError(error);
      return;
    }
    this.afterFrame(camera);
    if (busy || this.continuesAnimating()) this.requestDraw();
  }

  /**
   * 描画の例外を記録する（描画ループは止める。次の操作・データ更新で再開する）。
   * @param error 捕捉した例外
   * @sideEffect error ログを残す
   */
  private reportDrawError(error: unknown): void {
    const log = logger.fn('reportDrawError');
    log.error('地図の描画に失敗しました', { error });
    log.exit(undefined);
  }

  /**
   * 地面の上に重ねるものを描く。
   * @param ctx 2D コンテキスト
   * @param camera カメラ
   * @param vp 描画領域
   * @param t 現在時刻
   * @param dpr デバイスピクセル比
   * @sideEffect canvas に描く。置いたスポット・ほかの旅人を覚える
   */
  private drawOverlay(ctx: CanvasRenderingContext2D, camera: Camera, vp: Viewport, t: number, dpr: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const grid = this.grid;
    const vm = this.vm;
    if (grid === undefined || vm === undefined) return;
    const territory = this.territory ?? emptyTerritory(grid);
    const tier = tierOf(camera.metersPerPx);
    const textScale = textScaleFactor();
    const tr = gridTransform(grid, camera, vp);
    // 広域は地区を大きなブロックで見せる（タップすると中間へ）。中間は領地を薄い面＋境界線、詳細は境界線
    if (tier === 'wide') drawDistrictBlocks(ctx, vm.districts, camera, vp, territory, textScale);
    else {
      this.renderer?.drawTerritoryWash(ctx, camera, vp, tier === 'district' ? 0.16 : 0);
      drawTerritoryEdges(ctx, territory, tr, vp, t);
    }
    if (this.rise !== undefined && (!drawRisingBuildings(ctx, this.rise, tr, vp, t) || t - this.rise.startedAt > riseDuration(this.rise))) this.rise = undefined;
    const self = this.position === undefined ? undefined : project(camera, vp, this.position);
    if (self !== undefined) drawCheckInCircle(ctx, self, VISIT_RADIUS_M / camera.metersPerPx, tier === 'near' ? `達成エリア ${VISIT_RADIUS_M}m` : undefined, textScale, t);
    const route = this.walker?.remainingRoute(t) ?? [];
    if (route.length > 1) drawRoute(ctx, route.map((p) => project(camera, vp, p)), t);
    const input = this.sceneInput(camera, vp, tier, t, textScale);
    this.fx.drawUnder(ctx, (ll) => project(camera, vp, ll), t);
    // 広域は地区のブロックが主役なので、お店・名所は描かない
    this.placed = tier === 'wide' ? [] : placeSpots(this.spots, input);
    drawSpots(ctx, this.placed, input);
    this.drawRings(ctx, camera, vp, t);
    if (tier !== 'wide') {
      this.voices.update(this.placed, t, this.dto?.today ?? '');
      this.voices.draw(ctx, this.placed, t, textScale);
    }
    if (this.claim !== undefined && !drawClaimAnimation(ctx, this.claim, grid.cols, tr, t, textScale)) this.claim = undefined;
    // 地区の札はスポットの上に重ねる（広域・中間で地区名が隠れないように）
    if (tier !== 'wide') drawDistrictLabels(ctx, vm.districts, camera, vp, tier, territory.mineByDistrict, textScale);
    const attribution = this.dto?.backdrop.attribution;
    if (attribution !== undefined) drawAttribution(ctx, `トイレ位置 ${attribution}`, vp, textScale);
    // 自分は街に埋もれないよう、足もとに光る目印を置き、アバターも少し大きく描く
    if (self !== undefined) drawSelfBeacon(ctx, self, t, tier);
    const avatar = this.avatarLook === undefined ? undefined : avatarSpriteFor(this.avatarLook, { scale: SELF_AVATAR_SCALE[tier] * SELF_AVATAR_BOOST, dotPx: AVATAR_DOT_PX, dpr });
    const heading = this.walker?.heading();
    if (heading !== undefined && heading !== 0) this.facingLeft = heading < 0;
    this.placedPeople = placeTravelers(tier === 'wide' ? [] : this.travelers, vm, { camera, viewport: vp, zoom: tier, self });
    drawPeople(ctx, { people: this.placedPeople, self, zoom: tier, textScale, walkPhase: this.walker?.isWalking() === true ? walkPhaseOf(t) : undefined, avatar, facingLeft: this.facingLeft, dpr });
    this.show.drawOnMap(ctx, (ll) => project(camera, vp, ll), t);
    this.fx.drawOver(ctx, (ll) => project(camera, vp, ll), t, textScale);
    this.show.drawOnScreen(ctx, vp, t, textScale);
  }

  /**
   * スポットを描く入力を作る（フィルタの判定・強調の色・選択中・チェックインできる範囲のスポット）。
   * @param camera カメラ
   * @param vp 描画領域
   * @param tier 寄り具合
   * @param t 現在時刻
   * @param textScale 文字の拡大率
   * @returns 入力
   */
  private sceneInput(camera: Camera, vp: Viewport, tier: SceneTier, t: number, textScale: number): SceneInput { // audit-ignore: fnlog-missing 毎フレーム描画
    const matcher = filterMatcher(this.filters, this.prefs);
    const inRange = new Set<string>();
    const here = this.position;
    if (here !== undefined) for (const s of this.dto?.spots ?? []) if (distanceMeters(here, s) <= VISIT_RADIUS_M) inRange.add(s.id);
    return {
      camera,
      vp,
      tier,
      t,
      textScale,
      ...(matcher === undefined ? {} : { matches: matcher }),
      highlight: highlightColorOf(this.filters),
      ...(this.cardTarget === undefined ? {} : { selectedId: this.cardTarget.spotId }),
      inRange,
      pinScale: (spotId: string): readonly [number, number] => this.show.pinScale(spotId, t),
    };
  }

  /**
   * 発見の輪を描く（終わったものは捨てる）。
   * @param ctx 2D コンテキスト
   * @param camera カメラ
   * @param vp 描画領域
   * @param t 現在時刻
   * @sideEffect canvas に描く
   */
  private drawRings(ctx: CanvasRenderingContext2D, camera: Camera, vp: Viewport, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    this.rings = this.rings.filter((r) => t - r.startedAt < DISCOVERY_RING_MS);
    for (const ring of this.rings) {
      const spot = this.spots.find((s) => s.id === ring.spotId);
      if (spot !== undefined) drawDiscoveryRing(ctx, project(camera, vp, spot.ll), (t - ring.startedAt) / DISCOVERY_RING_MS);
    }
  }

  /**
   * 描いた後の片付け（上部バー・切替・カメラの記憶・読み上げ一覧）。
   * @param camera カメラ
   * @sideEffect DOM・ctx.ui を更新する
   */
  private afterFrame(camera: Camera): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const tier = tierOf(camera.metersPerPx);
    const vm = this.vm;
    this.zoomToggle?.update(tier);
    this.updateSideList(tier);
    if (this.locateButton !== undefined) {
      const active = this.following ? '1' : '0';
      if (this.locateButton.dataset.active !== active) this.locateButton.dataset.active = active;
    }
    this.renderHeader(tier, vm === undefined ? undefined : districtAt(vm, { lat: camera.centerLat, lng: camera.centerLng }));
    const canvas = this.surface?.canvas;
    if (canvas !== undefined && canvas.dataset.zoom !== tier) canvas.dataset.zoom = tier;
    this.saveCamera();
    this.frames += 1;
    if (this.frames % SR_LIST_EVERY_FRAMES === 1) this.renderSpotList();
  }

  /**
   * 中間の表示のとき、右側に「映っているお店」を並べる（今日だけ・行きたい・フィルタに合う・訪問済みの順。カード・一覧を開いている間は隠す）。
   * @param tier 寄り具合
   * @sideEffect 右の列を出し入れし、中身を入れ替える
   */
  private updateSideList(tier: SceneTier): void { // audit-ignore: fnlog-missing 毎フレーム呼ぶ（作り直すのは間引いたときだけ）
    const list = this.sideList;
    if (list === undefined) return;
    const visible = tier === 'district' && this.card?.isOpen() !== true && this.nearby?.isOpen() !== true;
    list.setVisible(visible);
    list.setSelected(this.cardTarget?.spotId);
    if (!visible || this.frames % SIDE_LIST_EVERY_FRAMES !== 0) return;
    /**
     * 右の列に並べる順の点数（今日だけ・行きたい・フィルタに合う・開催中・訪問済み）。
     * @param p 置いたスポット
     * @returns 点数（大きいほど上）
     */
    const rankOf = (p: PlacedSpot): number => (p.spot.today?.hot === true ? 8 : 0) + (p.spot.want ? 6 : 0) + (p.match === true ? 5 : 0) + (p.spot.today !== undefined ? 3 : 0) + (p.spot.status === 'visited' ? 1 : 0); // audit-ignore: fnlog-missing 並べ替えの小さな採点
    const items: SideShopItem[] = this.placed
      .filter((p) => p.spot.kind === 'shop' && p.match !== false && p.x > 0 && p.x < (this.size?.width ?? 0) && p.y > 0 && p.y < (this.size?.height ?? 0))
      .sort((a, b) => rankOf(b) - rankOf(a))
      .slice(0, 14)
      .map((p) => ({
        id: p.spot.id,
        ...(p.spot.name === undefined ? {} : { name: p.spot.name }),
        icon: p.spot.goods?.icon ?? 'gift',
        unknown: p.spot.status === 'unknown',
        visited: p.spot.status === 'visited',
        want: p.spot.want,
        ...(p.spot.today === undefined ? {} : { tag: p.spot.today.tag }),
        hot: p.spot.today?.hot === true,
      }));
    list.update(items);
  }

  /**
   * 次のフレームも描き続けるか（カメラ・歩行・演出・強調の点滅・選択中の矢印・自分の円）。
   * @returns 続けるなら true
   */
  private continuesAnimating(): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
    if (typeof document !== 'undefined' && document.hidden) return false;
    return (
      this.cameraCtl?.isMoving() === true ||
      this.walker?.isWalking() === true ||
      this.claim !== undefined ||
      this.rings.length > 0 ||
      this.fx.active() ||
      this.show.active(performance.now()) ||
      this.rise !== undefined ||
      this.voices.active() ||
      this.filters.size > 0 ||
      this.cardTarget !== undefined ||
      this.position !== undefined ||
      this.spots.some((s) => s.today?.hot === true)
    );
  }
}
