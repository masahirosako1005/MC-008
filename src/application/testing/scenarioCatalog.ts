/**
 * @file イベント連鎖・デモ・実演シナリオのテスト用ヘルパと、デモシードを再現する偽カタログ（application 層・テスト専用）
 * 本番コードから import しない。fakes.ts の TestWorld に、SpotVisited の購読ハンドラ（docs/08 §4.2 の順で登録）・
 * デモユースケース一式・訪問の記録（VisitSpotUseCase と同じく 保存 → SpotVisited 発行）・再訪理由の計算を足す。
 * デモシード（demoSeeds.ts）・デモの既定（開始地区 d_minamimori・ライバル行動の地区 d_tenma）は本物のマスタの新しい ID（docs/08 §9.3）を使うので、
 * それらを通すテストは buildScenarioCatalog / createScenarioWorld（新 ID の5地区・51スポット。配置と役割は旧 buildTestCatalog と同じ）を使う。
 * 2026-11-09 に、図鑑の初期データ（大川・扇町の古い訪問、天満の振り替え、天満・大川の発見のみ）で使う31スポットを各地区の北・南の列に足した。
 * 座標は合成（南森町駅付近を原点にした 400m 四方の地区）で、実在の位置とは一致しない。
 * 注意: デモシードの操作ID（'00000000-0000-4000-8000-' ＋ 16 進の連番 1〜）は testOperationId と同じ接頭辞なので、
 * シードの旅人で新しく訪問するときは scenarioOperationId（番号を SCENARIO_OPERATION_BASE だけずらす）を使う。
 */
