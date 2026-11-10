/**
 * @file 開始画面（presentation/screens/Launch。アプリを開いたときに一度だけ出す全画面の重ね層。ゲームのタイトル画面の作り）
 * 1. 起動スプラッシュ（index.html の静的な1枚）と同じ絵から始め、経過時間をそろえて続きから動かす（つなぎ目を見せない）
 * 2. 旅人の状態（ランク・町・再訪理由・アバター・時刻）を読み込む（失敗しても一般的な内容で進む）。終わるとゲージが 100% になり、ロゴが光を溜める
 * 3. 閃光 → ピンの頭から円が広がって街が現れる → ロゴがタイトルへ飛び、タイトルが叩きつけられる（火花・画面の揺れ・回る光）
 *    地区の建物が伸び、ピンが落ち、自分のアバターが歩いてくる
 *    主役は大きなタイトル（ロゴ・地名・アプリ名・ひとこと）。下は TODAY の細い帯・スタート・名札（呼び名とランク）だけ。
 *    ステータスのパネルや数え上げは置かない（結果発表の画面に見えるため。2026-11-10 ユーザー指示）
 * 4. 「スタート」。どこをタップしても始まる（ボタンが出るまでのタップは早送り）。Esc でも閉じる
 * 文字は最小限（説明文・ヒント・手順は出さない）。下の画面（ルーター）は裏で先に表示し、閉じるまで inert（操作・読み上げの対象外）。
 * 動きを減らす設定（prefers-reduced-motion）では、最後の1枚を静止画で出す。
 * 基準: C（再訪動機。通いの積み上げと今日の行く理由を最初に見せる）、B（未訪問の地区を「？」で見せる）。
 */
