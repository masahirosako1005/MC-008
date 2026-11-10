/**
 * @file チケットの入れ物（地図の左下のボタン・チケットの一覧・QR の表示。presentation/screens/Map/town 層）
 * 2026-11-10 ユーザー指示「自分が獲得したチケットをQRコードで表示して使えるようにしてほしい」。
 * チケット＝お店のクーポンを、その期間中にそのお店でクエスト達成すると獲得したもの（application/usecases/reward/tickets）。
 * 一覧は紙のチケットの形（切り取り線・看板商品の写真・あと n 日）。タップで大きな QR（縁に光が回る・時計が進む＝画面の写しでないことが分かる）。
 * 「使う」→ 確認 → 使用済みの押印（お店から VISIT_RADIUS_M 以内のときだけ記録できる）。文字は最小限（feedback-ui-minimal-text）。
 * QR の中身・コードはログに出さない（チケットID と件数だけ）。
 */
import '@/presentation/screens/Map/town/ticketWallet.css';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { encodeQrText } from '@/Common/qr/qrCode';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { paintQrCanvas } from '@/Common/ui/canvas/drawQr';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';
import { dayOfWeekOf, parseLocalDate } from '@/Common/utils/date';
import type { TicketDto } from '@/application/dto/Dto';
import type { AppContext } from '@/presentation/App/AppContext';
import { goodsOf } from '@/presentation/screens/Map/town/goods';
import { paintGoodsPhoto } from '@/presentation/screens/Map/town/goodsPhoto';
import { buzz, playPress, playStamp, unlockSound } from '@/presentation/screens/Map/town/mapSound';
import { newOperationId } from '@/presentation/shared/operation';

const logger = createLogger('presentation/screens/Map/town/TicketWallet');

/** 一覧のサムネの一辺（CSS px） */
const THUMB_PX = 56;
/** QR の一辺（CSS px。余白を含む） */
const QR_PX = 224;
/** 時計を進める間隔（ミリ秒） */
const CLOCK_MS = 1000;
/** 曜日 */
const WEEKDAYS = '日月火水木金土';

/** 地図の左下のチケットのボタン */
export interface TicketButtonHandle {
  readonly element: HTMLElement;
  /** 使える枚数を出す（0 ならバッジを隠す） */
  setCount(n: number): void;
  /** 「チケット獲得！」でぽんと弾ませる */
  pulse(): void;
}

/** 一覧を開くときのオプション */
export interface TicketWalletOptions {
  /** 開いてすぐ QR を見せるチケット */
  readonly focusTicketId?: string;
  /** 使用済みにしたとき（ボタンの枚数を直すため） */
  readonly onChanged?: () => void;
}

/**
 * 地図の左下に浮かぶチケットのボタン（チケットのアイコン＋使える枚数のバッジ）を作る。
 * @param onOpen 押されたとき
 * @returns ボタンの操作
 */
export function createTicketButton(onOpen: () => void): TicketButtonHandle {
  const log = logger.fn('createTicketButton');
  const badge = h('span', { class: 'ticket-button__badge', attrs: { 'aria-hidden': 'true' } });
  badge.hidden = true;
  const element = h('button', {
    class: 'ticket-button',
    attrs: { type: 'button', 'aria-label': 'チケット', 'data-testid': 'ticket-button' },
    on: { click: userAction('ticket-button', () => onOpen()) },
  }, [createIcon('ticket'), badge]);
  /**
   * 使える枚数を出す（0 ならバッジを隠す）。
   * @param n 枚数
   * @sideEffect バッジ・読み上げの文字を変える
   */
  const setCount = (n: number): void => {
    const countLog = logger.fn('setCount', { n });
    const count = Math.max(0, Math.floor(n));
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
    element.dataset.count = String(count);
    element.setAttribute('aria-label', count > 0 ? `チケット ${count}枚` : 'チケット');
    countLog.exit(undefined);
  };
  /**
   * ぽんと弾ませる（アニメーションを付け直す）。
   * @sideEffect data-pulse を付け直す
   */
  const pulse = (): void => {
    const pulseLog = logger.fn('pulse');
    delete element.dataset.pulse;
    void element.offsetWidth;
    element.dataset.pulse = '1';
    pulseLog.exit(undefined);
  };
  return log.exit({ element, setCount, pulse });
}