import { createLogger } from '@/Common/logging/logger';
import type { OperationId } from '@/Common/types/Id';
import { invariant } from '@/Common/utils/assert';
import { buildCatalog, buildSampleBackdrop, createTestWorld, must, spotOf, TEST_ACCURACY_M, testOperationId } from '@/application/testing/fakes';
import type { CatalogDefs, TestCatalog, TestCatalogOptions, TestWorld } from '@/application/testing/fakes';
import { UpdateDistrictLordUseCase } from '@/application/usecases/competition/UpdateDistrictLordUseCase';
import { AdvanceDateUseCase } from '@/application/usecases/demo/AdvanceDateUseCase';
import { MoveDemoPositionUseCase } from '@/application/usecases/demo/MoveDemoPositionUseCase';
import { ResetPositionUseCase } from '@/application/usecases/demo/ResetPositionUseCase';
import { SimulateRivalUseCase } from '@/application/usecases/demo/SimulateRivalUseCase';
import { SwitchTravelerUseCase } from '@/application/usecases/demo/SwitchTravelerUseCase';
import { AwardVisitRewardsUseCase } from '@/application/usecases/reward/AwardVisitRewardsUseCase';
import { lordshipSnapshotsOf } from '@/application/usecases/shared/LordStandings';
import { discoveredSpotIdsOf, loadActiveTraveler, loadWorld } from '@/application/usecases/shared/World';
import { EvaluateDistrictChangeUseCase } from '@/application/usecases/town/EvaluateDistrictChangeUseCase';
import type { SpotVisited } from '@/domain/events/DomainEvent';
import { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { RevisitReason } from '@/domain/revisit/RevisitReason';
import { collect } from '@/domain/revisit/RevisitReasonPolicy';

const logger = createLogger('application/testing/scenarioCatalog');

/** シードの旅人で新しく訪問するときの操作ID の番号のずらし幅（シードの 16 進連番と重ならない） */
export const SCENARIO_OPERATION_BASE = 10_000;

/** シナリオ用カタログの原点（南森町駅付近。地区の位置はここからのずれ m で合成する） */
export const SCENARIO_ORIGIN: GeoPoint = must(GeoPoint.of(34.6977, 135.511));

/**
 * デモシードを再現するカタログの定義（docs/08 §9.1〜§9.3 の新しい ID・名前・色・order）。
 * 地区の配置・スポットのずれ・クーポン/イベントの期間・ライバルの背景活動は旧 buildTestCatalog の役割（城下→南森町・天満宮、本町→天満、
 * 里山→天六、湯の里→扇町・中崎町、みなと→大川）をそのまま写した。店舗名は架空（本物のマスタの店舗名とは一致しない）。
 */
const SCENARIO_CATALOG_DEFS: CatalogDefs = Object.freeze<CatalogDefs>({
  origin: SCENARIO_ORIGIN,
  districts: [
    { id: 'd_minamimori', name: '南森町・天満宮地区', shortName: '南森町', theme: '門前町', order: 1, color: '#7a5ea8', eastM: -500, northM: 300 },
    { id: 'd_tenma', name: '天満地区', shortName: '天満', theme: '市場と食', order: 2, color: '#d9a21b', eastM: 0, northM: 300 },
    { id: 'd_tenroku', name: '天六地区', shortName: '天六', theme: '暮らし', order: 3, color: '#4c9a4a', eastM: 500, northM: 300 },
    { id: 'd_ogimachi', name: '扇町・中崎町地区', shortName: '扇町', theme: '公園と路地', order: 4, color: '#d0566b', eastM: -500, northM: -200 },
    { id: 'd_okawa', name: '大川沿い地区', shortName: '大川', theme: '川辺と桜', order: 5, color: '#2f86c9', eastM: 0, northM: -200 },
  ],
  spots: [
    { id: 'l_mm01', districtId: 'd_minamimori', name: '大阪天満宮', category: '神社', eastM: -100, northM: 100, amenities: ['toilet', 'kids'], partner: false },
    { id: 'l_mm02', districtId: 'd_minamimori', name: '天満天神繁昌亭', category: '寄席', eastM: 0, northM: 100, amenities: ['toilet', 'rainOk'], partner: false },
    { id: 's_mm01', districtId: 'd_minamimori', name: '門前カフェ', category: 'カフェ', eastM: 100, northM: 100, amenities: ['toilet', 'rainOk', 'kids', 'nursing'], partner: true },
    { id: 's_mm02', districtId: 'd_minamimori', name: '天神さん和菓子', category: '和菓子', eastM: -100, northM: 0, amenities: ['kids', 'toilet', 'stroller'], partner: true },
    { id: 's_mm03', districtId: 'd_minamimori', name: '門前茶寮', category: '甘味処', eastM: 0, northM: 0, amenities: ['toilet', 'kids', 'rainOk'], partner: false },
    { id: 's_mm04', districtId: 'd_minamimori', name: '南森町ベーカリー', category: 'パン', eastM: 100, northM: 0, amenities: ['stroller', 'rainOk'], partner: true },
    { id: 'l_tm01', districtId: 'd_tenma', name: '天満市場', category: '市場', eastM: -100, northM: 100, amenities: ['toilet', 'rainOk', 'stroller'], partner: false },
    { id: 'l_tm02', districtId: 'd_tenma', name: '天神橋筋商店街（天四）', category: '商店街', eastM: 0, northM: 100, amenities: ['toilet', 'rainOk'], partner: false },
    { id: 'l_tm03', districtId: 'd_tenma', name: '天満駅前の高架下', category: '高架下', eastM: 100, northM: 100, amenities: ['kids'], partner: false },
    { id: 's_tm01', districtId: 'd_tenma', name: '天満コロッケ', category: '総菜', eastM: -100, northM: 0, amenities: ['kids'], partner: true },
    { id: 's_tm02', districtId: 'd_tenma', name: 'アーケード珈琲', category: 'カフェ', eastM: 0, northM: 0, amenities: ['rainOk', 'toilet', 'kids'], partner: true },
    { id: 's_tm03', districtId: 'd_tenma', name: '天満青果', category: '青果', eastM: 100, northM: 0, amenities: ['kids', 'stroller'], partner: false },
    { id: 's_tm04', districtId: 'd_tenma', name: '市場の八百屋', category: '青果', eastM: -100, northM: -100, amenities: [], partner: false },
    { id: 's_tm05', districtId: 'd_tenma', name: '天満お好み焼き', category: 'お好み焼き', eastM: 0, northM: -100, amenities: ['kids'], partner: false },
    { id: 's_tm08', districtId: 'd_tenma', name: '立ち寿司 天満', category: '寿司', eastM: 100, northM: -100, amenities: [], partner: false },
    { id: 's_tm09', districtId: 'd_tenma', name: '市場食堂', category: '食堂', eastM: -50, northM: -165, amenities: ['toilet'], partner: false },
    { id: 's_tm11', districtId: 'd_tenma', name: '焼き鳥 天満', category: '焼き鳥', eastM: 50, northM: -165, amenities: [], partner: false },
    { id: 's_tm06', districtId: 'd_tenma', name: '漬物処 天満', category: '漬物', eastM: -100, northM: 165, amenities: [], partner: false },
    { id: 's_tm07', districtId: 'd_tenma', name: 'だしの店', category: '乾物', eastM: 0, northM: 165, amenities: [], partner: false },
    { id: 's_tm10', districtId: 'd_tenma', name: '立ち飲み 天満', category: '立ち飲み', eastM: 100, northM: 165, amenities: [], partner: false },
    { id: 's_tm13', districtId: 'd_tenma', name: 'パン工房 天満', category: 'パン', eastM: -165, northM: -165, amenities: [], partner: false },
    { id: 's_tm14', districtId: 'd_tenma', name: '台所道具 天満', category: '雑貨', eastM: 165, northM: -165, amenities: [], partner: false },
    { id: 'l_ok01', districtId: 'd_okawa', name: '造幣局（桜の通り抜け）', category: '桜', eastM: -100, northM: 0, amenities: ['toilet'], partner: false },
    { id: 'l_ok02', districtId: 'd_okawa', name: '泉布観', category: '建築', eastM: 0, northM: 0, amenities: ['toilet', 'rainOk'], partner: false },
    { id: 's_ok01', districtId: 'd_okawa', name: '川べり焼き菓子店', category: '焼き菓子', eastM: 100, northM: 0, amenities: ['stroller'], partner: true },
    { id: 'l_ok03', districtId: 'd_okawa', name: '南天満公園', category: '公園', eastM: -100, northM: 100, amenities: ['toilet', 'kids'], partner: false },
    { id: 's_ok05', districtId: 'd_okawa', name: '川辺のそば', category: 'そば', eastM: 0, northM: 100, amenities: [], partner: false },
    { id: 's_ok07', districtId: 'd_okawa', name: '川辺の和菓子', category: '和菓子', eastM: 100, northM: 100, amenities: [], partner: false },
    { id: 's_ok02', districtId: 'd_okawa', name: '川辺のおにぎり', category: 'おにぎり', eastM: -100, northM: -100, amenities: [], partner: false },
    { id: 's_ok10', districtId: 'd_okawa', name: '川辺の茶房', category: 'カフェ', eastM: 0, northM: -100, amenities: ['rainOk'], partner: false },
    { id: 's_ok11', districtId: 'd_okawa', name: '川辺のジェラート', category: 'ジェラート', eastM: 100, northM: -100, amenities: [], partner: false },
    { id: 's_ok06', districtId: 'd_okawa', name: '川辺の酒店', category: '酒店', eastM: -100, northM: 165, amenities: [], partner: false },
    { id: 's_ok08', districtId: 'd_okawa', name: '川辺の写真館', category: '写真館', eastM: 0, northM: 165, amenities: [], partner: false },
    { id: 's_ok09', districtId: 'd_okawa', name: 'うなぎ処 川辺', category: 'うなぎ', eastM: 100, northM: 165, amenities: [], partner: false },
    { id: 's_ok12', districtId: 'd_okawa', name: '川辺の古道具', category: '古道具', eastM: -50, northM: -165, amenities: [], partner: false },
    { id: 's_ok13', districtId: 'd_okawa', name: '川辺のお好み焼き', category: 'お好み焼き', eastM: 50, northM: -165, amenities: [], partner: false },
    { id: 'l_tr01', districtId: 'd_tenroku', name: '大阪くらしの今昔館', category: '博物館', eastM: -50, northM: 0, amenities: ['toilet', 'rainOk'], partner: false },
    { id: 's_tr01', districtId: 'd_tenroku', name: '天六おむすび', category: '食堂', eastM: 50, northM: 0, amenities: ['kids', 'toilet'], partner: true },
    { id: 'l_og01', districtId: 'd_ogimachi', name: '扇町公園', category: '公園', eastM: -100, northM: 0, amenities: ['toilet', 'kids'], partner: false },
    { id: 'l_og02', districtId: 'd_ogimachi', name: 'キッズプラザ大阪', category: '博物館', eastM: 0, northM: 0, amenities: ['kids', 'nursing', 'rainOk'], partner: false },
    { id: 's_og01', districtId: 'd_ogimachi', name: '中崎町の古書店', category: '古書', eastM: 100, northM: 0, amenities: ['rainOk'], partner: false },
    { id: 'l_og03', districtId: 'd_ogimachi', name: '中崎町の路地', category: '町並み', eastM: -100, northM: 100, amenities: [], partner: false },
    { id: 's_og03', districtId: 'd_ogimachi', name: '路地の古着屋', category: '古着', eastM: 0, northM: 100, amenities: [], partner: false },
    { id: 's_og04', districtId: 'd_ogimachi', name: '路地のたこ焼き', category: 'たこ焼き', eastM: 100, northM: 100, amenities: ['kids'], partner: false },
    { id: 's_og07', districtId: 'd_ogimachi', name: '古書と珈琲', category: '古書', eastM: -100, northM: -100, amenities: ['rainOk'], partner: false },
    { id: 's_og02', districtId: 'd_ogimachi', name: '路地のパン工房', category: 'パン', eastM: 0, northM: -100, amenities: [], partner: false },
    { id: 's_og05', districtId: 'd_ogimachi', name: '器と雑貨の店', category: '雑貨', eastM: 100, northM: -100, amenities: [], partner: false },
    { id: 's_og09', districtId: 'd_ogimachi', name: '路地のギャラリー', category: 'ギャラリー', eastM: 50, northM: -165, amenities: [], partner: false },
    { id: 's_og08', districtId: 'd_ogimachi', name: '路地の手芸店', category: '手芸', eastM: -100, northM: 165, amenities: [], partner: false },
    { id: 's_og11', districtId: 'd_ogimachi', name: 'うどん 扇町', category: 'うどん', eastM: 0, northM: 165, amenities: [], partner: false },
    { id: 's_og12', districtId: 'd_ogimachi', name: '路地の花屋', category: '花', eastM: 100, northM: 165, amenities: [], partner: false },
  ],
  shopEvents: [
    { id: 'c_mm01', spotId: 's_mm02', kind: 'coupon', title: 'どら焼き1個サービス', start: '2026-11-01', end: '2026-11-12' },
    { id: 'c_mm02', spotId: 's_mm01', kind: 'coupon', title: 'ドリンク50円引き', start: '2026-11-01', end: '2026-11-15' },
    { id: 'c_mm03', spotId: 'l_mm01', kind: 'event', title: '門前 秋まつり', start: '2026-10-25', end: '2026-11-30' },
    { id: 'c_tm01', spotId: 's_tm02', kind: 'coupon', title: 'モーニング50円引き', start: '2026-11-01', end: '2026-11-30' },
    { id: 'c_ok01', spotId: 's_ok01', kind: 'coupon', title: '焼き菓子1個おまけ', start: '2026-11-05', end: '2026-11-20' },
    { id: 'c_ok02', spotId: 'l_ok02', kind: 'event', title: '冬の川辺あかり', start: '2026-12-05', end: '2027-01-31' },
    { id: 'c_og01', spotId: 'l_og02', kind: 'event', title: '冬休みこども工作まつり', start: '2026-12-20', end: '2027-01-20' },
  ],
  rivals: [
    { id: 'r_taro', name: 'おまいり番長', patterns: [{ districtId: 'd_minamimori', intervalDays: 4, phase: 1 }] },
    { id: 'r_hana', name: '花見は毎日派', patterns: [{ districtId: 'd_okawa', intervalDays: 3, phase: 0 }, { districtId: 'd_minamimori', intervalDays: 9, phase: 4 }] },
    { id: 'r_ken', name: '天六の生き字引', patterns: [{ districtId: 'd_tenroku', intervalDays: 3, phase: 2 }] },
    { id: 'r_mio', name: 'みおつくし', patterns: [{ districtId: 'd_okawa', intervalDays: 6, phase: 3 }, { districtId: 'd_ogimachi', intervalDays: 8, phase: 5 }] },
    { id: 'r_sora', name: '中崎町カフェ部', patterns: [{ districtId: 'd_ogimachi', intervalDays: 3, phase: 1 }] },
    { id: 'r_riku', name: '商店街踏破中', patterns: [{ districtId: 'd_minamimori', intervalDays: 7, phase: 2 }, { districtId: 'd_tenroku', intervalDays: 9, phase: 6 }] },
    { id: 'r_aoi', name: '親子でてくてく', patterns: [{ districtId: 'd_ogimachi', intervalDays: 10, phase: 7 }] },
  ],
  defaultRivalCount: 2,
});

/** createScenarioWorld の選択肢 */
export interface ScenarioWorldOptions {
  /** 今日（既定 TEST_TODAY_TEXT） */
  readonly today?: string;
  /** true ならライバル7人（既定はおまいり番長・花見は毎日派の2人） */
  readonly allRivals?: boolean;
}

/**
 * デモシードを再現する新 ID のカタログを作る（d_tenma の背景活動は誰も持たない＝D9）。地図の背景は既定で小さなサンプル。
 * @param options ライバルの人数・地図の背景（省略時 buildSampleBackdrop(SCENARIO_ORIGIN)）
 * @returns SpotRepository と RivalRepository の偽物
 */
export function buildScenarioCatalog(options: TestCatalogOptions = {}): TestCatalog {
  const log = logger.fn('buildScenarioCatalog', { allRivals: options.allRivals === true });
  return log.exit(buildCatalog(SCENARIO_CATALOG_DEFS, { ...options, backdrop: options.backdrop ?? buildSampleBackdrop(SCENARIO_ORIGIN) }));
}

/**
 * 新 ID のカタログでテスト用の世界一式を作る（初期位置は開始地区 d_minamimori の入口）。
 * @param options 今日・ライバルの人数
 * @returns TestWorld
 */
export function createScenarioWorld(options: ScenarioWorldOptions = {}): TestWorld {
  const log = logger.fn('createScenarioWorld', { today: options.today, allRivals: options.allRivals });
  const catalog = buildScenarioCatalog({ allRivals: options.allRivals === true });
  return log.exit(createTestWorld({ ...(options.today === undefined ? {} : { today: options.today }), catalog }));
}

/** SpotVisited の購読ハンドラ一式（docs/08 §4.2） */
export interface VisitHandlers {
  readonly evaluate: EvaluateDistrictChangeUseCase;
  readonly award: AwardVisitRewardsUseCase;
  readonly lords: UpdateDistrictLordUseCase;
}

/** デモユースケース一式 */
export interface DemoUseCases {
  readonly advanceDate: AdvanceDateUseCase;
  readonly simulateRival: SimulateRivalUseCase;
  readonly switchTraveler: SwitchTravelerUseCase;
  readonly resetPosition: ResetPositionUseCase;
  readonly moveTo: MoveDemoPositionUseCase;
}

/**
 * シードの操作ID と重ならないテスト用の操作ID を返す。
 * @param n 番号（0 以上の整数）
 * @returns testOperationId(SCENARIO_OPERATION_BASE + n)
 */
export function scenarioOperationId(n: number): OperationId {
  return testOperationId(SCENARIO_OPERATION_BASE + n);
}

/**
 * TestWorld の偽物を使って SpotVisited のハンドラ一式を作る（購読はしない）。
 * @param tw テスト用の世界
 * @returns ハンドラ一式
 */
export function createVisitHandlers(tw: TestWorld): VisitHandlers {
  const log = logger.fn('createVisitHandlers');
  const handlers: VisitHandlers = {
    evaluate: new EvaluateDistrictChangeUseCase(tw),
    award: new AwardVisitRewardsUseCase(tw),
    lords: new UpdateDistrictLordUseCase(tw),
  };
  return log.exit(handlers);
}

/**
 * ハンドラ一式を作り、container と同じ順（地区の変化 → 報酬 → 主）で SpotVisited に購読させる。
 * ハンドラが失敗を返したら例外にする（RecordingEventBus が投げ直すのでテストが気づける）。
 * @param tw テスト用の世界
 * @returns ハンドラ一式
 * @sideEffect tw.events に購読を3件登録する
 */
export function wireVisitHandlers(tw: TestWorld): VisitHandlers {
  const log = logger.fn('wireVisitHandlers');
  const handlers = createVisitHandlers(tw);
  tw.events.subscribe('SpotVisited', async (event) => {
    must(await handlers.evaluate.handle(event));
  });
  tw.events.subscribe('SpotVisited', async (event) => {
    must(await handlers.award.handle(event));
  });
  tw.events.subscribe('SpotVisited', async (event) => {
    must(await handlers.lords.handle(event));
  });
  return log.exit(handlers);
}

/**
 * デモユースケース一式を作る（主の再判定は lords、省略時は新しく作る）。
 * @param tw テスト用の世界
 * @param options enabled（デモ操作を許可するか）・lords（共有する主の再判定）
 * @returns デモユースケース一式
 */
export function createDemoUseCases(tw: TestWorld, options: { readonly enabled: boolean; readonly lords?: UpdateDistrictLordUseCase }): DemoUseCases {
  const log = logger.fn('createDemoUseCases', { enabled: options.enabled });
  const updateLords = options.lords ?? new UpdateDistrictLordUseCase(tw);
  const common = { enabled: options.enabled, demoControl: tw.demo };
  const useCases: DemoUseCases = {
    advanceDate: new AdvanceDateUseCase({ ...common, clock: tw.clock, updateLords }),
    simulateRival: new SimulateRivalUseCase({ ...tw, ...common, updateLords }),
    switchTraveler: new SwitchTravelerUseCase({ ...tw, ...common }),
    resetPosition: new ResetPositionUseCase({ ...common, spots: tw.spots }),
    moveTo: new MoveDemoPositionUseCase({ ...common, spots: tw.spots }),
  };
  return log.exit(useCases);
}

/**
 * VisitSpotUseCase と同じ手順で訪問を保存し、SpotVisited を作る（発行はしない。ハンドラを直接呼ぶテスト用）。
 * 距離 0m・精度 5m・今日・時計の現在時刻で Traveler.visit → 保存。
 * @param tw テスト用の世界（セッションに旅人がいること）
 * @param spotId スポットID の文字列
 * @param operationId 操作ID
 * @returns SpotVisited（未発行）
 * @throws Error 旅人がいない・訪問できない・処理済みの操作・保存できない（テストのバグ）
 * @sideEffect TravelerRepository.save
 */
export async function saveVisit(tw: TestWorld, spotId: string, operationId: OperationId): Promise<SpotVisited> {
  const log = logger.fn('saveVisit', { spotId, operationId });
  const traveler = must(await loadActiveTraveler(tw));
  const spot = spotOf(tw.spots, spotId);
  const outcome = must(traveler.visit({ spot, meters: 0, accuracyM: TEST_ACCURACY_M, at: tw.clock.now(), localDate: tw.clock.today(), operationId }));
  invariant(!outcome.duplicate, `訪問 ${spotId} の操作ID が処理済みです（シードと重なっていないか確認）`);
  const saved = must(await tw.travelers.save(outcome.traveler, traveler.version));
  const event = tw.eventFactory.create(saved.id, { type: 'SpotVisited', spotId: spot.id, districtId: spot.districtId, localDate: outcome.record.localDate, operationId });
  return log.exit(event);
}

/**
 * VisitSpotUseCase と同じく訪問を保存して SpotVisited を発行する（購読ハンドラが走る）。
 * @param tw テスト用の世界（セッションに旅人がいること）
 * @param spotId スポットID の文字列
 * @param operationId 操作ID
 * @returns 発行した SpotVisited
 * @throws Error saveVisit の失敗・ハンドラの失敗（テストのバグ）
 * @sideEffect TravelerRepository.save・EventBus.publish
 */
export async function recordVisit(tw: TestWorld, spotId: string, operationId: OperationId): Promise<SpotVisited> {
  const log = logger.fn('recordVisit', { spotId, operationId });
  const event = await saveVisit(tw, spotId, operationId);
  await tw.events.publish([event]);
  return log.exit(event);
}

/**
 * いまの旅人の世界から再訪理由を計算する（GetRevisitReasonsUseCase と同じ入力で RevisitReasonPolicy.collect を呼ぶ）。
 * @param tw テスト用の世界
 * @returns 再訪理由（優先順）
 * @throws Error 世界を読めない（テストのバグ）
 */
export async function reasonsOf(tw: TestWorld): Promise<RevisitReason[]> {
  const log = logger.fn('reasonsOf');
  const world = must(await loadWorld(tw));
  const reasons = collect({
    today: world.today,
    spots: tw.spots.allSpots(),
    districts: tw.spots.allDistricts(),
    shopEvents: tw.spots.allShopEvents(),
    visits: world.traveler.visits,
    discoveredSpotIds: discoveredSpotIdsOf(world.traveler),
    lordships: lordshipSnapshotsOf(world),
  });
  return log.exit(reasons);
}
