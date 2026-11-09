import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseShopEventId, parseSpotId, parseTravelerId } from '@/Common/types/Id';
import type { OperationId } from '@/Common/types/Id';
import { jstInstantOf, localDateOf, parseLocalDate } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import { MAX_PROCESSED_OPERATION_IDS } from '@/domain/exploration/constants';
import { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerState, VisitInput } from '@/domain/exploration/Traveler';
import { parseTravelerState } from '@/domain/exploration/TravelerState';
import { Period } from '@/domain/revisit/Period';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import type { Spot } from '@/domain/spot/Spot';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const TRAVELER_ID = must(parseTravelerId('t_test01'));
const JOKA = must(parseDistrictId('d_joka'));

/** テスト用: 日付 */
function d(text: string): LocalDate {
  return must(parseLocalDate(text));
}

/** テスト用: n 番目の操作ID（UUID 形式） */
function op(n: number): OperationId {
  return must(parseOperationId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`));
}

/** テスト用: スポット */
function spot(id: string): Spot {
  return {
    id: must(parseSpotId(id)),
    kind: id.startsWith('l_') ? 'landmark' : 'shop',
    districtId: JOKA,
    name: id,
    point: { lat: 34.69, lng: 135.195 },
    category: 'test',
    description: '',
    amenities: [],
    hours: '',
    partner: true,
  };
}

const CASTLE = spot('l_jo01');
const CAFE = spot('s_jo01');

/** テスト用: 訪問の入力（JST の日時を指定） */
function visitInput(target: Spot, opNo: number, jst: { date: string; hour?: number; minute?: number }, overrides: Partial<VisitInput> = {}): VisitInput {
  const at: Instant = jstInstantOf(d(jst.date), jst.hour ?? 10, jst.minute ?? 0);
  return { spot: target, meters: 12, accuracyM: 5, at, localDate: localDateOf(at), operationId: op(opNo), ...overrides };
}

/** テスト用: 訪問して成功を取り出す */
function visited(t: Traveler, input: VisitInput): Traveler {
  const r = t.visit(input);
  if (!r.ok) throw new Error(r.error.code);
  return r.value.traveler;
}

/** テスト用: クーポン */
function coupon(kind: 'coupon' | 'event' = 'coupon'): ShopEvent {
  return {
    id: must(parseShopEventId('c_jo01')),
    spotId: CAFE.id,
    districtId: JOKA,
    kind,
    title: 'どら焼き',
    description: '',
    period: must(Period.of(d('2026-11-01'), d('2026-11-12'))),
  };
}

const fresh = (): Traveler => Traveler.create(TRAVELER_ID, 'あなた', 'regular');

describe('Traveler.create', () => {
  it('記録が空・版数 0 で作られる', () => {
    const t = fresh();
    expect(t.version).toBe(0);
    expect(t.visits).toEqual([]);
    expect(t.discoveries).toEqual([]);
    expect(t.toState().profile).toBe('regular');
  });
  it('ニックネームを正規化する（制御文字除去・空なら既定名・長さ制限）', () => {
    expect(Traveler.create(TRAVELER_ID, ' タロウ\n', 'user').nickname).toBe('タロウ');
    expect(Traveler.create(TRAVELER_ID, '   ', 'user').nickname).toBe('冒険者');
    expect(Array.from(Traveler.create(TRAVELER_ID, 'あ'.repeat(50), 'user').nickname)).toHaveLength(20);
  });
  it('保存形は凍結されている', () => {
    const state = fresh().toState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.visits)).toBe(true);
  });
});

describe('Traveler.visit', () => {
  it('訪問を記録し、未発見なら発見記録も同時に追加する', () => {
    const r = fresh().visit(visitInput(CASTLE, 1, { date: '2026-11-09' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.value.traveler;
    expect(r.value.duplicate).toBe(false);
    expect(r.value.record).toMatchObject({ spotId: 'l_jo01', districtId: 'd_joka', localDate: '2026-11-09' });
    expect(t.visits).toHaveLength(1);
    expect(t.hasVisited(CASTLE.id)).toBe(true);
    expect(t.hasDiscovered(CASTLE.id)).toBe(true);
    expect(t.discoveries).toHaveLength(1);
    expect(t.hasProcessed(op(1))).toBe(true);
  });
  it('元のインスタンスは変わらない（不変）', () => {
    const before = fresh();
    visited(before, visitInput(CASTLE, 1, { date: '2026-11-09' }));
    expect(before.visits).toHaveLength(0);
  });
  it('同じ operationId の二重送信は1回だけ記録する（DI-07）', () => {
    const input = visitInput(CASTLE, 1, { date: '2026-11-09' });
    const once = visited(fresh(), input);
    const again = once.visit(input);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.duplicate).toBe(true);
    expect(again.value.traveler).toBe(once);
    expect(again.value.traveler.visits).toHaveLength(1);
    expect(again.value.record.operationId).toBe(op(1));
  });
  it('処理済みの操作は、その後に離れていても duplicate として成功する', () => {
    const once = visited(fresh(), visitInput(CASTLE, 1, { date: '2026-11-09' }));
    const r = once.visit(visitInput(CASTLE, 1, { date: '2026-11-09' }, { meters: 500 }));
    expect(r.ok && r.value.duplicate).toBe(true);
  });
  it('同じスポットは1日1回（ALREADY_VISITED_TODAY）、別スポットは同日でも可', () => {
    const t = visited(fresh(), visitInput(CASTLE, 1, { date: '2026-11-09', hour: 9 }));
    const second = t.visit(visitInput(CASTLE, 2, { date: '2026-11-09', hour: 18 }));
    expect(second.ok ? undefined : second.error.code).toBe('ALREADY_VISITED_TODAY');
    expect(t.visit(visitInput(CAFE, 3, { date: '2026-11-09', hour: 18 })).ok).toBe(true);
  });
  it('JST 23:59 と翌 0:00 は別の日として両方記録できる（DI-04）', () => {
    const late = visitInput(CASTLE, 1, { date: '2026-11-09', hour: 23, minute: 59 });
    const t = visited(fresh(), late);
    const midnight = visitInput(CASTLE, 2, { date: '2026-11-10', hour: 0, minute: 0 });
    expect(late.localDate).toBe('2026-11-09');
    expect(midnight.localDate).toBe('2026-11-10');
    const r = t.visit(midnight);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.traveler.visits.map((v) => v.localDate)).toEqual(['2026-11-09', '2026-11-10']);
  });
  it('80m は訪問可、81m は OUT_OF_RANGE（地図の円と同じ半径）', () => {
    expect(fresh().visit(visitInput(CASTLE, 1, { date: '2026-11-09' }, { meters: 80 })).ok).toBe(true);
    const far = fresh().visit(visitInput(CASTLE, 1, { date: '2026-11-09' }, { meters: 81 }));
    expect(far.ok ? undefined : far.error.code).toBe('OUT_OF_RANGE');
    if (!far.ok) expect(far.error.details).toMatchObject({ meters: 81, radiusM: 80 });
  });
  it('距離が非数・負なら OUT_OF_RANGE', () => {
    for (const meters of [Number.NaN, -1]) {
      const r = fresh().visit(visitInput(CASTLE, 1, { date: '2026-11-09' }, { meters }));
      expect(r.ok ? undefined : r.error.code).toBe('OUT_OF_RANGE');
    }
  });
  it('精度が MAX_ACCURACY_M を超えたら LOW_ACCURACY（100m は可、101m は不可）', () => {
    expect(fresh().visit(visitInput(CASTLE, 1, { date: '2026-11-09' }, { accuracyM: 100 })).ok).toBe(true);
    for (const accuracyM of [101, Number.NaN, -1]) {
      const r = fresh().visit(visitInput(CASTLE, 1, { date: '2026-11-09' }, { accuracyM }));
      expect(r.ok ? undefined : r.error.code).toBe('LOW_ACCURACY');
    }
  });
  it('精度不足は距離より先に判定する', () => {
    const r = fresh().visit(visitInput(CASTLE, 1, { date: '2026-11-09' }, { accuracyM: 500, meters: 500 }));
    expect(r.ok ? undefined : r.error.code).toBe('LOW_ACCURACY');
  });
  it('発見済みスポットの訪問では発見記録を増やさない', () => {
    const discovered = fresh().discover([CASTLE], jstInstantOf(d('2026-11-08'), 10)).traveler;
    const t = visited(discovered, visitInput(CASTLE, 1, { date: '2026-11-09' }));
    expect(t.discoveries).toHaveLength(1);
    expect(t.discoveries[0]?.discoveredAt).toBe(jstInstantOf(d('2026-11-08'), 10));
  });
});

describe('Traveler.discover', () => {
  it('未発見だけを記録し、入力内の重複は1件にする', () => {
    const r = fresh().discover([CASTLE, CAFE, CASTLE], jstInstantOf(d('2026-11-09'), 10));
    expect(r.newlyDiscovered.map((s) => s.id)).toEqual(['l_jo01', 's_jo01']);
    expect(r.traveler.discoveries).toHaveLength(2);
  });
  it('新しい発見が無ければ同じインスタンスを返す', () => {
    const t = fresh().discover([CASTLE], jstInstantOf(d('2026-11-09'), 10)).traveler;
    const again = t.discover([CASTLE], jstInstantOf(d('2026-11-10'), 10));
    expect(again.traveler).toBe(t);
    expect(again.newlyDiscovered).toEqual([]);
  });
});

describe('Traveler.redeem', () => {
  const base = (): Traveler => visited(fresh(), visitInput(CAFE, 1, { date: '2026-11-09' }));
  const redeemInput = (opNo: number, date: string, overrides: { meters?: number; kind?: 'coupon' | 'event' } = {}) => {
    const at = jstInstantOf(d(date), 12);
    return { shopEvent: coupon(overrides.kind), meters: overrides.meters ?? 10, at, localDate: localDateOf(at), operationId: op(opNo) };
  };

  it('期間内・40m 以内なら利用でき、2回目は ALREADY_REDEEMED', () => {
    const r = base().redeem(redeemInput(2, '2026-11-10'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.traveler.redemptions).toHaveLength(1);
    const again = r.value.traveler.redeem(redeemInput(3, '2026-11-11'));
    expect(again.ok ? undefined : again.error.code).toBe('ALREADY_REDEEMED');
  });
  it('同じ operationId の再実行は duplicate（DI-07）', () => {
    const r = base().redeem(redeemInput(2, '2026-11-10'));
    if (!r.ok) throw new Error('fixture');
    const again = r.value.traveler.redeem(redeemInput(2, '2026-11-10'));
    expect(again.ok && again.value.duplicate).toBe(true);
    if (again.ok) expect(again.value.traveler.redemptions).toHaveLength(1);
  });
  it('イベントは NOT_COUPON', () => {
    const r = base().redeem(redeemInput(2, '2026-11-10', { kind: 'event' }));
    expect(r.ok ? undefined : r.error.code).toBe('NOT_COUPON');
  });
  it('期間外は EXPIRED（終了日当日は可、翌日・開始前は不可）（DI-09）', () => {
    expect(base().redeem(redeemInput(2, '2026-11-12')).ok).toBe(true);
    const ended = base().redeem(redeemInput(2, '2026-11-13'));
    expect(ended.ok ? undefined : ended.error.code).toBe('EXPIRED');
    const early = base().redeem(redeemInput(2, '2026-10-31'));
    expect(early.ok ? undefined : early.error.details).toEqual({ reason: 'notStarted' });
  });
  it('81m 離れていたら OUT_OF_RANGE', () => {
    const r = base().redeem(redeemInput(2, '2026-11-10', { meters: 81 }));
    expect(r.ok ? undefined : r.error.code).toBe('OUT_OF_RANGE');
  });
});

describe('Traveler.restore', () => {
  /** テスト用: 2回訪問した旅人の保存形 */
  const validState = (): TravelerState => {
    const t1 = visited(fresh(), visitInput(CASTLE, 1, { date: '2026-11-08' }));
    return visited(t1, visitInput(CASTLE, 2, { date: '2026-11-09' })).withVersion(3).toState();
  };

  it('正しい保存形から復元でき、内容が一致する', () => {
    const r = Traveler.restore(validState());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(3);
    expect(r.value.visits).toHaveLength(2);
    expect(r.value.toState()).toEqual(validState());
  });
  it('JSON を経由しても復元できる（parseTravelerState）', () => {
    const parsed = parseTravelerState(JSON.parse(JSON.stringify(validState())));
    expect(parsed.ok).toBe(true);
  });
  it('保存データ（JSON.parse の結果＝unknown）をそのまま restore に渡して復元できる（PointLedger・LordshipBoard とそろえた契約）', () => {
    const raw: unknown = JSON.parse(JSON.stringify(validState()));
    const r = Traveler.restore(raw);
    expect(r.ok && r.value.toState()).toEqual(validState());
  });
  it('restore はオブジェクト以外（undefined・数値・文字列・配列）を INVALID_INPUT で拒否する', () => {
    for (const bad of [undefined, 0, 'traveler', [validState()]]) {
      const r = Traveler.restore(bad);
      expect(r.ok ? undefined : r.error.code).toBe('INVALID_INPUT');
    }
  });
  it('同じスポット・同じ日の訪問が2件ある保存データを拒否する（DI-08）', () => {
    const s = validState();
    const dup = { ...s, visits: [...s.visits, { ...s.visits[0]!, operationId: op(99) }] };
    const r = Traveler.restore(dup);
    expect(r.ok ? undefined : r.error.details).toMatchObject({ rule: 'uniqueVisitPerDay' });
  });
  it('発見していないスポットの訪問を拒否する', () => {
    const s = validState();
    const r = Traveler.restore({ ...s, discoveries: [] });
    expect(r.ok ? undefined : r.error.details).toMatchObject({ rule: 'visitedMustBeDiscovered' });
  });
  it('同じスポットの発見記録が2件あるデータを拒否する', () => {
    const s = validState();
    const r = Traveler.restore({ ...s, discoveries: [...s.discoveries, ...s.discoveries] });
    expect(r.ok ? undefined : r.error.details).toMatchObject({ rule: 'uniqueDiscovery' });
  });
  it('不正な ID・版数・プロフィール・日付を拒否する（DI-01）', () => {
    const s = validState();
    const broken: unknown[] = [
      { ...s, id: 'x_bad' },
      { ...s, version: -1 },
      { ...s, version: 1.5 },
      { ...s, profile: 'admin' },
      { ...s, nickname: '' },
      { ...s, visits: [{ ...s.visits[0]!, localDate: '2026-02-30' }] },
      { ...s, visits: 'nope' },
      null,
    ];
    for (const b of broken) {
      expect(parseTravelerState(b).ok).toBe(false);
      expect(Traveler.restore(b as TravelerState).ok).toBe(false);
    }
  });
  it('処理済み操作ID は直近 500 件だけ残し、古いものから捨てる', () => {
    const s = validState();
    const many = Array.from({ length: MAX_PROCESSED_OPERATION_IDS + 20 }, (_, i) => op(1000 + i));
    const r = Traveler.restore({ ...s, processedOperationIds: many });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const kept = r.value.toState().processedOperationIds;
    expect(kept).toHaveLength(MAX_PROCESSED_OPERATION_IDS);
    expect(kept[0]).toBe(op(1020));
    expect(r.value.hasProcessed(op(1000))).toBe(false);
    expect(r.value.hasProcessed(op(1519))).toBe(true);
  });
  it('一覧から捨てられた古い操作でも、訪問記録に残っていれば処理済みとみなす', () => {
    const s = validState();
    const r = Traveler.restore({ ...s, processedOperationIds: [] });
    expect(r.ok && r.value.hasProcessed(op(1))).toBe(true);
  });
});

describe('Traveler.withVersion', () => {
  it('版数だけを変える', () => {
    const t = fresh().withVersion(5);
    expect(t.version).toBe(5);
    expect(t.id).toBe(TRAVELER_ID);
  });
  it('不正な版数はバグとして例外', () => {
    expect(() => fresh().withVersion(-1)).toThrow();
    expect(() => fresh().withVersion(0.5)).toThrow();
  });
});
