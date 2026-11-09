/**
 * @file 店舗CMS の左側に出す「見え方」（presentation/cms 層）
 * 利用者アプリのお店のページ（スポット詳細）を、アプリと同じ部品（createSpotInfo・createCouponEventList・createSpotIllustration）で
 * スマホ枠の中に描く。入力に合わせて中身だけを描き直す（絵は最初の1回だけ描く）。
 * クーポン・イベントの画面では「お店のページ｜地図」を切り替え、地図には地図のお知らせ（アプリの createRevisitReasonCard）を出す。
 * 入力中の欄に対応する部分を破線で囲み、そこまでスクロールする。スマホ幅ではシートとして開く（閉じるボタンつき）。
 * 枠は実機と同じ幅 375px で等倍に描く（縮小しない）。地図はアプリの色の表（PALETTE）で描いた見本。
 */
import '@/presentation/screens/Spot/SpotDetailScreen.css';
import type { CmsShopEventDto, CmsShopInfoDto } from '@/application/dto/CmsDto';
import type { ShopEventDto, SpotDetailDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { compareLocalDate, daysBetween, parseLocalDate } from '@/Common/utils/date';
import { createRevisitReasonCard } from '@/Common/ui/cards/RevisitReasonCard';
import { h } from '@/Common/ui/dom';
import { DISPLAY_FONT_FAMILY, PALETTE } from '@/Common/ui/theme/palette';
import { createTopBar } from '@/Common/ui/TopBar';
import { icon } from '@/presentation/cms/cmsUi';
import { createCouponEventList } from '@/presentation/screens/Spot/CouponEventList';
import { createSpotIllustration } from '@/presentation/screens/Spot/SpotIllustrationCanvas';
import type { SpotIllustrationHandle } from '@/presentation/screens/Spot/SpotIllustrationCanvas';
import { createSpotInfo } from '@/presentation/screens/Spot/SpotInfo';

const logger = createLogger('presentation/cms/cmsPhonePreview');

/** SVG の名前空間 */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 入力中の欄に対応する、お店のページの部分 */
export type PreviewTarget = 'hours' | 'amenities' | 'events';

/** 対応する部分の選び方 */
const TARGET_SELECTORS: Readonly<Record<PreviewTarget, string>> = {
  hours: '.spot-facts',
  amenities: '.spot-amenities',
  events: '[data-testid="shop-events"]',
};

/** 見え方の種類 */
export type PreviewMode = 'page' | 'map';

/** プレビューに出すクーポン・イベント（期間と中身） */
export interface PreviewEvent {
  readonly id: string;
  readonly kind: 'coupon' | 'event';
  readonly title: string;
  readonly description: string;
  readonly start: string;
  readonly end: string;
  /** 入力前の例文を出しているか（薄い色で出す） */
  readonly placeholder?: boolean;
}

/** 地図のお知らせの中身 */
export interface PreviewNotice {
  readonly title: string;
  readonly subtitle: string;
}

/** 描き直すときの中身 */
export interface PreviewContent {
  readonly hours: string;
  readonly amenities: readonly string[];
  readonly events: readonly PreviewEvent[];
  /** 地図のお知らせ（無ければ地図にカードを出さない） */
  readonly notice?: PreviewNotice;
}

/** 見え方の列の操作 */
export interface PreviewColumnHandle {
  readonly element: HTMLElement;
  /**
   * 中身を描き直す。
   * @param content 営業時間・便利情報・クーポン・お知らせ
   */
  update(content: PreviewContent): void;
  /**
   * 枠の下の1行を変える（空文字で消す）。
   * @param text 16字以内
   */
  setCaption(text: string): void;
  /**
   * 入力中の欄に対応する部分を囲み、そこまで枠の中を動かす（undefined で外す）。
   * @param target 対応する部分
   * @param opts outline: 破線で囲むか（既定 true。false なら動かすだけ）
   */
  highlight(target: PreviewTarget | undefined, opts?: { readonly outline?: boolean }): void;
  /**
   * お店のページ／地図を切り替える。
   * @param mode 見え方の種類
   */
  setMode(mode: PreviewMode): void;
}

/** 見え方の列の作り方 */
export interface PreviewColumnOptions {
  /** 「お店のページ｜地図」の切り替えを出すか */
  readonly withMap?: boolean;
  /** 切り替えたときに呼ぶ関数 */
  readonly onMode?: (mode: PreviewMode) => void;
}

/**
 * CMS のクーポン・イベントをプレビュー用に変換する（掲載中・予定だけ）。
 * @param events CMS の一覧
 * @returns プレビュー用
 */
export function liveEventsOf(events: readonly CmsShopEventDto[]): readonly PreviewEvent[] {
  const log = logger.fn('liveEventsOf', { count: events.length });
  return log.exit(events.filter((e) => e.status === 'active' || e.status === 'scheduled').map(({ id, kind, title, description, start, end }) => ({ id, kind, title, description, start, end })));
}

/**
 * プレビュー用のクーポン・イベントを、アプリのお店のページの形（ShopEventDto）にする。
 * @param event クーポン・イベント
 * @param today 今日
 * @returns アプリの形（終わったものは undefined）
 */
export function toShopEventDto(event: PreviewEvent, today: string): ShopEventDto | undefined {
  const log = logger.fn('toShopEventDto', { id: event.id });
  const start = parseLocalDate(event.start);
  const end = parseLocalDate(event.end);
  const now = parseLocalDate(today);
  if (!start.ok || !end.ok || !now.ok || compareLocalDate(end.value, now.value) < 0) return log.exit(undefined);
  const active = compareLocalDate(start.value, now.value) <= 0;
  const { id, kind, title, description } = event;
  return log.exit({ id, kind, title, description, start: event.start, end: event.end, active, ...(active ? { daysLeft: daysBetween(now.value, end.value) } : {}) });
}

/**
 * お店の情報と入力中の値から、アプリのお店のページの形（SpotDetailDto）を作る。
 * @param info 店の情報
 * @param content 営業時間・便利情報・クーポン
 * @returns アプリの形
 */
export function toSpotDetailDto(info: CmsShopInfoDto, content: PreviewContent): SpotDetailDto {
  const log = logger.fn('toSpotDetailDto', { spotId: info.id });
  const shopEvents = content.events.map((e) => toShopEventDto(e, info.today)).filter((e): e is ShopEventDto => e !== undefined);
  return log.exit({
    id: info.id, name: info.name, kind: 'shop', category: info.category, districtId: info.districtId, districtName: info.districtName,
    description: info.description, amenities: content.amenities, hours: content.hours, partner: info.partner, status: 'visited',
    canVisit: false, visitedToday: false, visitCount: 0, districtVisitCount: 0, history: [], shopEvents,
  });
}

/** 地図の見え方の大きさ（実機の幅 375px にそろえる） */
const MAP_SIZE = { width: 375, height: 640 } as const;

/** 道で区切られた街区の境目（縦の道の x と、横の道の y。外側は画面の外まで広げる） */
const MAP_GRID = { xs: [-20, 96, 250, 395], ys: [-20, 140, 320, 480, 660] } as const;

/** 街区を道から離す幅 */
const MAP_BLOCK_INSET = 8;

/** 細い道（横の y と縦の x）・幹線（横の y）・商店街（縦の x と、川の手前で止める y） */
const MAP_ROADS = { streetYs: [140, 480], streetXs: [96], arterialY: 320, arcadeX: 250, arcadeEndY: 560 } as const;

/** 川の道筋 */
const MAP_RIVER_PATH = 'M-20 610 C 100 570 220 620 395 575';

/** お店の印の位置 */
const MAP_PIN = { x: 232, y: 236 } as const;

/**
 * SVG の要素を作る。色は PALETTE の値を属性に直接入れる（SVG の属性では CSS 変数が効かないため）。
 * @param tag 要素名
 * @param attrs 属性
 * @returns SVG の要素
 */
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string | number>>): SVGElementTagNameMap[K] { // audit-ignore: fnlog-missing 地図の図形ごとに呼ぶ SVG 生成の小さな中継
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
}

