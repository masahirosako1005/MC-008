/**
 * @file 街の活気（にぎわい／廃れ）と、お店ごとの陣取り（presentation/screens/Map/town 層。純粋関数）
 * 2026-11-10 ユーザー指示「陣取りで街の活性とともに、陣地がとられていくと街が廃れていく感じに」「領地のマスの概念はいらない」。
 * 陣取りはマス（セル）ではなくお店・名所の単位で数える。地区の活気 0..1 は、領主（自分かライバルか）・直近30日の回数の差・成長段階・色あせから決める。
 * ライバルが領主の地区では、活気が低いほど多くのお店がライバルの手に渡り（奪われた地区では自分が通ったお店から）、そのまわりの街が廃れて見える。
 * 見た目だけで、Lv・カード・図鑑・EXP は減らない（CLAUDE.md 4.3・5章）。乱数は使わず地区とスポットの ID で決める。座標は扱わない。
 */
import { createLogger } from '@/Common/logging/logger';
import { hashString } from '@/Common/ui/canvas/seededHash';

const logger = createLogger('presentation/screens/Map/town/vitality');

/** 地区の雰囲気（にぎやか／ふつう／廃れ気味） */
export type DistrictMood = 'lively' | 'calm' | 'decaying';

/** スポットの持ち主（陣取り） */
export type SpotOwner = 'mine' | 'rival';

/** これ以上なら「にぎやか」（仮） */
export const LIVELY_FROM = 0.65;
/** ライバルが領主で、これより下なら「廃れ気味」（仮） */
export const DECAYING_BELOW = 0.4;
/** ライバルが領主の地区で、活気が 0 のときにライバルの手に渡るお店の割合（仮） */
export const RIVAL_SHARE_AT_ZERO = 0.55;
/** 奪われた地区で、自分が通ったお店のうち奪われる割合の上限（仮） */
export const TAKEN_MINE_MAX_SHARE = 0.5;

/** 活気の計算に使う地区（DistrictMapDto の一部） */
export interface VitalityDistrictInput {
  readonly id: string;
  readonly level: number;
  readonly isLordMe: boolean;
  readonly lordName?: string;
  readonly lordCount?: number;
  readonly myCount?: number;
  readonly lordLost?: boolean;
  readonly fade: { readonly kind: string; readonly progress?: number };
}

/** 活気の計算に使うスポット（MapSpotDto の一部） */
export interface VitalitySpotInput {
  readonly id: string;
  readonly kind: string;
  readonly districtId: string;
  readonly visitCount: number;
}

/** 地区の活気 */
export interface DistrictVitality {
  readonly districtId: string;
  /** 0..1（1 が最もにぎやか） */
  readonly vitality: number;
  readonly mood: DistrictMood;
  /** ライバルの手に渡っているスポット */
  readonly rivalSpotIds: readonly string[];
  /** 自分のスポット（達成済みで、奪われていない） */
  readonly mineSpotIds: readonly string[];
}

/** 街全体の活気と陣取り */
export interface VitalityModel {
  readonly byDistrict: ReadonlyMap<string, DistrictVitality>;
  /** スポットID → 持ち主（どちらでもなければ無し） */
  readonly ownerOf: ReadonlyMap<string, SpotOwner>;
}

/**
 * 地区の活気 0..1 を決める。
 * @param d 地区
 * @param hasMine 自分が達成したスポットがあるか
 * @returns 活気
 */
export function vitalityOf(d: VitalityDistrictInput, hasMine: boolean): number {
  const log = logger.fn('vitalityOf', { districtId: d.id, isLordMe: d.isLordMe, lordLost: d.lordLost === true });
  const level = Math.min(3, Math.max(0, Math.round(d.level)));
  let base: number;
  const share = Math.min(1, (d.myCount ?? 0) / Math.max(1, d.lordCount ?? 1));
  if (d.isLordMe) base = 0.72 + level * 0.07;
  // 奪われた地区は廃れる（取り戻すほど回数の差が縮まると持ち直す）
  else if (d.lordName !== undefined && d.lordLost === true) base = 0.18 + share * 0.3;
  // ライバルが領主で、自分も通っている地区は差しだいで廃れる。まだ行ったことのない地区は「街が待っている」ふつうの姿（初めての人の地図が暗くならないように＝A）
  else if (d.lordName !== undefined) base = hasMine || (d.myCount ?? 0) > 0 ? 0.3 + share * 0.35 : 0.42;
  else base = hasMine ? 0.55 : 0.42;
  if (d.fade.kind === 'fading') base *= 1 - 0.35 * Math.min(1, Math.max(0, d.fade.progress ?? 0));
  else if (d.fade.kind === 'soon') base -= 0.04;
  return log.exit(Math.round(Math.min(1, Math.max(0.05, base)) * 1000) / 1000);
}

/**
 * 活気と領主から雰囲気を決める。
 * @param vitality 活気
 * @param rivalLord ライバルが領主か
 * @returns 雰囲気
 */
