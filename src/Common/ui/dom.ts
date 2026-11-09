/**
 * @file 安全な DOM ビルダー（Common/ui 層）
 * HTML 文字列を使わずに要素を作る唯一の入口（SEC-14）。on* 属性・srcdoc・style 属性・javascript: URL は拒否する。
 * スタイルは CSSOM（style.setProperty）で設定するので CSP の style-src 'self' に違反しない。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('Common/ui/dom');

/** h() で作ってはいけない要素（スクリプト実行・外部読込・文書設定を伴うもの） */
type UnsafeTag = 'script' | 'iframe' | 'object' | 'embed' | 'frame' | 'frameset' | 'base' | 'meta' | 'link' | 'style';

/** h() で作れる要素名 */
export type SafeTag = Exclude<keyof HTMLElementTagNameMap, UnsafeTag>;

/** 子要素として渡せる値（false/null/undefined は無視する） */
export type Child = Node | string | number | false | null | undefined;

/** 要素種別ごとのイベントハンドラ */
export type EventHandlers = { readonly [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };

/** h() のオプション */
export interface HOptions {
  /** クラス名（配列なら falsy を除いて結合） */
  readonly class?: string | readonly (string | false | null | undefined)[];
  /** 属性（true は空文字、false/undefined は付けない） */
  readonly attrs?: Readonly<Record<string, string | number | boolean | undefined>>;
  /** data-* 属性（キーは camelCase。data-test-id ではなく data-testid にしたいときは attrs を使う） */
  readonly dataset?: Readonly<Record<string, string | number | undefined>>;
  /** textContent（子要素より先に設定される） */
  readonly text?: string;
  /** イベントハンドラ */
  readonly on?: EventHandlers;
  /** CSS プロパティ（'--accent' のようなカスタムプロパティも可） */
  readonly style?: Readonly<Record<string, string | undefined>>;
}

/** 名前で拒否する属性（イベントハンドラ属性は別途 on 接頭辞で拒否） */
const BLOCKED_ATTRIBUTES: ReadonlySet<string> = new Set(['srcdoc', 'style', 'formaction']);

/** 値の先頭が実行可能 URL スキームなら拒否する（空白・制御文字を除いて判定） */
const DANGEROUS_URL = /^(?:javascript|vbscript):/i;

/** URL 判定前に取り除く文字（ブラウザが無視する空白・制御文字） */
const URL_NOISE = /[\u0000- \u007f-\u009f]/g;

/**
 * 安全な HTML 要素を作る。HTML 文字列は一切受け取らない（innerHTML を使わない）。
 * 要素ごとに呼ばれるため関数ログは出さない（拒否した属性だけ warn で記録する）。
 * @param tag 要素名（script / iframe などは型で禁止）
 * @param opts クラス・属性・data-*・テキスト・イベント・スタイル
 * @param children 子要素（文字列はテキストノードになる）
 * @returns 作った要素
 */
export function h<K extends SafeTag>(tag: K, opts: HOptions = {}, children: readonly Child[] = []): HTMLElementTagNameMap[K] { // audit-ignore: fnlog-missing 要素ごとに呼ぶ DOM 生成の基本ヘルパー（拒否時のみ rejectAttribute でログ）
  const el = document.createElement(tag);
  applyClass(el, opts.class);
  if (opts.attrs !== undefined) applyAttributes(el, opts.attrs);
  if (opts.dataset !== undefined) applyDataset(el, opts.dataset);
  if (opts.style !== undefined) applyStyle(el, opts.style);
  if (opts.text !== undefined) el.textContent = opts.text;
  if (opts.on !== undefined) applyHandlers(el, opts.on);
  appendChildren(el, children);
  return el;
}

/**
 * クラス名を設定する。
 * @param el 対象要素
 * @param value 文字列またはクラス名の配列
 * @sideEffect el.className を変更する
 */
function applyClass(el: HTMLElement, value: HOptions['class']): void { // audit-ignore: fnlog-missing h() から要素ごとに呼ぶ内部ヘルパー
  if (value === undefined) return;
  const names = typeof value === 'string' ? [value] : value.filter((name): name is string => typeof name === 'string' && name.length > 0);
  if (names.length > 0) el.className = names.join(' ');
}

/**
 * 属性を検証して設定する。危険な属性・値は設定せずに warn ログを残す。
 * @param el 対象要素
 * @param attrs 属性の辞書
 * @sideEffect el の属性を変更する
 */
function applyAttributes(el: HTMLElement, attrs: NonNullable<HOptions['attrs']>): void { // audit-ignore: fnlog-missing h() から要素ごとに呼ぶ内部ヘルパー（拒否時は rejectAttribute がログ）
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    const text = value === true ? '' : String(value);
    if (!isSafeAttribute(name, text)) {
      rejectAttribute(name);
      continue;
    }
    el.setAttribute(name, text);
  }
}

