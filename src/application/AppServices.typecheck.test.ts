/**
 * @file AppServices の契約とユースケース実装の突き合わせ（application 層・テスト）
 * - 型レベル: 各ユースケースのインスタンス型が AppServices / DemoServices の該当フィールド（UseCase<I, O>）に代入できること（expectTypeOf。tsc --noEmit で検査される）
 * - 型レベル: container が1つの共有オブジェクト（ContainerBag）を各コンストラクタに渡せること（deps の形の確認）
 * - 実行: テスト用の偽物一式で AppServices を組み立て、全フィールドが実際に動くこと（container.ts の参照配線）
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Result } from '@/Common/result/Result';
import type { AppServices, DemoServices, UseCase } from '@/application/AppServices';
import type { DomainEventHandler, EventBus, EventSubscriber } from '@/application/events/EventBus';
import type { EventFactory } from '@/application/events/EventFactory';
import type { DemoControl } from '@/application/ports/DemoControl';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import { createTestWorld, must, offsetPoint, seedTraveler, spotOf, testOperationId } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { createScenarioWorld } from '@/application/testing/scenarioCatalog';
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
import { EvaluateDistrictChangeUseCase } from '@/application/usecases/town/EvaluateDistrictChangeUseCase';
import { GetAvatarClosetUseCase } from '@/application/usecases/avatar/GetAvatarClosetUseCase';
import { SaveAvatarUseCase } from '@/application/usecases/avatar/SaveAvatarUseCase';
import { GetMyTownUseCase } from '@/application/usecases/town/GetMyTownUseCase';
import { GetTownStateUseCase } from '@/application/usecases/town/GetTownStateUseCase';
import { InMemoryAvatarRepository } from '@/application/testing/InMemoryAvatarRepository';
import { InMemorySettingsRepository } from '@/application/testing/InMemorySettingsRepository';
import { GetRankStatusUseCase } from '@/application/usecases/reward/GetRankStatusUseCase';
import { GetSettingsUseCase } from '@/application/usecases/settings/GetSettingsUseCase';
import { UpdateTextScaleUseCase } from '@/application/usecases/settings/UpdateTextScaleUseCase';
import { ExportDataUseCase } from '@/application/usecases/settings/ExportDataUseCase';
import { DeleteAllDataUseCase } from '@/application/usecases/settings/DeleteAllDataUseCase';
import { InMemoryDataPort } from '@/application/testing/InMemoryDataPort';
import type { AvatarRepository } from '@/application/ports/AvatarRepository';
import type { DataPort } from '@/application/ports/DataPort';
import type { SettingsRepository } from '@/application/ports/SettingsRepository';
import type { LordshipRepository } from '@/domain/competition/LordshipRepository';
import type { RivalActionRepository, RivalRepository } from '@/domain/competition/RivalRepository';
import type { SpotVisited } from '@/domain/events/DomainEvent';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import type { Clock } from '@/domain/ports/Clock';
import type { GeoProvider } from '@/domain/ports/GeoProvider';
import type { PointLedgerRepository } from '@/domain/reward/PointLedgerRepository';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

/**
 * container が組み立てる共有の依存（ポートの IF 型だけで書く）。
 * 各ユースケースのコンストラクタはこの1つのオブジェクトをそのまま受け取れる（構造的部分型）。
 */
interface ContainerBag {
  readonly session: SessionRepository;
  readonly avatars: AvatarRepository;
  readonly settings: SettingsRepository;
  readonly userData: DataPort;
  readonly travelers: TravelerRepository;
  readonly ledgers: PointLedgerRepository;
  readonly lordships: LordshipRepository;
  readonly rivalActions: RivalActionRepository;
  readonly rivals: RivalRepository;
  readonly spots: SpotRepository;
  readonly clock: Clock;
  readonly geo: GeoProvider;
  readonly events: EventBus;
  readonly eventFactory: EventFactory;
  readonly demoControl: DemoControl;
  readonly updateLords: UpdateDistrictLordUseCase;
  readonly uuid: () => string;
  readonly enabled: boolean;
  readonly demo: boolean;
}

