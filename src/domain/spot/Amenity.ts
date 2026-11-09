/**
 * @file 便利情報（Amenity）の値（domain/spot 層）
 * 初回でも困らないためのフィルタ（CLAUDE.md 4.7、基準 A）。表示ラベルは presentation/shared/labels.ts が持つ。
 */

/** 便利情報の一覧（子連れ歓迎／トイレ／授乳室／ベビーカーOK／雨の日OK／駐車場） */
export const AMENITIES = ['kids', 'toilet', 'nursing', 'stroller', 'rainOk', 'parking'] as const;

/** 便利情報 */
export type Amenity = (typeof AMENITIES)[number];

/**
 * 未検証の値が便利情報か判定する型ガード（マスタ・URL 検証用）。
 * @param value 判定する値
 * @returns AMENITIES のいずれかなら true
 */
export function isAmenity(value: unknown): value is Amenity {
  return typeof value === 'string' && (AMENITIES as readonly string[]).includes(value);
}
