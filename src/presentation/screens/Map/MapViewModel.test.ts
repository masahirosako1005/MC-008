import { describe, expect, it } from 'vitest';
import type { DistrictMapDto, MapBackdropDto, MapDataDto, MapSpotDto } from '@/application/dto/Dto';
import { pointInPolygon } from '@/Common/ui/canvas/geometry';
import {
  DISTRICT_PADDING_PX,
  METERS_PER_DEG_LAT,
  NEAR_VIEW_WIDTH_M,
  SPOT_HIT_RADIUS_PX,
  WIDE_PADDING_PX,
  boundsOf,
  buildMapViewModel,
  cameraFor,
  distanceMeters,
  districtAt,
  easeInOutCubic,
  fadeTagOf,
  fitBounds,
  hitTestDistrict,
  hitTestSpot,
  interpolateCamera,
  isInView,
  metersPerDegLng,
  nearCamera,
  placeBuildings,
  project,
  screenDistricts,
  screenSpots,
  toLocalMeters,
  unproject,
  usableHeight,
} from '@/presentation/screens/Map/MapViewModel';
import type { Camera, LatLng, ScreenSpot, Viewport } from '@/presentation/screens/Map/MapViewModel';

/** 城下地区のポリゴン（public/master/districts.json より） */
const JOKA_POLYGON: LatLng[] = [
  { lat: 34.69532, lng: 135.18591 },
  { lat: 34.69539, lng: 135.1904 },
  { lat: 34.69518, lng: 135.1944 },
  { lat: 34.69099, lng: 135.19451 },
  { lat: 34.68878, lng: 135.19445 },
  { lat: 34.68865, lng: 135.18974 },
  { lat: 34.68874, lng: 135.18574 },
  { lat: 34.69234, lng: 135.18585 },
];

/** 本町地区のポリゴン */
const HONMACHI_POLYGON: LatLng[] = [
  { lat: 34.69532, lng: 135.19549 },
  { lat: 34.69541, lng: 135.19993 },
  { lat: 34.69527, lng: 135.2042 },
  { lat: 34.6918, lng: 135.20431 },
  { lat: 34.68874, lng: 135.20404 },
  { lat: 34.68865, lng: 135.1996 },
  { lat: 34.68887, lng: 135.19555 },
  { lat: 34.69225, lng: 135.19549 },
];

const CITY_BOUNDS = { south: 34.678739, west: 135.184046, north: 34.702162, east: 135.205954 };
const VP: Viewport = { width: 390, height: 680, bottomInset: 120 };

/**
 * テスト用の地区 DTO を作る。
 * @param over 上書きする項目
 * @returns 地区 DTO
 */
function districtDto(over: Partial<DistrictMapDto> & Pick<DistrictMapDto, 'id' | 'polygon'>): DistrictMapDto {
  return {
    name: '城下地区',
    shortName: '城下',
    theme: '歴史',
    color: '#7a5ea8',
    order: 1,
    center: { lat: 34.692, lng: 135.19 },
    level: 2,
    score: 9,
    buildings: 9,
    visitCount: 6,
    fade: { kind: 'fresh', daysSinceVisit: 5 },
    isLordMe: false,
    ...over,
  };
}

/**
 * テスト用のスポット DTO を作る。
 * @param over 上書きする項目
 * @returns スポット DTO
 */
function spotDto(over: Partial<MapSpotDto> & Pick<MapSpotDto, 'id'>): MapSpotDto {
  return {
    kind: 'shop',
    districtId: 'd_joka',
    lat: 34.692,
    lng: 135.19,
    status: 'visited',
    name: '城下カフェ',
    visitCount: 2,
    amenities: [],
    hasActiveShopEvent: false,
    ...over,
  };
}

/** 城下地区を東西に横切る川（緯度 34.692 付近、幅 30m） */
const RIVER_LAT = 34.692;

/**
 * テスト用の背景 DTO を作る（城下地区を横切る川1本・駅1つ・公衆トイレ1つ）。
 * @returns 背景
 */