/** コンストラクタの第1引数（deps）の型 */
type DepsOf<C extends abstract new (...args: never[]) => unknown> = ConstructorParameters<C>[0];

/** SpotVisited を受けるハンドラの形（container は戻り値の Result を見てログに残す） */
type VisitedHandler = (event: SpotVisited) => Promise<Result<void>>;

describe('AppServices の型（ユースケースの代入可能性）', () => {
  it('各ユースケースのインスタンスが AppServices の該当フィールドに代入できる', () => {
    expectTypeOf<GetAppStatusUseCase>().toExtend<AppServices['status']>();
    expectTypeOf<GetMapDataUseCase>().toExtend<AppServices['map']>();
    expectTypeOf<GetCurrentPositionUseCase>().toExtend<AppServices['position']>();
    expectTypeOf<DiscoverNearbySpotsUseCase>().toExtend<AppServices['discover']>();
    expectTypeOf<VisitSpotUseCase>().toExtend<AppServices['visit']>();
    expectTypeOf<GetNearbySpotsUseCase>().toExtend<AppServices['nearby']>();
    expectTypeOf<GetRevisitReasonsUseCase>().toExtend<AppServices['reasons']>();
    expectTypeOf<GetSpotDetailUseCase>().toExtend<AppServices['spotDetail']>();
    expectTypeOf<GetTownStateUseCase>().toExtend<AppServices['town']>();
    expectTypeOf<GetMyTownUseCase>().toExtend<AppServices['myTown']>();
    expectTypeOf<GetAvatarClosetUseCase>().toExtend<AppServices['avatar']>();
    expectTypeOf<SaveAvatarUseCase>().toExtend<AppServices['saveAvatar']>();
    expectTypeOf<GetRankStatusUseCase>().toExtend<AppServices['rankStatus']>();
    expectTypeOf<GetSettingsUseCase>().toExtend<AppServices['settings']>();
    expectTypeOf<UpdateTextScaleUseCase>().toExtend<AppServices['updateTextScale']>();
    expectTypeOf<ExportDataUseCase>().toExtend<AppServices['exportData']>();
    expectTypeOf<DeleteAllDataUseCase>().toExtend<AppServices['deleteAllData']>();
  });

  it('デモ5つのインスタンスが DemoServices の該当フィールドに代入できる', () => {
    expectTypeOf<AdvanceDateUseCase>().toExtend<DemoServices['advanceDate']>();
    expectTypeOf<SimulateRivalUseCase>().toExtend<DemoServices['simulateRival']>();
    expectTypeOf<SwitchTravelerUseCase>().toExtend<DemoServices['switchTraveler']>();
    expectTypeOf<ResetPositionUseCase>().toExtend<DemoServices['resetPosition']>();
    expectTypeOf<MoveDemoPositionUseCase>().toExtend<DemoServices['moveTo']>();
  });

  it('EventBus は presentation 向けの EventSubscriber（events フィールド）として渡せる', () => {
    expectTypeOf<EventBus>().toExtend<AppServices['events']>();
    expectTypeOf<EventBus>().toExtend<EventSubscriber>();
  });

  it('起動時の EnsureTravelerUseCase も UseCase<void, …> の形（container が起動時に1回呼ぶ）', () => {
    expectTypeOf<EnsureTravelerUseCase>().toExtend<UseCase<void, { readonly travelerId: string; readonly created: boolean }>>();
  });

  it('SpotVisited のハンドラ3つは (event) => Promise<Result<void>> の handle を持ち、EventBus には包んで登録する', () => {
    expectTypeOf<EvaluateDistrictChangeUseCase['handle']>().toExtend<VisitedHandler>();
    expectTypeOf<AwardVisitRewardsUseCase['handle']>().toExtend<VisitedHandler>();
    expectTypeOf<UpdateDistrictLordUseCase['handle']>().toExtend<VisitedHandler>();
    // handle は Result を返すので EventBus のハンドラ型（void を返す）にはそのまま渡せない。container で await して失敗をログに残す包みを書く
    expectTypeOf<EvaluateDistrictChangeUseCase['handle']>().not.toExtend<DomainEventHandler<'SpotVisited'>>();
  });

  it('container の共有オブジェクト1つを全ユースケースのコンストラクタに渡せる', () => {
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof GetAppStatusUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof EnsureTravelerUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof GetMapDataUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof GetCurrentPositionUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof DiscoverNearbySpotsUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof VisitSpotUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof GetNearbySpotsUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof GetRevisitReasonsUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof GetSpotDetailUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof GetTownStateUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof GetMyTownUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof GetAvatarClosetUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof SaveAvatarUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof GetRankStatusUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof GetSettingsUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof UpdateTextScaleUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof ExportDataUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof DeleteAllDataUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof EvaluateDistrictChangeUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof AwardVisitRewardsUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof UpdateDistrictLordUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof AdvanceDateUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof SimulateRivalUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof SwitchTravelerUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof ResetPositionUseCase>>();
    expectTypeOf<ContainerBag>().toExtend<DepsOf<typeof MoveDemoPositionUseCase>>();
  });
});

