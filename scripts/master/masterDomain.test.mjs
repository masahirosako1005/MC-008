/**
 * @file マスタデータとアプリの domain 契約の結合テスト（scripts 層・vitest 専用）
 * check-master は Node 単体で動く独自の幾何計算で検証する。ここでは public/master の JSON を、アプリが実際に使う
 * domain の ID パーサ・ファクトリ（GeoPoint / Period / Rival）・距離（Distance）・ポリゴン判定・地区の主の決め方（LordPolicy）で
 * 組み立て直し、実演の前提（docs/08 §4.4・§4.5・§5.1、D7・D8・D9）が domain の計算でも成り立つことを確かめる（DI-13）。
 * あわせて、Node の CLI が TS を読めないため scripts 側に手で写した定数（発見半径・ID 正規表現・背景と便利施設ポイントの種類）が
 * src 側と一致することを確かめる。2026-11-09: 舞台を南森町周辺に変更（docs/08 §9）。シードの役割は §9.3 の新IDで同じ。
 */
import { assert, describe, expect, it } from 'vitest';
import { createLogger } from '@/Common/logging/logger';
import { ID_PATTERNS as APP_ID_PATTERNS, parseDistrictId, parseOperationId, parseRivalId, parseShopEventId, parseSpotId, spotKindOfId } from '@/Common/types/Id';
import { addDays, jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import { hasControlChars, isNonEmptyString } from '@/Common/utils/guards';
import { holderKey, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';
import { LordPolicy } from '@/domain/competition/LordPolicy';
import { Rival, RivalActionVisit } from '@/domain/competition/Rival';
import { DISCOVERY_RADIUS_M } from '@/domain/exploration/constants';
import { findSpotsToDiscover } from '@/domain/exploration/DiscoveryRule';
import { Distance } from '@/domain/exploration/Distance';
import { GeoPoint } from '@/domain/exploration/GeoPoint';
import { Period } from '@/domain/revisit/Period';
import { isShopEventKind } from '@/domain/revisit/ShopEvent';
import { isAmenity } from '@/domain/spot/Amenity';
import { AMENITY_POINT_KINDS as APP_AMENITY_POINT_KINDS, MAP_FEATURE_KINDS as APP_MAP_FEATURE_KINDS } from '@/domain/spot/MapBackdrop';
import { distanceToPolygonEdgeM, findDistrictAt, isHexColor, isPointInDistrict } from '@/domain/town/District';
import { loadMasterBundle } from './lib/masterFiles.mjs';
import {
  DEMO_KNOWN_START_SPOTS, ID_PATTERNS as MASTER_ID_PATTERNS, LORD_DISTRICT_ID, NO_BACKGROUND_DISTRICT, RULES, START_DISTRICT_ID, WAGASHI_SPOT_ID,
} from './lib/masterRules.mjs';
import { AMENITY_POINT_KINDS, MAP_FEATURE_KINDS } from './source/schema.mjs';

const logger = createLogger('scripts/master/masterDomain.test');

/** Result の値を取り出す。失敗ならどの項目かを示してテストを失敗させる */
const must = (result, what) => (result.ok ? result.value : assert.fail(`${what}: ${result.error.code}`));

const bundle = loadMasterBundle();

const districts = bundle.data['districts.json'].districts.map((d) => ({
  id: must(parseDistrictId(d.id), d.id),
  name: d.name,
  shortName: d.shortName,
  theme: d.theme,
  order: d.order,
  color: d.color,
  center: must(GeoPoint.fromUnknown(d.center), `${d.id}.center`),
  entrance: must(GeoPoint.fromUnknown(d.entrance), `${d.id}.entrance`),
  polygon: d.polygon.map((p, i) => must(GeoPoint.fromUnknown(p), `${d.id}.polygon[${i}]`)),
}));

const spots = [
  ...bundle.data['landmarks.json'].landmarks.map((raw) => ({ raw, kind: 'landmark' })),
  ...bundle.data['shops.json'].shops.map((raw) => ({ raw, kind: 'shop' })),
].map(({ raw, kind }) => ({
  id: must(parseSpotId(raw.id), raw.id),
  kind,
  districtId: must(parseDistrictId(raw.districtId), `${raw.id}.districtId`),
  name: raw.name,
  point: must(GeoPoint.of(raw.lat, raw.lng), `${raw.id}.point`),
  category: raw.category,
  description: raw.description,
  amenities: raw.amenities,
  hours: raw.hours,
  partner: raw.partner,
}));

const shopEvents = bundle.data['shopEvents.json'].shopEvents.map((e) => ({
  id: must(parseShopEventId(e.id), e.id),
  spotId: must(parseSpotId(e.spotId), `${e.id}.spotId`),
  kind: e.kind,
  title: e.title,
  period: must(Period.fromUnknown(e.start, e.end), `${e.id}.period`),
}));

const rivals = bundle.data['rivals.json'].rivals.map((r) => {
  const patterns = r.patterns.map((p) => ({ ...p, districtId: must(parseDistrictId(p.districtId), `${r.id}.patterns`) }));
  return must(Rival.of({ id: must(parseRivalId(r.id), r.id), name: r.name, patterns }), r.id);
});

/** 「通い慣れた人」のシード訪問（docs/08 §9.3）。[スポットID, 今日からの日数]。天満は 5 スポットで計 9 回（T−28〜T−2） */
const SEED_VISITS = Object.freeze([
  ['l_mm01', -20], ['l_mm01', -12], ['l_mm01', -5], ['s_mm01', -12], ['s_mm01', -5], ['s_mm03', -5],
  ['l_tm01', -28], ['l_tm02', -26], ['s_tm01', -22], ['s_tm02', -18], ['s_tm03', -15], ['l_tm01', -12], ['l_tm02', -9], ['s_tm01', -5], ['s_tm02', -2],
  ['l_ok01', -25], ['l_ok02', -25],
  ['l_og01', -60], ['l_og01', -45], ['l_og02', -45], ['s_og01', -45],
]);

/** docs/08 §4.5 の表の「主」列を §9.3 の地区に置き換えたもの（シード時点。D7 で計算した結果） */
const EXPECTED_SEED_LORDS = Object.freeze({
  d_minamimori: 'rival:r_taro',
  d_okawa: 'rival:r_hana',
  d_tenma: 'traveler',
  d_tenroku: 'rival:r_ken',
  d_ogimachi: 'rival:r_sora',
});

/**
 * 今日 T を基準に「通い慣れた人」のシード訪問記録を作る（地区はマスタのスポットから引く）。
 * @param {import('@/Common/utils/date').LocalDate} today 基準日 T
 * @returns {import('@/domain/exploration/VisitRecord').VisitRecord[]} 訪問記録
 */
function seedVisitsOn(today) {
  const log = logger.fn('seedVisitsOn', { today });
  const visits = SEED_VISITS.map(([rawId, offset], index) => {
    const spot = spots.find((s) => s.id === rawId) ?? assert.fail(`シードのスポット ${rawId} がマスタにありません`);
    const localDate = addDays(today, offset);
    const operationId = must(parseOperationId(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`), 'operationId');
    return { spotId: spot.id, districtId: spot.districtId, visitedAt: jstInstantOf(localDate, 10), localDate, operationId };
  });
  return log.exit(visits);
}

/**
 * 地区の主を domain の LordPolicy で決める（集計期間は今日を含む直近30日）。
 * @param {{ districtId: string, visits: readonly object[], actions?: readonly object[], today: string, incumbent?: object }} input 条件
 * @returns {{ lord: string | undefined, counts: Map<string, number> }} 主のキー（holderKey）と候補ごとの回数
 */
function lordOf(input) {
  const log = logger.fn('lordOf', { districtId: input.districtId, today: input.today });
  const counts = LordPolicy.collectLordCounts({
    districtId: input.districtId,
    visits: input.visits,
    rivals,
    actions: input.actions ?? [],
    window: LordPolicy.lordWindow(input.today),
  });
  const lord = LordPolicy.decide({ incumbent: input.incumbent, counts });
  return log.exit({ lord: lord === undefined ? undefined : holderKey(lord), counts: new Map(counts.map((c) => [holderKey(c.holder), c.count])) });
}

describe('scripts 側に写した定数が src 側と一致する', () => {
  it('発見半径は domain/exploration/constants.ts の DISCOVERY_RADIUS_M と同じ', () => {
    expect(RULES.DISCOVERY_RADIUS_M).toBe(DISCOVERY_RADIUS_M);
  });
  it('ID の正規表現は Common/types/Id.ts の ID_PATTERNS と同じ（SEC-16）', () => {
    expect(MASTER_ID_PATTERNS.district.source).toBe(APP_ID_PATTERNS.DistrictId.source);
    expect(MASTER_ID_PATTERNS.spot.source).toBe(APP_ID_PATTERNS.SpotId.source);
    expect(MASTER_ID_PATTERNS.shopEvent.source).toBe(APP_ID_PATTERNS.ShopEventId.source);
    expect(MASTER_ID_PATTERNS.rival.source).toBe(APP_ID_PATTERNS.RivalId.source);
  });
  it('背景の種類・便利施設ポイントの種類は domain/spot/MapBackdrop.ts と同じ', () => {
    expect([...MAP_FEATURE_KINDS]).toEqual([...APP_MAP_FEATURE_KINDS]);
    expect([...AMENITY_POINT_KINDS]).toEqual([...APP_AMENITY_POINT_KINDS]);
  });
});

describe('マスタを domain のファクトリで組み立てられる（DI-13）', () => {
  it('件数は 地区5・名所14・店舗66・ライバル7 で、ID は一意', () => {
    expect(bundle.errors).toEqual([]);
    expect(districts).toHaveLength(5);
    expect(spots.filter((s) => s.kind === 'landmark')).toHaveLength(14);
    expect(spots.filter((s) => s.kind === 'shop')).toHaveLength(66);
    expect(rivals).toHaveLength(7);
    for (const list of [districts, spots, shopEvents, rivals]) expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
  });
  it('地区: 色は #rrggbb、ポリゴンは 5〜8 頂点、center と entrance は自地区のポリゴン内', () => {
    for (const d of districts) {
      expect(isHexColor(d.color), d.id).toBe(true);
      expect(d.polygon.length, d.id).toBeGreaterThanOrEqual(5);
      expect(d.polygon.length, d.id).toBeLessThanOrEqual(8);
      expect(isPointInDistrict(d.center, d), `${d.id}.center`).toBe(true);
      expect(findDistrictAt(d.entrance, districts)?.id, `${d.id}.entrance`).toBe(d.id);
    }
  });
  it('スポット: 名所/店舗の別が ID の接頭辞と一致し、所属地区のポリゴン内（境界から 15m 以上）にある', () => {
    for (const s of spots) {
      const own = districts.find((d) => d.id === s.districtId);
      expect(own, s.id).toBeDefined();
      expect(spotKindOfId(s.id), s.id).toBe(s.kind);
      expect(findDistrictAt(s.point, districts)?.id, s.id).toBe(s.districtId);
      expect(distanceToPolygonEdgeM(s.point, own?.polygon ?? []), s.id).toBeGreaterThanOrEqual(RULES.BOUNDARY_MARGIN_M);
    }
  });
  it('スポット: 名前は空でなく制御文字なし、便利情報は AMENITIES の値だけ', () => {
    for (const s of spots) {
      expect(isNonEmptyString(s.name) && !hasControlChars(s.name), s.id).toBe(true);
      expect(s.amenities.every((a) => isAmenity(a)), s.id).toBe(true);
    }
  });
  it('同じ地区のスポットどうしは domain の Distance で 60m 以上離れている', () => {
    for (const a of spots) {
      for (const b of spots) {
        if (a.id < b.id && a.districtId === b.districtId) {
          expect(Distance.between(a.point, b.point).meters, `${a.id}-${b.id}`).toBeGreaterThanOrEqual(RULES.MIN_SPOT_SPACING_M);
        }
      }
    }
  });
  it('クーポン・イベント: 種別が正しく、期間は開始≦終了（Period）で、対象スポットがマスタにある', () => {
    for (const e of shopEvents) {
      expect(isShopEventKind(e.kind), e.id).toBe(true);
      expect(isNonEmptyString(e.title), e.id).toBe(true);
      expect(spots.some((s) => s.id === e.spotId), e.id).toBe(true);
    }
  });
  it('背景・駅・便利施設ポイント: 座標はすべて GeoPoint として正しい', () => {
    const map = bundle.data['mapFeatures.json'];
    const amenity = bundle.data['amenityPoints.json'];
    for (const f of map.features) for (const p of f.points) must(GeoPoint.fromUnknown(p), f.id);
    for (const x of [...map.stations, ...amenity.points]) must(GeoPoint.of(x.lat, x.lng), x.id);
    expect(map.stations).toHaveLength(9);
    expect(amenity.points.length).toBeGreaterThan(0);
  });
  it('ライバル: 背景活動の地区はマスタにあり、天満には誰も背景活動を持たない（D9）', () => {
    const districtIds = new Set(districts.map((d) => d.id));
    for (const r of rivals) {
      for (const p of r.patterns) expect(districtIds.has(p.districtId), r.id).toBe(true);
      expect(r.patterns.some((p) => p.districtId === NO_BACKGROUND_DISTRICT), r.id).toBe(false);
    }
  });
});

describe('実演の前提を domain の計算で確かめる（CLAUDE.md 7.2、docs/08 §4.5）', () => {
  it('各地区の入口では、どのスポットも発見範囲（80m）に入らない（入口はスポットから 85m 以上）', () => {
    for (const d of districts) {
      expect(findSpotsToDiscover(d.entrance, spots, () => false), d.id).toEqual([]);
      const nearest = Math.min(...spots.map((s) => Distance.between(d.entrance, s.point).meters));
      expect(nearest, d.id).toBeGreaterThanOrEqual(RULES.ENTRANCE_CLEARANCE_M);
    }
  });
  it('手順2: 南森町の入口から中心へ 20m ごとに歩くと、通い慣れた人にとって未発見のスポットを2つ以上発見する', () => {
    const start = districts.find((d) => d.id === START_DISTRICT_ID) ?? assert.fail(START_DISTRICT_ID);
    const known = new Set(DEMO_KNOWN_START_SPOTS);
    const steps = Math.ceil(Distance.between(start.entrance, start.center).meters / RULES.WALK_SAMPLE_STEP_M);
    const found = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const point = must(GeoPoint.of(start.entrance.lat + (start.center.lat - start.entrance.lat) * t, start.entrance.lng + (start.center.lng - start.entrance.lng) * t), 'walk');
      for (const spot of findSpotsToDiscover(point, spots, (id) => known.has(id))) {
        known.add(spot.id);
        found.push(spot.id);
      }
    }
    expect(found.length).toBeGreaterThanOrEqual(RULES.MIN_WALK_DISCOVERIES);
    expect(found.every((id) => id.includes('_mm'))).toBe(true);
  });
  it('南森町の入口（南森町駅付近）から和菓子店（s_mm02）までは domain の Distance で 100〜160m', () => {
    const start = districts.find((d) => d.id === START_DISTRICT_ID) ?? assert.fail(START_DISTRICT_ID);
    const wagashi = spots.find((s) => s.id === WAGASHI_SPOT_ID) ?? assert.fail(WAGASHI_SPOT_ID);
    const meters = Distance.between(start.entrance, wagashi.point).meters;
    expect(meters).toBeGreaterThanOrEqual(RULES.START_ENTRANCE_TO_WAGASHI_M.min);
    expect(meters).toBeLessThanOrEqual(RULES.START_ENTRANCE_TO_WAGASHI_M.max);
  });
  it('シード時点の地区の主は docs/08 §4.5 の表どおり（2026-11-01 から1年間のどの日に作っても）', () => {
    let today = must(parseLocalDate('2026-11-01'), 'start');
    for (let day = 0; day < 365; day += 1) {
      const visits = seedVisitsOn(today);
      for (const [districtId, expected] of Object.entries(EXPECTED_SEED_LORDS)) {
        expect(lordOf({ districtId, visits, today }).lord, `${today} ${districtId}`).toBe(expected);
      }
      today = addDays(today, 1);
    }
  });
  it('手順3: 南森町を1回訪問しても（旅人7回）主はタロウのまま（タロウは直近30日で常に7回以上）', () => {
    let today = must(parseLocalDate('2026-11-01'), 'start');
    for (let day = 0; day < 365; day += 1) {
      const visits = seedVisitsOn(today);
      const before = lordOf({ districtId: START_DISTRICT_ID, visits, today });
      expect(before.counts.get('traveler'), String(today)).toBe(6);
      expect(before.counts.get('rival:r_taro'), String(today)).toBeGreaterThanOrEqual(7);
      const extra = { ...visits[0], spotId: must(parseSpotId(WAGASHI_SPOT_ID), WAGASHI_SPOT_ID), localDate: today, visitedAt: jstInstantOf(today, 11), operationId: must(parseOperationId('00000000-0000-4000-8000-0000000000ff'), 'op') };
      const after = lordOf({ districtId: START_DISTRICT_ID, visits: [...visits, extra], today, incumbent: { type: 'rival', rivalId: must(parseRivalId('r_taro'), 'r_taro') } });
      expect(after.lord, String(today)).toBe('rival:r_taro');
      today = addDays(today, 1);
    }
  });
  it('手順4〜6: +30日後のライバル行動で天満の主がタロウに移り、旅人は南寄りの2スポットの訪問で取り返す（D8・§4.4）', () => {
    const seedDay = must(parseLocalDate('2026-11-09'), 'T');
    const visits = seedVisitsOn(seedDay);
    const today = addDays(seedDay, 30);
    const kept = lordOf({ districtId: LORD_DISTRICT_ID, visits, today, incumbent: TRAVELER_HOLDER });
    expect(kept.lord).toBe('traveler');
    expect(kept.counts.get('traveler')).toBe(0);
    const taro = must(parseRivalId('r_taro'), 'r_taro');
    const tenma = must(parseDistrictId(LORD_DISTRICT_ID), LORD_DISTRICT_ID);
    const needed = Math.max(kept.counts.get('traveler') ?? 0, 0) + 1 - (kept.counts.get('rival:r_taro') ?? 0);
    const action = must(RivalActionVisit.of({ rivalId: taro, districtId: tenma, localDate: today, count: needed }), 'action');
    const taken = lordOf({ districtId: LORD_DISTRICT_ID, visits, actions: [action], today, incumbent: TRAVELER_HOLDER });
    expect(taken.lord).toBe('rival:r_taro');
    expect(LordPolicy.visitsNeededToReclaim(taken.counts.get('rival:r_taro') ?? 0, taken.counts.get('traveler') ?? 0)).toBe(2);
    const incumbent = { type: 'rival', rivalId: taro };
    /** 今日（T+30）の天満への再訪の訪問記録を作る（n は操作ID の連番） */
    const revisit = (spotId, hour, n) => ({ ...visits[6], spotId: must(parseSpotId(spotId), spotId), localDate: today, visitedAt: jstInstantOf(today, hour), operationId: must(parseOperationId(`00000000-0000-4000-8000-00000000010${n}`), 'op') });
    const once = lordOf({ districtId: LORD_DISTRICT_ID, visits: [...visits, revisit('l_tm02', 10, 1)], actions: [action], today, incumbent });
    expect(once.lord).toBe('rival:r_taro');
    const twice = lordOf({ districtId: LORD_DISTRICT_ID, visits: [...visits, revisit('l_tm02', 10, 1), revisit('s_tm01', 11, 2)], actions: [action], today, incumbent });
    expect(twice.lord).toBe('traveler');
  });
});
