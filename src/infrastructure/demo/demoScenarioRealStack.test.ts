/**
 * @file 本物の infrastructure（localStorage 形式の保存・InMemoryEventBus・DemoClock・DemoGeoProvider・DemoControlAdapter・
 * CryptoIdGenerator・public/master の実マスタ）に application のユースケースを配線し、実演 6 手順（CLAUDE.md 7.2）を通す統合テスト（infrastructure 層・テスト）。
 * application の偽物（fakes）ではなく実装どうしを組み合わせたときの食い違い（deps の形・版数・保存形式・イベント連鎖・実マスタのシード）を検出する。
 * 配線はこのファイル内で組む（container.ts とは独立）。保存先だけメモリのキー・値ストアにする。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { AppServices, DemoServices } from '@/application/AppServices';
import { EventFactory } from '@/application/events/EventFactory';
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
import { GetRankStatusUseCase } from '@/application/usecases/reward/GetRankStatusUseCase';
import { EvaluateDistrictChangeUseCase } from '@/application/usecases/town/EvaluateDistrictChangeUseCase';
import { GetAvatarClosetUseCase } from '@/application/usecases/avatar/GetAvatarClosetUseCase';
import { SaveAvatarUseCase } from '@/application/usecases/avatar/SaveAvatarUseCase';
import { GetMyTownUseCase } from '@/application/usecases/town/GetMyTownUseCase';
import { GetTownStateUseCase } from '@/application/usecases/town/GetTownStateUseCase';
import { GetSettingsUseCase } from '@/application/usecases/settings/GetSettingsUseCase';
import { UpdateTextScaleUseCase } from '@/application/usecases/settings/UpdateTextScaleUseCase';
import { ExportDataUseCase } from '@/application/usecases/settings/ExportDataUseCase';
import { ImportDataUseCase } from '@/application/usecases/settings/ImportDataUseCase';
import { DeleteAllDataUseCase } from '@/application/usecases/settings/DeleteAllDataUseCase';
import { InMemoryAvatarRepository } from '@/application/testing/InMemoryAvatarRepository';
import { GetVisitLogUseCase } from '@/application/usecases/spot/GetVisitLogUseCase';
import { SaveVisitMemoryUseCase } from '@/application/usecases/spot/SaveVisitMemoryUseCase';
import { LocalStorageVisitMemoryRepository } from '@/infrastructure/storage/LocalStorageVisitMemoryRepository';
import { DOMAIN_EVENT_TYPES } from '@/domain/events/DomainEvent';
import type { DomainEvent } from '@/domain/events/DomainEvent';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import { DemoControlAdapter } from '@/infrastructure/demo/DemoControlAdapter';
import { InMemoryEventBus } from '@/infrastructure/events/InMemoryEventBus';
import { DemoGeoProvider } from '@/infrastructure/geo/DemoGeoProvider';
import { MasterDataLoader } from '@/infrastructure/master/MasterDataLoader';
import { CryptoIdGenerator, uuid } from '@/infrastructure/random/CryptoIdGenerator';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { LocalStorageLordshipRepository } from '@/infrastructure/storage/LocalStorageLordshipRepository';
import { LocalStoragePointLedgerRepository } from '@/infrastructure/storage/LocalStoragePointLedgerRepository';
import { LocalStorageRivalActionRepository } from '@/infrastructure/storage/LocalStorageRivalActionRepository';
import { LocalStorageSessionRepository } from '@/infrastructure/storage/LocalStorageSessionRepository';
import { LocalStorageSettingsRepository } from '@/infrastructure/storage/LocalStorageSettingsRepository';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';
import { LocalStorageDataPort } from '@/infrastructure/storage/LocalStorageDataPort';
import { LocalStorageTravelerRepository } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { DemoClock } from '@/infrastructure/time/DemoClock';
import { SystemClock } from '@/infrastructure/time/SystemClock';

/** 実時刻の代わり（2026-11-09 10:00 JST） */
const NOW_MS = Date.parse('2026-11-09T01:00:00.000Z');
const MASTER_DIR = resolve(process.cwd(), 'public/master');

