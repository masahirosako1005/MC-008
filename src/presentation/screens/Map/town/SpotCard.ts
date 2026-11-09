/**
 * @file お店カード（地図の下シートの上に浮かぶスポットのカード。presentation/screens/Map/town 層）
 * タップしたスポットへ歩く間〜到着後に出し、看板商品・今日の情報・便利情報・距離を見せてチェックインへつなぐ（A 初回満足度・C 再訪動機）。
 * 未発見のスポットは名前を伏せ、看板商品はシルエットで見せる（B 未開拓への興味）。公衆トイレなどの便利施設は「行きたい」と閉じるだけ。
 * チェックインの可否・文言は呼び出し側（MapScreen）が application の判定から決めて渡す（最終判定は訪問のユースケース）。
 */
import '@/presentation/screens/Map/town/mapTownUi.css';
import { createLogger } from '@/Common/logging/logger';
import { createButton, setButtonDisabled, setButtonLabel } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { formatDistance } from '@/Common/ui/format';
import { userAction } from '@/Common/ui/userAction';
import { amenityLabel } from '@/presentation/shared/labels';
import type { GoodsInfo } from '@/presentation/screens/Map/town/goods';
import { paintGoodsPhoto } from '@/presentation/screens/Map/town/goodsPhoto';
import { amenityIconOf, createMapUiIcon, paintMapUiIcon } from '@/presentation/screens/Map/town/mapUiIcons';

const logger = createLogger('presentation/screens/Map/town/SpotCard');

/** カードの左の看板商品アイコンの大きさ（CSS px） */
export const SPOT_CARD_THUMB_PX = 40;
/** 便利情報のアイコンの大きさ（CSS px） */
const AMENITY_ICON_PX = 14;
/** 便利情報の並び順 */
const AMENITY_ORDER: readonly string[] = ['toilet', 'stroller', 'kids', 'rainOk', 'nursing', 'parking'];

/** カードの段階（歩いている／着いた／歩かずに開いた） */
export type SpotCardPhase = 'walking' | 'arrived' | 'idle';

/** カードに出す内容 */
export interface SpotCardModel {
  readonly id: string;
  readonly kind: 'landmark' | 'shop' | 'toilet';
  /** 名前（未発見の店舗は undefined） */
  readonly name?: string;
  readonly category?: string;
  readonly districtName?: string;
  readonly status: 'unknown' | 'discovered' | 'visited';
  /** 看板商品（名所・便利施設は無いことがある） */
  readonly goods?: GoodsInfo;
  /** 今日の情報（tag は '今日だけ'／'あと3日'／'開催中' など） */
  readonly today?: { readonly tag: string; readonly title: string };
  readonly amenities: readonly string[];
  /** 現在地からの距離（分からなければ undefined） */
  readonly meters?: number;
  readonly phase: SpotCardPhase;
  readonly canCheckIn: boolean;
  /** チェックインできない理由（例 'あと25m近づくとチェックイン'） */
  readonly checkInHint?: string;
  readonly visitedToday: boolean;
  readonly visitCount: number;
  /** 「行きたい」に入っているか */
  readonly want: boolean;
  /** 補足（公衆トイレの場所の説明など） */
  readonly note?: string;
}

/** カードの操作 */
export interface SpotCardHandle {
  readonly element: HTMLElement;
  /** 内容を差し替えて出す */
  show(model: SpotCardModel): void;
  /** 隠す */
  hide(): void;
  isOpen(): boolean;
  /** 出しているスポットの ID（隠れていれば undefined） */
  currentId(): string | undefined;
  /** チェックインの処理中は主ボタンを押せなくする */
  setBusy(busy: boolean): void;
}

/** createSpotCard のオプション */
export interface SpotCardOptions {
  onCheckIn(id: string): void;
  onDetail(id: string): void;
  onToggleWant(id: string): void;
  onClose(): void;
}

/** カードの中で差し替える要素 */
interface SpotCardParts {
  readonly root: HTMLElement;
  readonly thumb: HTMLCanvasElement;
  readonly eyebrow: HTMLElement;
  readonly name: HTMLElement;
  readonly goods: HTMLElement;
  readonly today: HTMLElement;
  readonly todayTag: HTMLElement;
  readonly todayTitle: HTMLElement;
  readonly amenities: HTMLElement;
  readonly meta: HTMLElement;
  readonly want: HTMLButtonElement;
  readonly wantIcon: HTMLCanvasElement;
  readonly actions: HTMLElement;
  readonly checkIn: HTMLButtonElement;
  readonly detail: HTMLButtonElement;
}

