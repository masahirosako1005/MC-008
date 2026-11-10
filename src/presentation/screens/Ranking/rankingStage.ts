/**
 * @file ランキング画面の上部ステージ（presentation/screens/Ranking 層。DOM の組立てだけ）
 * 「ランキングどどーん！」を、文字ではなく動きで見せる:
 * - 暗いステージにリーグ色のスポットライト（回る光の筋）とキラキラ
 * - 金・銀・銅の台がせり上がり、大きなアバターが上から着地（1位は最後に「どーん」と着地してステージが揺れ、衝撃の輪が広がる）
 * - 頭の上のエモート（♪・！・炎・汗・キラキラ・ハート）が順番にポンと出る
 * - 下段の「あなた」帯: アバター＋大きな順位＋すぐ上のライバルまでのレース
 * - 台の正面に、その順位でもらえる報酬の絵（アバターの部品）。奥に花火。段が上がった日は「報酬アップ」が叩きつけられる
 * 文字は「あと○日」「報酬」「リーグ名と何で競うか」「名前・数」だけにする。動きは CSS（prefers-reduced-motion: no-preference のときだけ）。
 */
import type { LeagueDto, RankingDto, RankingEntryDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';
import { countLabel, myEntryOf, podiumEmoteOf, podiumSlotsOf } from '@/presentation/screens/Ranking/rankingModel';
import type { EmoteKind, PodiumSlot } from '@/presentation/screens/Ranking/rankingModel';

const logger = createLogger('presentation/screens/Ranking/rankingStage');

/** SVG の名前空間 */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** エモートの図形（24×24。塗りの色は CSS で data-emote ごとに付ける） */
type EmoteShape = readonly ['path', string] | readonly ['circle', number, number, number] | readonly ['rect', number, number, number, number, number];

/** エモートごとの図形 */
const EMOTE_SHAPES: Readonly<Record<EmoteKind, readonly EmoteShape[]>> = {
  note: [['circle', 8.5, 17, 3.3], ['path', 'M10.4 17V4.4l8.2 2.3v3.6l-5.4-1.5V17z']],
  exclaim: [['rect', 10, 2.8, 4, 12.6, 2], ['circle', 12, 19.6, 2.3]],
  fire: [['path', 'M12.6 2.4c.7 3.6 5.6 5.7 5.6 11.1a6.2 6.2 0 0 1-12.4 0c0-2.7 1.3-4.7 3-6.1.1 2.1.9 3.4 2.3 3.9-.6-3.4.1-6.4 1.5-8.9z']],
  sweat: [['path', 'M12 3.1C8.9 7.6 6.9 10.7 6.9 13.7a5.1 5.1 0 0 0 10.2 0c0-3-2-6.1-5.1-10.6z']],
  sparkle: [['path', 'M12 2.3l2.4 7.3 7.3 2.4-7.3 2.4L12 21.7l-2.4-7.3L2.3 12l7.3-2.4z']],
  heart: [['path', 'M12 20.6S3.9 15.7 3.9 10A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 8.1 2c0 5.7-8.1 10.6-8.1 10.6z']],
};

/** キラキラの位置（ステージに対する %）と出る順 */
const SPARKS: readonly (readonly [number, number])[] = [[8, 22], [22, 10], [38, 30], [62, 12], [78, 28], [92, 16], [16, 48], [86, 50]];

/** 表彰台の場所 → 着地の順（3位 → 2位 → 1位） */
const LANDING_ORDER: Readonly<Record<PodiumSlot['place'], number>> = { third: 0, second: 1, first: 2 };

/** 表彰台のアバターの拡大率（1位を大きく） */
const PODIUM_SCALE: Readonly<Record<PodiumSlot['place'], number>> = { first: 1.12, second: 0.92, third: 0.92 };

/** 紙吹雪の粒の数 */
const CONFETTI_COUNT = 18;

/** 花火の位置（ステージに対する %） */
const BURSTS: readonly (readonly [number, number])[] = [[14, 24], [86, 20], [50, 10]];

/** アバターを作る関数（参加者・拡大率・画像が作れないときの代わりの class） */
export type AvatarMaker = (entry: RankingEntryDto, scale: number, fallbackClass?: string) => HTMLElement;

/**
 * エモートの吹き出しを作る（飾り。読み上げない）。
 * @param kind エモート
 * @param delay 出はじめるまでの順番（0, 1, 2 …。CSS の遅れに使う）
 * @returns 要素
 */
export function createEmote(kind: EmoteKind, delay: number): HTMLElement {
  const log = logger.fn('createEmote', { kind, delay });
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const shape of EMOTE_SHAPES[kind]) {
    const el = document.createElementNS(SVG_NS, shape[0]);
    const attrs: Readonly<Record<string, string | number>> =
      shape[0] === 'path'
        ? { d: shape[1] }
        : shape[0] === 'circle'
          ? { cx: shape[1], cy: shape[2], r: shape[3] }
          : { x: shape[1], y: shape[2], width: shape[3], height: shape[4], rx: shape[5] };
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
    svg.append(el);
  }
  return log.exit(h('span', { class: 'emote', dataset: { emote: kind }, style: { '--emote-i': String(delay) }, attrs: { 'aria-hidden': 'true' } }, [svg]));
}