/** テスト用: 成功値を取り出す（失敗ならコード付きで投げる） */
function must<T>(result: Result<T, AppError<string>>): T {
  if (!result.ok) throw new Error(`期待しない失敗: ${result.error.code} ${result.error.message}`);
  return result.value;
}

/** テスト用: public/master の実ファイルを読む取得関数 */
async function fetchFromDisk(fileName: string): Promise<Result<string>> {
  try {
    return ok(readFileSync(resolve(MASTER_DIR, fileName), 'utf8'));
  } catch (error) {
    return fail(AppError.of('MASTER_FETCH_FAILED', 'x', { fileName }, error));
  }
}

/** 組み立てた一式 */
interface Stack {
  readonly services: AppServices;
  readonly demo: DemoServices;
  readonly spots: SpotRepository;
  /** 配送されたイベント（発行順） */
  readonly published: DomainEvent[];
  /** SpotVisited のハンドラが返した失敗（コード） */
  readonly handlerFailures: string[];
  readonly ensured: { readonly travelerId: string; readonly created: boolean };
}

/** テスト用: 本物の infrastructure で AppServices を組み立て、起動時の旅人準備まで行う（デモビルド相当） */
async function buildDemoStack(store: InMemoryKeyValueStore): Promise<Stack> {
  const master = must(await MasterDataLoader.load(fetchFromDisk));
  const repo = { store, prefix: 'nnishi.demo.' };
  const clock = new DemoClock({ store, nowMs: () => NOW_MS });
  const geo = new DemoGeoProvider(clock);
  const ids = new CryptoIdGenerator();
  const bus = new InMemoryEventBus();
  const base = {
    session: new LocalStorageSessionRepository(repo), travelers: new LocalStorageTravelerRepository(repo),
    ledgers: new LocalStoragePointLedgerRepository(repo), lordships: new LocalStorageLordshipRepository(repo),
    rivalActions: new LocalStorageRivalActionRepository(repo), spots: master.spots, rivals: master.rivals,
    clock, geo, events: bus, eventFactory: new EventFactory({ ids, clock }),
    demoControl: new DemoControlAdapter({ clock, geo, enabled: true }), uuid, enabled: true, demo: true,
  };
  const updateLords = new UpdateDistrictLordUseCase(base);
  const bag = { ...base, updateLords };
  const avatars = new InMemoryAvatarRepository();
  const memories = new LocalStorageVisitMemoryRepository(repo);
  const settings = new LocalStorageSettingsRepository(repo);
  const userData = new LocalStorageDataPort(repo);
  const published: DomainEvent[] = [];
  const handlerFailures: string[] = [];
  for (const type of DOMAIN_EVENT_TYPES) bus.subscribe(type, (event) => void published.push(event));
  for (const handler of [new EvaluateDistrictChangeUseCase(bag), new AwardVisitRewardsUseCase(bag), updateLords]) {
    bus.subscribe('SpotVisited', async (event) => {
      const result = await handler.handle(event);
      if (!result.ok) handlerFailures.push(result.error.code);
    });
  }
  const ensured = must(await new EnsureTravelerUseCase(bag).execute());
  const demo: DemoServices = {
    advanceDate: new AdvanceDateUseCase(bag), simulateRival: new SimulateRivalUseCase(bag), switchTraveler: new SwitchTravelerUseCase(bag),
    resetPosition: new ResetPositionUseCase(bag), moveTo: new MoveDemoPositionUseCase(bag),
  };
  const services: AppServices = {
    isDemo: true, events: bus, status: new GetAppStatusUseCase(bag), map: new GetMapDataUseCase(bag), position: new GetCurrentPositionUseCase(bag),
    discover: new DiscoverNearbySpotsUseCase(bag), visit: new VisitSpotUseCase(bag), nearby: new GetNearbySpotsUseCase(bag),
    reasons: new GetRevisitReasonsUseCase(bag), spotDetail: new GetSpotDetailUseCase(bag), town: new GetTownStateUseCase(bag), zukan: new GetZukanUseCase(bag), ranking: new GetRankingUseCase(bag), demo,
    myTown: new GetMyTownUseCase({ ...bag, avatars }), avatar: new GetAvatarClosetUseCase({ ...bag, avatars }), saveAvatar: new SaveAvatarUseCase({ ...bag, avatars }),
    rankStatus: new GetRankStatusUseCase(bag),
    visitLog: new GetVisitLogUseCase({ ...bag, memories }), saveVisitMemory: new SaveVisitMemoryUseCase({ ...bag, memories }),
    settings: new GetSettingsUseCase({ settings }), updateTextScale: new UpdateTextScaleUseCase({ settings }),
    exportData: new ExportDataUseCase({ userData, clock, demo: true }),
    importData: new ImportDataUseCase({ userData, demo: true, parseJson: (text) => parseJsonText(text, 'userDataImport') }),
    deleteAllData: new DeleteAllDataUseCase({ userData }),
  };
  must(await demo.resetPosition.execute());
  return { services, demo, spots: master.spots, published, handlerFailures, ensured };
}

