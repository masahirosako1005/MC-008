/**
 * @file 店舗CMS の画面で共有する部品と文脈（presentation/cms 層）
 * DOM は h() だけで作る（innerHTML 禁止＝SEC-14）。入力された文字はすべて textContent で出す。
 * 見た目の決まり（デザイン仕様 2026-11-09）：
 * - 説明文・ヒント・括弧書きは置かない。説明は左の「見え方」に任せる
 * - 朱の主ボタンは1画面に1つ。状態は名詞で止める（「未保存の変更」「保存済み」）
 * - 記号（✓ → ↗）は文字ではなく SVG アイコンで出す
 * - 影はモーダル・トースト・シート・メニュー（浮いて重なるもの）だけ。壊す操作は朱にせず、白地に誤りの色の文字（markDanger）
 */
import type { CmsShopEventDto, CmsShopInfoDto } from '@/application/dto/CmsDto';
import type { CmsServices } from '@/application/CmsServices';
import { APP_ORIGIN } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { dayOfWeekOf, parseLocalDate } from '@/Common/utils/date';
import { h } from '@/Common/ui/dom';
import type { Child } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import type { ModalHandle } from '@/Common/ui/Modal';
import { SHOP_EVENT_MAX_OPEN_PER_SPOT } from '@/domain/revisit/constants';
import type { CmsPage } from '@/presentation/cms/cmsRoute';

const logger = createLogger('presentation/cms/cmsUi');

/** 利用者アプリを開くウィンドウの名前（何度押しても同じタブを使う） */
export const APP_WINDOW_NAME = 'kayoimachi-app';

/** 日曜始まりの曜日（dayOfWeekOf の番号の順） */
const SUNDAY_FIRST = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 通知（一度に1つだけ出す） */
export interface CmsNotifier {
  /**
   * 短い通知を出す（前の通知は消える）。
   * @param message 12字以内の名詞・短文
   * @param kind 'success'（既定）/ 'error'
   */
  show(message: string, kind?: 'success' | 'error'): void;
}

/** CMS の各画面に渡す文脈 */
export interface CmsContext {
  readonly services: CmsServices;
  readonly toast: CmsNotifier;
  /** 選んでいる店の最新の情報 */
  readonly info: CmsShopInfoDto;
  /**
   * 別のページへ移る。
   * @param page ページ
   */
  go(page: CmsPage): void;
  /**
   * 保存後の情報で画面を描き直す（店の一覧も更新する）。
   * @param info 保存後の店の情報
   */
  update(info: CmsShopInfoDto): void;
  /**
   * 入力中の値を取り出す（無ければ作る）。店ごと・用途ごとに、ページを移っても残る。
   * @param key 用途の名前（例 'info'、'event'）
   * @param init 初めて使うときの値
   * @returns 入力中の値（書き換えるとそのまま残る）
   */
  draft<T extends object>(key: string, init: () => T): T;
  /**
   * 入力中の値を捨てる。
   * @param key 用途の名前
   */
  discardDraft(key: string): void;
  /**
   * 保存していない変更があるかを知らせる（タブの点・移るときの確認・閉じるときの確認に使う）。
   * @param key 用途の名前
   * @param dirty 保存していない変更があるか
   */
  setDirty(key: string, dirty: boolean): void;
  /**
   * そのページをこの店で開いたことがあるか（はじめにやることに使う）。
   * @param page ページ
   * @returns 開いたことがあれば true
   */
  hasSeen(page: CmsPage): boolean;
  /** スマホ幅で「見え方」のシートを開く */
  openPreview(): void;
}

/** CMS の画面（描画した要素を返す） */
export type CmsScreen = (ctx: CmsContext) => HTMLElement;

/**
 * アイコンを作る。
 * @param name アイコン名
 * @param className 追加のクラス
 * @returns SVG
 */
export function icon(name: IconName, className?: string): SVGSVGElement {
  const log = logger.fn('icon', { name });
  const svg = createIcon(name);
  if (className !== undefined) svg.classList.add(className);
  return log.exit(svg);
}

/**
 * ページの見出し行（h1 と右肩）を作る。
 * @param title 見出し
 * @param aside 右肩に置くもの
 * @param opts hidden: 見出しを見せない（読み上げと、ページを移ったときのフォーカス先にだけ使う）
 * @returns header 要素（hidden のときは見えない h1 だけ）
 */
