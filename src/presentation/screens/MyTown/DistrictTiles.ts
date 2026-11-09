/**
 * @file 地区のようす（5地区のミニチュアのタイル）（presentation/screens/MyTown 層。DOM 部品）
 * 文字ではなく絵で地区の状態を伝える:
 * - ミニチュアの街（線画。色あせ・未訪問はそのまま絵に出る）
 * - 成長は ★（Lv0〜3）、色あせ間近・色あせ中は時計のアイコン＋日数、主は王冠、通った回数は足あと
 * タイルを押すと上のヒーローがその地区へ動く。ピンのボタンで地図へ。網羅率は出さない（CLAUDE.md 6.5）。
 */
import type { DistrictCardDto } from '@/application/dto/Dto';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { h, setStyle } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { createSprite } from '@/presentation/screens/MyTown/pixelSprites';
import { drawDistrictMiniature } from '@/presentation/screens/MyTown/townStripArt';
import type { StripDistrictVm } from '@/presentation/screens/MyTown/townStripArt';

const logger = createLogger('presentation/screens/MyTown/DistrictTiles');

/** ミニチュアの大きさ（CSS px） */
const ART_WIDTH_PX = 160;
const ART_HEIGHT_PX = 104;

/** createDistrictTiles の入力 */
export interface DistrictTilesInput {
  readonly cards: readonly DistrictCardDto[];
  /** 地区ID → 描画モデル */
  readonly districts: ReadonlyMap<string, StripDistrictVm>;
  readonly selectedIndex: number;
  /** タイルを押したとき（ヒーローをその地区へ） */
  readonly onSelect: (index: number) => void;
  /** ピンを押したとき（地図へ） */
  readonly onOpenMap: (districtId: string) => void;
}

/** 地区のようすの操作口 */
export interface DistrictTilesHandle {
  readonly element: HTMLElement;
  /** 選んでいるタイルを変える */
  select(index: number): void;
}

/**
 * ミニチュアの canvas を作る。
 * @param district 描画モデル
 * @returns canvas
 */
function createArt(district: StripDistrictVm): HTMLCanvasElement {
  const log = logger.fn('createArt', { name: district.name });
  const dpr = normalizeDpr(window.devicePixelRatio);
  const canvas = h('canvas', { class: 'mytown-tile__art', attrs: { width: ART_WIDTH_PX * dpr, height: ART_HEIGHT_PX * dpr, 'aria-hidden': 'true' } });
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.fail(canvas, '2D コンテキストを取得できません');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawDistrictMiniature(ctx, district, { width: ART_WIDTH_PX, height: ART_HEIGHT_PX }, true);
  return log.exit(canvas);
}

/**
 * 成長の★（3つ。Lv の数だけ金色）を作る。
 * @param level 成長段階 0..3
 * @returns 要素
 */
function createStars(level: number): HTMLElement {
  const log = logger.fn('createStars', { level });
  return log.exit(h('span', { class: 'mytown-tile__stars', attrs: { 'aria-label': `成長 Lv${level}` } }, [0, 1, 2].map((i) => createSprite('star', 2, i < level ? 'normal' : 'silhouette'))));
}

/**
 * 右上の状態バッジ（王冠／時計＋日数／？）を作る。何も無ければ undefined。
 * @param card 地区カード
 * @returns 要素
 */
