/**
 * @file 地区カード（Common/ui/cards 層）
 * 地区の状態サマリ（成長Lv・色あせ状態・地区の主・次の目標）。CLAUDE.md 6.3・11、wireframes/03_sheet。
 * 色あせは「彩度・透明度・破線・◌（かすれ円のアイコン）」で示し、Lv はそのまま表示する（色あせは見た目だけ＝CLAUDE.md 4.3）。
 * 主は王冠の線アイコン、取り返し中は再訪理由チップ（旗＋「取り返し」）を添える（docs/08 §10.3）。
 */
import { createLogger } from '@/Common/logging/logger';
import { fadedFill, fadeVisual } from '@/Common/ui/canvas/fadeStyle';
import type { FadeKind } from '@/Common/ui/canvas/fadeStyle';
import { createReasonTag } from '@/Common/ui/cards/RevisitReasonCard';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';

const logger = createLogger('Common/ui/cards/DistrictCard');

/** 成長段階ごとの色の濃さ（Lv0 は輪郭のみ） */
export const LEVEL_FILL_ALPHA: readonly number[] = [0, 0.35, 0.65, 1];

/** createDistrictCard のオプション */
export interface DistrictCardOptions {
  readonly name: string;
  /** 地区の色（'#rrggbb'） */
  readonly color: string;
  /** 成長段階 0〜3（下がらない） */
  readonly level: number;
  readonly fadeKind: FadeKind;
  /** fading の進み具合 0〜1（省略時 0） */
  readonly fadeProgress?: number;
  /** 色あせの表示文言（例「あと5日で色あせ」「色あせ中」） */
  readonly fadeLabel?: string;
  /** 主の表示文言（例「主：あなた」「主：旅人タロウ」） */
  readonly lordLabel?: string;
  /** 自分（旅人）が主なら true（主タグを金の面＋王冠アイコンで強調） */
  readonly isLordMe?: boolean;
  /** 主を奪われて取り返し中なら true（タグの列に「取り返し」チップ） */
  readonly lordLost: boolean;
  readonly nextGoalText: string;
  readonly onClick?: () => void;
  /** 右端に置く追加の操作（「カレンダーに追加」など） */
  readonly action?: HTMLElement;
  /** data-district-id に入れる地区ID（E2E 用） */
  readonly districtId?: string;
}

/**
 * 成長段階を 0〜3 の整数に丸める。
 * @param level 成長段階
 * @returns 0〜3
 */
function clampLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(3, Math.max(0, Math.round(level))) : 0;
}

/**
 * 成長段階と色あせを表すスウォッチ（色見本）を作る。
 * @param opts 地区カードのオプション
 * @returns span 要素
 */
export function createDistrictSwatch(opts: Pick<DistrictCardOptions, 'color' | 'level' | 'fadeKind' | 'fadeProgress'>): HTMLElement {
  const log = logger.fn('createDistrictSwatch', { level: opts.level, fadeKind: opts.fadeKind });
  const level = clampLevel(opts.level);
  const visual = fadeVisual(opts.fadeKind, opts.fadeProgress ?? 0);
  const alpha = LEVEL_FILL_ALPHA[level] ?? 0;
  const swatch = h(
    'span',
    {
      class: 'district-swatch',
      attrs: { 'aria-hidden': 'true' },
      dataset: { level, fade: opts.fadeKind, dashed: visual.dashed ? '1' : '0' },
      style: { '--swatch-fill': level === 0 ? 'transparent' : fadedFill(opts.color, visual, alpha) },
    },
    [visual.icon === '' ? undefined : h('span', { class: 'district-swatch__icon' }, [createIcon('fade')])],
  );
  return log.exit(swatch);
}

/**
 * 地区カードを作る（data-testid="district-card"）。
 * @param opts 名前・色・Lv・色あせ・主・次の目標・タップ時の処理
 * @returns カード要素
 */
export function createDistrictCard(opts: DistrictCardOptions): HTMLElement {
  const log = logger.fn('createDistrictCard', { districtId: opts.districtId, level: opts.level, fadeKind: opts.fadeKind, lordLost: opts.lordLost });
  const level = clampLevel(opts.level);
  const isFading = opts.fadeKind === 'fading';
  const head = h('span', { class: 'district-card__head' }, [
    h('span', { class: 'district-card__name', text: opts.name }),
    h('span', { class: ['tag', 'tag--level'], text: `Lv${level}` }),
    opts.fadeLabel === undefined
      ? undefined
      : h('span', { class: ['tag', 'tag--fade'], dataset: { fade: opts.fadeKind } }, [isFading ? createIcon('fade') : undefined, opts.fadeLabel]),
    opts.lordLabel === undefined
      ? undefined
      : h('span', { class: ['tag', opts.isLordMe === true ? 'tag--lord' : undefined] }, [opts.isLordMe === true ? createIcon('crown') : undefined, opts.lordLabel]),
    opts.lordLost ? createReasonTag('reclaim', 'small') : undefined,
  ]);
  const content = [
    createDistrictSwatch(opts),
    h('span', { class: 'district-card__body' }, [head, h('span', { class: 'district-card__sub', text: opts.nextGoalText })]),
    opts.onClick === undefined ? undefined : h('span', { class: 'card-chevron', attrs: { 'aria-hidden': 'true' } }, [createIcon('chevronRight')]),
  ];
  const onClick = opts.onClick;
  const main =
    onClick === undefined
      ? h('div', { class: 'district-card__main' }, content)
      : h('button', { class: 'district-card__main', attrs: { type: 'button' }, on: { click: userAction('district-card', onClick) } }, content);
  const card = h(
    'div',
    { class: ['card', 'district-card'], attrs: { 'data-testid': 'district-card', 'data-district-id': opts.districtId, 'data-fade': opts.fadeKind, 'data-level': level } },
    [main, opts.action === undefined ? undefined : h('div', { class: 'district-card__action' }, [opts.action])],
  );
  return log.exit(card);
}
