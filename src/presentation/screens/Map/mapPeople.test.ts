import { describe, expect, it } from 'vitest';
import type { OtherTravelerDto } from '@/application/dto/Dto';
import { fitBounds, project } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, MapViewModel, Viewport } from '@/presentation/screens/Map/MapViewModel';
import { PERSON_COLORS, hitTestPerson, personColorOf, personMessageOf, placeTravelers, travelerLookOf } from '@/presentation/screens/Map/mapPeople';

const VP: Viewport = { width: 390, height: 680, bottomInset: 120 };
const CENTER_A = { lat: 34.7, lng: 135.51 };
const SPOT_A = { lat: 34.7004, lng: 135.5104 };

/** placeTravelers が使う項目（地区の中心とスポットの位置）だけを持つ描画データ */
const VM = {
  districts: [{ id: 'd_a', center: CENTER_A }],
  spots: [{ id: 's1', districtId: 'd_a', position: SPOT_A }],
} as unknown as MapViewModel;

const CAMERA: Camera = fitBounds({ south: 34.69, west: 135.5, north: 34.71, east: 135.52 }, VP, 12);

/**
 * テスト用のほかの旅人を作る。
 * @param key ライバルID:地区ID
 * @param isLord 地区の主か
 * @returns ほかの旅人
 */
function traveler(key: string, isLord = false): OtherTravelerDto {
  const districtId = key.split(':')[1] ?? 'd_a';
  return { key, name: 'おまいり番長', initial: 'タ', districtId, isLord };
}

describe('placeTravelers', () => {
  it('広域は地区の中心、詳細はスポットのそばに置く', () => {
    const t = traveler('r_taro:d_a');
    const [wide] = placeTravelers([t], VM, { camera: CAMERA, viewport: VP, zoom: 'wide' });
    const [near] = placeTravelers([t], VM, { camera: CAMERA, viewport: VP, zoom: 'near' });
    const center = project(CAMERA, VP, CENTER_A);
    const spot = project(CAMERA, VP, SPOT_A);
    expect(Math.hypot((wide?.at.x ?? 0) - center.x, (wide?.at.y ?? 0) - center.y)).toBeCloseTo(14, 5);
    expect(Math.hypot((near?.at.x ?? 0) - spot.x, (near?.at.y ?? 0) - spot.y)).toBeCloseTo(32, 5);
  });

  it('同じ地区の人どうし・自分とは重ならない向きに置く', () => {
    const people = placeTravelers([traveler('r_taro:d_a'), traveler('r_hana:d_a'), traveler('r_ken:d_a')], VM, {
      camera: CAMERA,
      viewport: VP,
      zoom: 'district',
      self: project(CAMERA, VP, SPOT_A),
    });
    expect(people).toHaveLength(3);
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const a = people[i]?.at ?? { x: 0, y: 0 };
        const b = people[j]?.at ?? { x: 0, y: 0 };
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(14 * 2.1 - 1e-6);
      }
    }
  });

  it('地区が見つからない人は置かない', () => {
    expect(placeTravelers([traveler('r_taro:d_none')], VM, { camera: CAMERA, viewport: VP, zoom: 'wide' })).toEqual([]);
  });

  it('同じ入力なら毎回同じ位置（決定論的）', () => {
    const view = { camera: CAMERA, viewport: VP, zoom: 'near' as const };
    expect(placeTravelers([traveler('r_taro:d_a')], VM, view)).toEqual(placeTravelers([traveler('r_taro:d_a')], VM, view));
  });
});

describe('personColorOf', () => {
  it('同じライバルは地区が違っても同じ色', () => {
    expect(personColorOf('r_hana:d_a')).toBe(personColorOf('r_hana:d_b'));
    expect(PERSON_COLORS).toContain(personColorOf('r_hana:d_a'));
  });
});

describe('hitTestPerson', () => {
  it('バッジの半径＋余白の内側をタップしたら、いちばん近い人を返す', () => {
    const a = { traveler: traveler('r_a:d_a'), at: { x: 100, y: 100 }, radius: 12, color: '#000000' };
    const b = { traveler: traveler('r_b:d_a'), at: { x: 120, y: 100 }, radius: 12, color: '#000000' };
    expect(hitTestPerson([a, b], { x: 116, y: 100 })?.traveler.key).toBe('r_b:d_a');
    expect(hitTestPerson([a, b], { x: 100, y: 130 })).toBeUndefined();
  });
});

describe('personMessageOf', () => {
  it('主かどうかで文言を変える', () => {
    expect(personMessageOf(traveler('r_taro:d_a', true), '南森町・天満宮地区')).toBe('おまいり番長：南森町・天満宮地区の主です');
    expect(personMessageOf(traveler('r_taro:d_a'), undefined)).toBe('おまいり番長：この地区によく来ています');
  });
});

describe('travelerLookOf', () => {
  it('同じライバルは地区が違っても同じ装い。服の色は人ごとの色', () => {
    const a = travelerLookOf(traveler('r_hana:d_a'));
    const b = travelerLookOf(traveler('r_hana:d_b'));
    expect(a).toEqual(b);
    expect(a.outfitColor).toBe(personColorOf('r_hana:d_a'));
  });

  it('地区の主は王冠をかぶり、主でなければ王冠はかぶらない', () => {
    expect(travelerLookOf(traveler('r_taro:d_a', true)).hat).toBe('crown');
    for (const id of ['r_taro', 'r_hana', 'r_ken', 'r_mio', 'r_sora', 'r_riku', 'r_aoi']) {
      expect(travelerLookOf(traveler(`${id}:d_a`)).hat).not.toBe('crown');
    }
  });

  it('7人の装いはすべて同じにはならない', () => {
    const looks = ['r_taro', 'r_hana', 'r_ken', 'r_mio', 'r_sora', 'r_riku', 'r_aoi'].map((id) => JSON.stringify(travelerLookOf(traveler(`${id}:d_a`))));
    expect(new Set(looks).size).toBeGreaterThan(3);
  });
});

describe('hitTestPerson（アバター）', () => {
  it('足元の少し上（体）をタップしても当たる', () => {
    const a = { traveler: traveler('r_a:d_a'), at: { x: 100, y: 100 }, radius: 12, color: '#000000' };
    expect(hitTestPerson([a], { x: 100, y: 84 })?.traveler.key).toBe('r_a:d_a');
  });
});
