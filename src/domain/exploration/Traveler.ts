/**
 * @file 旅人集約（domain/exploration 層）
 * 発見・訪問・クーポン利用の記録を追記専用で持つ不変オブジェクト。変更メソッドは新しいインスタンスを返す。
 * - 訪問は 40m（VISIT_RADIUS_M）以内・精度 MAX_ACCURACY_M 以下・同一スポット1日1回（DI-08, DI-14）
 * - 同じ operationId の再実行は duplicate=true で無変更（DI-07）
 * - 記録を消す・減らす操作は作らない（CLAUDE.md 5「失う体験を作らない」）
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { OperationId, ShopEventId, SpotId, TravelerId } from '@/Common/types/Id';
import { invariant } from '@/Common/utils/assert';
import type { Instant, LocalDate } from '@/Common/utils/date';
import { isNonNegativeInteger, roundToInt } from '@/Common/utils/number';
import { MAX_ACCURACY_M, VISIT_RADIUS_M } from '@/domain/exploration/constants';
import { isWithinVisitRadius } from '@/domain/exploration/DiscoveryRule';
import {
  checkTravelerInvariants,
  normalizeNickname,
  parseTravelerState,
  trimProcessedOperationIds,
} from '@/domain/exploration/TravelerState';
import type { TravelerProfile, TravelerState } from '@/domain/exploration/TravelerState';
import type { CouponRedemption, DiscoveryRecord, VisitRecord } from '@/domain/exploration/VisitRecord';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import type { Spot } from '@/domain/spot/Spot';

export type { TravelerProfile, TravelerState } from '@/domain/exploration/TravelerState';

const logger = createLogger('domain/exploration/Traveler');

/** visit の入力 */
export interface VisitInput {
  readonly spot: Spot;
  /** 現在地からスポットまでの距離（メートル） */
  readonly meters: number;
  /** 測位精度（メートル） */
  readonly accuracyM: number;
  readonly at: Instant;
  /** at の JST 暦日（Clock.today()） */
  readonly localDate: LocalDate;
  readonly operationId: OperationId;
}

/** visit の失敗コード */
export type VisitErrorCode = 'OUT_OF_RANGE' | 'ALREADY_VISITED_TODAY' | 'LOW_ACCURACY';

/** visit の成功結果 */
export interface VisitOutcome {
  readonly traveler: Traveler;
  readonly record: VisitRecord;
  /** 処理済みの operationId だった（何も変えていない） */
  readonly duplicate: boolean;
}

/** redeem の入力 */
export interface RedeemInput {
  readonly shopEvent: ShopEvent;
  /** 現在地からスポットまでの距離（メートル） */
  readonly meters: number;
  readonly at: Instant;
  readonly localDate: LocalDate;
  readonly operationId: OperationId;
}

/** redeem の失敗コード */
export type RedeemErrorCode = 'OUT_OF_RANGE' | 'EXPIRED' | 'ALREADY_REDEEMED' | 'NOT_COUPON';

/** redeem の成功結果 */
export interface RedeemOutcome {
  readonly traveler: Traveler;
  readonly duplicate: boolean;
}

/** discover の結果 */
export interface DiscoverOutcome {
  readonly traveler: Traveler;
  readonly newlyDiscovered: readonly Spot[];
}

/** 記録の配列だけを差し替えるための部分更新 */
type StatePatch = Partial<Pick<TravelerState, 'discoveries' | 'visits' | 'redemptions' | 'processedOperationIds' | 'version'>>;

/**
 * 保存形を凍結する（配列も凍結し、外から書き換えられないようにする）。
 * @param state 保存形
 * @returns 凍結済みの保存形
 */
function freezeState(state: TravelerState): TravelerState {
  const log = logger.fn('freezeState', { visits: state.visits.length, version: state.version });
  return log.exit(Object.freeze({
    ...state,
    discoveries: Object.freeze([...state.discoveries]),
    visits: Object.freeze([...state.visits]),
    redemptions: Object.freeze([...state.redemptions]),
    processedOperationIds: trimProcessedOperationIds(state.processedOperationIds),
  }));
}

/**
 * 訪問の重複判定キーを作る（同一スポット・同一暦日）。
 * @param spotId スポットID
 * @param localDate JST 暦日
 * @returns 'spotId|YYYY-MM-DD'
 */
function visitKey(spotId: SpotId, localDate: LocalDate): string {
  return `${spotId}|${localDate}`;
}

