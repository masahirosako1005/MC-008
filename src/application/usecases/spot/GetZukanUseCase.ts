/**
 * @file 図鑑（地区別のタイルと通った回数）を返すユースケース（application 層・読取系）
 * 未発見＝「？」（id・名前・カテゴリを含めない）、発見済み＝シルエット、訪問済み＝カラー＋通った回数（CLAUDE.md 6.5、wireframes/05_zukan）。基準 B・C。
 * 訪問済みには「なじみ度」（同じスポットに通うほど上がる）と訪れた季節を付け、次に通う理由にする（報酬は通いに出す＝CLAUDE.md 4.6）。
 * 達成率（％や「全n件中m件」）は返さない。埋めることではなく通うことを主役にする（CLAUDE.md 13）。
 * 成長段階・色あせ・なじみ度は訪問記録と今日から導出する（D4）。地区の数字と「次の目標」は DistrictView に集約（D2）。書込みはしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId } from '@/Common/types/Id';
import { formatJpDate, seasonOf } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import type { UseCase } from '@/application/AppServices';
import type { FamiliarityDto, SeasonDto, ZukanDistrictDto, ZukanDistrictTabDto, ZukanDto, ZukanInput, ZukanTileDto } from '@/application/dto/Dto';
import { spotStatusOf } from '@/application/usecases/exploration/SpotStatus';
import { districtViewsOf, fadeDtoOf, toDistrictCardDto } from '@/application/usecases/shared/DistrictView';
import type { DistrictView } from '@/application/usecases/shared/DistrictView';
import { loadWorld } from '@/application/usecases/shared/World';
import type { WorldDeps } from '@/application/usecases/shared/World';
import { FAMILIAR_VISITS, FAMILIARITY_LABELS, REGULAR_VISITS } from '@/application/usecases/spot/constants';
import { withRarity } from '@/application/usecases/spot/zukanRarity';
import { legendSpotIdsOf } from '@/domain/spot/SpotRarity';
import type { Traveler } from '@/domain/exploration/Traveler';
import { visitsOfSpot } from '@/domain/exploration/VisitStats';
import type { Spot } from '@/domain/spot/Spot';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import type { District } from '@/domain/town/District';

const logger = createLogger('application/usecases/spot/GetZukanUseCase');

/** 地区が見つからないときの失敗コード */
export const DISTRICT_NOT_FOUND = 'DISTRICT_NOT_FOUND';

/** GetZukanUseCase の依存（旅人の世界を読む一式。地区の主を含めて「次の目標」を地区カードとそろえる） */
export type GetZukanDeps = WorldDeps;

/** スポット種別の並び順（名所→店舗） */
const KIND_ORDER: Readonly<Record<Spot['kind'], number>> = { landmark: 0, shop: 1 };

/** 季節の並び（春→冬） */
const SEASON_ORDER: readonly SeasonDto[] = ['spring', 'summer', 'autumn', 'winter'];

/**
 * 通った回数からなじみ度を決める（回数は減らないので、なじみ度も下がらない）。
 * @param visitCount 同じスポットへの訪問回数（1以上）
 * @returns 1=訪問、2=なじみ、3=常連
 */
export function familiarityOf(visitCount: number): FamiliarityDto {
  const log = logger.fn('familiarityOf', { visitCount });
  if (visitCount >= REGULAR_VISITS) return log.exit(3);
  return log.exit(visitCount >= FAMILIAR_VISITS ? 2 : 1);
}

/**
 * 次のなじみ度までの文言（「あと2回で常連」）。最高段階なら undefined。
 * @param visitCount 同じスポットへの訪問回数
 * @returns 文言
 */
export function nextFamiliarityText(visitCount: number): string | undefined {
  const log = logger.fn('nextFamiliarityText', { visitCount });
  if (visitCount >= REGULAR_VISITS) return log.exit(undefined);
  const [target, label] = visitCount >= FAMILIAR_VISITS ? [REGULAR_VISITS, FAMILIARITY_LABELS[3]] : [FAMILIAR_VISITS, FAMILIARITY_LABELS[2]];
  return log.exit(`あと${target - visitCount}回で${label}`);
}

/**
 * スポットを図鑑の並び（名所→店舗、同種は ID 順）にそろえる。状態では並べ替えない（位置の手がかりを増やさない）。
 * @param spots 地区内のスポット
 * @returns 並べ替えた新しい配列
 */
function sortForZukan(spots: readonly Spot[]): Spot[] {
  const log = logger.fn('sortForZukan', { count: spots.length });
  const sorted = [...spots].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return log.exit(sorted);
}

/**
 * 訪問済みスポットの通った回数・なじみ度・季節・今日訪問したかを作る。
 * @param traveler 旅人
 * @param spot スポット
 * @param today 今日
 * @returns タイルに足す項目
 */
function visitedExtrasOf(traveler: Traveler, spot: Spot, today: LocalDate): Omit<ZukanTileDto, 'id' | 'name' | 'kind' | 'category' | 'status'> {
  const log = logger.fn('visitedExtrasOf', { spotId: spot.id });
  const visits = visitsOfSpot(traveler.visits, spot.id);
  const familiarity = familiarityOf(visits.length);
  const seasonSet = new Set(visits.map((v) => seasonOf(v.localDate)));
  const next = nextFamiliarityText(visits.length);
  return log.exit({
    visitCount: visits.length,
    familiarity,
    familiarityLabel: FAMILIARITY_LABELS[familiarity],
    ...(next === undefined ? {} : { nextFamiliarityText: next }),
    seasons: Object.freeze(SEASON_ORDER.filter((season) => seasonSet.has(season))),
    visitedToday: traveler.hasVisitedOn(spot.id, today),
  });
}

