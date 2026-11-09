/**
 * @file スポットの写真の引き当て（presentation/shared 層）
 * 2026-11-09 ユーザー指示「イラスト風ではなく、場所がしっかり思い出せるリアル写真風に」で、図鑑とスポット詳細に写真を出す。
 * - 名所: 実在の場所の写真（Wikimedia Commons のライセンス付き写真を public/photos/landmarks に同梱）
 * - 店舗: 店名は架空なので、カテゴリ別の「イメージ写真」（public/photos/shops）。その店の写真ではないことを「イメージ」と明記する
 * 写真の一覧（ファイル・作者・ライセンス・出典）は spotPhotoData.ts（scripts/photos/fetch-photos.mjs が生成）。
 * 本番では店舗CMS で登録した写真に置き換える予定（docs/09 CMS-S08・APP-09）。写真が無い・読めないときは今の街なみイラストを出す。
 * 画像は同一オリジンから読む（CSP img-src 'self'）。
 */
import type { SpotKindDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { CATEGORY_PHOTO_DATA, LANDMARK_PHOTO_DATA } from '@/presentation/shared/spotPhotoData';
import type { PhotoRecord } from '@/presentation/shared/spotPhotoData';

const logger = createLogger('presentation/shared/spotPhotos');

/** 画面に出す写真 */
export interface SpotPhoto {
  /** 画像の URL（BASE_URL からの相対を解決済み） */
  readonly src: string;
  /** 作者（Wikimedia Commons の表記） */
  readonly artist: string;
  /** ライセンスの略称（'CC BY-SA 4.0' など） */
  readonly license: string;
  /** 出典ページ（Wikimedia Commons のファイルページ） */
  readonly sourceUrl: string;
  /** その店の写真ではなく、カテゴリのイメージ写真か（店舗は常に true） */
  readonly isImage: boolean;
}

/** 写真を引くためのスポットの情報（図鑑のタイル・スポット詳細の DTO のどちらでもよい） */
export interface PhotoSubject {
  readonly id?: string;
  readonly kind: SpotKindDto;
  readonly category?: string;
}

/**
 * 記録から画面に出す写真を作る。
 * @param record 写真の記録
 * @param isImage イメージ写真か
 * @returns 写真
 */
function toPhoto(record: PhotoRecord, isImage: boolean): SpotPhoto {
  const log = logger.fn('toPhoto', { file: record.file, isImage });
  return log.exit(Object.freeze({ src: `${import.meta.env.BASE_URL}photos/${record.file}`, artist: record.artist, license: record.license, sourceUrl: record.sourceUrl, isImage }));
}

/**
 * スポットの写真を引く（名所は ID、店舗はカテゴリで引く）。
 * @param subject スポットの ID・種別・カテゴリ
 * @returns 写真。無ければ undefined（イラストを出す）
 */
export function spotPhotoOf(subject: PhotoSubject): SpotPhoto | undefined {
  const log = logger.fn('spotPhotoOf', { id: subject.id, kind: subject.kind, category: subject.category });
  if (subject.kind === 'landmark') {
    const record = subject.id === undefined ? undefined : LANDMARK_PHOTO_DATA[subject.id];
    return log.exit(record === undefined ? undefined : toPhoto(record, false));
  }
  const record = subject.category === undefined ? undefined : CATEGORY_PHOTO_DATA[subject.category];
  return log.exit(record === undefined ? undefined : toPhoto(record, true));
}

/**
 * 写真のクレジットの文言（作者・ライセンス・出典元）。
 * @param photo 写真
 * @returns 'イメージ写真: 作者 / CC BY-SA 4.0（Wikimedia Commons）' など
 */
export function photoCreditText(photo: SpotPhoto): string {
  const log = logger.fn('photoCreditText', { license: photo.license });
  return log.exit(`${photo.isImage ? 'イメージ写真' : '写真'}: ${photo.artist} / ${photo.license}（Wikimedia Commons）`);
}
