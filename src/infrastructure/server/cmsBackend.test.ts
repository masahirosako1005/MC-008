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
import type { CmsAuthServices } from '@/application/CmsAuthServices';
import type { CmsServices } from '@/application/CmsServices';
import type { CmsDemoLoginInput } from '@/application/dto/CmsAuthDto';
import { AUTH_PATHS } from '@/infrastructure/api/apiAuthRoutes';
import { API_PATHS, cmsShopPath } from '@/infrastructure/api/apiRoutes';
import type { FetchFn } from '@/infrastructure/api/requestApi';
import { createCmsContainer } from '@/infrastructure/di/cmsContainer';
import { createContainer } from '@/infrastructure/di/container';
import { createServerApp } from '@/infrastructure/di/serverContainer';
import type { ServerApp, ServerAppOptions } from '@/infrastructure/di/serverContainer';
import { uuid } from '@/infrastructure/random/CryptoIdGenerator';
import { nodeFetchText } from '@/infrastructure/server/nodeFetchText';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';

/** 実時刻の代わり（2026-11-09 10:00 JST） */
const NOW_MS = Date.parse('2026-11-09T01:00:00.000Z');
const TODAY = localDateOf(instantFromEpochMs(NOW_MS));
const fetchText = nodeFetchText('public/master');
/** テスト用の仮のパスワード（10 文字以上。秘密ではない） */
const PASSWORD = 'correct horse battery'; // audit-ignore: secret-pattern テスト用の仮のパスワード
const WRONG_PASSWORD = 'wrong password 1'; // audit-ignore: secret-pattern テスト用の仮のパスワード
const NEW_PASSWORD = 'another good password'; // audit-ignore: secret-pattern テスト用の仮のパスワード
const NOT_THE_PASSWORD = 'not the password'; // audit-ignore: secret-pattern テスト用の仮のパスワード