/** 旅人（集約ルート・不変） */
export class Traveler {
  private readonly discoveredIds: ReadonlySet<SpotId>;
  private readonly visitedIds: ReadonlySet<SpotId>;
  private readonly visitKeys: ReadonlySet<string>;
  private readonly redeemedIds: ReadonlySet<ShopEventId>;
  private readonly knownOperationIds: ReadonlySet<OperationId>;

  /**
   * 検証済みの保存形から作る（外からは create / restore を使う）。判定用の索引を前計算する。
   * @param state 凍結済みで不変条件を満たす保存形
   */
  private constructor(private readonly state: TravelerState) {
    this.discoveredIds = new Set(state.discoveries.map((d) => d.spotId));
    this.visitedIds = new Set(state.visits.map((v) => v.spotId));
    this.visitKeys = new Set(state.visits.map((v) => visitKey(v.spotId, v.localDate)));
    this.redeemedIds = new Set(state.redemptions.map((r) => r.shopEventId));
    this.knownOperationIds = new Set([
      ...state.processedOperationIds,
      ...state.visits.map((v) => v.operationId),
      ...state.redemptions.map((r) => r.operationId),
    ]);
  }

  /**
   * 記録が空の新しい旅人を作る（版数 0）。
   * @param id 旅人ID
   * @param nickname 表示名（正規化される。空なら既定名）
   * @param profile プロフィール
   * @returns 新しい旅人
   */
  static create(id: TravelerId, nickname: string, profile: TravelerProfile): Traveler {
    const log = logger.fn('create', { id, profile });
    const state: TravelerState = { id, nickname: normalizeNickname(nickname), profile, version: 0, discoveries: [], visits: [], redemptions: [], processedOperationIds: [] };
    return log.exit(new Traveler(freezeState(state)));
  }

  /**
   * 保存形から旅人を復元する。構造と不変条件を検証し、処理済み操作ID は直近 500 件に切り詰める。
   * PointLedger.restore・LordshipBoard.restore とそろえて unknown を受け取る（保存データをそのまま渡せる＝DI-01）。
   * TravelerState 型の値もそのまま渡せる（docs/08 §3.3 の契約と互換）。
   * @param state 保存形（TravelerState、または保存データ由来の未検証の値）
   * @returns 成功: 旅人。失敗: INVALID_INPUT（details.rule に破った規則）
   */
  static restore(state: unknown): Result<Traveler> {
    const log = logger.fn('restore'); // 入力は保存データ由来で壊れている可能性があるため、検証前に中身を読まない
    const parsed = parseTravelerState(state);
    if (!parsed.ok) return log.fail(parsed);
    log.debug('構造検証済み', { visits: parsed.value.visits.length, version: parsed.value.version });
    const checked = checkTravelerInvariants(parsed.value);
    if (!checked.ok) return log.fail(checked);
    return log.exit(ok(new Traveler(freezeState(parsed.value))));
  }

  /**
   * 保存形を返す（凍結済み）。
   * @returns 保存形
   */
  toState(): TravelerState {
    return this.state;
  }

  /** 旅人ID */
  get id(): TravelerId {
    return this.state.id;
  }

  /** 表示名 */
  get nickname(): string {
    return this.state.nickname;
  }

  /** プロフィール */
  get profile(): TravelerProfile {
    return this.state.profile;
  }

  /** 版数（楽観ロック用。リポジトリが保存成功時に +1 する） */
  get version(): number {
    return this.state.version;
  }

  /** 訪問記録（古い順） */
  get visits(): readonly VisitRecord[] {
    return this.state.visits;
  }

  /** 発見記録（古い順） */
  get discoveries(): readonly DiscoveryRecord[] {
    return this.state.discoveries;
  }

  /** クーポン利用記録（古い順） */
  get redemptions(): readonly CouponRedemption[] {
    return this.state.redemptions;
  }

  /**
   * スポットを発見済みか判定する。
   * @param id スポットID
   * @returns 発見済みなら true
   */
  hasDiscovered(id: SpotId): boolean {
    return this.discoveredIds.has(id);
  }

  /**
   * スポットを訪問済みか判定する（日付を問わない）。
   * @param id スポットID
   * @returns 1回以上訪問していれば true
   */
  hasVisited(id: SpotId): boolean {
    return this.visitedIds.has(id);
  }

  /**
   * その日にそのスポットを訪問済みか判定する（1日1回の判定＝DI-08）。
   * @param id スポットID
   * @param localDate JST 暦日
   * @returns 訪問済みなら true
   */
  hasVisitedOn(id: SpotId, localDate: LocalDate): boolean {
    return this.visitKeys.has(visitKey(id, localDate));
  }

