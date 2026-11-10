/**
 * @file 地図に載せるものの組み立て（presentation/screens/Map/town 層。純粋関数）
 * 地図データ（MapDataDto）と生成した街・好み・今日から、描くスポット（SceneSpot）・今日の情報・フィルタの判定と件数・お店カードの中身・
 * 成長と色あせと陣地の描画状態を作る。画面（MapScreen）は表示と操作に専念する。座標はログに出さない。
 */
import { createLogger } from '@/Common/logging/logger';
import type { MapDataDto, MapSpotDto, SpotDetailDto } from '@/application/dto/Dto';
import { distanceMeters } from '@/presentation/screens/Map/MapViewModel';
import type { LatLng, MapViewModel } from '@/presentation/screens/Map/MapViewModel';
import type { SpotCardModel, SpotCardPhase } from '@/presentation/screens/Map/town/SpotCard';
import { awningColorOf, goodsOf, landmarkSpriteOf, todaySpecialOf } from '@/presentation/screens/Map/town/goods';
import { MAP_FILTERS, matchesFilter, matchesInterests } from '@/presentation/screens/Map/town/mapPrefs';
import type { MapFilterId, MapPrefs } from '@/presentation/screens/Map/town/mapPrefs';
import type { TerritoryModel } from '@/presentation/screens/Map/town/territory';
import type { SceneSpot, SceneTier, SceneToday } from '@/presentation/screens/Map/town/townScene';
import { cellCenterLatLng } from '@/presentation/screens/Map/town/townTypes';
import type { TownGrid, TownPaintState } from '@/presentation/screens/Map/town/townTypes';
import { hashString } from '@/Common/ui/canvas/seededHash';

const logger = createLogger('presentation/screens/Map/town/mapSceneModel');

/** これより引いて見ると「広域」（1 CSS px あたりのメートル） */
export const WIDE_FROM_MPP = 2.4;
/** これより引いて見ると「中間」 */
export const DISTRICT_FROM_MPP = 0.95;
/** 「詳細」ボタンの縮尺（1 CSS px あたりのメートル） */
export const DETAIL_MPP = 0.6;
/** 「あと n 日」を出す日数（これより先は「開催中」） */
const SOON_DAYS = 3;
/** フィルタごとの強調の色 */
export const FILTER_COLORS: Readonly<Record<MapFilterId, string>> = {
  today: '#ffb400',
  stroller: '#2fa39a',
  toilet: '#3e6fb5',
  kids: '#f08c3a',
  rainOk: '#5b8def',
  want: '#ff5a7a',
};

/** 公衆トイレなどの便利施設（地図データの背景から） */
export interface SceneAmenity {
  readonly id: string;
  readonly kind: 'toilet' | 'nursing' | 'aed';
  readonly name: string;
  readonly note: string;
  readonly lat: number;
  readonly lng: number;
}

/**
 * 縮尺から寄り具合を決める。
 * @param metersPerPx 1 CSS px あたりのメートル
 * @returns 寄り具合
 */
export function tierOf(metersPerPx: number): SceneTier { // audit-ignore: fnlog-missing 毎フレーム描画
  if (metersPerPx >= WIDE_FROM_MPP) return 'wide';
  if (metersPerPx >= DISTRICT_FROM_MPP) return 'district';
  return 'near';
}

/**
 * スポットの今日の情報を決める（今日まで・今日だけ（デモの日替わり）・あと n 日・開催中の順に強い）。
 * @param spot 地図のスポット
 * @param goodsLabel 看板商品の名前
 * @param today 今日（YYYY-MM-DD）
 * @param isDemo デモか（日替わりの「今日だけ」はデモだけ）
 * @returns 今日の情報（無ければ undefined）
 */
export function todayOf(spot: MapSpotDto, goodsLabel: string, today: string, isDemo: boolean): SceneToday | undefined {
  const log = logger.fn('todayOf', { spotId: spot.id });
  const event = spot.activeEvent;
  if (event !== undefined && event.daysLeft === 0) return log.exit({ tag: '今日まで', title: event.title, hot: true });
  const special = isDemo ? todaySpecialOf(spot.id, spot.kind, goodsLabel, today) : undefined;
  if (special !== undefined) return log.exit({ tag: '今日だけ', title: special.title, hot: true });
  if (event === undefined) return log.exit(undefined);
  if (event.daysLeft <= SOON_DAYS) return log.exit({ tag: `あと${event.daysLeft}日`, title: event.title, hot: false });
  return log.exit({ tag: event.kind === 'coupon' ? 'クーポン' : '開催中', title: event.title, hot: false });
}

/**
 * 描くスポット（名所・店舗・公衆トイレ）を組み立てる。位置は街に置いた敷地の中心。
 * @param dto 地図データ
 * @param vm 描画データ（地区の色あせ）
 * @param grid 街
 * @param prefs 好み・行きたい
 * @param isDemo デモか
 * @returns 描くスポット
 */