import { prefersReducedMotion } from '@/Common/ui/a11y/reducedMotion';
import '@/presentation/screens/Launch/Launch.css';
import type { AppServices } from '@/application/AppServices';
import { APP_VERSION } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { createCanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import type { CanvasSize, CanvasSurface } from '@/Common/ui/canvas/CanvasBase';
import { h, setStyle } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import { avatarLookOfParts } from '@/presentation/shared/avatar/avatarLook';
import { avatarSpriteFor } from '@/presentation/shared/avatarSprite';
import type { AvatarLook, AvatarSprite } from '@/presentation/shared/avatarSprite';
import { createLaunchLogo } from '@/presentation/screens/Launch/launchLogo';
import { buildLaunchModel, launchModeOf } from '@/presentation/screens/Launch/launchModel';
import type { LaunchInput, LaunchModel } from '@/presentation/screens/Launch/launchModel';
import { drawLaunchScene, planLaunchScene, SCENE_TIMING, sceneLayoutOf } from '@/presentation/screens/Launch/launchScene';
import type { ScenePlan } from '@/presentation/screens/Launch/launchScene';

const logger = createLogger('presentation/screens/Launch/LaunchScreen');

/** スプラッシュを最低これだけ見せる（ms。ロゴ・アプリ名・ゲージの入場が終わるまで） */
const MIN_SPLASH_MS = 1500;
/** ゲージが 100% になってロゴが光を溜める時間（ms。splash.css の .splash__stage--done と同じ） */
const CHARGE_MS = 380;
/** 読み込みを待つ上限（ms。超えたら取れた分だけで進む） */
const LOAD_TIMEOUT_MS = 2500;
/** ロゴがタイトルへ飛ぶ時間（ms） */
const FLY_MS = 900;
/** 円が広がる時間（ms。Launch.css の clip-path の transition と同じ） */
const OPEN_MS = 820;
/** 閉じる動きの時間（ms。Launch.css の .launch--leaving と同じ） */
const LEAVE_MS = 480;
/** 開いてから START が見えるまで（ms。Launch.css の .launch__start の入場と合わせる）。これ以降のタップは早送りでなく「はじめる」 */
const UI_READY_MS = 2000;
/** 早送り・静止画で使う「入場がすべて終わった」時刻（ms） */
const SETTLED_T = SCENE_TIMING.settled + 200;
/** アバターの大きさ（1 で高さ約 70px） */
const AVATAR_SCALE = 0.72;
/** アプリ名（1文字ずつ光らせる） */
const APP_NAME = 'まちクエ';
/** アプリの一言（スプラッシュと同じ） */
const TAGLINE = 'この街が、クエストになる。';
/** タイトルが叩きつけられたときの火花の本数 */
const SPARK_COUNT = 12;

/** 再訪理由の種別ごとのアイコン */
const REASON_ICONS: Readonly<Record<string, IconName>> = { deadline: 'ticket', reclaim: 'crown', fade: 'fade', unvisited: 'compass', new: 'sparkle' };

/** 開始画面の操作口 */
export interface LaunchHandle {
  readonly element: HTMLElement;
  /** 閉じ終わったら解決する */
  readonly done: Promise<void>;
  /** すぐに閉じる */
  dismiss(): void;
}

/** 開始画面の段階 */
type Phase = 'splash' | 'opening' | 'ready' | 'leaving' | 'gone';

/**
 * 開始画面を出すかを、いまの URL とブラウザから決める（?launch=0 で出さない、自動操作のブラウザでは出さない）。
 * @returns 出すなら true
 */
export function shouldShowLaunch(): boolean {
  const log = logger.fn('shouldShowLaunch');
  if (typeof window === 'undefined') return log.exit(false, 'DOM なし');
  return log.exit(launchModeOf({ search: window.location.search, webdriver: window.navigator.webdriver === true }) === 'show');
}

/**
 * 静的スプラッシュが出てからの経過時間を返す（最初の描画の時刻から。スプラッシュが無ければ 0＝最初から動かす）。
 * @returns 経過（ms）
 */
function splashElapsedMs(): number {
  const log = logger.fn('splashElapsedMs');
  if (document.querySelector('[data-testid="splash"]') === null) return log.exit(0, '静的スプラッシュなし');
  const paints = typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('paint') : [];
  const first = paints.find((e) => e.name === 'first-contentful-paint') ?? paints.find((e) => e.name === 'first-paint');
  return log.exit(Math.max(0, performance.now() - (first?.startTime ?? 0)));
}

/**
 * 結果（Result）を待ち、成功なら値・失敗や例外なら undefined を返す（開始画面は取れた分だけで出す）。
 * @param run ユースケースの呼び出し
 * @returns 値または undefined
 */
async function valueOrUndefined<T>(run: () => Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }>): Promise<T | undefined> {
  const log = logger.fn('valueOrUndefined');
  try {
    const result = await run();
    return log.exit(result.ok ? result.value : undefined);
  } catch (error) {
    log.warn('開始画面の読み込みで例外', { message: error instanceof Error ? error.message : 'unknown' });
    return log.exit(undefined);
  }
}

/**
 * 開始画面に出す内容を読み込む（ステータス・ランク・町・再訪理由・アバターの装いを並行して）。
 * @param services アプリのサービス
 * @returns 入力と装い（身につけている部品ID）
 */
async function loadLaunchData(services: AppServices): Promise<{ readonly input: LaunchInput; readonly outfit: readonly string[] }> {
  const log = logger.fn('loadLaunchData');
  const [status, rank, town, reasons, closet] = await Promise.all([
    valueOrUndefined(() => services.status.execute()),
    valueOrUndefined(() => services.rankStatus.execute()),
    valueOrUndefined(() => services.town.execute()),
    valueOrUndefined(() => services.reasons.execute()),
    valueOrUndefined(() => services.avatar.execute()),
  ]);
  return log.exit({ input: { status, rank, town, reasons }, outfit: closet?.outfit ?? [] });
}

/**
 * 待つ（上限つきの読み込み・最低表示時間に使う）。
 * @param ms 待つ時間
 * @returns 待ち終わったら解決する
 */
function wait(ms: number): Promise<void> {
  const log = logger.fn('wait', { ms });
  return log.exit(new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms))));
}

/**
 * 子要素を n 個並べる（飾りの粒用）。
 * @param tag 要素名
 * @param n 個数
 * @param className 付けるクラス（省略可）
 * @returns 要素の配列（--k に番号）
 */