/**
 * テスト用の偽物で AppServices を組み立てる（container.ts の参照配線。ハンドラは §4.2 の順で購読）。
 * @param tw テスト用の世界
 * @param demo デモ操作を有効にするか
 * @returns AppServices
 */
function buildServices(tw: TestWorld, demo: boolean): AppServices {
  const updateLords = new UpdateDistrictLordUseCase(tw);
  const withAvatars = { ...tw, avatars: new InMemoryAvatarRepository() };
  const withSettings = { settings: new InMemorySettingsRepository() };
  const withUserData = { userData: new InMemoryDataPort({ settings: { textScale: 'large' } }), clock: tw.clock, demo };
  const bag = { ...tw, demoControl: tw.demo, updateLords, enabled: demo };
  const handlers = [new EvaluateDistrictChangeUseCase(tw), new AwardVisitRewardsUseCase(tw), updateLords];
  for (const handler of handlers) {
    tw.events.subscribe('SpotVisited', async (event) => {
      must(await handler.handle(event));
    });
  }
  const demoServices: DemoServices = {
    advanceDate: new AdvanceDateUseCase(bag),
    simulateRival: new SimulateRivalUseCase(bag),
    switchTraveler: new SwitchTravelerUseCase(bag),
    resetPosition: new ResetPositionUseCase(bag),
    moveTo: new MoveDemoPositionUseCase(bag),
  };
  return {
    isDemo: demo,
    events: tw.events,
    status: new GetAppStatusUseCase(demo ? bag : tw),
    map: new GetMapDataUseCase(tw),
    position: new GetCurrentPositionUseCase(tw),
    discover: new DiscoverNearbySpotsUseCase(tw),
    visit: new VisitSpotUseCase(tw),
    nearby: new GetNearbySpotsUseCase(tw),
    reasons: new GetRevisitReasonsUseCase(tw),
    spotDetail: new GetSpotDetailUseCase(tw),
    zukan: new GetZukanUseCase(tw),
    ranking: new GetRankingUseCase(tw),
    town: new GetTownStateUseCase(tw),
    myTown: new GetMyTownUseCase(withAvatars),
    avatar: new GetAvatarClosetUseCase(withAvatars),
    saveAvatar: new SaveAvatarUseCase(withAvatars),
    rankStatus: new GetRankStatusUseCase(tw),
    settings: new GetSettingsUseCase(withSettings),
    updateTextScale: new UpdateTextScaleUseCase(withSettings),
    exportData: new ExportDataUseCase(withUserData),
    deleteAllData: new DeleteAllDataUseCase(withUserData),
    ...(demo ? { demo: demoServices } : {}),
  };
}