/**
 * 紙吹雪（飾り。読み上げない）を作る。
 * @returns 要素
 */
export function createConfetti(): HTMLElement {
  const log = logger.fn('createConfetti');
  const pieces = Array.from({ length: CONFETTI_COUNT }, (_, i) =>
    h('span', { class: 'confetti__piece', style: { '--i': String(i), '--x': `${((i * 37) % 100) - 50}`, '--r': `${(i * 53) % 360}deg` } }),
  );
  return log.exit(h('span', { class: 'confetti', attrs: { 'aria-hidden': 'true' } }, pieces));
}

/**
 * 表彰台の1枠（エモート・アバター・台。台の正面に順位・名前・数）を作る。
 * @param slot 枠
 * @param league リーグ
 * @param avatar アバターを作る関数
 * @param prizeOf 順位 → その順位でもらえる報酬の絵
 * @returns 要素
 */
function stageSlot(slot: PodiumSlot, league: LeagueDto, avatar: AvatarMaker, prizeOf: StageInput['prizeOf']): HTMLElement { // audit-ignore: fnlog-missing 表彰台の3枠ぶん呼ぶ DOM 組立て（呼び出し側 createStage でログ）
  const { entry, place } = slot;
  const order = LANDING_ORDER[place];
  return h(
    'li',
    {
      class: ['stage-slot', entry.isMe ? 'stage-slot--me' : undefined],
      dataset: { place },
      style: { '--land-i': String(order) },
      attrs: { 'data-testid': 'podium-slot', 'aria-label': `${entry.rank}位 ${entry.name} ${countLabel(entry.count, league.unit)}${entry.isMe ? '（あなた）' : ''}` },
    },
    [
      h('span', { class: 'stage-slot__figure', attrs: { 'aria-hidden': 'true' } }, [
        createEmote(podiumEmoteOf(entry, league), order),
        entry.isMe ? h('span', { class: 'stage-slot__you', text: 'YOU' }) : undefined,
        avatar(entry, PODIUM_SCALE[place], 'stage-slot__badge'),
        place === 'first' ? h('span', { class: 'stage-slot__shock' }) : undefined,
      ]),
      h('span', { class: 'stage-block', attrs: { 'aria-hidden': 'true' } }, [
        h('span', { class: 'stage-block__rank', text: String(entry.rank) }),
        h('span', { class: 'stage-block__name', text: entry.name }),
        h('span', { class: 'stage-block__count', text: countLabel(entry.count, league.unit) }),
        prizeOf === undefined ? undefined : h('span', { class: 'stage-block__prize' }, [prizeOf(entry.rank)]),
      ]),
    ],
  );
}

