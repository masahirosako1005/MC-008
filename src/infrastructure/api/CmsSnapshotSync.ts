/**
 * @file 公開スナップショットの受け取り（infrastructure/api 層。利用者アプリ側。docs/09 APP-02・APP-03）
 * - 起動時：サーバーから最新を取る。取れなければ前回の写し（localStorage）で動く。どちらも無ければマスタだけ
 * - 起動後：SSE（/api/public/cms-snapshot/stream）で印（DB の ID と版番号）の変化を受け取り、変わったら取り直す。
 *   つないだ直後にサーバーが今の印を送るので、つなぎ直しても取りこぼさない
 * - つなぎ直し：ネットワークが切れただけなら EventSource が自分でつなぎ直す。サーバーが 200 以外を返した
 *   （込み合い 503・中継の 502 など）ときは EventSource があきらめるので、ここで間を空けてつなぎ直す（だんだん長く、最長1分）
 * - 保険：一定間隔（CMS_SNAPSHOT_POLL_MS）と、画面に戻ったときにも確かめる
 * 「どの版か」は DB の ID と版番号の組で見分ける（DB を作り直して版番号が 0 からになっても取り違えない）。
 * CMS は必須の部品ではない（docs/09 §4.5）。失敗はすべて warn にとどめ、アプリは止めない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { isRecord } from '@/Common/utils/guards';
import { API_PATHS, SNAPSHOT_STREAM_EVENT } from '@/infrastructure/api/apiRoutes';
import { requestJsonDocument } from '@/infrastructure/api/requestApi';
import type { ApiClientDeps } from '@/infrastructure/api/requestApi';
import { isSnapshotDbId, isSnapshotVersion, markerKeyOf, parsePublicCmsSnapshot } from '@/infrastructure/api/schema/publicCmsSnapshot';
import type { PublicCmsSnapshot } from '@/infrastructure/api/schema/publicCmsSnapshot';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';
import type { KeyValueStore } from '@/infrastructure/storage/KeyValueStore';

const logger = createLogger('infrastructure/api/CmsSnapshotSync');

/** 保険として確かめる間隔（ミリ秒。30分（仮）＝docs/09 APP-02） */
export const CMS_SNAPSHOT_POLL_MS = 30 * 60 * 1000;
/** 起動時にサーバーを待つ時間（ミリ秒。これを過ぎたら前回の写しで起動する） */
export const CMS_SNAPSHOT_STARTUP_TIMEOUT_MS = 2500;
/** SSE をこちらでつなぎ直すときの最初の待ち時間と最長（ミリ秒） */
export const CMS_STREAM_RETRY_MIN_MS = 3000;
const CMS_STREAM_RETRY_MAX_MS = 60_000;
/** EventSource.CLOSED（あきらめた状態） */
const STREAM_CLOSED = 2;

/** SSE の受け口（EventSource と同じ使い方。テストで差し替える） */
export interface SnapshotStreamSource {
  /** 0: つなぎ中／1: つながっている／2: あきらめた */
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

/** 受け取りの依存 */
export interface CmsSnapshotSyncDeps {
  /** サーバーの呼び出し（fetch・起点） */
  readonly api: ApiClientDeps;
  /** 前回の写しの保存先 */
  readonly store: KeyValueStore;
  /** 前回の写しの保存キー（接頭辞つき。例 'nnishi.demo.cms.snapshot'） */
  readonly cacheKey: string;
  /** SSE を開く関数（省略時は EventSource。使えない環境では undefined を返す） */
  readonly openStream?: (url: string) => SnapshotStreamSource | undefined;
  /** 保険として確かめる間隔（ミリ秒） */
  readonly pollIntervalMs?: number;
  /** SSE をこちらでつなぎ直すときの最初の待ち時間（ミリ秒。テストで短くする） */
  readonly streamRetryMs?: number;
}

/**
 * ブラウザの EventSource で SSE を開く。
 * @param url SSE の URL
 * @returns 受け口（EventSource が無い環境では undefined）
 */
function openBrowserStream(url: string): SnapshotStreamSource | undefined {
  const log = logger.fn('openBrowserStream');
  if (typeof EventSource === 'undefined') return log.exit(undefined, 'noEventSource');
  return log.exit(new EventSource(url));
}

/**
 * SSE のメッセージから印を取り出す。
 * @param data メッセージの本文（'{"dbId":"…","version":3}'）
 * @returns 印を比べるための文字列（読めなければ undefined＝必ず取りに行く）
 */
function markerKeyFromMessage(data: unknown): string | undefined {
  const log = logger.fn('markerKeyFromMessage');
  if (typeof data !== 'string') return log.exit(undefined);
  const parsed = parseJsonText(data, 'SnapshotStreamMessage');
  if (!parsed.ok || !isRecord(parsed.value)) return log.exit(undefined);
  const { dbId, version } = parsed.value;
  return log.exit(isSnapshotDbId(dbId) && isSnapshotVersion(version) ? markerKeyOf({ dbId, version }) : undefined);
}

/** 公開スナップショットの受け取り */
export class CmsSnapshotSync {
  /** 最後に渡した版の印（DB の ID と版番号） */
  private appliedKey: string | undefined;
  /** 取りに行っている途中の処理（重ねて取りに行かない） */
  private inflight: Promise<void> | undefined;
  /** 取りに行っている途中に新しい版を知ったか */
  private pullAgain = false;

