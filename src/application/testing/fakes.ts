/**
 * @file application のテスト専用の偽物（時計・位置・リポジトリ・イベントバス・ID・デモ操作）と組み立てヘルパ（application 層・テスト専用）
 * 本番コードから import しない（container は infrastructure の実装を使う）。モックライブラリに頼らず、本物と同じ契約で振る舞う（docs/03 §9）。
 * - リポジトリは version による楽観ロックで CONFLICT を返す（DI-10）。保存形（toState）で持ち、読むたびに restore で検証する（DI-01）
 * - failures.failNext(...) で次の1回だけ失敗させられる（DI-12 の途中失敗テスト用）
 * - createTestWorld() で WorldDeps を満たす一式を作り、seedTraveler / seedLordship で前提を置く
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseOperationId, parseTravelerId } from '@/Common/types/Id';
import type { DistrictId, EventId, OperationId, TravelerId } from '@/Common/types/Id';
import { invariant } from '@/Common/utils/assert';
import { addDays, jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import type { DomainEventHandler, EventBus } from '@/application/events/EventBus';
import { EventFactory } from '@/application/events/EventFactory';
import type { DemoControl } from '@/application/ports/DemoControl';
import type { SessionRepository, SessionState } from '@/application/ports/SessionRepository';
import type { WorldDeps } from '@/application/usecases/shared/World';
import { buildTestCatalog, districtOf, must, spotOf, testDate, testRivalId, TEST_ORIGIN } from '@/application/testing/testCatalog';
import type { TestCatalog, TestRivalRepository, TestSpotRepository } from '@/application/testing/testCatalog';
import { rivalHolder, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';
import { LordshipBoard } from '@/domain/competition/LordshipBoard';
import type { LordshipRepository, LordshipSaveErrorCode } from '@/domain/competition/LordshipRepository';
import type { RivalActionVisit } from '@/domain/competition/Rival';
import type { RivalActionRepository } from '@/domain/competition/RivalRepository';
import type { DomainEvent, DomainEventType, EventOfType } from '@/domain/events/DomainEvent';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';
import { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerProfile } from '@/domain/exploration/Traveler';
import type { TravelerRepository, TravelerSaveErrorCode } from '@/domain/exploration/TravelerRepository';
import type { Clock } from '@/domain/ports/Clock';
import type { GeoErrorCode, GeoFix, GeoProvider } from '@/domain/ports/GeoProvider';
import type { IdGenerator } from '@/domain/ports/IdGenerator';
import { PointLedger } from '@/domain/reward/PointLedger';
import type { PointLedgerRepository, PointLedgerSaveErrorCode } from '@/domain/reward/PointLedgerRepository';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

export {
  buildCatalog, buildSampleBackdrop, buildTestCatalog, districtOf, must, offsetPoint, spotOf, testDate, testDistrictId, testRivalId, testSpotId,
  TestRivalRepository, TestSpotRepository, TEST_ORIGIN,
} from '@/application/testing/testCatalog';
export type {
  CatalogDefs, DistrictDef, RivalDef, ShopEventDef, SpotDef, TestCatalog, TestCatalogOptions, TestSpotData,
} from '@/application/testing/testCatalog';

const logger = createLogger('application/testing/fakes');

/** テストの既定の「今日」 */
export const TEST_TODAY_TEXT = '2026-11-09';

/** テストの既定の「今日」（LocalDate） */
export const TEST_TODAY: LocalDate = testDate(TEST_TODAY_TEXT);

/** テストの既定の旅人ID */
export const TEST_TRAVELER_ID: TravelerId = must(parseTravelerId('t_test01'));

/** テストの既定の測位精度（m） */
export const TEST_ACCURACY_M = 5;

/**
 * 番号からテスト用の操作ID（UUID 形）を作る。番号が同じなら同じ ID（冪等テスト用）。
 * @param n 番号（0 以上の整数）
 * @returns '00000000-0000-4000-8000-' + 12桁の番号
 */
