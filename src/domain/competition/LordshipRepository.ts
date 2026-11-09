/**
 * @file 地区の主の盤（LordshipBoard）のリポジトリ IF（domain/competition 層）
 * 実装: infrastructure/storage/LocalStorageLordshipRepository（将来 REST へ差し替え可能）。
 * save は楽観ロック（expectedVersion 不一致で CONFLICT＝DI-10）。成功時は version+1 の盤を返す。
 */
import type { AppError, Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import type { LordshipBoard } from '@/domain/competition/LordshipBoard';

/** 保存の失敗コード */
export type LordshipSaveErrorCode = 'CONFLICT' | 'STORAGE_FAILED';

/** 地区の主の盤の永続化 */
export interface LordshipRepository {
  /**
   * 旅人の盤を読む。未保存なら LordshipBoard.empty(travelerId)（地区なし・版数0）を返す
   * （地区の行は apply で必要になったときに増える）。失敗: STORAGE_FAILED
   */
  find(travelerId: TravelerId): Promise<Result<LordshipBoard>>;
  /** 盤を保存する。保存済み version と expectedVersion が違えば CONFLICT。成功時は version+1 の盤 */
  save(board: LordshipBoard, expectedVersion: number): Promise<Result<LordshipBoard, AppError<LordshipSaveErrorCode>>>;
  /** 盤を削除する（旅人切替・全データ削除用） */
  delete(travelerId: TravelerId): Promise<Result<void>>;
}
