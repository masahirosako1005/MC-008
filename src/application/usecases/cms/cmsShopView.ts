/**
 * @file 店舗CMS のユースケースが共有する部品（application/usecases/cms 層）
 * - 依存の型（スポットはマスタそのもの＝上書き前。上書き分は CmsOverlayRepository から読む）
 * - 店舗の特定（入力の spotId を検証し、店舗だけを返す＝SEC-16）
 * - 上書きの適用（mergeSpotEdit。利用者アプリ側の applyCmsOverlay も同じ関数を使う＝規則を1か所に）
 * - クーポン・イベントの状態（掲載中・掲載予定・終了・取り下げ）と DTO への変換
 * - 登録内容の保存（操作ID による二重登録の防止＝DI-07、版数による楽観ロック＝DI-10）
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseOperationId, parseSpotId } from '@/Common/types/Id';
import type { OperationId, SpotId } from '@/Common/types/Id';
import { compareLocalDate, daysBetween } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { CmsShopEventDto, CmsShopEventStatus, CmsShopInfoDto } from '@/application/dto/CmsDto';
import { CMS_PROCESSED_OPERATION_LIMIT } from '@/application/ports/CmsOverlayRepository';
import type { CmsOverlay, CmsOverlayData, CmsOverlayRepository, CmsShopEventRecord, CmsSpotEdit } from '@/application/ports/CmsOverlayRepository';
import type { SurveyResponseRepository } from '@/application/ports/SurveyResponseRepository';
import type { Clock } from '@/domain/ports/Clock';
import type { IdGenerator } from '@/domain/ports/IdGenerator';
import { SHOP_EVENT_MAX_OPEN_PER_SPOT } from '@/domain/revisit/constants';
import { Period } from '@/domain/revisit/Period';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import { countOpenEvents } from '@/domain/revisit/ShopEventDraft';
import type { HasPeriod } from '@/domain/revisit/ShopEventDraft';
import { parseBusinessHoursText } from '@/domain/spot/BusinessHours';
import type { Spot } from '@/domain/spot/Spot';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/cms/cmsShopView');

/** 店舗CMS のユースケースの依存 */
export interface CmsDeps {
  /** マスタ（上書き前） */
  readonly spots: SpotRepository;
  readonly cmsOverlay: CmsOverlayRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** お店のアンケートの回答（無ければサンプルだけで集計する。連携サーバーにはまだ届かない＝docs/09 CMS-V07） */
  readonly surveys?: SurveyResponseRepository;
}

/** 状態ごとの並び順（掲載中 → 掲載予定 → 終了・取り下げ） */
const STATUS_ORDER: Readonly<Record<CmsShopEventStatus, number>> = { active: 0, scheduled: 1, ended: 2, withdrawn: 2 };

/**
 * 入力の spotId を検証し、店舗（名所ではない）を返す。
 * @param spots マスタ
 * @param raw 入力の spotId
 * @returns 成功: 店舗。失敗: INVALID_INPUT（書式）/ SPOT_NOT_FOUND（無い・名所）
 */
export function findShop(spots: SpotRepository, raw: unknown): Result<Spot> {
  const log = logger.fn('findShop', { spotId: raw });
  const id = parseSpotId(raw);
  if (!id.ok) return log.fail(id);
  const spot = spots.findSpot(id.value);
  if (spot === undefined || spot.kind !== 'shop') return log.fail(fail(AppError.of('SPOT_NOT_FOUND', '店舗が見つかりません', { spotId: id.value })));
  return log.exit(ok(spot));
}

/**
 * スポットに CMS の編集を重ねる（営業時間・便利情報だけを置き換える）。
 * @param spot マスタのスポット
 * @param edit CMS の編集（無ければそのまま）
 * @returns 編集後のスポット（凍結済み）
 */
export function mergeSpotEdit(spot: Spot, edit: CmsSpotEdit | undefined): Spot {
  const log = logger.fn('mergeSpotEdit', { spotId: spot.id, edited: edit !== undefined });
  if (edit === undefined) return log.exit(spot);
  return log.exit(Object.freeze({ ...spot, hours: edit.hours ?? spot.hours, amenities: edit.amenities ?? spot.amenities }));
}

/**
 * スポットの編集を探す。
 * @param overlay 登録内容
 * @param spotId スポットID
 * @returns 編集（無ければ undefined）
 */
