/**
 * @file 利用者のログインの統合テスト（infrastructure/server/app 層・テスト。docs/12 §6 段階1）
 * 連携サーバーを実際に待ち受けさせ、にせの提供元（開発用ログイン）を相手に、本物と同じ流れ
 * （開始 → 同意 → コード → トークンの窓口 → ID トークンの検証 → セッション）を HTTP で通す。DB は PGlite（メモリ上の PostgreSQL）。
 */
import { createServer } from 'node:http';
import type { RequestListener, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AppError, Result } from '@/Common/result/Result';
import type { ApiClientDeps } from '@/infrastructure/api/requestApi';
import { createContainer } from '@/infrastructure/di/container';
import { createServerApp } from '@/infrastructure/di/serverContainer';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import type { ServerApp } from '@/infrastructure/di/serverContainer';
import { nodeFetchText } from '@/infrastructure/server/nodeFetchText';
import { PgliteSqlClient } from '@/infrastructure/server/pg/testing/PgliteSqlClient';

/** 起動したテスト用のサーバー */
interface Running {
  readonly origin: string;
  readonly sql: PgliteSqlClient;
  readonly app: ServerApp;
  readonly server: Server;
  /** 実時刻をずらす（ミリ秒） */
  advance(ms: number): void;
}

/** テスト全体で1つの DB を使い回す（PGlite の起動に数秒かかるため。テストごとに中身を消す） */
let shared: PgliteSqlClient;
beforeAll(async () => {
  shared = await PgliteSqlClient.create();
}, 60_000);
afterAll(async () => {
  await shared.close();
});

/** テスト用: 成功値を取り出す */
function must<T>(result: Result<T, AppError<string>>): T {
  if (!result.ok) throw new Error(`期待しない失敗: ${result.error.code}`);
  return result.value;
}

const running: Running[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    r.app.close();
    r.server.closeAllConnections();
    await new Promise((done) => r.server.close(done));
    await r.sql.execScript('DELETE FROM app_users; DELETE FROM app_login_states;');
  }
});

/**
 * テスト用: サーバーを起動する（ポートは空いているものを使う）。
 * @param mode デモ／本番
 * @param separateCms CMS を別の面にするか
 * @param demoWalk 地図タップの移動を受け付ける（移動の妥当性を確かめない）か
 * @returns 起動したサーバー（本番でにせの提供元だけを指定したときは失敗するので undefined）
 */
async function start(mode: 'demo' | 'production' = 'demo', separateCms = false, demoWalk = false): Promise<Running | undefined> {
  let handler: RequestListener = (_req, res) => res.end();
  const server = createServer((req, res) => handler(req, res));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  const sql = shared;
  let offset = 0;
  const app = await createServerApp({
    mode, dbPath: ':memory:', fetchText: nodeFetchText('public/master'), separateCms, nowMs: () => Date.now() + offset,
    appBackend: { sql, origin, providers: [], mockLogin: true, demoWalk },
  });
  if (!app.ok) {
    await new Promise((done) => server.close(done));
    return undefined;
  }
  handler = separateCms && app.value.cmsHandler !== undefined && mode === 'production' ? app.value.cmsHandler : app.value.handler;
  const r: Running = { origin, sql, app: app.value, server, advance: (ms) => { offset += ms; } };
  running.push(r);
  return r;
}

/**
 * テスト用: Set-Cookie から名前の Cookie（名前=値）を取り出す。
 * @param response 応答
 * @param name Cookie の名前
 * @returns '名前=値'（無ければ undefined）
 */
function cookieOf(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().map((c) => c.split(';')[0] ?? '').find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);
}

/**
 * テスト用: 移動せずに GET する。
 * @param url URL
 * @param cookie 送る Cookie
 * @returns 応答
 */
function get(url: string, cookie?: string): Promise<Response> {
  return fetch(url, { redirect: 'manual', ...(cookie === undefined ? {} : { headers: { Cookie: cookie } }) });
}

/**
 * テスト用: 開始から同意までを進め、戻り先の URL と state の Cookie を返す。
 * @param r サーバー
 * @param user テスト用の利用者の番号
 * @returns 戻り先（コードつき）と state の Cookie
 */