describe('AppServices の組み立て（偽物一式での参照配線）', () => {
  it('組み立てた AppServices の全フィールドが動き、訪問で SpotVisited → 報酬までの連鎖が走る', async () => {
    const tw = createTestWorld();
    const services = buildServices(tw, false);
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    tw.geo.setPoint(offsetPoint(spotOf(tw.spots, 'l_jo01').point, { eastM: 10 }));
    expect(services.isDemo).toBe(false);
    expect(services.demo).toBeUndefined();
    expect(must(await services.status.execute())).toMatchObject({ isDemo: false, travelerProfile: 'user' });
    expect(must(await services.map.execute()).districts.length).toBeGreaterThan(0);
    expect(must(await services.position.execute()).accuracyM).toBeGreaterThan(0);
    must(await services.discover.execute({ operationId: testOperationId(1) }));
    expect(must(await services.visit.execute({ operationId: testOperationId(2), spotId: 'l_jo01' }))).toMatchObject({ duplicate: false });
    expect(tw.events.types()).toEqual(expect.arrayContaining(['SpotVisited', 'PointsAwarded']));
    expect(must(await services.nearby.execute({})).length).toBeGreaterThan(0);
    expect(Array.isArray(must(await services.reasons.execute()))).toBe(true);
    expect(must(await services.spotDetail.execute({ spotId: 'l_jo01' }))).toMatchObject({ status: 'visited', visitCount: 1 });
    expect(must(await services.town.execute()).districts.length).toBe(tw.spots.allDistricts().length);
    expect(must(await services.myTown.execute())).toMatchObject({ totalVisits: 1 });
    expect(must(await services.saveAvatar.execute({ outfit: ['hair.bob'] })).outfit).toContain('hair.bob');
    expect(must(await services.avatar.execute()).outfit).toContain('hair.bob');
    expect(must(await services.rankStatus.execute())).toMatchObject({ totalVisits: 1, points: 10 });
    expect(must(await services.updateTextScale.execute({ textScale: 'large' }))).toEqual({ textScale: 'large' });
    expect(must(await services.settings.execute())).toEqual({ textScale: 'large' });
    expect(must(await services.exportData.execute()).entryCount).toBe(1);
    expect(must(await services.deleteAllData.execute({ confirmed: true }))).toEqual({ removed: 1 });
  });

  it('デモ有効なら demo が5つそろい、状態に dayOffset が付く', async () => {
    const tw = createScenarioWorld({ allRivals: true });
    const services = buildServices(tw, true);
    const demo = services.demo;
    if (demo === undefined) throw new Error('demo が無い');
    must(await demo.switchTraveler.execute({ profile: 'regular' }));
    expect(must(await demo.resetPosition.execute()).accuracyM).toBeGreaterThan(0);
    expect(must(await demo.advanceDate.execute({ days: 1 })).dayOffset).toBe(1);
    expect(must(await services.status.execute())).toMatchObject({ isDemo: true, travelerProfile: 'regular', dayOffset: 1 });
    expect(must(await demo.simulateRival.execute({ operationId: testOperationId(50_000) })).changed).toBe(true);
    const spot = spotOf(tw.spots, 's_mm02');
    expect(must(await demo.moveTo.execute({ lat: spot.point.lat, lng: spot.point.lng }))).toMatchObject({ lat: spot.point.lat });
  });

  it('デモ無効のデモユースケースは DEMO_DISABLED（container が誤って渡しても動かない＝SEC-02）', async () => {
    const tw = createTestWorld();
    const bag = { ...tw, demoControl: tw.demo, updateLords: new UpdateDistrictLordUseCase(tw), enabled: false };
    const result = await new AdvanceDateUseCase(bag).execute({ days: 30 });
    expect(result.ok ? undefined : result.error.code).toBe('DEMO_DISABLED');
  });
});