  /**
   * 受け取りを作る。
   * @param deps サーバーの呼び出し・写しの保存先
   */
  constructor(private readonly deps: CmsSnapshotSyncDeps) {}

  /**
   * サーバーから最新を取り、写しを保存する。
   * @param timeoutMs 待つ時間（省略時は API の既定）
   * @returns 成功: 公開スナップショット。失敗: NETWORK_FAILED / INVALID_RESPONSE / INVALID_INPUT
   * @sideEffect ネットワーク。成功したら localStorage に写しを書く
   */
  async fetchLatest(timeoutMs?: number): Promise<Result<PublicCmsSnapshot>> {
    const log = logger.fn('fetchLatest');
    const api = timeoutMs === undefined ? this.deps.api : { ...this.deps.api, timeoutMs };
    const raw = await requestJsonDocument(api, API_PATHS.publicSnapshot);
    if (!raw.ok) return log.fail(raw);
    const snapshot = parsePublicCmsSnapshot(raw.value);
    if (!snapshot.ok) return log.fail(snapshot);
    const saved = this.deps.store.set(this.deps.cacheKey, JSON.stringify(snapshot.value));
    if (!saved.ok) log.warn('お店の情報の写しを保存できませんでした', { code: saved.error.code });
    return log.exit(ok(snapshot.value), `version=${snapshot.value.version}`);
  }

  /**
   * 前回の写しを読む。
   * @returns 公開スナップショット（無い・壊れているときは undefined）
   */
  readCached(): PublicCmsSnapshot | undefined {
    const log = logger.fn('readCached');
    const stored = this.deps.store.get(this.deps.cacheKey);
    if (!stored.ok || stored.value === undefined) return log.exit(undefined, 'none');
    const parsed = parseJsonText(stored.value, 'PublicCmsSnapshotCache');
    const snapshot = parsed.ok ? parsePublicCmsSnapshot(parsed.value) : parsed;
    if (!snapshot.ok) {
      log.warn('お店の情報の写しが壊れているため使いません');
      return log.exit(undefined, 'broken');
    }
    return log.exit(snapshot.value, `version=${snapshot.value.version}`);
  }

  /**
   * 起動時の公開スナップショットを決める（サーバー → 前回の写し の順）。
   * @returns 公開スナップショット（どちらも無ければ undefined＝マスタだけで動く）
   * @sideEffect ネットワーク・localStorage
   */
  async initial(): Promise<PublicCmsSnapshot | undefined> {
    const log = logger.fn('initial');
    const latest = await this.fetchLatest(CMS_SNAPSHOT_STARTUP_TIMEOUT_MS);
    const snapshot = latest.ok ? latest.value : this.readCached();
    if (!latest.ok) log.warn('連携サーバーから取れないため、前回のお店の情報で動かします', { code: latest.error.code, cached: snapshot !== undefined });
    this.appliedKey = snapshot === undefined ? undefined : markerKeyOf(snapshot);
    return log.exit(snapshot, `version=${snapshot?.version ?? 'none'}`);
  }

  /**
   * 版が変わっていれば取り直して知らせる（重ねて取りに行かない）。
   * @param onSnapshot 新しい版を渡す関数
   * @param knownKey SSE で知った印（省略時は必ず取りに行く）
   * @returns 終わったら解決する Promise
   * @sideEffect ネットワーク・localStorage。新しい版なら onSnapshot を呼ぶ
   */
  refresh(onSnapshot: (snapshot: PublicCmsSnapshot) => void, knownKey?: string): Promise<void> {
    const log = logger.fn('refresh', { knownKey, applied: this.appliedKey });
    if (knownKey !== undefined && knownKey === this.appliedKey) return log.exit(Promise.resolve(), 'same');
    if (this.inflight !== undefined) {
      // 取りに行っている途中に新しい版を知ったら、終わったあとにもう1回取りに行く
      this.pullAgain = true;
      return log.exit(this.inflight, 'queued');
    }
    this.inflight = this.pull(onSnapshot);
    return log.exit(this.inflight);
  }

