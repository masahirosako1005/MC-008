/**
 * @file 図鑑のカード格子（presentation/screens/Zukan 層）
 * 「名所」「店舗」の見出しごとに、収集カード風のタイルを3列で並べる（wireframes/05_zukan の③〜⑤）。
 * - 訪問済み：カラーの街なみ絵、なじみ度の星と帯（なじみ／常連）、通った回数、訪れた季節の印、次のなじみ度まで
 * - 発見済み：同じ絵のシルエット（行けば色づく）と「まだ行っていない」
 * - 未発見：霧の「？」カード（名前・絵・位置は出さない＝B）
 * 状態は「絵の色・枠線（実線／破線／二重）・記号・文言」の重ねがけで示す（色覚配慮）。タイルはすべて 44px 以上のボタン。
 */
import '@/presentation/screens/Zukan/ZukanRarity.css';
import type { ZukanTileDto } from '@/application/dto/Dto';
import { categoryIconOf, rarityViewOf } from '@/presentation/screens/Zukan/cardFace';
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';
import { userAction } from '@/Common/ui/userAction';
import { mountCardArt } from '@/presentation/screens/Zukan/ZukanCardArt';
import type { ZukanArtModel } from '@/presentation/screens/Zukan/ZukanCardArt';
import { UNKNOWN_SPOT_NAME } from '@/Common/ui/cards/SpotCard';
import { familiarityStars, groupTiles, seasonMarks, tileAriaLabel, tileCaption, tileName, UNKNOWN_TILE_HINT } from '@/presentation/screens/Zukan/zukanModel';

const logger = createLogger('presentation/screens/Zukan/SpotGrid');

/** createSpotGrid のオプション */
export interface SpotGridOptions {
  readonly tiles: readonly ZukanTileDto[];
  /** 発見済み・訪問済みのタイルが押されたとき（相関ID 発行済み） */
  readonly onOpenSpot: (spotId: string) => void;
  /** 未発見のタイルが押されたとき（相関ID 発行済み） */
  readonly onUnknown: () => void;
  /** 指定すると、どのタイルでもまず拡大プレビュー（レア度・取得方法）を開く（相関ID 発行済み） */
  readonly onPreview?: (tile: ZukanTileDto) => void;
}

/** カード格子の操作 */
export interface SpotGridHandle {
  readonly element: HTMLElement;
  /** DOM に入った後に絵を描く。戻り値で後始末する */
  mountArts(): () => void;
}

/** 絵を描く予定（DOM に入ってから描く） */
interface PendingArt {
  readonly host: HTMLElement;
  readonly model: ZukanArtModel;
}

/**
 * タイルから絵の元を作る（未発見・カテゴリ無しは描かない）。
 * @param tile タイル
 * @returns 絵の元。描かないときは undefined
 */
function artModelOf(tile: ZukanTileDto): ZukanArtModel | undefined {
  const log = logger.fn('artModelOf', { spotId: tile.id, status: tile.status });
  if (tile.status === 'unknown' || tile.id === undefined || tile.category === undefined) return log.exit(undefined);
  return log.exit({ seed: tile.id, kind: tile.kind, category: tile.category, status: tile.status, name: tileName(tile) });
}

/**
 * 絵の枠（絵・レア度の略号・今日）を作る。回数となじみ度は絵に重ねず本文の行に出す（四隅のバッジを1つにする）。
 * @param tile タイル
 * @returns 絵の枠の要素
 */
function createArtFrame(tile: ZukanTileDto): HTMLElement {
  const log = logger.fn('createArtFrame', { status: tile.status, familiarity: tile.familiarity });
  const visited = tile.status === 'visited';
  const icon = categoryIconOf(tile);
  const view = rarityViewOf(tile);
  const frame = h('span', { class: 'zukan-card__art', attrs: { 'aria-hidden': 'true' } }, [
    tile.status === 'unknown' ? h('span', { class: 'zukan-card__mystery', text: '？' }) : undefined,
    icon === undefined ? undefined : h('span', { class: 'zukan-card__icon', text: icon }),
    h('span', { class: 'rarity-card__foil' }),
    h('span', { class: 'rarity-card__code', text: view.code }),
    visited && tile.visitedToday === true ? h('span', { class: 'zukan-card__today', text: '今日' }) : undefined,
  ]);
  return log.exit(frame);
}

/**
 * 訪問済みだけに出す、回数・なじみ度の文字ラベル（と、拡大プレビュー向けの星・季節の印）。
 * @param tile タイル
 * @returns 要素（訪問済み以外は undefined）
 */
function createVisitedMeta(tile: ZukanTileDto): HTMLElement | undefined {
  const log = logger.fn('createVisitedMeta', { status: tile.status });
  if (tile.status !== 'visited') return log.exit(undefined);
  const seasons = seasonMarks(tile).map((mark) => h('span', { class: 'zukan-card__season', dataset: { on: mark.visited ? '1' : '0' }, text: mark.label }));
  return log.exit(
    h('span', { class: 'zukan-card__meta', attrs: { 'aria-hidden': 'true' } }, [
      h('span', { class: 'zukan-card__visits' }, [
        h('span', { class: 'zukan-card__count', text: `${tile.visitCount}回` }),
        (tile.familiarity ?? 1) >= 2 ? h('span', { class: 'zukan-card__ribbon', text: tile.familiarityLabel ?? '' }) : undefined,
      ]),
      h('span', { class: 'zukan-card__stars', text: familiarityStars(tile) }),
      h('span', { class: 'zukan-card__seasons' }, seasons),
    ]),
  );
}

