/**
 * @file 店舗CMS の画面で共有する部品と文脈（presentation/cms 層）
 * DOM は h() だけで作る（innerHTML 禁止＝SEC-14）。入力された文字はすべて textContent で出す。
 * 初めての人向けの共通ルール：
 * - どの画面も「見出し＋このページでできること（1文）」から始める（pageHeader）
 * - 入力の誤りは、その欄のすぐ下に、直し方がわかる言葉で出す（aria-invalid＋aria-describedby）
 * - 保存前の入力はページを移っても消さない（draft）。閉じようとしたら確認する（CmsApp）
 */
import type { CmsShopEventDto, CmsShopInfoDto } from '@/application/dto/CmsDto';
import type { CmsServices } from '@/application/CmsServices';
import { createLogger } from '@/Common/logging/logger';
import { dayOfWeekOf, parseLocalDate } from '@/Common/utils/date';
import { h } from '@/Common/ui/dom';
import type { Child } from '@/Common/ui/dom';
import type { ToastHost } from '@/Common/ui/Toast';
import { WEEKDAY_LABELS } from '@/domain/spot/BusinessHours';
import type { CmsPage } from '@/presentation/cms/cmsRoute';

const logger = createLogger('presentation/cms/cmsUi');

/** 利用者アプリを開くウィンドウの名前（何度押しても同じタブを使う） */
export const APP_WINDOW_NAME = 'kayoimachi-app';

/** 日曜始まりの曜日（dayOfWeekOf の番号の順） */
const SUNDAY_FIRST = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** CMS の各画面に渡す文脈 */
export interface CmsContext {
  readonly services: CmsServices;
  readonly toast: ToastHost;
  /** 選んでいる店の最新の情報 */
  readonly info: CmsShopInfoDto;
  /**
   * 別のページへ移る。
   * @param page ページ
   */
  go(page: CmsPage): void;
  /**
   * 保存後の情報で画面を描き直す（店の一覧の件数も更新する）。
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
   * 入力中の値を捨てる（保存・登録が済んだとき）。
   * @param key 用途の名前
   */
  discardDraft(key: string): void;
  /**
   * 保存していない変更があるかを知らせる（閉じるときの確認に使う）。
   * @param key 用途の名前
   * @param dirty 保存していない変更があるか
   */
  setDirty(key: string, dirty: boolean): void;
  /**
   * そのページをこの店で開いたことがあるか（はじめにやることの進み具合に使う）。
   * @param page ページ
   * @returns 開いたことがあれば true
   */
  hasSeen(page: CmsPage): boolean;
  /** かんたんガイドを開く */
  openGuide(): void;
}

/** CMS の画面（描画した要素を返す） */
export type CmsScreen = (ctx: CmsContext) => HTMLElement;

/**
 * ページの見出し（h1）と、このページでできることの1文を作る。見出しはページを移ったときに読み上げの起点になる。
 * @param title 見出し
 * @param lead このページでできること
 * @param aside 右側に置くもの（任意）
 * @returns header 要素
 */
export function pageHeader(title: string, lead: string, aside?: Child): HTMLElement {
  const log = logger.fn('pageHeader', { title });
  return log.exit(h('header', { class: 'cms-page' }, [
    h('div', { class: 'cms-page__text' }, [
      h('h1', { class: 'cms-page__title', attrs: { tabindex: -1, 'data-testid': 'cms-page-title' }, text: title }),
      h('p', { class: 'cms-page__lead', text: lead }),
    ]),
    aside,
  ]));
}

/**
 * 見出しつきの区画を作る。
 * @param title 見出し
 * @param children 中身
 * @param opts 説明文・手順の番号・テスト用 ID
 * @returns section 要素
 */
export function cmsSection(title: string, children: readonly Child[], opts: { readonly lead?: string; readonly step?: number; readonly testId?: string } = {}): HTMLElement {
  const log = logger.fn('cmsSection', { title });
  const heading = h('h2', { class: 'cms-card__title' }, [opts.step === undefined ? undefined : h('span', { class: 'cms-step', attrs: { 'aria-hidden': 'true' }, text: String(opts.step) }), title]);
  return log.exit(h('section', { class: 'cms-card', attrs: { 'data-testid': opts.testId } }, [
    heading,
    opts.lead === undefined ? undefined : h('p', { class: 'cms-card__lead', text: opts.lead }),
    ...children,
  ]));
}

/**
 * 小さな札（状態・種別など）を作る。
 * @param text 文字
 * @param tone 色合い（brand: 朱／ink: 紺墨／muted: 灰／deadline: 期限／ok: 完了）
 * @returns span 要素
 */
export function cmsBadge(text: string, tone: 'brand' | 'ink' | 'muted' | 'deadline' | 'ok' = 'muted'): HTMLElement {
  return h('span', { class: ['cms-badge', `cms-badge--${tone}`], text });
}

/** 状態の表示名 */
const STATUS_LABELS: Readonly<Record<CmsShopEventDto['status'], string>> = {
  active: '掲載中',
  scheduled: '掲載予定',
  ended: '終了',
  withdrawn: '取り下げ',
};

/**
 * クーポン・イベントの状態の説明を作る（「掲載中・あと3日」など）。
 * @param event クーポン・イベント
 * @returns 状態の文字
 */