export function moodOf(vitality: number, rivalLord: boolean): DistrictMood {
  const log = logger.fn('moodOf', { vitality, rivalLord });
  if (vitality >= LIVELY_FROM) return log.exit('lively');
  if (rivalLord && vitality < DECAYING_BELOW) return log.exit('decaying');
  return log.exit('calm');
}

/**
 * 街全体の活気と、お店ごとの持ち主を計算する。
 * @param districts 地区
 * @param spots スポット（便利施設は含めない）
 * @returns 活気と陣取り
 */
export function computeVitality(districts: readonly VitalityDistrictInput[], spots: readonly VitalitySpotInput[]): VitalityModel {
  const log = logger.fn('computeVitality', { districts: districts.length, spots: spots.length });
  const byDistrict = new Map<string, DistrictVitality>();
  const ownerOf = new Map<string, SpotOwner>();
  for (const d of districts) {
    const own = spots.filter((s) => s.districtId === d.id && (s.kind === 'shop' || s.kind === 'landmark'));
    const visited = own.filter((s) => s.visitCount > 0);
    const vitality = vitalityOf(d, visited.length > 0);
    const rivalLord = !d.isLordMe && d.lordName !== undefined;
    const rival = rivalLord ? rivalSpotsOf(d, own, visited, vitality) : [];
    const rivalSet = new Set(rival);
    const mine = visited.filter((s) => !rivalSet.has(s.id)).map((s) => s.id);
    for (const id of mine) ownerOf.set(id, 'mine');
    for (const id of rival) ownerOf.set(id, 'rival');
    byDistrict.set(d.id, { districtId: d.id, vitality, mood: moodOf(vitality, rivalLord), rivalSpotIds: rival, mineSpotIds: mine });
  }
  return log.exit({ byDistrict, ownerOf }, `ライバル ${[...ownerOf.values()].filter((o) => o === 'rival').length} 件`);
}

/**
 * ライバルの手に渡るスポットを選ぶ（活気が低いほど多い。奪われた地区では、自分が通った回数の少ないお店から先に奪われる）。
 * @param d 地区
 * @param own 地区のスポット
 * @param visited そのうち自分が達成したもの
 * @param vitality 活気
 * @returns スポットID
 */
function rivalSpotsOf(d: VitalityDistrictInput, own: readonly VitalitySpotInput[], visited: readonly VitalitySpotInput[], vitality: number): string[] {
  const log = logger.fn('rivalSpotsOf', { districtId: d.id });
  if (own.length === 0) return log.exit([]);
  const total = Math.min(own.length, Math.max(1, Math.round(own.length * (1 - vitality) * RIVAL_SHARE_AT_ZERO)));
  const share = Math.min(1, (d.myCount ?? 0) / Math.max(1, d.lordCount ?? 1));
  const takeMine = d.lordLost === true ? Math.min(visited.length, total, Math.ceil(visited.length * (1 - share) * TAKEN_MINE_MAX_SHARE)) : 0;
  /**
   * 地区ごとに決まった順（ID のハッシュ）で比べる。
   * @param a スポット
   * @param b スポット
   * @returns 並べ替えの比較値
   */
  const byHash = (a: VitalitySpotInput, b: VitalitySpotInput): number => hashString(`${d.id}:${a.id}`) - hashString(`${d.id}:${b.id}`); // audit-ignore: fnlog-missing 並べ替えの比較
  const taken = [...visited].sort((a, b) => a.visitCount - b.visitCount || byHash(a, b)).slice(0, takeMine);
  const rest = own.filter((s) => s.visitCount === 0).sort(byHash).slice(0, total - taken.length);
  return log.exit([...taken, ...rest].map((s) => s.id));
}

/**
 * 前回から雰囲気が変わった地区を返す（奪われて廃れた／奪還してにぎわいが戻った、の演出に使う）。
 * @param before 前回（無ければ何も変わっていない扱い）
 * @param after 今回
 * @returns 変わった地区（悪くなった＝down、良くなった＝up）
 */
export function vitalityChanges(before: VitalityModel | undefined, after: VitalityModel): { readonly districtId: string; readonly direction: 'up' | 'down' }[] {
  const log = logger.fn('vitalityChanges', { hasBefore: before !== undefined });
  if (before === undefined) return log.exit([]);
  const out: { districtId: string; direction: 'up' | 'down' }[] = [];
  for (const [id, next] of after.byDistrict) {
    const prev = before.byDistrict.get(id);
    if (prev === undefined) continue;
    const rank = { decaying: 0, calm: 1, lively: 2 } as const;
    const moved = rank[next.mood] - rank[prev.mood];
    const taken = next.rivalSpotIds.length - prev.rivalSpotIds.length;
    if (moved < 0 || (moved === 0 && taken > 0)) out.push({ districtId: id, direction: 'down' });
    else if (moved > 0 || (moved === 0 && taken < 0)) out.push({ districtId: id, direction: 'up' });
  }
  return log.exit(out, `${out.length} 地区`);
}
