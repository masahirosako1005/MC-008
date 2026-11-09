/**
 * @file コレクション（カード・思い出）（presentation/screens/MyTown 層。DOM 部品）
 * カードの絵柄は、その地区のミニチュアの街並み（線画）。自分が育てた街がそのままカードになる。
 * まだ持っていないカードはシルエット＋「あと◯回」。全何枚中何枚といった網羅表示はしない（CLAUDE.md 6.5 と同じ方針）。
 * 思い出: カード・アイテムを手に入れた日を新しい順に並べる年表。
 */
import type { MyTownCardDto, MyTownDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { h, setStyle } from '@/Common/ui/dom';
import { memoriesOf } from '@/presentation/screens/MyTown/myTownModel';
import { createSprite } from '@/presentation/screens/MyTown/pixelSprites';
import { drawDistrictMiniature } from '@/presentation/screens/MyTown/townStripArt';
import type { StripDistrictVm } from '@/presentation/screens/MyTown/townStripArt';

const logger = createLogger('presentation/screens/MyTown/Collection');

/** カードの絵柄の大きさ（CSS px） */
const ART_WIDTH_PX = 102;
const ART_HEIGHT_PX = 84;

/** カードのランクの表示名 */
const RANK_LABEL: Readonly<Record<MyTownCardDto['rank'], string>> = { silver: '銀カード', gold: '金カード' };

/**
 * 地区のミニチュアを描いた canvas を作る。
 * @param district 地区の描画モデル
 * @returns canvas
 */
function createMiniature(district: StripDistrictVm): HTMLCanvasElement {
  const log = logger.fn('createMiniature', { name: district.name });
  const dpr = normalizeDpr(window.devicePixelRatio);
  const canvas = h('canvas', { class: 'mytown-card__art', attrs: { width: ART_WIDTH_PX * dpr, height: ART_HEIGHT_PX * dpr, 'aria-hidden': 'true' } });
  setStyle(canvas, 'width', `${ART_WIDTH_PX}px`);
  setStyle(canvas, 'height', `${ART_HEIGHT_PX}px`);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.fail(canvas, '2D コンテキストを取得できません');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawDistrictMiniature(ctx, district, { width: ART_WIDTH_PX, height: ART_HEIGHT_PX });
  return log.exit(canvas);
}

/**
 * 獲得済みカード1枚を作る。
 * @param card カード
 * @param district 地区の描画モデル（絵柄に使う）
 * @returns 要素
 */
function createCard(card: MyTownCardDto, district: StripDistrictVm | undefined): HTMLElement {
  const log = logger.fn('createCard', { districtId: card.districtId, rank: card.rank });
  return log.exit(h('article', { class: ['mytown-card', `mytown-card--${card.rank}`], attrs: { 'data-testid': `mytown-card-${card.districtId}-${card.rank}` } }, [
    h('span', { class: 'mytown-card__rank', text: RANK_LABEL[card.rank] }),
    district === undefined ? undefined : createMiniature(district),
    h('b', { class: 'mytown-card__name', text: card.districtName }),
    h('small', { class: 'mytown-card__date', text: card.earnedOn }),
  ]));
}

/**
 * まだ持っていないカード（シルエット＋あと何回）を作る。
 * @param next 次のカード
 * @returns 要素
 */
function createLockedCard(next: MyTownDto['nextCards'][number]): HTMLElement {
  const log = logger.fn('createLockedCard', { districtId: next.districtId, rank: next.rank });
  return log.exit(h('article', { class: ['mytown-card', 'mytown-card--locked'] }, [
    h('span', { class: 'mytown-card__rank', text: RANK_LABEL[next.rank] }),
    h('span', { class: 'mytown-card__silhouette', attrs: { 'aria-hidden': 'true' }, text: '?' }),
    h('b', { class: 'mytown-card__name', text: next.districtName }),
    h('small', { class: 'mytown-card__date', text: `あと${next.remainingVisits}回` }),
  ]));
}

/**
 * 思い出の年表を作る。
 * @param dto マイ街
 * @returns 要素
 */
function createMemories(dto: MyTownDto): HTMLElement {
  const log = logger.fn('createMemories');
  const memories = memoriesOf(dto);
  if (memories.length === 0) return log.exit(h('p', { class: 'mytown-hint', text: 'カードやアイテムを手に入れると、ここに思い出が残ります。' }));
  return log.exit(h('ol', { class: 'mytown-memories' }, memories.map((m) =>
    h('li', { class: ['mytown-memory', `mytown-memory--${m.kind}`] }, [createSprite(m.icon, 3, m.kind === 'silver' ? 'gray' : 'normal'), h('span', { class: 'mytown-memory__body' }, [h('span', { class: 'mytown-memory__date', text: m.date }), h('span', { class: 'mytown-memory__text', text: m.text })])]),
  )));
}

/**
 * コレクションを作る。
 * @param dto マイ街
 * @param districts 地区ID → 描画モデル（カードの絵柄）
 * @returns 要素
 */
export function createCollection(dto: MyTownDto, districts: ReadonlyMap<string, StripDistrictVm>): HTMLElement {
  const log = logger.fn('createCollection', { cards: dto.cards.length, next: dto.nextCards.length });
  const shelf = [...dto.cards.map((c) => createCard(c, districts.get(c.districtId))), ...dto.nextCards.map(createLockedCard)];
  return log.exit(h('section', { class: 'mytown-collection', attrs: { 'data-testid': 'mytown-cards' } }, [
    h('h2', { class: 'mytown-sub' }, ['カード', h('small', { text: '同じ地区に通うと 銀 → 金' })]),
    h('div', { class: 'mytown-cards' }, shelf),
    h('h2', { class: 'mytown-sub', text: '思い出' }),
    createMemories(dto),
  ]));
}
