/**
 * @file ランク画面の「NEXT」（presentation/screens/Rank 層。DOM 部品）
 * 2026-11-10 ユーザー指示「あと何ポイントでランクアップや特典まで何ポイントかを可視化してほしい」。
 * 1. つぎの目標: ランクアップ（次の段の紋章）と次の特典（もらえる部品の絵）を、ゲージと大きな「あと○EXP」で見せる
 * 2. 特典ロード: すべての特典を EXP の小さい順に横へ並べ、つなぐ線をいまの EXP まで塗る（獲得済み＝チェック、次＝光る輪、まだ＝鍵）。
 *    ランクアップと同時の特典には段の紋章を添える。開いたとき次の特典が真ん中に来るよう横に送る
 * 特典はアバターの部品なので、文字ではなく「その部品を着けた自分のアバター」の小さな絵で見せる（称号は札の印）。
 * 言葉は短いラベルだけ。「あと○」の数は data-count を持ち、カードが画面に入ると数え上がる（RankScreen の observeReveal）。
 */
import type { RankPerkDto, RankPerkPartDto, RankStatusDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { createAvatarIcon } from '@/presentation/screens/Avatar/avatarIcons';
import { equipPart, slotOfPartId } from '@/presentation/screens/Avatar/avatarScreenModel';
import { createPartThumb, createSquareCanvas } from '@/presentation/screens/Avatar/partThumb';
import { createRankEmblem } from '@/presentation/screens/Rank/rankEmblem';
import { nextGoalsOf, perkLinkFillsOf } from '@/presentation/screens/Rank/rankModel';
import type { GoalGauge } from '@/presentation/screens/Rank/rankModel';
import { avatarLookOfParts } from '@/presentation/shared/avatar/avatarLook';
import { AVATAR_FOCUS, drawAvatar } from '@/presentation/shared/avatar/avatarPaint';

const logger = createLogger('presentation/screens/Rank/rankNext');

/** 部品の絵の大きさ（CSS px） */
const ART_SIZE = { goal: 44, road: 46 } as const;

/** 色の部品は、着ける場所（髪＝頭・服＝胴）で切り出して描く */
const COLOR_FOCUS: Readonly<Record<string, keyof typeof AVATAR_FOCUS>> = { hairColor: 'head', topColor: 'body' };

/** 特典の状態の読み上げ */
const STATE_LABEL: Readonly<Record<RankPerkDto['state'], string>> = { earned: '獲得済み', next: '次の特典', locked: 'まだ' };

/**
 * 色の部品を着けたアバターを、着ける場所で切り出して描く（全身だと色が小さくて分からないため）。
 * @param partId 部品ID
 * @param base いまの装い
 * @param size 一辺（CSS px）
 * @param focus 切り出すところ
 * @returns canvas
 */
function createFocusThumb(partId: string, base: readonly string[], size: number, focus: keyof typeof AVATAR_FOCUS): HTMLCanvasElement {
  const log = logger.fn('createFocusThumb', { partId, size, focus });
  const { canvas, ctx } = createSquareCanvas(size, 'avatar-thumb');
  if (ctx === undefined) return log.fail(canvas, '描けない');
  const outfit = equipPart(base.filter((id) => slotOfPartId(id) !== 'pet' && slotOfPartId(id) !== 'held'), partId).outfit;
  const region = AVATAR_FOCUS[focus];
  const s = (size * 0.94) / Math.max(region.w, region.h);
  drawAvatar(ctx, avatarLookOfParts(outfit), { x: size / 2 - (region.x + region.w / 2) * s, y: size / 2 - (region.y + region.h / 2) * s, scale: s });
  return log.exit(canvas);
}

/**
 * 特典の部品の絵（レア度の枠つき）を作る。称号は絵が無いので札の印にする。
 * @param part 部品
 * @param base いまの装い（身につける部品は、これに着せて描く）
 * @param size 一辺（CSS px）
 * @returns 要素（飾り。読み上げない）
 */
function perkArt(part: RankPerkPartDto | undefined, base: readonly string[], size: number): HTMLElement {
  const log = logger.fn('perkArt', { partId: part?.id, size });
  const slot = part === undefined ? '' : slotOfPartId(part.id);
  const focus = COLOR_FOCUS[slot];
  const art =
    part === undefined
      ? createIcon('star')
      : slot === 'title'
        ? createAvatarIcon('title', Math.round(size * 0.72))
        : focus !== undefined
          ? createFocusThumb(part.id, base, size, focus)
          : createPartThumb(part.id, base, size);
  return log.exit(h('span', { class: 'rank-art', dataset: { rarity: part?.rarity ?? 'R', slot }, style: { '--art': `${size}px` }, attrs: { 'aria-hidden': 'true' } }, [art]));
}

/** goalRow の入力 */
interface GoalRowInput {
  readonly kind: 'rank' | 'perk';
  readonly icon: Element;
  readonly label: string;
  /** ラベルに添える名前（次の段・部品） */
  readonly name: string;
  readonly gauge: GoalGauge;
  /** いまの累計 EXP */
  readonly points: number;
  /** 最上段（ゲージは満タン、数の代わりに MAX） */
  readonly isMax: boolean;
  readonly ariaLabel: string;
}

/**
 * つぎの目標の1行（印・ラベル・ゲージ・「あと○EXP」）を作る。
 * @param input 行の中身
 * @returns 要素
 */
function goalRow(input: GoalRowInput): HTMLElement {
  const log = logger.fn('goalRow', { kind: input.kind, remaining: input.gauge.remaining, percent: input.gauge.percent });
  const left = input.isMax
    ? [h('strong', { text: 'MAX' })]
    : [h('small', { text: 'あと' }), h('strong', { dataset: { count: input.gauge.remaining }, text: String(input.gauge.remaining) }), h('small', { text: 'EXP' })];
  return log.exit(
    h('div', { class: 'rank-goal', dataset: { kind: input.kind, max: input.isMax ? 'true' : undefined }, style: { '--p': `${input.gauge.percent}%` }, attrs: { role: 'img', 'aria-label': input.ariaLabel, 'data-testid': `rank-goal-${input.kind}` } }, [
      h('span', { class: 'rank-goal__icon', attrs: { 'aria-hidden': 'true' } }, [input.icon]),
      h('span', { class: 'rank-goal__main', attrs: { 'aria-hidden': 'true' } }, [
        h('span', { class: 'rank-goal__label' }, [h('strong', { text: input.label }), h('span', { class: 'rank-goal__name', text: input.name })]),
        h('span', { class: 'rank-goal__bar' }, [h('span', { class: 'rank-goal__fill' })]),
        h('span', { class: 'rank-goal__nums', text: input.isMax ? `${input.points}` : `${input.points} / ${input.gauge.to}` }),
      ]),
      h('span', { class: 'rank-goal__left', attrs: { 'aria-hidden': 'true', 'data-testid': `rank-goal-${input.kind}-left` } }, left),
    ]),
  );
}

/**
 * つぎの目標（ランクアップ・次の特典）の2行を作る。特典が全部手に入っていれば特典の行は出さない。
 * @param dto ランク
 * @param base いまの装い
 * @returns 要素
 */
function createGoals(dto: RankStatusDto, base: readonly string[]): HTMLElement {
  const log = logger.fn('createGoals', { points: dto.points });
  const goals = nextGoalsOf(dto);
  const { rank, perk } = goals;
  const rankRow = goalRow({
    kind: 'rank',
    icon: createRankEmblem(rank.index, { className: 'rank-goal__emblem' }),
    label: rank.isTop ? '最高ランク' : 'ランクアップ',
    name: rank.name,
    gauge: rank,
    points: dto.points,
    isMax: rank.isTop,
    ariaLabel: rank.isTop ? `最高ランク ${rank.name}` : `ランクアップ：${rank.name}まであと${rank.remaining}EXP`,
  });
  const names = perk?.perk.parts.map((p) => p.name).join('・') ?? '';
  const perkRow =
    perk === undefined
      ? undefined
      : goalRow({
          kind: 'perk',
          icon: h('span', { class: 'rank-goal__art' }, [
            perkArt(perk.perk.parts[0], base, ART_SIZE.goal),
            perk.perk.rankIndex === undefined ? undefined : createRankEmblem(perk.perk.rankIndex, { className: 'rank-goal__badge' }),
          ]),
          label: '特典',
          name: names,
          gauge: perk,
          points: dto.points,
          isMax: false,
          ariaLabel: `次の特典：${names}まであと${perk.remaining}EXP`,
        });
  return log.exit(h('div', { class: 'rank-goals' }, [rankRow, perkRow]));
}

/**
 * 特典ロードの1マス（部品の絵・状態の印・段の紋章・EXP）を作る。
 * @param perk 特典
 * @param link 右へ伸びる線の塗り（0..100）
 * @param base いまの装い
 * @param index 並びの番号（現れる順）
 * @returns 要素
 */
function perkTile(perk: RankPerkDto, link: number, base: readonly string[], index: number): HTMLElement { // audit-ignore: fnlog-missing 特典ごとに呼ぶ DOM 組立て（呼び出し側 createPerkRoad でログ）
  const names = perk.parts.map((p) => p.name).join('・');
  const mark = perk.state === 'earned' ? createIcon('check') : perk.state === 'locked' ? createIcon('lock') : undefined;
  return h('li', { class: 'rank-perk', dataset: { state: perk.state, rankup: perk.rankIndex === undefined ? undefined : 'true' }, style: { '--i': String(index), '--link': `${link}%` }, attrs: { 'aria-label': `${perk.at}EXP ${names}（${STATE_LABEL[perk.state]}）` } }, [
    h('span', { class: 'rank-perk__link', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'rank-perk__frame', attrs: { 'aria-hidden': 'true' } }, [
      perkArt(perk.parts[0], base, ART_SIZE.road),
      mark === undefined ? undefined : h('span', { class: 'rank-perk__mark' }, [mark]),
      perk.rankIndex === undefined ? undefined : createRankEmblem(perk.rankIndex, { className: 'rank-perk__rank', locked: perk.state === 'locked' }),
    ]),
    h('span', { class: 'rank-perk__at', attrs: { 'aria-hidden': 'true' }, text: String(perk.at) }),
  ]);
}

/**
 * 特典ロード（すべての特典を横に並べ、いまの EXP まで線を塗る）を作る。
 * @param dto ランク
 * @param base いまの装い
 * @returns 要素（特典が無ければ undefined）
 */
function createPerkRoad(dto: RankStatusDto, base: readonly string[]): HTMLElement | undefined {
  const perks = dto.perks ?? [];
  const log = logger.fn('createPerkRoad', { perks: perks.length });
  if (perks.length === 0) return log.exit(undefined, '特典なし');
  const fills = perkLinkFillsOf(perks, dto.points);
  const tiles = perks.map((perk, i) => perkTile(perk, fills[i] ?? 0, base, i));
  return log.exit(h('div', { class: 'rank-perks', attrs: { 'data-testid': 'rank-perks' } }, [h('ol', { class: 'rank-perks__list', attrs: { 'aria-label': '特典' } }, tiles)]));
}

/**
 * 「NEXT」のカードの中身（つぎの目標＋特典ロード）を作る。
 * @param dto ランク
 * @param base いまの装い（特典の絵に使う。読めなければ空＝既定の装い）
 * @returns 要素（並び順）
 */
export function createNextBody(dto: RankStatusDto, base: readonly string[]): HTMLElement[] {
  const log = logger.fn('createNextBody', { points: dto.points, perks: dto.perks?.length });
  const road = createPerkRoad(dto, base);
  return log.exit(road === undefined ? [createGoals(dto, base)] : [createGoals(dto, base), road]);
}

/**
 * 特典ロードを横に送り、次の特典（無ければ最後の特典）を真ん中に置く。DOM に入れた後に呼ぶ。
 * @param root 「NEXT」のカード
 * @sideEffect 特典ロードの scrollLeft を変える
 */
export function centerNextPerk(root: HTMLElement): void {
  const log = logger.fn('centerNextPerk');
  const road = root.querySelector<HTMLElement>('.rank-perks');
  const target = road?.querySelector<HTMLElement>('.rank-perk[data-state="next"]') ?? road?.querySelector<HTMLElement>('.rank-perk:last-child');
  if (road === null || road === undefined || target === null || target === undefined) return log.exit(undefined, '特典ロードなし');
  road.scrollLeft = Math.max(0, target.offsetLeft - (road.clientWidth - target.offsetWidth) / 2);
  log.exit(undefined, `scrollLeft=${road.scrollLeft}`);
}
