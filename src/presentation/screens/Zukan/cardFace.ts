/**
 * @file 図鑑カードの「顔」（カテゴリのピクトグラムとレア度の見せ方）を決める純粋関数（presentation/screens/Zukan 層）
 * 似た街なみ絵だけでは中身が見分けにくいので、カテゴリごとのピクトグラム（絵文字）とカテゴリ名をカードの主役にする。
 * レア度は ★の数・略号（N/R/SR/LG）・名前の重ねがけで示す（色だけに頼らない）。DOM に触れない（テスト対象）。
 */
import type { RarityDto, SpotKindDto, ZukanTileDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/screens/Zukan/cardFace');

/** カテゴリ → ピクトグラム（master の category と対応。無いものは種別の既定） */
export const CATEGORY_ICONS: Readonly<Record<string, string>> = Object.freeze({
  史跡: '🏯', 町並み: '🏘️', 港: '⚓', 市場: '🐟', 展望: '🔭', 商店街: '🏮', 建築: '🏛️', 広場: '⛲', 自然: '🌳', 温泉: '♨️', 公園: '🌸',
  カフェ: '☕', 和菓子: '🍡', 甘味処: '🍧', 甘味: '🍨', パン: '🥐', ギャラリー: '🖼️', そば: '🍜', 雑貨: '🎁', 工芸: '🏺', 食堂: '🍱',
  古書: '📚', 書店: '📖', 漬物: '🥒', 鮮魚: '🐠', 干物: '🐡', 寿司: '🍣', 練り物: '🍥', 浜焼き: '🦪', 古道具: '🕰️', レンタル: '🚲',
  総菜: '🍢', 青果: '🍎', 文具: '✏️', 豆腐: '🥢', 玩具: '🪀', 古着: '👘', 銭湯: '🛁', 洋食: '🍛', 花: '💐', 直売所: '🧺',
  はちみつ: '🍯', 陶芸: '🍶', 茶屋: '🍵', 軽食: '🥪', 遊技: '🎯', 土産: '🛍️', 神社: '⛩️', 寺: '🛕', 博物館: '🏛️', 居酒屋: '🏮', ラーメン: '🍜',
});

/** 種別ごとの既定のピクトグラム */
const KIND_ICONS: Readonly<Record<SpotKindDto, string>> = { landmark: '📍', shop: '🏪' };

/** レア度ごとの略号と名前（DTO に名前が無いときの予備） */
export const RARITY_CODES: Readonly<Record<RarityDto, string>> = { 1: 'N', 2: 'R', 3: 'SR', 4: 'LG' };

/** レア度の名前（予備） */
const RARITY_FALLBACK_NAMES: Readonly<Record<RarityDto, string>> = { 1: 'ノーマル', 2: 'レア', 3: 'スーパーレア', 4: 'レジェンド' };

/**
 * カードのピクトグラム（2026-11-09「アイコンが？になっているけどすべて表示」で未発見でも出す）。
 * @param tile タイル
 * @returns 絵文字（カテゴリに無いものは種別の既定）
 */
export function categoryIconOf(tile: ZukanTileDto): string {
  const log = logger.fn('categoryIconOf', { status: tile.status, category: tile.category });
  return log.exit((tile.category === undefined ? undefined : CATEGORY_ICONS[tile.category]) ?? KIND_ICONS[tile.kind]);
}

/**
 * 獲得した最上位（SSR 級＝★4 レジェンド）のカードか。キラキラの演出を付ける（2026-11-09 ユーザー指示）。
 * @param tile タイル
 * @returns 訪問済みの ★4 なら true
 */
export function isShinyCard(tile: ZukanTileDto): boolean {
  const log = logger.fn('isShinyCard', { status: tile.status, rarity: tile.rarity });
  return log.exit(tile.status === 'visited' && tile.rarity === 4);
}

/** カードに出すレア度の表示 */
export interface RarityView {
  readonly rarity: RarityDto;
  /** '★★★★' */
  readonly stars: string;
  /** 'LG' */
  readonly code: string;
  /** 'レジェンド'（覚醒なら '極・レジェンド'） */
  readonly name: string;
}

/**
 * レア度の表示を作る（レア度が無いタイルは ★1 として扱う）。
 * @param tile タイル
 * @returns RarityView
 */
export function rarityViewOf(tile: ZukanTileDto): RarityView {
  const log = logger.fn('rarityViewOf', { rarity: tile.rarity, awakened: tile.awakened });
  const rarity: RarityDto = tile.rarity ?? 1;
  const base = tile.rarityName ?? RARITY_FALLBACK_NAMES[rarity];
  return log.exit({ rarity, stars: '★'.repeat(rarity), code: tile.awakened === true ? '極' : RARITY_CODES[rarity], name: tile.awakened === true ? `極・${base}` : base });
}