/**
 * 属性名と値が安全か判定する（on* 属性・srcdoc・style・javascript:/vbscript: URL を拒否）。
 * @param name 属性名
 * @param value 属性値
 * @returns 安全なら true
 */
export function isSafeAttribute(name: string, value: string): boolean { // audit-ignore: fnlog-missing 属性ごとに呼ぶ純粋な判定ヘルパー
  const lower = name.trim().toLowerCase();
  if (lower.length === 0 || lower.startsWith('on') || BLOCKED_ATTRIBUTES.has(lower)) return false;
  return !DANGEROUS_URL.test(value.replace(URL_NOISE, ''));
}

/**
 * 拒否した属性を warn で記録する（値はログに出さない）。
 * @param name 属性名
 * @sideEffect warn ログを1件残す
 */
function rejectAttribute(name: string): void {
  const log = logger.fn('rejectAttribute', { name });
  log.warn('安全でない属性を拒否しました（SEC-14）', { name });
  log.exit(undefined);
}

/**
 * data-* 属性を設定する。
 * @param el 対象要素
 * @param dataset キーと値
 * @sideEffect el.dataset を変更する
 */
function applyDataset(el: HTMLElement, dataset: NonNullable<HOptions['dataset']>): void { // audit-ignore: fnlog-missing h() から要素ごとに呼ぶ内部ヘルパー
  for (const [key, value] of Object.entries(dataset)) {
    if (value !== undefined) el.dataset[key] = String(value);
  }
}

/**
 * CSSOM でスタイルを設定する（style 属性を使わないので CSP に違反しない）。
 * @param el 対象要素
 * @param style CSS プロパティ名（ケバブケース）と値
 * @sideEffect el.style を変更する
 */
function applyStyle(el: HTMLElement, style: NonNullable<HOptions['style']>): void { // audit-ignore: fnlog-missing h() から要素ごとに呼ぶ内部ヘルパー
  for (const [prop, value] of Object.entries(style)) {
    if (value !== undefined) el.style.setProperty(prop, value);
  }
}

/**
 * イベントハンドラを登録する。
 * @param el 対象要素
 * @param handlers イベント名とハンドラ
 * @sideEffect el にイベントリスナを登録する
 */
function applyHandlers(el: HTMLElement, handlers: EventHandlers): void { // audit-ignore: fnlog-missing h() から要素ごとに呼ぶ内部ヘルパー
  for (const [type, handler] of Object.entries(handlers)) {
    if (typeof handler === 'function') el.addEventListener(type, handler as EventListener);
  }
}

/**
 * 子要素を追加する（文字列・数値はテキストノード、falsy は無視）。
 * @param el 親要素
 * @param children 子要素
 * @sideEffect el に子ノードを追加する
 */
export function appendChildren(el: Element, children: readonly Child[]): void { // audit-ignore: fnlog-missing h() から要素ごとに呼ぶ内部ヘルパー
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    el.append(typeof child === 'number' ? String(child) : child);
  }
}

/**
 * 要素の子をすべて取り除く。
 * @param el 対象要素
 * @sideEffect el の子ノードをすべて削除する
 */
export function clear(el: Element): void {
  el.replaceChildren();
}

/**
 * CSSOM で1つのスタイルを設定する（CSP 準拠。canvas サイズや色の動的変更用）。
 * @param el 対象要素
 * @param prop CSS プロパティ名（ケバブケース・カスタムプロパティ可）
 * @param value 値（undefined なら削除）
 * @sideEffect el.style を変更する
 */
export function setStyle(el: HTMLElement, prop: string, value: string | undefined): void { // audit-ignore: fnlog-missing 毎フレーム描画（長押しの輪・canvas サイズ更新で頻繁に呼ぶ DOM ヘルパー）
  if (value === undefined) el.style.removeProperty(prop);
  else el.style.setProperty(prop, value);
}
