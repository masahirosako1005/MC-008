/**
 * @file 獲得した ★4（SSR 級）カードのキラキラの層（presentation/screens/Zukan 層）
 * 2026-11-09 ユーザー指示「獲得したSSR級はリッチコンテンツでキラキラさせてほしい」。
 * 回る虹の枠・ホログラムの粒・走る光・またたく星の4層を重ねる。見た目は ZukanRarity.css の「ラウンド5」。
 * 格子のカードと拡大プレビューの両方で使う。動きは prefers-reduced-motion で止める（CSS 側）。
 */
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';

const logger = createLogger('presentation/screens/Zukan/ShinyLayer');

/** キラキラの星の置き場所（カード内の %・大きさ rem・遅れ s） */
const SHINY_STARS: readonly { readonly x: number; readonly y: number; readonly size: number; readonly delay: number; readonly glyph: string }[] = [
  { x: 10, y: 8, size: 0.75, delay: 0, glyph: '✦' },
  { x: 84, y: 14, size: 0.5625, delay: 0.5, glyph: '✧' },
  { x: 70, y: 40, size: 0.875, delay: 1.1, glyph: '✦' },
  { x: 18, y: 46, size: 0.5, delay: 1.6, glyph: '✧' },
  { x: 50, y: 6, size: 0.4375, delay: 0.8, glyph: '✦' },
  { x: 90, y: 62, size: 0.625, delay: 2.0, glyph: '✦' },
  { x: 6, y: 72, size: 0.6875, delay: 0.3, glyph: '✧' },
  { x: 58, y: 86, size: 0.5, delay: 1.35, glyph: '✦' },
];

/**
 * 獲得した ★4 のキラキラの層（回る虹の枠・走る光・またたく星）を作る。拡大プレビューでも使う。
 * @returns 要素（aria-hidden）
 */
export function createShinyLayer(): HTMLElement {
  const log = logger.fn('createShinyLayer');
  const stars = SHINY_STARS.map((star, i) => {
    const el = h('span', { class: 'shiny-fx__star', text: star.glyph });
    setStyle(el, '--x', `${star.x}%`);
    setStyle(el, '--y', `${star.y}%`);
    setStyle(el, '--s', `${star.size}rem`);
    setStyle(el, '--d', `${star.delay}s`);
    setStyle(el, '--n', String(i));
    return el;
  });
  return log.exit(
    h('span', { class: 'shiny-fx', attrs: { 'aria-hidden': 'true' } }, [
      h('span', { class: 'shiny-fx__ring' }),
      h('span', { class: 'shiny-fx__glitter' }),
      h('span', { class: 'shiny-fx__shine' }),
      h('span', { class: 'shiny-fx__stars' }, stars),
    ]),
  );
}