export function pageTitle(title: string, aside?: Child | readonly Child[], opts: { readonly hidden?: boolean } = {}): HTMLElement {
  const log = logger.fn('pageTitle', { title, hidden: opts.hidden === true });
  const heading = h('h1', { class: ['cms-title__text', opts.hidden === true && 'cms-visually-hidden'], attrs: { tabindex: -1, 'data-testid': 'cms-page-title' }, text: title });
  if (opts.hidden === true) return log.exit(heading);
  const right = Array.isArray(aside) ? aside : [aside];
  return log.exit(h('header', { class: 'cms-title' }, [heading, h('div', { class: 'cms-title__aside' }, right as readonly Child[])]));
}

/**
 * フォームの区切り（見出しと中身。区切り線で分ける）。
 * @param title 見出し（無ければ見出しなし）
 * @param children 中身
 * @param opts 右肩・テスト用 ID
 * @returns section 要素
 */
export function formSection(title: string | undefined, children: readonly Child[], opts: { readonly aside?: Child | readonly Child[]; readonly testId?: string } = {}): HTMLElement {
  const log = logger.fn('formSection', { title });
  const aside = Array.isArray(opts.aside) ? h('div', { class: 'cms-section__aside' }, opts.aside as readonly Child[]) : (opts.aside as Child);
  const head = title === undefined ? undefined : h('div', { class: 'cms-section__head' }, [h('h2', { class: 'cms-section__title', text: title }), aside]);
  return log.exit(h('section', { class: 'cms-section', attrs: { 'data-testid': opts.testId } }, [head, ...children]));
}

/** 札の色合い */
export type BadgeTone = 'live' | 'warn' | 'muted' | 'brand';

/**
 * 小さな札を作る。
 * @param text 文字
 * @param tone 色合い（live: 掲載中・保存済み／warn: 今日まで・明日まで・エラー／muted: 予定・下書き／brand: 協力店）
 * @returns span 要素
 */
export function badge(text: string, tone: BadgeTone = 'muted'): HTMLElement {
  return h('span', { class: ['cms-badge', `cms-badge--${tone}`], text });
}

/**
 * 'YYYY-MM-DD' を「11/14(土)」にする。
 * @param date 日付
 * @returns 短い日付（読めなければそのまま）
 */
export function mdDate(date: string): string {
  const log = logger.fn('mdDate', { date });
  const parsed = parseLocalDate(date);
  if (!parsed.ok) return log.exit(date);
  const [, month, day] = date.split('-').map(Number);
  return log.exit(`${month ?? ''}/${day ?? ''}(${SUNDAY_FIRST[dayOfWeekOf(parsed.value)] ?? ''})`);
}

/**
 * 掲載の上限に達したときだけ［新規作成］の左に出す「3件まで」を作る（ホームと一覧で使う。ふだんは出さない）。
 * @returns span 要素
 */
export function slotLimit(): HTMLElement {
  return h('span', { class: 'cms-muted', attrs: { 'data-testid': 'cms-slots' }, text: `${SHOP_EVENT_MAX_OPEN_PER_SPOT}件まで` });
}

/**
 * クーポン・イベントの状態の札を作る（予定・掲載中・今日まで・明日まで・終了・取り下げ）。
 * 掲載中は残り1日以下のときだけ「今日まで」「明日まで」にする（掲載した直後に終わりが近いと見せない）。
 * @param event クーポン・イベント
 * @returns 札
 */
export function eventBadge(event: CmsShopEventDto): HTMLElement {
  const log = logger.fn('eventBadge', { status: event.status, daysLeft: event.daysLeft });
  if (event.status === 'scheduled') return log.exit(badge('予定', 'muted'));
  if (event.status === 'active' && event.daysLeft === 0) return log.exit(badge('今日まで', 'warn'));
  if (event.status === 'active' && event.daysLeft === 1) return log.exit(badge('明日まで', 'warn'));
  if (event.status === 'active') return log.exit(badge('掲載中', 'live'));
  return log.exit(badge(event.status === 'withdrawn' ? '取り下げ' : '終了', 'muted'));
}

/** 行に出す下書き（札は「下書き」） */
export interface EventRowDraft {
  readonly draft: true;
  readonly title: string;
  readonly start: string;
  readonly end: string;
}