  /**
   * クーポンを利用済みか判定する。
   * @param id クーポン・イベントID
   * @returns 利用済みなら true
   */
  hasRedeemed(id: ShopEventId): boolean {
    return this.redeemedIds.has(id);
  }

  /**
   * 操作ID を処理済みか判定する（処理済み一覧に加え、訪問・利用記録の operationId も見る＝DI-07）。
   * @param op 操作ID
   * @returns 処理済みなら true
   */
  hasProcessed(op: OperationId): boolean {
    return this.knownOperationIds.has(op);
  }

  /**
   * 版数だけを変えた旅人を返す（リポジトリが保存成功時に使う）。
   * @param version 新しい版数（0 以上の整数）
   * @returns 新しい旅人
   * @throws Error 版数が不正（呼び出し側のバグ）
   */
  withVersion(version: number): Traveler {
    const log = logger.fn('withVersion', { version });
    invariant(isNonNegativeInteger(version), 'Traveler.withVersion: 版数は 0 以上の整数');
    return log.exit(this.next({ version }));
  }

  /**
   * 記録の配列や版数を差し替えた新しい旅人を作る。
   * @param patch 差し替える項目
   * @returns 新しい旅人
   */
  private next(patch: StatePatch): Traveler {
    return new Traveler(freezeState({ ...this.state, ...patch }));
  }

  /**
   * スポットを発見済みにする（距離判定は呼び出し側の findSpotsToDiscover で済ませておく）。
   * 発見済み・入力内の重複は無視する。新たな発見が無ければ同じインスタンスを返す。
   * @param spots 発見範囲（80m）に入ったスポット
   * @param at 発見した瞬間
   * @returns 新しい旅人と、今回初めて発見したスポット
   */
  discover(spots: readonly Spot[], at: Instant): DiscoverOutcome {
    const log = logger.fn('discover', { candidates: spots.length });
    const seen = new Set<SpotId>();
    const newly = spots.filter((spot) => {
      if (this.discoveredIds.has(spot.id) || seen.has(spot.id)) return false;
      seen.add(spot.id);
      return true;
    });
    if (newly.length === 0) return log.exit({ traveler: this, newlyDiscovered: [] });
    const records = newly.map((spot): DiscoveryRecord => Object.freeze({ spotId: spot.id, districtId: spot.districtId, discoveredAt: at }));
    log.debug('新しく発見', { spotIds: newly.map((spot) => spot.id) });
    return log.exit({ traveler: this.next({ discoveries: [...this.state.discoveries, ...records] }), newlyDiscovered: Object.freeze(newly) });
  }

  /**
   * スポットを訪問する。未発見なら発見記録も同時に追加する。
   * 判定順: 処理済み操作 → 精度 → 距離 → 1日1回。
   * @param input スポット・距離・精度・日時・暦日・操作ID
   * @returns 成功: 新しい旅人・訪問記録・duplicate。失敗: LOW_ACCURACY / OUT_OF_RANGE / ALREADY_VISITED_TODAY
   */
  visit(input: VisitInput): Result<VisitOutcome, AppError<VisitErrorCode>> {
    const log = logger.fn('visit', { spotId: input.spot.id, meters: input.meters, accuracyM: input.accuracyM, localDate: input.localDate, operationId: input.operationId });
    if (this.hasProcessed(input.operationId)) {
      return log.exit(ok({ traveler: this, record: this.recordForDuplicate(input), duplicate: true }), '処理済みの操作');
    }
    const rejection = this.visitRejection(input);
    if (rejection !== undefined) return log.fail(fail(rejection));
    const { spot } = input;
    const record: VisitRecord = Object.freeze({ spotId: spot.id, districtId: spot.districtId, visitedAt: input.at, localDate: input.localDate, operationId: input.operationId });
    const discovery: DiscoveryRecord = Object.freeze({ spotId: spot.id, districtId: spot.districtId, discoveredAt: input.at });
    const traveler = this.next({
      discoveries: this.discoveredIds.has(spot.id) ? this.state.discoveries : [...this.state.discoveries, discovery],
      visits: [...this.state.visits, record],
      processedOperationIds: [...this.state.processedOperationIds, input.operationId],
    });
    return log.exit(ok({ traveler, record, duplicate: false }));
  }

