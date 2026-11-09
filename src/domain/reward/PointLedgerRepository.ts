/**
 * @file ポイント台帳のリポジトリ IF（domain/reward 層）
 * 実装: infrastructure/storage/LocalStoragePointLedgerRepository（将来 REST へ差し替え可能）。
 * save は楽観ロック（expectedVersion 不一致で CONFLICT＝DI-10）。成功時は version+1 の台帳を返す。
 * 読込時は PointLedger.restore（または parsePointLedgerState）で検証してから集約にする（DI-01）。
 */
import type { AppError, Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import type { PointLedger } from '@/domain/reward/PointLedger';

/** 保存の失敗コード */
export type PointLedgerSaveErrorCode = 'CONFLICT' | 'STORAGE_FAILED';

/** ポイント台帳の永続化 */
export interface PointLedgerRepository {
  /** 旅人の台帳を読む。未保存なら PointLedger.empty(travelerId)（版数 0）を返す */
  find(travelerId: TravelerId): Promise<Result<PointLedger>>;
  /** 台帳を保存する。保存済み version と expectedVersion が違えば CONFLICT。成功時は version+1 の台帳 */
  save(ledger: PointLedger, expectedVersion: number): Promise<Result<PointLedger, AppError<PointLedgerSaveErrorCode>>>;
  /** 台帳を削除する（全データ削除・旅人切替用。デモの作り直し以外で残高を減らす用途に使わない） */
  delete(travelerId: TravelerId): Promise<Result<void>>;
}
