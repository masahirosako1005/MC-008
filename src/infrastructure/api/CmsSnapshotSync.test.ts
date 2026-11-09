/**
 * @file 公開スナップショットの受け取りのテスト（infrastructure/api 層・テスト。docs/09 APP-02・APP-03）
 * fetch と SSE を差し替えて、起動時の決め方（サーバー → 前回の写し）、新しい版だけを知らせること、
 * DB を作り直して版番号が重なっても見分けること、SSE があきらめたらつなぎ直すことを確かめる。
 */
import { describe, expect, it } from 'vitest';
import { API_PATHS, SNAPSHOT_STREAM_EVENT } from '@/infrastructure/api/apiRoutes';
import { CmsSnapshotSync } from '@/infrastructure/api/CmsSnapshotSync';
import type { SnapshotStreamSource } from '@/infrastructure/api/CmsSnapshotSync';
import type { FetchFn } from '@/infrastructure/api/requestApi';
import type { PublicCmsSnapshot } from '@/infrastructure/api/schema/publicCmsSnapshot';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';

const CACHE_KEY = 'nnishi.demo.cms.snapshot';
const DB = 'testdb01';

/** 返す版（null はつながらない） */
type Served = { readonly version: number; readonly dbId?: string } | number | null;

/** テスト用: 呼ばれるたびに次の版を返す fetch */
function fakeServer(served: Served[]): { readonly fetch: FetchFn; readonly calls: string[] } {
  const calls: string[] = [];
  const fetchFn: FetchFn = async (input) => {
    calls.push(input);
    const next = served.length > 1 ? served.shift() : served[0];
    if (next === null || next === undefined) throw new TypeError('fetch failed');
    const { version, dbId } = typeof next === 'number' ? { version: next, dbId: DB } : { version: next.version, dbId: next.dbId ?? DB };
    return new Response(JSON.stringify({ schemaVersion: 1, dbId, version, spotEdits: [], shopEvents: [] }), { status: 200 });
  };
  return { fetch: fetchFn, calls };
}

/** テスト用: 手で送れる SSE */
class FakeStream implements SnapshotStreamSource {
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  readyState = 1;
  closed = false;
  /** リスナを登録する */
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  /** 閉じる */
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  /** 印を送る */
  send(version: number, dbId = DB): void {
    for (const l of this.listeners.get(SNAPSHOT_STREAM_EVENT) ?? []) l(new MessageEvent(SNAPSHOT_STREAM_EVENT, { data: JSON.stringify({ dbId, version }) }));
  }
  /** サーバーが 200 以外を返して EventSource があきらめた状態にする */
  giveUp(): void {
    this.readyState = 2;
    for (const l of this.listeners.get('error') ?? []) l(new MessageEvent('error'));
  }
}

/** テスト用: 少し待つ（Promise とタイマーを進める） */
async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((done) => setTimeout(done, ms));
}

describe('CmsSnapshotSync', () => {
  it('起動時はサーバーの最新を使い、写しを残す。つながらなければ写しを使う。どちらも無ければ undefined', async () => {
    const store = new InMemoryKeyValueStore();
    const online = new CmsSnapshotSync({ api: { fetch: fakeServer([4]).fetch }, store, cacheKey: CACHE_KEY });
    expect((await online.initial())?.version).toBe(4);
    const offline = new CmsSnapshotSync({ api: { fetch: fakeServer([null]).fetch }, store, cacheKey: CACHE_KEY });
    expect((await offline.initial())?.version).toBe(4);
    const empty = new CmsSnapshotSync({ api: { fetch: fakeServer([null]).fetch }, store: new InMemoryKeyValueStore(), cacheKey: CACHE_KEY });
    expect(await empty.initial()).toBeUndefined();
  });

  it('壊れた写しは使わない', async () => {
    const store = new InMemoryKeyValueStore();
    store.set(CACHE_KEY, '{"schemaVersion":1,"dbId":"testdb01","version":-1}');
    const sync = new CmsSnapshotSync({ api: { fetch: fakeServer([null]).fetch }, store, cacheKey: CACHE_KEY });
    expect(await sync.initial()).toBeUndefined();
  });

  it('SSE で知った印が今と同じなら取りに行かず、新しければ取り直して1回だけ知らせる', async () => {
    const server = fakeServer([1, 2]);
    const stream = new FakeStream();
    const sync = new CmsSnapshotSync({ api: { fetch: server.fetch, baseUrl: 'http://x' }, store: new InMemoryKeyValueStore(), cacheKey: CACHE_KEY, openStream: () => stream, pollIntervalMs: 3_600_000 });
    await sync.initial();
    const got: PublicCmsSnapshot[] = [];
    const stop = sync.watch((s) => got.push(s));
    stream.send(1);
    await settle();
    expect(server.calls).toHaveLength(1);
    stream.send(2);
    stream.send(2);
    await settle();
    expect(got.map((s) => s.version)).toEqual([2]);
    expect(server.calls.every((url) => url === `http://x${API_PATHS.publicSnapshot}`)).toBe(true);
    stop();
    expect(stream.closed).toBe(true);
  });

  it('DB を作り直して版番号が同じでも、DB の ID が違えば取り直す', async () => {
    const server = fakeServer([3, { version: 3, dbId: 'newdb002' }]);
    const stream = new FakeStream();
    const sync = new CmsSnapshotSync({ api: { fetch: server.fetch }, store: new InMemoryKeyValueStore(), cacheKey: CACHE_KEY, openStream: () => stream, pollIntervalMs: 3_600_000 });
    await sync.initial();
    const got: string[] = [];
    const stop = sync.watch((s) => got.push(s.dbId));
    stream.send(3, 'newdb002');
    await settle();
    stop();
    expect(got).toEqual(['newdb002']);
  });

  it('サーバーが 200 以外を返して SSE があきらめたら、間を空けてつなぎ直す', async () => {
    const streams: FakeStream[] = [];
    const sync = new CmsSnapshotSync({
      api: { fetch: fakeServer([1]).fetch }, store: new InMemoryKeyValueStore(), cacheKey: CACHE_KEY, pollIntervalMs: 3_600_000, streamRetryMs: 5,
      openStream: () => {
        const s = new FakeStream();
        streams.push(s);
        return s;
      },
    });
    await sync.initial();
    const stop = sync.watch(() => undefined);
    streams[0]?.giveUp();
    await settle(10);
    expect(streams.length).toBe(2);
    stop();
    expect(streams[1]?.closed).toBe(true);
  });

  it('取りに行っている途中に新しい版を知ったら、終わったあとにもう1回取りに行く', async () => {
    const server = fakeServer([0, 1, 2]);
    const sync = new CmsSnapshotSync({ api: { fetch: server.fetch }, store: new InMemoryKeyValueStore(), cacheKey: CACHE_KEY });
    await sync.initial();
    const got: number[] = [];
    const first = sync.refresh((s) => got.push(s.version), `${DB}:1`);
    const second = sync.refresh((s) => got.push(s.version), `${DB}:2`);
    await Promise.all([first, second]);
    expect(got).toEqual([1, 2]);
  });
});
