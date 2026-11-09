import { describe, expect, it } from 'vitest';
import { parseTravelerId } from '@/Common/types/Id';
import { createTestWorld, must, seedTraveler, TEST_TRAVELER_ID } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { createScenarioWorld } from '@/application/testing/scenarioCatalog';
import { EnsureTravelerUseCase } from '@/application/usecases/session/EnsureTravelerUseCase';
import { persistNewTraveler } from '@/application/usecases/session/TravelerSetup';
import { Traveler } from '@/domain/exploration/Traveler';
import { PointLedger } from '@/domain/reward/PointLedger';
import { holderKey } from '@/domain/competition/LordHolder';

/** テスト用の UUID（crypto.randomUUID の形） */
const UUID = '0F8FAD5B-D9CB-469F-A165-70867728950E';

/**
 * テスト用のユースケースを作る（UUID 発行の呼び出し回数も数える）。
 * @param tw テスト用の世界
 * @param demo デモビルドとして動かすか
 * @param uuid UUID 発行の戻り値
 * @returns ユースケースと呼び出し回数の参照
 */
function ensureFor(tw: TestWorld, demo: boolean, uuid = UUID): { useCase: EnsureTravelerUseCase; calls: () => number } {
  let count = 0;
  const useCase = new EnsureTravelerUseCase({ ...tw, demo, uuid: () => { count += 1; return uuid; } });
  return { useCase, calls: () => count };
}

describe('EnsureTravelerUseCase', () => {
  it('セッションの旅人が保存済みなら何もしない（created=false）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const saves = tw.travelers.saveCount;
    const { useCase, calls } = ensureFor(tw, true);
    expect(must(await useCase.execute())).toEqual({ travelerId: TEST_TRAVELER_ID, profile: 'user', created: false });
    expect(tw.travelers.saveCount).toBe(saves);
    expect(calls()).toBe(0);
  });

  it('デモビルドで旅人がいなければ「通い慣れた人」のシードを作ってアクティブにする（D14）', async () => {
    const tw = createScenarioWorld({ allRivals: true });
    const output = must(await ensureFor(tw, true).useCase.execute());
    expect(output).toEqual({ travelerId: 't_demoregular', profile: 'regular', created: true });
    expect(tw.session.current.activeTravelerId).toBe('t_demoregular');
    const traveler = must(await tw.travelers.findById(must(parseTravelerId('t_demoregular'))));
    expect(traveler?.visits).toHaveLength(45);
    expect(must(await tw.ledgers.find(must(parseTravelerId('t_demoregular')))).balance()).toBe(600);
    const board = must(await tw.lordships.find(must(parseTravelerId('t_demoregular'))));
    expect(Object.fromEntries(board.entries.map((e) => [e.districtId, e.holder && holderKey(e.holder)]))).toMatchObject({ d_tenma: 'traveler', d_minamimori: 'rival:r_taro' });
  });

  it('デモビルドで保存済みの「通い慣れた人」が今のシードより古ければ作り直し、最新のシードなら作り直さない', async () => {
    const tw = createScenarioWorld({ allRivals: true });
    const id = must(parseTravelerId('t_demoregular'));
    must(await persistNewTraveler(tw, { traveler: Traveler.create(id, '通い慣れた人', 'regular'), ledger: PointLedger.empty(id), today: tw.clock.today() }));
    expect(must(await ensureFor(tw, true).useCase.execute())).toEqual({ travelerId: 't_demoregular', profile: 'regular', created: true });
    expect(must(await tw.travelers.findById(id))?.visits).toHaveLength(45);
    expect(must(await ensureFor(tw, true).useCase.execute())).toEqual({ travelerId: 't_demoregular', profile: 'regular', created: false });
  });

  it('本番ビルドでは古いシードの判定をしない（保存済みの旅人をそのまま使う）', async () => {
    const tw = createScenarioWorld({ allRivals: true });
    const id = must(parseTravelerId('t_demoregular'));
    must(await persistNewTraveler(tw, { traveler: Traveler.create(id, '通い慣れた人', 'regular'), ledger: PointLedger.empty(id), today: tw.clock.today() }));
    expect(must(await ensureFor(tw, false).useCase.execute())).toMatchObject({ travelerId: 't_demoregular', created: false });
    expect(must(await tw.travelers.findById(id))?.visits).toHaveLength(0);
  });

  it('本番ビルドでは UUID から端末ID（t_ ＋ 16進32桁）を作り、profile user・既定の表示名で保存する', async () => {
    const tw = createTestWorld();
    const { useCase, calls } = ensureFor(tw, false);
    const output = must(await useCase.execute());
    expect(output).toEqual({ travelerId: 't_0f8fad5bd9cb469fa16570867728950e', profile: 'user', created: true });
    expect(calls()).toBe(1);
    const id = must(parseTravelerId(output.travelerId));
    const traveler = must(await tw.travelers.findById(id));
    expect([traveler?.nickname, traveler?.visits.length, traveler?.version]).toEqual(['旅人', 0, 1]);
    expect(tw.session.current.activeTravelerId).toBe(id);
    expect(tw.ledgers.saveCount).toBe(0);
  });

  it('本番ビルドでも主の初期状態（背景活動のあるライバル）を計算して保存する', async () => {
    const tw = createTestWorld();
    const output = must(await ensureFor(tw, false).useCase.execute());
    const board = must(await tw.lordships.find(must(parseTravelerId(output.travelerId))));
    expect(board.version).toBe(1);
    expect(Object.fromEntries(board.entries.map((e) => [e.districtId, e.holder && holderKey(e.holder)]))).toEqual({ d_joka: 'rival:r_taro', d_minato: 'rival:r_hana' });
  });

  it('セッションにあるが保存されていない旅人は作り直す', async () => {
    const tw = createTestWorld();
    must(await tw.session.save({ activeTravelerId: TEST_TRAVELER_ID }));
    const output = must(await ensureFor(tw, false).useCase.execute());
    expect(output.created).toBe(true);
    expect(tw.session.current.activeTravelerId).toBe(output.travelerId);
  });

  it('UUID が不正なら INVALID_INPUT で何も保存しない', async () => {
    const tw = createTestWorld();
    const result = await ensureFor(tw, false, 'not a uuid!').useCase.execute();
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    expect(tw.travelers.size).toBe(0);
    expect(tw.session.current.activeTravelerId).toBeUndefined();
  });

  it('セッションの読込に失敗したら STORAGE_FAILED（壊れたデータを上書きしない）', async () => {
    const tw = createTestWorld();
    tw.session.failures.failNext('load');
    const result = await ensureFor(tw, false).useCase.execute();
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(tw.travelers.size).toBe(0);
  });

  it('旅人の読込に失敗したら STORAGE_FAILED', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    tw.travelers.failures.failNext('findById');
    const result = await ensureFor(tw, true).useCase.execute();
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });

  it('旅人の保存に失敗したらセッションを切り替えない', async () => {
    const tw = createTestWorld();
    tw.travelers.failures.failNext('save');
    const result = await ensureFor(tw, false).useCase.execute();
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(tw.session.current.activeTravelerId).toBeUndefined();
  });
});
