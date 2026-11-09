/**
 * @file 連携サーバーの統合テスト（infrastructure/server 層・テスト。docs/09 §7.3）
 * 本物の連携サーバー（node:http＋node:sqlite のメモリ DB）を空いているポートで起動し、
 * 本物の CMS（HttpCmsServices）と利用者アプリ（container の 'server' モード）を、保存先の違う「別の端末」としてつなぐ。
 */
import { request } from 'node:http';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_CLOCK_OFFSET_STORAGE_KEY } from '@/Common/constants/env';
import type { AppError, Result } from '@/Common/result/Result';
import { addDays, instantFromEpochMs, localDateOf } from '@/Common/utils/date';
import type { AppServices } from '@/application/AppServices';
import type { CmsServices } from '@/application/CmsServices';
import { API_PATHS, cmsShopPath } from '@/infrastructure/api/apiRoutes';
import { createCmsContainer } from '@/infrastructure/di/cmsContainer';
import { createContainer } from '@/infrastructure/di/container';
import { createServerApp } from '@/infrastructure/di/serverContainer';
import type { ServerAppOptions } from '@/infrastructure/di/serverContainer';
import { uuid } from '@/infrastructure/random/CryptoIdGenerator';
import { nodeFetchText } from '@/infrastructure/server/nodeFetchText';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';

/** 実時刻の代わり（2026-11-09 10:00 JST） */
const NOW_MS = Date.parse('2026-11-09T01:00:00.000Z');
const TODAY = localDateOf(instantFromEpochMs(NOW_MS));
const fetchText = nodeFetchText('public/master');

/** 起動した連携サーバー */
interface Running {
  readonly baseUrl: string;
  readonly server: Server;
  readonly close: () => Promise<void>;
}

const running: Running[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.close()));
});

/** テスト用: 成功値を取り出す（失敗ならコード付きで投げる） */
function must<T>(result: Result<T, AppError<string>>): T {
  if (!result.ok) throw new Error(`期待しない失敗: ${result.error.code} ${result.error.message}`);
  return result.value;
}

/** テスト用: 連携サーバーを空いているポートで起動する */
async function startServer(opts: Partial<ServerAppOptions> = {}): Promise<Running> {
  const app = must(await createServerApp({ mode: 'demo', dbPath: ':memory:', fetchText, nowMs: () => NOW_MS, ...opts }));
  const server = createServer(app.handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const close = async (): Promise<void> => {
    app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  };
  const r = { baseUrl: `http://127.0.0.1:${port}`, server, close };
  running.push(r);
  return r;
}

/** テスト用: 別の端末の CMS（保存先は端末ごと） */
async function cmsOn(baseUrl: string, store = new InMemoryKeyValueStore()): Promise<CmsServices> {
  return must(await createCmsContainer({ mode: 'demo', store, nowMs: () => NOW_MS, backend: 'server', api: { baseUrl } }));
}

/** テスト用: 別の端末の利用者アプリ（保存先は端末ごと） */
async function appOn(baseUrl: string, store = new InMemoryKeyValueStore()): Promise<AppServices> {
  return must(await createContainer({ mode: 'demo', store, fetchText, nowMs: () => NOW_MS, cmsBackend: 'server', cmsApi: { baseUrl } }));
}

/** テスト用: 旅人が発見済みで、まだクーポン・イベントの無い協力店を探す */
async function discoveredPartnerWithoutEvents(app: AppServices, cms: CmsServices): Promise<string> {
  for (const shop of must(await cms.shops.execute()).filter((s) => s.partner && s.openEvents === 0)) {
    const detail = await app.spotDetail.execute({ spotId: shop.id });
    if (detail.ok && detail.value.shopEvents.length === 0) return shop.id;
  }
  throw new Error('発見済みでクーポンの無い協力店が見つかりません');
}

/** テスト用: 生の要求を送る */
async function raw(baseUrl: string, path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, init);
  return { status: res.status, body: await res.json() };
}

/** テスト用: SSE を開き、届いた版番号を集める */
function listenVersions(baseUrl: string): { readonly versions: number[]; readonly next: (count: number) => Promise<void>; readonly stop: () => void } {
  const versions: number[] = [];
  const waiters: (() => void)[] = [];
  const req = request(`${baseUrl}${API_PATHS.publicSnapshotStream}`, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      for (const m of chunk.matchAll(/data: (\{.*\})/g)) versions.push((JSON.parse(m[1] ?? '{}') as { version: number }).version);
      waiters.splice(0).forEach((w) => w());
    });
  });
  req.end();
  const next = async (count: number): Promise<void> => {
    while (versions.length < count) await new Promise<void>((done) => waiters.push(done));
  };
  return { versions, next, stop: () => req.destroy() };
}