function repeatEl(tag: 'i' | 'span', n: number, className?: string): HTMLElement[] {
  const log = logger.fn('repeatEl', { n });
  return log.exit(Array.from({ length: n }, (_, k) => h(tag, { class: className, style: { '--k': String(k) } })));
}

/**
 * スプラッシュと同じ1枚（青い地・回る光・きらめき・ロゴ・地名・アプリ名・ひとこと・NOW LOADING のゲージ）を作る。index.html と同じ構造。
 * @returns ステージとロゴ
 */
function buildStage(): { readonly stage: HTMLElement; readonly logo: SVGSVGElement } {
  const log = logger.fn('buildStage');
  const logo = createLaunchLogo();
  const emblem = h('div', { class: 'splash__emblem' }, [h('span', { class: 'splash__rays' }), h('span', { class: 'splash__ring' }), h('span', { class: 'splash__ring' })]);
  emblem.append(logo);
  const stage = h('div', { class: 'splash__stage launch__splash', attrs: { 'aria-hidden': 'true' } }, [
    h('div', { class: 'splash__sparks' }, [h('i'), h('i'), h('i'), h('i'), h('i'), h('i')]),
    emblem,
    h('p', { class: 'splash__place', text: '南森町' }),
    h('p', { class: 'splash__name' }, [...APP_NAME].map((c) => h('span', { text: c }))),
    h('p', { class: 'splash__tagline', text: 'この街が、クエストになる。' }),
    h('div', { class: 'splash__gauge' }, [
      h('span', { class: 'splash__gauge-label', text: 'NOW LOADING' }),
      h('span', { class: 'splash__gauge-pct' }),
      h('span', { class: 'splash__gauge-bar' }, [h('span', { class: 'splash__gauge-fill' })]),
    ]),
  ]);
  return log.exit({ stage, logo });
}

/**
 * タイトル（回る光・ロゴの着地点・地名・光沢のアプリ名・ひとこと・火花）を作る。画面の主役なので、ロゴを上にして縦に大きく積む。
 * アプリ名は1文字ずつ「白いふち（::before）＋光沢のグラデーション＋走る光」の3層にする。
 * @returns タイトルとロゴの着地点
 */
function buildBrand(): { readonly brand: HTMLElement; readonly slot: HTMLElement } {
  const log = logger.fn('buildBrand');
  const slot = h('div', { class: 'launch__slot' });
  const title = h(
    'h1',
    { class: 'launch__title', attrs: { id: 'launch-title', 'aria-label': APP_NAME } },
    [...APP_NAME].map((c, i) => h('span', { class: 'launch__char', style: { '--i': String(i) }, attrs: { 'aria-hidden': 'true' } }, [
      h('span', { class: 'launch__char-in', dataset: { c } }, [h('span', { class: 'launch__char-fill', text: c })]),
    ])),
  );
  const brand = h('header', { class: 'launch__brand' }, [
    h('span', { class: 'launch__rays', attrs: { 'aria-hidden': 'true' } }),
    h('div', { class: 'launch__lockup' }, [slot, h('div', { class: 'launch__name' }, [h('span', { class: 'launch__place', text: '南森町' }), title, h('p', { class: 'launch__tagline', text: TAGLINE })])]),
    h('span', { class: 'launch__burst', attrs: { 'aria-hidden': 'true' } }, repeatEl('i', SPARK_COUNT)),
    h('span', { class: 'launch__glints', attrs: { 'aria-hidden': 'true' } }, repeatEl('i', 5)),
  ]);
  return log.exit({ brand, slot });
}

/**
 * 名札（呼び名・ランク・領主をつとめる地区の数）を作る。セーブデータの1行として下に小さく置く。
 * はじめての人・ランクが取れなかったときは出さない。
 * @param model 開始画面の内容
 * @returns 名札。出さないなら undefined
 */