/** テスト用: スポットの位置へ歩いて（デモ位置を動かして）訪問する */
async function walkAndVisit(stack: Stack, spotId: string): Promise<void> {
  const spot = stack.spots.allSpots().find((candidate) => candidate.id === spotId);
  if (spot === undefined) throw new Error(`実マスタに ${spotId} が無い`);
  must(await stack.demo.moveTo.execute({ lat: spot.point.lat, lng: spot.point.lng }));
  must(await stack.services.discover.execute({ operationId: uuid() }));
  const visited = must(await stack.services.visit.execute({ operationId: uuid(), spotId }));
  expect(visited.duplicate).toBe(false);
}

/** テスト用: 配送されたイベントのうち指定した種別だけを取り出す（取り出したものは消す） */
function takeEvents(stack: Stack, type: DomainEvent['type']): DomainEvent[] {
  const taken = stack.published.filter((event) => event.type === type);
  const rest = stack.published.filter((event) => event.type !== type);
  stack.published.splice(0, stack.published.length, ...rest);
  return taken;
}

/** テスト用: 再訪理由のうち種別と地区が一致するもの */
async function reasonOf(stack: Stack, kind: string, districtId: string): Promise<{ title: string; calendar?: unknown } | undefined> {
  return must(await stack.services.reasons.execute()).find((reason) => reason.kind === kind && reason.districtId === districtId);
}