async function authorize(r: Running, user: string): Promise<{ readonly callback: string; readonly loginCookie: string }> {
  const started = await get(`${r.origin}/api/app/auth/mock/start`);
  expect(started.status).toBe(302);
  const loginCookie = cookieOf(started, 'app_login') ?? '';
  const consent = await get(`${started.headers.get('location') ?? ''}&user=${user}`);
  expect(consent.status).toBe(302);
  return { callback: consent.headers.get('location') ?? '', loginCookie };
}

/**
 * テスト用: ログインを最後まで通し、セッションの Cookie を返す。
 * @param r サーバー
 * @param user テスト用の利用者の番号
 * @returns セッションの Cookie
 */
async function login(r: Running, user: string): Promise<string> {
  const { callback, loginCookie } = await authorize(r, user);
  const done = await get(callback, loginCookie);
  expect(done.headers.get('location')).toBe(`${r.origin}/?login=ok`);
  return cookieOf(done, 'app_session') ?? '';
}

/**
 * テスト用: /api/app/me の旅人ID を返す。
 * @param r サーバー
 * @param session セッションの Cookie
 * @returns 状態と旅人ID
 */
async function me(r: Running, session?: string): Promise<{ readonly status: number; readonly travelerId?: string; readonly providers?: readonly string[] }> {
  const response = await get(`${r.origin}/api/app/me`, session);
  const body = (await response.json()) as { value?: { travelerId?: string; providers?: readonly string[] } };
  return { status: response.status, ...body.value };
}

describe('利用者のログイン（にせの提供元との統合）', () => {
  it('ログインするとセッションができ、同じ人は同じ旅人ID、別の人は別の旅人ID になる', async () => {
    const r = (await start())!;
    expect((await me(r)).status).toBe(401);
    const first = await login(r, '1');
    const mine = await me(r, first);
    expect(mine.status).toBe(200);
    expect(mine.travelerId).toMatch(/^t_[0-9a-f]{32}$/);
    expect(mine.providers).toEqual(['mock']);
    expect((await me(r, await login(r, '1'))).travelerId).toBe(mine.travelerId);
    expect((await me(r, await login(r, '2'))).travelerId).not.toBe(mine.travelerId);
    const users = await r.sql.query('SELECT count(*)::integer AS n FROM app_users');
    expect(users[0]?.['n']).toBe(2);
  });

  it('セッションの Cookie は HttpOnly・SameSite=Strict で、DB にはトークンそのものを置かない', async () => {
    const r = (await start())!;
    const { callback, loginCookie } = await authorize(r, '1');
    const done = await get(callback, loginCookie);
    const raw = done.headers.getSetCookie().find((c) => c.startsWith('app_session=')) ?? '';
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Strict');
    expect(raw).toContain('Path=/api');
    const token = raw.split(';')[0]?.slice('app_session='.length) ?? '';
    const rows = await r.sql.query('SELECT session_id FROM app_sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['session_id']).not.toBe(token);
  });

  it('state の Cookie が無い・違う戻りは失敗し、セッションを出さない（ログイン CSRF）', async () => {
    const r = (await start())!;
    const { callback } = await authorize(r, '1');
    const noCookie = await get(callback);
    expect(noCookie.headers.get('location')).toBe(`${r.origin}/?login=failed`);
    expect(cookieOf(noCookie, 'app_session')).toBeUndefined();
    const other = await authorize(r, '1');
    const wrong = await get(callback, other.loginCookie);
    expect(wrong.headers.get('location')).toBe(`${r.origin}/?login=failed`);
  });

  it('同じ戻りを2回使うと2回目は失敗する（state・コードは1回だけ）', async () => {
    const r = (await start())!;
    const { callback, loginCookie } = await authorize(r, '1');
    expect((await get(callback, loginCookie)).headers.get('location')).toBe(`${r.origin}/?login=ok`);
    expect((await get(callback, loginCookie)).headers.get('location')).toBe(`${r.origin}/?login=failed`);
  });

  it('コードを書き換えた戻りは失敗する', async () => {
    const r = (await start())!;
    const { callback, loginCookie } = await authorize(r, '1');
    const forged = new URL(callback);
    forged.searchParams.set('code', 'x'.repeat(43));
    expect((await get(forged.toString(), loginCookie)).headers.get('location')).toBe(`${r.origin}/?login=failed`);
  });

  it('ログアウトするとセッションが使えなくなる。ほかのオリジンからのログアウトは断る', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    const cross = await fetch(`${r.origin}/api/app/auth/logout`, { method: 'POST', headers: { Cookie: session, Origin: 'https://evil.example' } });
    expect(cross.status).toBe(403);
    expect((await me(r, session)).status).toBe(200);
    const out = await fetch(`${r.origin}/api/app/auth/logout`, { method: 'POST', headers: { Cookie: session } });
    expect(out.status).toBe(200);
    expect((await me(r, session)).status).toBe(401);
  });

  it('最後の操作から 14日を過ぎたセッションは使えない', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    r.advance(13 * 24 * 60 * 60 * 1000);
    expect((await me(r, session)).status).toBe(200);
    r.advance(15 * 24 * 60 * 60 * 1000);
    expect((await me(r, session)).status).toBe(401);
  });

  it('提供元の一覧と DB の疎通を返す。知らない提供元の開始は 404', async () => {
    const r = (await start())!;
    const providers = (await (await get(`${r.origin}/api/app/auth/providers`)).json()) as { value: { providers: { id: string }[] } };
    expect(providers.value.providers.map((p) => p.id)).toEqual(['mock']);
    expect((await get(`${r.origin}/api/app/health`)).status).toBe(200);
    expect((await get(`${r.origin}/api/app/auth/line/start`)).status).toBe(404);
  });

  it('本番の版ではにせの提供元を出さない（提供元が無ければ起動しない）', async () => {
    expect(await start('production')).toBeUndefined();
  });
});

