/**
 * @file 図鑑のレア度の凡例（presentation/screens/Zukan 層）
 * 4段階のレア度の見本と、この地区で手に入れた枚数（持っている数だけ。全体の枚数や達成率は出さない＝CLAUDE.md 6.5）。
 * レジェンドが未入手なら「この地区のどこかに眠っている」と煽り、見つけに行く動機にする（基準 B）。
 */
import type { RarityDto, ZukanTileDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { RARITY_CODES } from '@/presentation/screens/Zukan/cardFace';

const logger = createLogger('presentation/screens/Zukan/RarityLegend');

/** 凡例の並び（上位から） */
const LEGEND_ORDER: readonly RarityDto[] = [4, 3, 2, 1];

/** 凡例の名前 */
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
 * 凡例を作る。
 * @param tiles 選んでいる地区のタイル
 * @returns 要素
 */
export function createRarityLegend(tiles: readonly ZukanTileDto[]): HTMLElement {
  const log = logger.fn('createRarityLegend', { tiles: tiles.length });
  const owned = ownedByRarity(tiles);
  const legend = tiles.find((t) => t.rarity === 4);
  const legendText =
    legend === undefined
      ? undefined
      : legend.awakened === true
        ? '極に覚醒したレジェンドを持っています！'
        : legend.status === 'visited'
          ? 'レジェンド入手済み。春夏秋冬で訪れると「極」に覚醒'
          : 'この地区のレジェンドがどこかに眠っています';
  return log.exit(
    h('section', { class: 'rarity-legend', attrs: { 'data-testid': 'zukan-rarity-legend', 'aria-label': 'レア度と手持ちの枚数' } }, [
      h(
        'ul',
        { class: 'rarity-legend__list' },
        LEGEND_ORDER.map((r) =>
          h('li', { class: 'rarity-legend__item', dataset: { rarity: String(r) } }, [
            h('span', { class: 'rarity-legend__chip', text: RARITY_CODES[r] }),
            h('span', { class: 'rarity-legend__name', text: `${'★'.repeat(r)} ${LEGEND_NAMES[r]}` }),
            h('span', { class: 'rarity-legend__owned', text: `${owned[r]}枚` }),
          ]),
        ),
      ),
      legendText === undefined ? undefined : h('p', { class: 'rarity-legend__teaser', dataset: { owned: legend?.status === 'visited' ? '1' : '0' }, text: legendText }),
    ]),
  );
}
