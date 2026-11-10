/**
 * @file お店での購入を記録して EXP を付けるユースケース（application 層・書込み系）
 * 2026-11-10 ユーザー指示「ポイントは、各ロケでチェックインや購入でしたもので獲得できるようにしたい」。
 * 流れ: 入力検証（parseOperationId・parseSpotId＝DI-01）→ スポット（お店だけ）→ 旅人（セッションから解決＝SEC-01）→ 台帳
 *       → 処理済みの操作なら前回の結果（DI-07）→ 現在地 → 精度・80m（訪問と同じ判定＝PurchaseRewardPolicy）
 *       → 同じお店・同じ日の上限（超えたら 0 点で台帳に載せない）→ 台帳へ1行追記して保存（1回・楽観ロック＝DI-10, DI-12。競合したら読み直して1回だけやり直す）。
 * 台帳は追記専用で、残高を書き換えない（DI-06）。ドメインイベントは出さない（PointsAwarded は訪問の演出のまとめに使うため。EXP は出力で返す）。
 * 位置が取れなければ失敗を返し、デモ位置に切り替えない（SEC-27）。座標はログに出さない（LG-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseOperationId, parseSpotId } from '@/Common/types/Id';
import type { OperationId, SpotId, TravelerId } from '@/Common/types/Id';
import { localDateOf } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import type { UseCase } from '@/application/AppServices';
import type { PurchaseInput, PurchaseOutput } from '@/application/dto/Dto';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import { Distance } from '@/domain/exploration/Distance';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import type { Clock } from '@/domain/ports/Clock';
import type { GeoProvider } from '@/domain/ports/GeoProvider';
import { createLedgerEntry, ledgerEntryIdOf } from '@/domain/reward/LedgerEntry';
import type { PointLedger } from '@/domain/reward/PointLedger';
import type { PointLedgerRepository } from '@/domain/reward/PointLedgerRepository';
import { purchaseEntriesAt, purchaseRejection, purchaseRewardFor } from '@/domain/reward/PurchaseRewardPolicy';
import type { Spot } from '@/domain/spot/Spot';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/reward/RecordPurchaseUseCase');

/** RecordPurchaseUseCase の依存 */
export interface RecordPurchaseDeps {
  readonly session: SessionRepository;
  readonly travelers: TravelerRepository;
  readonly spots: SpotRepository;
  readonly geo: GeoProvider;
  /** 購入日時と JST 暦日の時計（デモでは日付進行が効く DemoClock） */
  readonly clock: Clock;
  /** ポイント台帳（追記専用） */
  readonly ledgers: PointLedgerRepository;
}

/** 検証済みの入力 */
interface ParsedPurchaseInput {
  readonly operationId: OperationId;
  readonly spotId: SpotId;
}

/** 購入した時と場所（現在地の判定を通ったもの） */
interface PurchaseMoment {
  readonly at: Instant;
  readonly localDate: LocalDate;
}

/**
 * 入力を境界で検証する（presentation からの値を信用しない＝DI-01, SEC-16）。
 * @param input 購入の入力
 * @returns 成功: 検証済みの operationId と spotId。失敗: INVALID_INPUT
 */
function parsePurchaseInput(input: PurchaseInput): Result<ParsedPurchaseInput> {
  const log = logger.fn('parsePurchaseInput');
  const record: Readonly<Record<string, unknown>> = isRecord(input) ? input : {};
  const operationId = parseOperationId(record['operationId']);
  if (!operationId.ok) return log.fail(operationId, 'operationId が不正');
  const spotId = parseSpotId(record['spotId']);
  if (!spotId.ok) return log.fail(spotId, 'spotId が不正');
  return log.exit(ok(Object.freeze({ operationId: operationId.value, spotId: spotId.value })));
}

/**
 * 出力 DTO を作る。
 * @param spot お店
 * @param ledger 台帳（今回の行を追記した後）
 * @param fields 暦日・今回の EXP・上限・再実行か
 * @returns PurchaseOutput（凍結済み）
 */