  /**
   * 最新を取り、新しい版なら知らせる。途中で新しい版を知ったら、もう1回繰り返す。
   * @param onSnapshot 新しい版を渡す関数
   * @returns 終わったら解決する Promise
   * @sideEffect ネットワーク・localStorage。新しい版なら onSnapshot を呼ぶ
   */
  private async pull(onSnapshot: (snapshot: PublicCmsSnapshot) => void): Promise<void> {
    const log = logger.fn('pull');
    try {
      do {
        this.pullAgain = false;
        const latest = await this.fetchLatest();
        const key = latest.ok ? markerKeyOf(latest.value) : undefined;
        if (latest.ok && key !== this.appliedKey) {
          this.appliedKey = key;
          onSnapshot(latest.value);
        }
      } while (this.pullAgain);
    } catch (error) {
      log.error('お店の情報の反映で例外', { message: error instanceof Error ? error.message : 'unknown' });
    } finally {
      this.inflight = undefined;
    }
    log.exit(undefined, `applied=${this.appliedKey ?? 'none'}`);
  }

  /**
   * SSE をつなぎ、印が届いたら確かめる。サーバーが 200 以外を返して EventSource があきらめたら、間を空けてつなぎ直す。
   * @param onSnapshot 新しい版を渡す関数
   * @returns つながりをやめる関数
   * @sideEffect SSE をつなぐ。つなぎ直しのタイマーを登録する
   */
  private connectStream(onSnapshot: (snapshot: PublicCmsSnapshot) => void): () => void {
    const log = logger.fn('connectStream');
    const url = `${this.deps.api.baseUrl ?? ''}${API_PATHS.publicSnapshotStream}`;
    const minRetry = this.deps.streamRetryMs ?? CMS_STREAM_RETRY_MIN_MS;
    let retryMs = minRetry;
    let stream: SnapshotStreamSource | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    /** SSE を開く（あきらめたら、間を空けて開き直す） */
    const open = (): void => { // audit-ignore: fnlog-missing つなぐたびに呼ぶ小さな処理（connectStream・refresh で記録する）
      stream = (this.deps.openStream ?? openBrowserStream)(url);
      stream?.addEventListener(SNAPSHOT_STREAM_EVENT, (event) => {
        retryMs = minRetry;
        void this.refresh(onSnapshot, markerKeyFromMessage(event.data));
      });
      stream?.addEventListener('error', () => {
        if (stopped || stream?.readyState !== STREAM_CLOSED) return;
        stream.close();
        log.warn('連携サーバーの通知が止まったため、つなぎ直します', { afterMs: retryMs });
        retryTimer = setTimeout(open, retryMs);
        retryMs = Math.min(retryMs * 2, CMS_STREAM_RETRY_MAX_MS);
      });
    };
    open();
    return log.exit(() => {
      stopped = true;
      clearTimeout(retryTimer);
      stream?.close();
    }, `stream=${stream !== undefined}`);
  }

  /**
   * 版の変化を見張る（SSE・一定間隔・画面に戻ったとき）。
   * @param onSnapshot 新しい版を渡す関数
   * @returns 見張りをやめる関数
   * @sideEffect SSE をつなぐ。タイマーと visibilitychange のリスナを登録する
   */
  watch(onSnapshot: (snapshot: PublicCmsSnapshot) => void): () => void {
    const log = logger.fn('watch');
    const stopStream = this.connectStream(onSnapshot);
    const timer = setInterval(() => void this.refresh(onSnapshot), this.deps.pollIntervalMs ?? CMS_SNAPSHOT_POLL_MS);
    /** 画面に戻ったら版を確かめる */
    const onVisible = (): void => { // audit-ignore: fnlog-missing 画面に戻るたびに呼ばれる小さな振り分け（refresh で記録する）
      if (document.visibilityState === 'visible') void this.refresh(onSnapshot);
    };
    const canWatchVisibility = typeof document !== 'undefined';
    if (canWatchVisibility) document.addEventListener('visibilitychange', onVisible);
    return log.exit(() => {
      stopStream();
      clearInterval(timer);
      if (canWatchVisibility) document.removeEventListener('visibilitychange', onVisible);
    });
  }
}