export function editOf(overlay: CmsOverlayData, spotId: SpotId): CmsSpotEdit | undefined {
  return overlay.spotEdits.find((e) => e.spotId === spotId);
}

/**
 * まだ終わっていないかを数えるための期間の一覧（マスタ＋CMS の取り下げていないもの）を返す。
 * @param spots マスタ
 * @param overlay 登録内容
 * @param spotId スポットID
 * @returns 期間を持つものの一覧
 */
export function liveEventPeriods(spots: SpotRepository, overlay: CmsOverlayData, spotId: SpotId): readonly HasPeriod[] {
  const log = logger.fn('liveEventPeriods', { spotId });
  const fromCms: HasPeriod[] = [];
  for (const record of overlay.shopEvents) {
    if (record.spotId !== spotId || record.withdrawnOn !== undefined) continue;
    const period = Period.of(record.start, record.end);
    if (period.ok) fromCms.push({ period: period.value });
  }
  return log.exit([...spots.shopEventsForSpot(spotId), ...fromCms]);
}

/**
 * 期間と今日から状態を決める。
 * @param start 開始日
 * @param end 終了日
 * @param today 今日
 * @returns 状態と残り日数・開始までの日数
 */
function statusOf(start: LocalDate, end: LocalDate, today: LocalDate): Pick<CmsShopEventDto, 'status' | 'daysLeft' | 'daysUntilStart'> {
  const log = logger.fn('statusOf', { start, end, today });
  if (compareLocalDate(end, today) < 0) return log.exit({ status: 'ended' });
  if (compareLocalDate(start, today) > 0) return log.exit({ status: 'scheduled', daysUntilStart: daysBetween(today, start) });
  return log.exit({ status: 'active', daysLeft: daysBetween(today, end) });
}

/**
 * マスタのクーポン・イベントを DTO にする（CMS からは取り下げできない）。
 * @param event マスタのクーポン・イベント
 * @param today 今日
 * @returns DTO
 */
function masterEventDto(event: ShopEvent, today: LocalDate): CmsShopEventDto {
  const log = logger.fn('masterEventDto', { id: event.id });
  const base = { id: event.id, kind: event.kind, title: event.title, description: event.description, start: event.period.start, end: event.period.end };
  return log.exit({ ...base, ...statusOf(event.period.start, event.period.end, today), source: 'master', canWithdraw: false });
}

/**
 * CMS で登録したクーポン・イベントを DTO にする。
 * @param record 登録内容
 * @param today 今日
 * @returns DTO（取り下げ済みは status='withdrawn'）
 */
function cmsEventDto(record: CmsShopEventRecord, today: LocalDate): CmsShopEventDto {
  const log = logger.fn('cmsEventDto', { id: record.id, withdrawnOn: record.withdrawnOn });
  const base = { id: record.id, kind: record.kind, title: record.title, description: record.description, start: record.start, end: record.end, source: 'cms' as const };
  if (record.withdrawnOn !== undefined) return log.exit({ ...base, status: 'withdrawn', canWithdraw: false, withdrawnOn: record.withdrawnOn });
  const status = statusOf(record.start, record.end, today);
  return log.exit({ ...base, ...status, canWithdraw: status.status !== 'ended' });
}

/**
 * 一覧の並べ替えの比較（状態順 → 掲載中は残り日数、掲載予定は開始日、終了は終了日の新しい順）。
 * @param a 左
 * @param b 右
 * @returns 負なら a が先
 */
function compareEventDto(a: CmsShopEventDto, b: CmsShopEventDto): number { // audit-ignore: fnlog-missing 並べ替えから要素の組ごとに呼ぶ純粋な比較関数
  const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (byStatus !== 0) return byStatus;
  if (a.status === 'active' || a.status === 'scheduled') return a.end.localeCompare(b.end) || a.start.localeCompare(b.start);
  return b.end.localeCompare(a.end);
}

/**
 * 店舗のクーポン・イベント（マスタ＋CMS）を一覧用の DTO にする。
 * @param spots マスタ
 * @param overlay 登録内容
 * @param spotId スポットID
 * @param today 今日
 * @returns 並べ替え済みの DTO
 */
export function eventsOfShop(spots: SpotRepository, overlay: CmsOverlayData, spotId: SpotId, today: LocalDate): readonly CmsShopEventDto[] {
  const log = logger.fn('eventsOfShop', { spotId, today });
  const fromMaster = spots.shopEventsForSpot(spotId).map((e) => masterEventDto(e, today));
  const fromCms = overlay.shopEvents.filter((r) => r.spotId === spotId).map((r) => cmsEventDto(r, today));
  return log.exit([...fromMaster, ...fromCms].sort(compareEventDto));
}