function buildPlate(model: LaunchModel): HTMLElement | undefined {
  const log = logger.fn('buildPlate', { isFirst: model.isFirst });
  const rank = model.chips.find((chip) => chip.icon === 'rank');
  if (model.isFirst || rank === undefined) return log.exit(undefined, '名札なし');
  const lord = model.lordCount > 0 ? ` 地区の領主 ${model.lordCount}` : '';
  return log.exit(h('p', { class: 'launch__plate', attrs: { 'aria-label': `${model.headline} ${rank.value}${lord}` } }, [
    h('span', { class: 'launch__plate-icon', attrs: { 'aria-hidden': 'true' } }, [createIcon('rank')]),
    h('span', { class: 'launch__plate-name', attrs: { 'aria-hidden': 'true' }, text: model.headline }),
    h('span', { class: 'launch__plate-rank', attrs: { 'aria-hidden': 'true' }, text: rank.value }),
    model.lordCount > 0 ? h('span', { class: 'launch__plate-lord', attrs: { 'aria-hidden': 'true' } }, [createIcon('crown'), h('span', { text: `×${model.lordCount}` })]) : undefined,
  ]));
}

/**
 * TODAY の帯（いちばん強い再訪理由1件）を作る。
 * @param model 開始画面の内容
 * @returns 帯。理由が無ければ undefined
 */
function buildReason(model: LaunchModel): HTMLElement | undefined {
  const log = logger.fn('buildReason', { hasReason: model.reason !== undefined });
  if (model.reason === undefined) return log.exit(undefined, '理由なし');
  return log.exit(h('div', { class: 'launch__reason', dataset: { kind: model.reason.kind } }, [
    h('span', { class: 'launch__reason-tag', text: 'TODAY' }),
    h('span', { class: 'launch__reason-icon', attrs: { 'aria-hidden': 'true' } }, [createIcon(REASON_ICONS[model.reason.kind] ?? 'sparkle')]),
    h('span', { class: 'launch__reason-title', attrs: { 'aria-label': `${model.reason.label} ${model.reason.title}` }, text: model.reason.title }),
  ]));
}

/**
 * スプラッシュの1枚の動きを、静的スプラッシュが出た時刻にそろえる（どの動きも「その時刻に始まった」ことにする）。
 * CSS の動きは要素が最初に描かれたときに始まるため、下の画面の準備で最初のフレームが遅れると、そのままでは入場をやり直して見える。
 * @param stage スプラッシュの1枚
 * @param origin 静的スプラッシュが出た時刻（performance.now の基準＝document.timeline と同じ）
 * @sideEffect stage 以下の CSS アニメーションの startTime を書き換える
 */
function syncSplashClock(stage: HTMLElement, origin: number): void {
  const log = logger.fn('syncSplashClock');
  if (typeof stage.getAnimations !== 'function') return log.exit(undefined, 'Web Animations なし');
  const animations = stage.getAnimations({ subtree: true });
  for (const animation of animations) animation.startTime = origin;
  log.exit(undefined, `${animations.length} 件`);
}

/**
 * phone の中の、開始画面以外の子要素を inert にする（閉じたら元に戻す関数を返す）。
 * @param phone スマホ枠
 * @param overlay 開始画面
 * @returns 元に戻す関数
 * @sideEffect 子要素の inert を書き換える
 */
function makeSiblingsInert(phone: HTMLElement, overlay: HTMLElement): () => void {
  const log = logger.fn('makeSiblingsInert');
  const changed: HTMLElement[] = [];
  for (const child of Array.from(phone.children)) {
    if (child === overlay || !(child instanceof HTMLElement) || child.inert) continue;
    child.inert = true;
    changed.push(child);
  }
  return log.exit(() => {
    for (const el of changed) el.inert = false;
  });
}

/** 街の場面の DOM 部品 */
interface SceneParts {
  readonly scene: HTMLElement;
  readonly art: HTMLElement;
  readonly brand: HTMLElement;
  readonly slot: HTMLElement;
  /** 下の帯（TODAY の帯・スタート・名札）。街並みの地面はこの上端に合わせる */
  readonly foot: HTMLElement;
  readonly cta: HTMLButtonElement;
}

/**
 * 街の場面（絵の入れ物・四隅の影・タイトル・下の帯＝TODAY の帯／スタート／名札・版）を作る。
 * @param model 開始画面の内容
 * @returns 部品
 */