/**
 * お店カードを作る（最初は隠れている）。
 * @param opts チェックイン・詳しく見る・行きたい・閉じるの通知先
 * @returns カードの操作
 */
export function createSpotCard(opts: SpotCardOptions): SpotCardHandle {
  const log = logger.fn('createSpotCard');
  let current: SpotCardModel | undefined;
  const parts = buildParts({
    onCheckIn: (): void => {
      if (current !== undefined) opts.onCheckIn(current.id);
    },
    onDetail: (): void => {
      if (current !== undefined) opts.onDetail(current.id);
    },
    onToggleWant: (): void => {
      if (current !== undefined) opts.onToggleWant(current.id);
    },
    onClose: (): void => opts.onClose(),
  });
  return log.exit({
    element: parts.root,
    show: (model): void => {
      current = model;
      renderCard(parts, model);
    },
    hide: (): void => {
      const hideLog = logger.fn('hide', { id: current?.id });
      current = undefined;
      parts.root.hidden = true;
      parts.root.dataset.open = '0';
      hideLog.exit(undefined);
    },
    isOpen: (): boolean => current !== undefined,
    currentId: (): string | undefined => current?.id,
    setBusy: (busy): void => setCheckInBusy(parts.checkIn, busy),
  });
}

/**
 * カードの骨組み（中身は renderCard で入れる）を作る。
 * @param on 各ボタンの処理（相関ID は userAction・createButton が発行する）
 * @returns 差し替える要素
 */
function buildParts(on: { onCheckIn(): void; onDetail(): void; onToggleWant(): void; onClose(): void }): SpotCardParts {
  const log = logger.fn('buildParts');
  const thumb = h('canvas', { class: 'spot-card__thumb-canvas', attrs: { 'aria-hidden': 'true' } });
  const wantIcon = createMapUiIcon('heartOutline', 20, 'spot-card__want-icon');
  const want = h('button', { class: 'spot-card__want', attrs: { type: 'button', 'aria-pressed': 'false', 'aria-label': '行きたいに入れる', 'data-testid': 'spot-card-want' }, on: { click: userAction('spot-card-want', on.onToggleWant) } }, [wantIcon]);
  const close = h('button', { class: 'spot-card__close', attrs: { type: 'button', 'aria-label': 'カードを閉じる', 'data-testid': 'spot-card-close' }, text: '×', on: { click: userAction('spot-card-close', on.onClose) } });
  const checkIn = createButton({ label: 'チェックイン', variant: 'primary', testId: 'spot-card-checkin', onClick: on.onCheckIn });
  checkIn.classList.add('spot-card__checkin');
  const detail = createButton({ label: '詳しく見る', variant: 'secondary', testId: 'spot-card-detail', onClick: on.onDetail });
  detail.classList.add('spot-card__detail');
  const parts = {
    thumb,
    eyebrow: h('p', { class: 'spot-card__eyebrow' }),
    name: h('h2', { class: 'spot-card__name' }),
    goods: h('p', { class: 'spot-card__goods' }),
    todayTag: h('span', { class: 'spot-card__today-tag' }),
    todayTitle: h('span', { class: 'spot-card__today-title' }),
    amenities: h('ul', { class: 'spot-card__amenities', attrs: { 'aria-label': '便利情報' } }),
    meta: h('p', { class: 'spot-card__meta' }),
    want,
    wantIcon,
    actions: h('div', { class: 'spot-card__actions' }, [checkIn, detail]),
    checkIn,
    detail,
  };
  const today = h('p', { class: 'spot-card__today', attrs: { 'data-testid': 'spot-card-today' } }, [createMapUiIcon('today', 14, 'spot-card__today-icon'), parts.todayTag, parts.todayTitle]);
  const root = h('section', { class: 'spot-card', attrs: { 'data-testid': 'spot-card', 'aria-live': 'polite', 'aria-label': 'スポットのカード' } }, [
    close,
    h('div', { class: 'spot-card__head' }, [
      h('div', { class: 'spot-card__thumb' }, [thumb]),
      h('div', { class: 'spot-card__titles' }, [parts.eyebrow, parts.name, parts.goods]),
      want,
    ]),
    today,
    parts.amenities,
    parts.meta,
    parts.actions,
  ]);
  root.hidden = true;
  root.dataset.open = '0';
  return log.exit({ ...parts, root, today });
}

