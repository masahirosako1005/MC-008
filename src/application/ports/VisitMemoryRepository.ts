/**
 * @file 訪問の思い出（自分の写真とメモ）の保存 IF（application 層のポート）
 * 旅人ごとに、訪問（スポット＋JST 暦日。同じスポットは1日1件＝DI-08）へ付けた写真とメモを保存する。
 * 訪問記録そのもの（旅人集約）は変えない。思い出を消しても訪問・EXP・図鑑は減らない（CLAUDE.md 5）。
 * 写真は画面で縮小・再圧縮した JPEG の data URL（EXIF＝撮影位置は残らない。PRV-03）。数値はすべて（仮）。
 * 実装は infrastructure/storage/LocalStorageVisitMemoryRepository。商用版はサーバーに置く（docs/12）。
 */
import type { Result } from '@/Common/result/Result';
import type { SpotId, TravelerId } from '@/Common/types/Id';
import type { Instant, LocalDate } from '@/Common/utils/date';

/** メモの文字数の上限（仮） */
export const MEMORY_NOTE_MAX = 200;

/** 写真（data URL）の文字数の上限（仮。約 110KB の JPEG） */
export const MEMORY_PHOTO_MAX_CHARS = 150_000;

/** 旅人1人が保存できる写真の枚数の上限（仮。localStorage の容量を訪問記録と分け合うため） */
export const MEMORY_PHOTO_LIMIT = 24;

/** 旅人1人が保存できる思い出の件数の上限（仮） */
export const MEMORY_ENTRY_LIMIT = 500;

/** 保存できる写真の形（JPEG の base64 data URL だけ。ほかの形式・URL は受け付けない＝SEC-14） */
export const MEMORY_PHOTO_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

/** 訪問1回の思い出（メモ・写真のどちらかは必ずある） */
export interface VisitMemory {
  readonly spotId: SpotId;
  /** 訪問した JST 暦日 */
  readonly localDate: LocalDate;
  readonly note?: string;
  /** JPEG の data URL */
  readonly photo?: string;
  readonly updatedAt: Instant;
}

/** 訪問の思い出のリポジトリ */
export interface VisitMemoryRepository {
  /** 旅人の思い出をすべて読む（未保存なら空） */
  list(travelerId: TravelerId): Promise<Result<readonly VisitMemory[]>>;
  /** 旅人の思い出をまとめて保存する（上書き） */
  saveAll(travelerId: TravelerId, memories: readonly VisitMemory[]): Promise<Result<void>>;
}

/**
 * 写真の data URL として保存できる値か判定する（形と大きさ）。
 * @param raw 未検証の値
 * @returns 保存できれば true
 */
export function isMemoryPhoto(raw: unknown): raw is string { // audit-ignore: fnlog-missing 写真の中身をログに出さない純粋な判定（PRV-03）
  return typeof raw === 'string' && raw.length <= MEMORY_PHOTO_MAX_CHARS && MEMORY_PHOTO_PATTERN.test(raw);
}