function outputOf(spot: Spot, ledger: PointLedger, fields: { readonly localDate: string; readonly points: number; readonly limited: boolean; readonly duplicate: boolean }): PurchaseOutput {
  const log = logger.fn('outputOf', { spotId: spot.id, points: fields.points, limited: fields.limited, duplicate: fields.duplicate });
  return log.exit(
    Object.freeze({
      spotId: spot.id,
      districtId: spot.districtId,
      ...fields,
      purchasesAtSpot: purchaseEntriesAt(ledger.entries, spot.id).length,
      totalPoints: Number(ledger.balance()),
    }),
  );
}

/** お店での購入を記録して EXP を付ける */
export class RecordPurchaseUseCase implements UseCase<PurchaseInput, PurchaseOutput> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人リポジトリ・マスタ・位置・時計・ポイント台帳
   */
  constructor(private readonly deps: RecordPurchaseDeps) {}

  /**
   * 購入を記録し、EXP を台帳に追記する。
   * @param input operationId（UUID・必須＝DI-07）と spotId
   * @returns 成功: 今回の EXP・上限・duplicate・そのお店の購入回数・累計 EXP（同じ operationId の再実行なら duplicate=true で何も変えない）。
   *          失敗: INVALID_INPUT／SPOT_NOT_FOUND／NOT_SHOP／TRAVELER_NOT_FOUND／GEO_UNAVAILABLE／GEO_DENIED／LOW_ACCURACY／OUT_OF_RANGE／CONFLICT（読み直しても競合）／STORAGE_FAILED
   * @sideEffect GeoProvider.current・Clock.now、PointLedgerRepository.find・save（新しい購入で EXP が付くときだけ。競合時は読み直して最大2回）
   * @see docs/06_data_integrity_checklist.md DI-06, DI-07, DI-10, DI-12
   */
  async execute(input: PurchaseInput): Promise<Result<PurchaseOutput>> {
    const log = logger.fn('execute');
    const parsed = parsePurchaseInput(input);
    if (!parsed.ok) return log.fail(parsed);
    const { operationId, spotId } = parsed.value;
    const spot = this.deps.spots.findSpot(spotId);
    if (spot === undefined) return log.fail(fail(AppError.of('SPOT_NOT_FOUND', 'スポットが見つかりません', { spotId })));
    if (spot.kind !== 'shop') return log.fail(fail(AppError.of('NOT_SHOP', 'お買い物のEXPはお店でだけもらえます', { spotId })));
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    const ledger = await this.deps.ledgers.find(traveler.value.id);
    if (!ledger.ok) return log.fail(ledger);
    const replay = this.replayOf(ledger.value, spot, operationId);
    if (replay !== undefined) return log.exit(ok(replay), '処理済みの操作');
    const moment = await this.momentAt(spot);
    if (!moment.ok) return log.fail(moment);
    const result = await this.commitWithRetry(traveler.value.id, ledger.value, spot, operationId, moment.value);
    if (!result.ok) return log.fail(result);
    log.info('購入を記録した', { spotId, localDate: result.value.localDate, points: result.value.points, limited: result.value.limited, duplicate: result.value.duplicate });
    return log.exit(result);
  }

  /**
   * 処理済みの操作なら、台帳に載っている行から duplicate=true の出力を返す（現在地を取り直さずに同じ結果を返す＝DI-07）。
   * @param ledger 台帳
   * @param spot お店
   * @param operationId 操作ID
   * @returns 処理済みなら出力。未処理なら undefined
   */
  private replayOf(ledger: PointLedger, spot: Spot, operationId: OperationId): PurchaseOutput | undefined {
    const log = logger.fn('replayOf', { operationId });
    const entryId = ledgerEntryIdOf(operationId, 'purchase');
    const row = ledger.entries.find((e) => e.entryId === entryId);
    if (row === undefined) return log.exit(undefined);
    return log.exit(outputOf(spot, ledger, { localDate: row.localDate, points: Number(row.points), limited: false, duplicate: true }));
  }

  /**
   * 現在地を取り、お店の中にいるか（精度・80m）を確かめて、購入の日時と暦日を作る（Clock.now() 1回から作る＝DI-04）。
   * @param spot お店
   * @returns 成功: 日時と暦日。失敗: GEO_UNAVAILABLE / GEO_DENIED（そのまま返す＝SEC-27）／LOW_ACCURACY／OUT_OF_RANGE
   * @sideEffect GeoProvider.current・Clock.now を呼ぶ
   */
  private async momentAt(spot: Spot): Promise<Result<PurchaseMoment>> {
    const log = logger.fn('momentAt', { spotId: spot.id });
    const fix = await this.deps.geo.current();
    if (!fix.ok) return log.fail(fix, '位置を取得できない');
    const meters = Distance.between(fix.value.point, spot.point).meters;
    log.debug('距離判定の材料', { meters, accuracyM: fix.value.accuracyM });
    const rejection = purchaseRejection({ spot, meters, accuracyM: fix.value.accuracyM });
    if (rejection !== undefined) return log.fail(fail(rejection));
    const at = this.deps.clock.now();
    return log.exit(ok(Object.freeze({ at, localDate: localDateOf(at) })));
  }

  /**
   * 購入を台帳に追記して保存する。保存が競合（CONFLICT）したら台帳を読み直して1回だけやり直す。
   * 並行した二重送信なら、読み直した台帳には同じ行が載っているので duplicate=true になる（DI-07）。
   * @param travelerId 旅人ID
   * @param ledger 読み込んだ台帳
   * @param spot お店
   * @param operationId 操作ID
   * @param moment 購入の日時と暦日
   * @returns 成功: 出力。失敗: CONFLICT／STORAGE_FAILED／INVALID_INPUT
   * @sideEffect PointLedgerRepository.save・find
   */
  private async commitWithRetry(travelerId: TravelerId, ledger: PointLedger, spot: Spot, operationId: OperationId, moment: PurchaseMoment): Promise<Result<PurchaseOutput>> {
    const log = logger.fn('commitWithRetry', { version: ledger.version, spotId: spot.id });
    const first = await this.commit(ledger, spot, operationId, moment);
    if (first.ok || first.error.code !== 'CONFLICT') return first.ok ? log.exit(first) : log.fail(first);
    log.warn('台帳の保存が競合したので読み直して1回だけやり直す', { operationId });
    const reloaded = await this.deps.ledgers.find(travelerId);
    if (!reloaded.ok) return log.fail(reloaded);
    const replay = this.replayOf(reloaded.value, spot, operationId);
    if (replay !== undefined) return log.exit(ok(replay), '読み直したら処理済み');
    const second = await this.commit(reloaded.value, spot, operationId, moment);
    return second.ok ? log.exit(second) : log.fail(second);
  }

  /**
   * 上限を確かめ、EXP が付くなら購入の行を追記して保存する（計算 → 保存の順＝DI-12）。上限なら保存しない。
   * @param ledger 台帳（この版数で楽観ロック＝DI-10）
   * @param spot お店
   * @param operationId 操作ID
   * @param moment 購入の日時と暦日
   * @returns 成功: 出力。失敗: CONFLICT／STORAGE_FAILED／INVALID_INPUT（行が作れない＝計算のバグ）
   * @sideEffect EXP が付くときだけ PointLedgerRepository.save を1回呼ぶ
   */
  private async commit(ledger: PointLedger, spot: Spot, operationId: OperationId, moment: PurchaseMoment): Promise<Result<PurchaseOutput>> {
    const log = logger.fn('commit', { version: ledger.version, spotId: spot.id });
    const reward = purchaseRewardFor(ledger.entries, spot.id, moment.localDate);
    if (reward.limited) return log.exit(ok(outputOf(spot, ledger, { localDate: moment.localDate, points: 0, limited: true, duplicate: false })), '今日の上限');
    const entry = createLedgerEntry({ operationId, kind: 'purchase', points: reward.points, districtId: spot.districtId, spotId: spot.id, at: moment.at, localDate: moment.localDate });
    if (!entry.ok) return log.fail(entry);
    const appended = ledger.append([entry.value]);
    if (!appended.ok) return log.fail(appended);
    const saved = await this.deps.ledgers.save(appended.value, ledger.version);
    if (!saved.ok) return log.fail(saved);
    return log.exit(ok(outputOf(spot, saved.value, { localDate: moment.localDate, points: reward.points, limited: false, duplicate: false })));
  }
}