/**
 * 内容をカードに入れて出す。
 * @param parts カードの要素
 * @param model 出す内容
 * @sideEffect カードの文言・アイコン・ボタンの状態を変え、表示する
 */
function renderCard(parts: SpotCardParts, model: SpotCardModel): void {
  const log = logger.fn('renderCard', { id: model.id, kind: model.kind, status: model.status, phase: model.phase, canCheckIn: model.canCheckIn });
  const unknown = model.status === 'unknown' && model.kind !== 'toilet';
  parts.root.dataset.kind = model.kind;
  parts.root.dataset.status = model.status;
  parts.root.dataset.phase = model.phase;
  parts.root.dataset.spotId = model.id;
  paintThumb(parts.thumb, model, unknown);
  parts.eyebrow.textContent = eyebrowText(model, unknown);
  parts.name.textContent = unknown || model.name === undefined ? '？？？（近づくと分かる）' : model.name;
  parts.goods.textContent = goodsText(model, unknown);
  parts.goods.hidden = parts.goods.textContent === '';
  parts.today.hidden = model.today === undefined;
  parts.todayTag.textContent = model.today?.tag ?? '';
  parts.todayTitle.textContent = model.today?.title ?? '';
  parts.today.dataset.tag = model.today?.tag === '今日だけ' ? 'today' : 'period';
  parts.amenities.replaceChildren(...amenityItems(model.amenities));
  parts.amenities.hidden = parts.amenities.childElementCount === 0;
  parts.meta.textContent = metaText(model);
  parts.meta.hidden = parts.meta.textContent === '';
  parts.want.setAttribute('aria-pressed', model.want ? 'true' : 'false');
  parts.want.setAttribute('aria-label', model.want ? '行きたいから外す' : '行きたいに入れる');
  paintMapUiIcon(parts.wantIcon, model.want ? 'heart' : 'heartOutline', 20);
  renderActions(parts, model);
  parts.root.hidden = false;
  parts.root.dataset.open = '1';
  log.exit(undefined);
}

/**
 * 左の看板商品アイコンを描く（便利施設はトイレ、看板商品が無ければピン。未発見はシルエット）。
 * @param canvas 描く先
 * @param model 出す内容
 * @param unknown 未発見なら true
 * @sideEffect canvas を描き直す
 */
function paintThumb(canvas: HTMLCanvasElement, model: SpotCardModel, unknown: boolean): void {
  const log = logger.fn('paintThumb', { kind: model.kind, hasGoods: model.goods !== undefined, unknown });
  if (model.kind === 'toilet') paintMapUiIcon(canvas, 'toilet', SPOT_CARD_THUMB_PX);
  else if (model.goods !== undefined) paintGoodsPhoto(canvas, model.goods.icon, SPOT_CARD_THUMB_PX, { silhouette: unknown });
  else paintMapUiIcon(canvas, 'pin', SPOT_CARD_THUMB_PX);
  log.exit(undefined);
}

/**
 * 名前の上の小さな行（カテゴリ・地区。未発見はカテゴリを伏せる）。
 * @param model 出す内容
 * @param unknown 未発見なら true
 * @returns 文言
 */
function eyebrowText(model: SpotCardModel, unknown: boolean): string {
  const log = logger.fn('eyebrowText', { kind: model.kind, unknown });
  const kindLabel = model.kind === 'toilet' ? '便利施設' : model.kind === 'landmark' ? '名所' : 'お店';
  const head = unknown ? `未発見の${kindLabel}` : (model.category ?? kindLabel);
  return log.exit(model.districtName === undefined ? head : `${head}・${model.districtName}`);
}

/**
 * 看板商品の行（「おすすめ: ◯◯」。未発見は「何のお店かは近づくと分かる」）。
 * @param model 出す内容
 * @param unknown 未発見なら true
 * @returns 文言（出さなければ空）
 */
function goodsText(model: SpotCardModel, unknown: boolean): string {
  const log = logger.fn('goodsText', { hasGoods: model.goods !== undefined, unknown });
  if (model.kind === 'toilet') return log.exit('');
  if (unknown) return log.exit('何があるかは近づくと分かります');
  return log.exit(model.goods === undefined ? '' : `おすすめ: ${model.goods.label}`);
}

