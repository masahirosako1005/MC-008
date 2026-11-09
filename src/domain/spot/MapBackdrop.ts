/**
 * @file 地図の背景データ（川・公園・道路・線路・駅）と便利施設ポイント（公衆トイレ等）の型（domain/spot 層）
 * 南森町周辺の実在の地理（OpenStreetMap 由来、© OpenStreetMap contributors）を描くためのマスタ。ゲームの進捗には関わらない（訪問・発見の対象外）。
 * 2026-11-09、舞台を架空の N西市から大阪・南森町周辺へ変更したときに追加（docs/08 §9）。
 */
import type { GeoPoint } from '@/domain/exploration/GeoPoint';

/** 背景地物の種類（water=川、park=公園、shrine=神社境内、campus=敷地、arcade=商店街アーケード、road=道路、rail=鉄道） */
export const MAP_FEATURE_KINDS = ['water', 'park', 'shrine', 'campus', 'arcade', 'road', 'rail'] as const;
export type MapFeatureKind = (typeof MAP_FEATURE_KINDS)[number];

/** 背景地物。shape=line は points を折れ線（widthM の太さ）、area は多角形として描く */
export interface MapFeature {
  /** ^f_[0-9a-z_]{2,24}$ */
  readonly id: string;
  readonly kind: MapFeatureKind;
  readonly name: string;
  readonly shape: 'line' | 'area';
  readonly points: readonly GeoPoint[];
  /** line の太さ（メートル） */
  readonly widthM?: number;
}

/** 駅（地下駅も含む。位置は出入口付近） */
export interface Station {
  /** ^st_[0-9a-z_]{2,24}$ */
  readonly id: string;
  readonly name: string;
  readonly point: GeoPoint;
  /** 路線名（表示用） */
  readonly lines: string;
}

/** 便利施設ポイントの種類（toilet=公衆トイレ、nursing=授乳室、aed=AED） */
export const AMENITY_POINT_KINDS = ['toilet', 'nursing', 'aed'] as const;
export type AmenityPointKind = (typeof AMENITY_POINT_KINDS)[number];

/** 便利施設ポイント（スポットではない。図鑑・訪問の対象外。初回の「困らない」＝基準A のための情報） */
export interface AmenityPoint {
  /** ^a_[0-9a-z_]{2,24}$ */
  readonly id: string;
  readonly kind: AmenityPointKind;
  readonly name: string;
  readonly point: GeoPoint;
  /** 補足（例: 扇町公園内） */
  readonly note: string;
}

/** 地図の背景一式 */
export interface MapBackdrop {
  readonly features: readonly MapFeature[];
  readonly stations: readonly Station[];
  readonly amenityPoints: readonly AmenityPoint[];
  /** 出典表示（例: '© OpenStreetMap contributors'） */
  readonly attribution?: string;
}

/** 背景データが無いときの値（テスト用カタログなど） */
export const EMPTY_BACKDROP: MapBackdrop = Object.freeze({ features: [], stations: [], amenityPoints: [] });
