import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PREFS,
  MAX_WANTS,
  interestsOfSpot,
  loadMapPrefs,
  mapPrefsKey,
  matchesFilter,
  matchesInterests,
  parseMapPrefs,
  saveMapPrefs,
  toggleInterest,
  toggleWant,
} from '@/presentation/screens/Map/town/mapPrefs';
import type { MapPrefs } from '@/presentation/screens/Map/town/mapPrefs';

/** テスト用の localStorage */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('parseMapPrefs（境界の検証）', () => {
  it('未知の好み・不正な ID・重複を捨て、好みは INTERESTS の順にそろえる', () => {
    const prefs = parseMapPrefs({ interests: ['toilet', 'cafe', 'unknown', 3], wants: ['s_mm01', 's_mm01', 'BAD', '<script>', 'a_wc01', 7] });
    expect(prefs.interests).toEqual(['cafe', 'toilet']);
    expect(prefs.wants).toEqual(['s_mm01', 'a_wc01']);
  });

  it('形が違えば空の好み', () => {
    expect(parseMapPrefs(null)).toEqual(EMPTY_PREFS);
    expect(parseMapPrefs('x')).toEqual(EMPTY_PREFS);
    expect(parseMapPrefs({})).toEqual({ interests: [], wants: [] });
  });

  it('行きたいは新しい MAX_WANTS 件まで', () => {
    const wants = Array.from({ length: MAX_WANTS + 5 }, (_, i) => `s_x${i}`);
    const prefs = parseMapPrefs({ interests: [], wants });
    expect(prefs.wants).toHaveLength(MAX_WANTS);
    expect(prefs.wants[0]).toBe('s_x5');
  });
});

describe('loadMapPrefs / saveMapPrefs', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('保存した好みを読み戻せる', () => {
    saveMapPrefs({ interests: ['sweets'], wants: ['l_mm01'] });
    expect(loadMapPrefs()).toEqual({ interests: ['sweets'], wants: ['l_mm01'] });
  });

  it('壊れた JSON は空の好み', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [mapPrefsKey()]: '{broken' }));
    expect(loadMapPrefs()).toEqual(EMPTY_PREFS);
  });

  it('localStorage が例外を投げても落ちない', () => {
    const throwing = fakeStorage();
    throwing.getItem = () => {
      throw new Error('denied');
    };
    throwing.setItem = () => {
      throw new Error('quota');
    };
    vi.stubGlobal('localStorage', throwing);
    expect(loadMapPrefs()).toEqual(EMPTY_PREFS);
    expect(() => saveMapPrefs({ interests: ['cafe'], wants: [] })).not.toThrow();
  });
});

describe('toggle', () => {
  it('toggleWant は入れ外しし、不正な ID は無視する', () => {
    const a = toggleWant(EMPTY_PREFS, 's_mm02');
    expect(a.wants).toEqual(['s_mm02']);
    expect(toggleWant(a, 's_mm02').wants).toEqual([]);
    expect(toggleWant(a, 'javascript:x')).toBe(a);
  });

  it('toggleInterest は INTERESTS の順を保つ', () => {
    const a = toggleInterest(toggleInterest(EMPTY_PREFS, 'toilet'), 'cafe');
    expect(a.interests).toEqual(['cafe', 'toilet']);
    expect(toggleInterest(a, 'cafe').interests).toEqual(['toilet']);
  });
});

describe('interestsOfSpot / matchesInterests / matchesFilter', () => {
  const bakery = { id: 's_mm04', kind: 'shop' as const, category: 'パン', amenities: ['stroller', 'rainOk', 'kids'], today: false };
  const shrine = { id: 'l_mm01', kind: 'landmark' as const, category: '神社', amenities: ['toilet'], today: true };

  it('カテゴリ・名所・便利情報から好みを出す', () => {
    expect(interestsOfSpot(bakery)).toEqual(['bread', 'stroller', 'kids']);
    expect(interestsOfSpot(shrine)).toEqual(['culture', 'toilet']);
    expect(interestsOfSpot({ kind: 'shop', category: '立ち飲み', amenities: [] })).toEqual(['drink']);
    expect(interestsOfSpot({ kind: 'shop', category: '未知', amenities: [] })).toEqual([]);
  });

  it('好みを選んでいなければ当てはまらない', () => {
    expect(matchesInterests(bakery, EMPTY_PREFS)).toBe(false);
    expect(matchesInterests(bakery, { interests: ['bread'], wants: [] })).toBe(true);
  });

  it('フィルタの判定', () => {
    const prefs: MapPrefs = { interests: ['culture'], wants: ['s_mm04'] };
    expect(matchesFilter('today', shrine, prefs)).toBe(true);
    expect(matchesFilter('today', bakery, prefs)).toBe(false);
    expect(matchesFilter('stroller', bakery, prefs)).toBe(true);
    expect(matchesFilter('toilet', bakery, prefs)).toBe(false);
    expect(matchesFilter('toilet', shrine, prefs)).toBe(true);
    expect(matchesFilter('want', bakery, prefs)).toBe(true);
    expect(matchesFilter('want', shrine, prefs)).toBe(true);
    expect(matchesFilter('want', shrine, EMPTY_PREFS)).toBe(false);
  });
});
