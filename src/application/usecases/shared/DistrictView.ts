/**
 * @file 地区の状態を画面向け DTO（DistrictMapDto・DistrictCardDto・FadeDto）にする共通部品（application 層）
 * domain の districtStatusOf（成長・色あせ）と LordStandings（地区の主）、CardPolicy.nextCardGoal（次のカード）を組み合わせ、
 * 地図・下シート全画面・マイ街で同じ数字と同じ「次の目標」文言を出す（D2）。文言の日本語化はここで行い、presentation は表示に専念する。
 */
import { createLogger } from '@/Common/logging/logger';
import { assertNever } from '@/Common/utils/assert';
import type { DistrictCardDto, DistrictMapDto, FadeDto, LatLngDto } from '@/application/dto/Dto';
import { standingOf } from '@/application/usecases/shared/LordStandings';
import type { LordStanding } from '@/application/usecases/shared/LordStandings';
import type { World } from '@/application/usecases/shared/World';
import { LORD_WINDOW_DAYS } from '@/domain/competition/constants';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { CardRank } from '@/domain/reward/Card';
import { nextCardGoal } from '@/domain/reward/CardPolicy';
import type { NextCardGoal } from '@/domain/reward/CardPolicy';
import type { District } from '@/domain/town/District';
import { districtStatusOf } from '@/domain/town/DistrictStatus';
import type { DistrictStatus } from '@/domain/town/DistrictStatus';
import type { FadeState } from '@/domain/town/FadePolicy';

const logger = createLogger('application/usecases/shared/DistrictView');

/** 地区1つ分の表示の材料（地区マスタ・状態サマリ・主の状況・次のカード） */
export interface DistrictView {
  readonly district: District;
  readonly status: DistrictStatus;
  readonly standing: LordStanding;
  /** 次に狙えるカード（銀・金とも獲得済みなら無し） */
  readonly nextCard?: NextCardGoal;
}

/** nextGoalText の入力 */
export interface NextGoalInput {
  readonly status: DistrictStatus;
  /** 地区の主の状況（無ければ取り返しの判定をしない） */
  readonly standing?: LordStanding;
  /** 次に狙えるカード */
  readonly nextCard?: NextCardGoal;
}

/** 「カレンダーに追加」用の情報 */
export interface FadeCalendarDto {
  readonly districtName: string;
  /** 色あせ開始日（YYYY-MM-DD） */
  readonly fadeStartDate: string;
}

/** カードのランクの表示名 */
const CARD_RANK_LABEL: Readonly<Record<CardRank, string>> = { silver: '銀', gold: '金' };

/**
 * 地区1つ分の表示の材料を作る。
 * @param world 旅人の世界
 * @param district 対象の地区
 * @returns 表示の材料（凍結済み）
 */
export function districtViewOf(world: World, district: District): DistrictView {
  const log = logger.fn('districtViewOf', { districtId: district.id, today: world.today });
  const visits = world.traveler.visits;
  const status = districtStatusOf({ district, visits, today: world.today });
  const nextCard = nextCardGoal(visits, district.id);
  const view: DistrictView = Object.freeze({ district, status, standing: standingOf(world, district.id), ...(nextCard === undefined ? {} : { nextCard }) });
  return log.exit(view);
}

/**
 * 全地区（SpotRepository.allDistricts の順）の表示の材料を作る。
 * @param world 旅人の世界
 * @returns 地区ごとの表示の材料（地区の表示順）
 */
export function districtViewsOf(world: World): DistrictView[] {
  const log = logger.fn('districtViewsOf', { today: world.today });
  return log.exit(world.spots.allDistricts().map((district) => districtViewOf(world, district)));
}

/**
 * 色あせ状態を DTO にする（日付は文字列）。
 * @param fade 色あせ状態（FadePolicy.stateFor の結果）
 * @returns FadeDto（凍結済み。種類に応じた項目だけを持つ）
 */
export function fadeDtoOf(fade: FadeState): FadeDto {
  const log = logger.fn('fadeDtoOf', { kind: fade.kind });
  switch (fade.kind) {
    case 'never':
      return log.exit(Object.freeze({ kind: 'never' }));
    case 'fresh':
      return log.exit(Object.freeze({ kind: 'fresh', daysSinceVisit: fade.daysSinceVisit }));
    case 'soon':
      return log.exit(Object.freeze({ kind: 'soon', daysSinceVisit: fade.daysSinceVisit, daysUntilFade: fade.daysUntilFade, fadeStartDate: fade.fadeStartDate }));
    case 'fading':
      return log.exit(Object.freeze({ kind: 'fading', daysSinceVisit: fade.daysSinceVisit, progress: fade.progress, fadeStartDate: fade.fadeStartDate }));
    default:
      return assertNever(fade);
  }
}

/**
 * 色あせ間近（soon）のときだけ「カレンダーに追加」用の情報を返す。
 * @param districtName 地区名
 * @param fade 色あせ状態
 * @returns soon なら { districtName, fadeStartDate }、それ以外は undefined
 */
export function fadeCalendarOf(districtName: string, fade: FadeState): FadeCalendarDto | undefined {
  const log = logger.fn('fadeCalendarOf', { kind: fade.kind });
  if (fade.kind !== 'soon') return log.exit(undefined);
  return log.exit(Object.freeze({ districtName, fadeStartDate: fade.fadeStartDate }));
}

