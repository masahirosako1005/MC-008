/**
 * @file 演出の並べ方とまとめの単体テスト（presentation/screens/Effects 層）
 */
import { describe, expect, it } from 'vitest';
import { planEffects, summarizeEffects } from '@/presentation/screens/Effects/effectPlan';
import type { EffectSourceEvent } from '@/presentation/screens/Effects/effectPlan';

/** 手順6（本町に再訪）で届くイベントの例 */
const revisitEvents: EffectSourceEvent[] = [
  { type: 'DistrictLordChanged', eventId: 'e5', sequence: 5, districtId: 'd_honmachi', from: { type: 'rival' }, to: { type: 'traveler' }, fromName: '旅人タロウ', toName: 'あなた', travelerCount: 11, lordCount: 11 },
  { type: 'CardAwarded', eventId: 'e4', sequence: 4, districtId: 'd_honmachi', rank: 'gold', reason: 'visits', visitCount: 10 },
  { type: 'PointsAwarded', eventId: 'e2', sequence: 2, districtId: 'd_honmachi', spotId: 's_hm01', basePoints: 15, bonusPoints: 7 },
  { type: 'WelcomeBackBonusGranted', eventId: 'e3', sequence: 3, districtId: 'd_honmachi', multiplier: 1.5, bonusPoints: 7 },
  { type: 'DistrictRevived', eventId: 'e1', sequence: 1, districtId: 'd_honmachi', daysSinceLastVisit: 32, level: 3 },
];

describe('planEffects', () => {
  it('復活 → カード → 主交代 の順に並べ、復活におかえりボーナスを統合する', () => {
    const plan = planEffects(revisitEvents);
    expect(plan.map((item) => item.kind)).toEqual(['revival', 'card', 'lord']);
    expect(plan[0]).toEqual({ kind: 'revival', districtId: 'd_honmachi', daysSinceLastVisit: 32, level: 3, multiplier: 1.5, bonusPoints: 7 });
    expect(plan[2]).toEqual({ kind: 'lord', districtId: 'd_honmachi', fromName: '旅人タロウ', reclaimed: true, travelerCount: 11 });
  });

  it('ライバルに主を奪われたときは演出しない（失う体験を作らない）', () => {
    const lost: EffectSourceEvent = { type: 'DistrictLordChanged', eventId: 'x', sequence: 1, districtId: 'd_honmachi', from: { type: 'traveler' }, to: { type: 'rival' }, fromName: 'あなた', toName: '旅人タロウ', travelerCount: 9, lordCount: 10 };
    expect(planEffects([lost])).toEqual([]);
  });

  it('初めて主になったときは取り返しではない', () => {
    const first: EffectSourceEvent = { type: 'DistrictLordChanged', eventId: 'y', sequence: 1, districtId: 'd_satoyama', to: { type: 'traveler' }, toName: 'あなた', travelerCount: 1, lordCount: 1 };
    expect(planEffects([first])).toEqual([{ kind: 'lord', districtId: 'd_satoyama', fromName: undefined, reclaimed: false, travelerCount: 1 }]);
  });

  it('アイテムは最後。ポイント・成長だけなら演出は無い', () => {
    const events: EffectSourceEvent[] = [
      { type: 'ItemAcquired', eventId: 'i', sequence: 1, itemId: 'item_lantern', name: '提灯' },
      { type: 'CardAwarded', eventId: 'c', sequence: 2, districtId: 'd_joka', rank: 'silver', reason: 'visits', visitCount: 3 },
    ];
    expect(planEffects(events).map((item) => item.kind)).toEqual(['card', 'item']);
    expect(planEffects([{ type: 'DistrictGrown', eventId: 'g', sequence: 1, districtId: 'd_joka', from: 2, to: 3 }])).toEqual([]);
  });

  it('復活があってもおかえりボーナスが無ければ倍率は undefined', () => {
    const plan = planEffects([{ type: 'DistrictRevived', eventId: 'r', sequence: 1, districtId: 'd_yunosato', daysSinceLastVisit: 45, level: 2 }]);
    expect(plan[0]).toMatchObject({ kind: 'revival', multiplier: undefined, bonusPoints: 0 });
  });
});

describe('summarizeEffects', () => {
  it('基本ポイントを合計し、おかえりボーナスは二重に数えない', () => {
    expect(summarizeEffects(revisitEvents)).toEqual({ points: 15, bonusPoints: 7, grownDistrictIds: [] });
  });

  it('成長した地区を重複なく集める', () => {
    const events: EffectSourceEvent[] = [
      { type: 'DistrictGrown', eventId: 'g1', sequence: 1, districtId: 'd_joka', from: 1, to: 2 },
      { type: 'DistrictGrown', eventId: 'g2', sequence: 2, districtId: 'd_joka', from: 2, to: 3 },
      { type: 'PointsAwarded', eventId: 'p', sequence: 3, districtId: 'd_joka', spotId: 's_jo02', basePoints: 15, bonusPoints: 0 },
    ];
    expect(summarizeEffects(events)).toEqual({ points: 15, bonusPoints: 0, grownDistrictIds: ['d_joka'] });
  });

  it('イベントが無ければすべて 0', () => {
    expect(summarizeEffects([])).toEqual({ points: 0, bonusPoints: 0, grownDistrictIds: [] });
  });
});