export function eventStatusText(event: CmsShopEventDto): string {
  const log = logger.fn('eventStatusText', { status: event.status });
  const label = STATUS_LABELS[event.status];
  if (event.status === 'active') return log.exit(`${label}・${event.daysLeft === 0 ? '今日まで' : `あと${event.daysLeft ?? 0}日`}`);
  if (event.status === 'scheduled') return log.exit(`${label}・${event.daysUntilStart ?? 0}日後から`);
  if (event.status === 'withdrawn' && event.withdrawnOn !== undefined) return log.exit(`${label}（${shortDate(event.withdrawnOn)}）`);
  return log.exit(label);
}

/**
 * 'YYYY-MM-DD' を「11月9日（月）」にする。
 * @param date 日付
 * @param withWeekday 曜日をつけるか（既定 true）
 * @returns 短い日付（読めなければそのまま）
 */
export function shortDate(date: string, withWeekday = true): string {
  const log = logger.fn('shortDate', { date });
  const parsed = parseLocalDate(date);
  if (!parsed.ok) return log.exit(date);
  const [, month, day] = date.split('-').map(Number);
  const weekday = withWeekday ? `（${SUNDAY_FIRST[dayOfWeekOf(parsed.value)] ?? ''}）` : '';
  return log.exit(`${month ?? ''}月${day ?? ''}日${weekday}`);
}

/**
 * 定休日の番号（0=月 … 6=日）を「日曜・月曜が休み」のような文にする。
 * @param closedDays 定休日
 * @returns 文
 */
export function closedDaysText(closedDays: Iterable<number>): string {
  const log = logger.fn('closedDaysText');
  const days = [...closedDays].sort((a, b) => a - b).map((d) => `${WEEKDAY_LABELS[d] ?? ''}曜`);
  return log.exit(days.length === 0 ? '休みなし（無休）' : `${days.join('・')}が休み`);
}

/** 入力欄の部品 */
export interface CmsField<E extends HTMLElement> {
  readonly element: HTMLElement;
  readonly input: E;
  /**
   * 誤りを出す（空文字で消す）。
   * @param message 直し方がわかる説明
   */
  setError(message: string): void;
}

/**
 * 入力欄に「誤りの説明」を結びつける（aria-invalid と aria-describedby）。
 * @param input 入力要素
 * @param id 説明の要素の id
 * @returns 説明の要素と、説明を出す関数
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
 * 文字数カウンタつきの入力欄を作る。
 * @param opts ラベル・補足・最大文字数・初期値・複数行か・入力時の処理
 * @returns 入力欄の部品
 */
export function cmsTextField(opts: {
  readonly label: string;
  readonly hint?: string;
  readonly max: number;
  readonly value?: string;
  readonly multiline?: boolean;
  readonly placeholder?: string;
  readonly testId: string;
  readonly onInput: (value: string) => void;
}): CmsField<HTMLInputElement | HTMLTextAreaElement> {
  const log = logger.fn('cmsTextField', { label: opts.label, max: opts.max });
  const counter = h('span', { class: 'cms-field__count', attrs: { 'aria-hidden': 'true' } });
  const attrs = { 'data-testid': opts.testId, placeholder: opts.placeholder, 'aria-label': opts.label };
  const input = opts.multiline === true ? h('textarea', { class: 'cms-input', attrs: { ...attrs, rows: 3 } }) : h('input', { class: 'cms-input', attrs: { ...attrs, type: 'text', autocomplete: 'off' } });
  input.value = opts.value ?? '';
  const error = attachFieldError(input, `${opts.testId}-error`);
  /** 文字数の表示を更新し、呼び出し側に知らせる */
  const refresh = (): void => { // audit-ignore: fnlog-missing 1文字入力するたびに呼ぶ表示の更新
    const length = [...input.value.normalize('NFC').trim()].length;
    counter.textContent = length > opts.max ? `${length - opts.max}字オーバー` : `あと${opts.max - length}字`;
    counter.classList.toggle('cms-field__count--over', length > opts.max);
    opts.onInput(input.value);
  };
  input.addEventListener('input', refresh);
  refresh();
  const head = h('div', { class: 'cms-field__head' }, [h('span', { class: 'cms-field__label', text: opts.label }), counter]);
  const hint = opts.hint === undefined ? undefined : h('span', { class: 'cms-field__hint', text: opts.hint });
  return log.exit({ element: h('label', { class: 'cms-field' }, [head, hint, input, error.element]), input, setError: error.setError });
}

/**
 * 失敗の説明を出す欄を作る（role=alert）。
 * @returns 要素と、文言を入れる関数（空文字で隠す）
 */
export function cmsErrorLine(): { readonly element: HTMLElement; readonly show: (message: string) => void } {
  const log = logger.fn('cmsErrorLine');
  const element = h('p', { class: 'cms-error', attrs: { role: 'alert', 'data-testid': 'cms-error' } });
  element.hidden = true;
  return log.exit({
    element,
    show: (message: string): void => {
      element.textContent = message;
      element.hidden = message.length === 0;
    },
  });
}

/**
 * 利用者アプリを開くリンクを作る（同じタブを使い回す）。
 * @param label 文字
 * @param hash アプリのハッシュ（例 '#/spot/s_mm04'）
 * @param testId テスト用 ID
 * @returns a 要素
 */
export function appLink(label: string, hash: string, testId?: string): HTMLAnchorElement {
  // 同じオリジンのアプリなので opener の心配はない。rel=noopener を付けると同じ名前のタブを使い回せなくなるため付けない
  return h('a', { class: 'cms-link', attrs: { href: `./${hash}`, target: APP_WINDOW_NAME, 'data-testid': testId }, text: `${label} ↗` });
}
