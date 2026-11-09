/**
 * @file DI コンテナ（infrastructure 層）。依存を組み立てて presentation に渡す AppServices を作る唯一の場所。
 * 本番／デモ／テストの切替はここだけで行う（docs/01 §3-3、docs/02 §5）。デモ用ユースケースは demo モードのときだけ登録する（SEC-02）。
 * イベント連鎖は SpotVisited → 地区の変化 → 報酬 → 地区の主 の順に購読登録する（docs/08 §4.2、DI-11）。
 */
import { CMS_BACKEND } from '@/Common/constants/env';
import type { CmsBackend } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { AppServices, DemoServices } from '@/application/AppServices';
import { EventFactory } from '@/application/events/EventFactory';
import type { DemoControl } from '@/application/ports/DemoControl';
import { UpdateDistrictLordUseCase } from '@/application/usecases/competition/UpdateDistrictLordUseCase';
import { AdvanceDateUseCase } from '@/application/usecases/demo/AdvanceDateUseCase';
import { MoveDemoPositionUseCase } from '@/application/usecases/demo/MoveDemoPositionUseCase';
import { ResetPositionUseCase } from '@/application/usecases/demo/ResetPositionUseCase';
import { SimulateRivalUseCase } from '@/application/usecases/demo/SimulateRivalUseCase';
import { SwitchTravelerUseCase } from '@/application/usecases/demo/SwitchTravelerUseCase';
import { DiscoverNearbySpotsUseCase } from '@/application/usecases/exploration/DiscoverNearbySpotsUseCase';
import { GetCurrentPositionUseCase } from '@/application/usecases/exploration/GetCurrentPositionUseCase';
import { GetMapDataUseCase } from '@/application/usecases/exploration/GetMapDataUseCase';
import { GetNearbySpotsUseCase } from '@/application/usecases/exploration/GetNearbySpotsUseCase';
import { GetRevisitReasonsUseCase } from '@/application/usecases/exploration/GetRevisitReasonsUseCase';
import { VisitSpotUseCase } from '@/application/usecases/exploration/VisitSpotUseCase';
import { AwardVisitRewardsUseCase } from '@/application/usecases/reward/AwardVisitRewardsUseCase';
import { EnsureTravelerUseCase } from '@/application/usecases/session/EnsureTravelerUseCase';
import { GetAppStatusUseCase } from '@/application/usecases/session/GetAppStatusUseCase';
import { GetSpotDetailUseCase } from '@/application/usecases/spot/GetSpotDetailUseCase';
import { GetZukanUseCase } from '@/application/usecases/spot/GetZukanUseCase';
import { GetRankingUseCase } from '@/application/usecases/competition/GetRankingUseCase';
import { GetOtherTravelersUseCase } from '@/application/usecases/competition/GetOtherTravelersUseCase';
import { GetRankStatusUseCase } from '@/application/usecases/reward/GetRankStatusUseCase';
import { EvaluateDistrictChangeUseCase } from '@/application/usecases/town/EvaluateDistrictChangeUseCase';
import { GetAvatarClosetUseCase } from '@/application/usecases/avatar/GetAvatarClosetUseCase';
import { SaveAvatarUseCase } from '@/application/usecases/avatar/SaveAvatarUseCase';
import { GetMyTownUseCase } from '@/application/usecases/town/GetMyTownUseCase';
import { GetTownStateUseCase } from '@/application/usecases/town/GetTownStateUseCase';
import { GetSettingsUseCase } from '@/application/usecases/settings/GetSettingsUseCase';
import { UpdateTextScaleUseCase } from '@/application/usecases/settings/UpdateTextScaleUseCase';
import { ExportDataUseCase } from '@/application/usecases/settings/ExportDataUseCase';
import { DeleteAllDataUseCase } from '@/application/usecases/settings/DeleteAllDataUseCase';
import type { Clock } from '@/domain/ports/Clock';
import type { GeoProvider } from '@/domain/ports/GeoProvider';
import type { ApiClientDeps } from '@/infrastructure/api/requestApi';
import { buildServerCmsReflection } from '@/infrastructure/di/cmsServerReflection';
import { DemoControlAdapter } from '@/infrastructure/demo/DemoControlAdapter';
import { InMemoryEventBus } from '@/infrastructure/events/InMemoryEventBus';
import { BrowserGeoProvider } from '@/infrastructure/geo/BrowserGeoProvider';
import { DemoGeoProvider } from '@/infrastructure/geo/DemoGeoProvider';
import { browserFetchText } from '@/infrastructure/master/browserFetchText';
import { MasterDataLoader } from '@/infrastructure/master/MasterDataLoader';
import type { FetchText, LoadedMaster } from '@/infrastructure/master/MasterDataLoader';
import { applyCmsOverlay } from '@/infrastructure/master/applyCmsOverlay';
import type { SpotCatalog } from '@/infrastructure/master/masterValidators';
import { RefreshableSpotRepository } from '@/infrastructure/master/RefreshableSpotRepository';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import { LocalStorageCmsOverlayRepository } from '@/infrastructure/storage/LocalStorageCmsOverlayRepository';
import { watchStorageKey } from '@/infrastructure/storage/watchStorageKey';
import { CryptoIdGenerator, uuid } from '@/infrastructure/random/CryptoIdGenerator';
import type { KeyValueStore } from '@/infrastructure/storage/KeyValueStore';
import { LocalStorageKeyValueStore } from '@/infrastructure/storage/LocalStorageKeyValueStore';
import { LocalStorageLordshipRepository } from '@/infrastructure/storage/LocalStorageLordshipRepository';
import { LocalStoragePointLedgerRepository } from '@/infrastructure/storage/LocalStoragePointLedgerRepository';
import { LocalStorageRivalActionRepository } from '@/infrastructure/storage/LocalStorageRivalActionRepository';
import { LocalStorageAvatarRepository } from '@/infrastructure/storage/LocalStorageAvatarRepository';
import { LocalStorageSessionRepository } from '@/infrastructure/storage/LocalStorageSessionRepository';
import { LocalStorageSettingsRepository } from '@/infrastructure/storage/LocalStorageSettingsRepository';
import { LocalStorageDataPort } from '@/infrastructure/storage/LocalStorageDataPort';
import { LocalStorageTravelerRepository } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { DemoClock } from '@/infrastructure/time/DemoClock';
import { SystemClock } from '@/infrastructure/time/SystemClock';

