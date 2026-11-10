import { describe, expect, it } from 'vitest';
import type { Result } from '@/Common/result/Result';
import { MEMORY_NOTE_MAX, MEMORY_PHOTO_LIMIT, MEMORY_PHOTO_MAX_CHARS } from '@/application/ports/VisitMemoryRepository';
import { createTestWorld, must, seedTraveler, TEST_TRAVELER_ID } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { InMemoryVisitMemoryRepository } from '@/application/testing/InMemoryVisitMemoryRepository';
import { GetVisitLogUseCase, monthLabelOf, shortDateLabel } from '@/application/usecases/spot/GetVisitLogUseCase';
import { normalizeNote, SaveVisitMemoryUseCase } from '@/application/usecases/spot/SaveVisitMemoryUseCase';
import { testDate } from '@/application/testing/testCatalog';

/** 失敗コードを取り出す（成功なら undefined） */
function codeOf(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

/** テスト用の小さな JPEG の data URL */
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

/** 世界＋思い出のリポジトリ＋2つのユースケースを作る */
function setup(): { tw: TestWorld; memories: InMemoryVisitMemoryRepository; log: GetVisitLogUseCase; save: SaveVisitMemoryUseCase } {
  const tw = createTestWorld();
  const memories = new InMemoryVisitMemoryRepository();
  const deps = { ...tw, memories };
  return { tw, memories, log: new GetVisitLogUseCase(deps), save: new SaveVisitMemoryUseCase(deps) };
}

describe('GetVisitLogUseCase', () => {
  it('訪問を新しい順に返し、日付・月・このスポットで何回目・地区を付ける（座標・達成率は返さない）', async () => {
    const { tw, log } = setup();
    // 今日=2026-11-09（月）
    await seedTraveler(tw, { visits: [['l_jo01', -40], ['s_jo01', -3], ['l_jo01', -3], ['l_jo01', 0]] });
    const dto = must(await log.execute());
    expect(dto.entries.map((e) => e.localDate)).toEqual(['2026-11-09', '2026-11-06', '2026-11-06', '2026-09-30']);
    expect(dto.entries[0]).toMatchObject({ spotId: 'l_jo01', nth: 3 });
    expect(dto.entries[3]).toMatchObject({ spotId: 'l_jo01', nth: 1 });
    expect(new Set(dto.entries.slice(1, 3).map((e) => e.spotId))).toEqual(new Set(['l_jo01', 's_jo01']));
    expect(dto.entries[0]).toMatchObject({ spotName: 'N西城跡', kind: 'landmark', districtId: 'd_joka', dateLabel: '11/9（月）', monthKey: '2026-11', monthLabel: '2026年11月', time: '10:00', season: 'autumn' });
    expect(dto.entries.find((e) => e.spotId === 'l_jo01' && e.localDate === '2026-11-06')?.nth).toBe(2);
    expect(dto.entries[0]?.districtName.length).toBeGreaterThan(0);
    for (const entry of dto.entries) for (const hidden of ['point', 'lat', 'lng', 'rate', 'total']) expect(entry).not.toHaveProperty(hidden);
    expect(dto).toMatchObject({ photoCount: 0, photoLimit: MEMORY_PHOTO_LIMIT, noteMax: MEMORY_NOTE_MAX, photoMaxChars: MEMORY_PHOTO_MAX_CHARS });
  });

  it('訪問が無ければ空を返す', async () => {
    const { tw, log } = setup();
    await seedTraveler(tw);
    expect(must(await log.execute()).entries).toEqual([]);
  });

  it('日付の表示は年を省いた月日と曜日、月の見出しは年と月', () => {
    expect(shortDateLabel(testDate('2026-01-04'))).toBe('1/4（日）');
    expect(monthLabelOf(testDate('2026-01-04'))).toBe('2026年1月');
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const { log } = setup();
    expect(codeOf(await log.execute())).toBe('TRAVELER_NOT_FOUND');
  });
});

describe('SaveVisitMemoryUseCase', () => {
  it('訪問した回にメモと写真を付けると、記録に出る（訪問記録は変えない）', async () => {
    const { tw, log, save } = setup();
    const before = await seedTraveler(tw, { visits: [['l_jo01', -3], ['l_jo01', 0]] });
    const out = must(await save.execute({ spotId: 'l_jo01', localDate: '2026-11-06', note: '  紅葉がきれいだった\r\n', photo: PHOTO }));
    expect(out).toEqual({ note: '紅葉がきれいだった', photo: PHOTO, photoCount: 1 });
    const dto = must(await log.execute());
    expect(dto.photoCount).toBe(1);
    expect(dto.entries.find((e) => e.localDate === '2026-11-06')).toMatchObject({ note: '紅葉がきれいだった', photo: PHOTO });
    expect(dto.entries.find((e) => e.localDate === '2026-11-09')).not.toHaveProperty('note');
    const after = must(await tw.travelers.findById(TEST_TRAVELER_ID));
    expect(after?.visits).toEqual(before.visits);
    expect(after?.version).toBe(before.version);
  });

  it('省略した項目は変えず、空文字・null で消せる。両方無くなれば思い出ごと消える', async () => {
    const { tw, memories, save } = setup();
    await seedTraveler(tw, { visits: [['l_jo01', 0]] });
    const key = { spotId: 'l_jo01', localDate: '2026-11-09' };
    must(await save.execute({ ...key, note: 'メモ', photo: PHOTO }));
    expect(must(await save.execute({ ...key, note: '書き直し' }))).toEqual({ note: '書き直し', photo: PHOTO, photoCount: 1 });
    expect(must(await save.execute({ ...key, photo: null }))).toEqual({ note: '書き直し', photoCount: 0 });
    expect(must(await save.execute({ ...key, note: '' }))).toEqual({ photoCount: 0 });
    expect(must(await memories.list(TEST_TRAVELER_ID))).toEqual([]);
  });

  it('同じ入力を2回送っても結果は同じ（冪等＝DI-07）', async () => {
    const { tw, memories, save } = setup();
    await seedTraveler(tw, { visits: [['l_jo01', 0]] });
    const input = { spotId: 'l_jo01', localDate: '2026-11-09', note: 'メモ' };
    const first = must(await save.execute(input));
    expect(must(await save.execute(input))).toEqual(first);
    expect(must(await memories.list(TEST_TRAVELER_ID))).toHaveLength(1);
  });

  it('訪問していない回には付けられない（VISIT_NOT_FOUND）', async () => {
    const { tw, memories, save } = setup();
    await seedTraveler(tw, { discovered: ['s_jo02'], visits: [['l_jo01', 0]] });
    expect(codeOf(await save.execute({ spotId: 'l_jo01', localDate: '2026-11-08', note: 'メモ' }))).toBe('VISIT_NOT_FOUND');
    expect(codeOf(await save.execute({ spotId: 's_jo02', localDate: '2026-11-09', note: 'メモ' }))).toBe('VISIT_NOT_FOUND');
    expect(memories.saveCount).toBe(0);
  });

  it('形の違う入力は INVALID_INPUT（ID・日付・長すぎるメモ・JPEG 以外や大きすぎる写真）', async () => {
    const { tw, memories, save } = setup();
    await seedTraveler(tw, { visits: [['l_jo01', 0]] });
    const key = { spotId: 'l_jo01', localDate: '2026-11-09' };
    const bad: unknown[] = [
      undefined,
      { ...key, spotId: '../x' },
      { ...key, localDate: '2026/11/09' },
      { ...key, note: 'あ'.repeat(MEMORY_NOTE_MAX + 1) },
      { ...key, note: 1 },
      { ...key, photo: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { ...key, photo: 'https://example.com/a.jpg' },
      { ...key, photo: 'javascript:alert(1)' },
      { ...key, photo: `data:image/jpeg;base64,${'A'.repeat(MEMORY_PHOTO_MAX_CHARS)}` },
    ];
    for (const input of bad) expect(codeOf(await save.execute(input as never)), JSON.stringify(input)?.slice(0, 60)).toBe('INVALID_INPUT');
    expect(must(await save.execute({ ...key, note: 'あ'.repeat(MEMORY_NOTE_MAX) })).note).toHaveLength(MEMORY_NOTE_MAX);
    expect(memories.saveCount).toBe(1);
  });

  it('写真は上限の枚数まで。上限でも差し替えとメモはできる（MEMORY_LIMIT_REACHED）', async () => {
    const { tw, save } = setup();
    const days = Array.from({ length: MEMORY_PHOTO_LIMIT + 1 }, (_, i) => -i);
    await seedTraveler(tw, { visits: days.map((d) => ['l_jo01', d] as const) });
    const dateOf = (offset: number): string => testDateOffset(tw, offset);
    for (const d of days.slice(0, MEMORY_PHOTO_LIMIT)) must(await save.execute({ spotId: 'l_jo01', localDate: dateOf(d), photo: PHOTO }));
    const over = dateOf(days[MEMORY_PHOTO_LIMIT] ?? 0);
    expect(codeOf(await save.execute({ spotId: 'l_jo01', localDate: over, photo: PHOTO }))).toBe('MEMORY_LIMIT_REACHED');
    expect(must(await save.execute({ spotId: 'l_jo01', localDate: over, note: 'メモだけ' }))).toMatchObject({ note: 'メモだけ', photoCount: MEMORY_PHOTO_LIMIT });
    expect(must(await save.execute({ spotId: 'l_jo01', localDate: dateOf(0), photo: PHOTO })).photoCount).toBe(MEMORY_PHOTO_LIMIT);
  });

  it('保存に失敗したら STORAGE_FAILED を返す', async () => {
    const { tw, memories, save } = setup();
    await seedTraveler(tw, { visits: [['l_jo01', 0]] });
    memories.failNextSave = true;
    expect(codeOf(await save.execute({ spotId: 'l_jo01', localDate: '2026-11-09', note: 'メモ' }))).toBe('STORAGE_FAILED');
  });

  it('メモは制御文字を除き、改行をそろえ、前後の空白を落とす', () => {
    expect(normalizeNote(' a\u0000b\r\nc\u001f \n')).toBe('ab\nc');
  });
});

/**
 * 今日から offset 日ずらした暦日（'YYYY-MM-DD'）を返す。
 * @param tw テスト用の世界
 * @param offset 日数（負＝過去）
 * @returns 暦日
 */
function testDateOffset(tw: TestWorld, offset: number): string {
  const base = new Date(`${String(tw.clock.today())}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}
