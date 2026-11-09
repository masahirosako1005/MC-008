/**
 * @file 公開スナップショット（CMS → 利用者アプリへ配る公開データ）の形と検証（infrastructure/api/schema 層。docs/09 APP-01・APP-02）
 * サーバーが作り、利用者アプリが読む。中身は「スポットの編集」と「配るクーポン・イベント」だけで、
 * 処理済みの操作ID・変更履歴など CMS の内部の値は含めない。
 * 1件ずつの検証は、LocalStorage の保存データと同じ parseCmsSpotEdit・parseCmsShopEventRecord を使う（規則を1か所に＝DI-01）。
 * 利用者アプリは、ここで検証したうえで applyCmsOverlay（マスタと同じ parse・協力店だけ）にもう一度かける（APP-05）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseInstant } from '@/Common/utils/date';
import type { Instant } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import type { CmsOverlayData, CmsShopEventRecord, CmsSpotEdit } from '@/application/ports/CmsOverlayRepository';
import { CMS_OVERLAY_MAX_RECORDS, parseCmsShopEventRecord, parseCmsSpotEdit } from '@/infrastructure/storage/schema/cmsOverlayParser';

const logger = createLogger('infrastructure/api/schema/publicCmsSnapshot');

/** 公開スナップショットの形の版（形を変えたら上げる） */
export const PUBLIC_CMS_SNAPSHOT_SCHEMA_VERSION = 1;

/** どの版かを見分ける印（SSE でも送る） */
export interface SnapshotMarker {
  /** サーバーの DB ごとの ID（DB を作り直すと変わる。版番号が 0 から数え直しになっても見分けられる） */
  readonly dbId: string;
  /** 版番号（CMS で保存するたびに増える。0 は未保存） */
  readonly version: number;
}

/** 公開スナップショット */
export interface PublicCmsSnapshot extends SnapshotMarker {
  readonly schemaVersion: typeof PUBLIC_CMS_SNAPSHOT_SCHEMA_VERSION;
  /** この版を保存した日時（未保存なら無い） */
  readonly publishedAt?: Instant;
  readonly spotEdits: readonly CmsSpotEdit[];
  readonly shopEvents: readonly CmsShopEventRecord[];
}

/**
 * 形が不正なときの失敗を作る。
 * @param rule 破った規則名
 * @returns INVALID_INPUT の失敗
 */
function invalid(rule: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', 'お店の情報の配信データが正しくありません', { kind: 'PublicCmsSnapshot', rule }));
}

/**
 * 配列の各要素を検証する（1つでも不正なら失敗）。
 * @param raw 未検証の値
 * @param parse 1件の検証
 * @returns 成功: 凍結済みの配列。失敗: INVALID_INPUT
 */
function parseRecords<T>(raw: unknown, parse: (item: unknown) => Result<T>): Result<readonly T[]> {
  const log = logger.fn('parseRecords');
  if (!Array.isArray(raw) || raw.length > CMS_OVERLAY_MAX_RECORDS) return log.fail(invalid('list'));
  const out: T[] = [];
  for (const item of raw as readonly unknown[]) {
    const one = parse(item);
    if (!one.ok) return log.fail(one);
    out.push(one.value);
  }
  return log.exit(ok(Object.freeze(out)));
}

/** DB ごとの ID の書式 */
const DB_ID_PATTERN = /^[0-9a-z]{4,32}$/;

/**
 * 版番号を検証する。
 * @param raw 未検証の値
 * @returns 0 以上の安全な整数なら true
 */
export function isSnapshotVersion(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0;
}

/**
 * DB ごとの ID を検証する。
 * @param raw 未検証の値
 * @returns 英数字4〜32字なら true
 */
export function isSnapshotDbId(raw: unknown): raw is string {
  return typeof raw === 'string' && DB_ID_PATTERN.test(raw);
}

/**
 * 印を、比べるための1つの文字列にする。
 * @param marker DB の ID と版番号
 * @returns 例 '3f2a9c0d1e4b:7'
 */
export function markerKeyOf(marker: SnapshotMarker): string {
  return `${marker.dbId}:${marker.version}`;
}

/**
 * 印から ETag を作る（サーバーが使う）。
 * @param marker DB の ID と版番号
 * @returns 例 '"cms-3f2a9c0d1e4b-7"'
 */
export function snapshotEtagOf(marker: SnapshotMarker): string {
  return `"cms-${marker.dbId}-${marker.version}"`;
}

/**
 * 受け取った JSON を公開スナップショットにする。
 * @param raw JSON.parse の結果
 * @returns 成功: 公開スナップショット（凍結済み）。失敗: INVALID_INPUT
 */
export function parsePublicCmsSnapshot(raw: unknown): Result<PublicCmsSnapshot> {
  const log = logger.fn('parsePublicCmsSnapshot');
  if (!isRecord(raw) || raw['schemaVersion'] !== PUBLIC_CMS_SNAPSHOT_SCHEMA_VERSION) return log.fail(invalid('schemaVersion'));
  const { version, dbId } = raw;
  if (!isSnapshotVersion(version) || !isSnapshotDbId(dbId)) return log.fail(invalid('version'));
  const publishedAt = raw['publishedAt'] === undefined ? undefined : parseInstant(raw['publishedAt']);
  if (publishedAt !== undefined && !publishedAt.ok) return log.fail(invalid('publishedAt'));
  const spotEdits = parseRecords(raw['spotEdits'], parseCmsSpotEdit);
  if (!spotEdits.ok) return log.fail(spotEdits);
  const shopEvents = parseRecords(raw['shopEvents'], parseCmsShopEventRecord);
  if (!shopEvents.ok) return log.fail(shopEvents);
  const snapshot: PublicCmsSnapshot = {
    schemaVersion: PUBLIC_CMS_SNAPSHOT_SCHEMA_VERSION, dbId, version, spotEdits: spotEdits.value, shopEvents: shopEvents.value,
    ...(publishedAt === undefined ? {} : { publishedAt: publishedAt.value }),
  };
  return log.exit(ok(Object.freeze(snapshot)), `version=${version}`);
}

/**
 * 公開スナップショットを、applyCmsOverlay に渡せる登録内容の形にする。
 * @param snapshot 公開スナップショット
 * @returns 登録内容（処理済みの操作ID は空）
 */
export function overlayDataOf(snapshot: PublicCmsSnapshot): CmsOverlayData {
  return { spotEdits: snapshot.spotEdits, shopEvents: snapshot.shopEvents, processedOperationIds: [] };
}
