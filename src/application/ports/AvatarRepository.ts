/**
 * @file アバターの装い（着せ替えの選択）の保存 IF（application 層のポート）
 * 何を持たせるか（持ち物の1枠）だけを旅人ごとに保存する。アイテムの所持は訪問記録から毎回導出し、ここには保存しない（docs/08 D4, D16）。
 * 持っていないアイテムを選ばせない判定は EquipAvatarItemUseCase で行う。実装は infrastructure/storage/LocalStorageAvatarRepository。
 */
import type { Result } from '@/Common/result/Result';
import type { ItemId, TravelerId } from '@/Common/types/Id';

/** 保存する装い（未設定はカメラを持つ既定の姿） */
export interface AvatarState {
  /** 手に持つアイテム。undefined ならカメラ */
  readonly heldItemId?: ItemId;
}

/** アバターの装いのリポジトリ */
export interface AvatarRepository {
  /** 旅人の装いを読む（未保存なら空の AvatarState） */
  load(travelerId: TravelerId): Promise<Result<AvatarState>>;
  /** 旅人の装いを保存する（上書き） */
  save(travelerId: TravelerId, state: AvatarState): Promise<Result<void>>;
}