/**
 * クーポン・イベントの行の中身（札｜題名1行＋期間1行｜印）を作る。期間は「11/14(土)〜11/15(日)」だけ（種類の前置きは付けない）。
 * @param event クーポン・イベント、または下書き
 * @param chevron 右端に印を出すか（押せる行だけ）
 * @returns 子要素の並び
 */
function eventRowParts(event: CmsShopEventDto | EventRowDraft, chevron: boolean): Child[] {
  const log = logger.fn('eventRowParts', { chevron });
  return log.exit([
    'draft' in event ? badge('下書き', 'muted') : eventBadge(event),
    h('span', { class: 'cms-row__main' }, [
      h('span', { class: 'cms-row__title', text: event.title }),
      h('span', { class: 'cms-row__sub', text: `${mdDate(event.start)}〜${mdDate(event.end)}` }),
    ]),
    chevron ? icon('chevronRight', 'cms-row__chevron') : undefined,
  ]);
}

/**
 * 行全体を押すと開くクーポン・イベントの行を作る（ホームと一覧で同じ形にする）。
 * @param event クーポン・イベント、または下書き
 * @param onClick 押したときの処理
 * @param testId テスト用 ID
 * @returns button 要素
 */
export function eventRowButton(event: CmsShopEventDto | EventRowDraft, onClick: () => void, testId: string): HTMLButtonElement {
  const log = logger.fn('eventRowButton', { testId });
  return log.exit(h('button', { class: 'cms-row cms-row--event', attrs: { type: 'button', 'data-testid': testId }, on: { click: onClick } }, eventRowParts(event, true)));
}

/**
 * 押せないクーポン・イベントの行（店舗CMS で掲載したものでなく、取り下げられないもの）を作る。印は出さない。
 * @param event クーポン・イベント
 * @returns 要素
 */
export function eventRowStatic(event: CmsShopEventDto): HTMLElement {
  const log = logger.fn('eventRowStatic', { id: event.id });
  return log.exit(h('div', { class: 'cms-row cms-row--event' }, eventRowParts(event, false)));
}

/** 入力欄の部品 */
export interface CmsField<E extends HTMLElement> {
  readonly element: HTMLElement;
  readonly input: E;
  /**
   * 誤りを出す（空文字で消す）。
   * @param message 誤りの文
   */
  setError(message: string): void;
}

/**
 * 入力欄に誤りの文を結びつける（aria-invalid と aria-describedby）。
 * @param input 入力要素
 * @param id 誤りの文の要素の id
 * @returns 誤りの文の要素と、出す関数
 */
export function attachFieldError(input: HTMLElement, id: string): { readonly element: HTMLElement; readonly setError: (message: string) => void } {
  const log = logger.fn('attachFieldError', { id });
  const element = h('p', { class: 'cms-field__error', attrs: { id, role: 'alert' } });
  element.hidden = true;
  input.setAttribute('aria-describedby', id);
  return log.exit({
    element,
    setError: (message: string): void => {
      element.textContent = message;
      element.hidden = message.length === 0;
      if (message.length === 0) input.removeAttribute('aria-invalid');
      else input.setAttribute('aria-invalid', 'true');
    },
  });
}

/**
 * ラベルと文字数（12/30）つきの入力欄を作る。
 * @param opts ラベル・最大文字数・初期値・複数行か・入力時の処理
 * @returns 入力欄の部品
 */
export function textField(opts: {
  readonly label: string;
  readonly max: number;
  readonly value?: string;
  readonly multiline?: boolean;
  readonly placeholder?: string;
  readonly testId: string;
  readonly onInput: (value: string) => void;
  readonly onFocus?: () => void;
}): CmsField<HTMLInputElement | HTMLTextAreaElement> {
  const log = logger.fn('textField', { label: opts.label, max: opts.max });
  const counter = h('span', { class: 'cms-field__count', attrs: { 'aria-hidden': 'true' } });
  const attrs = { 'data-testid': opts.testId, id: opts.testId, placeholder: opts.placeholder };
  const input = opts.multiline === true ? h('textarea', { class: 'cms-input', attrs: { ...attrs, rows: 3 } }) : h('input', { class: 'cms-input', attrs: { ...attrs, type: 'text', autocomplete: 'off' } });
  input.value = opts.value ?? '';
  const error = attachFieldError(input, `${opts.testId}-error`);
  /** 文字数を出し、呼び出し側に知らせる */
  const refresh = (): void => { // audit-ignore: fnlog-missing 1文字入力するたびに呼ぶ表示の更新
    const length = [...input.value.normalize('NFC').trim()].length;
    counter.textContent = `${length}/${opts.max}`;
    counter.classList.toggle('cms-field__count--over', length >= opts.max);
    opts.onInput(input.value);
  };
  input.addEventListener('input', refresh);
  if (opts.onFocus !== undefined) input.addEventListener('focus', opts.onFocus);
  refresh();
  const head = h('div', { class: 'cms-field__head' }, [h('label', { class: 'cms-field__label', attrs: { for: opts.testId }, text: opts.label }), counter]);
  return log.exit({ element: h('div', { class: 'cms-field' }, [head, input, error.element]), input, setError: error.setError });
}