describe('実演シナリオ（本物の infrastructure ＋ 実マスタ＝大阪・南森町周辺、docs/08 §9.3）', () => {
  it('起動直後: 通い慣れた人が用意され、大川の「そろそろ」・扇町・中崎町の色あせ・天六の輪郭が見える', async () => {
    const stack = await buildDemoStack(new InMemoryKeyValueStore());
    expect(stack.ensured).toMatchObject({ travelerId: 't_demoregular', created: true });
    expect(must(await stack.services.status.execute())).toMatchObject({ today: '2026-11-09', isDemo: true, travelerProfile: 'regular', dayOffset: 0 });
    expect(await reasonOf(stack, 'fade', 'd_okawa')).toMatchObject({ title: expect.stringContaining('あと5日'), calendar: expect.anything() });
    const map = must(await stack.services.map.execute());
    expect(map.districts.map((d) => [d.id, d.level, d.fade.kind])).toEqual([
      ['d_minamimori', 2, 'fresh'], ['d_tenma', 3, 'fresh'], ['d_tenroku', 0, 'never'], ['d_ogimachi', 3, 'fading'], ['d_okawa', 3, 'soon'],
    ]);
    expect(map.backdrop.features.length).toBeGreaterThan(0);
    expect(map.backdrop.attribution).toContain('OpenStreetMap');
    expect(map.spots.filter((s) => s.kind === 'landmark').every((s) => typeof s.name === 'string')).toBe(true);
    const lords = must(await stack.services.town.execute()).districts.map((d) => [d.id, d.lordName]);
    expect(lords).toEqual([['d_minamimori', 'おまいり番長'], ['d_tenma', 'あなた'], ['d_tenroku', '天六の生き字引'], ['d_ogimachi', '中崎町カフェ部'], ['d_okawa', '花見は毎日派']]);
    expect(must(await stack.services.position.execute()).accuracyM).toBe(5);
  });

  it('手順2〜6: 発見・訪問で南森町 Lv3 → +30日で天満が色あせ → ライバル行動で取り返し → 再訪で復活・おかえり・金カード → 取り返し', async () => {
    const stack = await buildDemoStack(new InMemoryKeyValueStore());
    await walkAndVisit(stack, 's_mm02');
    expect(takeEvents(stack, 'DistrictGrown')).toEqual([expect.objectContaining({ districtId: 'd_minamimori', from: 2, to: 3 })]);
    expect(takeEvents(stack, 'PointsAwarded')).toHaveLength(1);

    expect(must(await stack.demo.advanceDate.execute({ days: 30 }))).toEqual({ today: '2026-12-09', dayOffset: 30 });
    expect(await reasonOf(stack, 'fade', 'd_tenma')).toMatchObject({ title: '色あせ中：天満地区' });

    expect(must(await stack.demo.simulateRival.execute({ operationId: uuid() }))).toMatchObject({ districtId: 'd_tenma', rivalName: 'おまいり番長', changed: true });
    expect(await reasonOf(stack, 'reclaim', 'd_tenma')).toMatchObject({ title: '天満地区の領主をおまいり番長に奪われた' });

    await walkAndVisit(stack, 'l_tm01');
    expect(takeEvents(stack, 'DistrictRevived')).toEqual([expect.objectContaining({ districtId: 'd_tenma', daysSinceLastVisit: 32, level: 3 })]);
    expect(takeEvents(stack, 'WelcomeBackBonusGranted')).toEqual([expect.objectContaining({ districtId: 'd_tenma', multiplier: 1.5 })]);
    expect(takeEvents(stack, 'CardAwarded')).toEqual([expect.objectContaining({ districtId: 'd_tenma', rank: 'gold', visitCount: 10 })]);
    expect(await reasonOf(stack, 'fade', 'd_tenma')).toBeUndefined();

    await walkAndVisit(stack, 'l_tm02');
    const lordChanges = takeEvents(stack, 'DistrictLordChanged').filter((e) => e.type === 'DistrictLordChanged' && e.districtId === 'd_tenma');
    expect(lordChanges.map((e) => (e.type === 'DistrictLordChanged' ? e.toName : ''))).toEqual(['おまいり番長', 'あなた']);
    expect(await reasonOf(stack, 'reclaim', 'd_tenma')).toBeUndefined();
    expect(stack.handlerFailures).toEqual([]);
  });

  it('同じ operationId の訪問を再送しても duplicate=true で、加点・イベントは増えない（DI-07）', async () => {
    const stack = await buildDemoStack(new InMemoryKeyValueStore());
    const spot = stack.spots.allSpots().find((candidate) => candidate.id === 's_mm02');
    if (spot === undefined) throw new Error('s_mm02 が無い');
    must(await stack.demo.moveTo.execute({ lat: spot.point.lat, lng: spot.point.lng }));
    const operationId = uuid();
    expect(must(await stack.services.visit.execute({ operationId, spotId: 's_mm02' })).duplicate).toBe(false);
    const before = stack.published.length;
    expect(must(await stack.services.visit.execute({ operationId, spotId: 's_mm02' })).duplicate).toBe(true);
    expect(stack.published.length).toBe(before);
    expect(must(await stack.services.spotDetail.execute({ spotId: 's_mm02' }))).toMatchObject({ visitCount: 1, visitedToday: true, canVisit: false });
  });

  it('再読込（同じ保存先で組み直し）しても日付のずらし・訪問・主が続きから見え、生座標は保存されない（D13, SEC-13）', async () => {
    const store = new InMemoryKeyValueStore();
    const first = await buildDemoStack(store);
    await walkAndVisit(first, 's_mm02');
    must(await first.demo.advanceDate.execute({ days: 30 }));
    const reloaded = await buildDemoStack(store);
    expect(reloaded.ensured.created).toBe(false);
    expect(must(await reloaded.services.status.execute())).toMatchObject({ today: '2026-12-09', dayOffset: 30 });
    expect(must(await reloaded.services.spotDetail.execute({ spotId: 's_mm02' })).visitCount).toBe(1);
    const values = Object.values(store.snapshot()).join('\n');
    expect(values).not.toMatch(/"lat"|"lng"/);
    expect(Object.keys(store.snapshot()).every((key) => key.startsWith('nnishi.demo.'))).toBe(true);
  });

  it('旅人切替で日付のずらしが 0 に戻り、初回の人は記録なし・主なしから始まる', async () => {
    const stack = await buildDemoStack(new InMemoryKeyValueStore());
    must(await stack.demo.advanceDate.execute({ days: 90 }));
    expect(must(await stack.demo.switchTraveler.execute({ profile: 'first' }))).toEqual({ travelerId: 't_demofirst', profile: 'first' });
    expect(must(await stack.services.status.execute())).toMatchObject({ today: '2026-11-09', travelerProfile: 'first', dayOffset: 0 });
    const districts = must(await stack.services.town.execute()).districts;
    expect(districts.every((d) => d.level === 0 && d.visitCount === 0 && !d.isLordMe)).toBe(true);
    expect(must(await stack.demo.switchTraveler.execute({ profile: 'regular' })).travelerId).toBe('t_demoregular');
    expect(must(await stack.services.map.execute()).districts.find((d) => d.id === 'd_tenma')?.isLordMe).toBe(true);
  });
});