  /**
   * 訪問を受け付けない理由を返す（精度 → 距離 → 1日1回の順）。
   * @param input 訪問の入力
   * @returns 拒否理由。受け付けるなら undefined
   */
  private visitRejection(input: VisitInput): AppError<VisitErrorCode> | undefined {
    const log = logger.fn('visitRejection', { meters: input.meters, accuracyM: input.accuracyM });
    if (!(Number.isFinite(input.accuracyM) && input.accuracyM >= 0 && input.accuracyM <= MAX_ACCURACY_M)) {
      return log.exit(AppError.of('LOW_ACCURACY', '現在地の精度が低いため訪問できません。少し待ってからもう一度お試しください', { maxAccuracyM: MAX_ACCURACY_M }));
    }
    if (!isWithinVisitRadius(input.meters)) {
      const meters = Number.isFinite(input.meters) ? roundToInt(input.meters) : undefined;
      return log.exit(AppError.of('OUT_OF_RANGE', `スポットから${VISIT_RADIUS_M}m以内に近づくと訪問できます`, { meters, radiusM: VISIT_RADIUS_M }));
    }
    if (this.hasVisitedOn(input.spot.id, input.localDate)) {
      return log.exit(AppError.of('ALREADY_VISITED_TODAY', '今日はこのスポットを訪問済みです。また別の日に来てください'));
    }
    return log.exit(undefined);
  }

  /**
   * 処理済み操作の再実行で返す訪問記録を探す。同じ operationId の訪問が無ければ入力から組み立てる（保存はしない）。
   * @param input 訪問の入力
   * @returns 訪問記録
   */
  private recordForDuplicate(input: VisitInput): VisitRecord {
    const log = logger.fn('recordForDuplicate', { operationId: input.operationId });
    const found = this.state.visits.find((v) => v.operationId === input.operationId);
    if (found !== undefined) return log.exit(found);
    return log.exit(Object.freeze({ spotId: input.spot.id, districtId: input.spot.districtId, visitedAt: input.at, localDate: input.localDate, operationId: input.operationId }));
  }

  /**
   * クーポンを利用する（イベントは利用できない）。
   * 判定順: 処理済み操作 → クーポンか → 期間内か → 利用済みか → 距離。
   * @param input クーポン・距離・日時・暦日・操作ID
   * @returns 成功: 新しい旅人・duplicate。失敗: NOT_COUPON / EXPIRED / ALREADY_REDEEMED / OUT_OF_RANGE
   */
  redeem(input: RedeemInput): Result<RedeemOutcome, AppError<RedeemErrorCode>> {
    const log = logger.fn('redeem', { shopEventId: input.shopEvent.id, meters: input.meters, localDate: input.localDate, operationId: input.operationId });
    if (this.hasProcessed(input.operationId)) return log.exit(ok({ traveler: this, duplicate: true }), '処理済みの操作');
    const rejection = this.redeemRejection(input);
    if (rejection !== undefined) return log.fail(fail(rejection));
    const redemption: CouponRedemption = Object.freeze({
      shopEventId: input.shopEvent.id,
      spotId: input.shopEvent.spotId,
      redeemedAt: input.at,
      operationId: input.operationId,
    });
    const traveler = this.next({
      redemptions: [...this.state.redemptions, redemption],
      processedOperationIds: [...this.state.processedOperationIds, input.operationId],
    });
    return log.exit(ok({ traveler, duplicate: false }));
  }

  /**
   * クーポン利用を受け付けない理由を返す（クーポンか → 期間 → 利用済み → 距離の順）。
   * @param input 利用の入力
   * @returns 拒否理由。受け付けるなら undefined
   */
  private redeemRejection(input: RedeemInput): AppError<RedeemErrorCode> | undefined {
    const log = logger.fn('redeemRejection', { shopEventId: input.shopEvent.id, meters: input.meters });
    const { shopEvent, localDate } = input;
    if (shopEvent.kind !== 'coupon') return log.exit(AppError.of('NOT_COUPON', 'これはクーポンではありません'));
    if (!shopEvent.period.contains(localDate)) {
      const notStarted = shopEvent.period.hasNotStarted(localDate);
      const message = notStarted ? 'このクーポンはまだ利用期間前です' : 'このクーポンは期限が切れています';
      return log.exit(AppError.of('EXPIRED', message, { reason: notStarted ? 'notStarted' : 'ended' }));
    }
    if (this.hasRedeemed(shopEvent.id)) return log.exit(AppError.of('ALREADY_REDEEMED', 'このクーポンは利用済みです'));
    if (!isWithinVisitRadius(input.meters)) {
      return log.exit(AppError.of('OUT_OF_RANGE', `お店から${VISIT_RADIUS_M}m以内で利用できます`, { radiusM: VISIT_RADIUS_M }));
    }
    return log.exit(undefined);
  }
}