/**
 * 道の線を作る（横は y、縦は x の位置に端から端まで）。
 * @param axis 'h'（横）か 'v'（縦）
 * @param at 位置
 * @param stroke 色と幅（破線のときは dash）
 * @param to 縦の道の終わりの y（省略時は画面の外まで）
 * @returns line 要素
 */
function roadLine(axis: 'h' | 'v', at: number, stroke: { readonly color: string; readonly width: number; readonly dash?: string }, to: number = MAP_SIZE.height + 10): SVGLineElement { // audit-ignore: fnlog-missing 地図の道ごとに呼ぶ SVG 生成の小さな中継
  const ends = axis === 'h' ? { x1: -10, y1: at, x2: MAP_SIZE.width + 10, y2: at } : { x1: at, y1: -10, x2: at, y2: to };
  return svgEl('line', { ...ends, stroke: stroke.color, 'stroke-width': stroke.width, ...(stroke.dash === undefined ? {} : { 'stroke-dasharray': stroke.dash }) });
}

/**
 * 街区（道で区切られたマス。左上の1つは公園）を作る。
 * @returns rect 要素の並び
 */
function mapBlocks(): readonly SVGRectElement[] {
  const log = logger.fn('mapBlocks');
  const blocks: SVGRectElement[] = [];
  MAP_GRID.xs.slice(0, -1).forEach((x0, i) => MAP_GRID.ys.slice(0, -1).forEach((y0, j) => {
    const x1 = MAP_GRID.xs[i + 1] ?? x0;
    const y1 = MAP_GRID.ys[j + 1] ?? y0;
    const fill = i === 0 && j === 0 ? PALETTE.park : PALETTE.block;
    blocks.push(svgEl('rect', { x: x0 + MAP_BLOCK_INSET, y: y0 + MAP_BLOCK_INSET, width: x1 - x0 - MAP_BLOCK_INSET * 2, height: y1 - y0 - MAP_BLOCK_INSET * 2, rx: 4, fill }));
  }));
  return log.exit(blocks);
}

