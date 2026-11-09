/**
 * @file ランク画面のステータスパネル（presentation/screens/Rank 層。DOM 部品）
 * 画面幅いっぱいの暗い盤に、段の紋章の舞台・段の名前・★・累計ポイント・ランクロードを組む。
 * 登場の演出（CSS）: 光が中心へ集まる → 紋章が落ちる → 衝撃波・横一文字の光・閃光・揺れ・火花 → 名前の押印 → 数え上げ → 歩き。
 * 演出が終わった後も、紋章はゆらゆら3Dに揺れ（ポインタで傾く）、つや・ホログラム・きらめきが走る。飾りはすべて読み上げない。
 */
import type { RankStatusDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { createRankEmblem, tierOf } from '@/presentation/screens/Rank/rankEmblem';
import { isNearRankUp, rankProgressOf } from '@/presentation/screens/Rank/rankModel';
import type { RankProgress } from '@/presentation/screens/Rank/rankModel';

const logger = createLogger('presentation/screens/Rank/rankHero');

/** これより長い段の名前は小さめの文字にする（「はじめての旅人」など） */
const LONG_NAME_CHARS = 4;

/** 背景を昇る光の粒の数 */
const MOTE_COUNT = 18;

/** 紋章が落ちた瞬間に飛び散る火花の数 */
const SPARK_COUNT = 14;

/** 落ちる前に中心へ集まる光の数 */
const CHARGE_COUNT = 16;

/** 紋章のきらめきの位置（傾く箱の中の %） */
const GLINTS: readonly (readonly [string, string])[] = [['74%', '18%'], ['26%', '66%'], ['62%', '86%']];

/** ステータスパネルの部品（数え上げ・傾きのために外へ渡す） */
export interface HeroParts {
  readonly element: HTMLElement;
  /** 累計ポイントの数字 */
  readonly points: HTMLElement;
  /** ポインタで傾ける箱 */
  readonly tilt: HTMLElement;
}

/**
 * 番号付きの飾りの粒をまとめて作る（--i と、角度 --a を持たせる）。
 * @param className 粒のクラス
 * @param count 数
 * @param wrapClass 入れ物のクラス
 * @returns 入れ物
 */
function particles(className: string, count: number, wrapClass: string): HTMLElement { // audit-ignore: fnlog-missing 盤を作るとき数回呼ぶ DOM 組立て（呼び出し側 createStage でログ）
  const items = Array.from({ length: count }, (_, i) => h('span', { class: className, style: { '--i': String(i), '--a': `${(360 / count) * i}deg` } }));
  return h('span', { class: wrapClass, attrs: { 'aria-hidden': 'true' } }, items);
}

/**
 * 背景を昇っていく光の粒を作る。位置・大きさ・遅れは番号から決める（毎回同じ並び）。
 * @returns 要素
 */
function createMotes(): HTMLElement {
  const log = logger.fn('createMotes');
  const motes = Array.from({ length: MOTE_COUNT }, (_, i) =>
    h('span', { class: 'rank-mote', style: { '--x': `${(i * 53 + 7) % 100}%`, '--d': `${((i * 0.37) % 4).toFixed(2)}s`, '--s': `${3 + (i % 3) * 2}px`, '--dur': `${(4.2 + (i % 4) * 0.6).toFixed(1)}s` } }),
  );
  return log.exit(h('span', { class: 'rank-motes', attrs: { 'aria-hidden': 'true' } }, motes));
}

/**
 * 傾く箱（紋章・ホログラム・つや・きらめき）を作る。
 * @param index 段の添字
 * @returns 要素
 */
function createTiltBox(index: number): HTMLElement {
  const log = logger.fn('createTiltBox', { index });
  const glints = GLINTS.map(([x, y], i) => h('span', { class: 'rank-glint', style: { left: x, top: y, '--i': String(i) } }));
  return log.exit(
    h('div', { class: 'rank-stage__tilt' }, [
      createRankEmblem(index, { className: 'rank-stage__svg' }),
      h('span', { class: 'rank-stage__holo' }),
      h('span', { class: 'rank-stage__sheen' }),
      ...glints,
    ]),
  );
}

/**
 * 紋章の舞台（光の筋・後光・輪・集まる光・衝撃波・横一文字の光・紋章・火花）を作る。
 * @param index 段の添字
 * @param tilt 傾く箱
 * @returns 要素
 */
function createStage(index: number, tilt: HTMLElement): HTMLElement {
  const log = logger.fn('createStage', { index });
  return log.exit(
    h('div', { class: 'rank-stage', attrs: { 'aria-hidden': 'true' } }, [
      h('span', { class: 'rank-stage__rays' }),
      h('span', { class: 'rank-stage__aura' }),
      h('span', { class: 'rank-stage__orbit' }),
      particles('rank-charge', CHARGE_COUNT, 'rank-charges'),
      h('span', { class: 'rank-wave rank-wave--in' }),
      h('span', { class: 'rank-wave' }),
      h('span', { class: 'rank-wave rank-wave--late' }),
      h('span', { class: 'rank-stage__streak' }),
      h('div', { class: 'rank-stage__emblem' }, [h('div', { class: 'rank-stage__float' }, [tilt])]),
      particles('rank-spark', SPARK_COUNT, 'rank-sparks'),
    ]),
  );
}

/**
 * 段数の★（いまの段まで塗る）を作る。
 * @param dto ランク
 * @returns 要素
 */
function createPips(dto: RankStatusDto): HTMLElement {
  const log = logger.fn('createPips', { index: dto.rank.index });
  const pips = dto.steps.map((_, i) => h('span', { class: ['rank-pip', i <= dto.rank.index ? 'rank-pip--on' : undefined], style: { '--i': String(i) } }, [createIcon('star')]));
  return log.exit(h('p', { class: 'rank-pips', attrs: { 'aria-label': `${dto.steps.length}段中${dto.rank.index + 1}段目` } }, pips));
}

/**
 * ランクロードを歩くアバター（吹き出し・足元の影・歩いた跡の光）を作る。
 * @param dto ランク
 * @param progress 進み具合
 * @param avatar アバターの画像（無ければ人のアイコン）
 * @returns 要素
 */
function createWalker(dto: RankStatusDto, progress: RankProgress, avatar: HTMLElement | undefined): HTMLElement {
  const log = logger.fn('createWalker', { roadPercent: progress.roadPercent, hasAvatar: avatar !== undefined });
  const bubble = progress.isTop ? '最高ランク！' : `あと${dto.rank.remaining ?? 0}pt`;
  const walker = h('div', { class: 'rank-road__walker', attrs: { 'data-testid': 'rank-next' } }, [
    h('span', { class: 'rank-road__bubble', text: bubble }),
    h('span', { class: 'rank-road__trail', attrs: { 'aria-hidden': 'true' } }),
    avatar ?? h('span', { class: 'rank-road__avatar-fallback', attrs: { 'aria-hidden': 'true' } }, [createIcon('person')]),
    h('span', { class: 'rank-road__shadow', attrs: { 'aria-hidden': 'true' } }),
  ]);
  setStyle(walker, '--x', `${progress.roadPercent}%`);
  return log.exit(walker);
}

/**
 * ランクロード（5段の紋章を光る道でつなぎ、アバターがいまの位置に立つ。次の段には照準の輪）を作る。
 * @param dto ランク
 * @param avatar アバターの画像
 * @returns 要素
 */
function createRoad(dto: RankStatusDto, avatar: HTMLElement | undefined): HTMLElement {
  const log = logger.fn('createRoad', { steps: dto.steps.length });
  const progress = rankProgressOf(dto);
  const last = Math.max(1, dto.steps.length - 1);
  const nodes = dto.steps.map((step, i) => {
    const node = h('li', { class: 'rank-road__node', dataset: { state: step.state, next: i === dto.rank.index + 1 ? 'true' : undefined } }, [
      createRankEmblem(i, { locked: step.state === 'locked', className: 'rank-road__emblem' }),
      h('span', { class: 'rank-road__name', text: step.name }),
    ]);
    setStyle(node, '--x', `${(i / last) * 100}%`);
    return node;
  });
  // 現在地の点は道の中に置き、紋章の下に隠れるようにする（段ちょうどのときに数字を隠さない）
  const track = h('span', { class: 'rank-road__track' }, [h('span', { class: 'rank-road__fill' }), h('span', { class: 'rank-road__dot', attrs: { 'aria-hidden': 'true' } })]);
  setStyle(track, '--fill', `${progress.roadPercent}%`);
  const next = dto.rank.nextName === undefined ? '最上段' : `次は${dto.rank.nextName}、あと${dto.rank.remaining ?? 0}ポイント`;
  return log.exit(
    h('div', { class: 'rank-road', attrs: { role: 'img', 'aria-label': `ランクロード。いまは${dto.rank.name}。${next}`, 'data-testid': 'rank-road' } }, [
      h('div', { class: 'rank-road__lane' }, [track, h('ol', { class: 'rank-road__nodes', attrs: { 'aria-hidden': 'true' } }, nodes), createWalker(dto, progress, avatar)]),
    ]),
  );
}

/**
 * ステータスパネル（画面幅いっぱいの暗い盤）を作る。開いた瞬間に紋章が落ちてきて光る（タップで飛ばせる）。
 * @param dto ランク
 * @param avatar アバターの画像
 * @param onSkip 盤をタップしたとき（登場の演出を飛ばす）
 * @returns 盤と、数え上げ・傾きに使う部品
 */
export function createHero(dto: RankStatusDto, avatar: HTMLElement | undefined, onSkip: () => void): HeroParts {
  const log = logger.fn('createHero', { index: dto.rank.index });
  const near = isNearRankUp(rankProgressOf(dto));
  const points = h('strong', { class: 'rank-hero__num', attrs: { 'data-testid': 'rank-points' }, text: String(dto.points) });
  const tilt = createTiltBox(dto.rank.index);
  const name = h('p', { class: ['rank-hero__name', [...dto.rank.name].length > LONG_NAME_CHARS ? 'rank-hero__name--long' : undefined], attrs: { 'data-testid': 'rank-name' }, text: dto.rank.name });
  const element = h('section', { class: 'rank-hero', dataset: { tier: String(tierOf(dto.rank.index)) }, attrs: { 'data-testid': 'rank-hero' }, on: { click: onSkip } }, [
    h('span', { class: 'rank-hero__bg', attrs: { 'aria-hidden': 'true' } }),
    createMotes(),
    h('span', { class: 'rank-hero__keep', attrs: { role: 'img', 'aria-label': 'ランクは下がりません', title: 'ランクは下がりません' } }, [createIcon('shield')]),
    h('p', { class: 'rank-hero__kicker', attrs: { 'aria-hidden': 'true' }, text: `RANK ${dto.rank.index + 1}` }),
    createStage(dto.rank.index, tilt),
    name,
    createPips(dto),
    h('p', { class: 'rank-hero__points', attrs: { 'aria-label': `累計${dto.points}ポイント` } }, [points, h('span', { class: 'rank-hero__pt', text: 'PT' })]),
    near ? h('p', { class: 'rank-hero__near', attrs: { 'data-testid': 'rank-near' } }, [createIcon('arrowUp'), 'ランクアップ目前！']) : undefined,
    createRoad(dto, avatar),
    h('span', { class: 'rank-hero__flash', attrs: { 'aria-hidden': 'true' } }),
  ]);
  return log.exit({ element, points, tilt });
}