const logger = createLogger('infrastructure/di/container');

/** デモ／本番それぞれの保存キー接頭辞（DI-23。デモは別の名前空間） */
const PREFIX_BY_MODE = { demo: 'nnishi.demo.', production: 'nnishi.' } as const;

/** コンテナの設定 */
export interface ContainerOptions {
  /** demo: 地図タップ移動・日付進行・デモメニューあり／production: GPS・実時刻 */
  readonly mode: 'demo' | 'production';
  /** 保存先（省略時は localStorage。テストでメモリを渡す） */
  readonly store?: KeyValueStore;
  /** マスタ JSON の取得関数（省略時は fetch。テストで node:fs を渡す） */
  readonly fetchText?: FetchText;
  /** 実時刻（エポックミリ秒）。テストで固定する */
  readonly nowMs?: () => number;
  /** 店舗CMS の登録内容の受け取り方（省略時は CMS_BACKEND。'server' は連携サーバーの公開スナップショット＝docs/09 §7.3） */
  readonly cmsBackend?: CmsBackend;
  /** 連携サーバーの呼び出し（テストで起点と fetch を渡す） */
  readonly cmsApi?: ApiClientDeps;
}

/** 時計・位置・デモ操作のポート一式 */
interface Ports {
  readonly clock: Clock;
  readonly geo: GeoProvider;
  readonly demoControl?: DemoControl;
}