describe('本番ビルド相当の配線（本物の infrastructure）', () => {
  it('端末ID の旅人を作り、デモ操作は DEMO_DISABLED、保存キーは本番の名前空間だけ（SEC-02, DI-23）', async () => {
    const store = new InMemoryKeyValueStore();
    const master = must(await MasterDataLoader.load(fetchFromDisk));
    const repo = { store, prefix: 'nnishi.' };
    const clock = new SystemClock(() => NOW_MS);
    const base = {
      session: new LocalStorageSessionRepository(repo), travelers: new LocalStorageTravelerRepository(repo),
      ledgers: new LocalStoragePointLedgerRepository(repo), lordships: new LocalStorageLordshipRepository(repo),
      rivalActions: new LocalStorageRivalActionRepository(repo), spots: master.spots, rivals: master.rivals, clock, uuid, demo: false,
    };
    const ensured = must(await new EnsureTravelerUseCase(base).execute());
    expect(ensured).toMatchObject({ profile: 'user', created: true });
    expect(ensured.travelerId).toMatch(/^t_[0-9a-f]{32}$/);
    expect(must(await new GetAppStatusUseCase(base).execute())).toMatchObject({ isDemo: false, travelerProfile: 'user' });
    const geo = new DemoGeoProvider(clock);
    const demoControl = new DemoControlAdapter({ clock: new DemoClock({ store }), geo });
    const advance = new AdvanceDateUseCase({ clock, demoControl, updateLords: { execute: async () => ok({ changed: [] }) } });
    const result = await advance.execute({ days: 30 });
    expect(result.ok ? undefined : result.error.code).toBe('DEMO_DISABLED');
    expect(demoControl.advanceDays(30).ok).toBe(false);
    expect(Object.keys(store.snapshot()).every((key) => key.startsWith('nnishi.') && !key.startsWith('nnishi.demo.'))).toBe(true);
  });
});