/**
 * 店舗の情報を DTO にする（編集を重ねた値）。
 * @param deps マスタ
 * @param shop 店舗（マスタの値）
 * @param overlay 登録内容
 * @param today 今日
 * @returns DTO
 */
export function toShopInfoDto(deps: Pick<CmsDeps, 'spots'>, shop: Spot, overlay: CmsOverlayData, today: LocalDate): CmsShopInfoDto {
  const log = logger.fn('toShopInfoDto', { spotId: shop.id, today });
  const edit = editOf(overlay, shop.id);
  const merged = mergeSpotEdit(shop, edit);
  const hours = parseBusinessHoursText(merged.hours);
  const open = countOpenEvents(liveEventPeriods(deps.spots, overlay, shop.id), today);
  return log.exit({
    id: shop.id, name: shop.name, districtId: shop.districtId, districtName: deps.spots.findDistrict(shop.districtId)?.name ?? '', category: shop.category,
    description: shop.description, partner: shop.partner, hoursText: merged.hours,
    ...(hours === undefined ? {} : { hours: { open: hours.open, close: hours.close, closedDays: [...hours.closedDays], note: hours.note } }),
    amenities: [...merged.amenities], edited: edit !== undefined, ...(edit === undefined ? {} : { updatedAt: edit.updatedAt }),
    today, events: eventsOfShop(deps.spots, overlay, shop.id, today), remainingSlots: Math.max(0, SHOP_EVENT_MAX_OPEN_PER_SPOT - open),
  });
}

/** 登録内容の書き換えの入力 */
export interface OverlayWriteInput {
  readonly deps: Pick<CmsDeps, 'cmsOverlay'>;
  /** 書き換える前に読んだ登録内容 */
  readonly overlay: CmsOverlay;
  readonly operationId: OperationId;
  /** 書き換えた中身（操作ID の記録はこの関数が足す） */
  readonly next: Pick<CmsOverlayData, 'spotEdits' | 'shopEvents'>;
}

/**
 * 書き換えた登録内容を保存する（操作ID を記録して二重登録を防ぐ。版数が変わっていたら CONFLICT）。
 * @param input 依存・読んだ登録内容・操作ID・書き換えた中身
 * @returns 成功: 保存後の登録内容。失敗: CONFLICT（別の画面が先に保存した）/ STORAGE_FAILED
 * @sideEffect 登録内容を保存する
 */
export async function writeOverlay(input: OverlayWriteInput): Promise<Result<CmsOverlay>> {
  const log = logger.fn('writeOverlay', { version: input.overlay.version, operationId: input.operationId });
  const processed = [...input.overlay.processedOperationIds, input.operationId].slice(-CMS_PROCESSED_OPERATION_LIMIT);
  const saved = await input.deps.cmsOverlay.save({ ...input.next, processedOperationIds: processed }, input.overlay.version);
  if (saved.ok) return log.exit(ok(saved.value));
  if (saved.error.code === 'CONFLICT') {
    return log.fail(fail(AppError.of('CONFLICT', '別の画面で先に保存されました。読み込み直してからもう一度操作してください')));
  }
  return log.fail(saved);
}

/**
 * 書込み系の入力の操作ID を検証する。
 * @param raw 入力の operationId
 * @returns 成功: 操作ID。失敗: INVALID_INPUT
 */
export function parseCmsOperationId(raw: unknown): Result<OperationId> {
  const log = logger.fn('parseCmsOperationId');
  const id = parseOperationId(raw);
  return id.ok ? log.exit(id) : log.fail(id);
}

/**
 * 登録内容と今日をまとめて読む（各ユースケースの最初の手順）。
 * @param deps 登録内容の保存先と時計
 * @returns 成功: 登録内容と今日。失敗: STORAGE_FAILED
 */
export async function loadOverlayAndToday(deps: Pick<CmsDeps, 'cmsOverlay' | 'clock'>): Promise<Result<{ readonly overlay: CmsOverlay; readonly today: LocalDate }>> {
  const log = logger.fn('loadOverlayAndToday');
  const overlay = await deps.cmsOverlay.load();
  if (!overlay.ok) return log.fail(overlay);
  return log.exit(ok({ overlay: overlay.value, today: deps.clock.today() }));
}