function backdropDto(): MapBackdropDto {
  return {
    features: [
      {
        id: 'f_river',
        kind: 'water',
        name: '大川',
        shape: 'line',
        points: [
          { lat: RIVER_LAT, lng: 135.18 },
          { lat: RIVER_LAT, lng: 135.21 },
        ],
        widthM: 30,
      },
      { id: 'f_bad', kind: 'road', name: '点が足りない道', shape: 'line', points: [{ lat: 34.69, lng: 135.19 }] },
    ],
    stations: [{ id: 'st_mm', name: '南森町', lat: 34.6977, lng: 135.511, lines: '谷町線・堺筋線' }],
    amenityPoints: [{ id: 'a_wc01', kind: 'toilet', name: '公衆トイレ', lat: 34.69, lng: 135.19, note: '' }],
    attribution: '© OpenStreetMap contributors',
  };
}

/**
 * テスト用の地図データ DTO を作る。
 * @returns 地図データ
 */
function mapDto(): MapDataDto {
  return {
    today: '2026-11-09',
    bounds: CITY_BOUNDS,
    backdrop: backdropDto(),
    districts: [
      districtDto({ id: 'd_honmachi', name: '本町地区', shortName: '本町', order: 3, polygon: HONMACHI_POLYGON, level: 3, isLordMe: true, fade: { kind: 'soon', daysUntilFade: 5 } }),
      districtDto({ id: 'd_joka', polygon: JOKA_POLYGON }),
      districtDto({ id: 'd_yunosato', name: '湯の里地区', shortName: '湯の里', order: 5, polygon: JOKA_POLYGON.map((p) => ({ lat: p.lat - 0.008, lng: p.lng })), level: 1, fade: { kind: 'fading', progress: 0.25 } }),
    ],
    spots: [
      spotDto({ id: 's_jo01' }),
      spotDto({ id: 's_jo02', status: 'discovered', name: '丸岡和菓子店', visitCount: 0, lat: 34.6935 }),
      spotDto({ id: 's_jo05', status: 'unknown', name: '漏れてはいけない名前', visitCount: 0, lat: 34.6905 }),
      spotDto({ id: 'l_hm01', kind: 'landmark', districtId: 'd_honmachi', name: '本町アーケード', visitCount: 4, lat: 34.692, lng: 135.2 }),
      spotDto({ id: 'l_hm02', kind: 'landmark', districtId: 'd_honmachi', status: 'unknown', name: '大阪天満宮', visitCount: 0, lat: 34.6905, lng: 135.2 }),
    ],
  };
}

describe('project / unproject', () => {
  const camera: Camera = { centerLat: 34.69, centerLng: 135.195, metersPerPx: 2 };

  it('緯度経度 → 画面 → 緯度経度 の往復で元に戻る', () => {
    const points = [{ lat: 34.6912, lng: 135.1973 }, { lat: 34.6801, lng: 135.1855 }, { lat: 34.69, lng: 135.195 }];
    for (const p of points) {
      const back = unproject(camera, VP, project(camera, VP, p));
      expect(back.lat).toBeCloseTo(p.lat, 10);
      expect(back.lng).toBeCloseTo(p.lng, 10);
    }
  });
  it('カメラ中心は下シートで隠れる分を除いた領域の中央に来る', () => {
    const at = project(camera, VP, { lat: camera.centerLat, lng: camera.centerLng });
    expect(at.x).toBeCloseTo(195, 6);
    expect(at.y).toBeCloseTo((680 - 120) / 2, 6);
  });
  it('北は上（y が小さい）、東は右。1px は metersPerPx メートル', () => {
    const north = project(camera, VP, { lat: camera.centerLat + 100 / METERS_PER_DEG_LAT, lng: camera.centerLng });
    const east = project(camera, VP, { lat: camera.centerLat, lng: camera.centerLng + 100 / metersPerDegLng(camera.centerLat) });
    expect(north.y).toBeCloseTo(280 - 50, 6);
    expect(east.x).toBeCloseTo(195 + 50, 6);
  });
  it('経度は cos(緯度) で補正する（1m ≒ 経度 1/91,290°）', () => {
    expect(metersPerDegLng(34.69)).toBeGreaterThan(91_000);
    expect(metersPerDegLng(34.69)).toBeLessThan(91_400);
  });
});

