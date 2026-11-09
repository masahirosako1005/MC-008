/**
 * @file 旅人集約のリポジトリ IF（domain/exploration 層）
 * 実装: infrastructure/storage/LocalStorageTravelerRepository（将来 REST へ差し替え可能）。
 * save は楽観ロック（expectedVersion 不一致で CONFLICT＝DI-10）。成功時は version+1 の旅人を返す。
 */
import type { AppError, Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import type { Traveler } from '@/domain/exploration/Traveler';

/** 保存の失敗コード */
export type TravelerSaveErrorCode = 'CONFLICT' | 'STORAGE_FAILED';

/** 旅人の永続化 */
export interface TravelerRepository {
  /** ID で旅人を読む。未保存なら ok(undefined) */
  findById(id: TravelerId): Promise<Result<Traveler | undefined>>;
  /** 旅人を保存する。保存済み version と expectedVersion が違えば CONFLICT。成功時は version+1 の旅人 */
  save(traveler: Traveler, expectedVersion: number): Promise<Result<Traveler, AppError<TravelerSaveErrorCode>>>;
  /** 旅人を削除する（全データ削除・旅人切替用） */
  delete(id: TravelerId): Promise<Result<void>>;
}