function buildScene(model: LaunchModel): SceneParts {
  const log = logger.fn('buildScene');
  const art = h('div', { class: 'launch__art' });
  const { brand, slot } = buildBrand();
  const cta = h('button', { class: 'launch__start', attrs: { type: 'button', 'data-testid': 'launch-start', 'aria-label': model.cta } }, [
    h('span', { class: 'launch__start-label', attrs: { 'aria-hidden': 'true' }, text: 'スタート' }),
  ]);
  const foot = h('div', { class: 'launch__foot' }, [buildReason(model), cta, buildPlate(model)]);
  const ui = h('div', { class: 'launch__ui' }, [
    brand,
    h('div', { class: 'launch__spacer' }),
    foot,
    h('span', { class: 'launch__version', attrs: { 'aria-hidden': 'true' }, text: `Ver.${APP_VERSION}` }),
  ]);
  const scene = h('div', { class: 'launch__scene' }, [art, h('div', { class: 'launch__vignette' }), ui]);
  return log.exit({ scene, art, brand, slot, foot, cta });
}

/** 飛ぶロゴが途中で上へふくらむ高さ（px） */
const FLY_ARC_PX = 40;

/**
 * タイトルの着地点にロゴを置く（飛び終えたとき・静止画のとき）。
 * @param slot 着地点
 * @sideEffect slot の中身を差し替える
 */
function landLogo(slot: HTMLElement): void {
  const log = logger.fn('landLogo');
  slot.replaceChildren(createLaunchLogo('launch__mark'));
  log.exit(undefined);
}

/**
 * ロゴをタイトルの位置へ飛ばし、ピンの頭から円を広げて街を見せる。
 * @param overlay 開始画面
 * @param parts 街の場面
 * @param logo スプラッシュのロゴ
 * @param reduced 動きを減らす
 * @returns ロゴが飛ぶ動き（静止画・動かせない環境では undefined）
 * @sideEffect クラス・CSS 変数を変え、飛ぶロゴを一時的に足す
 */
