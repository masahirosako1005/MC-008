/**
 * @file セッション（アクティブな旅人）の保存 IF（application 層のポート）
 * ユースケースは入力の travelerId を信用せず、ここから現在の旅人を解決する（SEC-01）。
 * 実装は infrastructure/storage/LocalStorageSessionRepository。
 */
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';

/** 保存するセッション情報 */
export interface SessionState {
  readonly activeTravelerId?: TravelerId;
}

/** セッションリポジトリ */
export interface SessionRepository {
  /** セッションを読む（未保存なら空の SessionState） */
  load(): Promise<Result<SessionState>>;
  /** セッションを保存する */
  save(state: SessionState): Promise<Result<void>>;
}