function createBadge(card: DistrictCardDto): HTMLElement | undefined {
  const log = logger.fn('createBadge', { id: card.id, kind: card.fade.kind });
  if (card.fade.kind === 'never') return log.exit(h('span', { class: ['mytown-tile__badge', 'mytown-tile__badge--fog'], text: '?', attrs: { 'aria-label': 'まだ訪れていない' } }));
  if (card.fade.kind === 'soon') {
    return log.exit(h('span', { class: ['mytown-tile__badge', 'mytown-tile__badge--warn'], attrs: { 'aria-label': `あと${card.fade.daysUntilFade ?? 0}日で色あせ` } }, [createSprite('clock', 2), `${card.fade.daysUntilFade ?? 0}日`]));
  }
  if (card.fade.kind === 'fading') return log.exit(h('span', { class: ['mytown-tile__badge', 'mytown-tile__badge--gray'], attrs: { 'aria-label': '色あせ中' } }, [h('span', { class: 'mytown-icon', attrs: { 'aria-hidden': 'true' }, dataset: { icon: 'fade', tint: 'gray' } }, [createIcon('fade')]), '待ってる']));
  if (card.isLordMe) return log.exit(h('span', { class: ['mytown-tile__badge', 'mytown-tile__badge--lord'], attrs: { 'aria-label': 'あなたが主' } }, [createSprite('crown', 2), '主']));
  return log.exit(undefined);
}

/**
 * タイル1枚を作る。
 * @param card 地区カード
 * @param district 描画モデル
 * @param input 選択・地図への移動
 * @returns 要素
 */
function createTile(card: DistrictCardDto, district: StripDistrictVm, input: { readonly onSelect: () => void; readonly onOpenMap: () => void }): HTMLElement {
  const log = logger.fn('createTile', { id: card.id });
  const pick = h('button', { class: 'mytown-tile__pick', attrs: { type: 'button', 'aria-label': `${card.name}を上の街で見る`, 'data-testid': `mytown-tile-${card.id}` } }, [
    h('span', { class: 'mytown-tile__frame' }, [createArt(district), createStars(card.level), createBadge(card)]),
  ]);
  pick.addEventListener('click', () => { setCorrelationId(); input.onSelect(); });
  const pin = h('button', { class: 'mytown-tile__pin', attrs: { type: 'button', 'aria-label': `${card.name}を地図で見る` } }, [createSprite('pin', 3)]);
  pin.addEventListener('click', () => { setCorrelationId(); input.onOpenMap(); });
  const dot = h('i', { class: 'mytown-tile__dot', attrs: { 'aria-hidden': 'true' } });
  setStyle(dot, 'background', card.fade.kind === 'never' ? '#d1d5db' : card.color);
  return log.exit(h('article', { class: 'mytown-tile' }, [
    pick,
    h('div', { class: 'mytown-tile__foot' }, [
      dot,
      h('b', { class: 'mytown-tile__name', text: card.shortName }),
      h('span', { class: 'mytown-tile__visits', attrs: { 'aria-label': `通った回数 ${card.visitCount}回` } }, [createSprite('foot', 2), String(card.visitCount)]),
      pin,
    ]),
  ]));
}

/**
 * 地区のようす（タイルの並び）を作る。
 * @param input 地区・描画モデル・選択・地図への移動
 * @returns 操作口
 */
export function createDistrictTiles(input: DistrictTilesInput): DistrictTilesHandle {
  const log = logger.fn('createDistrictTiles', { count: input.cards.length, selected: input.selectedIndex });
  const tiles = input.cards.map((card, i) => {
    const district = input.districts.get(card.id);
    if (district === undefined) return undefined;
    return createTile(card, district, { onSelect: (): void => input.onSelect(i), onOpenMap: (): void => input.onOpenMap(card.id) });
  });
  /**
   * 選んでいるタイルを変える。
   * @param index 地区のインデックス
   */
  const select = (index: number): void => {
    const selectLog = logger.fn('select', { index });
    tiles.forEach((tile, i) => tile?.classList.toggle('mytown-tile--on', i === index));
    selectLog.exit(undefined);
  };
  select(input.selectedIndex);
  const element = h('section', { class: 'mytown-tiles', attrs: { 'aria-labelledby': 'mytown-tiles-title' } }, [
    h('h2', { class: 'mytown-sub', attrs: { id: 'mytown-tiles-title' } }, ['地区のようす']),
    h('div', { class: 'mytown-tiles__grid' }, tiles),
  ]);
  return log.exit({ element, select });
}