export function testOperationId(n: number): OperationId {
  return must(parseOperationId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`));
}

/**
 * シード用の操作ID（testOperationId と重ならない名前空間 5eed…）を作る。
 * @param n 番号
 * @returns '5eed0000-0000-4000-8000-' + 12桁の番号
 */
function seedOperationId(n: number): OperationId {
  return must(parseOperationId(`5eed0000-0000-4000-8000-${String(n).padStart(12, '0')}`));
}

/**
 * 文字列または LocalDate を LocalDate にする。
 * @param date 'YYYY-MM-DD' または LocalDate
 * @returns LocalDate
 */
function toLocalDate(date: LocalDate | string): LocalDate {
  return must(parseLocalDate(date));
}

// ---------------------------------------------------------------------------
// 失敗の注入
// ---------------------------------------------------------------------------

/** 偽物で注入できる失敗コード */
export type InjectedErrorCode = 'STORAGE_FAILED' | 'CONFLICT';

/** 次の1回だけ失敗させる予約（操作名ごと） */
export class FailurePlan<Op extends string> {
  private readonly pending = new Map<Op, AppError<InjectedErrorCode>>();

  /**
   * 次の1回の操作を失敗させる予約をする。
   * @param op 操作名（例: 'save'）
   * @param code 失敗コード（既定 STORAGE_FAILED）
   * @sideEffect 予約を記録する
   */
  failNext(op: Op, code: InjectedErrorCode = 'STORAGE_FAILED'): void {
    const log = logger.fn('FailurePlan.failNext', { op, code });
    this.pending.set(op, AppError.of(code, code === 'CONFLICT' ? 'ほかの操作と競合しました（テスト）' : '保存に失敗しました（テスト）'));
    log.exit(undefined);
  }

  /**
   * 予約があれば取り出す（取り出した予約は消える）。
   * @param op 操作名
   * @returns 予約された失敗。無ければ undefined
   * @sideEffect 予約を消す
   */
  take(op: Op): AppError<InjectedErrorCode> | undefined {
    const log = logger.fn('FailurePlan.take', { op });
    const error = this.pending.get(op);
    this.pending.delete(op);
    return log.exit(error);
  }
}

/**
 * 楽観ロックの競合を表す失敗値を作る（DI-10）。
 * @param expected 呼び出し側が期待した版数
 * @param actual 保存済みの版数
 * @returns CONFLICT の失敗 Result
 */
function conflict(expected: number, actual: number): Result<never, AppError<'CONFLICT'>> {
  return fail(AppError.of('CONFLICT', 'ほかの操作と競合しました。もう一度お試しください', { expected, actual }));
}

/**
 * 保存データを復元できなかったときの失敗値を作る。
 * @param kind 集約の名前
 * @returns STORAGE_FAILED の失敗 Result
 */
function corrupted(kind: string): Result<never, AppError<'STORAGE_FAILED'>> {
  return fail(AppError.of('STORAGE_FAILED', '保存データを読み込めませんでした', { kind }));
}

// ---------------------------------------------------------------------------
// 時計・位置・ID
// ---------------------------------------------------------------------------

/** 固定の時計（today は setToday / advanceDays で動かす。now は today の JST 時刻） */
export class FixedClock implements Clock {
  private date: LocalDate;

  /**
   * 時計を作る。
   * @param today 今日（既定 TEST_TODAY_TEXT）
   * @param time JST の時刻（既定 10:00）
   */
  constructor(today: LocalDate | string = TEST_TODAY_TEXT, private time: { readonly hour: number; readonly minute: number } = { hour: 10, minute: 0 }) {
    this.date = toLocalDate(today);
  }

  /**
   * 現在の瞬間（今日の JST 時刻）を返す。
   * @returns Instant
   */
  now(): Instant {
    return jstInstantOf(this.date, this.time.hour, this.time.minute);
  }

  /**
   * 今日（JST 暦日）を返す。
   * @returns LocalDate
   */
  today(): LocalDate {
    return this.date;
  }

  /**
   * 今日を設定する。
   * @param date 'YYYY-MM-DD' または LocalDate
   * @sideEffect 時計の日付を変える
   */
  setToday(date: LocalDate | string): void {
    this.date = toLocalDate(date);
  }

  /**
   * 今日を days 日進める（負なら戻す）。
   * @param days 日数
   * @sideEffect 時計の日付を変える
   */
  advanceDays(days: number): void {
    this.date = addDays(this.date, days);
  }

  /**
   * 時刻（JST）を設定する。
   * @param hour 時（0〜23）
   * @param minute 分（0〜59）
   * @sideEffect 時計の時刻を変える
   */
  setTime(hour: number, minute = 0): void {
    this.time = { hour, minute };
  }
}

/** 偽の位置（setPoint / setAccuracy / setError で操作する） */
export class FakeGeoProvider implements GeoProvider {
  private point: GeoPoint;
  private accuracyM: number;
  private error: GeoErrorCode | undefined;
  private calls = 0;

  /**
   * 偽の位置を作る。
   * @param deps 時計（測位時刻 at に使う）・初期位置（既定 TEST_ORIGIN）・精度（既定 5m）
   */
  constructor(private readonly deps: { readonly clock: Clock; readonly point?: GeoPoint; readonly accuracyM?: number }) {
    this.point = deps.point ?? TEST_ORIGIN;
    this.accuracyM = deps.accuracyM ?? TEST_ACCURACY_M;
  }

  /**
   * 現在地を返す。setError 中はその失敗を返す。
   * @returns 成功: GeoFix。失敗: GEO_UNAVAILABLE / GEO_DENIED
   * @sideEffect 呼び出し回数を数える
   */
  async current(): Promise<Result<GeoFix, AppError<GeoErrorCode>>> {
    const log = logger.fn('FakeGeoProvider.current', { accuracyM: this.accuracyM, error: this.error });
    this.calls += 1;
    if (this.error !== undefined) return log.fail(fail(AppError.of(this.error, '現在地を取得できませんでした（テスト）')));
    return log.exit(ok(Object.freeze({ point: this.point, accuracyM: this.accuracyM, at: this.deps.clock.now() })));
  }

  /**
   * 現在地を設定する。
   * @param point 位置
   * @sideEffect 位置を変える
   */
  setPoint(point: GeoPoint): void {
    this.point = point;
  }

  /**
   * 測位精度を設定する。
   * @param accuracyM 精度（m）
   * @sideEffect 精度を変える
   */
  setAccuracy(accuracyM: number): void {
    this.accuracyM = accuracyM;
  }

  /**
   * 失敗を設定する（undefined で解除）。
   * @param code 失敗コード
   * @sideEffect 以後の current が失敗する
   */
  setError(code: GeoErrorCode | undefined): void {
    this.error = code;
  }

  /** いまの位置 */
  get currentPoint(): GeoPoint {
    return this.point;
  }

  /** current が呼ばれた回数 */
  get callCount(): number {
    return this.calls;
  }
}

/** 連番の ID 発行（'ev' → 'ev_000001'、't' → 't_000002' …。接頭辞をまたいで通し番号） */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  /**
   * 接頭辞つきの連番 ID を返す。
   * @param prefix 接頭辞（英小文字）
   * @returns prefix + '_' + 6桁の連番
   * @sideEffect 連番を1進める
   */
  newId(prefix: string): string {
    const log = logger.fn('SequentialIdGenerator.newId', { prefix });
    this.counter += 1;
    return log.exit(`${prefix}_${String(this.counter).padStart(6, '0')}`);
  }

  /** これまでに発行した数 */
  get count(): number {
    return this.counter;
  }
}

// ---------------------------------------------------------------------------
// リポジトリ
// ---------------------------------------------------------------------------

/** 旅人のメモリ上のリポジトリ（version 楽観ロック＝DI-10） */
export class InMemoryTravelerRepository implements TravelerRepository {
  private readonly states = new Map<TravelerId, unknown>();
  /** 次の1回を失敗させる予約 */
  readonly failures = new FailurePlan<'findById' | 'save' | 'delete'>();
  /** save が成功した回数 */
  saveCount = 0;

  /**
   * ID で旅人を読む（保存形を Traveler.restore で検証して返す）。
   * @param id 旅人ID
   * @returns 成功: 旅人（未保存なら undefined）。失敗: STORAGE_FAILED
   */
  async findById(id: TravelerId): Promise<Result<Traveler | undefined>> {
    const log = logger.fn('InMemoryTravelerRepository.findById', { id });
    const injected = this.failures.take('findById');
    if (injected !== undefined) return log.fail(fail(injected));
    const state = this.states.get(id);
    if (state === undefined) return log.exit(ok(undefined));
    const restored = Traveler.restore(state);
    return restored.ok ? log.exit(ok(restored.value)) : log.fail(corrupted('Traveler'));
  }

  /**
   * 旅人を保存する。保存済み version（未保存は 0）と expectedVersion が違えば CONFLICT。
   * @param traveler 旅人
   * @param expectedVersion 読んだときの版数
   * @returns 成功: version+1 の旅人。失敗: CONFLICT / STORAGE_FAILED
   * @sideEffect メモリに保存形を置く
   */
  async save(traveler: Traveler, expectedVersion: number): Promise<Result<Traveler, AppError<TravelerSaveErrorCode>>> {
    const log = logger.fn('InMemoryTravelerRepository.save', { id: traveler.id, expectedVersion });
    const injected = this.failures.take('save');
    if (injected !== undefined) return log.fail(fail(injected));
    const current = this.versionOf(traveler.id);
    if (current !== expectedVersion) return log.fail(conflict(expectedVersion, current));
    const saved = traveler.withVersion(expectedVersion + 1);
    this.states.set(traveler.id, saved.toState());
    this.saveCount += 1;
    return log.exit(ok(saved));
  }

  /**
   * 旅人を削除する。
   * @param id 旅人ID
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect メモリから消す
   */
  async delete(id: TravelerId): Promise<Result<void>> {
    const log = logger.fn('InMemoryTravelerRepository.delete', { id });
    const injected = this.failures.take('delete');
    if (injected !== undefined) return log.fail(fail(injected));
    this.states.delete(id);
    return log.exit(okVoid());
  }

  /**
   * 保存済みの版数を返す（未保存は 0）。
   * @param id 旅人ID
   * @returns 版数
   */
  versionOf(id: TravelerId): number {
    const log = logger.fn('InMemoryTravelerRepository.versionOf', { id });
    const state = this.states.get(id);
    const restored = state === undefined ? undefined : Traveler.restore(state);
    return log.exit(restored?.ok === true ? restored.value.version : 0);
  }

  /**
   * 保存データを直接置く（版数を確認しない。壊れたデータの読込テストにも使える）。
   * @param id 旅人ID
   * @param state 保存形（Traveler.toState() または任意の値）
   * @sideEffect メモリに置く
   */
  putRaw(id: TravelerId, state: unknown): void {
    this.states.set(id, state);
  }

  /** 保存されている旅人の数 */
  get size(): number {
    return this.states.size;
  }
}

/** ポイント台帳のメモリ上のリポジトリ（version 楽観ロック＝DI-10。未保存は PointLedger.empty） */
export class InMemoryPointLedgerRepository implements PointLedgerRepository {
  private readonly states = new Map<TravelerId, unknown>();
  /** 次の1回を失敗させる予約 */
  readonly failures = new FailurePlan<'find' | 'save' | 'delete'>();
  /** save が成功した回数 */
  saveCount = 0;

  /**
   * 旅人の台帳を読む。
   * @param travelerId 旅人ID
   * @returns 成功: 台帳（未保存なら PointLedger.empty）。失敗: STORAGE_FAILED
   */
  async find(travelerId: TravelerId): Promise<Result<PointLedger>> {
    const log = logger.fn('InMemoryPointLedgerRepository.find', { travelerId });
    const injected = this.failures.take('find');
    if (injected !== undefined) return log.fail(fail(injected));
    const state = this.states.get(travelerId);
    if (state === undefined) return log.exit(ok(PointLedger.empty(travelerId)));
    const restored = PointLedger.restore(state);
    return restored.ok ? log.exit(ok(restored.value)) : log.fail(corrupted('PointLedger'));
  }

  /**
   * 台帳を保存する。保存済み version（未保存は 0）と expectedVersion が違えば CONFLICT。
   * @param ledger 台帳
   * @param expectedVersion 読んだときの版数
   * @returns 成功: version+1 の台帳。失敗: CONFLICT / STORAGE_FAILED
   * @sideEffect メモリに保存形を置く
   */
  async save(ledger: PointLedger, expectedVersion: number): Promise<Result<PointLedger, AppError<PointLedgerSaveErrorCode>>> {
    const log = logger.fn('InMemoryPointLedgerRepository.save', { travelerId: ledger.travelerId, expectedVersion });
    const injected = this.failures.take('save');
    if (injected !== undefined) return log.fail(fail(injected));
    const current = await this.find(ledger.travelerId);
    const currentVersion = current.ok ? current.value.version : 0;
    if (currentVersion !== expectedVersion) return log.fail(conflict(expectedVersion, currentVersion));
    const saved = ledger.withVersion(expectedVersion + 1);
    this.states.set(ledger.travelerId, saved.toState());
    this.saveCount += 1;
    return log.exit(ok(saved));
  }

  /**
   * 台帳を削除する。
   * @param travelerId 旅人ID
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect メモリから消す
   */
  async delete(travelerId: TravelerId): Promise<Result<void>> {
    const log = logger.fn('InMemoryPointLedgerRepository.delete', { travelerId });
    const injected = this.failures.take('delete');
    if (injected !== undefined) return log.fail(fail(injected));
    this.states.delete(travelerId);
    return log.exit(okVoid());
  }

  /**
   * 保存データを直接置く（版数を確認しない）。
   * @param travelerId 旅人ID
   * @param state 保存形（PointLedger.toState() または任意の値）
   * @sideEffect メモリに置く
   */
  putRaw(travelerId: TravelerId, state: unknown): void {
    this.states.set(travelerId, state);
  }
}

/** 地区の主の盤のメモリ上のリポジトリ（version 楽観ロック＝DI-10。未保存は LordshipBoard.empty） */
export class InMemoryLordshipRepository implements LordshipRepository {
  private readonly states = new Map<TravelerId, unknown>();
  /** 次の1回を失敗させる予約 */
  readonly failures = new FailurePlan<'find' | 'save' | 'delete'>();
  /** save が成功した回数 */
  saveCount = 0;

  /**
   * 旅人の盤を読む。
   * @param travelerId 旅人ID
   * @returns 成功: 盤（未保存なら LordshipBoard.empty(travelerId)）。失敗: STORAGE_FAILED
   */
  async find(travelerId: TravelerId): Promise<Result<LordshipBoard>> {
    const log = logger.fn('InMemoryLordshipRepository.find', { travelerId });
    const injected = this.failures.take('find');
    if (injected !== undefined) return log.fail(fail(injected));
    const state = this.states.get(travelerId);
    if (state === undefined) return log.exit(ok(LordshipBoard.empty(travelerId)));
    const restored = LordshipBoard.restore(state);
    return restored.ok ? log.exit(ok(restored.value)) : log.fail(corrupted('LordshipBoard'));
  }

  /**
   * 盤を保存する。保存済み version（未保存は 0）と expectedVersion が違えば CONFLICT。
   * @param board 盤
   * @param expectedVersion 読んだときの版数
   * @returns 成功: version+1 の盤。失敗: CONFLICT / STORAGE_FAILED
   * @sideEffect メモリに保存形を置く
   */
  async save(board: LordshipBoard, expectedVersion: number): Promise<Result<LordshipBoard, AppError<LordshipSaveErrorCode>>> {
    const log = logger.fn('InMemoryLordshipRepository.save', { travelerId: board.travelerId, expectedVersion });
    const injected = this.failures.take('save');
    if (injected !== undefined) return log.fail(fail(injected));
    const current = await this.find(board.travelerId);
    const currentVersion = current.ok ? current.value.version : 0;
    if (currentVersion !== expectedVersion) return log.fail(conflict(expectedVersion, currentVersion));
    const saved = board.withVersion(expectedVersion + 1);
    this.states.set(board.travelerId, saved.toState());
    this.saveCount += 1;
    return log.exit(ok(saved));
  }

  /**
   * 盤を削除する。
   * @param travelerId 旅人ID
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect メモリから消す
   */
  async delete(travelerId: TravelerId): Promise<Result<void>> {
    const log = logger.fn('InMemoryLordshipRepository.delete', { travelerId });
    const injected = this.failures.take('delete');
    if (injected !== undefined) return log.fail(fail(injected));
    this.states.delete(travelerId);
    return log.exit(okVoid());
  }

  /**
   * 保存データを直接置く（版数を確認しない）。
   * @param travelerId 旅人ID
   * @param state 保存形（LordshipBoard.toState() または任意の値）
   * @sideEffect メモリに置く
   */
  putRaw(travelerId: TravelerId, state: unknown): void {
    this.states.set(travelerId, state);
  }
}

/** ライバル行動のメモリ上のリポジトリ（追記専用。operationId が同じ行動は二重に追記しない＝DI-07） */
export class InMemoryRivalActionRepository implements RivalActionRepository {
  private readonly byTraveler = new Map<TravelerId, readonly RivalActionVisit[]>();
  /** 次の1回を失敗させる予約 */
  readonly failures = new FailurePlan<'list' | 'append' | 'clear'>();

  /**
   * 旅人の世界のライバル行動を古い順に返す。
   * @param travelerId 旅人ID
   * @returns 成功: ライバル行動（未保存なら空）。失敗: STORAGE_FAILED
   */
  async list(travelerId: TravelerId): Promise<Result<readonly RivalActionVisit[]>> {
    const log = logger.fn('InMemoryRivalActionRepository.list', { travelerId });
    const injected = this.failures.take('list');
    if (injected !== undefined) return log.fail(fail(injected));
    return log.exit(ok(this.byTraveler.get(travelerId) ?? []));
  }

  /**
   * ライバル行動を1件追記する（同じ operationId の行動が保存済みなら何もしない）。
   * @param travelerId 旅人ID
   * @param action ライバル行動
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect メモリに追記する
   */
  async append(travelerId: TravelerId, action: RivalActionVisit): Promise<Result<void>> {
    const log = logger.fn('InMemoryRivalActionRepository.append', { travelerId, rivalId: action.rivalId, districtId: action.districtId, count: action.count });
    const injected = this.failures.take('append');
    if (injected !== undefined) return log.fail(fail(injected));
    const current = this.byTraveler.get(travelerId) ?? [];
    if (action.operationId !== undefined && current.some((saved) => saved.operationId === action.operationId)) {
      return log.exit(okVoid(), '処理済みの操作');
    }
    this.byTraveler.set(travelerId, Object.freeze([...current, Object.freeze({ ...action })]));
    return log.exit(okVoid());
  }

  /**
   * 旅人の世界のライバル行動をすべて消す。
   * @param travelerId 旅人ID
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect メモリから消す
   */
  async clear(travelerId: TravelerId): Promise<Result<void>> {
    const log = logger.fn('InMemoryRivalActionRepository.clear', { travelerId });
    const injected = this.failures.take('clear');
    if (injected !== undefined) return log.fail(fail(injected));
    this.byTraveler.delete(travelerId);
    return log.exit(okVoid());
  }
}

/** セッションのメモリ上のリポジトリ */
export class InMemorySessionRepository implements SessionRepository {
  private state: SessionState;
  /** 次の1回を失敗させる予約 */
  readonly failures = new FailurePlan<'load' | 'save'>();

  /**
   * セッションを作る。
   * @param initial 初期状態（既定は空＝旅人なし）
   */
  constructor(initial: SessionState = {}) {
    this.state = initial;
  }

  /**
   * セッションを読む。
   * @returns 成功: SessionState。失敗: STORAGE_FAILED
   */
  async load(): Promise<Result<SessionState>> {
    const log = logger.fn('InMemorySessionRepository.load');
    const injected = this.failures.take('load');
    if (injected !== undefined) return log.fail(fail(injected));
    return log.exit(ok(this.state));
  }

  /**
   * セッションを保存する。
   * @param state 新しい状態
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect メモリの状態を置き換える
   */
  async save(state: SessionState): Promise<Result<void>> {
    const log = logger.fn('InMemorySessionRepository.save', { activeTravelerId: state.activeTravelerId });
    const injected = this.failures.take('save');
    if (injected !== undefined) return log.fail(fail(injected));
    this.state = Object.freeze({ ...state });
    return log.exit(okVoid());
  }

  /** いまの状態（テストの確認用） */
  get current(): SessionState {
    return this.state;
  }
}

// ---------------------------------------------------------------------------
// イベントバス・デモ操作
// ---------------------------------------------------------------------------

/** 購読1件 */
interface Subscription {
  readonly type: DomainEventType;
  readonly handler: (event: DomainEvent) => Promise<void> | void;
}

/**
 * イベントが指定した種別か判定する型ガード。
 * @param event イベント
 * @param type 種別名
 * @returns 種別が一致すれば true
 */
export function isEventOfType<T extends DomainEventType>(event: DomainEvent, type: T): event is EventOfType<T> {
  return event.type === type;
}

/**
 * 発行されたイベントを記録するイベントバス（InMemoryEventBus と同じ契約: 登録順に await、eventId で重複排除＝DI-19）。
 * 本物と違い、ハンドラの例外は握らずにそのまま投げる（テストで気づけるように）。
 */
export class RecordingEventBus implements EventBus {
  private readonly subscriptions: Subscription[] = [];
  private readonly seen = new Set<EventId>();
  /** 配送したイベント（発行順。重複は含まない） */
  readonly published: DomainEvent[] = [];

  /**
   * 種別を指定して購読する。
   * @param type 種別名
   * @param handler ハンドラ
   * @returns 購読解除の関数
   * @sideEffect 購読を登録する
   */
  subscribe<T extends DomainEventType>(type: T, handler: DomainEventHandler<T>): () => void {
    const log = logger.fn('RecordingEventBus.subscribe', { type });
    const subscription: Subscription = { type, handler: (event) => (isEventOfType(event, type) ? handler(event) : undefined) };
    this.subscriptions.push(subscription);
    return log.exit(() => {
      const index = this.subscriptions.indexOf(subscription);
      if (index >= 0) this.subscriptions.splice(index, 1);
    });
  }

  /**
   * イベントを順に配送する（eventId が配送済みなら無視）。
   * @param events イベント
   * @sideEffect published に記録し、購読ハンドラを登録順に await する
   */
  async publish(events: readonly DomainEvent[]): Promise<void> {
    const log = logger.fn('RecordingEventBus.publish', { count: events.length });
    for (const event of events) {
      if (this.seen.has(event.eventId)) continue;
      this.seen.add(event.eventId);
      this.published.push(event);
      for (const subscription of [...this.subscriptions]) {
        if (subscription.type === event.type) await subscription.handler(event);
      }
    }
    log.exit(undefined);
  }

  /**
   * 配送したイベントのうち指定した種別だけを返す。
   * @param type 種別名
   * @returns その種別のイベント（発行順）
   */
  ofType<T extends DomainEventType>(type: T): EventOfType<T>[] {
    return this.published.filter((event): event is EventOfType<T> => isEventOfType(event, type));
  }

  /**
   * 配送したイベントの種別名を発行順に返す。
   * @returns 種別名の並び
   */
  types(): DomainEventType[] {
    return this.published.map((event) => event.type);
  }

  /**
   * 記録を消す（購読と重複排除の記憶は残す）。
   * @sideEffect published を空にする
   */
  clearPublished(): void {
    this.published.length = 0;
  }
}

/** 偽のデモ操作（日付のずらしと位置。clock / geo を渡すとそれも動かす） */
export class FakeDemoControl implements DemoControl {
  private offset = 0;
  /** setPosition で設定された位置（古い順） */
  readonly positions: GeoPoint[] = [];
  /** 次の1回を失敗させる予約 */
  readonly failures = new FailurePlan<'advanceDays' | 'resetOffset'>();

  /**
   * 偽のデモ操作を作る。
   * @param deps 連動させる時計・位置（任意）
   */
  constructor(private readonly deps: { readonly clock?: FixedClock; readonly geo?: FakeGeoProvider } = {}) {}

  /**
   * 実時刻からのずらし日数を返す。
   * @returns ずらし日数
   */
  offsetDays(): number {
    return this.offset;
  }

  /**
   * 日付を days 日進める（時計があれば時計も進める）。
   * @param days 日数
   * @returns 成功: 新しいずらし日数。失敗: STORAGE_FAILED（注入時）
   * @sideEffect ずらし日数と時計を変える
   */
  advanceDays(days: number): Result<number> {
    const log = logger.fn('FakeDemoControl.advanceDays', { days });
    const injected = this.failures.take('advanceDays');
    if (injected !== undefined) return log.fail(fail(injected));
    this.offset += days;
    this.deps.clock?.advanceDays(days);
    return log.exit(ok(this.offset));
  }

  /**
   * ずらし日数を 0 に戻す（時計があれば時計も戻す）。
   * @returns 成功: void。失敗: STORAGE_FAILED（注入時）
   * @sideEffect ずらし日数と時計を変える
   */
  resetOffset(): Result<void> {
    const log = logger.fn('FakeDemoControl.resetOffset', { offset: this.offset });
    const injected = this.failures.take('resetOffset');
    if (injected !== undefined) return log.fail(fail(injected));
    this.deps.clock?.advanceDays(-this.offset);
    this.offset = 0;
    return log.exit(okVoid());
  }

  /**
   * デモ位置を設定する（位置の偽物があればそれも動かす）。
   * @param point 位置
   * @sideEffect positions に記録し、位置の偽物を動かす
   */
  setPosition(point: GeoPoint): void {
    const log = logger.fn('FakeDemoControl.setPosition', { count: this.positions.length + 1 });
    this.positions.push(point);
    this.deps.geo?.setPoint(point);
    log.exit(undefined);
  }
}

// ---------------------------------------------------------------------------
// 組み立てヘルパ
// ---------------------------------------------------------------------------

/** テスト用の世界一式（WorldDeps を満たす＋偽物の操作口） */
export interface TestWorld extends WorldDeps {
  readonly clock: FixedClock;
  readonly geo: FakeGeoProvider;
  readonly ids: SequentialIdGenerator;
  readonly session: InMemorySessionRepository;
  readonly travelers: InMemoryTravelerRepository;
  readonly ledgers: InMemoryPointLedgerRepository;
  readonly lordships: InMemoryLordshipRepository;
  readonly rivalActions: InMemoryRivalActionRepository;
  readonly rivals: TestRivalRepository;
  readonly spots: TestSpotRepository;
  readonly events: RecordingEventBus;
  /** ids と clock を使う工場（ユースケースに渡す） */
  readonly eventFactory: EventFactory;
  /** clock と geo に連動するデモ操作 */
  readonly demo: FakeDemoControl;
}

/** createTestWorld の選択肢 */
export interface TestWorldOptions {
  /** 今日（既定 TEST_TODAY_TEXT） */
  readonly today?: string;
  /** true ならライバル7人（既定は2人）。catalog を渡したときは使わない */
  readonly allRivals?: boolean;
  /** マスタ一式（既定 buildTestCatalog＝旧 ID のカタログ。新 ID は scenarioCatalog の createScenarioWorld） */
  readonly catalog?: TestCatalog;
}

/**
 * テスト用の世界一式を作る（旅人はまだいない。seedTraveler で置く）。初期位置は order が最初の地区（旧 ID のカタログでは城下地区）の入口。
 * @param options 今日・ライバルの人数・マスタ一式
 * @returns TestWorld
 * @throws Error マスタに地区が無い（前提データの誤り）
 */
export function createTestWorld(options: TestWorldOptions = {}): TestWorld {
  const log = logger.fn('createTestWorld', { today: options.today, allRivals: options.allRivals, catalog: options.catalog !== undefined });
  const catalog = options.catalog ?? buildTestCatalog({ allRivals: options.allRivals === true });
  const clock = new FixedClock(options.today ?? TEST_TODAY_TEXT);
  const ids = new SequentialIdGenerator();
  const firstDistrict = catalog.spots.allDistricts()[0];
  invariant(firstDistrict !== undefined, 'テスト用マスタに地区がありません');
  const geo = new FakeGeoProvider({ clock, point: firstDistrict.entrance });
  const world: TestWorld = {
    clock, geo, ids,
    session: new InMemorySessionRepository(),
    travelers: new InMemoryTravelerRepository(),
    ledgers: new InMemoryPointLedgerRepository(),
    lordships: new InMemoryLordshipRepository(),
    rivalActions: new InMemoryRivalActionRepository(),
    rivals: catalog.rivals,
    spots: catalog.spots,
    events: new RecordingEventBus(),
    eventFactory: new EventFactory({ ids, clock }),
    demo: new FakeDemoControl({ clock, geo }),
  };
  return log.exit(world);
}

/** buildTraveler / seedTraveler の指定 */
export interface TravelerSeed {
  /** 旅人ID（既定 TEST_TRAVELER_ID） */
  readonly id?: TravelerId;
  /** プロフィール（既定 'user'） */
  readonly profile?: TravelerProfile;
  /** 表示名（既定「テスト旅人」） */
  readonly nickname?: string;
  /** 訪問: [スポットID, 今日からの日数（負＝過去）]。日付順でなくてよい（古い順に記録する） */
  readonly visits?: readonly (readonly [string, number])[];
  /** 発見だけするスポットID（訪問したスポットは自動で発見済みになる） */
  readonly discovered?: readonly string[];
}

/**
 * 指定どおりの記録を持つ旅人を Traveler.create と discover / visit で組み立てる（restore を使わず不変条件を本物の操作で満たす）。
 * 訪問は距離 0m・精度 5m・各日の 10:00（JST）、操作ID は seed 専用の名前空間。
 * @param spots マスタ参照
 * @param today 基準日（visits の日数はここからのずれ）
 * @param seed 指定
 * @returns 旅人（version 0）
 * @throws Error 指定が不正（マスタに無いスポット・同日同スポットの重複など＝テストのバグ）
 */
export function buildTraveler(spots: SpotRepository, today: LocalDate, seed: TravelerSeed = {}): Traveler {
  const log = logger.fn('buildTraveler', { visits: seed.visits?.length ?? 0, discovered: seed.discovered?.length ?? 0 });
  let traveler = Traveler.create(seed.id ?? TEST_TRAVELER_ID, seed.nickname ?? 'テスト旅人', seed.profile ?? 'user');
  const visits = [...(seed.visits ?? [])].sort((a, b) => a[1] - b[1]);
  const firstDay = Math.min(0, ...visits.map(([, offset]) => offset));
  const discovered = (seed.discovered ?? []).map((id) => spotOf(spots, id));
  traveler = traveler.discover(discovered, jstInstantOf(addDays(today, firstDay), 9)).traveler;
  visits.forEach(([spotId, offset], index) => {
    const localDate = addDays(today, offset);
    const outcome = traveler.visit({ spot: spotOf(spots, spotId), meters: 0, accuracyM: TEST_ACCURACY_M, at: jstInstantOf(localDate, 10), localDate, operationId: seedOperationId(index + 1) });
    invariant(outcome.ok, `シードの訪問 ${spotId} @${offset} が不正です`);
    traveler = outcome.value.traveler;
  });
  return log.exit(traveler);
}

/**
 * 旅人を組み立てて保存し、セッションのアクティブな旅人にする。
 * @param world テスト用の世界
 * @param seed 指定
 * @returns 保存後の旅人（version は保存済み版数 + 1）
 * @throws Error 保存に失敗した（テストのバグ）
 * @sideEffect TravelerRepository.save・SessionRepository.save
 */
export async function seedTraveler(world: TestWorld, seed: TravelerSeed = {}): Promise<Traveler> {
  const log = logger.fn('seedTraveler', { id: seed.id });
  const traveler = buildTraveler(world.spots, world.clock.today(), seed);
  const saved = must(await world.travelers.save(traveler, world.travelers.versionOf(traveler.id)));
  must(await world.session.save({ activeTravelerId: saved.id }));
  return log.exit(saved);
}

/** seedLordship の1行（holder は 'traveler' か ライバルID の文字列。lost=true なら旅人→ライバルの順に交代させて取り返し中にする） */
export interface LordshipSeedEntry {
  readonly districtId: string;
  readonly holder: string;
  readonly lost?: boolean;
}

/**
 * 地区の主の盤を指定どおりに作って保存する（LordshipBoard.apply を使うので lostByTraveler も本物の規則で決まる）。
 * @param world テスト用の世界
 * @param entries 地区ごとの主
 * @param travelerId 旅人ID（既定 TEST_TRAVELER_ID）
 * @returns 保存後の盤
 * @throws Error 保存に失敗した（テストのバグ）
 * @sideEffect LordshipRepository.save
 */
export async function seedLordship(world: TestWorld, entries: readonly LordshipSeedEntry[], travelerId: TravelerId = TEST_TRAVELER_ID): Promise<LordshipBoard> {
  const log = logger.fn('seedLordship', { entries: entries.length });
  const current = must(await world.lordships.find(travelerId));
  let board = current;
  for (const entry of entries) {
    const districtId: DistrictId = districtOf(world.spots, entry.districtId).id;
    if (entry.lost === true) board = board.apply(districtId, TRAVELER_HOLDER).board;
    board = board.apply(districtId, entry.holder === 'traveler' ? TRAVELER_HOLDER : rivalHolder(testRivalId(entry.holder))).board;
  }
  return log.exit(must(await world.lordships.save(board, current.version)));
}
