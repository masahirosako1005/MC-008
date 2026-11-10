import { describe, expect, it } from 'vitest';
import { createTestWorld, must } from '@/application/testing/fakes';
import { InMemoryDataPort } from '@/application/testing/InMemoryDataPort';
import { DeleteAllDataUseCase } from '@/application/usecases/settings/DeleteAllDataUseCase';
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, ExportDataUseCase } from '@/application/usecases/settings/ExportDataUseCase';
import { IMPORT_MAX_CHARS, IMPORT_MAX_ENTRIES, ImportDataUseCase } from '@/application/usecases/settings/ImportDataUseCase';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';

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

/** テスト用: JSON を読む（壊れていれば INVALID_INPUT） */
function parseJson(text: string): Result<unknown> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch {
    return fail(AppError.of('INVALID_INPUT', 'json'));
  }
}

/** テスト用: 書き出しファイルの中身を作る */
function exportFile(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: EXPORT_FORMAT, formatVersion: EXPORT_FORMAT_VERSION, exportedAt: '2026-11-10T00:00:00.000Z', build: 'production', entries: { settings: { textScale: 'xlarge' }, 'traveler.t_abc': { visits: [1] } }, ...over });
}

describe('ImportDataUseCase', () => {
  it('書き出したファイルをそのまま読み込むと、保存データが同じ内容に戻る（DI-21 往復）', async () => {
    const tw = createTestWorld();
    const source = new InMemoryDataPort({ settings: { textScale: 'large' }, 'traveler.t_abc': { visits: [] }, 'backup.avatar.t_abc': 'not json' });
    const file = must(await new ExportDataUseCase({ userData: source, clock: tw.clock, demo: false }).execute());
    const target = new InMemoryDataPort({ session: { old: true } });
    expect(must(await new ImportDataUseCase({ userData: target, demo: false, parseJson }).execute({ content: file.content, confirmed: true }))).toEqual({ written: 3 });
    expect(must(await target.readAll())).toEqual(must(await source.readAll()));
  });

  it('確認していなければ INVALID_INPUT で、何も変えない', async () => {
    const userData = new InMemoryDataPort({ session: {} });
    const result = await new ImportDataUseCase({ userData, demo: false, parseJson }).execute({ content: exportFile(), confirmed: false });
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    expect(must(await userData.readAll())).toEqual([{ key: 'session', value: {} }]);
  });

  it.each([
    ['JSON として壊れている', '{"format":', 'json'],
    ['空のファイル', '', 'size'],
    ['大きすぎる', ' '.repeat(IMPORT_MAX_CHARS + 1), 'size'],
    ['ほかのアプリのファイル', exportFile({ format: 'other-app' }), 'format'],
    ['知らない版', exportFile({ formatVersion: 2 }), 'version'],
    ['デモで書き出したファイルを本番に', exportFile({ build: 'demo' }), 'build'],
    ['entries が配列', exportFile({ entries: [] }), 'entries'],
    ['中身が0件', exportFile({ entries: {} }), 'count'],
    ['キーの書式が違う', exportFile({ entries: { '../x': 1 } }), 'key'],
    ['__proto__ のキー', `{"format":"${EXPORT_FORMAT}","formatVersion":${EXPORT_FORMAT_VERSION},"build":"production","entries":{"__proto__":{"a":1}}}`, 'key'],
  ])('%s は読み込まず、何も変えない', async (_name, content, rule) => {
    const userData = new InMemoryDataPort({ session: { keep: true } });
    const result = await new ImportDataUseCase({ userData, demo: false, parseJson }).execute({ content, confirmed: true });
    expect(result.ok ? undefined : [result.error.code, result.error.details?.['rule']]).toEqual(['INVALID_INPUT', rule]);
    expect(must(await userData.readAll())).toEqual([{ key: 'session', value: { keep: true } }]);
  });

  it('件数が上限を超えるファイルは読み込まない', async () => {
    const entries = Object.fromEntries(Array.from({ length: IMPORT_MAX_ENTRIES + 1 }, (_, i) => [`k${i}`, i]));
    const result = await new ImportDataUseCase({ userData: new InMemoryDataPort(), demo: false, parseJson }).execute({ content: exportFile({ entries }), confirmed: true });
    expect(result.ok ? undefined : result.error.details?.['rule']).toBe('count');
  });

  it('書き込めなかったら STORAGE_FAILED を返す', async () => {
    const userData = new InMemoryDataPort({ session: {} });
    userData.failNextReplace = true;
    const result = await new ImportDataUseCase({ userData, demo: false, parseJson }).execute({ content: exportFile(), confirmed: true });
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(userData.size()).toBe(1);
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