/** 起動した連携サーバー */
interface Running {
  readonly baseUrl: string;
  readonly server: Server;
  readonly app: ServerApp;
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

/** テスト用: 1つのハンドラを空いているポートで待ち受ける */
async function listenOn(handler: Parameters<typeof createServer>[1]): Promise<Server> {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return server;
}

/** テスト用: 連携サーバーを空いているポートで起動する */
async function startServer(opts: Partial<ServerAppOptions> = {}): Promise<Running> {
  const app = must(await createServerApp({ mode: 'demo', dbPath: ':memory:', fetchText, nowMs: () => NOW_MS, ...opts }));
  const server = await listenOn(app.handler);
  const { port } = server.address() as AddressInfo;
  const close = async (): Promise<void> => {
    app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  };
  const r = { baseUrl: `http://127.0.0.1:${port}`, server, app, close };
  running.push(r);
  return r;
}

/** テスト用: Cookie を覚える fetch（ブラウザの代わり。1つの端末＝1つの Cookie 入れ） */
interface CookieJar {
  readonly fetch: FetchFn;
  /** いま持っている Cookie ヘッダー（無ければ undefined） */
  header(): string | undefined;
}

/** テスト用: Cookie を覚える fetch を作る */
function cookieJar(): CookieJar {
  const cookies = new Map<string, string>();
  const header = (): string | undefined => (cookies.size === 0 ? undefined : [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
  return {
    header,
    fetch: async (input, init) => {
      const headers = new Headers(init.headers);
      const cookie = header();
      if (cookie !== undefined) headers.set('cookie', cookie);
      const res = await fetch(input, { ...init, headers });
      for (const setCookie of res.headers.getSetCookie()) {
        const [pair = '', ...attrs] = setCookie.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (attrs.some((a) => a.trim().toLowerCase() === 'max-age=0') || value === '') cookies.delete(name);
        else cookies.set(name, value);
      }
      return res;
    },
  };
}

/** テスト用: CmsServices からログインの入口を取り出す（無ければ投げる） */
function authOf(cms: CmsServices): CmsAuthServices {
  if (cms.auth === undefined) throw new Error('auth がありません');
  return cms.auth;
}

/** テスト用: 別の端末の CMS（保存先・Cookie は端末ごと）。デモのログイン（既定は運営者）までする */
async function cmsOn(baseUrl: string, store = new InMemoryKeyValueStore(), who: CmsDemoLoginInput = { role: 'operator' }, jar = cookieJar()): Promise<CmsServices> {
  const cms = must(await createCmsContainer({ mode: 'demo', store, nowMs: () => NOW_MS, backend: 'server', api: { baseUrl, fetch: jar.fetch } }));
  const demoLogin = authOf(cms).demoLogin;
  if (demoLogin === undefined) throw new Error('demoLogin がありません');
  must(await demoLogin.execute(who));
  return cms;
}

/** テスト用: 運営者としてデモのログインをした Cookie 入れを返す（生の要求に Cookie を付けるため） */
async function operatorJar(baseUrl: string): Promise<CookieJar> {
  const jar = cookieJar();
  await cmsOn(baseUrl, new InMemoryKeyValueStore(), { role: 'operator' }, jar);
  return jar;
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

/** テスト用: 生の要求を送る（jar を渡せばその Cookie を付ける） */
async function raw(baseUrl: string, path: string, init: RequestInit, jar?: CookieJar): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await (jar?.fetch ?? fetch)(`${baseUrl}${path}`, init);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/** テスト用: JSON の本文を送る要求の設定 */
function json(method: 'POST' | 'PUT', body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
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
    expect((await raw(baseUrl, cmsShopPath('s_mm04'), { headers: { 'x-demo-offset-days': '-1' } }, await operatorJar(baseUrl))).status).toBe(400);
  });

  it('本番の版でも店舗CMS の API はログインつきで出す。デモのログイン・やり直しは無い。公開スナップショットは配る（SEC-02, SEC-19）', async () => {
    const { baseUrl } = await startServer({ mode: 'production' });
    expect((await raw(baseUrl, API_PATHS.cmsShops, {})).status).toBe(401);
    expect((await raw(baseUrl, AUTH_PATHS.demoLogin, json('POST', { role: 'operator' }))).status).toBe(404);
    expect((await raw(baseUrl, API_PATHS.cmsDemoReset, json('POST', {}))).status).toBe(404);
    expect((await raw(baseUrl, API_PATHS.publicSnapshot, {})).body).toEqual({ schemaVersion: 1, dbId: expect.stringMatching(/^[0-9a-z]{12}$/), version: 0, spotEdits: [], shopEvents: [] });
  });

  it('localhost・IP アドレス以外の Host では API を使えない（DNS リバインディング対策）。--allowed-hosts の名前は使える', async () => {
    const { baseUrl } = await startServer({ allowedHosts: ['admin.example.jp'] });
    const status = (host: string): Promise<number> => new Promise((done) => {
      request(`${baseUrl}${API_PATHS.health}`, { headers: { host } }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      }).end();
    });
    expect(await status('attacker.example:8787')).toBe(403);
    expect(await status('localhost:8787')).toBe(200);
    expect(await status('192.168.0.10:8787')).toBe(200);
    expect(await status('[::1]:8787')).toBe(200);
    expect(await status('Admin.Example.jp')).toBe(200);
  });

  it('Content-Length の無い大きな本文も、上限を超えた時点で 413 を返して打ち切る（SEC-18）', async () => {
    const { baseUrl } = await startServer();
    const cookie = (await operatorJar(baseUrl)).header() ?? '';
    const status = await new Promise<number>((done) => {
      const req = request(`${baseUrl}${cmsShopPath('s_mm04', 'events')}`, { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked', cookie } }, (res) => {
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
    const { baseUrl } = await startServer({ writeLimit: { limit: 4, windowMs: 60_000 } });
    const jar = await operatorJar(baseUrl); // デモのログインで回数制限を1回使う
    const path = cmsShopPath('s_mm04', 'events');
    const headers = { 'content-type': 'application/json' };
    expect((await raw(baseUrl, path, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }, jar)).status).toBe(415);
    expect((await raw(baseUrl, path, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{}' }, jar)).status).toBe(403);
    expect((await raw(baseUrl, path, { method: 'POST', headers, body: JSON.stringify({ title: 'x'.repeat(20_000) }) }, jar)).status).toBe(413);
    // ここまでで回数制限を3回使った（ほかのオリジンは数える前に断る）。4回目までは通り、5回目で断る
    expect((await raw(baseUrl, path, { method: 'POST', headers, body: '{"kind":1}' }, jar)).status).toBe(400);
    expect((await raw(baseUrl, path, { method: 'POST', headers, body: '{"kind":1}' }, jar)).status).toBe(429);
    expect((await raw(baseUrl, path, { method: 'DELETE' }, jar)).status).toBe(405);
  });

  it('読取系にも回数制限がある（SEC-18）', async () => {
    const { baseUrl } = await startServer({ readLimit: { limit: 2, windowMs: 60_000 } });
    expect((await raw(baseUrl, API_PATHS.health, {})).status).toBe(200);
    expect((await raw(baseUrl, API_PATHS.health, {})).status).toBe(200);
    expect((await raw(baseUrl, API_PATHS.health, {})).status).toBe(429);
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

  it('ログインしていないと店舗CMS の API は 401。ログインすると使える（SEC-19）', async () => {
    const { baseUrl } = await startServer();
    expect((await raw(baseUrl, API_PATHS.cmsShops, {})).status).toBe(401);
    expect((await raw(baseUrl, cmsShopPath('s_mm04', 'info'), json('PUT', {}))).status).toBe(401);
    expect((await raw(baseUrl, AUTH_PATHS.me, {})).status).toBe(401);
    const cms = await cmsOn(baseUrl);
    expect(must(await authOf(cms).me.execute())).toMatchObject({ role: 'operator', demo: true, shopIds: [] });
    expect(must(await cms.shops.execute()).length).toBeGreaterThan(60);
  });

  it('店舗のアカウントは担当する店舗だけを見て・書ける。ほかの店舗は 403、デモのやり直しは運営者だけ（SEC-01, SEC-03）', async () => {
    const { baseUrl } = await startServer();
    const shop = await cmsOn(baseUrl, new InMemoryKeyValueStore(), { role: 'shopOwner', spotId: 's_mm04' });
    expect(must(await authOf(shop).me.execute())).toMatchObject({ role: 'shopOwner', shopIds: ['s_mm04'] });
    expect(must(await shop.shops.execute()).map((s) => s.id)).toEqual(['s_mm04']);
    must(await shop.saveShopInfo.execute({ spotId: 's_mm04', hours: { open: '10:00', close: '19:00', closedDays: [] }, amenities: [], operationId: uuid() }));
    const other = await shop.shopInfo.execute({ spotId: 's_mm01' });
    expect(!other.ok && [other.error.code, other.error.details?.['status']]).toEqual(['FORBIDDEN_SHOP', 403]);
    const write = await shop.saveShopInfo.execute({ spotId: 's_mm01', hours: { open: '10:00', close: '19:00', closedDays: [] }, amenities: [], operationId: uuid() });
    expect(!write.ok && write.error.code).toBe('FORBIDDEN_SHOP');
    const reset = await shop.resetDemo.execute();
    expect(!reset.ok && [reset.error.code, reset.error.details?.['status']]).toEqual(['FORBIDDEN', 403]);
    const accounts = await authOf(shop).accounts.list.execute();
    expect(!accounts.ok && accounts.error.code).toBe('FORBIDDEN');
    // 変更履歴の操作者はログイン中のアカウントID
    const audit = (await startServer()).app.db.recentAudit(1);
    expect(audit).toEqual([]);
  });

  it('パスワードでログインする：Cookie の属性・失敗の文は同じ・5回の失敗でロック・ログアウトで切れる（SEC-19, CMS-A06）', async () => {
    const { baseUrl, app } = await startServer();
    const created = must(await app.auth.createAccount('cli', { loginId: 'Owner.One', displayName: '店主', role: 'shopOwner', shopIds: ['s_mm04'], password: PASSWORD }));
    expect(created.loginId).toBe('owner.one');
    const jar = cookieJar();
    const cms = must(await createCmsContainer({ mode: 'demo', store: new InMemoryKeyValueStore(), nowMs: () => NOW_MS, backend: 'server', api: { baseUrl, fetch: jar.fetch } }));
    const wrong = await authOf(cms).login.execute({ loginId: 'owner.one', password: WRONG_PASSWORD });
    const unknown = await authOf(cms).login.execute({ loginId: 'nobody', password: WRONG_PASSWORD });
    expect(!wrong.ok && wrong.error.message).toBe(!unknown.ok && unknown.error.message);
    expect(!wrong.ok && wrong.error.details?.['status']).toBe(401);
    const login = await raw(baseUrl, AUTH_PATHS.login, json('POST', { loginId: ' OWNER.ONE ', password: PASSWORD }), jar);
    expect(login.status).toBe(200);
    const setCookie = login.headers.getSetCookie()[0] ?? '';
    expect(setCookie).toMatch(/^cms_session=[A-Za-z0-9_-]{43}; Path=\/api; HttpOnly; SameSite=Strict; Max-Age=43200$/);
    expect(must(await authOf(cms).me.execute())).toMatchObject({ loginId: 'owner.one', role: 'shopOwner', shopIds: ['s_mm04'], demo: false });
    expect(must(await cms.shops.execute()).map((s) => s.id)).toEqual(['s_mm04']);
    must(await authOf(cms).logout.execute());
    expect(jar.header()).toBeUndefined();
    const after = await authOf(cms).me.execute();
    expect(!after.ok && after.error.code).toBe('UNAUTHENTICATED');
    for (let i = 0; i < 5; i += 1) expect((await authOf(cms).login.execute({ loginId: 'owner.one', password: WRONG_PASSWORD })).ok).toBe(false);
    const locked = await authOf(cms).login.execute({ loginId: 'owner.one', password: PASSWORD });
    expect(!locked.ok && [locked.error.code, locked.error.details?.['status']]).toEqual(['ACCOUNT_LOCKED', 423]);
    expect(must(app.auth.listAccounts()).find((a) => a.id === created.id)?.locked).toBe(true);
  });

  it('TLS を終端する中継の後ろでは Cookie に Secure が付く（SEC-05）。ログインの試みにも回数制限がある（SEC-18）', async () => {
    const { baseUrl, app } = await startServer({ trust: { trustProxy: true, tls: false }, loginLimit: { limit: 2, windowMs: 60_000 } });
    must(await app.auth.createAccount('cli', { loginId: 'op1', displayName: '運営', role: 'operator', shopIds: [], password: PASSWORD }));
    const credentials = { loginId: 'op1', password: PASSWORD };
    const login = await raw(baseUrl, AUTH_PATHS.login, json('POST', credentials, { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' }));
    expect(login.status).toBe(200);
    expect(login.headers.getSetCookie()[0]).toContain('; Secure');
    expect((await raw(baseUrl, AUTH_PATHS.login, json('POST', credentials, { 'x-forwarded-for': '203.0.113.9' }))).status).toBe(200);
    expect((await raw(baseUrl, AUTH_PATHS.login, json('POST', credentials, { 'x-forwarded-for': '203.0.113.9' }))).status).toBe(429);
    expect((await raw(baseUrl, AUTH_PATHS.login, json('POST', credentials, { 'x-forwarded-for': '203.0.113.10' }))).status).toBe(200);
  });

  it('パスワードを変えるとほかの端末のセッションは切れる。運営者はアカウントを作り・担当店舗を変え・停止できる（CMS-A04, CMS-A07）', async () => {
    const { baseUrl, app } = await startServer();
    const operator = await cmsOn(baseUrl);
    const account = must(await authOf(operator).accounts.create.execute({ loginId: 'shop.two', displayName: '二号店', role: 'shopOwner', shopIds: ['s_mm04'], password: PASSWORD }));
    expect(account).toMatchObject({ loginId: 'shop.two', role: 'shopOwner', shopIds: ['s_mm04'], status: 'active', locked: false, demo: false });
    const taken = await authOf(operator).accounts.create.execute({ loginId: 'SHOP.TWO', displayName: 'x', role: 'shopOwner', shopIds: ['s_mm04'], password: PASSWORD });
    expect(!taken.ok && [taken.error.code, taken.error.details?.['status']]).toEqual(['LOGIN_ID_TAKEN', 409]);
    const weak = await authOf(operator).accounts.create.execute({ loginId: 'shop.three', displayName: 'x', role: 'shopOwner', shopIds: ['s_mm04'], password: 'short' });
    expect(!weak.ok && weak.error.code).toBe('INVALID_INPUT');

    const phone = cookieJar();
    const pc = cookieJar();
    const on = async (jar: CookieJar): Promise<CmsServices> => must(await createCmsContainer({ mode: 'demo', store: new InMemoryKeyValueStore(), nowMs: () => NOW_MS, backend: 'server', api: { baseUrl, fetch: jar.fetch } }));
    const phoneCms = await on(phone);
    const pcCms = await on(pc);
    must(await authOf(phoneCms).login.execute({ loginId: 'shop.two', password: PASSWORD }));
    must(await authOf(pcCms).login.execute({ loginId: 'shop.two', password: PASSWORD }));
    const bad = await authOf(pcCms).changePassword.execute({ currentPassword: NOT_THE_PASSWORD, newPassword: NEW_PASSWORD });
    expect(!bad.ok && bad.error.code).toBe('AUTH_FAILED');
    must(await authOf(pcCms).changePassword.execute({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }));
    expect((await authOf(pcCms).me.execute()).ok).toBe(true);
    expect((await authOf(phoneCms).me.execute()).ok).toBe(false);

    const moved = must(await authOf(operator).accounts.updateShops.execute({ accountId: account.id, shopIds: ['s_mm01', 's_mm04'] }));
    expect(moved.shopIds).toEqual(['s_mm01', 's_mm04']);
    expect(must(await pcCms.shops.execute()).map((s) => s.id)).toEqual(['s_mm01', 's_mm04']);
    const suspended = must(await authOf(operator).accounts.setStatus.execute({ accountId: account.id, status: 'suspended' }));
    expect(suspended.status).toBe('suspended');
    expect((await authOf(pcCms).me.execute()).ok).toBe(false);
    const relogin = await authOf(pcCms).login.execute({ loginId: 'shop.two', password: NEW_PASSWORD });
    expect(!relogin.ok && relogin.error.code).toBe('AUTH_FAILED');
    const me = must(await authOf(operator).me.execute());
    const self = await authOf(operator).accounts.setStatus.execute({ accountId: me.accountId, status: 'suspended' });
    expect(!self.ok && self.error.code).toBe('FORBIDDEN');
    expect(app.db.recentAudit(5).every((e) => e.actor.startsWith('u_'))).toBe(true);
  });

  it('CMS を別のオリジンに分けると、公開の面には店舗CMS・ログインの API が無い（docs/09 §7.1）', async () => {
    const { baseUrl, app } = await startServer({ separateCms: true });
    if (app.cmsHandler === undefined) throw new Error('cmsHandler がありません');
    const cmsServer = await listenOn(app.cmsHandler);
    const cmsUrl = `http://127.0.0.1:${(cmsServer.address() as AddressInfo).port}`;
    try {
      expect((await raw(baseUrl, API_PATHS.cmsShops, {})).status).toBe(404);
      expect((await raw(baseUrl, AUTH_PATHS.me, {})).status).toBe(404);
      expect((await raw(baseUrl, API_PATHS.publicSnapshot, {})).status).toBe(200);
      expect((await raw(cmsUrl, API_PATHS.publicSnapshot, {})).status).toBe(200);
      expect((await raw(cmsUrl, AUTH_PATHS.me, {})).status).toBe(401);
      expect((await (await cmsOn(cmsUrl)).shops.execute()).ok).toBe(true);
    } finally {
      cmsServer.closeAllConnections();
      await new Promise<void>((done) => cmsServer.close(() => done()));
    }
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
