/**
 * @file 公開スナップショットを作る（infrastructure/server 層。docs/09 APP-01・§6.3）
 * 登録内容のうち、利用者アプリへ配るものだけを選ぶ純粋関数。
 * - スポットの編集：そのまま配る
 * - クーポン・イベント：開始日より前に取り下げたものは配らない。期間中に取り下げたものは withdrawnOn つきで配り、
 *   アプリ側の applyCmsOverlay が「取り下げた日の前日まで」に短縮する（期間中に訪れた人の提灯アイテムを消さない＝CMS-E08）
 * - 処理済みの操作ID は配らない（CMS の内部の値）
 */
import { createLogger } from '@/Common/logging/logger';
import type { Instant } from '@/Common/utils/date';
import type { CmsOverlay, CmsShopEventRecord } from '@/application/ports/CmsOverlayRepository';
import { Period } from '@/domain/revisit/Period';
import { periodAfterWithdrawal } from '@/domain/revisit/ShopEventDraft';
import { PUBLIC_CMS_SNAPSHOT_SCHEMA_VERSION } from '@/infrastructure/api/schema/publicCmsSnapshot';
import type { PublicCmsSnapshot } from '@/infrastructure/api/schema/publicCmsSnapshot';

const logger = createLogger('infrastructure/server/buildPublicCmsSnapshot');

/**
 * クーポン・イベントを配るか決める。
 * @param record 登録内容
 * @returns 配るなら true（開始日より前に取り下げたもの・期間が壊れているものは false）
 */
function isDistributed(record: CmsShopEventRecord): boolean {
  const log = logger.fn('isDistributed', { id: record.id });
  const period = Period.of(record.start, record.end);
  if (!period.ok) return log.exit(false, 'period');
  return log.exit(record.withdrawnOn === undefined || periodAfterWithdrawal(period.value, record.withdrawnOn) !== undefined);
}

/**
 * 登録内容から公開スナップショットを作る。
 * @param overlay 登録内容（版数つき）
 * @param source DB の ID と、この版を保存した日時（未保存なら savedAt は無い）
 * @returns 公開スナップショット（凍結済み）
 */
export function buildPublicCmsSnapshot(overlay: CmsOverlay, source: { readonly dbId: string; readonly savedAt?: Instant }): PublicCmsSnapshot {
  const log = logger.fn('buildPublicCmsSnapshot', { version: overlay.version });
  const shopEvents = overlay.shopEvents.filter(isDistributed);
  const snapshot: PublicCmsSnapshot = {
    schemaVersion: PUBLIC_CMS_SNAPSHOT_SCHEMA_VERSION, dbId: source.dbId, version: overlay.version, spotEdits: overlay.spotEdits, shopEvents,
    ...(source.savedAt === undefined ? {} : { publishedAt: source.savedAt }),
  };
  return log.exit(Object.freeze(snapshot), `events=${shopEvents.length}/${overlay.shopEvents.length}`);
}
