import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseShopEventId, parseSpotId } from '@/Common/types/Id';
import type { DistrictId, ShopEventId, SpotId } from '@/Common/types/Id';
import { parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import {
  compareRevisitReasons,
  isRevisitReasonKind,
  priorityOf,
  REVISIT_REASON_PRIORITY,
  sortRevisitReasons,
} from '@/domain/revisit/RevisitReason';
import type { RevisitReason } from '@/domain/revisit/RevisitReason';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

/** テスト用: 地区 ID */
function did(text: string): DistrictId {
  return must(parseDistrictId(text));
}

/** テスト用: スポット ID */
function sid(text: string): SpotId {
  return must(parseSpotId(text));
}

/** テスト用: クーポン・イベント ID */
function cid(text: string): ShopEventId {
  return must(parseShopEventId(text));
}

/** テスト用: 日付 */
function d(text: string): LocalDate {
  return must(parseLocalDate(text));
}

/** テスト用: 期限の理由 */
function deadline(id: string, daysLeft: number): RevisitReason {
  return { kind: 'deadline', shopEventId: cid(id), spotId: sid('s_aa01'), districtId: did('d_aa'), title: id, daysLeft };
}

/** テスト用: 取り返しの理由 */
function reclaim(district: string, needed: number): RevisitReason {
  return { kind: 'reclaim', districtId: did(district), lordName: 'ライバル', lordCount: needed + 1, myCount: 2, needed };
}

/** テスト用: 色あせ（そろそろ）の理由 */
function soon(district: string, daysSinceVisit: number): RevisitReason {
  return { kind: 'fade', districtId: did(district), state: 'soon', daysSinceVisit, daysUntilFade: 30 - daysSinceVisit, fadeStartDate: d('2026-12-01') };
}

/** テスト用: 色あせ中の理由 */
function fading(district: string, daysSinceVisit: number): RevisitReason {
  return { kind: 'fade', districtId: did(district), state: 'fading', daysSinceVisit, fadeStartDate: d('2026-10-01') };
}

/** テスト用: 未訪問の理由 */
function unvisited(district: string, count: number): RevisitReason {
  const spotIds = Array.from({ length: count }, (_, i) => sid(`s_${district.slice(2)}${String(i).padStart(2, '0')}`));
  return { kind: 'unvisited', districtId: did(district), spotIds };
}

/** テスト用: 新着の理由 */
function fresh(spot: string): RevisitReason {
  return { kind: 'new', spotId: sid(spot), districtId: did('d_aa') };
}

/** テスト用: 並べ替え結果を見やすい文字列にする */
function labels(reasons: readonly RevisitReason[]): string[] {
  return reasons.map((r) => {
    switch (r.kind) {
      case 'deadline':
        return `deadline:${r.shopEventId}`;
      case 'reclaim':
        return `reclaim:${r.districtId}`;
      case 'fade':
        return `fade:${r.state}:${r.districtId}`;
      case 'unvisited':
        return `unvisited:${r.districtId}`;
      case 'new':
        return `new:${r.spotId}`;
    }
  });
}

/** テスト用: 配列のすべての並び替え */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

describe('REVISIT_REASON_PRIORITY', () => {
  it('期限＞取り返し＞色あせ＞未訪問＞新着 の順（CLAUDE.md 4.5）', () => {
    expect(REVISIT_REASON_PRIORITY).toEqual(['deadline', 'reclaim', 'fade', 'unvisited', 'new']);
    expect(priorityOf('deadline')).toBe(0);
    expect(priorityOf('new')).toBe(4);
  });
  it('isRevisitReasonKind は種別だけを受け付ける', () => {
    expect(isRevisitReasonKind('fade')).toBe(true);
    expect(isRevisitReasonKind('Fade')).toBe(false);
    expect(isRevisitReasonKind('')).toBe(false);
    expect(isRevisitReasonKind(1)).toBe(false);
    expect(isRevisitReasonKind(undefined)).toBe(false);
  });
});

describe('sortRevisitReasons', () => {
  it('種別の優先順に並べる', () => {
    const sorted = sortRevisitReasons([fresh('l_aa01'), unvisited('d_aa', 2), fading('d_bb', 40), reclaim('d_cc', 3), deadline('c_x01', 5)]);
    expect(sorted.map((r) => r.kind)).toEqual(['deadline', 'reclaim', 'fade', 'unvisited', 'new']);
  });
  it('期限は残り日数の少ない順（当日終了 0 が先頭）', () => {
    expect(labels(sortRevisitReasons([deadline('c_x01', 7), deadline('c_x02', 0), deadline('c_x03', 3)]))).toEqual([
      'deadline:c_x02',
      'deadline:c_x03',
      'deadline:c_x01',
    ]);
  });
  it('取り返しは必要回数の少ない順', () => {
    expect(labels(sortRevisitReasons([reclaim('d_aa', 4), reclaim('d_bb', 1), reclaim('d_cc', 2)]))).toEqual([
      'reclaim:d_bb',
      'reclaim:d_cc',
      'reclaim:d_aa',
    ]);
  });
  it('色あせは fading＞soon、同じ状態なら経過日数の多い順', () => {
    const sorted = sortRevisitReasons([soon('d_aa', 23), fading('d_bb', 31), soon('d_cc', 28), fading('d_dd', 80)]);
    expect(labels(sorted)).toEqual(['fade:fading:d_dd', 'fade:fading:d_bb', 'fade:soon:d_cc', 'fade:soon:d_aa']);
  });
  it('未訪問は件数の多い順', () => {
    expect(labels(sortRevisitReasons([unvisited('d_aa', 1), unvisited('d_bb', 3), unvisited('d_cc', 2)]))).toEqual([
      'unvisited:d_bb',
      'unvisited:d_cc',
      'unvisited:d_aa',
    ]);
  });
  it('緊急度が同じなら ID 昇順', () => {
    expect(labels(sortRevisitReasons([reclaim('d_cc', 1), reclaim('d_aa', 1), reclaim('d_bb', 1)]))).toEqual([
      'reclaim:d_aa',
      'reclaim:d_bb',
      'reclaim:d_cc',
    ]);
    expect(labels(sortRevisitReasons([deadline('c_x09', 2), deadline('c_x01', 2)]))).toEqual(['deadline:c_x01', 'deadline:c_x09']);
  });
  it('入力の並び順に左右されない（全順列で同じ結果＝DI-05）', () => {
    const items = [deadline('c_x01', 4), reclaim('d_aa', 2), fading('d_bb', 35), soon('d_cc', 25), unvisited('d_dd', 1), fresh('l_aa01')];
    const expected = labels(sortRevisitReasons(items));
    for (const order of permutations(items)) {
      expect(labels(sortRevisitReasons(order))).toEqual(expected);
    }
  });
  it('入力配列を変更せず新しい配列を返す', () => {
    const input = [unvisited('d_aa', 1), deadline('c_x01', 1)];
    const snapshot = [...input];
    const sorted = sortRevisitReasons(input);
    expect(input).toEqual(snapshot);
    expect(sorted).not.toBe(input);
  });
  it('空配列は空配列', () => {
    expect(sortRevisitReasons([])).toEqual([]);
  });
  it('不正な値（NaN）が混ざっても例外にならず、ID 順で決まる', () => {
    const sorted = sortRevisitReasons([deadline('c_x02', Number.NaN), deadline('c_x01', Number.NaN)]);
    expect(labels(sorted)).toEqual(['deadline:c_x01', 'deadline:c_x02']);
  });
});

describe('compareRevisitReasons', () => {
  it('種別が違えば優先順位だけで決まる（緊急度は見ない）', () => {
    expect(compareRevisitReasons(deadline('c_x01', 7), reclaim('d_aa', 1))).toBeLessThan(0);
    expect(compareRevisitReasons(unvisited('d_aa', 9), fading('d_bb', 30))).toBeGreaterThan(0);
  });
  it('同じものは 0', () => {
    expect(compareRevisitReasons(soon('d_aa', 25), soon('d_aa', 25))).toBe(0);
  });
});
