/**
 * @file 連携サーバーの DI コンテナ（infrastructure/di 層。docs/09 §7.3）
 * マスタを利用者アプリと同じ MasterDataLoader で読み、SQLite を開き、API の一覧と要求ハンドラを組み立てる。
 * - 公開の API（スナップショット・SSE）：どの版でも登録する
 * - 店舗CMS の API（書込系）：mode が 'demo' のときだけ登録する（ログインが無いので本番では出さない＝MUST-8、SEC-02、SEC-03）
 * CMS のユースケースは 1回の要求ごとに作る（デモの日付のずらし日数を、その要求の時計に入れるため）。
 */
import type { RequestListener } from 'node:http';
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { CmsServices } from '@/application/CmsServices';
import { buildCmsUseCases } from '@/infrastructure/di/cmsUseCases';
import { MasterDataLoader } from '@/infrastructure/master/MasterDataLoader';
import type { FetchText } from '@/infrastructure/master/MasterDataLoader';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import type { PublicCmsSnapshot } from '@/infrastructure/api/schema/publicCmsSnapshot';
import { CryptoIdGenerator } from '@/infrastructure/random/CryptoIdGenerator';
import { buildPublicCmsSnapshot } from '@/infrastructure/server/buildPublicCmsSnapshot';
import { cmsRoutes } from '@/infrastructure/server/http/cmsRoutes';
import { createApiHandler } from '@/infrastructure/server/http/createApiHandler';
import { FixedWindowRateLimiter } from '@/infrastructure/server/http/FixedWindowRateLimiter';
import type { RateLimitOptions } from '@/infrastructure/server/http/FixedWindowRateLimiter';
import { publicRoutes } from '@/infrastructure/server/http/publicRoutes';
import { SnapshotStream } from '@/infrastructure/server/http/SnapshotStream';
import { createStaticHandler } from '@/infrastructure/server/http/staticFiles';
import { CmsDatabase } from '@/infrastructure/server/sqlite/CmsDatabase';
import { SqliteCmsOverlayRepository } from '@/infrastructure/server/sqlite/SqliteCmsOverlayRepository';
import { OffsetClock } from '@/infrastructure/time/OffsetClock';

const logger = createLogger('infrastructure/di/serverContainer');

/** 変更履歴に残す操作者（ログインが無いデモの間） */
const DEMO_ACTOR = 'demo';
/** SSE を同時につなげる数（全体・1つの相手ごと）・空のコメントの間隔 */
const STREAM_OPTIONS = { maxClients: 200, maxPerClient: 10, heartbeatMs: 25_000 } as const;
/** 書込系の回数制限（1つの相手につき1分に120回） */
const WRITE_LIMIT: RateLimitOptions = { limit: 120, windowMs: 60_000 };

/** 連携サーバーの設定 */
export interface ServerAppOptions {
  /** demo: 店舗CMS の API を出す／production: 公開の API だけ */
  readonly mode: 'demo' | 'production';
  /** SQLite のファイル（':memory:' でメモリ上） */
  readonly dbPath: string;
  /** マスタの読み方（nodeFetchText('public/master') など） */
  readonly fetchText: FetchText;
  /** 画面のフォルダ（指定すると画面も配る） */
  readonly staticDir?: string;
  /** 実時刻（エポックミリ秒）。テストで固定する */
  readonly nowMs?: () => number;
  /** 書込系の回数制限（テストで変える） */
  readonly writeLimit?: RateLimitOptions;
}

/** 組み立てた連携サーバー */
export interface ServerApp {
  readonly handler: RequestListener;
  readonly db: CmsDatabase;
  /** SSE を閉じ、DB を閉じる */
  close(): void;
}

/** 部品一式 */
interface ServerParts {
  readonly opts: ServerAppOptions;
  readonly spots: SpotRepository;
  readonly db: CmsDatabase;
  readonly stream: SnapshotStream;
}

/**
 * 1回の要求ごとの保存先を作る。
 * @param parts 部品一式
 * @returns SQLite のリポジトリ
 */