/**
 * スポット1件をタイルにする。未発見は id・名前・カテゴリを含めない（B）。
 * @param traveler 旅人
 * @param spot スポット
 * @param today 今日
 * @returns ZukanTileDto（凍結済み）
 */
function toTile(traveler: Traveler, spot: Spot, today: LocalDate): ZukanTileDto {
  const log = logger.fn('toTile', { spotId: spot.id });
  const status = spotStatusOf(traveler, spot.id);
  if (status === 'unknown') return log.exit(Object.freeze({ kind: spot.kind, status, visitCount: 0 }), 'unknown');
  const base = { id: spot.id, name: spot.name, kind: spot.kind, category: spot.category, status };
  if (status === 'discovered') return log.exit(Object.freeze({ ...base, visitCount: 0 }), 'discovered');
  return log.exit(Object.freeze({ ...base, ...visitedExtrasOf(traveler, spot, today) }));
}

/**
 * 選んでいる地区のヘッダー（色・成長段階・通った回数・最近いつ・色あせ・次の目標）を作る。
 * @param view 地区の表示の材料
 * @returns ZukanDistrictDto（凍結済み）
 */
function toDistrictHeader(view: DistrictView): ZukanDistrictDto {
  const { district, status } = view;
  const log = logger.fn('toDistrictHeader', { districtId: district.id, level: status.level });
  const dto: ZukanDistrictDto = Object.freeze({
    id: district.id,
    name: district.name,
    theme: district.theme,
    color: district.color,
    level: status.level,
    visitCount: status.visitCount,
    ...(status.lastVisit === undefined ? {} : { lastVisitLabel: formatJpDate(status.lastVisit) }),
    fade: fadeDtoOf(status.fade),
    nextGoalText: toDistrictCardDto(view).nextGoalText,
  });
  return log.exit(dto);
}

/**
 * 地区タブの一覧（表示順・色あせ状態つき）を作る。
 * @param views 全地区の表示の材料
 * @returns ZukanDistrictTabDto の配列（凍結済み）
 */
function districtTabsOf(views: readonly DistrictView[]): readonly ZukanDistrictTabDto[] {
  const log = logger.fn('districtTabsOf', { count: views.length });
  const tabs = views.map(({ district, status }) =>
    Object.freeze({ id: district.id, shortName: district.shortName, theme: district.theme, color: district.color, fadeKind: status.fade.kind }),
  );
  return log.exit(Object.freeze(tabs));
}

/**
 * 入力の地区ID を解決する（省略時は表示順の先頭）。
 * @param spots マスタ参照
 * @param input 入力（URL 由来でもよい）
 * @returns 成功: 地区。失敗: INVALID_INPUT（ID 形式が不正）／DISTRICT_NOT_FOUND
 */
function resolveDistrict(spots: SpotRepository, input: unknown): Result<District> {
  const log = logger.fn('resolveDistrict');
  const raw = isRecord(input) ? input['districtId'] : undefined;
  if (raw === undefined) {
    const first = [...spots.allDistricts()].sort((a, b) => a.order - b.order)[0];
    if (first === undefined) return log.fail(fail(AppError.of(DISTRICT_NOT_FOUND, '地区が見つかりません')), '地区マスタが空');
    return log.exit(ok(first));
  }
  const districtId = parseDistrictId(raw);
  if (!districtId.ok) return log.fail(districtId, 'districtId が不正');
  const district = spots.findDistrict(districtId.value);
  if (district === undefined) return log.fail(fail(AppError.of(DISTRICT_NOT_FOUND, '地区が見つかりません', { districtId: districtId.value })));
  return log.exit(ok(district));
}

/** 図鑑を返す */
export class GetZukanUseCase implements UseCase<ZukanInput, ZukanDto> {
  /**
   * 依存を受け取る。
   * @param deps 旅人の世界を読む一式（セッション・各リポジトリ・マスタ・時計）
   */
  constructor(private readonly deps: GetZukanDeps) {}

  /**
   * 指定した地区（省略時は先頭の地区）の図鑑を返す。
   * @param input districtId（任意。URL 由来の値でもよい。境界で検証する＝SEC-16）
   * @returns 成功: ZukanDto（達成率を含まない・凍結済み）。
   *          失敗: INVALID_INPUT（districtId 不正）／DISTRICT_NOT_FOUND／TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect セッション・旅人・地区の主・ライバル行動のリポジトリを読む（書込みはしない）
   */
  async execute(input: ZukanInput): Promise<Result<ZukanDto>> {
    const log = logger.fn('execute');
    const district = resolveDistrict(this.deps.spots, input);
    if (!district.ok) return log.fail(district);
    const world = await loadWorld(this.deps);
    if (!world.ok) return log.fail(world);
    const { traveler, today } = world.value;
    const views = districtViewsOf(world.value).sort((a, b) => a.district.order - b.district.order);
    const selected = views.find((view) => view.district.id === district.value.id);
    if (selected === undefined) return log.fail(fail(AppError.of(DISTRICT_NOT_FOUND, '地区が見つかりません', { districtId: district.value.id })));
    const legendIds = legendSpotIdsOf(this.deps.spots.allSpots());
    const tiles = sortForZukan(this.deps.spots.spotsInDistrict(district.value.id)).map((spot) => withRarity(toTile(traveler, spot, today), spot, legendIds));
    const dto: ZukanDto = Object.freeze({ districts: districtTabsOf(views), district: toDistrictHeader(selected), tiles: Object.freeze(tiles) });
    log.debug('図鑑', { districtId: district.value.id, tiles: tiles.length, visited: tiles.filter((t) => t.status === 'visited').length });
    return log.exit(ok(dto));
  }
}