/**
 * モードに応じて時計・位置・デモ操作を作る。
 * デモは DemoClock（実時刻＋ずらし日数）と DemoGeoProvider（地図タップ位置）、本番は SystemClock と BrowserGeoProvider（フォールバックなし＝SEC-27）。
 * @param opts コンテナ設定
 * @param store デモ日付のずらし日数の保存先
 * @returns ポート一式
 */
function buildPorts(opts: ContainerOptions, store: KeyValueStore): Ports {
  const log = logger.fn('buildPorts', { mode: opts.mode });
  if (opts.mode === 'production') {
    const clock = opts.nowMs ? new SystemClock(opts.nowMs) : new SystemClock();
    return log.exit({ clock, geo: new BrowserGeoProvider({ clock }) });
  }
  const clock = new DemoClock({ store, nowMs: opts.nowMs });
  const geo = new DemoGeoProvider(clock);
  return log.exit({ clock, geo, demoControl: new DemoControlAdapter({ clock, geo, enabled: true }) });
}

/**
 * リポジトリと共通部品をまとめた依存オブジェクトを作る（各ユースケースは必要なプロパティだけを使う）。
 * @param opts コンテナ設定（保存先は解決済み）
 * @param master 検証済みマスタ（ライバル）
 * @param spots スポットの参照（デモは店舗CMS の登録内容を重ねたもの）
 * @returns 全ユースケース共通の依存
 */
function buildBaseDeps(opts: ContainerOptions & { readonly store: KeyValueStore }, master: LoadedMaster, spots: SpotRepository) {
  const log = logger.fn('buildBaseDeps', { mode: opts.mode });
  const store = opts.store;
  const repo = { store, prefix: PREFIX_BY_MODE[opts.mode] };
  const ports = buildPorts(opts, store);
  const ids = new CryptoIdGenerator();
  const bus = new InMemoryEventBus();
  return log.exit({
    ...ports,
    session: new LocalStorageSessionRepository(repo),
    avatars: new LocalStorageAvatarRepository(repo),
    settings: new LocalStorageSettingsRepository(repo),
    userData: new LocalStorageDataPort(repo),
    travelers: new LocalStorageTravelerRepository(repo),
    ledgers: new LocalStoragePointLedgerRepository(repo),
    lordships: new LocalStorageLordshipRepository(repo),
    rivalActions: new LocalStorageRivalActionRepository(repo),
    spots,
    rivals: master.rivals,
    ids,
    uuid,
    bus,
    events: bus,
    eventFactory: new EventFactory({ ids, clock: ports.clock }),
    enabled: opts.mode === 'demo',
    demo: opts.mode === 'demo',
  });
}

/** 全ユースケース共通の依存 */
type BaseDeps = ReturnType<typeof buildBaseDeps>;

/**
 * SpotVisited の購読を docs/08 §4.2 の順に登録する（地区の変化 → 報酬 → 地区の主）。
 * InMemoryEventBus は登録順に await するので、訪問ユースケースが終わる時点で連鎖イベントは発行済みになる（演出の取りこぼし防止）。
 * @param base 共通の依存
 * @param updateLords 地区の主の再判定ユースケース
 * @sideEffect EventBus に3つのハンドラを登録する
 */
function registerVisitHandlers(base: BaseDeps, updateLords: UpdateDistrictLordUseCase): void {
  const log = logger.fn('registerVisitHandlers');
  const evaluate = new EvaluateDistrictChangeUseCase(base);
  const award = new AwardVisitRewardsUseCase(base);
  const handlers = [
    { name: 'EvaluateDistrictChange', run: evaluate.handle.bind(evaluate) },
    { name: 'AwardVisitRewards', run: award.handle.bind(award) },
    { name: 'UpdateDistrictLord', run: updateLords.handle.bind(updateLords) },
  ];
  for (const handler of handlers) {
    base.bus.subscribe('SpotVisited', async (event) => {
      const result = await handler.run(event);
      if (!result.ok) log.error('訪問後の処理に失敗', { handler: handler.name, code: result.error.code });
    });
  }
  log.exit(undefined);
}

