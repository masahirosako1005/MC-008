/**
 * @file リポジトリの契約テスト（infrastructure/storage 層・テスト）
 * application のテストが使う偽物（application/testing/fakes）と、本番の localStorage 実装が
 * 同じ契約（未保存の既定値・version+1・CONFLICT・delete・operationId の冪等）で振る舞うことを、同じ仕様で突き合わせる（DI-07, DI-10）。
 */
import { describe, expect, it } from 'vitest';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId, parseOperationId, parseRivalId, parseTravelerId } from '@/Common/types/Id';
import type { TravelerId } from '@/Common/types/Id';
import { jstInstantOf } from '@/Common/utils/date';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import {
  buildTestCatalog,
  buildTraveler,
  InMemoryLordshipRepository,
  InMemoryPointLedgerRepository,
  InMemoryRivalActionRepository,
  InMemorySessionRepository,
  InMemoryTravelerRepository,
  must,
  spotOf,
  TEST_TODAY,
} from '@/application/testing/fakes';
import { rivalHolder, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';
import { LordshipBoard } from '@/domain/competition/LordshipBoard';
import type { LordshipRepository } from '@/domain/competition/LordshipRepository';
import type { RivalActionVisit } from '@/domain/competition/Rival';
import type { RivalActionRepository } from '@/domain/competition/RivalRepository';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import { createLedgerEntry, PointLedger } from '@/domain/reward/PointLedger';
import type { PointLedgerRepository } from '@/domain/reward/PointLedgerRepository';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { LocalStorageLordshipRepository } from '@/infrastructure/storage/LocalStorageLordshipRepository';
import { LocalStoragePointLedgerRepository } from '@/infrastructure/storage/LocalStoragePointLedgerRepository';
import { LocalStorageRivalActionRepository } from '@/infrastructure/storage/LocalStorageRivalActionRepository';
import { LocalStorageSessionRepository } from '@/infrastructure/storage/LocalStorageSessionRepository';
import { LocalStorageTravelerRepository } from '@/infrastructure/storage/LocalStorageTravelerRepository';

/** 契約を確かめるリポジトリ一式 */
interface RepoSet {
  readonly travelers: TravelerRepository;
  readonly ledgers: PointLedgerRepository;
  readonly lordships: LordshipRepository;
  readonly rivalActions: RivalActionRepository;
  readonly session: SessionRepository;
}

const TRAVELER_ID: TravelerId = must(parseTravelerId('t_test01'));
const OTHER_ID: TravelerId = must(parseTravelerId('t_test02'));
const SPOTS = buildTestCatalog().spots;
const HONMACHI = must(parseDistrictId('d_honmachi'));
const TARO = rivalHolder(must(parseRivalId('r_taro')));
const OPERATION_A = must(parseOperationId('11111111-2222-4333-8444-555555555555'));
const OPERATION_B = must(parseOperationId('11111111-2222-4333-8444-666666666666'));

/** 偽物（application/testing/fakes）の一式 */
function fakeRepos(): RepoSet {
  return {
    travelers: new InMemoryTravelerRepository(),
    ledgers: new InMemoryPointLedgerRepository(),
    lordships: new InMemoryLordshipRepository(),
    rivalActions: new InMemoryRivalActionRepository(),
    session: new InMemorySessionRepository(),
  };
}

/** 本番の localStorage 実装（メモリのキー・値ストア上）の一式 */
function storageRepos(): RepoSet {
  const deps = { store: new InMemoryKeyValueStore(), prefix: 'nnishi.' };
  return {
    travelers: new LocalStorageTravelerRepository(deps),
    ledgers: new LocalStoragePointLedgerRepository(deps),
    lordships: new LocalStorageLordshipRepository(deps),
    rivalActions: new LocalStorageRivalActionRepository(deps),
    session: new LocalStorageSessionRepository(deps),
  };
}

const IMPLEMENTATIONS: readonly (readonly [string, () => RepoSet])[] = [
  ['application の偽物（fakes）', fakeRepos],
  ['infrastructure の localStorage 実装', storageRepos],
];

/** 失敗コードを取り出す（成功なら undefined） */
function codeOf(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

/** 訪問1件の旅人（版数 0） */
function travelerWithVisit(id: TravelerId = TRAVELER_ID): ReturnType<typeof buildTraveler> {
  return buildTraveler(SPOTS, TEST_TODAY, { id, visits: [['l_jo01', -1]] });
}

/** 訪問1件分（10点）の行を持つ台帳（版数 0） */
function ledgerWithVisit(): PointLedger {
  const entry = must(createLedgerEntry({
    operationId: OPERATION_A, kind: 'visit', points: 10, districtId: HONMACHI,
    spotId: spotOf(SPOTS, 'l_hm01').id,
    at: jstInstantOf(TEST_TODAY, 10), localDate: TEST_TODAY,
  }));
  return must(PointLedger.empty(TRAVELER_ID).append([entry]));
}

/** 本町の主を旅人→タロウと交代させた盤（取り返し中・版数 0） */
function lostBoard(): LordshipBoard {
  return LordshipBoard.empty(TRAVELER_ID).apply(HONMACHI, TRAVELER_HOLDER).board.apply(HONMACHI, TARO).board;
}

/** ライバル行動1件 */
function actionOf(operationId: RivalActionVisit['operationId'], count = 2): RivalActionVisit {
  const base = { rivalId: must(parseRivalId('r_taro')), districtId: HONMACHI, localDate: TEST_TODAY, count };
  return operationId === undefined ? base : { ...base, operationId };
}

describe.each(IMPLEMENTATIONS)('TravelerRepository の契約: %s', (_name, create) => {
  it('未保存なら ok(undefined)、削除も成功する', async () => {
    const { travelers } = create();
    expect(must(await travelers.findById(TRAVELER_ID))).toBeUndefined();
    expect((await travelers.delete(TRAVELER_ID)).ok).toBe(true);
  });

  it('save は version+1 を返し、読み直しても同じ版数と記録になる', async () => {
    const { travelers } = create();
    const first = must(await travelers.save(travelerWithVisit(), 0));
    expect(first.version).toBe(1);
    const loaded = must(await travelers.findById(TRAVELER_ID));
    expect(loaded?.version).toBe(1);
    expect(loaded?.toState()).toEqual(first.toState());
    expect(must(await travelers.save(first, 1)).version).toBe(2);
  });

  it('expectedVersion が保存済みと違えば CONFLICT で、保存内容は変わらない（DI-10）', async () => {
    const { travelers } = create();
    must(await travelers.save(travelerWithVisit(), 0));
    expect(codeOf(await travelers.save(travelerWithVisit(), 0))).toBe('CONFLICT');
    expect(codeOf(await travelers.save(travelerWithVisit(OTHER_ID), 1))).toBe('CONFLICT');
    expect(must(await travelers.findById(TRAVELER_ID))?.version).toBe(1);
  });

  it('delete で消え、消した後は版数 0 から保存し直せる', async () => {
    const { travelers } = create();
    must(await travelers.save(travelerWithVisit(), 0));
    must(await travelers.delete(TRAVELER_ID));
    expect(must(await travelers.findById(TRAVELER_ID))).toBeUndefined();
    expect(must(await travelers.save(travelerWithVisit(), 0)).version).toBe(1);
  });
});

describe.each(IMPLEMENTATIONS)('PointLedgerRepository の契約: %s', (_name, create) => {
  it('未保存なら版数 0 の空の台帳', async () => {
    const ledger = must(await create().ledgers.find(TRAVELER_ID));
    expect(ledger.version).toBe(0);
    expect(ledger.balance()).toBe(0);
  });

  it('save は version+1、古い版数は CONFLICT、delete で空に戻る', async () => {
    const { ledgers } = create();
    const saved = must(await ledgers.save(ledgerWithVisit(), 0));
    expect(saved.version).toBe(1);
    expect(must(await ledgers.find(TRAVELER_ID))).toMatchObject({ version: 1 });
    expect(must(await ledgers.find(TRAVELER_ID)).balance()).toBe(10);
    expect(codeOf(await ledgers.save(ledgerWithVisit(), 0))).toBe('CONFLICT');
    must(await ledgers.delete(TRAVELER_ID));
    expect(must(await ledgers.find(TRAVELER_ID)).version).toBe(0);
  });
});

describe.each(IMPLEMENTATIONS)('LordshipRepository の契約: %s', (_name, create) => {
  it('未保存なら版数 0・地区なしの盤', async () => {
    const board = must(await create().lordships.find(TRAVELER_ID));
    expect(board.version).toBe(0);
    expect(board.entries).toEqual([]);
  });

  it('save は version+1 で取り返し中の状態を保ち、古い版数は CONFLICT、delete で空に戻る', async () => {
    const { lordships } = create();
    expect(must(await lordships.save(lostBoard(), 0)).version).toBe(1);
    const loaded = must(await lordships.find(TRAVELER_ID));
    expect(loaded.isLostByTraveler(HONMACHI)).toBe(true);
    expect(codeOf(await lordships.save(lostBoard(), 0))).toBe('CONFLICT');
    must(await lordships.delete(TRAVELER_ID));
    expect(must(await lordships.find(TRAVELER_ID)).version).toBe(0);
  });
});

describe.each(IMPLEMENTATIONS)('RivalActionRepository の契約: %s', (_name, create) => {
  it('未保存なら空、追記した順に返し、同じ operationId は2回目を無視する（DI-07）', async () => {
    const { rivalActions } = create();
    expect(must(await rivalActions.list(TRAVELER_ID))).toEqual([]);
    must(await rivalActions.append(TRAVELER_ID, actionOf(OPERATION_A, 2)));
    must(await rivalActions.append(TRAVELER_ID, actionOf(OPERATION_A, 5)));
    must(await rivalActions.append(TRAVELER_ID, actionOf(OPERATION_B, 3)));
    expect(must(await rivalActions.list(TRAVELER_ID)).map((a) => a.count)).toEqual([2, 3]);
  });

  it('operationId の無い行動は毎回追記し、旅人ごとに分かれ、clear で消える', async () => {
    const { rivalActions } = create();
    must(await rivalActions.append(TRAVELER_ID, actionOf(undefined)));
    must(await rivalActions.append(TRAVELER_ID, actionOf(undefined)));
    expect(must(await rivalActions.list(TRAVELER_ID))).toHaveLength(2);
    expect(must(await rivalActions.list(OTHER_ID))).toEqual([]);
    must(await rivalActions.clear(TRAVELER_ID));
    expect(must(await rivalActions.list(TRAVELER_ID))).toEqual([]);
  });
});

describe.each(IMPLEMENTATIONS)('SessionRepository の契約: %s', (_name, create) => {
  it('未保存なら空、保存した旅人を読め、空で保存し直すと旅人なしに戻る', async () => {
    const { session } = create();
    expect(must(await session.load())).toEqual({});
    must(await session.save({ activeTravelerId: TRAVELER_ID }));
    expect(must(await session.load())).toEqual({ activeTravelerId: TRAVELER_ID });
    must(await session.save({}));
    expect(must(await session.load()).activeTravelerId).toBeUndefined();
  });
});