/**
 * 便利情報のアイコン付きの項目を作る（決まった順。知らない値は出さない）。
 * @param amenities 便利情報の値
 * @returns li 要素
 */
function amenityItems(amenities: readonly string[]): HTMLLIElement[] {
  const log = logger.fn('amenityItems', { count: amenities.length });
  const items: HTMLLIElement[] = [];
  for (const amenity of AMENITY_ORDER) {
    if (!amenities.includes(amenity)) continue;
    const icon = amenityIconOf(amenity);
    const label = amenityLabel(amenity);
    if (icon === undefined || label === undefined) continue;
    items.push(h('li', { class: 'spot-card__amenity', attrs: { 'data-amenity': amenity } }, [createMapUiIcon(icon, AMENITY_ICON_PX, 'spot-card__amenity-icon'), h('span', { text: label })]));
  }
  return log.exit(items);
}

/**
 * 距離・訪問回数・補足の行。
 * @param model 出す内容
 * @returns 文言（出すものが無ければ空）
 */
function metaText(model: SpotCardModel): string {
  const log = logger.fn('metaText', { hasMeters: model.meters !== undefined, visitCount: model.visitCount });
  const parts: string[] = [];
  if (model.meters !== undefined) parts.push(`ここから${formatDistance(model.meters)}`);
  if (model.kind !== 'toilet' && model.visitCount > 0) parts.push(`${model.visitCount}回チェックイン`);
  if (model.note !== undefined && model.note !== '') parts.push(model.note);
  return log.exit(parts.join('・'));
}

/**
 * ボタンの状態をそろえる（便利施設はボタンなし。済み・歩行中・離れているときはチェックインを押せない）。
 * @param parts カードの要素
 * @param model 出す内容
 * @sideEffect ボタンの文言・有効状態・表示を変更する
 */
function renderActions(parts: SpotCardParts, model: SpotCardModel): void {
  const log = logger.fn('renderActions', { kind: model.kind, phase: model.phase, canCheckIn: model.canCheckIn, visitedToday: model.visitedToday });
  parts.actions.hidden = model.kind === 'toilet';
  const state = checkInState(model);
  setButtonLabel(parts.checkIn, state.label);
  setButtonDisabled(parts.checkIn, !state.enabled);
  parts.checkIn.dataset.canCheckIn = state.enabled ? '1' : '0';
  parts.checkIn.dataset.state = state.kind;
  parts.detail.hidden = model.status === 'unknown';
  log.exit(undefined);
}

/**
 * チェックインボタンの文言と有効状態を決める。
 * @param model 出す内容
 * @returns 種類・文言・有効
 */
export function checkInState(model: Pick<SpotCardModel, 'phase' | 'canCheckIn' | 'checkInHint' | 'visitedToday'>): { readonly kind: 'done' | 'walking' | 'ready' | 'blocked'; readonly label: string; readonly enabled: boolean } {
  const log = logger.fn('checkInState', { phase: model.phase, canCheckIn: model.canCheckIn, visitedToday: model.visitedToday });
  if (model.visitedToday) return log.exit({ kind: 'done', label: '今日はチェックイン済み ✓', enabled: false });
  if (model.phase === 'walking') return log.exit({ kind: 'walking', label: '向かっています…', enabled: false });
  if (model.canCheckIn) return log.exit({ kind: 'ready', label: 'チェックイン', enabled: true });
  return log.exit({ kind: 'blocked', label: model.checkInHint ?? 'もう少し近づくとチェックインできます', enabled: false });
}

/**
 * チェックインの処理中は主ボタンを押せなくする（終われば元の有効状態に戻す）。
 * @param button チェックインボタン
 * @param busy 処理中なら true
 * @sideEffect ボタンの disabled・aria-busy・data-busy を変更する
 */
function setCheckInBusy(button: HTMLButtonElement, busy: boolean): void {
  const log = logger.fn('setCheckInBusy', { busy });
  if (busy) {
    button.dataset.busy = '1';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    delete button.dataset.busy;
    button.removeAttribute('aria-busy');
    button.disabled = button.dataset.wantDisabled === '1';
  }
  log.exit(undefined);
}
