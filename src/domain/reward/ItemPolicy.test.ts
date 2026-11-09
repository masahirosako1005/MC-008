import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseShopEventId, parseSpotId } from '@/Common/types/Id';
import type { DistrictId, SpotId } from '@/Common/types/Id';
import { jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { Period } from '@/domain/revisit/Period';
import type { ShopEvent, ShopEventKind } from '@/domain/revisit/ShopEvent';
import { ITEM_DEFINITIONS, ItemPolicy, itemsOf, newlyAcquiredItems } from '@/domain/reward/ItemPolicy';
import type { Spot } from '@/domain/spot/Spot';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

/** テスト用: 日付 */
function d(text: string): LocalDate {
  return must(parseLocalDate(text));
}

const JOKA: DistrictId = must(parseDistrictId('d_joka'));
const MINATO: DistrictId = must(parseDistrictId('d_minato'));
const HONMACHI: DistrictId = must(parseDistrictId('d_honmachi'));
const POINT = must(GeoPoint.of(34.69, 135.195));

/** テスト用: スポット */
function spot(id: string, districtId: DistrictId): Spot {
  const spotId = must(parseSpotId(id));
  return {
    id: spotId,
    kind: id.startsWith('l_') ? 'landmark' : 'shop',
    districtId,
    name: id,
    point: POINT,
    category: 'test',
    description: '',
    amenities: [],
    hours: '',
    partner: false,
  };
}

const SPOTS: readonly Spot[] = [
  spot('l_jo01', JOKA),
  spot('l_jo02', JOKA),
  spot('s_jo01', JOKA),
  spot('s_jo02', JOKA),
  spot('s_jo03', JOKA),
  spot('l_mi01', MINATO),
  spot('s_mi01', MINATO),
  spot('l_hm01', HONMACHI),
];

/** テスト用: スポットIDから地区を引く */
function districtOf(spotId: SpotId): DistrictId {
  return SPOTS.find((s) => s.id === spotId)?.districtId ?? HONMACHI;
}

let seq = 0;
/** テスト用: 訪問記録 */
function visit(id: string, date: string): VisitRecord {
  seq += 1;
  const spotId = must(parseSpotId(id));
  return {
    spotId,
    districtId: districtOf(spotId),
    visitedAt: jstInstantOf(d(date), 10),
    localDate: d(date),
    operationId: must(parseOperationId(`00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`)),
  };
}

/** テスト用: クーポン・イベント */
function shopEvent(id: string, spotId: string, kind: ShopEventKind): ShopEvent {
  return {
    id: must(parseShopEventId(id)),
    spotId: must(parseSpotId(spotId)),
    districtId: JOKA,
    kind,
    title: id,
    description: '',
    period: must(Period.of(d('2026-11-01'), d('2026-11-15'))),
  };
}

const SHOP_EVENTS: readonly ShopEvent[] = [shopEvent('c_ev01', 's_jo01', 'event'), shopEvent('c_cp01', 's_jo02', 'coupon')];

/** テスト用: 獲得したアイテムIDの一覧 */
function itemIds(visits: readonly VisitRecord[]): string[] {
  return itemsOf({ visits, spots: SPOTS, shopEvents: SHOP_EVENTS }).map((i) => i.itemId);
}

describe('提灯（イベント期間中にそのスポットを訪問）', () => {
  it('イベント期間中に訪問すると獲得。earnedOn は訪問日', () => {
    expect(itemsOf({ visits: [visit('s_jo01', '2026-11-05')], spots: SPOTS, shopEvents: SHOP_EVENTS })).toEqual([
      { itemId: 'i_chochin', name: '提灯', earnedOn: d('2026-11-05') },
    ]);
  });

  it.each([
    ['開始日（境界）', '2026-11-01', true],
    ['終了日（境界）', '2026-11-15', true],
    ['開始前日', '2026-10-31', false],
    ['終了翌日', '2026-11-16', false],
  ])('%s の訪問', (_label, date, expected) => {
    expect(itemIds([visit('s_jo01', date)]).includes('i_chochin')).toBe(expected);
  });

  it('クーポン（kind=coupon）の期間中の訪問では獲得しない', () => {
    expect(itemIds([visit('s_jo02', '2026-11-05')])).toEqual([]);
  });

  it('期間中でも別のスポットの訪問では獲得しない', () => {
    expect(itemIds([visit('s_jo03', '2026-11-05')])).toEqual([]);
  });
});

describe('のぼり（異なる店舗を3軒）', () => {
  it('異なる3軒目を訪問した日に獲得', () => {
    const visits = [visit('s_jo02', '2026-10-01'), visit('s_jo03', '2026-10-02'), visit('s_mi01', '2026-10-09')];
    expect(itemsOf({ visits, spots: SPOTS, shopEvents: SHOP_EVENTS })).toEqual([{ itemId: 'i_nobori', name: 'のぼり', earnedOn: d('2026-10-09') }]);
  });

  it('2軒では獲得しない', () => {
    expect(itemIds([visit('s_jo02', '2026-10-01'), visit('s_jo03', '2026-10-02')])).toEqual([]);
  });

  it('同じ店舗に3回通っても獲得しない（異なる店舗で数える）', () => {
    expect(itemIds([visit('s_jo02', '2026-10-01'), visit('s_jo02', '2026-10-02'), visit('s_jo02', '2026-10-03')])).toEqual([]);
  });

  it('名所は店舗に数えない', () => {
    expect(itemIds([visit('s_jo02', '2026-10-01'), visit('s_jo03', '2026-10-02'), visit('l_jo01', '2026-10-03')])).toEqual([]);
  });

  it('マスタに無い店舗も ID の接頭辞で店舗として数える（マスタ変更で失わない）', () => {
    expect(itemIds([visit('s_jo02', '2026-10-01'), visit('s_jo03', '2026-10-02'), visit('s_hm09', '2026-10-03')])).toEqual(['i_nobori']);
  });
});

describe('松（3つの地区で名所を訪問）', () => {
  it('3つ目の地区の名所を訪問した日に獲得', () => {
    const visits = [visit('l_jo01', '2026-10-01'), visit('l_mi01', '2026-10-05'), visit('l_hm01', '2026-10-07')];
    expect(itemsOf({ visits, spots: SPOTS, shopEvents: SHOP_EVENTS })).toEqual([{ itemId: 'i_matsu', name: '松', earnedOn: d('2026-10-07') }]);
  });

  it('2地区では獲得しない', () => {
    expect(itemIds([visit('l_jo01', '2026-10-01'), visit('l_jo02', '2026-10-02'), visit('l_mi01', '2026-10-03')])).toEqual([]);
  });

  it('店舗だけで3地区を訪問しても獲得しない', () => {
    expect(itemIds([visit('s_jo02', '2026-10-01'), visit('s_mi01', '2026-10-02'), visit('l_hm01', '2026-10-03')])).toEqual([]);
  });
});

describe('アイテム全体', () => {
  const ALL = [
    visit('l_jo01', '2026-10-01'),
    visit('s_jo02', '2026-10-02'),
    visit('l_mi01', '2026-10-03'),
    visit('s_mi01', '2026-10-04'),
    visit('l_hm01', '2026-10-05'),
    visit('s_jo03', '2026-10-06'),
    visit('s_jo01', '2026-11-03'),
  ];

  it('訪問が無ければアイテムは無い', () => {
    expect(itemsOf({ visits: [], spots: SPOTS, shopEvents: SHOP_EVENTS })).toEqual([]);
  });

  it('定義順（提灯→のぼり→松）で、各1個まで返す', () => {
    expect(itemIds([...ALL, visit('s_jo01', '2026-11-04')])).toEqual(ITEM_DEFINITIONS.map((i) => i.rawId));
  });

  it('訪問を1件ずつ足しても獲得済みのアイテムは消えない', () => {
    for (let k = 0; k < ALL.length; k += 1) {
      const before = itemsOf({ visits: ALL.slice(0, k), spots: SPOTS, shopEvents: SHOP_EVENTS });
      const after = itemsOf({ visits: ALL.slice(0, k + 1), spots: SPOTS, shopEvents: SHOP_EVENTS });
      for (const item of before) expect(after).toContainEqual(item);
    }
  });

  it('記録の並びが逆でも同じ結果になる', () => {
    const forward = itemsOf({ visits: ALL, spots: SPOTS, shopEvents: SHOP_EVENTS });
    expect(itemsOf({ visits: [...ALL].reverse(), spots: SPOTS, shopEvents: SHOP_EVENTS })).toEqual(forward);
  });

  it('新しく獲得したアイテムだけを返す（ItemAcquired 用）', () => {
    const before = ItemPolicy.itemsOf({ visits: ALL.slice(0, 4), spots: SPOTS, shopEvents: SHOP_EVENTS });
    const after = ItemPolicy.itemsOf({ visits: ALL.slice(0, 5), spots: SPOTS, shopEvents: SHOP_EVENTS });
    expect(newlyAcquiredItems(before, after).map((i) => i.itemId)).toEqual(['i_matsu']);
    expect(newlyAcquiredItems(after, after)).toEqual([]);
  });
});