function revealScene(overlay: HTMLElement, parts: SceneParts, logo: SVGSVGElement, reduced: boolean): Animation | undefined {
  const log = logger.fn('revealScene', { reduced });
  overlay.classList.remove('launch--splash');
  const box = overlay.getBoundingClientRect();
  const from = logo.getBoundingClientRect();
  const to = parts.slot.getBoundingClientRect();
  if (reduced || typeof logo.animate !== 'function' || from.width <= 0) {
    overlay.classList.add('launch--open', 'launch--opened');
    landLogo(parts.slot);
    return log.exit(undefined, '静止画');
  }
  const cx = from.left - box.left + from.width / 2;
  const cy = from.top - box.top + from.height * (50 / 120);
  setStyle(overlay, '--rx', `${cx.toFixed(1)}px`);
  setStyle(overlay, '--ry', `${cy.toFixed(1)}px`);
  setStyle(overlay, '--rr', `${Math.ceil(Math.hypot(Math.max(cx, box.width - cx), Math.max(cy, box.height - cy)) + 8)}px`);
  const fly = h('div', { class: 'launch__fly', attrs: { 'aria-hidden': 'true' } }, [createLaunchLogo()]);
  setStyle(fly, 'left', `${(from.left - box.left).toFixed(1)}px`);
  setStyle(fly, 'top', `${(from.top - box.top).toFixed(1)}px`);
  setStyle(fly, 'width', `${from.width.toFixed(1)}px`);
  setStyle(fly, 'height', `${from.height.toFixed(1)}px`);
  overlay.append(fly);
  logo.style.setProperty('visibility', 'hidden');
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const s = to.width / from.width;
  const flight = fly.animate(
    [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
      { transform: `translate(${(dx * 0.35).toFixed(1)}px, ${(dy * 0.35 - FLY_ARC_PX).toFixed(1)}px) scale(${((1 + s) / 2 * 1.12).toFixed(3)}) rotate(-8deg)`, offset: 0.45 },
      { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(0deg)` },
    ],
    { duration: FLY_MS, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' },
  );
  flight.onfinish = (): void => {
    landLogo(parts.slot);
    fly.remove();
  };
  void parts.scene.offsetWidth;
  overlay.classList.add('launch--open');
  window.setTimeout(() => overlay.classList.add('launch--opened'), OPEN_MS + 40);
  return log.exit(flight);
}

/**
 * 開始画面の進行役（スプラッシュ → 読み込み → 開く → 入場 → タップを待つ → 閉じる）。
 */
class LaunchController implements LaunchHandle {
  readonly element: HTMLElement;
  readonly done: Promise<void>;
  private readonly reduced: boolean;
  private readonly stage: HTMLElement;
  private readonly logo: SVGSVGElement;
  /** 静的スプラッシュが出た時刻（performance.now の基準） */
  private readonly startedAt: number;
  private readonly restoreInert: () => void;
  private phase: Phase = 'splash';
  /** スプラッシュ中にタップされた（開いたらすぐ早送りする） */
  private skipRequested = false;
  private resolveDone: () => void = () => undefined;
  private scene: LaunchSceneLoop | undefined;
  private flight: Animation | undefined;
  /** 街の場面を開いた時刻（performance.now の基準） */
  private openedAt = 0;

  /**
   * スプラッシュと同じ1枚を phone に重ね、読み込みを始める。
   * @param phone スマホ枠（まだ文書に入っていなくてよい）
   * @param services アプリのサービス（読み取りだけに使う）
   * @sideEffect phone に要素を足し、ほかの子要素を inert にする
   */
  constructor(phone: HTMLElement, services: AppServices) {
    const log = logger.fn('constructor');
    this.reduced = prefersReducedMotion();
    const { stage, logo } = buildStage();
    this.startedAt = performance.now() - splashElapsedMs();
    this.stage = stage;
    this.logo = logo;
    this.element = h('div', {
      class: 'launch launch--splash',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'launch-title', tabindex: -1, 'data-testid': 'launch' },
      on: { click: (): void => this.onTap(), keydown: (event): void => this.onKey(event) },
    }, [stage]);
    this.done = new Promise<void>((resolve) => {
      this.resolveDone = resolve;
    });
    phone.append(this.element);
    this.restoreInert = makeSiblingsInert(phone, this.element);
    window.requestAnimationFrame(() => syncSplashClock(stage, this.startedAt));
    void this.open(services);
    log.exit(undefined);
  }

  /**
   * タップ（クリック）: スプラッシュ中は早送りの予約、ボタンが見えるまでは早送り、見えた後は閉じる。
   * @sideEffect 段階に応じて settle / dismiss を呼ぶ
   */
  private onTap(): void {
    const log = logger.fn('onTap', { phase: this.phase });
    if (this.phase === 'splash') this.skipRequested = true;
    else if (this.phase === 'opening' && performance.now() - this.openedAt < UI_READY_MS) this.settle();
    else if (this.phase === 'opening' || this.phase === 'ready') this.dismiss();
    log.exit(undefined);
  }

  /**
   * キー操作: Esc で閉じる。開始画面そのものにフォーカスがあるときの Enter・Space はタップと同じ（ボタン上ではボタン自身が受ける）。
   * @param event キーボードイベント
   * @sideEffect dismiss / onTap を呼ぶ
   */
  private onKey(event: KeyboardEvent): void {
    const log = logger.fn('onKey', { key: event.key });
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dismiss();
    } else if ((event.key === 'Enter' || event.key === ' ') && event.target === this.element) {
      event.preventDefault();
      this.onTap();
    }
    log.exit(undefined);
  }

  /**
   * 読み込みとスプラッシュの最低表示を待ってから、街の場面を作って開く。
   * @param services アプリのサービス
   * @sideEffect 場面の DOM・canvas を足し、開く動きを始める
   */
  private async open(services: AppServices): Promise<void> {
    const log = logger.fn('open');
    const loaded = await Promise.race([loadLaunchData(services), wait(LOAD_TIMEOUT_MS).then(() => undefined)]);
    await wait(this.reduced ? 0 : MIN_SPLASH_MS - (performance.now() - this.startedAt));
    if (this.phase !== 'splash') return log.exit(undefined, '閉じ済み');
    if (!this.reduced) {
      this.stage.classList.add('splash__stage--done');
      await wait(CHARGE_MS);
      if (this.phase !== 'splash') return log.exit(undefined, '閉じ済み');
    }
    const model = buildLaunchModel(loaded?.input ?? {});
    const parts = buildScene(model);
    parts.cta.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onTap();
    });
    this.element.dataset.sky = model.sky;
    this.element.append(parts.scene);
    this.scene = new LaunchSceneLoop(parts, model, loaded?.outfit ?? [], this.reduced, () => this.onSceneSettled());
    this.phase = 'opening';
    this.openedAt = performance.now();
    this.element.focus({ preventScroll: true });
    this.flight = revealScene(this.element, parts, this.logo, this.reduced);
    if (this.reduced || this.skipRequested) this.settle();
    log.info('開始画面を開きました', { sky: model.sky, isFirst: model.isFirst, timedOut: loaded === undefined });
    return log.exit(undefined);
  }

  /**
   * 絵の入場が終わったとき: 待つ段階にする（フォーカスは開始画面のまま。Tab でボタンへ進める）。
   * @sideEffect 段階を変える
   */
  private onSceneSettled(): void {
    const log = logger.fn('onSceneSettled', { phase: this.phase });
    if (this.phase !== 'opening') return log.exit(undefined);
    this.phase = 'ready';
    log.exit(undefined);
  }

  /**
   * 入場をすべて終えた状態にする（早送り）。
   * @sideEffect CSS の遅れをずらし、ロゴを着地させ、絵の時刻を進める
   */
  settle(): void {
    const log = logger.fn('settle', { phase: this.phase });
    if (this.phase !== 'opening') return log.exit(undefined, '入場中ではない');
    this.phase = 'ready';
    setStyle(this.element, '--launch-shift', '-20000ms');
    this.element.classList.add('launch--opened');
    this.flight?.finish();
    this.scene?.settle();
    this.openedAt = Math.min(this.openedAt, performance.now() - UI_READY_MS);
    log.exit(undefined);
  }

  /**
   * 閉じる（フェードして消え、下の画面を操作できるようにする）。
   * @sideEffect inert を戻し、少し後に要素を消して絵の更新を止める
   */
  dismiss(): void {
    const log = logger.fn('dismiss', { phase: this.phase });
    if (this.phase === 'leaving' || this.phase === 'gone') return log.exit(undefined, '閉じ済み');
    this.phase = 'leaving';
    this.element.classList.add('launch--leaving');
    this.restoreInert();
    window.setTimeout(() => this.remove(), this.reduced ? 0 : LEAVE_MS);
    log.info('開始画面を閉じました');
    log.exit(undefined);
  }

  /**
   * 要素を消して後始末をする。
   * @sideEffect 絵の更新を止め、要素を消し、done を解決する
   */
  private remove(): void {
    const log = logger.fn('remove');
    this.phase = 'gone';
    this.scene?.stop();
    this.element.remove();
    this.resolveDone();
    log.exit(undefined);
  }
}

/**
 * 開始画面を phone に重ねて出す。phone がまだ文書に入っていなくてよい（寸法を測るのは読み込みの後）。
 * @param phone スマホ枠（App のシェル）
 * @param services アプリのサービス（読み取りだけに使う）
 * @returns 操作口
 * @sideEffect phone に要素を足し、ほかの子要素を閉じるまで inert にする。閉じると要素を消す
 */
export function mountLaunchScreen(phone: HTMLElement, services: AppServices): LaunchHandle {
  const log = logger.fn('mountLaunchScreen');
  return log.exit(new LaunchController(phone, services));
}

/**
 * 街の絵を描き続ける係（大きさ・タイトル・下の帯の位置が変わったら計画を作り直す）。
 */
class LaunchSceneLoop {
  private readonly parts: SceneParts;
  private readonly model: LaunchModel;
  private readonly look: AvatarLook;
  private readonly reduced: boolean;
  private readonly onSettled: () => void;
  private readonly origin = performance.now();
  private readonly surface: CanvasSurface | undefined;
  private readonly observer: ResizeObserver | undefined;
  /** 早送りで足す時間（ms） */
  private shift: number;
  private plan: ScenePlan | undefined;
  private avatar: AvatarSprite | undefined;
  private frameId: number | undefined;
  private stopped = false;
  private settledCalled = false;

  /**
   * canvas を足して描きはじめる。
   * @param parts 街の場面
   * @param model 開始画面の内容
   * @param outfit アバターの装い（部品ID）
   * @param reduced 動きを減らす（最後の1枚だけ描く）
   * @param onSettled 入場が終わったときに呼ぶ
   * @sideEffect canvas を足し、requestAnimationFrame・ResizeObserver を登録する
   */
  constructor(parts: SceneParts, model: LaunchModel, outfit: readonly string[], reduced: boolean, onSettled: () => void) {
    const log = logger.fn('constructor', { reduced, districts: model.districts.length });
    this.parts = parts;
    this.model = model;
    this.reduced = reduced;
    this.onSettled = onSettled;
    this.shift = reduced ? SETTLED_T : 0;
    this.look = avatarLookOfParts(outfit);
    this.surface = createCanvasSurface(parts.art, { ariaLabel: 'あなたの街の絵', testId: 'launch-canvas', onResize: (size): void => this.layout(size) });
    this.observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
      if (this.surface !== undefined) this.layout(this.surface.size());
    });
    this.observer?.observe(parts.foot);
    this.observer?.observe(parts.brand);
    if (this.surface !== undefined) this.layout(this.surface.size());
    if (!reduced) this.frameId = window.requestAnimationFrame(this.onFrame);
    log.exit(undefined);
  }

  /**
   * 開きはじめからの経過（早送りの分を含む）。
   * @returns 経過（ms）
   */
  private time(): number { // audit-ignore: fnlog-missing 毎フレーム呼ぶ時刻の計算
    return performance.now() - this.origin + this.shift;
  }

  /**
   * 割り付けと計画を作り直して描く（タイトルの下端・下の帯の上端に合わせる）。
   * @param size canvas の大きさ
   * @sideEffect 計画・アバター画像を作り直し、1フレーム描く
   */
  private layout(size: CanvasSize): void {
    const log = logger.fn('layout', { width: size.width, height: size.height });
    const bounds = { titleBottom: this.parts.brand.offsetTop + this.parts.brand.offsetHeight, cardTop: this.parts.foot.offsetTop };
    this.plan = planLaunchScene(this.model.districts, this.model.sky, sceneLayoutOf(size, bounds));
    this.avatar = avatarSpriteFor(this.look, { scale: AVATAR_SCALE, dotPx: 2, dpr: size.dpr });
    this.draw();
    log.exit(undefined);
  }

  /**
   * いまの時刻の絵を1枚描く。
   * @sideEffect canvas に描画する
   */
  private draw(): void { // audit-ignore: fnlog-missing 毎フレーム描画
    if (this.surface === undefined || this.plan === undefined) return;
    drawLaunchScene(this.surface.ctx, this.surface.size(), this.plan, { t: this.time(), avatar: this.avatar });
  }

  /**
   * 1フレーム描いて次を予約する。入場が終わったら一度だけ知らせる。
   * @sideEffect canvas に描画し、次のフレームを予約する
   */
  private readonly onFrame = (): void => { // audit-ignore: fnlog-missing 毎フレーム描画
    if (this.stopped) return;
    this.draw();
    if (!this.settledCalled && this.time() >= SCENE_TIMING.settled) {
      this.settledCalled = true;
      this.onSettled();
    }
    this.frameId = window.requestAnimationFrame(this.onFrame);
  };

  /**
   * 入場を終えた時刻へ進める（早送り）。
   * @sideEffect 時刻をずらして1フレーム描く
   */
  settle(): void {
    const log = logger.fn('settle', { reduced: this.reduced });
    this.shift = Math.max(this.shift, SETTLED_T - (performance.now() - this.origin));
    this.settledCalled = true;
    this.draw();
    log.exit(undefined);
  }

  /**
   * 描くのをやめて canvas を消す。
   * @sideEffect requestAnimationFrame・ResizeObserver を止め、canvas を消す
   */
  stop(): void {
    const log = logger.fn('stop');
    this.stopped = true;
    if (this.frameId !== undefined) window.cancelAnimationFrame(this.frameId);
    this.observer?.disconnect();
    this.surface?.destroy();
    log.exit(undefined);
  }
}