export function buildSceneSpots(dto: MapDataDto, vm: MapViewModel, grid: TownGrid, prefs: MapPrefs, isDemo: boolean): SceneSpot[] {
  const log = logger.fn('buildSceneSpots', { spots: dto.spots.length });
  const fadeOf = new Map(vm.districts.map((d) => [d.id, 1 - d.fade.saturation]));
  const colorOf = new Map(vm.districts.map((d) => [d.id, d.color]));
  const wants = new Set(prefs.wants);
  const out: SceneSpot[] = dto.spots.map((s) => {
    const goods = goodsOf({ id: s.id, kind: s.kind, category: s.category });
    const districtColor = colorOf.get(s.districtId);
    return {
      id: s.id,
      kind: s.kind,
      status: s.status,
      ...(s.name === undefined ? {} : { name: s.name }),
      ...(s.category === undefined ? {} : { category: s.category }),
      ll: anchorLatLng(grid, s.id, s),
      goods,
      ...(s.kind === 'landmark' ? { landmark: landmarkSpriteOf(s.category) } : {}),
      awning: awningColorOf(s.category),
      ...optionalToday(todayOf(s, goods.label, dto.today, isDemo)),
      amenities: s.amenities,
      visitCount: s.visitCount,
      want: wants.has(s.id),
      liked: matchesInterests({ kind: s.kind, category: s.category, amenities: s.amenities }, prefs),
      fade: Math.max(0, Math.min(1, fadeOf.get(s.districtId) ?? 0)),
      seed: hashString(s.id),
      ...(districtColor === undefined ? {} : { districtColor }),
    };
  });
  for (const a of dto.backdrop.amenityPoints) out.push(amenitySpot(a, grid, prefs, wants));
  return log.exit(out, `${out.length} 件`);
}

/**
 * today を持つときだけ { today } を返す（exactOptionalPropertyTypes 対策）。
 * @param today 今日の情報
 * @returns オブジェクト
 */
function optionalToday(today: SceneToday | undefined): { today?: SceneToday } { // audit-ignore: fnlog-missing 組み立ての内部ヘルパー
  return today === undefined ? {} : { today };
}

/**
 * 便利施設（公衆トイレ・授乳室）を描くスポットにする。
 * @param a 便利施設
 * @param grid 街
 * @param prefs 好み
 * @param wants 行きたい
 * @returns 描くスポット
 */
function amenitySpot(a: SceneAmenity, grid: TownGrid, prefs: MapPrefs, wants: ReadonlySet<string>): SceneSpot { // audit-ignore: fnlog-missing 組み立ての内部ヘルパー（buildSceneSpots でまとめてログ）
  return {
    id: a.id,
    kind: 'toilet',
    status: 'discovered',
    name: a.kind === 'nursing' ? '授乳室' : a.name,
    ll: anchorLatLng(grid, a.id, a),
    awning: '#3e6fb5',
    amenities: a.kind === 'nursing' ? ['nursing'] : ['toilet'],
    visitCount: 0,
    want: wants.has(a.id),
    liked: prefs.interests.includes('toilet'),
    fade: 0,
    nursing: a.kind === 'nursing',
    seed: hashString(a.id),
  };
}

/**
 * 街に置いた敷地の中心（無ければ元の位置）。
 * @param grid 街
 * @param id スポット・便利施設の ID
 * @param fallback 元の位置
 * @returns 緯度経度
 */
export function anchorLatLng(grid: TownGrid, id: string, fallback: LatLng): LatLng { // audit-ignore: fnlog-missing 組み立て・タップで呼ぶ変換ヘルパー（座標はログに出さない）
  const anchor = grid.anchors.get(id);
  return anchor === undefined ? { lat: fallback.lat, lng: fallback.lng } : cellCenterLatLng(grid, anchor.col, anchor.row);
}

/**
 * スポットがフィルタ1つに合うか（公衆トイレはトイレ・行きたい・好みでだけ合う）。
 * @param filter フィルタ
 * @param spot 描くスポット
 * @param prefs 好み
 * @returns 合えば true
 */
export function sceneMatches(filter: MapFilterId, spot: SceneSpot, prefs: MapPrefs): boolean { // audit-ignore: fnlog-missing 毎フレーム描画（強調の判定）
  if (spot.kind === 'toilet') {
    if (filter === 'toilet') return true;
    if (filter === 'want') return spot.want || spot.liked;
    return false;
  }
  return matchesFilter(filter, { id: spot.id, kind: spot.kind, amenities: spot.amenities, today: spot.today !== undefined, ...(spot.category === undefined ? {} : { category: spot.category }) }, prefs) || (filter === 'want' && spot.want);
}

/**
 * 入っているフィルタ全部に合うかの判定を返す（フィルタが無ければ undefined＝強調しない）。
 * @param active 入っているフィルタ
 * @param prefs 好み
 * @returns 判定（無ければ undefined）
 */
