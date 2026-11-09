import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseRivalId, parseTravelerId } from '@/Common/types/Id';
import { parseLocalDate } from '@/Common/utils/date';
import type { RivalActionVisit } from '@/domain/competition/Rival';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { LocalStorageRivalActionRepository } from '@/infrastructure/storage/LocalStorageRivalActionRepository';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const PREFIX = 'nnishi.demo.';
const TRAVELER_ID = must(parseTravelerId('t_demoregular'));
const KEY = `${PREFIX}rivalActions.${TRAVELER_ID}`;
const ACTION: RivalActionVisit = {
  rivalId: must(parseRivalId('r_taro')),
  districtId: must(parseDistrictId('d_honmachi')),
  localDate: must(parseLocalDate('2026-12-09')),
  count: 3,
  operationId: must(parseOperationId('11111111-2222-4333-8444-555555555555')),
};

/** テスト用: ストアとリポジトリ */
function setup(initial: Readonly<Record<string, string>> = {}): { store: InMemoryKeyValueStore; repo: LocalStorageRivalActionRepository } {
  const store = new InMemoryKeyValueStore(initial);
  return { store, repo: new LocalStorageRivalActionRepository({ store, prefix: PREFIX }) };
}

describe('LocalStorageRivalActionRepository', () => {
  it('未保存なら空の一覧を返す', async () => {
    const { repo } = setup();
    expect(must(await repo.list(TRAVELER_ID))).toEqual([]);
  });

  it('追記した行動を古い順に返す', async () => {
    const { repo } = setup();
    const second: RivalActionVisit = { ...ACTION, count: 1, operationId: must(parseOperationId('22222222-2222-4333-8444-555555555555')) };
    must(await repo.append(TRAVELER_ID, ACTION));
    must(await repo.append(TRAVELER_ID, second));
    expect(must(await repo.list(TRAVELER_ID))).toEqual([ACTION, second]);
  });

  it('同じ operationId の行動は2回目を無視する（DI-07）', async () => {
    const { repo } = setup();
    must(await repo.append(TRAVELER_ID, ACTION));
    must(await repo.append(TRAVELER_ID, ACTION));
    expect(must(await repo.list(TRAVELER_ID))).toHaveLength(1);
  });

  it('operationId の無い行動は毎回追記する', async () => {
    const { repo } = setup();
    const { operationId: _omit, ...withoutOperation } = ACTION;
    must(await repo.append(TRAVELER_ID, withoutOperation));
    must(await repo.append(TRAVELER_ID, withoutOperation));
    expect(must(await repo.list(TRAVELER_ID))).toHaveLength(2);
  });

  it('回数が1未満の行動は INVALID_INPUT で追記しない', async () => {
    const { repo } = setup();
    const result = await repo.append(TRAVELER_ID, { ...ACTION, count: 0 });
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    expect(must(await repo.list(TRAVELER_ID))).toEqual([]);
  });

  it('clear で旅人の世界の行動がすべて消える', async () => {
    const { repo, store } = setup();
    must(await repo.append(TRAVELER_ID, ACTION));
    must(await repo.clear(TRAVELER_ID));
    expect(store.snapshot()[KEY]).toBeUndefined();
    expect(must(await repo.list(TRAVELER_ID))).toEqual([]);
  });

  it('不正な行動（ライバルID が形式違反）を含む保存データは退避して STORAGE_FAILED', async () => {
    const data = { travelerId: TRAVELER_ID, actions: [{ ...ACTION, rivalId: 'R_TARO' }] };
    const raw = JSON.stringify({ schemaVersion: 1, version: 1, data });
    const { repo, store } = setup({ [KEY]: raw });
    const result = await repo.list(TRAVELER_ID);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(store.snapshot()[`${PREFIX}backup.rivalActions.${TRAVELER_ID}`]).toBe(raw);
  });
});
