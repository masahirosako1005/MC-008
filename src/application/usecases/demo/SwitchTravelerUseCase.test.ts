import { describe, expect, it } from 'vitest';
import { parseTravelerId } from '@/Common/types/Id';
import { districtOf, must, seedTraveler, testOperationId } from '@/application/testing/fakes';
import { createDemoUseCases, createScenarioWorld } from '@/application/testing/scenarioCatalog';
import type { SwitchTravelerInput } from '@/application/dto/Dto';
import { holderKey } from '@/domain/competition/LordHolder';

const REGULAR_ID = must(parseTravelerId('t_demoregular'));
const FIRST_ID = must(parseTravelerId('t_demofirst'));

describe('SwitchTravelerUseCase', () => {
  it('通い慣れた人: 日付のずらしを0に戻し、今日基準のシードを保存してアクティブにし、開始地区（南森町・天満宮）の入口へ移動する', async () => {
    const tw = createScenarioWorld();
    const demo = createDemoUseCases(tw, { enabled: true });
    tw.demo.advanceDays(30);
    const output = must(await demo.switchTraveler.execute({ profile: 'regular' }));
    expect(output).toEqual({ travelerId: 't_demoregular', profile: 'regular' });
    expect(tw.demo.offsetDays()).toBe(0);
    expect(tw.clock.today()).toBe('2026-11-09');
    expect(tw.session.current.activeTravelerId).toBe(REGULAR_ID);
    const traveler = must(await tw.travelers.findById(REGULAR_ID));
    expect(traveler?.visits.map((v) => v.localDate).at(-1)).toBe('2026-11-07');
    expect(must(await tw.ledgers.find(REGULAR_ID)).balance()).toBe(255);
    expect(tw.demo.positions.at(-1)).toEqual(districtOf(tw.spots, 'd_minamimori').entrance);
  });

  it('初回の人: 記録なしの旅人に切り替える（主の初期状態は背景活動のライバル）', async () => {
    const tw = createScenarioWorld();
    const output = must(await createDemoUseCases(tw, { enabled: true }).switchTraveler.execute({ profile: 'first' }));
    expect(output).toEqual({ travelerId: 't_demofirst', profile: 'first' });
    expect(must(await tw.travelers.findById(FIRST_ID))?.visits).toEqual([]);
    const board = must(await tw.lordships.find(FIRST_ID));
    expect(board.entries.map((e) => [e.districtId, e.holder && holderKey(e.holder)])).toEqual([['d_minamimori', 'rival:r_taro'], ['d_okawa', 'rival:r_hana']]);
  });

  it('切り替え直すと対象プロフィールのデータ（台帳・主・ライバル行動）を作り直す', async () => {
    const tw = createScenarioWorld();
    const demo = createDemoUseCases(tw, { enabled: true });
    must(await demo.switchTraveler.execute({ profile: 'regular' }));
    must(await demo.simulateRival.execute({ operationId: testOperationId(1) }));
    must(await demo.switchTraveler.execute({ profile: 'regular' }));
    expect(must(await tw.rivalActions.list(REGULAR_ID))).toEqual([]);
    expect(must(await tw.ledgers.find(REGULAR_ID)).balance()).toBe(255);
    const board = must(await tw.lordships.find(REGULAR_ID));
    expect(board.entries.find((e) => e.districtId === 'd_tenma')).toMatchObject({ holder: { type: 'traveler' }, lostByTraveler: false });
    expect(board.version).toBe(1);
  });

  it('別のプロフィールのデータには触れない', async () => {
    const tw = createScenarioWorld();
    const demo = createDemoUseCases(tw, { enabled: true });
    must(await demo.switchTraveler.execute({ profile: 'regular' }));
    must(await demo.switchTraveler.execute({ profile: 'first' }));
    expect(must(await tw.travelers.findById(REGULAR_ID))?.visits).toHaveLength(21);
    expect(tw.session.current.activeTravelerId).toBe(FIRST_ID);
  });

  it('本番の旅人がいても消さない', async () => {
    const tw = createScenarioWorld();
    const user = await seedTraveler(tw);
    must(await createDemoUseCases(tw, { enabled: true }).switchTraveler.execute({ profile: 'first' }));
    expect(must(await tw.travelers.findById(user.id))).toBeDefined();
  });

  it('不正なプロフィールは INVALID_INPUT', async () => {
    const tw = createScenarioWorld();
    const invalid = { profile: 'user' } as unknown as SwitchTravelerInput; // 実行時に画面から不正値が来た場合を再現する
    const result = await createDemoUseCases(tw, { enabled: true }).switchTraveler.execute(invalid);
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    expect(tw.travelers.size).toBe(0);
  });

  it('デモが無効なら DEMO_DISABLED で何も変えない（SEC-02）', async () => {
    const tw = createScenarioWorld();
    tw.demo.advanceDays(30);
    const result = await createDemoUseCases(tw, { enabled: false }).switchTraveler.execute({ profile: 'regular' });
    expect(result.ok ? undefined : result.error.code).toBe('DEMO_DISABLED');
    expect(tw.demo.offsetDays()).toBe(30);
    expect(tw.travelers.size).toBe(0);
  });

  it('保存に失敗したら STORAGE_FAILED でセッションを切り替えない', async () => {
    const tw = createScenarioWorld();
    tw.ledgers.failures.failNext('save');
    const result = await createDemoUseCases(tw, { enabled: true }).switchTraveler.execute({ profile: 'regular' });
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(tw.session.current.activeTravelerId).toBeUndefined();
  });
});
