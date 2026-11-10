import { describe, expect, it } from 'vitest';
import type { VisitLogEntryDto } from '@/application/dto/VisitLogDto';
import { entryAriaLabel, fitWithin, groupByMonth, nthLabel, ZUKAN_MODES } from '@/presentation/screens/Zukan/visitLogModel';

/** 記録を1件作る */
function entry(localDate: string, extra: Partial<VisitLogEntryDto> = {}): VisitLogEntryDto {
  const [y, m, d] = localDate.split('-').map(Number);
  return {
    spotId: 'l_jo01', spotName: 'N西城跡', kind: 'landmark', category: '城跡', districtId: 'd_joka', districtName: '城下', districtColor: '#8577b8',
    localDate, dateLabel: `${m}/${d}（月）`, monthKey: localDate.slice(0, 7), monthLabel: `${y}年${m}月`, time: '10:00', nth: 1, season: 'autumn', ...extra,
  };
}

describe('visitLogModel', () => {
  it('切替は 図鑑 → 記録 の順', () => {
    expect(ZUKAN_MODES.map((m) => m.label)).toEqual(['図鑑', '記録']);
  });

  it('月ごとにまとめ、順番（新しい月が先）を保つ', () => {
    const months = groupByMonth([entry('2026-11-09'), entry('2026-11-02'), entry('2026-09-30')]);
    expect(months.map((m) => [m.monthLabel, m.entries.length])).toEqual([['2026年11月', 2], ['2026年9月', 1]]);
    expect(groupByMonth([])).toEqual([]);
  });

  it('1回目は「はじめて」、2回目からは「n回目」', () => {
    expect([1, 2, 10].map(nthLabel)).toEqual(['はじめて', '2回目', '10回目']);
  });

  it('読み上げ名は日付・スポット・地区・何回目と、写真・メモの有無（メモの中身は入れない）', () => {
    expect(entryAriaLabel(entry('2026-11-09', { nth: 3 }))).toBe('11/9（月）N西城跡、城下、3回目');
    const label = entryAriaLabel(entry('2026-11-09', { note: 'ひみつ', photo: 'data:image/jpeg;base64,AA==' }));
    expect(label).toBe('11/9（月）N西城跡、城下、はじめて、写真あり、メモあり');
    expect(label).not.toContain('ひみつ');
  });

  it('写真は長辺を上限に収め、拡大はしない', () => {
    expect(fitWithin(4000, 3000, 640)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(3000, 4000, 640)).toEqual({ width: 480, height: 640 });
    expect(fitWithin(320, 200, 640)).toEqual({ width: 320, height: 200 });
    expect(fitWithin(0, 0, 640)).toEqual({ width: 1, height: 1 });
  });
});
