import { describe, expect, it } from 'vitest';
import { createTestWorld, must } from '@/application/testing/fakes';
import { InMemoryDataPort } from '@/application/testing/InMemoryDataPort';
import { DeleteAllDataUseCase } from '@/application/usecases/settings/DeleteAllDataUseCase';
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, ExportDataUseCase } from '@/application/usecases/settings/ExportDataUseCase';

describe('ExportDataUseCase', () => {
  it('保存データをキーごとにまとめた JSON と、日付入りのファイル名を返す（DI-21）', async () => {
    const tw = createTestWorld();
    const userData = new InMemoryDataPort({ settings: { textScale: 'large' }, 'traveler.t_abc': { visits: [] } });
    const out = must(await new ExportDataUseCase({ userData, clock: tw.clock, demo: false }).execute());
    expect(out.filename).toBe(`machiquest-data-${tw.clock.today()}.json`);
    expect(out.entryCount).toBe(2);
    expect(JSON.parse(out.content)).toEqual({
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: tw.clock.now(),
      build: 'production',
      entries: { settings: { textScale: 'large' }, 'traveler.t_abc': { visits: [] } },
    });
  });

  it('デモではファイル名と中身にデモと記す', async () => {
    const tw = createTestWorld();
    const out = must(await new ExportDataUseCase({ userData: new InMemoryDataPort(), clock: tw.clock, demo: true }).execute());
    expect(out.filename).toBe(`machiquest-demo-data-${tw.clock.today()}.json`);
    expect(JSON.parse(out.content)).toMatchObject({ build: 'demo', entries: {} });
  });
});

describe('DeleteAllDataUseCase', () => {
  it('確認済みなら、すべて消して件数を返す（PRV-05）', async () => {
    const userData = new InMemoryDataPort({ session: {}, settings: {}, 'ledger.t_abc': {} });
    expect(must(await new DeleteAllDataUseCase({ userData }).execute({ confirmed: true }))).toEqual({ removed: 3 });
    expect(userData.size()).toBe(0);
  });

  it('確認していなければ INVALID_INPUT で、何も消さない', async () => {
    const userData = new InMemoryDataPort({ session: {} });
    const result = await new DeleteAllDataUseCase({ userData }).execute({ confirmed: false });
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    expect(userData.size()).toBe(1);
  });

  it('消せなかったら STORAGE_FAILED を返す', async () => {
    const userData = new InMemoryDataPort({ session: {} });
    userData.failNextDelete = true;
    const result = await new DeleteAllDataUseCase({ userData }).execute({ confirmed: true });
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });
});