/**
 * 地区カードの「次の目標」文言を決める。優先順:
 * 1. 主を奪われ中「取り返しまで：あと{n}回（直近30日）」 2. 色あせ中「再訪で復活＋おかえりボーナス」
 * 3. 色あせ間近「あと{d}日で色あせ」 4. 未訪問「まず1か所を訪問しよう」 5. 次のカード「あと{k}回で{銀|金}カード」
 * 6. 次の成長段階「Lv{n}まであと{remaining}」 7. それ以外「通い続けて街を彩ろう」
 * @param input 状態サマリ・主の状況（任意）・次のカード（任意）
 * @returns 「次の目標」文言
 * @see CLAUDE.md 11（地区カード）, docs/08 D5・D8
 */
export function nextGoalText(input: NextGoalInput): string {
  const log = logger.fn('nextGoalText', { districtId: input.status.districtId, fade: input.status.fade.kind, visitCount: input.status.visitCount });
  const { status, standing, nextCard } = input;
  const { fade } = status;
  if (standing !== undefined && standing.lostByTraveler && !standing.isMe) {
    return log.exit(`奪還まで：あと${standing.needed}回（直近${LORD_WINDOW_DAYS}日）`);
  }
  if (fade.kind === 'fading') return log.exit('再訪で復活＋おかえりボーナス');
  if (fade.kind === 'soon') return log.exit(`あと${fade.daysUntilFade}日で色あせ`);
  if (status.visitCount === 0) return log.exit('まずクエストを1つ達成しよう');
  if (nextCard !== undefined) return log.exit(`あと${nextCard.remainingVisits}回で${CARD_RANK_LABEL[nextCard.rank]}カード`);
  if (status.nextGoal !== undefined) return log.exit(`Lv${status.nextGoal.nextLevel}まであと${status.nextGoal.remainingScore}`);
  return log.exit('通い続けて街を彩ろう');
}

/**
 * 緯度経度を DTO にする（描画専用。ログに出さない）。
 * @param point 位置
 * @returns { lat, lng }
 */
function latLngOf(point: GeoPoint): LatLngDto {
  return { lat: point.lat, lng: point.lng };
}

/**
 * 地図に描く地区の DTO を作る。
 * @param view 地区の表示の材料
 * @returns DistrictMapDto（凍結済み。主なしなら lordName を持たない）
 */
export function toDistrictMapDto(view: DistrictView): DistrictMapDto {
  const log = logger.fn('toDistrictMapDto', { districtId: view.district.id, level: view.status.level, fade: view.status.fade.kind });
  const { district, status, standing } = view;
  const dto: DistrictMapDto = Object.freeze({
    id: district.id,
    name: district.name,
    shortName: district.shortName,
    theme: district.theme,
    color: district.color,
    order: district.order,
    polygon: Object.freeze(district.polygon.map(latLngOf)),
    center: latLngOf(district.center),
    level: status.level,
    score: status.score,
    buildings: status.buildings,
    visitCount: status.visitCount,
    fade: fadeDtoOf(status.fade),
    ...(standing.lordName === undefined ? {} : { lordName: standing.lordName }),
    isLordMe: standing.isMe,
    ...lordFieldsOf(standing),
  });
  return log.exit(dto);
}

/**
 * 地図の王者の台座に使う領主の情報（人ごとのキー・直近30日の回数・奪還までの回数）を返す。
 * @param standing 地区の主の状況
 * @returns DistrictMapDto に足す項目（主なしなら lordKey を持たない）
 */
function lordFieldsOf(standing: LordStanding): Pick<DistrictMapDto, 'lordKey' | 'lordCount' | 'myCount' | 'needed' | 'lordLost'> {
  const log = logger.fn('lordFieldsOf', { districtId: standing.districtId, isMe: standing.isMe });
  const holder = standing.holder;
  const lordKey = holder === undefined ? undefined : holder.type === 'traveler' ? 'me' : holder.rivalId;
  return log.exit({
    ...(lordKey === undefined ? {} : { lordKey }),
    lordCount: standing.lordCount,
    myCount: standing.myCount,
    needed: standing.needed,
    lordLost: standing.lostByTraveler && !standing.isMe,
  });
}

/**
 * 地区カード（成長Lv・色あせ状態・地区の主・次の目標）の DTO を作る。
 * @param view 地区の表示の材料
 * @returns DistrictCardDto（凍結済み。calendar は色あせ間近のときだけ）
 */
export function toDistrictCardDto(view: DistrictView): DistrictCardDto {
  const log = logger.fn('toDistrictCardDto', { districtId: view.district.id, level: view.status.level, fade: view.status.fade.kind });
  const { district, status, standing } = view;
  const calendar = fadeCalendarOf(district.name, status.fade);
  const dto: DistrictCardDto = Object.freeze({
    id: district.id,
    name: district.name,
    shortName: district.shortName,
    color: district.color,
    level: status.level,
    score: status.score,
    buildings: status.buildings,
    visitCount: status.visitCount,
    fade: fadeDtoOf(status.fade),
    ...(standing.lordName === undefined ? {} : { lordName: standing.lordName }),
    isLordMe: standing.isMe,
    lordLost: standing.lostByTraveler && !standing.isMe,
    nextGoalText: nextGoalText(view),
    ...(calendar === undefined ? {} : { calendar }),
  });
  return log.exit(dto);
}
