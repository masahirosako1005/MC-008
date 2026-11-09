/**
 * @file 店舗CMS の登録内容を、連携サーバーの公開スナップショットから利用者アプリへ反映する（infrastructure/di 層。docs/09 §7.3）
 * container.ts の buildCmsReflection が、VITE_CMS_BACKEND=server のときにこちらを使う（既定は同じブラウザの localStorage）。
 * - 起動時：サーバー → 前回の写し → マスタだけ、の順で決めて重ねる
 * - 起動後：新しい版が届いたら、スポットの参照を丸ごと差し替え、登録された関数に知らせる（画面はトーストを出して作り直す）
 * 重ねる処理は applyCmsOverlay（マスタと同じ parse・協力店だけ）。サーバーで確かめた内容も、ここでもう一度確かめる（APP-05）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import { CmsSnapshotSync } from '@/infrastructure/api/CmsSnapshotSync';
import type { SnapshotStreamSource } from '@/infrastructure/api/CmsSnapshotSync';
import type { ApiClientDeps } from '@/infrastructure/api/requestApi';
import { overlayDataOf } from '@/infrastructure/api/schema/publicCmsSnapshot';
import type { PublicCmsSnapshot } from '@/infrastructure/api/schema/publicCmsSnapshot';
import { applyCmsOverlay } from '@/infrastructure/master/applyCmsOverlay';
import type { SpotCatalog } from '@/infrastructure/master/masterValidators';
import { RefreshableSpotRepository } from '@/infrastructure/master/RefreshableSpotRepository';
import type { KeyValueStore } from '@/infrastructure/storage/KeyValueStore';
import { CMS_SNAPSHOT_KEY } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/di/cmsServerReflection');

/** 連携サーバーからの反映の依存 */
export interface ServerCmsReflectionDeps {
  /** 検証済みのマスタ */
  readonly catalog: SpotCatalog;
  /** 前回の写しの保存先 */
  readonly store: KeyValueStore;
  /** 保存キーの接頭辞（デモ 'nnishi.demo.'） */
  readonly prefix: string;
  /** サーバーの呼び出し（省略時は同じオリジンの fetch。テストで起点と fetch を渡す） */
  readonly api?: ApiClientDeps;
  /** SSE を開く関数（省略時は EventSource） */
  readonly openStream?: (url: string) => SnapshotStreamSource | undefined;
  /** 起動後も見張るか（省略時はブラウザのときだけ） */
  readonly live?: boolean;
}

/** 反映の結果（container.ts の CmsReflection と同じ形） */
export interface ServerCmsReflection {
  readonly spots: SpotRepository;
  readonly onCatalogChanged: (listener: () => void) => () => void;
}

/**
 * マスタに公開スナップショットを重ねる。
 * @param catalog 検証済みのマスタ
 * @param snapshot 公開スナップショット（無ければマスタのまま）
 * @returns 重ねたマスタ
 */
function overlaid(catalog: SpotCatalog, snapshot: PublicCmsSnapshot | undefined): SpotCatalog {
  const log = logger.fn('overlaid', { version: snapshot?.version });
  if (snapshot === undefined) return log.exit(catalog, 'masterOnly');
  const result = applyCmsOverlay(catalog, overlayDataOf(snapshot));
  if (result.rejected > 0) log.warn('お店の情報の一部を検証できないため使いません', { version: snapshot.version, rejected: result.rejected });
  return log.exit(result.catalog);
}

/**
 * 連携サーバーの公開スナップショットを重ねたスポットの参照を作り、新しい版を見張る。
 * @param deps マスタ・写しの保存先・サーバーの呼び出し
 * @returns スポットの参照と、差し替えの通知の登録関数
 * @sideEffect ネットワーク・localStorage。live なら SSE・タイマー・visibilitychange を登録する
 */
export async function buildServerCmsReflection(deps: ServerCmsReflectionDeps): Promise<ServerCmsReflection> {
  const log = logger.fn('buildServerCmsReflection', { prefix: deps.prefix });
  const sync = new CmsSnapshotSync({
    api: deps.api ?? {}, store: deps.store, cacheKey: `${deps.prefix}${CMS_SNAPSHOT_KEY}`, ...(deps.openStream === undefined ? {} : { openStream: deps.openStream }),
  });
  const spots = new RefreshableSpotRepository(overlaid(deps.catalog, await sync.initial()));
  const listeners = new Set<() => void>();
  if (deps.live ?? typeof window !== 'undefined') {
    sync.watch((snapshot) => {
      spots.replace(overlaid(deps.catalog, snapshot));
      log.info('連携サーバーからお店の情報を反映しました', { version: snapshot.version, listeners: listeners.size });
      for (const listener of listeners) listener();
    });
  }
  return log.exit({
    spots,
    onCatalogChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
