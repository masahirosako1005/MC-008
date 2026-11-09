/**
 * @file アバターの装い（着せ替えの選択）の保存 IF（application 層のポート）
 * 旅人ごとに、身につけている部品・マイコーデ・見た部品（NEW の判定）を保存する。
 * 部品の所持は訪問記録から毎回導出し、ここには保存しない（docs/08 D4, D16）。持っていない部品を外す判定はユースケースで行う。
 * 実装は infrastructure/storage/LocalStorageAvatarRepository。
 */
import type { Result } from '@/Common/result/Result';
import type { ItemId, TravelerId } from '@/Common/types/Id';

/** 保存する部品ID の形（'<枠>.<種類>'）。中身（定義があるか・持っているか）はユースケースで確かめる */
export const AVATAR_PART_ID_PATTERN = /^[a-zA-Z]{2,16}\.[a-zA-Z0-9]{1,24}$/;

/** 1つの装いに入る部品の上限（枠の数＋置くもの） */
export const MAX_OUTFIT_PARTS = 32;

/** 見た部品の上限 */
export const MAX_SEEN_PARTS = 512;

/** 保存する装い（未設定は既定の姿） */
export interface AvatarState {
  /** 旧来の「手に持つアイテム」。partIds が無いときだけ、持ち物の初期値に使う */
  readonly heldItemId?: ItemId;
  /** 身につけている部品ID */
  readonly partIds?: readonly string[];
  /** マイコーデ（枠の番号 → 部品ID。空き枠は null） */
  readonly coords?: readonly (readonly string[] | null)[];
  /** 一度でも見た部品ID（NEW の印を消すため） */
  readonly seenPartIds?: readonly string[];
}

/** アバターの装いのリポジトリ */
export interface AvatarRepository {
  /** 旅人の装いを読む（未保存なら空の AvatarState） */
  load(travelerId: TravelerId): Promise<Result<AvatarState>>;
  /** 旅人の装いを保存する（上書き） */
  save(travelerId: TravelerId, state: AvatarState): Promise<Result<void>>;
}