export function filterMatcher(active: ReadonlySet<MapFilterId>, prefs: MapPrefs): ((spot: SceneSpot) => boolean) | undefined {
  const log = logger.fn('filterMatcher', { active: active.size });
  if (active.size === 0) return log.exit(undefined);
  const list = [...active];
  return log.exit((spot: SceneSpot): boolean => list.every((f) => sceneMatches(f, spot, prefs)));
}

/**
 * フィルタごとの件数（チップの札）。
 * @param spots 描くスポット
 * @param prefs 好み
 * @returns 件数
 */
export function filterCounts(spots: readonly SceneSpot[], prefs: MapPrefs): Record<MapFilterId, number> {
  const log = logger.fn('filterCounts', { spots: spots.length });
  const counts = Object.fromEntries(MAP_FILTERS.map((f) => [f.id, 0])) as Record<MapFilterId, number>;
  for (const spot of spots) for (const f of MAP_FILTERS) if (sceneMatches(f.id, spot, prefs)) counts[f.id] += 1;
  return log.exit(counts);
}

/**
 * いちばん強い強調の色（複数のフィルタが入っていれば先に並ぶもの）。
 * @param active 入っているフィルタ
 * @returns 色
 */
export function highlightColorOf(active: ReadonlySet<MapFilterId>): string { // audit-ignore: fnlog-missing 毎フレーム描画
  for (const f of MAP_FILTERS) if (active.has(f.id)) return FILTER_COLORS[f.id];
  return '#bc5b1b';
}

/**
 * 成長・色あせ・陣地から、街の描画状態を作る。
 * @param grid 街
 * @param vm 描画データ（地区の成長段階・色あせ）
 * @param territory 陣地
 * @returns 描画状態
 */
export function paintStateOf(grid: TownGrid, vm: MapViewModel, territory: TerritoryModel): TownPaintState {
  const log = logger.fn('paintStateOf', { districts: grid.districtIds.length });
  const levels = [0];
  const fades = [0];
  for (const id of grid.districtIds) {
    const d = vm.districts.find((x) => x.id === id);
    levels.push(d?.level ?? 0);
    fades.push(d === undefined ? 0 : Math.max(0, Math.min(1, 1 - d.fade.saturation)));
  }
  return log.exit({ levels, fades, territory: territory.cells });
}

/** カードを作るときの追加の情報 */
export interface CardExtras {
  readonly phase: SpotCardPhase;
  /** 現在地（分からなければ undefined） */
  readonly position?: LatLng;
  /** 元の位置（距離の計算に使う。敷地の中心ではなく本当の位置） */
  readonly truePosition: LatLng;
  readonly districtName?: string;
  readonly detail?: SpotDetailDto;
  readonly note?: string;
  readonly category?: string;
}

/**
 * お店カードの中身を作る（詳細が取れていれば、チェックインできるか・今日済みかを詳細から）。
 * @param spot 描くスポット
 * @param extras 段階・現在地・詳細など
 * @returns カードの中身
 */
export function cardModelOf(spot: SceneSpot, extras: CardExtras): SpotCardModel {
  const log = logger.fn('cardModelOf', { spotId: spot.id, phase: extras.phase });
  const meters = extras.detail?.meters ?? (extras.position === undefined ? undefined : Math.round(distanceMeters(extras.position, extras.truePosition)));
  const detail = extras.detail;
  const unknown = spot.status === 'unknown' && detail === undefined;
  // 主ボタンに出す短い言葉（文にしない）: 未発見／あと n m／それ以外はカード側の既定
  const hint = unknown ? '未発見' : detail?.metersToVisit !== undefined && detail.metersToVisit > 0 ? `あと${Math.ceil(detail.metersToVisit)}m` : undefined;
  const model: SpotCardModel = {
    id: spot.id,
    kind: spot.kind,
    ...(detail?.name ?? spot.name) === undefined ? {} : { name: detail?.name ?? spot.name },
    ...(unknown || (extras.category ?? detail?.category) === undefined ? {} : { category: detail?.category ?? extras.category }),
    ...(extras.districtName === undefined ? {} : { districtName: extras.districtName }),
    status: detail?.status ?? spot.status,
    ...(spot.goods === undefined ? {} : { goods: spot.goods }),
    ...(spot.today === undefined ? {} : { today: { tag: spot.today.tag, title: spot.today.title } }),
    amenities: detail?.amenities ?? spot.amenities,
    ...(meters === undefined ? {} : { meters }),
    phase: extras.phase,
    canCheckIn: detail?.canVisit === true && extras.phase !== 'walking',
    ...(hint === undefined ? {} : { checkInHint: hint }),
    visitedToday: detail?.visitedToday === true,
    visitCount: detail?.visitCount ?? spot.visitCount,
    want: spot.want,
    ...(extras.note === undefined ? {} : { note: extras.note }),
  };
  return log.exit(model, model.canCheckIn ? 'チェックインできる' : 'まだ');
}
