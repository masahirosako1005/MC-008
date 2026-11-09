/**
 * @file デモの旅人（初回の人・通い慣れた人）の初期データを組み立てる（application 層・保存はしない）
 * docs/08 §4.5 の役割を §9.3 の新しい ID（大阪・南森町周辺）に置いた訪問を、今日（T）基準で Traveler.create → discover / visit により時系列に作る（restore は使わない）。
 * 台帳も同じ順に VisitRewardPolicy で計算して追記する（おかえりボーナスがあれば込み）。
 * 配置は scripts/master/masterDomain.test.mjs の SEED_VISITS と同じ（変えたら両方を直す）。
 * 操作ID は DEMO_SEED_OPERATION_ID_PREFIX ＋ 12 桁 16 進の連番（時系列順に 1 から）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseOperationId, parseSpotId, parseTravelerId } from '@/Common/types/Id';
import type { OperationId, TravelerId } from '@/Common/types/Id';
import { addDays, compareInstant, jstInstantOf } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import { visitLedgerEntriesOf } from '@/application/usecases/reward/visitLedgerEntries';
import {
  DEMO_FIRST_NICKNAME, DEMO_FIRST_TRAVELER_ID_TEXT, DEMO_POSITION_ACCURACY_M, DEMO_REGULAR_NICKNAME, DEMO_REGULAR_TRAVELER_ID_TEXT,
  DEMO_SEED_DISCOVERY_HOUR, DEMO_SEED_FIRST_VISIT_HOUR, DEMO_SEED_OPERATION_ID_DIGITS, DEMO_SEED_OPERATION_ID_PREFIX, DEMO_SEED_VISIT_METERS,
} from '@/application/usecases/demo/constants';
import { Traveler } from '@/domain/exploration/Traveler';
import type { LedgerEntry } from '@/domain/reward/LedgerEntry';
import { PointLedger } from '@/domain/reward/PointLedger';
import { rewardFor } from '@/domain/reward/VisitRewardPolicy';
import type { Spot } from '@/domain/spot/Spot';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/demo/demoSeeds');

/** デモの旅人のプロフィール（初回の人／通い慣れた人） */
export type DemoProfile = 'first' | 'regular';

/** デモの旅人のプロフィール一覧 */
export const DEMO_PROFILES: readonly DemoProfile[] = ['first', 'regular'];

/**
 * 「通い慣れた人」の訪問（docs/08 §9.3。役割・日付・回数は §4.5 と同じで ID だけ新しい）。[スポットID, 今日からの日数]。
 * 南森町・天満宮 6回（T−20〜T−5。旧 城下）／天満 7スポット計9回（T−28〜T−2。旧 本町）／大川 15回（T−70〜T−25。旧 みなと）／
 * 天六なし（旧 里山）／扇町・中崎町 15回（T−95〜T−45。旧 湯の里）。
 * 2026-11-09 ユーザー指示「名所店舗は初期データとしてある程度獲得している状況に」で図鑑の獲得を増やした（訪問済み 36／80 枚）:
 * - 大川・扇町は、直近30日より古い（主の集計に入らない）・最終訪問日より古い（色あせは変わらない）訪問を末尾に足した
 * - 天満は回数・日付はそのまま、T−12・T−9 の再訪を別のスポット（l_tm03・s_tm04）に振り替えた（金カード手前の9回は変えない）
 * - 南森町（手順3で Lv3 に育つ score 9）と天六（未訪問の地区）は変えない
 * 足すときは末尾に足す（scripts の SEED_VISITS は添字で天満の訪問を引くため）。
 */
export const REGULAR_SEED_VISITS: readonly (readonly [spotId: string, dayOffset: number])[] = Object.freeze([
  ['l_mm01', -20], ['l_mm01', -12], ['l_mm01', -5], ['s_mm01', -12], ['s_mm01', -5], ['s_mm03', -5],
  ['l_tm01', -28], ['l_tm02', -26], ['s_tm01', -22], ['s_tm02', -18], ['s_tm03', -15], ['l_tm03', -12], ['s_tm04', -9], ['s_tm01', -5], ['s_tm02', -2],
  ['l_ok01', -25], ['l_ok02', -25],
  ['l_og01', -60], ['l_og01', -45], ['l_og02', -45], ['s_og01', -45],
  ['l_ok03', -40], ['s_ok01', -40], ['s_ok05', -55], ['s_ok07', -55],
  ['l_og03', -75], ['s_og03', -75], ['s_og04', -85], ['s_og07', -85],
  ['s_ok02', -35], ['s_ok06', -35], ['s_ok08', -48], ['s_ok09', -48], ['s_ok10', -62], ['s_ok11', -62], ['s_ok12', -70], ['s_ok01', -70], ['l_ok01', -70],
  ['s_og02', -50], ['s_og05', -50], ['s_og08', -68], ['s_og09', -68], ['s_og11', -95], ['s_og12', -95], ['l_og01', -95],
] as const);

