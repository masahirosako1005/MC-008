import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseShopEventId, parseSpotId } from '@/Common/types/Id';
import type { DistrictId, ShopEventId, SpotId } from '@/Common/types/Id';
import { jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { visitsNeededToReclaim } from '@/domain/competition/LordPolicy';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { DEADLINE_NOTICE_DAYS } from '@/domain/revisit/constants';
import { Period } from '@/domain/revisit/Period';
import type { RevisitReason } from '@/domain/revisit/RevisitReason';
import { collect, RevisitReasonPolicy } from '@/domain/revisit/RevisitReasonPolicy';
import type { LordshipSnapshot, RevisitReasonInput } from '@/domain/revisit/RevisitReasonPolicy';
import type { ShopEvent, ShopEventKind } from '@/domain/revisit/ShopEvent';
import type { Spot } from '@/domain/spot/Spot';
import type { District } from '@/domain/town/District';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

/** テスト用: 日付 */
function d(text: string): LocalDate {
  return must(parseLocalDate(text));
}

/** テスト用: スポット ID */
function sid(text: string): SpotId {
  return must(parseSpotId(text));
}

/** テスト用: クーポン・イベント ID */
function cid(text: string): ShopEventId {
  return must(parseShopEventId(text));
}

const JOKA: DistrictId = must(parseDistrictId('d_joka'));
const MINATO: DistrictId = must(parseDistrictId('d_minato'));
const HONMACHI: DistrictId = must(parseDistrictId('d_honmachi'));
const OUTSIDE: DistrictId = must(parseDistrictId('d_outside'));
const TODAY = d('2026-11-09');
const POINT = { lat: 34.69, lng: 135.19 };

/** テスト用: 地区 */
function district(id: DistrictId, order: number): District {
  return { id, name: id, shortName: id, theme: 't', order, color: '#7a5ea8', center: POINT, entrance: POINT, polygon: [POINT, POINT, POINT] };
}

/** テスト用: スポット */
function spot(id: string, districtId: DistrictId): Spot {
  const spotId = sid(id);
  return {
    id: spotId,
    kind: id.startsWith('l_') ? 'landmark' : 'shop',
    districtId,
    name: id,
    point: POINT,
    category: 'c',
    description: '',
    amenities: [],
    hours: '',
    partner: false,
  };
}

/** テスト用: クーポン・イベント */
function shopEvent(id: string, spotOf: Spot, range: { start: string; end: string; kind?: ShopEventKind }): ShopEvent {
  return {
    id: cid(id),
    spotId: spotOf.id,
    districtId: spotOf.districtId,
    kind: range.kind ?? 'coupon',
    title: `題名${id}`,
    description: '',
    period: must(Period.of(d(range.start), d(range.end))),
  };
}

let seq = 0;
/** テスト用: 訪問記録 */
function visit(spotOf: Spot, date: string): VisitRecord {
  seq += 1;
  return {
    spotId: spotOf.id,
    districtId: spotOf.districtId,
    visitedAt: jstInstantOf(d(date), 10),
    localDate: d(date),
    operationId: must(parseOperationId(`00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`)),
  };
}

/** テスト用: 地区の主の状況 */
function lordship(districtId: DistrictId, over: Partial<LordshipSnapshot> = {}): LordshipSnapshot {
  return { districtId, lordName: 'みなと太郎', isMe: false, lostByTraveler: true, lordCount: 5, myCount: 3, ...over };
}

const L_JO01 = spot('l_jo01', JOKA);
const S_JO01 = spot('s_jo01', JOKA);
const S_JO02 = spot('s_jo02', JOKA);
const L_MI01 = spot('l_mi01', MINATO);
const S_MI01 = spot('s_mi01', MINATO);
const S_MI02 = spot('s_mi02', MINATO);
const L_HO01 = spot('l_ho01', HONMACHI);
const S_HO01 = spot('s_ho01', HONMACHI);
const L_OUT01 = spot('l_out01', OUTSIDE);

/** テスト用: 基本の入力（城下=色あせ中・取り返し、みなと=そろそろ、本町=元気） */
function baseInput(): RevisitReasonInput {
  return {
    today: TODAY,
    districts: [district(JOKA, 1), district(MINATO, 2), district(HONMACHI, 3)],
    spots: [L_JO01, S_JO01, S_JO02, L_MI01, S_MI01, S_MI02, L_HO01, S_HO01, L_OUT01],
    shopEvents: [
      shopEvent('c_jo01', S_JO01, { start: '2026-11-01', end: '2026-11-16' }), // 残り7日 → 出る
      shopEvent('c_jo02', S_JO02, { start: '2026-11-01', end: '2026-11-17', kind: 'event' }), // 残り8日 → 出ない
      shopEvent('c_mi01', S_MI01, { start: '2026-11-01', end: '2026-11-09' }), // 当日終了 → 出る
      shopEvent('c_mi02', S_MI02, { start: '2026-11-01', end: '2026-11-10' }), // 未発見 → 出ない（D12）
      shopEvent('c_ho01', L_HO01, { start: '2026-10-01', end: '2026-11-08' }), // 終了済み → 出ない
      shopEvent('c_ho02', L_HO01, { start: '2026-11-10', end: '2026-11-12' }), // 開始前 → 出ない
    ],
    visits: [visit(L_JO01, '2026-10-10'), visit(L_MI01, '2026-10-01'), visit(L_MI01, '2026-10-15'), visit(L_HO01, '2026-11-01')],
    discoveredSpotIds: new Set([L_JO01.id, S_JO01.id, S_JO02.id, L_MI01.id, S_MI01.id, L_HO01.id, L_OUT01.id]),
    lordships: [
      lordship(JOKA),
      lordship(MINATO, { isMe: true, lostByTraveler: false, lordName: '自分' }),
      lordship(HONMACHI, { lostByTraveler: false, lordName: 'ライバル' }),
    ],
  };
}

/** テスト用: 種別ごとに取り出す */
function ofKind<K extends RevisitReason['kind']>(reasons: readonly RevisitReason[], kind: K): Extract<RevisitReason, { kind: K }>[] {
  return reasons.filter((r): r is Extract<RevisitReason, { kind: K }> => r.kind === kind);
}

describe('collect（全体）', () => {
  it('期限＞取り返し＞色あせ＞未訪問 の順に並べ、同種内は緊急度順', () => {
    const reasons = collect(baseInput());
    expect(reasons).toEqual([
      { kind: 'deadline', shopEventId: 'c_mi01', spotId: 's_mi01', districtId: MINATO, title: '題名c_mi01', daysLeft: 0 },
      { kind: 'deadline', shopEventId: 'c_jo01', spotId: 's_jo01', districtId: JOKA, title: '題名c_jo01', daysLeft: 7 },
      { kind: 'reclaim', districtId: JOKA, lordName: 'みなと太郎', lordCount: 5, myCount: 3, needed: 3 },
      { kind: 'fade', districtId: JOKA, state: 'fading', daysSinceVisit: 30, fadeStartDate: '2026-11-09' },
      { kind: 'fade', districtId: MINATO, state: 'soon', daysSinceVisit: 25, daysUntilFade: 5, fadeStartDate: '2026-11-14' },
      { kind: 'unvisited', districtId: JOKA, spotIds: ['s_jo01', 's_jo02'] },
      { kind: 'unvisited', districtId: MINATO, spotIds: ['s_mi01'] },
    ]);
  });

  it('新着（new）は v0.1 では生成しない', () => {
    expect(ofKind(collect(baseInput()), 'new')).toEqual([]);
  });

  it('何も無ければ空配列', () => {
    const empty: RevisitReasonInput = { today: TODAY, spots: [], districts: [], shopEvents: [], visits: [], discoveredSpotIds: new Set(), lordships: [] };
    expect(collect(empty)).toEqual([]);
  });

  it('同じ入力には同じ出力を返す（DI-05）', () => {
    expect(collect(baseInput())).toEqual(collect(baseInput()));
  });

  it('入力配列の並び順に左右されない（DI-05）', () => {
    const base = baseInput();
    const shuffled: RevisitReasonInput = {
      ...base,
      districts: [...base.districts].reverse(),
      spots: [...base.spots].reverse(),
      shopEvents: [...base.shopEvents].reverse(),
      visits: [...base.visits].reverse(),
      discoveredSpotIds: new Set([...base.discoveredSpotIds].reverse()),
      lordships: [...base.lordships].reverse(),
    };
    expect(collect(shuffled)).toEqual(collect(base));
  });

  it('名前空間 RevisitReasonPolicy は名前付き export と同じ関数を指す', () => {
    expect(RevisitReasonPolicy.collect).toBe(collect);
  });
});

describe('collect（期限＝D12）', () => {
  it('未発見スポットのクーポン・イベントは出さない（名前を漏らさない）', () => {
    const ids = ofKind(collect(baseInput()), 'deadline').map((r) => r.shopEventId);
    expect(ids).not.toContain('c_mi02');
  });
  it('発見すれば同じクーポンが出る', () => {
    const base = baseInput();
    const input = { ...base, discoveredSpotIds: new Set([...base.discoveredSpotIds, S_MI02.id]) };
    expect(ofKind(collect(input), 'deadline').map((r) => r.shopEventId)).toContain('c_mi02');
  });
  it(`残り ${DEADLINE_NOTICE_DAYS} 日は出し、${DEADLINE_NOTICE_DAYS + 1} 日は出さない（境界値）`, () => {
    const ids = ofKind(collect(baseInput()), 'deadline').map((r) => r.shopEventId);
    expect(ids).toContain('c_jo01');
    expect(ids).not.toContain('c_jo02');
  });
  it('終了済み・開始前は出さない', () => {
    const ids = ofKind(collect(baseInput()), 'deadline').map((r) => r.shopEventId);
    expect(ids).not.toContain('c_ho01');
    expect(ids).not.toContain('c_ho02');
  });
  it('開始日当日は期間内として出す', () => {
    const base = baseInput();
    const input = { ...base, shopEvents: [shopEvent('c_ho03', L_HO01, { start: '2026-11-09', end: '2026-11-12' })] };
    expect(ofKind(collect(input), 'deadline')).toEqual([
      { kind: 'deadline', shopEventId: 'c_ho03', spotId: 'l_ho01', districtId: HONMACHI, title: '題名c_ho03', daysLeft: 3 },
    ]);
  });
  it('利用済みのクーポンは出さない', () => {
    const input = { ...baseInput(), redeemedShopEventIds: new Set([cid('c_jo01')]) };
    expect(ofKind(collect(input), 'deadline').map((r) => r.shopEventId)).toEqual(['c_mi01']);
  });
  it('同じ ID のクーポン・イベントが重複していても1件にまとめる', () => {
    const base = baseInput();
    const duplicated = { ...base, shopEvents: [...base.shopEvents, ...base.shopEvents] };
    expect(ofKind(collect(duplicated), 'deadline')).toHaveLength(2);
  });
});

describe('collect（取り返し＝D8）', () => {
  it('必要回数 = 主の回数 − 自分の回数 + 1', () => {
    const input = { ...baseInput(), lordships: [lordship(JOKA, { lordCount: 9, myCount: 2 })] };
    expect(ofKind(collect(input), 'reclaim')[0]?.needed).toBe(8);
  });
  it('自分の回数が主以上でも必要回数は最小 1', () => {
    const equal = { ...baseInput(), lordships: [lordship(JOKA, { lordCount: 4, myCount: 4 })] };
    const more = { ...baseInput(), lordships: [lordship(JOKA, { lordCount: 2, myCount: 6 })] };
    expect(ofKind(collect(equal), 'reclaim')[0]?.needed).toBe(1);
    expect(ofKind(collect(more), 'reclaim')[0]?.needed).toBe(1);
  });
  it('自分が主・奪われていない・主の名前が無い（空白のみを含む）ときは出さない', () => {
    const cases: Partial<LordshipSnapshot>[] = [
      { isMe: true },
      { lostByTraveler: false },
      { lordName: undefined },
      { lordName: '' },
      { lordName: '   ' },
    ];
    for (const over of cases) {
      const input = { ...baseInput(), lordships: [lordship(JOKA, over)] };
      expect(ofKind(collect(input), 'reclaim')).toEqual([]);
    }
  });
  it('不正な回数（負数・非数・小数）は 0 以上の整数にそろえる', () => {
    const input = { ...baseInput(), lordships: [lordship(JOKA, { lordCount: Number.NaN, myCount: -3 })] };
    expect(ofKind(collect(input), 'reclaim')[0]).toMatchObject({ lordCount: 0, myCount: 0, needed: 1 });
    const fractional = { ...baseInput(), lordships: [lordship(JOKA, { lordCount: 5.7, myCount: 1.2 })] };
    expect(ofKind(collect(fractional), 'reclaim')[0]).toMatchObject({ lordCount: 5, myCount: 1, needed: 5 });
  });
  it('地区一覧に無い地区の主情報は無視する', () => {
    const input = { ...baseInput(), lordships: [lordship(OUTSIDE)] };
    expect(ofKind(collect(input), 'reclaim')).toEqual([]);
  });
  it('同じ地区の主情報が重複していても1件にまとめる', () => {
    const input = { ...baseInput(), lordships: [lordship(JOKA), lordship(JOKA, { lordCount: 9 })] };
    expect(ofKind(collect(input), 'reclaim')).toHaveLength(1);
  });
  it('取り返しは必要回数の少ない順', () => {
    const input = { ...baseInput(), lordships: [lordship(JOKA, { lordCount: 8, myCount: 1 }), lordship(MINATO, { lordCount: 3, myCount: 2 })] };
    expect(ofKind(collect(input), 'reclaim').map((r) => r.districtId)).toEqual([MINATO, JOKA]);
  });
});

describe('collect（色あせ＝D5）', () => {
  it('訪問なし（never）と元気（fresh）の地区は出さない', () => {
    const districts = ofKind(collect(baseInput()), 'fade').map((r) => r.districtId);
    expect(districts).not.toContain(HONMACHI);
    const neverVisited = { ...baseInput(), visits: [] };
    expect(ofKind(collect(neverVisited), 'fade')).toEqual([]);
  });
  it('fading は soon より先に並ぶ', () => {
    expect(ofKind(collect(baseInput()), 'fade').map((r) => r.state)).toEqual(['fading', 'soon']);
  });
  it('最終訪問から22日は出さず、23日（そろそろ）から出す（境界値）', () => {
    const base = baseInput();
    const day22 = { ...base, visits: [visit(L_HO01, '2026-10-18')] };
    const day23 = { ...base, visits: [visit(L_HO01, '2026-10-17')] };
    expect(ofKind(collect(day22), 'fade')).toEqual([]);
    expect(ofKind(collect(day23), 'fade')).toEqual([
      { kind: 'fade', districtId: HONMACHI, state: 'soon', daysSinceVisit: 23, daysUntilFade: 7, fadeStartDate: '2026-11-16' },
    ]);
  });
});

describe('collect（未訪問）', () => {
  it('地区ごとに1件、発見済み・未訪問のスポットを id 昇順で持つ', () => {
    const base = baseInput();
    const input = { ...base, spots: [S_JO02, L_JO01, S_JO01] };
    expect(ofKind(collect(input), 'unvisited')).toEqual([{ kind: 'unvisited', districtId: JOKA, spotIds: ['s_jo01', 's_jo02'] }]);
  });
  it('未発見スポットは含めない（本町の s_ho01）', () => {
    const districts = ofKind(collect(baseInput()), 'unvisited').map((r) => r.districtId);
    expect(districts).not.toContain(HONMACHI);
  });
  it('地区一覧に無い地区のスポットは無視する', () => {
    const districts = ofKind(collect(baseInput()), 'unvisited').map((r) => r.districtId);
    expect(districts).not.toContain(OUTSIDE);
  });
  it('発見済みスポットをすべて訪問すれば出さない', () => {
    const base = baseInput();
    const input = { ...base, visits: [...base.visits, visit(S_JO01, '2026-11-09'), visit(S_JO02, '2026-11-09'), visit(S_MI01, '2026-11-09')] };
    expect(ofKind(collect(input), 'unvisited')).toEqual([]);
  });
  it('件数の多い地区から並ぶ', () => {
    expect(ofKind(collect(baseInput()), 'unvisited').map((r) => r.spotIds.length)).toEqual([2, 1]);
  });
});

describe('取り返しの必要回数の一本化（D8）', () => {
  it('needed は competition の LordPolicy.visitsNeededToReclaim と同じ値になる（境界・逆転を含む）', () => {
    const pairs: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [5, 3], [9, 2], [4, 4], [2, 6], [30, 29], [30, 0]];
    for (const [lordCount, myCount] of pairs) {
      const input = { ...baseInput(), lordships: [lordship(JOKA, { lordCount, myCount })] };
      expect(ofKind(collect(input), 'reclaim')[0]?.needed).toBe(visitsNeededToReclaim(lordCount, myCount));
    }
  });
});
