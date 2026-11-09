/**
 * @file 再訪理由カード（Common/ui/cards 層）
 * 再訪理由の見た目（アイコン・ラベル）をここに集約し、下シート・スポット詳細・マイ街・ランキング・地区カードで共有する（docs/01 §3-11、CLAUDE.md 4.5、docs/08 §10.3）。
 * 種別は線のアイコン（期限＝時計／取り返し＝旗／色あせ＝かすれ円／未訪問＝コンパス／新着＝きらめき）＋短いラベルで区別し、色だけに頼らない。
 * 部品は3つ: アイコンの台座（createReasonIcon）、アイコン＋ラベルのチップ（createReasonTag）、カード（createRevisitReasonCard）。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';

const logger = createLogger('Common/ui/cards/RevisitReasonCard');

/** 再訪理由の種別（application の RevisitReasonKindDto と同じ値。表示優先順もこの順） */
export type RevisitReasonKind = 'deadline' | 'reclaim' | 'fade' | 'unvisited' | 'new';

/** 種別ごとの見た目 */
export interface RevisitReasonStyle {
  /** 画面に出す短いラベル（読み上げもこの名前） */
  readonly label: '期限' | '奪還' | '色あせ' | '未達成' | '新着';
  /** 線のアイコン */
  readonly icon: IconName;
}

/** 再訪理由の見た目（全画面で同じ表現にする） */
export const REVISIT_REASON_STYLE: Readonly<Record<RevisitReasonKind, RevisitReasonStyle>> = {
  deadline: { label: '期限', icon: 'clock' },
  reclaim: { label: '奪還', icon: 'flag' },
  fade: { label: '色あせ', icon: 'fade' },
  unvisited: { label: '未達成', icon: 'compass' },
  new: { label: '新着', icon: 'sparkle' },
};

/** 表示の優先順（CLAUDE.md 4.5 の表の順） */
export const REVISIT_REASON_ORDER: readonly RevisitReasonKind[] = ['deadline', 'reclaim', 'fade', 'unvisited', 'new'];

/** createRevisitReasonCard のオプション */
export interface RevisitReasonCardOptions {
  readonly kind: RevisitReasonKind;
  readonly title: string;
  readonly subtitle: string;
  /** つまみ用の1行表示（補足は省略表示） */
  readonly compact?: boolean;
  /** カード本体のタップ（該当地区・スポットへ） */
  readonly onClick?: () => void;
  /** 右端に置く追加の操作（「カレンダーに追加」ボタンなど） */
  readonly action?: HTMLElement;
  /** 追加の data-* 属性（地区ID など。E2E 用） */
  readonly dataset?: Readonly<Record<string, string | undefined>>;
}

/**
 * 再訪理由のアイコンを角丸の台座に載せる（カード左端・クーポン一覧など）。読み上げはラベル側に任せる。
 * @param kind 再訪理由の種別
 * @returns span 要素（aria-hidden、data-kind=種別）
 */
export function createReasonIcon(kind: RevisitReasonKind): HTMLElement {
  const log = logger.fn('createReasonIcon', { kind });
  const icon = h('span', { class: 'reason-icon', attrs: { 'aria-hidden': 'true' }, dataset: { kind } }, [createIcon(REVISIT_REASON_STYLE[kind].icon)]);
  return log.exit(icon);
}

/**
 * 再訪理由のチップ（線のアイコン＋短いラベル）を作る。地区カード・マイ街・ランキングなどでも使う。
 * @param kind 再訪理由の種別
 * @param size 'small' は行の右端などに置く小さい表示
 * @returns span 要素（data-kind=種別。ラベルの文字がそのまま読み上げられる）
 */
export function createReasonTag(kind: RevisitReasonKind, size: 'normal' | 'small' = 'normal'): HTMLElement {
  const log = logger.fn('createReasonTag', { kind, size });
  const style = REVISIT_REASON_STYLE[kind];
  const tag = h('span', { class: ['reason-chip', size === 'small' ? 'reason-chip--small' : undefined], dataset: { kind } }, [
    createIcon(style.icon),
    h('span', { class: 'reason-chip__label', text: style.label }),
  ]);
  return log.exit(tag);
}

/**
 * 再訪理由カードを作る（data-testid="reason-card"、data-kind=種別）。
 * 左にアイコンの台座、右に「ラベル・見出し・補足」。1行表示（つまみ）はラベルを補足の頭に並べる。
 * @param opts 種別・見出し・補足・1行表示・タップ時の処理・追加操作
 * @returns カード要素
 */
export function createRevisitReasonCard(opts: RevisitReasonCardOptions): HTMLElement {
  const log = logger.fn('createRevisitReasonCard', { kind: opts.kind, compact: opts.compact === true });
  const style = REVISIT_REASON_STYLE[opts.kind];
  const content = [
    createReasonIcon(opts.kind),
    h('span', { class: 'reason-card__text' }, [
      h('span', { class: 'reason-card__label', text: style.label }),
      h('span', { class: 'reason-card__title', text: opts.title }),
      h('span', { class: 'reason-card__subtitle', text: opts.subtitle }),
    ]),
    opts.onClick === undefined ? undefined : h('span', { class: 'card-chevron', attrs: { 'aria-hidden': 'true' } }, [createIcon('chevronRight')]),
  ];
  const onClick = opts.onClick;
  const main =
    onClick === undefined
      ? h('div', { class: 'reason-card__main' }, content)
      : h('button', { class: 'reason-card__main', attrs: { type: 'button' }, on: { click: userAction('reason-card', onClick) } }, content);
  const card = h('div', {
    class: ['card', 'reason-card', opts.compact === true ? 'reason-card--compact' : undefined],
    attrs: { 'data-testid': 'reason-card', 'data-kind': opts.kind },
    dataset: opts.dataset,
  }, [main, opts.action === undefined ? undefined : h('div', { class: 'reason-card__action' }, [opts.action])]);
  return log.exit(card);
}