/**
 * 「通い慣れた人」が発見だけしているスポット。
 * 南森町・天満宮地区: 天満天神繁昌亭・s_mm02（クーポン c_mm01）・s_mm04（docs/08 §9.3）。
 * 天満・大川の分は 2026-11-09 に足した（図鑑に「行けば色づく」シルエットを増やす。近い期限のクーポンがある店は避けた）。
 * 南森町は手順2（入口から歩いて未発見を発見）のため、天六は「未訪問の地区」のため足さない。
 */
export const REGULAR_SEED_DISCOVERED_ONLY: readonly string[] = Object.freeze([
  'l_mm02', 's_mm02', 's_mm04',
  's_tm05', 's_tm06', 's_tm07', 's_tm08', 's_tm09', 's_tm10', 's_tm11', 's_tm13', 's_tm14',
  's_ok13',
]);

/** 発見だけのスポットを発見した日（今日からの日数。開始地区に初めて来た日） */
export const REGULAR_SEED_DISCOVERY_DAY = -20;

/** シードを作る入力 */
export interface DemoSeedInput {
  /** 今日（T）。訪問日はここからのずれで決まる */
  readonly today: LocalDate;
  /** マスタ参照（シードのスポットを引く） */
  readonly spots: SpotRepository;
}

/** シード（保存前の旅人と台帳。どちらも版数 0） */
export interface DemoSeed {
  readonly traveler: Traveler;
  readonly ledger: PointLedger;
}

/** シードの1手順（訪問、または発見だけ） */
type SeedStep =
  | { readonly kind: 'visit'; readonly spot: Spot; readonly localDate: LocalDate; readonly at: Instant; readonly operationId: OperationId }
  | { readonly kind: 'discover'; readonly spots: readonly Spot[]; readonly at: Instant };

/** シードを畳み込む途中の状態 */
interface SeedState {
  readonly traveler: Traveler;
  readonly entries: readonly LedgerEntry[];
}

/**
 * 未検証の値がデモのプロフィールか判定する型ガード。
 * @param value 判定する値
 * @returns 'first' または 'regular' なら true
 */
export function isDemoProfile(value: unknown): value is DemoProfile {
  return value === 'first' || value === 'regular';
}

/**
 * 保存済みの「通い慣れた人」が今のシードより古いか（シードの訪問・発見のスポットのどれかが記録に無い）を判定する。
 * デモビルドの起動時に古ければ作り直すために使う（2026-11-09: シードを増やしても、保存済みのブラウザでは旅人が作り直されず反映されなかったため）。
 * デモ中に訪問を重ねてもシードのスポットの記録は消えないので、シードを変えない限り作り直さない。
 * @param traveler 保存済みの旅人
 * @returns 「通い慣れた人」で、シードのスポットの記録が欠けていれば true（ほかのプロフィールは常に false）
 */
export function isRegularSeedOutdated(traveler: Traveler): boolean {
  const log = logger.fn('isRegularSeedOutdated', { travelerId: traveler.id, profile: traveler.profile });
  if (traveler.profile !== 'regular') return log.exit(false, '通い慣れた人ではない');
  const missingVisit = REGULAR_SEED_VISITS.some(([rawId]) => {
    const id = parseSpotId(rawId);
    return id.ok && !traveler.hasVisited(id.value);
  });
  const missingDiscovery = REGULAR_SEED_DISCOVERED_ONLY.some((rawId) => {
    const id = parseSpotId(rawId);
    return id.ok && !traveler.hasDiscovered(id.value);
  });
  return log.exit(missingVisit || missingDiscovery);
}

