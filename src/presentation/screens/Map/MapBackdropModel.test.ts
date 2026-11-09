/**
 * @file 地図の背景の描画データ（MapBackdropModel）の単体テスト（presentation/screens/Map 層）
 */
import { describe, expect, it } from 'vitest';
import type { MapBackdropDto } from '@/application/dto/Dto';
import {
  BUILDING_LINE_CLEARANCE_M,
  DEFAULT_ATTRIBUTION,
  DEFAULT_LINE_WIDTH_M,
  MIN_LINE_WIDTH_PX,
  buildBackdropVm,
  buildingAvoidAreas,
  buildingAvoidLines,
  lineLabelCandidates,
  lineWidthPx,
  projectPath,
  stationLabel,
} from '@/presentation/screens/Map/MapBackdropModel';
import { METERS_PER_DEG_LAT, metersPerDegLng, project } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, Viewport } from '@/presentation/screens/Map/MapViewModel';

/**
 * テスト用の背景 DTO を作る（南森町周辺の主な地物をごく簡単にしたもの）。
 * @returns 背景
 */
function backdropDto(): MapBackdropDto {
  return {
    features: [
      { id: 'f_okawa', kind: 'water', name: '大川', shape: 'line', points: [{ lat: 34.692, lng: 135.51 }, { lat: 34.692, lng: 135.52 }], widthM: 120 },
      { id: 'f_pond', kind: 'water', name: '池', shape: 'area', points: [{ lat: 34.70, lng: 135.50 }, { lat: 34.70, lng: 135.501 }, { lat: 34.701, lng: 135.5005 }] },
      { id: 'f_ogimachi', kind: 'park', name: '扇町公園', shape: 'area', points: [{ lat: 34.703, lng: 135.508 }, { lat: 34.703, lng: 135.51 }, { lat: 34.705, lng: 135.51 }, { lat: 34.705, lng: 135.508 }] },
      { id: 'f_tenjin', kind: 'arcade', name: '天神橋筋商店街', shape: 'line', points: [{ lat: 34.6904, lng: 135.5117 }, { lat: 34.7149, lng: 135.5107 }] },
      { id: 'f_sone', kind: 'road', name: '曽根崎通', shape: 'line', points: [{ lat: 34.6978, lng: 135.50 }, { lat: 34.6978, lng: 135.52 }], widthM: Number.NaN },
      { id: 'f_loop', kind: 'rail', name: 'JR大阪環状線', shape: 'line', points: [{ lat: 34.7049, lng: 135.50 }, { lat: 34.7049, lng: 135.52 }], widthM: 12 },
      { id: 'f_broken', kind: 'park', name: '頂点不足', shape: 'area', points: [{ lat: 34.7, lng: 135.5 }, { lat: 34.71, lng: 135.5 }] },
      { id: 'f_nan', kind: 'road', name: '座標が壊れた道', shape: 'line', points: [{ lat: Number.NaN, lng: 135.5 }, { lat: 34.7, lng: 135.51 }] },
    ],
    stations: [
      { id: 'st_mm', name: '南森町', lat: 34.6977, lng: 135.51102, lines: '谷町線・堺筋線' },
      { id: 'st_tm', name: '天満駅', lat: 34.70493, lng: 135.51232, lines: 'JR大阪環状線' },
    ],
    amenityPoints: [
      { id: 'a_wc01', kind: 'toilet', name: '扇町公園 公衆トイレ', lat: 34.704, lng: 135.509, note: '扇町公園内' },
      { id: 'a_nr01', kind: 'nursing', name: '授乳室', lat: 34.703, lng: 135.51, note: '' },
      { id: 'a_aed01', kind: 'aed', name: 'AED', lat: 34.702, lng: 135.511, note: '' },
    ],
  };
}