/**
 * お店の印と、店名の吹き出しを作る（文字は textContent で入れる）。
 * @param name 店名
 * @returns g 要素
 */
function mapPin(name: string): SVGGElement {
  const log = logger.fn('mapPin', { length: name.length });
  const width = [...name].length * 12 + 16;
  const left = MAP_PIN.x + 19;
  const label = svgEl('text', { x: left + 8, y: MAP_PIN.y, 'dominant-baseline': 'central', 'font-size': 12, 'font-weight': 700, 'font-family': DISPLAY_FONT_FAMILY, fill: PALETTE.ink });
  label.textContent = name;
  const group = svgEl('g', {});
  group.append(
    svgEl('circle', { cx: MAP_PIN.x, cy: MAP_PIN.y, r: 13, fill: PALETTE.white, stroke: PALETTE.brand, 'stroke-width': 3 }),
    svgEl('circle', { cx: MAP_PIN.x, cy: MAP_PIN.y, r: 5, fill: PALETTE.brand }),
    svgEl('rect', { x: left, y: MAP_PIN.y - 11, width, height: 22, rx: 6, fill: PALETTE.white, stroke: PALETTE.roadCasing, 'stroke-width': 1 }),
    label,
  );
  return log.exit(group);
}

/**
 * 地図の見え方を作る（アプリの地図と同じ色の表 PALETTE で、街区・公園・川・道・幹線・商店街と、店名つきのお店の印を描く）。
 * アプリの地図のコードには頼らない（静止画でもない）。
 * @param name 店名
 * @returns SVG
 */