describe('連携サーバー（店舗CMS ⇄ 利用者アプリ）', () => {
  it('CMS（HTTP）で登録・保存した内容が、別の端末のアプリのスポット詳細と期限カードに出る', async () => {
    const { baseUrl } = await startServer();
    const cms = await cmsOn(baseUrl);
    const spotId = await discoveredPartnerWithoutEvents(await appOn(baseUrl), cms);
    const registered = must(await cms.registerShopEvent.execute({
      spotId, kind: 'coupon', title: '連携テストのクーポン', description: 'レジで画面を見せてください', start: TODAY, end: addDays(TODAY, 4), operationId: uuid(),
    }));
    expect(registered.events.find((e) => e.title === '連携テストのクーポン')).toMatchObject({ status: 'active', daysLeft: 4, source: 'cms' });
    must(await cms.saveShopInfo.execute({ spotId, hours: { open: '8:30', close: '17:00', closedDays: [6] }, amenities: ['toilet', 'kids'], operationId: uuid() }));

    const otherDevice = await appOn(baseUrl);
    const detail = must(await otherDevice.spotDetail.execute({ spotId }));
    expect(detail.hours).toBe('8:30–17:00（日休）');
    expect(detail.amenities).toEqual(['kids', 'toilet']);
    expect(detail.shopEvents.map((e) => e.title)).toContain('連携テストのクーポン');
    const reasons = must(await otherDevice.reasons.execute());
    expect(reasons.some((r) => r.kind === 'deadline' && r.spotId === spotId && r.subtitle === '連携テストのクーポン')).toBe(true);
  });

  it('HTTP 経由の応答は、同じユースケースをブラウザで直接動かした結果と一致する（応答の検証で項目を落とさない）', async () => {
    const { baseUrl } = await startServer();
    const http = await cmsOn(baseUrl);
    const local = must(await createCmsContainer({ mode: 'demo', store: new InMemoryKeyValueStore(), fetchText, nowMs: () => NOW_MS, backend: 'local' }));
    expect(must(await http.shops.execute())).toEqual(must(await local.shops.execute()));
    for (const spotId of ['s_mm01', 's_mm04']) {
      expect(must(await http.shopInfo.execute({ spotId }))).toEqual(must(await local.shopInfo.execute({ spotId })));
      expect(must(await http.visitStats.execute({ spotId }))).toEqual(must(await local.visitStats.execute({ spotId })));
    }
  });

  it('規則はサーバー側のユースケースが確かめる：二重送信・連打・協力店でない店・名所・不正な ID（DI-07, SEC-03, SEC-16）', async () => {
    const { baseUrl } = await startServer();
    const cms = await cmsOn(baseUrl);
    const input = { spotId: 's_mm04', kind: 'event', title: '試食会', description: '新作パンの試食', start: addDays(TODAY, 1), end: addDays(TODAY, 2), operationId: uuid() };
    must(await cms.registerShopEvent.execute(input));
    expect(must(await cms.registerShopEvent.execute(input)).events.filter((e) => e.title === '試食会')).toHaveLength(1);
    const twice = { ...input, title: '連打', operationId: uuid() };
    const [a, b] = await Promise.all([cms.registerShopEvent.execute(twice), cms.registerShopEvent.execute({ ...twice, operationId: uuid() })]);
    expect(must(a).events.filter((e) => e.title === '連打')).toHaveLength(1);
    expect(must(b).events.filter((e) => e.title === '連打')).toHaveLength(1);
    const nonPartner = must(await cms.shops.execute()).find((s) => !s.partner)?.id ?? '';
    const rejected = await cms.registerShopEvent.execute({ ...input, spotId: nonPartner, operationId: uuid() });
    expect(!rejected.ok && [rejected.error.code, rejected.error.details?.['status']]).toEqual(['NOT_PARTNER', 422]);
    for (const spotId of ['l_mm01', 's_zz99', '<img>', '../../etc']) expect((await cms.shopInfo.execute({ spotId })).ok).toBe(false);
  });

  it('デモの日付のずらし日数はヘッダーで伝わり、サーバー側の「今日」になる', async () => {
    const { baseUrl } = await startServer();
    const store = new InMemoryKeyValueStore();
    store.set(DEMO_CLOCK_OFFSET_STORAGE_KEY, '30');
    expect(must(await (await cmsOn(baseUrl, store)).shopInfo.execute({ spotId: 's_mm04' })).today).toBe(addDays(TODAY, 30));
    expect((await raw(baseUrl, cmsShopPath('s_mm04'), { headers: { 'x-demo-offset-days': '-1' } })).status).toBe(400);
  });

  it('本番の版では店舗CMS の API を出さない。公開スナップショットは配る（MUST-8, SEC-02）', async () => {
    const { baseUrl } = await startServer({ mode: 'production' });
    expect((await raw(baseUrl, API_PATHS.cmsShops, {})).status).toBe(404);
    expect((await raw(baseUrl, API_PATHS.cmsDemoReset, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    expect((await raw(baseUrl, API_PATHS.publicSnapshot, {})).body).toEqual({ schemaVersion: 1, dbId: expect.stringMatching(/^[0-9a-z]{12}$/), version: 0, spotEdits: [], shopEvents: [] });
  });

  it('localhost・IP アドレス以外の Host では API を使えない（DNS リバインディング対策）', async () => {
    const { baseUrl } = await startServer();
    const status = (host: string): Promise<number> => new Promise((done) => {
      request(`${baseUrl}${API_PATHS.cmsShops}`, { headers: { host } }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      }).end();
    });
    expect(await status('attacker.example:8787')).toBe(403);
    expect(await status('localhost:8787')).toBe(200);
    expect(await status('192.168.0.10:8787')).toBe(200);
    expect(await status('[::1]:8787')).toBe(200);
  });

  it('Content-Length の無い大きな本文も、上限を超えた時点で 413 を返して打ち切る（SEC-18）', async () => {
    const { baseUrl } = await startServer();
    const status = await new Promise<number>((done) => {
      const req = request(`${baseUrl}${cmsShopPath('s_mm04', 'events')}`, { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      });
      req.on('error', () => undefined);
      req.write(`{"title":"${'x'.repeat(20_000)}`);
    });
    expect(status).toBe(413);
  });

  it('SSE は1つの相手から上限（10本）までしかつなげない（SEC-18）', async () => {
    const { baseUrl } = await startServer();
    const streams = Array.from({ length: 10 }, () => listenVersions(baseUrl));
    await Promise.all(streams.map((s) => s.next(1)));
    expect((await fetch(`${baseUrl}${API_PATHS.publicSnapshotStream}`)).status).toBe(503);
    streams.forEach((s) => s.stop());
  });

  it('書込系は JSON・同じオリジン・大きさの上限・回数制限を確かめる（SEC-28, SEC-18）', async () => {
    const { baseUrl } = await startServer({ writeLimit: { limit: 3, windowMs: 60_000 } });
    const path = cmsShopPath('s_mm04', 'events');
    const json = { 'content-type': 'application/json' };
    expect((await raw(baseUrl, path, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await raw(baseUrl, path, { method: 'POST', headers: { ...json, origin: 'https://evil.example' }, body: '{}' })).status).toBe(403);
    expect((await raw(baseUrl, path, { method: 'POST', headers: json, body: JSON.stringify({ title: 'x'.repeat(20_000) }) })).status).toBe(413);
    // ここまでで回数制限を2回使った（ほかのオリジンは数える前に断る）。3回目までは通り、4回目で断る
    expect((await raw(baseUrl, path, { method: 'POST', headers: json, body: '{"kind":1}' })).status).toBe(400);
    expect((await raw(baseUrl, path, { method: 'POST', headers: json, body: '{"kind":1}' })).status).toBe(429);
    expect((await raw(baseUrl, path, { method: 'DELETE' })).status).toBe(405);
  });

  it('公開スナップショット：開始前に取り下げたものは配らない。ETag で 304。版番号は SSE で届く（APP-02, APP-03, §6.3）', async () => {
    const { baseUrl } = await startServer();
    const sse = listenVersions(baseUrl);
    await sse.next(1);
    const cms = await cmsOn(baseUrl);
    const info = must(await cms.registerShopEvent.execute({
      spotId: 's_mm04', kind: 'coupon', title: '明日からのクーポン', description: 'x', start: addDays(TODAY, 1), end: addDays(TODAY, 3), operationId: uuid(),
    }));
    const id = info.events.find((e) => e.source === 'cms')?.id ?? '';
    must(await cms.withdrawShopEvent.execute({ spotId: 's_mm04', shopEventId: id, operationId: uuid() }));
    await sse.next(3);
    sse.stop();
    expect(sse.versions).toEqual([0, 1, 2]);
    const res = await fetch(`${baseUrl}${API_PATHS.publicSnapshot}`);
    const etag = res.headers.get('etag') ?? '';
    expect(etag).toMatch(/^"cms-[0-9a-z]{12}-2"$/);
    expect(((await res.json()) as { shopEvents: unknown[] }).shopEvents).toEqual([]);
    expect((await fetch(`${baseUrl}${API_PATHS.publicSnapshot}`, { headers: { 'if-none-match': etag } })).status).toBe(304);
  });

  it('連携サーバーが止まっても、アプリは前回の写しで動く（APP-02、docs/09 §4.5）', async () => {
    const server = await startServer();
    const cms = await cmsOn(server.baseUrl);
    must(await cms.saveShopInfo.execute({ spotId: 's_mm04', hours: { open: '9:00', close: '15:00', closedDays: [] }, amenities: ['parking'], operationId: uuid() }));
    const device = new InMemoryKeyValueStore();
    expect(must(await (await appOn(server.baseUrl, device)).spotDetail.execute({ spotId: 's_mm04' })).hours).toBe('9:00–15:00（無休）');
    await server.close();
    running.splice(running.indexOf(server), 1);
    expect(must(await (await appOn(server.baseUrl, device)).spotDetail.execute({ spotId: 's_mm04' })).hours).toBe('9:00–15:00（無休）');
    const fresh = must(await (await appOn(server.baseUrl)).spotDetail.execute({ spotId: 's_mm04' }));
    expect(fresh.hours).not.toBe('9:00–15:00（無休）');
  });
});