/**
 * チェックインの前後のチケットを比べて、新しく増えたものを返す（「チケット獲得！」用）。
 * @param before 前のチケット
 * @param after 後のチケット
 * @returns 増えたチケットの ID
 */
export function newTicketIds(before: readonly TicketDto[], after: readonly TicketDto[]): string[] {
  const log = logger.fn('newTicketIds', { before: before.length, after: after.length });
  const known = new Set(before.map((t) => t.id));
  return log.exit(after.filter((t) => !known.has(t.id)).map((t) => t.id));
}

/**
 * 使えるチケットの枚数。
 * @param tickets チケット
 * @returns 使える（未使用の）枚数
 */
export function readyCountOf(tickets: readonly TicketDto[]): number {
  const log = logger.fn('readyCountOf', { tickets: tickets.length });
  return log.exit(tickets.filter((t) => t.status === 'ready').length);
}

/**
 * 'YYYY-MM-DD' を短い日付（'11/15（日）'）にする。
 * @param text 日付
 * @returns 短い日付（読めなければそのまま）
 */
function shortDate(text: string): string {
  const log = logger.fn('shortDate');
  const date = parseLocalDate(text);
  if (!date.ok) return log.exit(text);
  return log.exit(`${Number(text.slice(5, 7))}/${Number(text.slice(8, 10))}（${WEEKDAYS.charAt(dayOfWeekOf(date.value))}）`);
}

/**
 * 期限の札の文字（今日まで／あと n 日／使用済み）。
 * @param ticket チケット
 * @returns 文字
 */
function dueText(ticket: TicketDto): string {
  const log = logger.fn('dueText', { id: ticket.id, daysLeft: ticket.daysLeft });
  if (ticket.status === 'used') return log.exit('使用済み');
  return log.exit(ticket.daysLeft <= 0 ? '今日まで' : `あと${ticket.daysLeft}日`);
}

/**
 * 看板商品の写真風サムネを作る。
 * @param ticket チケット
 * @param size 一辺（CSS px）
 * @returns canvas
 */
function thumbOf(ticket: TicketDto, size: number): HTMLCanvasElement {
  const log = logger.fn('thumbOf', { id: ticket.id });
  const canvas = h('canvas', { class: 'ticket-item__photo', attrs: { 'aria-hidden': 'true' } });
  paintGoodsPhoto(canvas, goodsOf({ id: ticket.spotId, kind: 'shop', ...(ticket.category === undefined ? {} : { category: ticket.category }) }).icon, size);
  return log.exit(canvas);
}

/**
 * 一覧のチケット1枚（紙のチケットの形）を作る。
 * @param ticket チケット
 * @param onOpen 押されたとき
 * @returns 要素
 */
function ticketItem(ticket: TicketDto, onOpen: (id: string) => void): HTMLElement {
  const log = logger.fn('ticketItem', { id: ticket.id, status: ticket.status });
  const used = ticket.status === 'used';
  const due = h('span', { class: ['ticket-item__due', !used && ticket.daysLeft <= 2 ? 'ticket-item__due--soon' : undefined], text: dueText(ticket) });
  return log.exit(
    h('button', {
      class: 'ticket-item',
      attrs: { type: 'button', 'data-testid': 'ticket-item', 'data-ticket-id': ticket.id, 'data-status': ticket.status, 'aria-label': `${ticket.spotName} ${ticket.title} ${dueText(ticket)}` },
      on: { click: userAction('ticket-item', () => onOpen(ticket.id)) },
    }, [
      h('span', { class: 'ticket-item__stub' }, [thumbOf(ticket, THUMB_PX)]),
      h('span', { class: 'ticket-item__main' }, [
        h('span', { class: 'ticket-item__shop', text: ticket.spotName }),
        h('span', { class: 'ticket-item__title', text: ticket.title }),
        used ? undefined : due,
      ]),
      used ? h('span', { class: 'ticket-item__stamp', attrs: { 'aria-hidden': 'true' }, text: '使用済み' }) : undefined,
    ]),
  );
}

/**
 * いまの時刻（'10:42:05'）。
 * @returns 時刻の文字
 */