/**
 * フォームの下に固定するバー（左に状態、右にボタン）を作る。
 * @param status 状態の要素
 * @param actions ボタン（副 → 主の順。3つ以下）
 * @returns バー
 */
export function actionBar(status: Child, actions: readonly Child[]): HTMLElement {
  const log = logger.fn('actionBar', { count: actions.length });
  return log.exit(h('div', { class: 'cms-actionbar', attrs: { 'data-testid': 'cms-actionbar' } }, [h('div', { class: 'cms-actionbar__status' }, [status]), h('div', { class: 'cms-actionbar__buttons' }, actions)]));
}

/**
 * 確認のモーダルの「壊す操作」のボタンを、白地に誤りの色の文字にする（朱の主ボタンにしない）。
 * @param handle 開いたモーダル
 * @param testId 壊す操作のボタンの data-testid
 * @sideEffect ボタンに cms-btn-danger を付ける
 */
export function markDanger(handle: ModalHandle, testId: string): void {
  const log = logger.fn('markDanger', { testId });
  handle.element.querySelector(`[data-testid="${testId}"]`)?.classList.add('cms-btn-danger');
  log.exit(undefined);
}

/**
 * スマホ幅だけに出す「見え方」ボタンを作る（見出しの行の右肩の先頭に置く）。
 * @param ctx 文脈
 * @returns ボタン
 */
export function previewButton(ctx: CmsContext): HTMLButtonElement {
  const log = logger.fn('previewButton');
  return log.exit(h('button', { class: ['cms-btn', 'cms-btn--secondary', 'cms-only-narrow'], attrs: { type: 'button', 'data-testid': 'cms-open-preview' }, text: '見え方', on: { click: () => ctx.openPreview() } }));
}

/**
 * 左に「見え方」、右にフォームを置く2列の配置を作る。
 * @param preview 見え方の列
 * @param form フォームの列
 * @returns 要素
 */
export function twoColumn(preview: HTMLElement, form: HTMLElement): HTMLElement {
  const log = logger.fn('twoColumn');
  return log.exit(h('div', { class: 'cms-layout' }, [h('aside', { class: 'cms-layout__preview', attrs: { 'aria-label': '見え方' } }, [preview]), h('div', { class: 'cms-layout__form' }, [form])]));
}

/**
 * 利用者アプリの URL を作る（同じオリジンなら相対、CMS を別オリジンに置くときは APP_ORIGIN＝docs/09 §7.1）。
 * @param hash アプリのハッシュ（例 '#/spot/s_mm04'。無ければ先頭）
 * @returns URL
 */
export function appUrl(hash = ''): string {
  return APP_ORIGIN === '' ? `./${hash}` : `${APP_ORIGIN}/${hash}`;
}

/**
 * 利用者アプリを開くリンク（同じタブを使い回す）。
 * @param label 文字
 * @param hash アプリのハッシュ（例 '#/spot/s_mm04'）
 * @param testId テスト用 ID
 * @returns a 要素
 */
export function appLink(label: string, hash: string, testId?: string): HTMLAnchorElement {
  const log = logger.fn('appLink', { hash });
  // 自社のアプリなので opener の心配はない。rel=noopener を付けると同じ名前のタブを使い回せなくなるため付けない
  return log.exit(h('a', { class: 'cms-link', attrs: { href: appUrl(hash), target: APP_WINDOW_NAME, 'data-testid': testId } }, [label, icon('arrowRight', 'cms-icon-external')]));
}
