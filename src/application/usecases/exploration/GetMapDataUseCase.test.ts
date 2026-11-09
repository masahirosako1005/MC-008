import { describe, expect, it } from 'vitest';
import { buildSampleBackdrop, buildTestCatalog, createTestWorld, must, seedLordship, seedTraveler, TEST_ORIGIN } from '@/application/testing/fakes';
import { GetMapDataUseCase } from '@/application/usecases/exploration/GetMapDataUseCase';

describe('GetMapDataUseCase', () => {
  it('未発見の店舗の名前は MapDataDto に含めない（位置と種別だけを返す）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo02'], visits: [['l_jo01', -1]] });
    const map = must(await new GetMapDataUseCase(tw).execute());
    const unknown = map.spots.filter((spot) => spot.status === 'unknown');
    expect(unknown.length).toBe(tw.spots.allSpots().length - 2);
    const unknownShops = unknown.filter((spot) => spot.kind === 'shop');
    expect(unknownShops.length).toBe(tw.spots.allSpots().filter((s) => s.kind === 'shop').length);
    for (const spot of unknownShops) {
      expect('name' in spot).toBe(false);
      expect(typeof spot.lat).toBe('number');
    }
    const shopText = JSON.stringify(unknownShops);
    for (const spot of tw.spots.allSpots().filter((s) => s.kind === 'shop')) {
      expect(shopText).not.toContain(spot.name);
    }
  });

  it('名所は実在の名所なので未発見でも名前を返す（ワイヤーフレーム 01「名所名は見せる」）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const map = must(await new GetMapDataUseCase(tw).execute());
    const landmarks = map.spots.filter((spot) => spot.kind === 'landmark');
    expect(landmarks.length).toBeGreaterThan(0);
    for (const spot of landmarks) {
      expect(spot.status).toBe('unknown');
      expect(spot.name).toBe(tw.spots.allSpots().find((s) => s.id === spot.id)?.name);
    }
  });

  it('発見済み・訪問済みのスポットは名前・状態・通った回数を返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo02'], visits: [['l_jo01', -3], ['l_jo01', -1]] });
    const map = must(await new GetMapDataUseCase(tw).execute());
    expect(map.spots.find((spot) => spot.id === 'l_jo01')).toMatchObject({ name: 'N西城跡', status: 'visited', visitCount: 2, kind: 'landmark', districtId: 'd_joka' });
    expect(map.spots.find((spot) => spot.id === 'l_jo02')).toMatchObject({ name: '武家屋敷通り', status: 'discovered', visitCount: 0 });
  });

  it('今日が期間内のクーポン・イベントがあるスポットだけ hasActiveShopEvent=true', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const map = must(await new GetMapDataUseCase(tw).execute());
    const flag = (id: string): boolean | undefined => map.spots.find((spot) => spot.id === id)?.hasActiveShopEvent;
    expect(flag('s_jo02')).toBe(true); // c_jo01 11/01〜11/12
    expect(flag('l_mi02')).toBe(false); // c_mi02 は 12/05 から
    expect(flag('l_hm01')).toBe(false); // クーポン・イベントなし
  });

  it('地区を order 順に5つ返し、成長段階・色あせ・地区の主を反映する', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_mi01', -25], ['l_jo01', -1]] });
    await seedLordship(tw, [{ districtId: 'd_joka', holder: 'r_taro' }, { districtId: 'd_minato', holder: 'traveler' }]);
    const map = must(await new GetMapDataUseCase(tw).execute());
    expect(map.today).toBe('2026-11-09');
    expect(map.districts.map((district) => district.id)).toEqual(['d_joka', 'd_minato', 'd_honmachi', 'd_satoyama', 'd_yunosato']);
    const minato = map.districts.find((district) => district.id === 'd_minato');
    expect(minato).toMatchObject({ level: 1, visitCount: 1, isLordMe: true, lordName: 'あなた' });
    expect(minato?.fade).toMatchObject({ kind: 'soon', daysSinceVisit: 25, daysUntilFade: 5 });
    expect(map.districts.find((district) => district.id === 'd_joka')).toMatchObject({ lordName: 'おまいり番長', isLordMe: false });
    expect(map.districts.find((district) => district.id === 'd_satoyama')?.fade.kind).toBe('never');
  });

  it('地図の背景（地物・駅・便利施設ポイント・出典）をマスタから DTO にして返す', async () => {
    const backdrop = buildSampleBackdrop(TEST_ORIGIN);
    const tw = createTestWorld({ catalog: buildTestCatalog({ backdrop }) });
    await seedTraveler(tw);
    const map = must(await new GetMapDataUseCase(tw).execute());
    expect(map.backdrop.attribution).toBe('© OpenStreetMap contributors');
    expect(map.backdrop.features.map((f) => [f.id, f.kind, f.name, f.shape, f.points.length, f.widthM])).toEqual([
      ['f_test_river', 'water', 'テスト川', 'line', 2, 60],
      ['f_test_park', 'park', 'テスト公園', 'area', 4, undefined],
    ]);
    expect('widthM' in (map.backdrop.features[1] ?? {})).toBe(false);
    const riverStart = backdrop.features[0]?.points[0];
    expect(map.backdrop.features[0]?.points[0]).toEqual({ lat: riverStart?.lat, lng: riverStart?.lng });
    const station = backdrop.stations[0];
    expect(map.backdrop.stations).toEqual([{ id: 'st_test', name: 'テスト駅', lat: station?.point.lat, lng: station?.point.lng, lines: 'テスト線' }]);
    const toilet = backdrop.amenityPoints[0];
    expect(map.backdrop.amenityPoints).toEqual([{ id: 'a_test_toilet', kind: 'toilet', name: '公衆トイレ', lat: toilet?.point.lat, lng: toilet?.point.lng, note: 'テスト公園内' }]);
    expect(Object.isFrozen(map.backdrop)).toBe(true);
    expect(Object.isFrozen(map.backdrop.features[0]?.points)).toBe(true);
  });

  it('背景の無いマスタでは空の背景（出典なし）を返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const map = must(await new GetMapDataUseCase(tw).execute());
    expect(map.backdrop).toEqual({ features: [], stations: [], amenityPoints: [] });
  });

  it('同じユースケースでは背景の DTO を作り直さない（マスタは読込後に不変）', async () => {
    const tw = createTestWorld({ catalog: buildTestCatalog({ backdrop: buildSampleBackdrop(TEST_ORIGIN) }) });
    await seedTraveler(tw);
    const useCase = new GetMapDataUseCase(tw);
    const first = must(await useCase.execute());
    const second = must(await useCase.execute());
    expect(second.backdrop).toBe(first.backdrop);
  });

  it('bounds は市域の範囲', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const map = must(await new GetMapDataUseCase(tw).execute());
    expect(map.bounds).toEqual(tw.spots.cityBounds());
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const result = await new GetMapDataUseCase(createTestWorld()).execute();
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });
});
