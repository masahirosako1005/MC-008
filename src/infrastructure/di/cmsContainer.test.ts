/**
 * @file 店舗CMS（デモ）→ 利用者アプリ の統合テスト（infrastructure/di 層・テスト。docs/09 §8.1・§8.2）
 * 本物の cmsContainer と container（デモ）を、同じメモリのキー・値ストアと public/master の実マスタでつなぎ、
 * CMS で登録・保存した内容が利用者アプリのスポット詳細・期限カードに出ることを確かめる。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { AppServices } from '@/application/AppServices';
import type { CmsServices } from '@/application/CmsServices';
import { createCmsContainer } from '@/infrastructure/di/cmsContainer';
import { createContainer } from '@/infrastructure/di/container';
import { uuid } from '@/infrastructure/random/CryptoIdGenerator';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';

/** 実時刻の代わり（2026-11-09 10:00 JST） */
const NOW_MS = Date.parse('2026-11-09T01:00:00.000Z');
const MASTER_DIR = resolve(process.cwd(), 'public/master');

/** テスト用: 成功値を取り出す（失敗ならコード付きで投げる） */
function must<T>(result: Result<T, AppError<string>>): T {
  if (!result.ok) throw new Error(`期待しない失敗: ${result.error.code} ${result.error.message}`);
  return result.value;
}

/** テスト用: public/master の実ファイルを読む取得関数 */
async function fetchFromDisk(fileName: string): Promise<Result<string>> {
  try {
    return ok(readFileSync(resolve(MASTER_DIR, fileName), 'utf8'));
  } catch (error) {
    return fail(AppError.of('MASTER_FETCH_FAILED', 'x', { fileName }, error));
  }
}

/** テスト用: 同じ保存先で利用者アプリ（デモ）と CMS を起動する */
async function boot(store: InMemoryKeyValueStore): Promise<{ readonly app: AppServices; readonly cms: CmsServices }> {
  const opts = { mode: 'demo' as const, store, fetchText: fetchFromDisk, nowMs: (): number => NOW_MS };
  return { app: must(await createContainer(opts)), cms: must(await createCmsContainer(opts)) };
}

/** テスト用: 旅人（通い慣れた人）が発見済みで、まだクーポン・イベントの無い協力店を探す */
async function discoveredPartnerWithoutEvents(app: AppServices, cms: CmsServices): Promise<string> {
  for (const shop of must(await cms.shops.execute()).filter((s) => s.partner && s.openEvents === 0)) {
    const detail = await app.spotDetail.execute({ spotId: shop.id });
    if (detail.ok && detail.value.shopEvents.length === 0) return shop.id;
  }
  throw new Error('発見済みでクーポンの無い協力店が見つかりません');
}

