/**
 * @file 図鑑の手持ち枚数（presentation/screens/Zukan 層）
 * 絞り込んだ地区（すべての地区も可）で手に入れた枚数を、レア度ごとに細い1行で出す（持っている数だけ。全体の枚数や達成率は出さない＝CLAUDE.md 6.5）。
 * 2026-11-09 ユーザー指示「図鑑を開いたらすぐに写真が見えるのが自然」で、2段の凡例とレジェンドの一言をやめて1行にした。
 */
import type { RarityDto, ZukanTileDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { RARITY_CODES } from '@/presentation/screens/Zukan/cardFace';

const logger = createLogger('presentation/screens/Zukan/RarityLegend');

/** 凡例の並び（上位から） */
const LEGEND_ORDER: readonly RarityDto[] = [4, 3, 2, 1];

/** 読み上げ用のレア度の名前 */
const LEGEND_NAMES: Readonly<Record<RarityDto, string>> = { 1: 'ノーマル', 2: 'レア', 3: 'スーパーレア', 4: 'レジェンド' };

/**
 * レア度ごとの手持ち枚数（訪問済みのカード）を数える。
 * @param tiles タイル
 * @returns レア度 → 枚数
 */
export function ownedByRarity(tiles: readonly ZukanTileDto[]): Record<RarityDto, number> {
  const log = logger.fn('ownedByRarity', { tiles: tiles.length });
  const counts: Record<RarityDto, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const t of tiles) if (t.status === 'visited') counts[t.rarity ?? 1] += 1;
  return log.exit(counts);
}

/**
 * 手持ち枚数の1行を作る（'手持ち  LG 4 · SR 6 · R 14 · N 12'）。
 * @param tiles 絞り込んだ地区のタイル（状態の絞り込みはかけない）
 * @returns 要素
 */
export function createRarityLegend(tiles: readonly ZukanTileDto[]): HTMLElement {
  const log = logger.fn('createRarityLegend', { tiles: tiles.length });
  const owned = ownedByRarity(tiles);
  const spoken = LEGEND_ORDER.map((r) => `${LEGEND_NAMES[r]} ${owned[r]}枚`).join('、');
  return log.exit(
    h('p', { class: 'rarity-legend', attrs: { 'data-testid': 'zukan-rarity-legend', 'aria-label': `手持ちのカード: ${spoken}` } }, [
      h('span', { class: 'rarity-legend__title', attrs: { 'aria-hidden': 'true' }, text: '手持ち' }),
      ...LEGEND_ORDER.map((r) =>
        h('span', { class: 'rarity-legend__item', attrs: { 'aria-hidden': 'true' }, dataset: { rarity: String(r) } }, [
          h('span', { class: 'rarity-legend__chip', text: RARITY_CODES[r] }),
          h('span', { class: 'rarity-legend__owned', text: String(owned[r]) }),
        ]),
      ),
    ]),
  );
}