describe('fitBounds / cameraFor', () => {
  it('広域は市域を 12px の余白で表示領域（下シートを除く）に収める', () => {
    const camera = fitBounds(CITY_BOUNDS, VP, WIDE_PADDING_PX);
    const nw = project(camera, VP, { lat: CITY_BOUNDS.north, lng: CITY_BOUNDS.west });
    const se = project(camera, VP, { lat: CITY_BOUNDS.south, lng: CITY_BOUNDS.east });
    expect(nw.x).toBeGreaterThanOrEqual(WIDE_PADDING_PX - 1e-6);
    expect(nw.y).toBeGreaterThanOrEqual(WIDE_PADDING_PX - 1e-6);
    expect(se.x).toBeLessThanOrEqual(VP.width - WIDE_PADDING_PX + 1e-6);
    expect(se.y).toBeLessThanOrEqual(usableHeight(VP) - WIDE_PADDING_PX + 1e-6);
    // どちらかの辺はぴったり余白に接する（無駄に小さくしない）
    const touchesX = Math.abs(nw.x - WIDE_PADDING_PX) < 1e-6;
    const touchesY = Math.abs(nw.y - WIDE_PADDING_PX) < 1e-6;
    expect(touchesX || touchesY).toBe(true);
  });
  it('地区ズームは地区ポリゴンを 24px の余白で収める', () => {
    const vm = buildMapViewModel(mapDto());
    const camera = cameraFor({ zoom: 'district', districtId: 'd_joka' }, vm, undefined, VP);
    const expected = fitBounds(boundsOf(JOKA_POLYGON), VP, DISTRICT_PADDING_PX);
    expect(camera).toEqual(expected);
    for (const p of JOKA_POLYGON) {
      const at = project(camera, VP, p);
      expect(at.x).toBeGreaterThanOrEqual(DISTRICT_PADDING_PX - 1e-6);
      expect(at.x).toBeLessThanOrEqual(VP.width - DISTRICT_PADDING_PX + 1e-6);
      expect(at.y).toBeGreaterThanOrEqual(DISTRICT_PADDING_PX - 1e-6);
      expect(at.y).toBeLessThanOrEqual(usableHeight(VP) - DISTRICT_PADDING_PX + 1e-6);
    }
  });
  it('近接は現在地を中心に横幅 NEAR_VIEW_WIDTH_M を表示する', () => {
    const here = { lat: 34.6919, lng: 135.1939 };
    const camera = nearCamera(here, VP);
    expect(camera.metersPerPx * VP.width).toBeCloseTo(NEAR_VIEW_WIDTH_M, 6);
    const edge = project(camera, VP, { lat: here.lat, lng: here.lng + NEAR_VIEW_WIDTH_M / 2 / metersPerDegLng(here.lat) });
    expect(edge.x).toBeCloseTo(VP.width, 6);
  });
  it('近接で現在地が無いときは地区、地区が見つからないときは広域にする', () => {
    const vm = buildMapViewModel(mapDto());
    const districtCamera = fitBounds(boundsOf(JOKA_POLYGON), VP, DISTRICT_PADDING_PX);
    expect(cameraFor({ zoom: 'near', districtId: 'd_joka' }, vm, undefined, VP)).toEqual(districtCamera);
    expect(cameraFor({ zoom: 'district', districtId: 'd_none' }, vm, undefined, VP)).toEqual(fitBounds(CITY_BOUNDS, VP, WIDE_PADDING_PX));
  });
});

