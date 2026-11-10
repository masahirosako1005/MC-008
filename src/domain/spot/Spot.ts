/**
 * @file スポット（名所・店舗）の型（domain/spot 層）
 * マスタデータ。読込後は不変で、必ず1つの地区に属する（docs/01 §2）。検証は infrastructure/master の境界で行う。
 */
import type { DistrictId, SpotId } from '@/Common/types/Id';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { Amenity } from '@/domain/spot/Amenity';

/** スポットの種別（名所／店舗） */
export const SPOT_KINDS = ['landmark', 'shop'] as const;

/** スポットの種別 */
export type SpotKind = (typeof SPOT_KINDS)[number];

/** スポット（名所と店舗の総称。CLAUDE.md 11 の用語） */
export interface Spot {
  readonly id: SpotId;
  readonly kind: SpotKind;
  readonly districtId: DistrictId;
  readonly name: string;
  readonly point: GeoPoint;
  readonly category: string;
  readonly description: string;
  readonly amenities: readonly Amenity[];
  readonly hours: string;
  /** 店舗協力あり（QR・クーポン） */
  readonly partner: boolean;
}
