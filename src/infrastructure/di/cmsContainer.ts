/**
 * @file 店舗CMS（cms.html）の DI コンテナ（infrastructure/di 層。docs/09 §7.2 フェーズ1）
 * デモビルドだけで使う（MUST-8, SEC-02）。demo 以外では DEMO_DISABLED を返し、何も作らない。
 * 利用者アプリと同じオリジン・同じ保存先（nnishi.demo.*）を使う。
 * - 時計は DemoClock（利用者アプリのデモ日付進行と同じ「今日」になる）
 * - スポットはマスタそのもの（上書き前）。登録内容は LocalStorageCmsOverlayRepository から読む
 */
import { CMS_BACKEND } from '@/Common/constants/env';
import type { CmsBackend } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { CmsServices } from '@/application/CmsServices';
import { createHttpCmsServices } from '@/infrastructure/api/HttpCmsServices';
import type { ApiClientDeps } from '@/infrastructure/api/requestApi';
import { buildCmsUseCases } from '@/infrastructure/di/cmsUseCases';
import { browserFetchText } from '@/infrastructure/master/browserFetchText';
import { MasterDataLoader } from '@/infrastructure/master/MasterDataLoader';
import type { FetchText } from '@/infrastructure/master/MasterDataLoader';
import { CryptoIdGenerator } from '@/infrastructure/random/CryptoIdGenerator';
import type { KeyValueStore } from '@/infrastructure/storage/KeyValueStore';
import { LocalStorageCmsOverlayRepository } from '@/infrastructure/storage/LocalStorageCmsOverlayRepository';
import { LocalStorageKeyValueStore } from '@/infrastructure/storage/LocalStorageKeyValueStore';
import { DemoClock } from '@/infrastructure/time/DemoClock';

const logger = createLogger('infrastructure/di/cmsContainer');

/** デモの保存キー接頭辞（利用者アプリのデモと同じ名前空間＝DI-23） */
const DEMO_PREFIX = 'nnishi.demo.';

/** CMS コンテナの設定 */
export interface CmsContainerOptions {
  /** demo のときだけ作る */
  readonly mode: 'demo' | 'production';
  /** 保存先（省略時は localStorage。テストでメモリを渡す） */
  readonly store?: KeyValueStore;
  /** マスタ JSON の取得関数（省略時は fetch） */
  readonly fetchText?: FetchText;
  /** 実時刻（エポックミリ秒）。テストで固定する */
  readonly nowMs?: () => number;
  /** 登録内容の受け渡し方（省略時は CMS_BACKEND。'server' は連携サーバーの API を呼ぶ＝docs/09 §7.3） */
  readonly backend?: CmsBackend;
  /** 連携サーバーの呼び出し（テストで起点と fetch を渡す） */
  readonly api?: Omit<ApiClientDeps, 'headers'>;
}

/**
 * 店舗CMS のサービス一覧を作る。
 * - 'local'：ユースケースをこのブラウザで動かし、localStorage に保存する（フェーズ1）
 * - 'server'：連携サーバーのユースケースを HTTP で呼ぶ。デモの日付のずらし日数（DemoClock）はヘッダーで伝える
 * @param opts 設定
 * @returns 成功: CmsServices。失敗: DEMO_DISABLED（デモ以外）/ マスタの検証エラー
 */
export async function createCmsContainer(opts: CmsContainerOptions): Promise<Result<CmsServices>> {
  const log = logger.fn('createCmsContainer', { mode: opts.mode, backend: opts.backend ?? CMS_BACKEND });
  if (opts.mode !== 'demo') {
    log.warn('デモ以外で店舗CMS を開こうとしました');
    return log.fail(fail(AppError.of('DEMO_DISABLED', '店舗CMS はデモ版だけで使えます')));
  }
  const store = opts.store ?? new LocalStorageKeyValueStore();
  const clock = new DemoClock({ store, nowMs: opts.nowMs });
  if ((opts.backend ?? CMS_BACKEND) === 'server') return log.exit(ok(createHttpCmsServices({ ...opts.api, demoOffsetDays: () => clock.offsetDays() })));
  const master = await MasterDataLoader.load(opts.fetchText ?? browserFetchText);
  if (!master.ok) return log.fail(master);
  const cmsOverlay = new LocalStorageCmsOverlayRepository({ store, prefix: DEMO_PREFIX });
  return log.exit(ok(buildCmsUseCases({ spots: master.value.spots, cmsOverlay, clock, ids: new CryptoIdGenerator() })));
}