describe('店舗CMS（デモ）', () => {
  it('デモ以外では作らない（MUST-8, SEC-02）', async () => {
    const result = await createCmsContainer({ mode: 'production', store: new InMemoryKeyValueStore(), fetchText: fetchFromDisk });
    expect(!result.ok && result.error.code).toBe('DEMO_DISABLED');
  });

  it('登録したクーポンと保存した営業時間・便利情報が、アプリのスポット詳細と期限カードに出る', async () => {
    const store = new InMemoryKeyValueStore();
    const first = await boot(store);
    const spotId = await discoveredPartnerWithoutEvents(first.app, first.cms);
    const registered = must(await first.cms.registerShopEvent.execute({
      spotId, kind: 'coupon', title: 'CMSテストのクーポン', description: 'レジで画面を見せてください', start: '2026-11-09', end: '2026-11-13', operationId: uuid(),
    }));
    expect(registered.events.find((e) => e.title === 'CMSテストのクーポン')).toMatchObject({ status: 'active', daysLeft: 4, source: 'cms', canWithdraw: true });
    must(await first.cms.saveShopInfo.execute({ spotId, hours: { open: '8:30', close: '17:00', closedDays: [6] }, amenities: ['toilet', 'kids'], operationId: uuid() }));

    const { app } = await boot(store);
    const detail = must(await app.spotDetail.execute({ spotId }));
    expect(detail.hours).toBe('8:30–17:00（日休）');
    expect(detail.amenities).toEqual(['kids', 'toilet']);
    expect(detail.shopEvents.map((e) => e.title)).toContain('CMSテストのクーポン');
    const reasons = must(await app.reasons.execute());
    expect(reasons.some((r) => r.kind === 'deadline' && r.spotId === spotId && r.subtitle === 'CMSテストのクーポン')).toBe(true);
  });

  it('同じ操作ID の再送は二重に登録しない（DI-07）', async () => {
    const { app, cms } = await boot(new InMemoryKeyValueStore());
    const spotId = await discoveredPartnerWithoutEvents(app, cms);
    const input = { spotId, kind: 'event', title: '試食会', description: '新作パンの試食', start: '2026-11-10', end: '2026-11-11', operationId: uuid() };
    must(await cms.registerShopEvent.execute(input));
    const again = must(await cms.registerShopEvent.execute(input));
    expect(again.events.filter((e) => e.title === '試食会')).toHaveLength(1);
  });

  it('開始日に取り下げたものはアプリに出ない。協力店でない店は登録できない', async () => {
    const store = new InMemoryKeyValueStore();
    const first = await boot(store);
    const spotId = await discoveredPartnerWithoutEvents(first.app, first.cms);
    const registered = must(await first.cms.registerShopEvent.execute({ spotId, kind: 'coupon', title: '取り下げるクーポン', description: 'x', start: '2026-11-09', end: '2026-11-12', operationId: uuid() }));
    const id = registered.events.find((e) => e.title === '取り下げるクーポン')?.id ?? '';
    const withdrawn = must(await first.cms.withdrawShopEvent.execute({ spotId, shopEventId: id, operationId: uuid() }));
    expect(withdrawn.events.find((e) => e.id === id)?.status).toBe('withdrawn');
    const { app } = await boot(store);
    expect(must(await app.spotDetail.execute({ spotId })).shopEvents.map((e) => e.title)).not.toContain('取り下げるクーポン');

    const nonPartner = must(await first.cms.shops.execute()).find((s) => !s.partner);
    const rejected = await first.cms.registerShopEvent.execute({ spotId: nonPartner?.id ?? '', kind: 'coupon', title: 'x', description: 'x', start: '2026-11-09', end: '2026-11-10', operationId: uuid() });
    expect(!rejected.ok && rejected.error.code).toBe('NOT_PARTNER');
  });

  it('名所・存在しない店・不正な ID は扱わない（SEC-16）', async () => {
    const { cms } = await boot(new InMemoryKeyValueStore());
    expect((await cms.shopInfo.execute({ spotId: 'l_mm01' })).ok).toBe(false);
    expect((await cms.shopInfo.execute({ spotId: 's_zz99' })).ok).toBe(false);
    expect((await cms.shopInfo.execute({ spotId: '<img>' })).ok).toBe(false);
  });

  it('来訪データ（ダミー）は毎回同じで、少数は秘匿する（CMS-D05）', async () => {
    const { cms } = await boot(new InMemoryKeyValueStore());
    const a = must(await cms.visitStats.execute({ spotId: 's_mm04' }));
    const b = must(await cms.visitStats.execute({ spotId: 's_mm04' }));
    expect(a).toEqual(b);
    expect(a.isDummy).toBe(true);
    const all = [...a.weekly, ...a.byWeekday, ...a.byTimeBand, ...a.effects, a.visits30d, a.visitors30d];
    for (const count of all) expect(count.suppressed || count.note !== undefined ? count.value === undefined : (count.value ?? 0) >= 5).toBe(true);
  });

  it('来店データ（ダミー）は店の事実と食い違わない（定休日・営業時間外・クーポン未掲載）', async () => {
    const store = new InMemoryKeyValueStore();
    const { cms } = await boot(store);
    must(await cms.saveShopInfo.execute({ spotId: 's_mm04', hours: { open: '11:00', close: '17:00', closedDays: [6] }, amenities: [], operationId: uuid() }));
    const stats = must(await cms.visitStats.execute({ spotId: 's_mm04' }));
    expect(stats.byWeekday.find((c) => c.label === '日')).toMatchObject({ note: '定休日' });
    expect(stats.byTimeBand.map((c) => c.label)).toEqual(['昼（11〜14時）', '午後（14〜17時）']);
    expect(stats.effects.find((c) => c.label === 'クーポンを使った人')?.note).toBe('まだ出していません');
  });
});