function repositoryOf(parts: ServerParts): SqliteCmsOverlayRepository {
  return new SqliteCmsOverlayRepository({ db: parts.db, actor: DEMO_ACTOR, clock: new OffsetClock({ offsetDays: 0, ...(parts.opts.nowMs ? { nowMs: parts.opts.nowMs } : {}) }) });
}

/**
 * 今の公開スナップショットを作る。
 * @param parts 部品一式
 * @returns 成功: 公開スナップショット。失敗: STORAGE_FAILED
 */
async function currentSnapshot(parts: ServerParts): Promise<Result<PublicCmsSnapshot>> {
  const log = logger.fn('currentSnapshot');
  const loaded = await repositoryOf(parts).load();
  if (!loaded.ok) return log.fail(loaded);
  const state = parts.db.tryReadState();
  if (!state.ok) return log.fail(state);
  return log.exit(ok(buildPublicCmsSnapshot(loaded.value, state.value)));
}


/**
 * デモの日付のずらし日数に合わせたユースケース一式を作る。
 * @param parts 部品一式
 * @param offsetDays ずらし日数
 * @returns CmsServices
 */
function cmsServicesFor(parts: ServerParts, offsetDays: number): CmsServices {
  const log = logger.fn('cmsServicesFor', { offsetDays });
  const clock = new OffsetClock({ offsetDays, ...(parts.opts.nowMs ? { nowMs: parts.opts.nowMs } : {}) });
  return log.exit(buildCmsUseCases({ spots: parts.spots, cmsOverlay: repositoryOf(parts), clock, ids: new CryptoIdGenerator() }));
}

/**
 * 要求ハンドラを組み立てる。
 * @param parts 部品一式
 * @returns 要求ハンドラ
 */
function buildHandler(parts: ServerParts): RequestListener {
  const log = logger.fn('buildHandler', { mode: parts.opts.mode });
  // 店舗CMS の API（書込系）はデモだけ。import.meta.env をこの式に直接書くので、本番ビルド（--mode demo なし）では
  // 条件が定数 false に畳み込まれ、CMS の API とユースケースがサーバーのビルドから処理ごと消える（MUST-8、SEC-02。
  // 関数に包むと呼び出し側まで畳み込まれないので包まない）。テスト（PROD=false）では opts.mode で決める
  const routes = [
    ...publicRoutes({ mode: parts.opts.mode, snapshot: () => currentSnapshot(parts), currentMarker: () => parts.db.tryReadState(), stream: parts.stream }),
    ...(!(import.meta.env.PROD && import.meta.env.MODE !== 'demo') && parts.opts.mode === 'demo' ? cmsRoutes({ servicesFor: (days) => cmsServicesFor(parts, days) }) : []),
  ];
  return log.exit(createApiHandler({
    routes,
    writeLimiter: new FixedWindowRateLimiter({ ...(parts.opts.writeLimit ?? WRITE_LIMIT), ...(parts.opts.nowMs ? { nowMs: parts.opts.nowMs } : {}) }),
    ...(parts.opts.staticDir === undefined ? {} : { staticHandler: createStaticHandler(parts.opts.staticDir) }),
  }));
}

/**
 * 連携サーバーを組み立てる。
 * @param opts 設定
 * @returns 成功: 要求ハンドラと後始末。失敗: マスタの検証エラー / STORAGE_FAILED
 * @sideEffect DB のファイルを開く（無ければ作る）
 */
export async function createServerApp(opts: ServerAppOptions): Promise<Result<ServerApp>> {
  const log = logger.fn('createServerApp', { mode: opts.mode, static: opts.staticDir !== undefined });
  const master = await MasterDataLoader.load(opts.fetchText);
  if (!master.ok) return log.fail(master);
  const db = CmsDatabase.open(opts.dbPath);
  if (!db.ok) return log.fail(db);
  const parts: ServerParts = { opts, spots: master.value.spots, db: db.value, stream: new SnapshotStream(STREAM_OPTIONS) };
  const stopBroadcast = parts.db.onChange((state) => parts.stream.broadcast(state));
  return log.exit(ok({
    handler: buildHandler(parts),
    db: parts.db,
    close: () => {
      stopBroadcast();
      parts.stream.close();
      parts.db.close();
    },
  }));
}
