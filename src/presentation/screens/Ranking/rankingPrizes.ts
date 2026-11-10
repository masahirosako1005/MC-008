/**
 * @file ランキング画面の報酬の見せ方（presentation/screens/Ranking 層。DOM の組立てだけ）
 * 報酬はアバターの部品なので、文字ではなく部品だけの小さな絵で見せる（帽子・アクセサリー・持ち物・相棒は体を描かずに部品だけ＝shared/avatar/itemArt。
 * 2026-11-10 ユーザー指示「アバター着用時のスクショではなくアイテムのみの画像に」。置くもの・背景はその絵、称号は王冠の印）。
 * - 報酬の絵（レア度の枠つき。報酬カードでは、手に入れていればチェック）
 * - 順位表にはさむ段の帯（「4〜5位 → 月桂冠」。次にねらえる段には「あと○回」）
 * - 報酬を手に入れたときの全画面の演出（光の筋・閃光・紙吹雪・花火・報酬が弾んで出る。「着る」でアバター画面へ）
 * 動きは CSS（prefers-reduced-motion: no-preference のときだけ）。動きが無くてもすべて見える。
 */
import type { RewardPrizeDto, RewardTierDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';
import { slotOfPartId } from '@/presentation/screens/Avatar/avatarScreenModel';
import { createPartThumb } from '@/presentation/screens/Avatar/partThumb';
import { createConfetti } from '@/presentation/screens/Ranking/rankingStage';
import { createItemArt } from '@/presentation/shared/avatar/itemArt';

const logger = createLogger('presentation/screens/Ranking/rankingPrizes');

/** 報酬の絵の大きさ（CSS px） */
export const PRIZE_SIZE = { podium: 26, band: 30, chip: 22, card: 34, get: 96 } as const;

/** 演出に並べる報酬の最大数（これより多ければ「ほか○点」） */
const MAX_GET_ITEMS = 3;

/** 演出のきらめきの位置（%）と大きさ（rem） */
const GET_SPARKS: readonly (readonly [number, number, number])[] = [[12, 18, 1.1], [86, 14, 0.9], [20, 62, 0.8], [80, 58, 1.2], [50, 8, 0.8], [8, 40, 0.7], [92, 36, 0.9], [34, 78, 0.7], [68, 80, 1]];

/** 演出の花火の位置（%）と出る順 */
const GET_BURSTS: readonly (readonly [number, number])[] = [[18, 22], [82, 26], [50, 12], [26, 70], [76, 72]];

/**
 * 報酬1つの絵（レア度の枠つき）を作る。帽子・アクセサリー・持ち物・相棒は部品だけの絵、置くもの・背景はその絵。称号は絵が無いので王冠の印、部品ID が無い報酬は星の印。
 * @param prize 報酬
 * @param base いまの装い（部品だけで描けない部品のときだけ、これに着せて描く）
 * @param size 一辺（CSS px）
 * @param showOwned 手に入れていればチェックを付けるか（報酬カードだけ。表彰台や帯では、ほかの人が持っているように見えるので付けない）
 * @returns 要素（飾り。読み上げない）
 */
export function createPrizeIcon(prize: RewardPrizeDto, base: readonly string[], size: number, showOwned = false): HTMLElement {
  const log = logger.fn('createPrizeIcon', { partId: prize.partId, size });
  const owned = showOwned && prize.owned === true;
  const slot = prize.partId === undefined ? undefined : slotOfPartId(prize.partId);
  const art =
    prize.partId === undefined || slot === 'title'
      ? createIcon(slot === 'title' ? 'crown' : 'star')
      : (createItemArt(prize.partId, size, 'avatar-thumb') ?? createPartThumb(prize.partId, base, size));
  const icon = h('span', { class: 'prize-icon', dataset: { rarity: prize.rarity ?? 'R', slot: slot ?? 'none', owned: owned ? 'true' : 'false' }, attrs: { 'aria-hidden': 'true' } }, [
    art,
    owned ? h('span', { class: 'prize-icon__owned' }, [createIcon('check')]) : undefined,
  ]);
  setStyle(icon, '--prize-size', `${size}px`);
  return log.exit(icon);
}

/**
 * 報酬の絵を横に並べる。
 * @param prizes 報酬
 * @param base いまの装い
 * @param size 一辺（CSS px）
 * @param showOwned 手に入れていればチェックを付けるか
 * @returns 要素（飾り。読み上げない）
 */
export function createPrizeStrip(prizes: readonly RewardPrizeDto[], base: readonly string[], size: number, showOwned = false): HTMLElement {
  const log = logger.fn('createPrizeStrip', { prizes: prizes.length, size });
  return log.exit(h('span', { class: 'prize-strip', attrs: { 'aria-hidden': 'true' } }, prizes.map((p) => createPrizeIcon(p, base, size, showOwned))));
}

/** 段の帯の状態（mine: いまの段／next: 次にねらえる段） */
export type BandState = 'mine' | 'next' | undefined;

/**
 * 順位表にはさむ段の帯（「4〜5位」＋報酬の絵と名前。次にねらえる段には「あと○回」）を作る。
 * @param tier 段
 * @param base いまの装い
 * @param state 帯の状態
 * @param gapLabel 次にねらえる段のとき、届くまでの数（'あと2回'）
 * @returns 要素（li）
 */
export function createTierBand(tier: RewardTierDto, base: readonly string[], state: BandState, gapLabel: string | undefined): HTMLElement {
  const log = logger.fn('createTierBand', { label: tier.label, state });
  const names = tier.prizes.map((p) => p.name).join('・');
  return log.exit(
    h('li', { class: 'rk-band', dataset: { state: state ?? 'none' }, attrs: { 'data-testid': 'reward-band', 'aria-label': `${tier.label}の報酬 ${names}${state === 'next' && gapLabel !== undefined ? `（${gapLabel}）` : ''}` } }, [
      h('span', { class: 'rk-band__rank', attrs: { 'aria-hidden': 'true' }, text: tier.label }),
      createPrizeStrip(tier.prizes, base, PRIZE_SIZE.band),
      h('span', { class: 'rk-band__name', attrs: { 'aria-hidden': 'true' }, text: tier.prizes[0]?.name ?? '' }),
      state === 'next' && gapLabel !== undefined ? h('span', { class: 'rk-band__gap', attrs: { 'aria-hidden': 'true' }, text: gapLabel }) : undefined,
      state === 'mine' ? h('span', { class: 'rk-band__here', attrs: { 'aria-hidden': 'true' }, text: 'いまココ' }) : undefined,
    ]),
  );
}

/** 報酬獲得の演出の操作 */
export interface PrizeGetHandlers {
  /** 「着る」を押したとき */
  readonly onWear: () => void;
  /** とじたとき（背景・「とじる」・Esc） */
  readonly onClose: () => void;
}

/**
 * 報酬を手に入れたときの全画面の演出を作る（光の筋・閃光・花火・紙吹雪・報酬が弾んで出る）。
 * @param prizes 手に入れた報酬（1つ以上）
 * @param base いまの装い
 * @param handlers 操作
 * @returns 要素（画面のルートに重ねる）
 */
export function createPrizeGet(prizes: readonly RewardPrizeDto[], base: readonly string[], handlers: PrizeGetHandlers): HTMLElement {
  const log = logger.fn('createPrizeGet', { prizes: prizes.length });
  const shown = prizes.slice(0, MAX_GET_ITEMS);
  const rest = prizes.length - shown.length;
  const wear = h('button', { class: 'prize-get__wear', attrs: { type: 'button', 'data-testid': 'prize-get-wear' }, on: { click: userAction('prize-get-wear', handlers.onWear) } }, ['着る']);
  const overlay = h('div', { class: 'prize-get', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': `報酬を獲得：${prizes.map((p) => p.name).join('・')}`, 'data-testid': 'prize-get' } }, [
    h('span', { class: 'prize-get__rays', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'prize-get__flash', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'prize-get__bursts', attrs: { 'aria-hidden': 'true' } }, GET_BURSTS.map(([x, y], i) => h('span', { class: 'prize-get__burst', style: { left: `${x}%`, top: `${y}%`, '--burst-i': String(i) } }))),
    h('span', { class: 'prize-get__sparks', attrs: { 'aria-hidden': 'true' } }, GET_SPARKS.map(([x, y, size], i) => h('span', { class: 'stage__spark', style: { left: `${x}%`, top: `${y}%`, width: `${size}rem`, height: `${size}rem`, '--spark-i': String(i) } }))),
    createConfetti(),
    h('div', { class: 'prize-get__body' }, [
      h('p', { class: 'prize-get__title', attrs: { 'aria-hidden': 'true' } }, ['報酬', h('strong', { text: 'GET' })]),
      h('ul', { class: 'prize-get__items' }, shown.map((p, i) =>
        h('li', { class: 'prize-get__item', dataset: { rarity: p.rarity ?? 'R' }, style: { '--item-i': String(i) } }, [
          h('span', { class: 'prize-get__ring', attrs: { 'aria-hidden': 'true' } }),
          createPrizeIcon(p, base, PRIZE_SIZE.get),
          h('span', { class: 'prize-get__name', text: p.name }),
        ]),
      )),
      rest > 0 ? h('p', { class: 'prize-get__rest', text: `ほか${rest}点` }) : undefined,
      h('div', { class: 'prize-get__actions' }, [
        wear,
        h('button', { class: 'prize-get__close', attrs: { type: 'button', 'data-testid': 'prize-get-close' }, on: { click: userAction('prize-get-close', handlers.onClose) } }, ['とじる']),
      ]),
    ]),
  ]);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) handlers.onClose();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') handlers.onClose();
  });
  queueMicrotask(() => wear.focus());
  return log.exit(overlay);
}