describe('interpolateCamera / easeInOutCubic', () => {
  const a: Camera = { centerLat: 34.69, centerLng: 135.19, metersPerPx: 5 };
  const b: Camera = { centerLat: 34.7, centerLng: 135.2, metersPerPx: 0.5 };
  it('t=0 で開始、t=1 で終了のカメラになる', () => {
    expect(interpolateCamera(a, b, 0)).toEqual(a);
    const end = interpolateCamera(a, b, 1);
    expect(end.centerLat).toBeCloseTo(b.centerLat, 12);
    expect(end.metersPerPx).toBeCloseTo(b.metersPerPx, 12);
  });
  it('縮尺は対数で補間する（中間は幾何平均）', () => {
    expect(interpolateCamera(a, b, 0.5).metersPerPx).toBeCloseTo(Math.sqrt(5 * 0.5), 12);
  });
  it('イージングは 0→0、0.5→0.5、1→1 で範囲外は丸める', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(2)).toBe(1);
    expect(easeInOutCubic(-1)).toBe(0);
  });
});

describe('hitTestSpot / hitTestDistrict', () => {
  const vm = buildMapViewModel(mapDto());
  const spot = vm.spots[0];
  const other = vm.spots[1];
  if (spot === undefined || other === undefined) throw new Error('fixture');
  const spots: ScreenSpot[] = [
    { spot, x: 100, y: 100 },
    { spot: other, x: 130, y: 100 },
  ];
  it('22px 以内ならいちばん近いスポットを返す', () => {
    expect(hitTestSpot(spots, { x: 100, y: 100 + SPOT_HIT_RADIUS_PX })?.spot.id).toBe(spot.id);
    expect(hitTestSpot(spots, { x: 120, y: 100 })?.spot.id).toBe(other.id);
  });
  it('22px より遠ければ何も返さない', () => {
    expect(hitTestSpot(spots, { x: 100, y: 100 + SPOT_HIT_RADIUS_PX + 0.5 })).toBeUndefined();
  });
  it('地区はポリゴンの中だけで当たる', () => {
    const camera = fitBounds(CITY_BOUNDS, VP, WIDE_PADDING_PX);
    const districts = screenDistricts(vm, camera, VP);
    const joka = districts.find((d) => d.district.id === 'd_joka');
    expect(joka).toBeDefined();
    if (joka === undefined) return;
    expect(hitTestDistrict(districts, joka.anchor)?.district.id).toBe('d_joka');
    expect(hitTestDistrict(districts, { x: -5, y: -5 })).toBeUndefined();
  });
  it('広域では名所だけを画面に置く（店舗は隠す）', () => {
    const camera = fitBounds(CITY_BOUNDS, VP, WIDE_PADDING_PX);
    expect(screenSpots(vm, 'wide', camera, VP).map((s) => s.spot.id)).toEqual(['l_hm01', 'l_hm02']);
    expect(screenSpots(vm, 'district', camera, VP)).toHaveLength(5);
  });
});

