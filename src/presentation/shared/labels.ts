/**
 * @file 表示ラベル（presentation/shared 層）
 * 便利情報・スポット種別・状態・成長段階・色あせ・距離の表示文言をまとめる（用語は CLAUDE.md 11。「施設」は使わない）。
 * 達成率（％・全n件中m件）を作る関数は置かない（CLAUDE.md 6.5）。
 */
import type { FadeDto, SpotKindDto, SpotStatusDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { formatDistance } from '@/Common/ui/format';
import type { Amenity } from '@/domain/spot/Amenity';

const logger = createLogger('presentation/shared/labels');

/** 便利情報の表示名（CLAUDE.md 4.7） */
export const AMENITY_LABELS: Readonly<Record<Amenity, string>> = {
  kids: '子連れ歓迎',
  toilet: 'トイレ',
  nursing: '授乳室',
  stroller: 'ベビーカーOK',
  rainOk: '雨の日OK',
  parking: '駐車場',
};

/** 便利情報の並び順（フィルタチップの順） */
export const AMENITY_ORDER: readonly Amenity[] = ['kids', 'toilet', 'nursing', 'stroller', 'rainOk', 'parking'];

/** スポット種別の表示名 */
export const KIND_LABELS: Readonly<Record<SpotKindDto, string>> = { landmark: '名所', shop: '店舗' };

/** スポットの状態の表示名（呼び方は CLAUDE.md 11.1。「訪問」「行く」は使わず「達成」で言う） */
export const STATUS_LABELS: Readonly<Record<SpotStatusDto, string>> = {
  unknown: '未発見',
  discovered: '未達成',
  visited: '達成済み',
};

/**
 * 便利情報の値を表示名にする（未知の値は undefined）。
 * @param raw DTO の便利情報の値
 * @returns 表示名
 */
export function amenityLabel(raw: string): string | undefined {
  const log = logger.fn('amenityLabel', { raw });
  return log.exit(isAmenityValue(raw) ? AMENITY_LABELS[raw] : undefined);
}

/**
 * 文字列が便利情報の値か判定する（domain の実装には依存しない型ガード）。
 * @param raw 判定する値
 * @returns AMENITY_ORDER のいずれかなら true
 */
function isAmenityValue(raw: string): raw is Amenity {
  return AMENITY_ORDER.some((amenity) => amenity === raw);
}

/**
 * 成長段階の表示（'Lv2' など。0〜3 に丸める）。
 * @param level 成長段階
 * @returns 表示文字列
 */
export function levelLabel(level: number): string {
  const log = logger.fn('levelLabel', { level });
  const lv = Number.isFinite(level) ? Math.min(3, Math.max(0, Math.round(level))) : 0;
  return log.exit(`Lv${lv}`);
}

/**
 * 色あせ状態の短い表示（地区カードのタグ用）。fresh・never は表示しない。
 * @param fade 色あせ状態
 * @returns 'あと5日で色あせ'／'色あせ中' など。表示しないときは undefined
 */
export function fadeLabel(fade: FadeDto): string | undefined {
  const log = logger.fn('fadeLabel', { kind: fade.kind, daysUntilFade: fade.daysUntilFade });
  if (fade.kind === 'soon') return log.exit(fade.daysUntilFade === undefined ? 'そろそろ色あせ' : `あと${fade.daysUntilFade}日で色あせ`);
  if (fade.kind === 'fading') return log.exit('色あせ中');
  return log.exit(undefined);
}

/**
 * 最後のクエスト達成からの日数の表示（画面では「訪問」と言わない＝CLAUDE.md 11.1。名詞で止める）。
 * @param fade 色あせ状態
 * @returns '23日前'／'今日'／'未達成'
 */
export function lastVisitLabel(fade: FadeDto): string {
  const log = logger.fn('lastVisitLabel', { kind: fade.kind, daysSinceVisit: fade.daysSinceVisit });
  if (fade.kind === 'never' || fade.daysSinceVisit === undefined) return log.exit('未達成');
  return log.exit(fade.daysSinceVisit === 0 ? '今日' : `${fade.daysSinceVisit}日前`);
}

/**
 * 達成した回数の表示（網羅ではなく通いを主役にする。言い回しは全画面共通の「n回達成」）。
 * @param count 訪問回数
 * @returns '3回達成'／'未達成'
 */
export function visitCountLabel(count: number): string {
  const log = logger.fn('visitCountLabel', { count });
  return log.exit(count > 0 ? `${count}回達成` : '未達成');
}

/**
 * 距離の表示（'62m'／'1.2km'）。
 * @param meters 距離（メートル）
 * @returns 表示文字列
 */
export function distanceLabel(meters: number): string {
  return formatDistance(meters);
}