/**
 * デモ専用ユースケースを作る（demo モードのときだけ呼ぶ＝SEC-02）。
 * @param base 共通の依存（demoControl を含む）
 * @param demoControl デモ操作のポート
 * @param updateLords 地区の主の再判定ユースケース
 * @returns デモ用サービス
 */
function buildDemoServices(base: BaseDeps, demoControl: DemoControl, updateLords: UpdateDistrictLordUseCase, cms: CmsReflection): DemoServices {
  const log = logger.fn('buildDemoServices');
  const deps = { ...base, demoControl, updateLords };
  return log.exit({
    advanceDate: new AdvanceDateUseCase(deps),
    simulateRival: new SimulateRivalUseCase(deps),
    switchTraveler: new SwitchTravelerUseCase(deps),
    resetPosition: new ResetPositionUseCase(deps),
    moveTo: new MoveDemoPositionUseCase(deps),
    ...(cms.onCatalogChanged === undefined ? {} : { onCatalogChanged: cms.onCatalogChanged }),
  });
}

/** 店舗CMS の登録内容の反映（デモだけ。本番はマスタのまま） */
interface CmsReflection {
  /** スポットの参照（デモは登録内容を重ねて、保存のたびに差し替える） */
  readonly spots: SpotRepository;
  /** 差し替えたときに呼ぶ関数の登録（デモだけ） */
  readonly onCatalogChanged?: (listener: () => void) => () => void;
}

/**
 * マスタに店舗CMS の登録内容を重ねる。読めないときはマスタだけで動かす（CMS は必須の部品ではない＝docs/09 §4.5）。
 * @param overlays 登録内容の保存先
 * @param catalog 検証済みのマスタ
 * @returns 重ねたマスタ
 */
async function overlaidCatalog(overlays: LocalStorageCmsOverlayRepository, catalog: SpotCatalog): Promise<SpotCatalog> {
  const log = logger.fn('overlaidCatalog');
  const loaded = await overlays.load();
  if (!loaded.ok) {
    log.warn('店舗CMS の登録内容を読めないため、マスタだけで動かします', { code: loaded.error.code });
    return log.exit(catalog);
  }
  return log.exit(applyCmsOverlay(catalog, loaded.value).catalog);
}

/**
 * デモでは店舗CMS（cms.html）の登録内容をマスタに重ね、別タブで保存されたら差し替える（docs/09 §7.2、APP-11）。
 * @param opts コンテナ設定
 * @param master 検証済みマスタ
 * @param store 保存先
 * @returns スポットの参照と、差し替えの通知の登録関数
 * @sideEffect デモでは window の storage イベントを監視する
 */
