/**
 * @file 店舗CMS の登録内容（マスタへの上書き分）の保存先ポート（application 層）
 * フェーズ1（デモ）は LocalStorage（P+'cms.overlay'＝nnishi.demo.cms.overlay）、本番は REST に差し替える（docs/09 §7）。
 * 中身は「スポットの編集（営業時間・便利情報）」と「CMS で登録したクーポン・イベント」。利用者アプリはこれを
 * マスタと同じ検証にかけてから重ねる（docs/09 APP-11）。
 */
import type { AppError, Result } from '@/Common/result/Result';
import type { OperationId, ShopEventId, SpotId } from '@/Common/types/Id';
import type { Instant, LocalDate } from '@/Common/utils/date';
import type { ShopEventKind } from '@/domain/revisit/ShopEvent';
import type { Amenity } from '@/domain/spot/Amenity';

/** スポットの編集（店舗が変えた項目だけを持つ） */
export interface CmsSpotEdit {
  readonly spotId: SpotId;
  /** 営業時間の表示用文字列（例 '9:30–19:00（木休）'） */
  readonly hours?: string;
  /** 便利情報（全体を置き換える） */
  readonly amenities?: readonly Amenity[];
  readonly updatedAt: Instant;
}

/** CMS で登録したクーポン・イベント */
export interface CmsShopEventRecord {
  readonly id: ShopEventId;
  readonly spotId: SpotId;
  readonly kind: ShopEventKind;
  readonly title: string;
  readonly description: string;
  readonly start: LocalDate;
  readonly end: LocalDate;
  readonly createdAt: Instant;
  /** 取り下げた日（取り下げていなければ undefined） */
  readonly withdrawnOn?: LocalDate;
}

/** 登録内容の中身 */
export interface CmsOverlayData {
  readonly spotEdits: readonly CmsSpotEdit[];
  readonly shopEvents: readonly CmsShopEventRecord[];
  /** 処理済みの操作ID（二重登録を防ぐ＝DI-07。直近 CMS_PROCESSED_OPERATION_LIMIT 件） */
  readonly processedOperationIds: readonly OperationId[];
}

/** 版数つきの登録内容 */
export interface CmsOverlay extends CmsOverlayData {
  /** 保存の版数（未保存は 0。楽観ロック＝DI-10） */
  readonly version: number;
}

/** 処理済みの操作ID を何件まで覚えておくか */
export const CMS_PROCESSED_OPERATION_LIMIT = 200;

/** 空の登録内容 */
export const EMPTY_CMS_OVERLAY: CmsOverlay = Object.freeze({
  version: 0,
  spotEdits: Object.freeze([]),
  shopEvents: Object.freeze([]),
  processedOperationIds: Object.freeze([]),
});

/** 登録内容の保存先 */
export interface CmsOverlayRepository {
  /**
   * 登録内容を読む。
   * @returns 成功: 登録内容（未保存なら EMPTY_CMS_OVERLAY）。失敗: STORAGE_FAILED
   */
  load(): Promise<Result<CmsOverlay>>;
  /**
   * 登録内容を保存する（読んだときの版数と違えば CONFLICT）。
   * @param data 保存する中身
   * @param expectedVersion 読んだときの版数
   * @returns 成功: 保存後の登録内容（版数+1）。失敗: CONFLICT / STORAGE_FAILED
   */
  save(data: CmsOverlayData, expectedVersion: number): Promise<Result<CmsOverlay, AppError<'CONFLICT' | 'STORAGE_FAILED'>>>;
  /**
   * 登録内容をすべて消す（デモのやり直し用）。
   * @returns 成功: void。失敗: STORAGE_FAILED
   */
  clear(): Promise<Result<void>>;
}