/**
 * デモのプロフィールから固定の旅人ID を返す（初回の人 t_demofirst／通い慣れた人 t_demoregular）。
 * @param profile プロフィール
 * @returns 成功: 旅人ID。失敗: INVALID_INPUT（定数が正規表現に合わない＝バグ）
 */
export function demoTravelerIdOf(profile: DemoProfile): Result<TravelerId> {
  const log = logger.fn('demoTravelerIdOf', { profile });
  return log.exit(parseTravelerId(profile === 'regular' ? DEMO_REGULAR_TRAVELER_ID_TEXT : DEMO_FIRST_TRAVELER_ID_TEXT));
}

/**
 * シードの n 番目の訪問の操作ID を返す（DEMO_SEED_OPERATION_ID_PREFIX ＋ 12 桁 16 進）。
 * @param n 連番（1 以上の整数）
 * @returns 成功: 操作ID。失敗: INVALID_INPUT（n が不正で形式を満たさない）
 */
export function demoSeedOperationId(n: number): Result<OperationId> {
  const log = logger.fn('demoSeedOperationId', { n });
  return log.exit(parseOperationId(`${DEMO_SEED_OPERATION_ID_PREFIX}${n.toString(16).padStart(DEMO_SEED_OPERATION_ID_DIGITS, '0')}`));
}

/**
 * シードのスポットをマスタから引く。
 * @param spots マスタ参照
 * @param rawId スポットID の文字列
 * @returns 成功: スポット。失敗: INVALID_INPUT（形式不正）／SPOT_NOT_FOUND（マスタに無い）
 */
function seedSpotOf(spots: SpotRepository, rawId: string): Result<Spot> {
  const log = logger.fn('seedSpotOf', { rawId });
  const id = parseSpotId(rawId);
  if (!id.ok) return log.fail(id);
  const spot = spots.findSpot(id.value);
  if (spot === undefined) return log.fail(fail(AppError.of('SPOT_NOT_FOUND', 'デモの初期データのスポットがマスタにありません', { spotId: id.value })));
  return log.exit(ok(spot));
}

/**
 * 「通い慣れた人」の訪問の手順を時系列に作る（日付順。同じ日は表の順に1時間ずつずらす。操作ID は時系列の連番）。
 * @param input 今日・マスタ参照
 * @returns 成功: 訪問の手順（古い順）。失敗: SPOT_NOT_FOUND／INVALID_INPUT
 */
function regularVisitSteps(input: DemoSeedInput): Result<SeedStep[]> {
  const log = logger.fn('regularVisitSteps', { today: input.today, visits: REGULAR_SEED_VISITS.length });
  const ordered = REGULAR_SEED_VISITS.map(([spotId, offset], index) => ({ spotId, offset, index })).sort((a, b) => a.offset - b.offset || a.index - b.index);
  const perDay = new Map<number, number>();
  const steps: SeedStep[] = [];
  for (const [position, entry] of ordered.entries()) {
    const spot = seedSpotOf(input.spots, entry.spotId);
    if (!spot.ok) return log.fail(spot);
    const operationId = demoSeedOperationId(position + 1);
    if (!operationId.ok) return log.fail(operationId);
    const nthInDay = perDay.get(entry.offset) ?? 0;
    perDay.set(entry.offset, nthInDay + 1);
    const localDate = addDays(input.today, entry.offset);
    steps.push({ kind: 'visit', spot: spot.value, localDate, at: jstInstantOf(localDate, DEMO_SEED_FIRST_VISIT_HOUR + nthInDay), operationId: operationId.value });
  }
  return log.exit(ok(steps));
}

/**
 * 「通い慣れた人」の発見だけの手順を作る（開始地区に初めて来た日の訪問より前）。
 * @param input 今日・マスタ参照
 * @returns 成功: 発見の手順。失敗: SPOT_NOT_FOUND／INVALID_INPUT
 */
function regularDiscoverStep(input: DemoSeedInput): Result<SeedStep> {
  const log = logger.fn('regularDiscoverStep', { today: input.today });
  const spots: Spot[] = [];
  for (const rawId of REGULAR_SEED_DISCOVERED_ONLY) {
    const spot = seedSpotOf(input.spots, rawId);
    if (!spot.ok) return log.fail(spot);
    spots.push(spot.value);
  }
  const at = jstInstantOf(addDays(input.today, REGULAR_SEED_DISCOVERY_DAY), DEMO_SEED_DISCOVERY_HOUR);
  return log.exit(ok({ kind: 'discover', spots, at }));
}