describe('placeBuildings', () => {
  const obstacles = [{ lat: 34.692, lng: 135.19 }];
  it('同じ地区・同じ数なら毎回同じ位置（決定論的）', () => {
    expect(placeBuildings('d_joka', JOKA_POLYGON, 9, { points: obstacles })).toEqual(placeBuildings('d_joka', JOKA_POLYGON, 9, { points: obstacles }));
  });
  it('指定数を超えず、すべて地区ポリゴンの内側に置く', () => {
    const buildings = placeBuildings('d_joka', JOKA_POLYGON, 12, { points: obstacles });
    expect(buildings.length).toBeGreaterThan(0);
    expect(buildings.length).toBeLessThanOrEqual(12);
    const origin = JOKA_POLYGON[0] ?? { lat: 0, lng: 0 };
    const local = JOKA_POLYGON.map((p) => toLocalMeters(origin, p));
    for (const b of buildings) expect(pointInPolygon(toLocalMeters(origin, b), local)).toBe(true);
  });
  it('数が増えても既存の建物の位置は変わらない', () => {
    const five = placeBuildings('d_joka', JOKA_POLYGON, 5, { points: obstacles });
    const eight = placeBuildings('d_joka', JOKA_POLYGON, 8, { points: obstacles });
    expect(eight.slice(0, five.length)).toEqual(five);
  });
  it('スポットの近くには置かない', () => {
    for (const b of placeBuildings('d_joka', JOKA_POLYGON, 12, { points: obstacles })) {
      expect(distanceMeters(b, obstacles[0] ?? b)).toBeGreaterThanOrEqual(24);
    }
  });
  it('川（線）の上には置かない（川の中心から幅の半分＋余白以内に置かない）', () => {
    const river = [
      { lat: RIVER_LAT, lng: 135.18 },
      { lat: RIVER_LAT, lng: 135.21 },
    ];
    const clearanceM = 15 + 8;
    const buildings = placeBuildings('d_joka', JOKA_POLYGON, 12, { points: [], lines: [{ points: river, clearanceM }] });
    expect(buildings.length).toBeGreaterThan(0);
    for (const b of buildings) expect(Math.abs(b.lat - RIVER_LAT) * METERS_PER_DEG_LAT).toBeGreaterThanOrEqual(clearanceM - 1e-6);
  });
  it('川の面（area）の中には置かない', () => {
    const north = JOKA_POLYGON.map((p) => ({ lat: Math.max(p.lat, RIVER_LAT), lng: p.lng }));
    const buildings = placeBuildings('d_joka', JOKA_POLYGON, 12, { points: [], areas: [north] });
    for (const b of buildings) expect(b.lat).toBeLessThanOrEqual(RIVER_LAT + 1e-9);
  });
  it('0 棟・頂点不足なら空', () => {
    expect(placeBuildings('d_joka', JOKA_POLYGON, 0, { points: [] })).toEqual([]);
    expect(placeBuildings('d_joka', JOKA_POLYGON.slice(0, 2), 5, { points: [] })).toEqual([]);
  });
});

describe('buildMapViewModel', () => {
  const vm = buildMapViewModel(mapDto());
  it('地区を order 順に並べる', () => {
    expect(vm.districts.map((d) => d.id)).toEqual(['d_joka', 'd_honmachi', 'd_yunosato']);
  });
  it('地図ラベルは「城下 Lv2」、上部バーは「城下地区 Lv2」', () => {
    const joka = vm.districts[0];
    expect(joka?.label).toBe('城下 Lv2');
    expect(joka?.title).toBe('城下地区 Lv2');
  });
  it('建物は Lv2 以上の地区だけに置く', () => {
    expect(vm.districts.find((d) => d.id === 'd_joka')?.buildings.length).toBeGreaterThan(0);
    expect(vm.districts.find((d) => d.id === 'd_yunosato')?.buildings).toEqual([]);
  });
  it('色あせ中は破線と ◌、「色あせ」タグ。そろそろは「あとn日」タグ', () => {
    const yu = vm.districts.find((d) => d.id === 'd_yunosato');
    expect(yu?.fade.dashed).toBe(true);
    expect(yu?.fade.icon).toBe('◌');
    expect(yu?.fadeTag).toBe('色あせ');
    expect(vm.districts.find((d) => d.id === 'd_honmachi')?.fadeTag).toBe('あと5日で色あせ');
    expect(vm.districts.find((d) => d.id === 'd_joka')?.fadeTag).toBeUndefined();
  });
  it('自分が主の地区は上部バーの補足に主を出す', () => {
    expect(vm.districts.find((d) => d.id === 'd_honmachi')?.subtitle).toContain('地区の領主');
  });
  it('未発見の店舗の名前は DTO に入っていても落とす', () => {
    const unknown = vm.spots.find((s) => s.id === 's_jo05');
    expect(unknown?.name).toBeUndefined();
    expect(unknown?.label).toBeUndefined();
  });
  it('未発見の名所は実在の名前を残し、回数なしのラベルにする', () => {
    const landmark = vm.spots.find((s) => s.id === 'l_hm02');
    expect(landmark?.name).toBe('大阪天満宮');
    expect(landmark?.label).toBe('大阪天満宮');
  });
  it('建物は地区を横切る川の上に置かない', () => {
    const joka = vm.districts.find((d) => d.id === 'd_joka');
    expect(joka?.buildings.length).toBeGreaterThan(0);
    for (const b of joka?.buildings ?? []) expect(Math.abs(b.lat - RIVER_LAT) * METERS_PER_DEG_LAT).toBeGreaterThanOrEqual(15);
  });
  it('背景を描画用に変換する（点が足りない地物は捨て、駅名に「駅」を付ける）', () => {
    expect(vm.backdrop.layers.water.map((f) => f.id)).toEqual(['f_river']);
    expect(vm.backdrop.layers.road).toEqual([]);
    expect(vm.backdrop.stations.map((st) => st.label)).toEqual(['南森町駅']);
    expect(vm.backdrop.amenityPoints.map((a) => a.glyph)).toEqual(['WC']);
    expect(vm.backdrop.attribution).toBe('© OpenStreetMap contributors');
  });
  it('訪問済みは回数つき、発見済みは名前だけ', () => {
    expect(vm.spots.find((s) => s.id === 's_jo01')?.label).toBe('城下カフェ 2回');
    expect(vm.spots.find((s) => s.id === 's_jo02')?.label).toBe('丸岡和菓子店');
  });
  it('達成率（%・全n件中m件）の文言を作らない', () => {
    const texts = [...vm.districts.flatMap((d) => [d.label, d.title, d.subtitle ?? '']), ...vm.spots.map((s) => s.label ?? '')];
    for (const text of texts) expect(text).not.toMatch(/%|％|件中/);
  });
});

