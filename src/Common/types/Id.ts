/**
 * @file ID 型と境界検証パーサ（Common 層）
 * URL・保存データ・マスタから来た ID は parseXxx(unknown) で正規表現検証してからブランド型にする（SEC-16, DI-01）。
 * 正規表現は docs/08 §2 の契約どおり。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { Brand } from '@/Common/types/Brand';

const logger = createLogger('Common/types/Id');

/** スポットID（l_=名所, s_=店舗） */
export type SpotId = Brand<string, 'SpotId'>;
/** 地区ID */
export type DistrictId = Brand<string, 'DistrictId'>;
/** 旅人ID（本番は 't_' + ハイフンを除いた UUID） */
export type TravelerId = Brand<string, 'TravelerId'>;
/** ライバルID */
export type RivalId = Brand<string, 'RivalId'>;
/** クーポン・イベントID */
export type ShopEventId = Brand<string, 'ShopEventId'>;
/** アイテムID */
export type ItemId = Brand<string, 'ItemId'>;
/** 操作ID（UUID。書込み系の冪等キー＝DI-07） */
export type OperationId = Brand<string, 'OperationId'>;
/** ドメインイベントID */
export type EventId = Brand<string, 'EventId'>;

/** 各 ID の正規表現（docs/08 §2・SEC-16） */
export const ID_PATTERNS = {
  SpotId: /^[ls]_[0-9a-z]{2,16}$/,
  DistrictId: /^d_[0-9a-z]{2,16}$/,
  TravelerId: /^t_[0-9a-z]{2,40}$/,
  RivalId: /^r_[0-9a-z]{2,16}$/,
  ShopEventId: /^c_[0-9a-z]{2,16}$/,
  ItemId: /^i_[0-9a-z]{2,16}$/,
  OperationId: /^[0-9a-f-]{8,64}$/,
  EventId: /^ev_[0-9a-z]{4,64}$/,
} as const;

/** ID の種類名 */
export type IdKind = keyof typeof ID_PATTERNS;

/**
 * 未検証の値を正規表現で検証し、ブランド型にする共通処理。
 * 失敗時の details には種類名と長さだけを入れ、値そのものは入れない（ログ・画面への漏えい防止）。
 * @param raw 未検証の値
 * @param kind ID の種類
 * @returns 成功: ブランド型の ID。失敗: INVALID_INPUT
 */
function parseId<T extends string>(raw: unknown, kind: IdKind): Result<T> {
  const log = logger.fn('parseId', { kind });
  if (typeof raw !== 'string' || !ID_PATTERNS[kind].test(raw)) {
    const length = typeof raw === 'string' ? raw.length : undefined;
    return log.fail(fail(AppError.of('INVALID_INPUT', 'IDの形式が正しくありません', { kind, length })));
  }
  return log.exit(ok(raw as T));
}

/**
 * スポットID を検証する。
 * @param raw 未検証の値
 * @returns 成功: SpotId。失敗: INVALID_INPUT
 */
export function parseSpotId(raw: unknown): Result<SpotId> {
  return parseId<SpotId>(raw, 'SpotId');
}

/**
 * 地区ID を検証する。
 * @param raw 未検証の値
 * @returns 成功: DistrictId。失敗: INVALID_INPUT
 */
export function parseDistrictId(raw: unknown): Result<DistrictId> {
  return parseId<DistrictId>(raw, 'DistrictId');
}

/**
 * 旅人ID を検証する。
 * @param raw 未検証の値
 * @returns 成功: TravelerId。失敗: INVALID_INPUT
 */
export function parseTravelerId(raw: unknown): Result<TravelerId> {
  return parseId<TravelerId>(raw, 'TravelerId');
}

/**
 * ライバルID を検証する。
 * @param raw 未検証の値
 * @returns 成功: RivalId。失敗: INVALID_INPUT
 */
export function parseRivalId(raw: unknown): Result<RivalId> {
  return parseId<RivalId>(raw, 'RivalId');
}

/**
 * クーポン・イベントID を検証する。
 * @param raw 未検証の値
 * @returns 成功: ShopEventId。失敗: INVALID_INPUT
 */
export function parseShopEventId(raw: unknown): Result<ShopEventId> {
  return parseId<ShopEventId>(raw, 'ShopEventId');
}

/**
 * アイテムID を検証する。
 * @param raw 未検証の値
 * @returns 成功: ItemId。失敗: INVALID_INPUT
 */
export function parseItemId(raw: unknown): Result<ItemId> {
  return parseId<ItemId>(raw, 'ItemId');
}

/**
 * 操作ID（UUID）を検証する。
 * @param raw 未検証の値
 * @returns 成功: OperationId。失敗: INVALID_INPUT
 */
export function parseOperationId(raw: unknown): Result<OperationId> {
  return parseId<OperationId>(raw, 'OperationId');
}

/**
 * ドメインイベントID を検証する。
 * @param raw 未検証の値
 * @returns 成功: EventId。失敗: INVALID_INPUT
 */
export function parseEventId(raw: unknown): Result<EventId> {
  return parseId<EventId>(raw, 'EventId');
}

/**
 * UUID（crypto.randomUUID の値）から旅人ID を作る。
 * TravelerId の正規表現はハイフンを許さないため、ハイフンを除き小文字にして 't_' を付ける（D14）。
 * @param uuid UUID 文字列（例: '0f8fad5b-d9cb-469f-a165-70867728950e'）
 * @returns 成功: TravelerId（'t_' + 32桁16進）。失敗: INVALID_INPUT
 */
export function travelerIdFromUuid(uuid: string): Result<TravelerId> {
  return parseTravelerId(`t_${uuid.replace(/-/g, '').toLowerCase()}`);
}

/**
 * スポットID から名所／店舗の別を返す（l_ = 名所, s_ = 店舗）。
 * @param id 検証済みのスポットID
 * @returns 名所なら 'landmark'、店舗なら 'shop'
 */
export function spotKindOfId(id: SpotId): 'landmark' | 'shop' {
  return id.startsWith('l_') ? 'landmark' : 'shop';
}
