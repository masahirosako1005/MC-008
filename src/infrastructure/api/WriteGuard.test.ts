/**
 * @file 書込系の二重登録の防止のテスト（infrastructure/api 層・テスト。DI-07）
 */
import { describe, expect, it } from 'vitest';
import type { FetchFn } from '@/infrastructure/api/requestApi';
import { WriteGuard } from '@/infrastructure/api/WriteGuard';

/** テスト用: 送られた操作ID を記録し、決めた順に応答する fetch（'down' はつながらない） */
function fakeServer(answers: ('ok' | 'down')[]): { readonly fetch: FetchFn; readonly operationIds: string[] } {
  const operationIds: string[] = [];
  const fetchFn: FetchFn = async (_input, init) => {
    operationIds.push((JSON.parse(String(init.body)) as { operationId: string }).operationId);
    await new Promise((done) => setTimeout(done, 5));
    if ((answers.length > 1 ? answers.shift() : answers[0]) === 'down') throw new TypeError('fetch failed');
    return new Response('{"ok":true,"value":1}', { status: 200 });
  };
  return { fetch: fetchFn, operationIds };
}

const req = (operationId: string, title = '試食会'): { method: 'POST'; path: string; body: unknown } => ({ method: 'POST', path: '/api/cms/shops/s_mm04/events', body: { title, operationId } });

describe('WriteGuard', () => {
  it('同じ内容の要求が送信中なら（連打）、新しく送らずに同じ結果を返す', async () => {
    const server = fakeServer(['ok']);
    const guard = new WriteGuard();
    const [a, b] = await Promise.all([guard.send({ fetch: server.fetch }, req('op-1')), guard.send({ fetch: server.fetch }, req('op-2'))]);
    expect(a.ok && b.ok).toBe(true);
    expect(server.operationIds).toEqual(['op-1']);
  });

  it('結果が分からない失敗のあとに同じ内容を送り直すと、前と同じ操作ID で送る', async () => {
    const server = fakeServer(['down', 'ok', 'ok']);
    const guard = new WriteGuard();
    expect((await guard.send({ fetch: server.fetch }, req('op-1'))).ok).toBe(false);
    expect((await guard.send({ fetch: server.fetch }, req('op-2'))).ok).toBe(true);
    expect((await guard.send({ fetch: server.fetch }, req('op-3'))).ok).toBe(true);
    expect(server.operationIds).toEqual(['op-1', 'op-1', 'op-3']);
  });

  it('内容が違えば別の要求として送る', async () => {
    const server = fakeServer(['ok']);
    const guard = new WriteGuard();
    await Promise.all([guard.send({ fetch: server.fetch }, req('op-1', 'A')), guard.send({ fetch: server.fetch }, req('op-2', 'B'))]);
    expect(server.operationIds.sort()).toEqual(['op-1', 'op-2']);
  });
});