function simpleMap(name: string): SVGSVGElement {
  const log = logger.fn('simpleMap');
  const svg = svgEl('svg', { viewBox: `0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true', class: 'cms-map' });
  const street = { color: PALETTE.road, width: 10 };
  const streetCasing = { color: PALETTE.roadCasing, width: 13 };
  svg.append(
    svgEl('rect', { x: 0, y: 0, width: MAP_SIZE.width, height: MAP_SIZE.height, fill: PALETTE.land }),
    ...mapBlocks(),
    svgEl('path', { d: MAP_RIVER_PATH, stroke: PALETTE.water, 'stroke-width': 28, fill: 'none', 'stroke-linecap': 'round' }),
    ...MAP_ROADS.streetYs.map((y) => roadLine('h', y, streetCasing)), ...MAP_ROADS.streetXs.map((x) => roadLine('v', x, streetCasing)),
    ...MAP_ROADS.streetYs.map((y) => roadLine('h', y, street)), ...MAP_ROADS.streetXs.map((x) => roadLine('v', x, street)),
    roadLine('h', MAP_ROADS.arterialY, { color: PALETTE.arterialCasing, width: 22 }),
    roadLine('h', MAP_ROADS.arterialY, { color: PALETTE.road, width: 18 }),
    roadLine('v', MAP_ROADS.arcadeX, { color: PALETTE.arcade, width: 14 }, MAP_ROADS.arcadeEndY),
    roadLine('v', MAP_ROADS.arcadeX, { color: PALETTE.brand, width: 1.5, dash: '4 4' }, MAP_ROADS.arcadeEndY),
    mapPin(name),
  );
  return log.exit(svg);
}

/**
 * 「お店のページ｜地図」の切り替えを作る。
 * @param onSelect 選んだときの処理
 * @returns 要素と、選択を変える関数
 */
function modeSwitch(onSelect: (mode: PreviewMode) => void): { readonly element: HTMLElement; readonly select: (mode: PreviewMode) => void } {
  const log = logger.fn('modeSwitch');
  const modes: readonly { readonly mode: PreviewMode; readonly label: string }[] = [{ mode: 'page', label: 'お店のページ' }, { mode: 'map', label: '地図' }];
  const buttons = modes.map(({ mode, label }) => h('button', { class: 'cms-seg__item', attrs: { type: 'button', 'aria-pressed': mode === 'page' ? 'true' : 'false', 'data-testid': `cms-preview-${mode}` }, text: label, on: { click: () => onSelect(mode) } }));
  /** 選択中の見た目を変える */
  const select = (mode: PreviewMode): void => { // audit-ignore: fnlog-missing 切り替えのたびに呼ぶ見た目の更新
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', modes[i]?.mode === mode ? 'true' : 'false'));
  };
  return log.exit({ element: h('div', { class: 'cms-seg', attrs: { role: 'group', 'aria-label': '見え方' } }, buttons), select });
}

/**
 * 見え方の列の見出しの行（左に「アプリでの見え方」、右にクーポン・イベントの画面だけ切り替え）と、スマホのシートの見出し（閉じるボタンつき）を作る。
 * @param switcher 切り替え（無ければ文字だけの行）
 * @returns 2つの行
 */
function columnHeads(switcher: HTMLElement | undefined): readonly HTMLElement[] {
  const log = logger.fn('columnHeads', { withSwitch: switcher !== undefined });
  const close = h('button', { class: 'cms-icon-btn', attrs: { type: 'button', 'aria-label': '閉じる', 'data-testid': 'cms-close-preview' }, on: { click: (e) => e.currentTarget?.dispatchEvent(new CustomEvent('cms-close-preview', { bubbles: true })) } }, [icon('close')]);
  return log.exit([
    h('div', { class: 'cms-preview-col__sheethead' }, [h('span', { text: '見え方' }), close]),
    h('div', { class: ['cms-preview-col__head', switcher === undefined && 'cms-preview-col__head--plain'] }, [h('p', { class: 'cms-preview-col__label', text: 'アプリでの見え方' }), switcher]),
  ]);
}

/** 対象の部分を囲み、枠の中をそこまで動かす操作 */
interface TargetScroller {
  /**
   * 対象と、破線で囲むかを変える。
   * @param target 対象の部分（undefined で外す）
   * @param outline 破線で囲むか
   */
  set(target: PreviewTarget | undefined, outline: boolean): void;
  /** 囲み直して対象まで動かす（最初の1回は即座に、以降はなめらかに） */
  apply(): void;
  /** 対象まで即座に動かす（シートを開いたとき） */
  jump(): void;
}

/**
 * 対象の部分を囲み、枠（body）の中をそこまで動かす操作を作る。
 * 枠が DOM に入る前なら次のフレームで1回だけやり直す。シートが閉じている（高さ 0）ときは動かさない。
 * @param body 縦に動く枠
 * @param content 中身（対象を探す範囲）
 * @returns 操作
 */
function targetScroller(body: HTMLElement, content: HTMLElement): TargetScroller {
  const log = logger.fn('targetScroller');
  let target: PreviewTarget | undefined;
  let outline = true;
  let painted = false;
  /** 対象の部分（無ければ null） */
  const targetEl = (): HTMLElement | null => (target === undefined ? null : content.querySelector<HTMLElement>(TARGET_SELECTORS[target])); // audit-ignore: fnlog-missing 入力のたびに呼ぶ小さな検索
  /** 対象の部分まで枠の中を動かす */
  const scrollToTarget = (behavior: ScrollBehavior, retry = true): void => { // audit-ignore: fnlog-missing 入力のたびに呼ぶ見た目の更新
    const el = targetEl();
    if (el === null) return;
    if (!body.isConnected) {
      if (retry) requestAnimationFrame(() => scrollToTarget('auto', false));
      return;
    }
    if (body.clientHeight === 0) return;
    // 位置は枠（body）の上端から測る（.spot-info など途中の要素が position を持っても offsetParent に左右されない）
    const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    body.scrollTo({ top: Math.max(0, top - 16), behavior });
  };
  return log.exit({
    set: (next, withOutline): void => { target = next; outline = withOutline; },
    apply: (): void => {
      content.querySelectorAll('.cms-hl').forEach((el) => el.classList.remove('cms-hl'));
      if (outline) targetEl()?.classList.add('cms-hl');
      scrollToTarget(painted ? 'smooth' : 'auto');
      painted = true;
    },
    jump: (): void => scrollToTarget('auto'),
  });
}

/**
 * 見え方の列（スマホ枠のプレビュー）を作る。
 * 枠の中はホイール・タッチで縦に動かせる（中身は inert で、押したり Tab で入ったりはできない）。
 * 対象の部分までの移動は、最初の描画（DOM に入る前なら次のフレーム）とシートを開いたときは即座に、入力のたびはなめらかに行う。
 * @param info 店の情報
 * @param opts 地図の切り替えを出すか
 * @returns 操作
 */
export function createPreviewColumn(info: CmsShopInfoDto, opts: PreviewColumnOptions = {}): PreviewColumnHandle {
  const log = logger.fn('createPreviewColumn', { spotId: info.id, withMap: opts.withMap === true });
  const content = h('div', { class: 'cms-phone__content' });
  content.inert = true;
  const body = h('div', { class: ['screen-scroll', 'spot-detail__body', 'cms-phone__body'], attrs: { 'data-district-id': info.districtId } }, [content]);
  const page = h('div', { class: 'cms-phone__page' }, [createTopBar({ title: info.name, back: { label: '地図', onClick: (): void => undefined } }), body]);
  const sheet = h('div', { class: 'cms-phone__sheet' });
  const map = h('div', { class: 'cms-phone__map', attrs: { hidden: true } }, [simpleMap(info.name), sheet]);
  const caption = h('p', { class: 'cms-preview-col__caption', attrs: { 'data-testid': 'cms-preview-caption' } });
  const phone = h('figure', { class: 'cms-phone', attrs: { 'data-testid': 'cms-phone' } }, [h('div', { class: 'cms-phone__screen' }, [page, map])]);
  let illustration: SpotIllustrationHandle | undefined;
  const scroller = targetScroller(body, content);
  /** お店のページ／地図を切り替える */
  const setMode = (mode: PreviewMode): void => { // audit-ignore: fnlog-missing 切り替えのたびに呼ぶ見た目の更新
    page.hidden = mode !== 'page';
    map.hidden = mode !== 'map';
    switcher?.select(mode);
  };
  const switcher = opts.withMap === true ? modeSwitch((mode) => { setMode(mode); opts.onMode?.(mode); }) : undefined;
  const element = h('div', { class: 'cms-preview-col' }, [...columnHeads(switcher?.element), phone, caption]);
  element.dataset.dispose = '1';
  element.addEventListener('cms-dispose', () => illustration?.destroy());
  element.addEventListener('cms-preview-opened', () => scroller.jump());
  return log.exit({
    element,
    update: (next: PreviewContent): void => {
      if (illustration === undefined) {
        illustration = createSpotIllustration(body, { seed: info.id, kind: 'shop', category: info.category, status: 'visited', name: info.name, districtId: info.districtId });
        body.append(content);
      }
      const dto = toSpotDetailDto(info, next);
      const events = createCouponEventList(dto.shopEvents);
      content.replaceChildren(createSpotInfo(dto), ...(events === undefined ? [] : [events]));
      for (const e of next.events.filter((x) => x.placeholder === true)) content.querySelector(`[data-event-id="${e.id}"]`)?.classList.add('cms-placeholder');
      sheet.replaceChildren(...(next.notice === undefined ? [h('p', { class: 'cms-phone__empty', text: 'お知らせなし' })] : [createRevisitReasonCard({ kind: 'deadline', ...next.notice })]));
      scroller.apply();
    },
    setCaption: (text: string): void => { caption.textContent = text; },
    highlight: (next: PreviewTarget | undefined, o: { readonly outline?: boolean } = {}): void => { scroller.set(next, o.outline !== false); scroller.apply(); },
    setMode,
  });
}
