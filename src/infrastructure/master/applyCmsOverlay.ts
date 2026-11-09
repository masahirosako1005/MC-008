/**
 * @file 店舗CMS の登録内容をマスタに重ねる（infrastructure/master 層の境界。docs/09 APP-11）
 * 登録内容は「外部データ」として扱い、マスタと同じ parse（parseSpotRecord・parseShopEventRecord・TEXT_LIMITS）で検証してから重ねる（DI-01, SEC-22）。
 * - スポットの編集: 店舗だけ。営業時間・便利情報だけを置き換える（mergeSpotEdit。CMS 画面と同じ関数）
 * - クーポン・イベント: 協力店の店舗だけ。ID はマスタと重ならないこと。取り下げは「前日までに短縮」して配る
 * 検証に落ちたものは捨てて warn を出す（CMS は必須の部品ではない。マスタだけでもアプリは動く＝docs/09 §4.5）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId, SpotId } from '@/Common/types/Id';
import type { CmsOverlayData, CmsShopEventRecord } from '@/application/ports/CmsOverlayRepository';
import { mergeSpotEdit } from '@/application/usecases/cms/cmsShopView';
import { Period } from '@/domain/revisit/Period';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import { periodAfterWithdrawal } from '@/domain/revisit/ShopEventDraft';
import type { Spot } from '@/domain/spot/Spot';
import { parseShopEventRecord, parseSpotRecord } from '@/infrastructure/master/masterRecordParsers';
import type { SpotCatalog } from '@/infrastructure/master/masterValidators';

const logger = createLogger('infrastructure/master/applyCmsOverlay');

/** 重ねた結果 */
export interface OverlaidCatalog {
  readonly catalog: SpotCatalog;
  /** 検証に落ちて捨てた件数 */
  readonly rejected: number;
}

/**
 * スポットを、マスタ JSON と同じ形の生データに戻す（parseSpotRecord に通すため）。
 * @param spot スポット
 * @returns 生データ
 */
function toRawSpot(spot: Spot): Record<string, unknown> {
  return { ...spot, lat: spot.point.lat, lng: spot.point.lng, amenities: [...spot.amenities] };
}

/**
 * スポットの編集を重ねる（店舗だけ。検証に落ちたものは元のまま）。
 * @param spots マスタのスポット
 * @param overlay 登録内容
 * @returns 重ねたスポットと捨てた件数
 */
function overlaySpots(spots: readonly Spot[], overlay: CmsOverlayData): { readonly spots: readonly Spot[]; readonly rejected: number } {
  const log = logger.fn('overlaySpots', { edits: overlay.spotEdits.length });
  const edits = new Map(overlay.spotEdits.map((e) => [e.spotId, e]));
  const known = new Set<SpotId>(spots.map((s) => s.id));
  let rejected = [...edits.keys()].filter((id) => !known.has(id)).length;
  const merged = spots.map((spot) => {
    const edit = edits.get(spot.id);
    if (edit === undefined) return spot;
    const parsed = spot.kind === 'shop' ? parseSpotRecord(toRawSpot(mergeSpotEdit(spot, edit)), spot.kind) : undefined;
    if (parsed?.ok === true) return parsed.value;
    rejected += 1;
    log.warn('店舗CMS の編集を検証できないため使いません', { spotId: spot.id });
    return spot;
  });
  return log.exit({ spots: Object.freeze(merged), rejected });
}

/**
 * CMS で登録したクーポン・イベント1件を、配る形にして検証する。
 * @param record 登録内容
 * @param spotById スポットID → スポット（編集を重ねたもの）
 * @param masterIds マスタのクーポン・イベントの ID
 * @returns 配るクーポン・イベント（配らない・検証に落ちたら undefined と理由）
 */
function toShopEvent(record: CmsShopEventRecord, spotById: ReadonlyMap<SpotId, Spot>, masterIds: ReadonlySet<string>): ShopEvent | 'skip' | 'reject' {
  const log = logger.fn('toShopEvent', { id: record.id, spotId: record.spotId });
  const spot = spotById.get(record.spotId);
  if (spot === undefined || spot.kind !== 'shop' || !spot.partner || masterIds.has(record.id)) return log.exit('reject', 'spotOrId');
  const registered = Period.of(record.start, record.end);
  if (!registered.ok) return log.exit('reject', 'period');
  const period = record.withdrawnOn === undefined ? registered.value : periodAfterWithdrawal(registered.value, record.withdrawnOn);
  if (period === undefined) return log.exit('skip', 'withdrawnBeforeStart');
  const raw = { id: record.id, spotId: record.spotId, kind: record.kind, title: record.title, description: record.description, start: period.start, end: period.end };
  const parsed = parseShopEventRecord(raw, (id): DistrictId | undefined => spotById.get(id)?.districtId);
  return parsed.ok ? log.exit(parsed.value) : log.exit('reject', parsed.error);
}

/**
 * マスタに店舗CMS の登録内容を重ねる。
 * @param catalog 検証済みのマスタ
 * @param overlay 登録内容
 * @returns 重ねたマスタと、検証に落ちて捨てた件数
 */
export function applyCmsOverlay(catalog: SpotCatalog, overlay: CmsOverlayData): OverlaidCatalog {
  const log = logger.fn('applyCmsOverlay', { edits: overlay.spotEdits.length, events: overlay.shopEvents.length });
  const spots = overlaySpots(catalog.spots, overlay);
  const spotById = new Map(spots.spots.map((s) => [s.id, s]));
  const masterIds = new Set<string>(catalog.shopEvents.map((e) => e.id));
  const added: ShopEvent[] = [];
  let rejected = spots.rejected;
  for (const record of overlay.shopEvents) {
    const event = toShopEvent(record, spotById, masterIds);
    if (event === 'reject') {
      rejected += 1;
      log.warn('店舗CMS のクーポン・イベントを検証できないため使いません', { id: record.id });
    } else if (event !== 'skip') {
      added.push(event);
    }
  }
  const merged: SpotCatalog = { ...catalog, spots: spots.spots, shopEvents: Object.freeze([...catalog.shopEvents, ...added]) };
  return log.exit({ catalog: Object.freeze(merged), rejected }, `added=${added.length} rejected=${rejected}`);
}