describe('buildBackdropVm', () => {
  const vm = buildBackdropVm(backdropDto());
  it('地物を種類ごとのレイヤーに分け、点が足りない・座標が壊れた地物は捨てる', () => {
    expect(vm.layers.water.map((f) => f.id)).toEqual(['f_okawa', 'f_pond']);
    expect(vm.layers.park.map((f) => f.id)).toEqual(['f_ogimachi']);
    expect(vm.layers.arcade.map((f) => f.id)).toEqual(['f_tenjin']);
    expect(vm.layers.road.map((f) => f.id)).toEqual(['f_sone']);
    expect(vm.layers.rail.map((f) => f.id)).toEqual(['f_loop']);
    expect(vm.layers.shrine).toEqual([]);
  });
  it('widthM が無い・不正なら種類ごとの既定の太さにする', () => {
    expect(vm.layers.arcade[0]?.widthM).toBe(DEFAULT_LINE_WIDTH_M.arcade);
    expect(vm.layers.road[0]?.widthM).toBe(DEFAULT_LINE_WIDTH_M.road);
    expect(vm.layers.water[0]?.widthM).toBe(120);
  });
  it('駅名には「駅」を1回だけ付ける', () => {
    expect(vm.stations.map((s) => s.label)).toEqual(['南森町駅', '天満駅']);
    expect(stationLabel('扇町')).toBe('扇町駅');
  });
  it('便利施設はアイコンの文字（WC・授乳・AED）を持つ', () => {
    expect(vm.amenityPoints.map((a) => a.glyph)).toEqual(['WC', '授乳', 'AED']);
  });
  it('出典がデータに無くても背景があれば OpenStreetMap の出典を出す', () => {
    expect(vm.attribution).toBe(DEFAULT_ATTRIBUTION);
    expect(buildBackdropVm({ ...backdropDto(), attribution: '© OSM 寄稿者' }).attribution).toBe('© OSM 寄稿者');
  });
  it('背景が無い・空なら空の背景で、出典も出さない', () => {
    const empty = buildBackdropVm(undefined);
    expect(empty.stations).toEqual([]);
    expect(empty.attribution).toBeUndefined();
    expect(buildBackdropVm({ features: [], stations: [], amenityPoints: [] }).attribution).toBeUndefined();
  });
});

describe('buildingAvoidLines / buildingAvoidAreas', () => {
  const vm = buildBackdropVm(backdropDto());
  it('川・道路・商店街・線路の線を、太さの半分＋余白で避ける', () => {
    const lines = buildingAvoidLines(vm);
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.clearanceM)).toContain(120 / 2 + BUILDING_LINE_CLEARANCE_M);
  });
  it('川の面は面として避ける（公園の面は避けない）', () => {
    expect(buildingAvoidAreas(vm)).toHaveLength(1);
  });
});

describe('lineWidthPx（メートル → px）', () => {
  it('太さ（m）を 1px あたりのメートルで割る', () => {
    expect(lineWidthPx(120, 2)).toBe(60);
    expect(lineWidthPx(12, 0.5)).toBe(24);
  });
  it('細すぎる線は最小の太さにする（既定 2px）', () => {
    expect(lineWidthPx(6, 6)).toBe(MIN_LINE_WIDTH_PX);
    expect(lineWidthPx(6, 6, 3)).toBe(3);
  });
  it('縮尺や太さが不正なら最小の太さ', () => {
    expect(lineWidthPx(12, 0)).toBe(MIN_LINE_WIDTH_PX);
    expect(lineWidthPx(Number.NaN, 2)).toBe(MIN_LINE_WIDTH_PX);
  });
});

describe('projectPath（背景の座標変換）', () => {
  const vp: Viewport = { width: 390, height: 680, bottomInset: 120 };
  const camera: Camera = { centerLat: 34.7, centerLng: 135.51, metersPerPx: 2 };
  it('地物の各点を project と同じ規則で画面座標にする（北は上、東は右）', () => {
    const vm = buildBackdropVm(backdropDto());
    const river = vm.layers.water[0];
    expect(river).toBeDefined();
    if (river === undefined) return;
    const path = projectPath(river.points, (ll) => project(camera, vp, ll));
    expect(path).toHaveLength(2);
    const [west, east] = path;
    expect(west?.y).toBeCloseTo(east?.y ?? Number.NaN, 9);
    expect((east?.x ?? 0) - (west?.x ?? 0)).toBeCloseTo((0.01 * metersPerDegLng(34.7)) / 2, 6);
    expect(west?.y).toBeCloseTo((680 - 120) / 2 + ((34.7 - 34.692) * METERS_PER_DEG_LAT) / 2, 6);
  });
});

describe('lineLabelCandidates（線ラベルの候補位置）', () => {
  const path = [
    { x: 0, y: 100 },
    { x: 200, y: 100 },
  ];
  it('線に沿って間隔ごとに点を取り、見えている部分の真ん中に近い順に並べる', () => {
    const points = lineLabelCandidates(path, (p) => p.x >= 50 && p.x <= 150, 25);
    expect(points[0]).toEqual({ x: 100, y: 100 });
    expect(points.every((p) => p.x >= 50 && p.x <= 150)).toBe(true);
    expect(points).toHaveLength(5);
  });
  it('見えていなければ空', () => {
    expect(lineLabelCandidates(path, () => false)).toEqual([]);
    expect(lineLabelCandidates([{ x: 0, y: 0 }], () => true)).toEqual([]);
  });
});