/**
 * シードの1手順を旅人と台帳の行に反映する（訪問は距離 0・デモ位置の精度で行い、加点を VisitRewardPolicy で計算する）。
 * @param state ここまでの旅人と台帳の行
 * @param step 手順
 * @returns 成功: 次の状態。失敗: Traveler.visit の失敗（OUT_OF_RANGE / ALREADY_VISITED_TODAY / LOW_ACCURACY＝シードの誤り）／INVALID_INPUT
 */
function applySeedStep(state: SeedState, step: SeedStep): Result<SeedState> {
  const log = logger.fn('applySeedStep', { kind: step.kind });
  if (step.kind === 'discover') return log.exit(ok({ traveler: state.traveler.discover(step.spots, step.at).traveler, entries: state.entries }));
  const { spot, localDate, at, operationId } = step;
  const visited = state.traveler.visit({ spot, meters: DEMO_SEED_VISIT_METERS, accuracyM: DEMO_POSITION_ACCURACY_M, at, localDate, operationId });
  if (!visited.ok) return log.fail(visited);
  const reward = rewardFor({ spot, visitsBefore: state.traveler.visits, today: localDate });
  const entries = visitLedgerEntriesOf(visited.value.record, reward);
  if (!entries.ok) return log.fail(entries);
  return log.exit(ok({ traveler: visited.value.traveler, entries: [...state.entries, ...entries.value] }));
}

/**
 * 「初回の人」のシードを作る（記録なし・台帳は空）。
 * @param input 今日・マスタ参照（使わないが buildRegularSeed とそろえる）
 * @returns 成功: シード。失敗: INVALID_INPUT（定数の旅人ID が不正＝バグ）
 */
export function buildFirstSeed(input: DemoSeedInput): Result<DemoSeed> {
  const log = logger.fn('buildFirstSeed', { today: input.today });
  const id = demoTravelerIdOf('first');
  if (!id.ok) return log.fail(id);
  return log.exit(ok(Object.freeze({ traveler: Traveler.create(id.value, DEMO_FIRST_NICKNAME, 'first'), ledger: PointLedger.empty(id.value) })));
}

/**
 * 「通い慣れた人」のシードを作る（docs/08 §4.5 の役割を §9.3 の ID で。訪問と発見を時系列に積み、台帳も同じ順に追記する）。
 * @param input 今日（T）・マスタ参照
 * @returns 成功: シード。失敗: SPOT_NOT_FOUND（マスタにシードのスポットが無い）／INVALID_INPUT／Traveler.visit の失敗
 * @see docs/08 §4.5, §9.3, D6, D14
 */
export function buildRegularSeed(input: DemoSeedInput): Result<DemoSeed> {
  const log = logger.fn('buildRegularSeed', { today: input.today });
  const id = demoTravelerIdOf('regular');
  if (!id.ok) return log.fail(id);
  const visits = regularVisitSteps(input);
  if (!visits.ok) return log.fail(visits);
  const discovery = regularDiscoverStep(input);
  if (!discovery.ok) return log.fail(discovery);
  const timeline = [discovery.value, ...visits.value].sort((a, b) => compareInstant(a.at, b.at));
  let state: SeedState = { traveler: Traveler.create(id.value, DEMO_REGULAR_NICKNAME, 'regular'), entries: [] };
  for (const step of timeline) {
    const next = applySeedStep(state, step);
    if (!next.ok) return log.fail(next);
    state = next.value;
  }
  const ledger = PointLedger.empty(id.value).append(state.entries);
  if (!ledger.ok) return log.fail(ledger);
  log.debug('シード作成', { visits: state.traveler.visits.length, balance: ledger.value.balance() });
  return log.exit(ok(Object.freeze({ traveler: state.traveler, ledger: ledger.value })));
}

/**
 * プロフィールに応じたシードを作る。
 * @param profile プロフィール
 * @param input 今日・マスタ参照
 * @returns 成功: シード。失敗: buildFirstSeed / buildRegularSeed の失敗
 */
export function buildDemoSeed(profile: DemoProfile, input: DemoSeedInput): Result<DemoSeed> {
  const log = logger.fn('buildDemoSeed', { profile });
  return log.exit(profile === 'regular' ? buildRegularSeed(input) : buildFirstSeed(input));
}