/**
 * カード1枚を作る。
 * @param tile タイル
 * @param index 表示順（出てくる動きの時間差に使う）
 * @param opts 押されたときの処理
 * @returns button 要素（data-status=状態、data-familiarity=なじみ度）
 */
function createCard(tile: ZukanTileDto, index: number, opts: SpotGridOptions): HTMLElement {
  const log = logger.fn('createCard', { spotId: tile.id, status: tile.status });
  const spotId = tile.id;
  const onPreview = opts.onPreview;
  const onClick =
    onPreview !== undefined
      ? userAction('zukan-tile-preview', (): void => onPreview(tile))
      : spotId === undefined
        ? userAction('zukan-tile-unknown', opts.onUnknown)
        : userAction('zukan-tile', (): void => opts.onOpenSpot(spotId));
  const view = rarityViewOf(tile);
  const card = h(
    'button',
    {
      class: ['zukan-card', 'rarity-card'],
      attrs: { type: 'button', 'aria-label': `${tileAriaLabel(tile)}。レア度 ${view.name}（星${view.rarity}）`, 'data-testid': 'zukan-tile', 'data-spot-id': spotId },
      dataset: {
        status: tile.status,
        kind: tile.kind,
        familiarity: tile.familiarity === undefined ? undefined : String(tile.familiarity),
        rarity: String(view.rarity),
        awakened: tile.awakened === true ? '1' : undefined,
      },
      on: { click: onClick },
    },
    [
      createArtFrame(tile),
      h('span', { class: 'rarity-card__strip', attrs: { 'aria-hidden': 'true' } }, [
        h('span', { class: 'rarity-card__stars', text: view.stars }),
        h('span', { class: 'rarity-card__rname', text: view.name }),
      ]),
      h('span', { class: 'zukan-card__name', attrs: { 'aria-hidden': 'true' }, text: tileName(tile) }),
      tile.status === 'unknown' || tile.category === undefined ? undefined : h('span', { class: 'zukan-card__category', attrs: { 'aria-hidden': 'true' }, text: tile.category }),
      createVisitedMeta(tile),
      tile.status === 'unknown' ? undefined : h('span', { class: 'zukan-card__caption', attrs: { 'aria-hidden': 'true' }, text: tileCaption(tile) }),
      tile.acquisitionShort === undefined || tile.status === 'visited'
        ? undefined
        : h('span', { class: 'zukan-card__how', attrs: { 'aria-hidden': 'true' }, text: `入手：${tile.acquisitionShort}` }),
      view.rarity === 4 ? h('span', { class: 'rarity-card__sparkles', attrs: { 'aria-hidden': 'true' } }, ['✦', '✧', '✦', '✧', '✦'].map((s) => h('span', { text: s }))) : undefined,
    ],
  );
  setStyle(card, '--i', String(index));
  return log.exit(card);
}

/**
 * カード格子を作る（名所→店舗の見出しごと。並びは DTO の順のまま）。
 * @param opts タイル一覧と押されたときの処理
 * @returns 格子の要素と、DOM に入った後に絵を描く関数
 */
export function createSpotGrid(opts: SpotGridOptions): SpotGridHandle {
  const log = logger.fn('createSpotGrid', { count: opts.tiles.length });
  const pending: PendingArt[] = [];
  let index = 0;
  const sections = groupTiles(opts.tiles).map((group) => {
    const cards = group.tiles.map((tile) => {
      const card = createCard(tile, index++, opts);
      const model = artModelOf(tile);
      const host = card.querySelector<HTMLElement>('.zukan-card__art');
      if (model !== undefined && host !== null) pending.push({ host, model });
      return card;
    });
    return h('section', { class: 'zukan-section' }, [h('h3', { class: 'zukan-section__title', text: group.title }), h('div', { class: 'zukan-grid' }, cards)]);
  });
  // 未発見カードの見つけ方は、カードごとに繰り返さず格子の上に1回だけ出す
  const unknownHint = opts.tiles.some((t) => t.status === 'unknown')
    ? h('p', { class: ['hint', 'zukan-unknown-hint'], attrs: { 'data-testid': 'zukan-unknown-hint' }, text: `${UNKNOWN_SPOT_NAME}のカードは、${UNKNOWN_TILE_HINT}` })
    : undefined;
  const element = h('div', { class: 'zukan-sections', attrs: { 'data-testid': 'zukan-grid' } }, [unknownHint, ...sections]);
  return log.exit({ element, mountArts: (): (() => void) => mountPendingArts(pending) });
}

/**
 * 予定しておいたカードの絵をまとめて描く（格子が DOM に入った後に呼ぶ）。
 * @param pending 絵を描く予定
 * @returns すべての絵を後始末する関数
 * @sideEffect 各カードに canvas を追加し、ResizeObserver を登録する
 */
function mountPendingArts(pending: readonly PendingArt[]): () => void {
  const log = logger.fn('mountPendingArts', { count: pending.length });
  const destroyers = pending.map((art) => mountCardArt(art.host, art.model));
  return log.exit((): void => destroyers.forEach((destroy) => destroy()));
}