async function buildCmsReflection(opts: ContainerOptions, master: LoadedMaster, store: KeyValueStore): Promise<CmsReflection> {
  const log = logger.fn('buildCmsReflection', { mode: opts.mode });
  // import.meta.env はビルド時に文字どおりの定数へ置き換わるので、本番ビルドからは以下の CMS の処理ごと消える（MUST-8）。
  // env.ts の isProductionBuild 経由だと定数として畳み込まれないため、ここだけ直接書く（テストでは PROD=false なので通る）
  if ((import.meta.env.PROD && import.meta.env.MODE !== 'demo') || opts.mode !== 'demo') return log.exit({ spots: master.spots });
  if ((opts.cmsBackend ?? CMS_BACKEND) === 'server') {
    // 連携サーバーの公開スナップショットを重ねる（別の端末の CMS で保存しても届く。docs/09 §7.3）
    return log.exit(await buildServerCmsReflection({ catalog: master.catalog, store, prefix: PREFIX_BY_MODE.demo, ...(opts.cmsApi === undefined ? {} : { api: opts.cmsApi }) }));
  }
  const overlays = new LocalStorageCmsOverlayRepository({ store, prefix: PREFIX_BY_MODE.demo });
  const spots = new RefreshableSpotRepository(await overlaidCatalog(overlays, master.catalog));
  const listeners = new Set<() => void>();
  watchStorageKey(overlays.storageKey(), () => {
    void overlaidCatalog(overlays, master.catalog).then((catalog) => {
      spots.replace(catalog);
      log.info('店舗CMS の登録内容を反映しました', { listeners: listeners.size });
      for (const listener of listeners) listener();
    });
  });
  return log.exit({
    spots,
    onCatalogChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

/**
 * 画面に渡すサービス一覧を作る。
 * @param base 共通の依存
 * @param updateLords 地区の主の再判定ユースケース
 * @param cms 店舗CMS の反映（デモだけ）
 * @returns AppServices
 */
function buildServices(base: BaseDeps, updateLords: UpdateDistrictLordUseCase, cms: CmsReflection): AppServices {
  const log = logger.fn('buildServices', { demo: base.demo });
  const demo = base.demo && base.demoControl ? buildDemoServices(base, base.demoControl, updateLords, cms) : undefined;
  return log.exit({
    isDemo: base.demo,
    events: base.bus,
    status: new GetAppStatusUseCase(base),
    map: new GetMapDataUseCase(base),
    position: new GetCurrentPositionUseCase(base),
    discover: new DiscoverNearbySpotsUseCase(base),
    visit: new VisitSpotUseCase(base),
    nearby: new GetNearbySpotsUseCase(base),
    reasons: new GetRevisitReasonsUseCase(base),
    spotDetail: new GetSpotDetailUseCase(base),
    zukan: new GetZukanUseCase(base),
    town: new GetTownStateUseCase(base),
    myTown: new GetMyTownUseCase(base),
    avatar: new GetAvatarClosetUseCase(base),
    saveAvatar: new SaveAvatarUseCase(base),
    rankStatus: new GetRankStatusUseCase(base),
    ranking: new GetRankingUseCase(base),
    travelers: new GetOtherTravelersUseCase(base),
    settings: new GetSettingsUseCase(base),
    updateTextScale: new UpdateTextScaleUseCase(base),
    exportData: new ExportDataUseCase(base),
    deleteAllData: new DeleteAllDataUseCase(base),
    demo,
  });
}

/**
 * マスタを読み、依存を組み立て、旅人を用意して AppServices を返す。
 * デモでは起動のたびに位置を開始地区（南森町・天満宮地区）の入口へ置く（位置はメモリのみ＝PRV-03）。
 * @param opts コンテナ設定
 * @returns 成功: AppServices。失敗: マスタ検証エラー（起動中止＝DI-13）／STORAGE_FAILED 等
 * @sideEffect 旅人が無ければ作成して保存する（EnsureTravelerUseCase）
 */
export async function createContainer(opts: ContainerOptions): Promise<Result<AppServices>> {
  const log = logger.fn('createContainer', { mode: opts.mode });
  const master = await MasterDataLoader.load(opts.fetchText ?? browserFetchText);
  if (!master.ok) return log.fail(master);
  const store = opts.store ?? new LocalStorageKeyValueStore();
  const cms = await buildCmsReflection(opts, master.value, store);
  const base = buildBaseDeps({ ...opts, store }, master.value, cms.spots);
  const updateLords = new UpdateDistrictLordUseCase(base);
  registerVisitHandlers(base, updateLords);
  const ensured = await new EnsureTravelerUseCase(base).execute();
  if (!ensured.ok) return log.fail(ensured);
  const services = buildServices(base, updateLords, cms);
  if (services.demo) {
    const placed = await services.demo.resetPosition.execute();
    if (!placed.ok) return log.fail(placed);
  }
  log.info('コンテナ準備完了', { mode: opts.mode, profile: ensured.value.profile });
  return log.exit(ok(services));
}