/** ステージを作る入力 */
export interface StageInput {
  readonly dto: RankingDto;
  readonly league: LeagueDto;
  readonly avatar: AvatarMaker;
  /** 下段の「あなた」帯 */
  readonly meStrip: HTMLElement;
  /** 「報酬」を押したとき */
  readonly onRewards: () => void;
  /** リーグのアイコン */
  readonly leagueIcon: IconName;
  /** 順位 → その順位でもらえる報酬の絵（台の正面に出す。無ければ出さない） */
  readonly prizeOf?: (rank: number) => HTMLElement | undefined;
  /** 昨日より上の段に上がったときの「報酬アップ」に添える報酬の絵（上がっていなければ undefined） */
  readonly tierUp?: HTMLElement;
}

/**
 * 上部ステージ（あと○日・報酬・リーグ名・表彰台・あなた帯）を作る。
 * @param input ステージを作る入力
 * @returns 要素
 */
export function createStage(input: StageInput): HTMLElement {
  const { dto, league } = input;
  const log = logger.fn('createStage', { leagueId: league.id });
  const slots = podiumSlotsOf(league.entries);
  const me = myEntryOf(league);
  const party = slots.some((s) => s.entry.isMe) || (league.myRankYesterday !== undefined && me !== undefined && me.rank < league.myRankYesterday);
  const hint = league.tabHint === undefined ? undefined : `${league.tabHint}で勝負`;
  return log.exit(
    h('section', { class: 'stage', dataset: { league: league.id }, attrs: { 'data-testid': 'ranking-stage', 'aria-label': `${league.name}の表彰台` } }, [
      h('span', { class: 'stage__rays', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'stage__sparks', attrs: { 'aria-hidden': 'true' } }, SPARKS.map(([x, y], i) => h('span', { class: 'stage__spark', style: { left: `${x}%`, top: `${y}%`, '--spark-i': String(i) } }))),
      h('span', { class: 'stage__bursts', attrs: { 'aria-hidden': 'true' } }, BURSTS.map(([x, y], i) => h('span', { class: 'stage__burst', style: { left: `${x}%`, top: `${y}%`, '--burst-i': String(i) } }))),
      party ? createConfetti() : undefined,
      h('div', { class: 'stage__head' }, [
        h('span', { class: 'stage__chip', attrs: { 'data-testid': 'ranking-finale', 'aria-label': `${dto.monthLabel}の決着まであと${dto.daysLeft}日` } }, [
          createIcon('flag'),
          h('span', { attrs: { 'aria-hidden': 'true' } }, ['あと', h('strong', { text: String(dto.daysLeft) }), '日']),
        ]),
        h('button', { class: ['stage__chip', 'stage__chip--prize'], attrs: { type: 'button', 'data-testid': 'ranking-rewards-link' }, on: { click: userAction('ranking-rewards-link', input.onRewards) } }, [
          createIcon('rank'),
          '報酬',
        ]),
      ]),
      h('h2', { class: 'stage__title' }, [h('span', { class: 'stage__title-icon', attrs: { 'aria-hidden': 'true' } }, [createIcon(input.leagueIcon)]), league.name]),
      hint === undefined ? undefined : h('p', { class: 'stage__hint', text: hint }),
      h('ol', { class: 'stage-podium', attrs: { 'aria-label': '表彰台（上位3名）', 'data-testid': 'podium' } }, slots.map((slot) => stageSlot(slot, league, input.avatar, input.prizeOf))),
      input.tierUp === undefined ? undefined : h('p', { class: 'stage__tierup', attrs: { 'data-testid': 'ranking-tier-up', 'aria-label': '報酬アップ' } }, [h('span', { attrs: { 'aria-hidden': 'true' }, text: '報酬アップ' }), input.tierUp]),
      input.meStrip,
    ]),
  );
}
