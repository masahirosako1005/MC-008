/**
 * @file スポット詳細の表示用純粋関数の単体テスト（presentation/screens/Spot 層）
 */
import { describe, expect, it } from 'vitest';
import type { ShopEventDto } from '@/application/dto/Dto';
import {
  distanceText,
  eventSubtitle,
  eventTimingLabel,
  formatMonthDay,
  growthToastMessage,
  nextCardLabel,
  VISIT_ENABLED_LABEL,
  visitButtonState,
  visitToastMessage,
} from '@/presentation/screens/Spot/spotDetailModel';

describe('visitButtonState', () => {
  it('訪問できるときは有効で「訪問する（40m以内）」', () => {
    expect(visitButtonState({ canVisit: true, visitedToday: false })).toEqual({ enabled: true, label: VISIT_ENABLED_LABEL });
  });
  it('離れているときは無効で「あと n m 近づくと訪問できます」', () => {
    expect(visitButtonState({ canVisit: false, visitedToday: false, metersToVisit: 79.2, visitBlockedReason: '離れています' })).toEqual({
      enabled: false,
      label: 'あと 80m 近づくと訪問できます',
    });
  });
  it('今日は訪問済みなら application の理由文を出す', () => {
    expect(visitButtonState({ canVisit: false, visitedToday: true, visitBlockedReason: '今日はもう訪問しました' }).label).toBe('今日はもう訪問しました');
  });
  it('距離が分からないときは理由文、無ければ既定文', () => {
    expect(visitButtonState({ canVisit: false, visitedToday: false, visitBlockedReason: '位置情報を取得できません' }).label).toBe('位置情報を取得できません');
    expect(visitButtonState({ canVisit: false, visitedToday: false }).label).toBe('今は訪問できません');
  });
});

describe('期限と日付の表示', () => {
  const event: ShopEventDto = {
    id: 'c_jo01',
    kind: 'coupon',
    title: 'どら焼き1個サービス',
    description: '',
    daysLeft: 3,
    active: true,
    start: '2026-11-01',
    end: '2026-11-12',
  };
  it('YYYY-MM-DD を M/D にする', () => {
    expect(formatMonthDay('2026-11-09')).toBe('11/9');
    expect(formatMonthDay('不正')).toBe('不正');
  });
  it('期間内は残り日数、最終日は「今日まで」、開始前は開始日', () => {
    expect(eventTimingLabel(event)).toBe('あと3日');
    expect(eventTimingLabel({ ...event, daysLeft: 0 })).toBe('今日まで');
    expect(eventTimingLabel({ active: false, start: '2026-12-01' })).toBe('12/1から');
  });
  it('2行目は種類・期限・期間をつなぐ', () => {
    expect(eventSubtitle(event)).toBe('クーポン ・ あと3日 ・ 11/1〜11/12');
  });
  it('距離が無いときは「現在地不明」', () => {
    expect(distanceText(undefined)).toBe('現在地不明');
    expect(distanceText(62)).toBe('62m');
  });
});

describe('カードとトーストの文言', () => {
  it('次のカードまでの回数を出す（達成率は出さない）', () => {
    expect(nextCardLabel({ rank: 'silver', remainingVisits: 1 })).toBe('あと1回で銀カード');
    expect(nextCardLabel(undefined)).toBeUndefined();
  });
  it('おかえりボーナスがあれば括弧で添える', () => {
    expect(visitToastMessage({ points: 15, bonusPoints: 0 })).toBe('訪問を記録しました +15pt');
    expect(visitToastMessage({ points: 15, bonusPoints: 7 })).toBe('訪問を記録しました +15pt（おかえりボーナス +7）');
  });
  it('成長のトーストは地区名と新しい Lv を出す', () => {
    expect(growthToastMessage('城下地区', 3)).toBe('城下地区が Lv3 に育ちました');
    expect(growthToastMessage(undefined, undefined)).toBe('地区が育ちました');
  });
});