/** 大阪天満宮（マスタの l_mm01）の位置 */
const TENMANGU = { lat: 34.69609, lng: 135.51277, accuracyM: 10 };

/**
 * テスト用: JSON を POST する。
 * @param r サーバー
 * @param path 道筋
 * @param body 本文
 * @param session セッションの Cookie
 * @returns 状態と封筒
 */
async function post(r: Running, path: string, body: unknown, session?: string): Promise<{ readonly status: number; readonly ok: boolean; readonly value?: Record<string, unknown>; readonly code?: string }> {
  const response = await fetch(`${r.origin}${path}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: r.origin, ...(session === undefined ? {} : { Cookie: session }) },
  });
  const envelope = (await response.json()) as { ok: boolean; value?: Record<string, unknown>; error?: { code: string } };
  return { status: response.status, ok: envelope.ok, ...(envelope.value === undefined ? {} : { value: envelope.value }), ...(envelope.error === undefined ? {} : { code: envelope.error.code }) };
}

/**
 * テスト用: 状態（EXP の残高と訪問の件数）を読む。
 * @param r サーバー
 * @param session セッションの Cookie
 * @returns 残高・訪問の件数・発見の件数
 */
async function stateOf(r: Running, session: string): Promise<{ readonly balance: number; readonly visits: number; readonly discoveries: number }> {
  const body = (await (await get(`${r.origin}/api/app/state`, session)).json()) as {
    value: { traveler: { visits: unknown[]; discoveries: unknown[] }; balance: number };
  };
  return { balance: body.value.balance, visits: body.value.traveler.visits.length, discoveries: body.value.traveler.discoveries.length };
}

describe('利用者の発見・訪問（サーバーが正）', () => {
  const OP1 = '0f8fad5b-d9cb-469f-a165-000000000001';
  const OP2 = '0f8fad5b-d9cb-469f-a165-000000000002';

  it('ログインしていなければ 401', async () => {
    const r = (await start())!;
    expect((await post(r, '/api/app/visits', { operationId: OP1, spotId: 'l_mm01', position: TENMANGU })).status).toBe(401);
    expect((await get(`${r.origin}/api/app/state`)).status).toBe(401);
  });

  it('スポットの近くで訪問すると、訪問と EXP がサーバーに記録され、イベントが返る', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    expect(await stateOf(r, session)).toEqual({ balance: 0, visits: 0, discoveries: 0 });
    const visited = await post(r, '/api/app/visits', { operationId: OP1, spotId: 'l_mm01', position: TENMANGU }, session);
    expect(visited.status).toBe(200);
    expect(visited.value).toMatchObject({ spotId: 'l_mm01', duplicate: false });
    const types = (visited.value?.['events'] as { type: string }[]).map((e) => e.type);
    expect(types).toContain('SpotVisited');
    expect(types).toContain('PointsAwarded');
    const state = await stateOf(r, session);
    expect(state.visits).toBe(1);
    expect(state.balance).toBeGreaterThan(0);
    const rows = await r.sql.query('SELECT count(*)::integer AS n FROM ledger_entries');
    expect(rows[0]?.['n']).toBeGreaterThan(0);
  });

  it('同じ操作ID の送り直しは二重に数えない。同じ日の2回目の訪問は断る', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    await post(r, '/api/app/visits', { operationId: OP1, spotId: 'l_mm01', position: TENMANGU }, session);
    const before = await stateOf(r, session);
    const replay = await post(r, '/api/app/visits', { operationId: OP1, spotId: 'l_mm01', position: TENMANGU }, session);
    expect(replay.value).toMatchObject({ duplicate: true });
    const again = await post(r, '/api/app/visits', { operationId: OP2, spotId: 'l_mm01', position: TENMANGU }, session);
    expect(again.code).toBe('ALREADY_VISITED_TODAY');
    expect(await stateOf(r, session)).toEqual(before);
  });

  it('離れた位置からの訪問・粗い精度の訪問は断り、何も記録しない', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    const far = await post(r, '/api/app/visits', { operationId: OP1, spotId: 'l_mm01', position: { ...TENMANGU, lat: TENMANGU.lat + 0.01 } }, session);
    expect(far.code).toBe('OUT_OF_RANGE');
    const vague = await post(r, '/api/app/visits', { operationId: OP2, spotId: 'l_mm01', position: { ...TENMANGU, accuracyM: 500 } }, session);
    expect(vague.code).toBe('LOW_ACCURACY');
    expect(await stateOf(r, session)).toEqual({ balance: 0, visits: 0, discoveries: 0 });
  });

  it('端末が EXP や日付を送っても使わない（SEC-21）', async () => {
    const r = (await start())!;
    const honest = await login(r, '1');
    const cheater = await login(r, '2');
    await post(r, '/api/app/visits', { operationId: OP1, spotId: 'l_mm01', position: TENMANGU }, honest);
    await post(r, '/api/app/visits', { operationId: OP2, spotId: 'l_mm01', position: TENMANGU, points: 99999, localDate: '2020-01-01', travelerId: 't_someoneelse' }, cheater);
    expect((await stateOf(r, cheater)).balance).toBe((await stateOf(r, honest)).balance);
  });

  it('位置の無い・壊れた本文、知らないスポットは断る', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    expect((await post(r, '/api/app/visits', { operationId: OP1, spotId: 'l_mm01' }, session)).status).toBe(400);
    expect((await post(r, '/api/app/visits', { operationId: OP1, spotId: 'l_mm01', position: { lat: 999, lng: 0, accuracyM: 1 } }, session)).status).toBe(400);
    expect((await post(r, '/api/app/visits', { operationId: 'x', spotId: 'l_mm01', position: TENMANGU }, session)).status).toBe(400);
    expect((await post(r, '/api/app/visits', { operationId: OP1, spotId: 'l_zz99', position: TENMANGU }, session)).code).toBe('SPOT_NOT_FOUND');
  });

  it('近くのスポットを発見し、2回目は新しい発見が無い', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    const first = await post(r, '/api/app/discoveries', { operationId: OP1, position: TENMANGU }, session);
    expect(first.status).toBe(200);
    expect((first.value?.['newlyDiscovered'] as { id: string }[]).map((s) => s.id)).toContain('l_mm01');
    const second = await post(r, '/api/app/discoveries', { operationId: OP2, position: TENMANGU }, session);
    expect(second.value?.['newlyDiscovered']).toEqual([]);
    expect((await stateOf(r, session)).discoveries).toBeGreaterThan(0);
  });

  it('同時に届いた2つの訪問（別の操作ID）でも、記録されるのは1回だけ', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    await stateOf(r, session);
    const results = await Promise.all([OP1, OP2].map((operationId) => post(r, '/api/app/visits', { operationId, spotId: 'l_mm01', position: TENMANGU }, session)));
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect((await stateOf(r, session)).visits).toBe(1);
  });
});

describe('利用者の書き込みのまとまり・移動の妥当性・購入', () => {
  const OP = (n: number): string => `0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, '0')}`;
  /** 天満宮の近くのお店（s_mm01）と、別の地区の名所（l_tm01。約 1.2km 先） */
  const SHOP = { lat: 34.6959, lng: 135.51185, accuracyM: 10 };
  const FAR_LANDMARK = { lat: 34.70659, lng: 135.51262, accuracyM: 10 };

  it('加点の保存が失敗したら訪問ごと取り消し、送り直すと訪問と EXP の両方が付く（DI-12）', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    await r.sql.execScript('ALTER TABLE ledger_entries RENAME TO ledger_entries_broken');
    const failed = await post(r, '/api/app/visits', { operationId: OP(1), spotId: 'l_mm01', position: TENMANGU }, session);
    await r.sql.execScript('ALTER TABLE ledger_entries_broken RENAME TO ledger_entries');
    expect(failed.status).toBe(503);
    expect(await stateOf(r, session)).toEqual({ balance: 0, visits: 0, discoveries: 0 });
    const retried = await post(r, '/api/app/visits', { operationId: OP(1), spotId: 'l_mm01', position: TENMANGU }, session);
    expect(retried.value).toMatchObject({ duplicate: false });
    const state = await stateOf(r, session);
    expect(state.visits).toBe(1);
    expect(state.balance).toBeGreaterThan(0);
  });

  it('自分の PC 用（開発用ログイン＋demoWalk）は、地図タップの速い移動からの訪問も受け付ける', async () => {
    const r = (await start('demo', false, true))!;
    const session = await login(r, '1');
    await post(r, '/api/app/visits', { operationId: OP(1), spotId: 'l_mm01', position: TENMANGU }, session);
    const jumped = await post(r, '/api/app/visits', { operationId: OP(2), spotId: 'l_tm01', position: FAR_LANDMARK }, session);
    expect(jumped.value).toMatchObject({ spotId: 'l_tm01', duplicate: false });
    expect((await stateOf(r, session)).visits).toBe(2);
  });

  it('前回の訪問から速すぎる移動の申告は断り、時間がたてば受け付ける（DI-14）', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    await post(r, '/api/app/visits', { operationId: OP(1), spotId: 'l_mm01', position: TENMANGU }, session);
    const jumped = await post(r, '/api/app/visits', { operationId: OP(2), spotId: 'l_tm01', position: FAR_LANDMARK }, session);
    expect(jumped.code).toBe('TOO_FAST');
    expect((await stateOf(r, session)).visits).toBe(1);
    r.advance(10 * 60 * 1000);
    const walked = await post(r, '/api/app/visits', { operationId: OP(2), spotId: 'l_tm01', position: FAR_LANDMARK }, session);
    expect(walked.value).toMatchObject({ spotId: 'l_tm01', duplicate: false });
  });

  it('お店の近くでの購入に EXP が付き、同じ操作ID の送り直しは二重に付かない。離れていれば断る', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    const far = await post(r, '/api/app/purchases', { operationId: OP(1), spotId: 's_mm01', position: FAR_LANDMARK }, session);
    expect(far.ok).toBe(false);
    const bought = await post(r, '/api/app/purchases', { operationId: OP(2), spotId: 's_mm01', position: SHOP }, session);
    expect(bought.value).toMatchObject({ spotId: 's_mm01', duplicate: false });
    expect(bought.value?.['points']).toBeGreaterThan(0);
    const balance = (await stateOf(r, session)).balance;
    expect(balance).toBe(bought.value?.['points']);
    const replay = await post(r, '/api/app/purchases', { operationId: OP(2), spotId: 's_mm01', position: SHOP }, session);
    expect(replay.value).toMatchObject({ duplicate: true });
    expect((await stateOf(r, session)).balance).toBe(balance);
    expect((await post(r, '/api/app/purchases', { operationId: OP(3), spotId: 'l_mm01', position: TENMANGU }, session)).code).toBe('NOT_SHOP');
  });

  it('訪問をしない利用者でも、離れたお店での続けての購入は移動が速すぎるとして断る（DI-14。前回の購入が起点）', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    const farShop = { lat: 34.7127, lng: 135.5107, accuracyM: 10 }; // s_tr04（s_mm01 から約 1.9km）
    expect((await post(r, '/api/app/purchases', { operationId: OP(1), spotId: 's_mm01', position: SHOP }, session)).value).toMatchObject({ duplicate: false });
    const jumped = await post(r, '/api/app/purchases', { operationId: OP(2), spotId: 's_tr04', position: farShop }, session);
    expect(jumped.code).toBe('TOO_FAST');
    expect((await stateOf(r, session)).visits).toBe(0);
    r.advance(15 * 60 * 1000);
    expect((await post(r, '/api/app/purchases', { operationId: OP(2), spotId: 's_tr04', position: farShop }, session)).value).toMatchObject({ spotId: 's_tr04', duplicate: false });
  });

  it('チケットは、壊れた入力・持っていないものを断り、サーバーの失敗にはしない', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    expect((await post(r, '/api/app/tickets/use', { operationId: OP(1), ticketId: 'x', position: SHOP }, session)).status).toBe(400);
    const notOwned = await post(r, '/api/app/tickets/use', { operationId: OP(2), ticketId: 'c_mm02', position: SHOP }, session);
    expect(notOwned.status).toBeLessThan(500);
    expect((await stateOf(r, session)).balance).toBe(0);
  });
});

describe('利用者アプリのコンテナをサーバーにつなぐ（VITE_APP_BACKEND=server）', () => {
  /**
   * テスト用: セッションの Cookie を付けて呼ぶ API の依存（ブラウザなら同じオリジンの Cookie が自動で付く）。
   * @param r サーバー
   * @param session セッションの Cookie（無ければ未ログイン）
   * @returns ApiClientDeps
   */
  function apiOf(r: Running, session?: string): ApiClientDeps {
    return {
      baseUrl: r.origin,
      fetch: (input, init) => fetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), Origin: r.origin, ...(session === undefined ? {} : { Cookie: session }) } }),
    };
  }

  it('ログインしていなければ UNAUTHENTICATED で起動しない', async () => {
    const r = (await start())!;
    const container = await createContainer({ mode: 'demo', store: new InMemoryKeyValueStore(), fetchText: nodeFetchText('public/master'), appBackend: 'server', appApi: apiOf(r) });
    expect(container.ok).toBe(false);
    if (!container.ok) expect(container.error.code).toBe('UNAUTHENTICATED');
  });

  it('画面の訪問がサーバーで実行され、イベントが届き、読み取り系はサーバーの記録を映す。端末には記録を保存しない', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    const store = new InMemoryKeyValueStore();
    const services = must(await createContainer({ mode: 'demo', store, fetchText: nodeFetchText('public/master'), appBackend: 'server', appApi: apiOf(r, session) }));
    const seen: string[] = [];
    services.events.subscribe('SpotVisited', async (e) => { seen.push(e.type); });
    services.events.subscribe('PointsAwarded', async (e) => { seen.push(e.type); });
    must(await services.demo!.moveTo.execute({ lat: TENMANGU.lat, lng: TENMANGU.lng }));
    const visited = must(await services.visit.execute({ operationId: '0f8fad5b-d9cb-469f-a165-0000000000c1', spotId: 'l_mm01' }));
    expect(visited).toMatchObject({ spotId: 'l_mm01', duplicate: false });
    expect(seen).toEqual(['SpotVisited', 'PointsAwarded']);
    const server = await stateOf(r, session);
    expect(server.visits).toBe(1);
    const detail = must(await services.spotDetail.execute({ spotId: 'l_mm01' }));
    expect(detail).toMatchObject({ status: 'visited', visitCount: 1, visitedToday: true });
    const again = await services.visit.execute({ operationId: '0f8fad5b-d9cb-469f-a165-0000000000c2', spotId: 'l_mm01' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('ALREADY_VISITED_TODAY');
    expect(Object.keys(store.snapshot()).filter((k) => k.includes('traveler.') || k.includes('ledger.'))).toEqual([]);
  });

  it('別の端末（別のコンテナ）で起動しても同じ記録が見える', async () => {
    const r = (await start())!;
    const session = await login(r, '1');
    const options = { mode: 'demo' as const, fetchText: nodeFetchText('public/master'), appBackend: 'server' as const };
    const phone = must(await createContainer({ ...options, store: new InMemoryKeyValueStore(), appApi: apiOf(r, session) }));
    must(await phone.demo!.moveTo.execute({ lat: TENMANGU.lat, lng: TENMANGU.lng }));
    must(await phone.visit.execute({ operationId: '0f8fad5b-d9cb-469f-a165-0000000000d1', spotId: 'l_mm01' }));
    const tablet = must(await createContainer({ ...options, store: new InMemoryKeyValueStore(), appApi: apiOf(r, await login(r, '1')) }));
    const rank = must(await tablet.rankStatus.execute());
    expect(JSON.stringify(rank)).toContain(String((await stateOf(r, session)).balance));
  });
});