describe('fadeTagOf', () => {
  it('fresh・never はタグなし', () => {
    expect(fadeTagOf({ kind: 'fresh', daysSinceVisit: 3 })).toBeUndefined();
    expect(fadeTagOf({ kind: 'never' })).toBeUndefined();
    expect(fadeTagOf({ kind: 'soon' })).toBe('そろそろ色あせ');
  });
});

describe('screenDistricts の代表点', () => {
  it('L 字の地区でも代表点は地区の内側に置く', () => {
    const lShape: LatLng[] = [
      { lat: 34.7, lng: 135.19 },
      { lat: 34.7, lng: 135.192 },
      { lat: 34.692, lng: 135.192 },
      { lat: 34.692, lng: 135.2 },
      { lat: 34.69, lng: 135.2 },
      { lat: 34.69, lng: 135.19 },
    ];
    const dto = { ...mapDto(), districts: [districtDto({ id: 'd_okawa', polygon: lShape })] };
    const vm = buildMapViewModel(dto);
    const camera = fitBounds(CITY_BOUNDS, VP, WIDE_PADDING_PX);
    const d = screenDistricts(vm, camera, VP)[0];
    expect(d).toBeDefined();
    if (d === undefined) return;
    expect(pointInPolygon(d.anchor, d.polygon)).toBe(true);
    expect(hitTestDistrict([d], d.anchor)?.district.id).toBe('d_okawa');
  });
});

describe('districtAt / isInView / distanceMeters', () => {
  const vm = buildMapViewModel(mapDto());
  it('点を含む地区ID を返し、どこにも入らなければ undefined', () => {
    expect(districtAt(vm, { lat: 34.692, lng: 135.19 })).toBe('d_joka');
    expect(districtAt(vm, { lat: 34.692, lng: 135.2 })).toBe('d_honmachi');
    expect(districtAt(vm, { lat: 34.75, lng: 135.3 })).toBeUndefined();
  });
  it('下シートで隠れる部分は表示領域の外とみなす', () => {
    expect(isInView({ x: 10, y: 10 }, VP)).toBe(true);
    expect(isInView({ x: 10, y: 600 }, VP)).toBe(false);
    expect(isInView({ x: -1, y: 10 }, VP)).toBe(false);
  });
  it('100m 北の点との距離は約 100m', () => {
    const a = { lat: 34.69, lng: 135.19 };
    expect(distanceMeters(a, { lat: a.lat + 100 / METERS_PER_DEG_LAT, lng: a.lng })).toBeCloseTo(100, 6);
  });
});