function clockText(): string { // audit-ignore: fnlog-missing 1秒ごとに呼ぶ表示用の小さな整形
  const d = new Date(); // audit-ignore: date-now 表示だけの時計（画面の写しでないことを見せる。記録・判定には使わない）
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/**
 * QR の canvas を作って描く（作れなければ undefined）。
 * @param ticket チケット
 * @returns canvas
 */
function qrCanvasOf(ticket: TicketDto): HTMLCanvasElement | undefined {
  const log = logger.fn('qrCanvasOf', { id: ticket.id });
  const qr = encodeQrText(ticket.payload);
  if (!qr.ok) return log.fail(undefined, qr.error.code);
  const canvas = h('canvas', { class: 'ticket-qr__code', attrs: { role: 'img', 'aria-label': `${ticket.spotName}のチケットのQRコード` } });
  paintQrCanvas(canvas, qr.value, QR_PX, normalizeDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio));
  return log.exit(canvas, `版${qr.value.version}`);
}

/** 一覧と QR の表示（開いている間だけの状態） */
class TicketWallet {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private tickets: readonly TicketDto[] = [];
  private openId: string | undefined;
  private clockTimer: number | undefined;
  private busy = false;
  private closed = false;
  private readonly returnFocus: Element | null;

  /**
   * 重ねる要素を作る（まだ DOM には足さない）。
   * @param ctx 画面コンテキスト
   * @param opts 開いてすぐ見せるチケット・変わったとき
   */
  constructor(
    private readonly ctx: AppContext,
    private readonly opts: TicketWalletOptions,
  ) {
    this.returnFocus = typeof document === 'undefined' ? null : document.activeElement;
    this.count = h('span', { class: 'ticket-wallet__count' });
    this.closeButton = h('button', { class: 'ticket-wallet__close', attrs: { type: 'button', 'aria-label': '閉じる', 'data-testid': 'ticket-wallet-close' }, on: { click: userAction('ticket-wallet-close', () => this.close()) } }, [createIcon('close')]);
    this.body = h('div', { class: 'ticket-wallet__body' });
    const sheet = h('div', { class: 'ticket-wallet__sheet' }, [
      h('div', { class: 'ticket-wallet__head' }, [h('h2', { class: 'ticket-wallet__title', text: 'チケット' }), this.count, this.closeButton]),
      this.body,
    ]);
    const scrim = h('div', { class: 'ticket-wallet__scrim', on: { click: (): void => { setCorrelationId(); this.close(); } } });
    this.root = h('section', { class: 'ticket-wallet', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'チケット', 'data-testid': 'ticket-wallet' } }, [scrim, sheet]);
    this.root.addEventListener('keydown', (event) => this.handleKey(event));
  }

  /**
   * チケットを読み込んで描く（focusTicketId があればその QR を開く）。
   * @sideEffect services.tickets を呼び、中身を描く
   */
  async load(): Promise<void> {
    const log = logger.fn('load', { focus: this.opts.focusTicketId });
    const result = await this.ctx.services.tickets?.execute();
    if (this.closed) return log.exit(undefined, '閉じた');
    if (result !== undefined && !result.ok) this.ctx.toast.show(result.error.message, { kind: 'error' });
    this.tickets = result?.ok === true ? result.value : [];
    const focus = this.opts.focusTicketId === undefined ? undefined : this.tickets.find((t) => t.id === this.opts.focusTicketId);
    if (focus !== undefined) this.showQr(focus.id);
    else this.showList();
    log.exit(undefined, `${this.tickets.length} 枚`);
  }

  /**
   * 一覧を描く。
   * @sideEffect 中身を差し替え、時計を止める
   */
  private showList(): void {
    const log = logger.fn('showList', { tickets: this.tickets.length });
    this.stopClock();
    this.openId = undefined;
    this.root.dataset.view = 'list';
    const ready = this.tickets.filter((t) => t.status === 'ready').length;
    this.count.textContent = ready > 0 ? `${ready}枚` : '';
    const items = this.tickets.map((t) => ticketItem(t, (id) => this.showQr(id)));
    const content = items.length > 0 ? h('div', { class: 'ticket-wallet__list' }, items) : h('p', { class: 'ticket-wallet__empty', attrs: { 'data-testid': 'ticket-empty' } }, [createIcon('ticket'), 'なし']);
    this.body.replaceChildren(content);
    (this.body.querySelector<HTMLElement>('.ticket-item') ?? this.closeButton).focus();
    log.exit(undefined);
  }

  /**
   * QR を描く（大きな QR・お店・タイトル・コード・期限・時計・使うボタン）。
   * @param id チケットID
   * @sideEffect 中身を差し替え、時計を動かす
   */
  private showQr(id: string): void {
    const log = logger.fn('showQr', { id });
    const ticket = this.tickets.find((t) => t.id === id);
    if (ticket === undefined) return log.exit(undefined, '無い');
    this.openId = id;
    this.root.dataset.view = 'qr';
    const used = ticket.status === 'used';
    const clock = h('span', { class: 'ticket-qr__clock', attrs: { 'aria-hidden': 'true' }, text: clockText() });
    const back = h('button', { class: 'ticket-qr__back', attrs: { type: 'button', 'aria-label': '戻る', 'data-testid': 'ticket-qr-back' }, on: { click: userAction('ticket-qr-back', () => this.showList()) } }, [createIcon('chevronLeft')]);
    const frame = h('div', { class: 'ticket-qr__frame' }, [qrCanvasOf(ticket), used ? h('span', { class: 'ticket-qr__stamp', text: '使用済み' }) : undefined]);
    const view = h('div', { class: 'ticket-qr', attrs: { 'data-testid': 'ticket-qr', 'data-ticket-id': ticket.id, 'data-status': ticket.status } }, [
      h('div', { class: 'ticket-qr__bar' }, [back, h('span', { class: 'ticket-qr__shop', text: ticket.spotName })]),
      h('h3', { class: 'ticket-qr__title', text: ticket.title }),
      frame,
      h('p', { class: 'ticket-qr__code-text', attrs: { 'data-testid': 'ticket-code' }, text: ticket.code }),
      h('p', { class: 'ticket-qr__meta' }, [h('span', { text: used ? `${shortDate(ticket.usedOn ?? '')} 使用` : `${shortDate(ticket.validUntil)}まで` }), clock]),
      used ? undefined : this.useArea(ticket),
    ]);
    this.body.replaceChildren(view);
    this.startClock(clock);
    back.focus();
    log.exit(undefined, ticket.status);
  }

  /**
   * 「使う」ボタンと確認（押すと確認に切り替わる）。
   * @param ticket チケット
   * @returns 要素
   */
  private useArea(ticket: TicketDto): HTMLElement {
    const log = logger.fn('useArea', { id: ticket.id });
    const area = h('div', { class: 'ticket-qr__actions' });
    const use = h('button', { class: ['btn', 'btn--primary', 'ticket-qr__use'], attrs: { type: 'button', 'data-testid': 'ticket-use' }, text: '使う' });
    const cancel = h('button', { class: 'btn', attrs: { type: 'button', 'data-testid': 'ticket-use-cancel' }, text: 'やめる' });
    const confirm = h('button', { class: ['btn', 'btn--primary'], attrs: { type: 'button', 'data-testid': 'ticket-use-confirm' }, text: '使った' });
    const ask = h('div', { class: 'ticket-qr__confirm', attrs: { role: 'group', 'aria-label': '使用済みにする' } }, [cancel, confirm]);
    ask.hidden = true;
    use.addEventListener('click', userAction('ticket-use', () => {
      unlockSound();
      playPress();
      use.hidden = true;
      ask.hidden = false;
      confirm.focus();
    }));
    cancel.addEventListener('click', userAction('ticket-use-cancel', () => {
      ask.hidden = true;
      use.hidden = false;
      use.focus();
    }));
    confirm.addEventListener('click', userAction('ticket-use-confirm', () => void this.useTicket(ticket.id, confirm)));
    area.append(use, ask);
    return log.exit(area);
  }

  /**
   * チケットを使用済みにする（できたら押印の演出、だめなら理由をトースト）。
   * @param id チケットID
   * @param button 確認のボタン（実行中は押せなくする）
   * @sideEffect services.useTicket を呼び、表示・音を変える。onChanged を呼ぶ
   */
  private async useTicket(id: string, button: HTMLButtonElement): Promise<void> {
    const log = logger.fn('useTicket', { id, busy: this.busy });
    const service = this.ctx.services.useTicket;
    if (this.busy || service === undefined) return log.exit(undefined, '使えない');
    this.busy = true;
    button.disabled = true;
    try {
      const result = await service.execute({ operationId: newOperationId(), ticketId: id });
      if (this.closed) return log.exit(undefined, '閉じた');
      if (!result.ok) {
        this.ctx.toast.show(result.error.code === 'OUT_OF_RANGE' ? 'お店の近くで使えます' : result.error.message, { kind: 'error' });
        button.disabled = false;
        return log.fail(undefined, result.error.code);
      }
      const updated = this.tickets.map((t) => (t.id === id ? { ...t, status: 'used' as const, usedOn: result.value.usedOn } : t));
      this.tickets = [...updated].sort((a, b) => Number(a.status === 'used') - Number(b.status === 'used') || a.daysLeft - b.daysLeft);
      this.showQr(id);
      this.root.querySelector('.ticket-qr__frame')?.setAttribute('data-stamped', '1');
      playStamp();
      buzz([16, 40, 24]);
      this.opts.onChanged?.();
      log.exit(undefined);
    } finally {
      this.busy = false;
    }
  }

  /**
   * 時計を動かす（QR が画面の写しでないことを、お店の人が見て分かるように）。
   * @param el 時計の要素
   * @sideEffect setInterval を登録する
   */
  private startClock(el: HTMLElement): void {
    const log = logger.fn('startClock');
    this.stopClock();
    this.clockTimer = window.setInterval(() => {
      el.textContent = clockText();
    }, CLOCK_MS);
    log.exit(undefined);
  }

  /**
   * 時計を止める。
   * @sideEffect clearInterval
   */
  private stopClock(): void {
    const log = logger.fn('stopClock', { running: this.clockTimer !== undefined });
    if (this.clockTimer !== undefined) window.clearInterval(this.clockTimer);
    this.clockTimer = undefined;
    log.exit(undefined);
  }

  /**
   * キー操作（Esc: QR なら一覧へ、一覧なら閉じる。Tab: 中でフォーカスを回す）。
   * @param event キーボードイベント
   * @sideEffect 表示・フォーカスを変える
   */
  private handleKey(event: KeyboardEvent): void {
    const log = logger.fn('handleKey', { key: event.key });
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.openId !== undefined && this.opts.focusTicketId !== this.openId) this.showList();
      else this.close();
      return log.exit(undefined);
    }
    if (event.key !== 'Tab') return log.exit(undefined);
    const focusable = [...this.root.querySelectorAll<HTMLElement>('button:not([disabled]):not([hidden])')].filter((el) => el.offsetParent !== null || el === this.closeButton);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return log.exit(undefined);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
    log.exit(undefined);
  }

  /**
   * 閉じる（2回目以降は何もしない）。開く前のフォーカスに戻す。
   * @sideEffect DOM を外し、時計を止める
   */
  close(): void {
    const log = logger.fn('close', { closed: this.closed });
    if (this.closed) return log.exit(undefined);
    this.closed = true;
    this.stopClock();
    this.root.remove();
    if (this.returnFocus instanceof HTMLElement && this.returnFocus.isConnected) this.returnFocus.focus();
    log.exit(undefined);
  }
}

/**
 * チケットの一覧を地図の上に重ねて開く（focusTicketId があれば、すぐその QR を見せる）。
 * @param host 重ねる先（地図の領域）
 * @param ctx 画面コンテキスト（services.tickets・useTicket・toast）
 * @param opts 開いてすぐ見せるチケット・使用済みにしたとき
 * @returns 閉じる関数
 * @sideEffect DOM を足し、チケットを読み込む
 */
export function openTicketWallet(host: HTMLElement, ctx: AppContext, opts: TicketWalletOptions = {}): () => void {
  const log = logger.fn('openTicketWallet', { focus: opts.focusTicketId });
  const wallet = new TicketWallet(ctx, opts);
  host.append(wallet.root);
  wallet.root.querySelector<HTMLElement>('.ticket-wallet__close')?.focus();
  void wallet.load();
  return log.exit(() => wallet.close());
}
