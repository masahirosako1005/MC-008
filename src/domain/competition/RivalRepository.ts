/**
 * @file ライバルとライバル行動のリポジトリ IF（domain/competition 層）
 * - RivalRepository: マスタ rivals.json 由来の模擬ライバル（読込後は同期・不変）。実装: infrastructure/master/StaticRivalRepository
 * - RivalActionRepository: デモの「ライバル行動」の記録。旅人ごとの世界に属する（旅人切替・全削除で消える）。
 *   実装: infrastructure/storage/LocalStorageRivalActionRepository
 */
import type { Result } from '@/Common/result/Result';
import type { RivalId, TravelerId } from '@/Common/types/Id';
import type { Rival, RivalActionVisit } from '@/domain/competition/Rival';

/** 模擬ライバルのマスタ */
export interface RivalRepository {
  /** すべてのライバル（ID 昇順など、実装が決めた安定した順） */
  allRivals(): readonly Rival[];
  /** ID でライバルを探す。無ければ undefined */
  findRival(id: RivalId): Rival | undefined;
}

/** ライバル行動の永続化（追記専用） */
export interface RivalActionRepository {
  /** 旅人の世界のライバル行動を古い順に返す。未保存なら ok([]) */
  list(travelerId: TravelerId): Promise<Result<readonly RivalActionVisit[]>>;
  /**
   * ライバル行動を1件追記する。action.operationId があり、同じ ID の行動が保存済みなら何もせず ok を返す（DI-07）。
   * 失敗: STORAGE_FAILED
   */
  append(travelerId: TravelerId, action: RivalActionVisit): Promise<Result<void>>;
  /** 旅人の世界のライバル行動をすべて消す（旅人切替・全データ削除用） */
  clear(travelerId: TravelerId): Promise<Result<void>>;
}
