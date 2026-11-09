/**
 * @file 店舗CMS のクーポン・イベント（presentation/cms/screens/Events。docs/09 C04・C05、CMS-E01・E03・E04・E07・E09・E10）
 * 左：見え方（お店のページ｜地図）／右：「一覧」と「入力」を切り替える。説明文は置かない。
 * - 一覧：下書き → 掲載中 → 予定。行の右に「編集」「取り下げる」（下書きは「編集」「削除」）。終わったものは出さない。
 *   上限（SHOP_EVENT_MAX_OPEN_PER_SPOT 件）に達したときだけ、押せない［新規作成］の左に「3件まで」と出す
 * - 入力：種類・例文・題名・説明・期間。誤りは押したときに欄の下へ出し、最初の誤りまでスクロールする。出口は下端の「キャンセル」だけ
 * - 見え方：入力中は「クーポン・イベント」欄を破線で囲んでそこまで動かす。一覧では掲載中・予定があればその欄まで動かす（破線は掲載・保存した直後だけ）
 * - 編集は「取り下げて同じ内容で掲載し直す」（掲載中のものは今日から）
 * 入力中の値は下書きとしてページを移っても残る（ctx.draft）。
 */
import type { CmsShopEventDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { compareLocalDate, parseLocalDate } from '@/Common/utils/date';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { openModal } from '@/Common/ui/Modal';
import { SHOP_EVENT_DESCRIPTION_MAX, SHOP_EVENT_TITLE_MAX } from '@/domain/revisit/constants';
import { createPreviewColumn, liveEventsOf } from '@/presentation/cms/cmsPhonePreview';
import type { PreviewColumnHandle, PreviewEvent, PreviewMode } from '@/presentation/cms/cmsPhonePreview';
import { EVENT_TEMPLATES, PERIOD_PRESETS, periodOfPreset } from '@/presentation/cms/cmsTemplates';
import { actionBar, attachFieldError, badge, eventBadge, formSection, markDanger, mdDate, pageTitle, previewButton, slotLimit, textField, twoColumn } from '@/presentation/cms/cmsUi';
import type { CmsContext, CmsField } from '@/presentation/cms/cmsUi';
import { captionOf, KIND_LABELS, noticeOf, PLACEHOLDERS, periodDays, problemsOf } from '@/presentation/cms/screens/Events/eventForm';
import type { DraftProblems, EventDraft } from '@/presentation/cms/screens/Events/eventForm';
import { newOperationId } from '@/presentation/shared/operation';

const logger = createLogger('presentation/cms/screens/Events/CmsEventsScreen');

/** 右側の状態（一覧か入力か。編集中のもの・掲載したばかりのもの） */
interface EventsView {
  mode: 'list' | 'form';
  editingId?: string;
  flashId?: string;
  previewMode: PreviewMode;
}

/** 入力の部品 */
interface FormParts {
  readonly title: CmsField<HTMLInputElement | HTMLTextAreaElement>;
  readonly description: CmsField<HTMLInputElement | HTMLTextAreaElement>;
  readonly periodError: (message: string) => void;
  readonly days: HTMLElement;
  readonly presets: readonly { readonly id: string; readonly el: HTMLElement }[];
  attempted: boolean;
}

/**
 * 右側の状態を取り出す。
 * @param ctx 文脈
 * @returns 状態（書き換えると残る）
 */
function viewOf(ctx: CmsContext): EventsView {
  return ctx.draft<EventsView>('eventsView', () => ({ mode: 'list', previewMode: 'page' }));
}

/**
 * 入力中の値を取り出す（無ければ「1週間」で作る）。
 * @param ctx 文脈
 * @returns 入力中の値
 */
function draftOf(ctx: CmsContext): EventDraft {
  const log = logger.fn('draftOf');
  const week = periodOfPreset('week', ctx.info.today);
  return log.exit(ctx.draft<EventDraft>('event', () => ({ kind: 'coupon', title: '', description: '', start: week.start, end: week.end, preset: 'week' })));
}

/**
 * 入力を開く（ほかの画面からも使う。日付を指定できる）。
 * @param ctx 文脈
 * @param period 開始日・終了日（任意）
 * @param stay いまクーポン・イベントの画面にいるか（いれば描き直すだけ）
 * @sideEffect 右側を入力にして、クーポン・イベントの画面を出す
 */
export function openEventForm(ctx: CmsContext, period?: { readonly start: string; readonly end: string }, stay = false): void {
  const log = logger.fn('openEventForm', { start: period?.start });
  const draft = draftOf(ctx);
  if (period !== undefined) Object.assign(draft, { start: period.start, end: period.end, preset: undefined });
  Object.assign(viewOf(ctx), { mode: 'form', editingId: undefined });
  if (stay) ctx.update(ctx.info);
  else ctx.go('events');
  log.exit(undefined);
}

/**
 * 見え方に出す中身（入力中は下書きを足す）。
 * @param ctx 文脈
 * @param view 右側の状態
 * @param draft 入力中の値
 * @returns 中身と、枠の下の1行に使うもの
 */
function previewEvents(ctx: CmsContext, view: EventsView, draft: EventDraft): { readonly events: readonly PreviewEvent[]; readonly focus?: PreviewEvent } {
  const log = logger.fn('previewEvents', { mode: view.mode });
  const live = liveEventsOf(ctx.info.events).filter((e) => e.id !== view.editingId);
  if (view.mode !== 'form') return log.exit({ events: live, focus: live[0] });
  const empty = draft.title.trim() === '' && draft.description.trim() === '';
  const current: PreviewEvent = { id: 'draft', kind: draft.kind, title: draft.title.trim() || PLACEHOLDERS.title, description: draft.description.trim() || PLACEHOLDERS.description, start: draft.start, end: draft.end, placeholder: empty };
  return log.exit({ events: [current, ...live], focus: current });
}

/**
 * 見え方を描き直す（「クーポン・イベント」欄まで動かす。入力中と、掲載・保存した直後は破線で囲む）。
 * @param ctx 文脈
 * @param preview 見え方の列
 * @param view 右側の状態
 * @param draft 入力中の値
 * @param justPosted 掲載・保存した直後の描画か
 * @sideEffect 見え方を書き換える
 */
function paintPreview(ctx: CmsContext, preview: PreviewColumnHandle, view: EventsView, draft: EventDraft, justPosted = false): void {
  const log = logger.fn('paintPreview', { mode: view.mode, previewMode: view.previewMode, justPosted });
  const { events, focus } = previewEvents(ctx, view, draft);
  preview.update({ hours: ctx.info.hoursText, amenities: ctx.info.amenities, events, ...(focus === undefined ? {} : { notice: noticeOf(ctx.info, focus) }) });
  preview.setCaption(captionOf(ctx.info, view.previewMode, focus));
  preview.highlight('events', { outline: view.mode === 'form' || justPosted });
  log.exit(undefined);
}

/**
 * 一覧の1行を作る。
 * @param ctx 文脈
 * @param event クーポン・イベント
 * @param flash 掲載したばかりか
 * @returns 行
 */
function eventRow(ctx: CmsContext, event: CmsShopEventDto, flash: boolean): HTMLElement {
  const log = logger.fn('eventRow', { id: event.id, status: event.status });
  const actions = event.canWithdraw ? [
    h('button', { class: 'cms-textbtn', attrs: { type: 'button', 'data-testid': 'cms-event-edit' }, text: '編集', on: { click: () => startEdit(ctx, event) } }),
    h('button', { class: 'cms-textbtn', attrs: { type: 'button', 'data-testid': 'cms-event-withdraw' }, text: '取り下げる', on: { click: () => confirmWithdraw(ctx, event) } }),
  ] : [];
  return log.exit(h('li', { class: ['cms-item', flash && 'cms-item--flash'], attrs: { 'data-testid': 'cms-event-row', 'data-event-id': event.id } }, [
    eventBadge(event),
    h('div', { class: 'cms-item__main' }, [h('span', { class: 'cms-item__title', text: event.title }), h('span', { class: 'cms-muted', text: `${KIND_LABELS[event.kind]}・${mdDate(event.start)}〜${mdDate(event.end)}` })]),
    h('div', { class: 'cms-item__actions' }, actions),
  ]));
}

/**
 * 下書きの行を作る（題名が入っているときだけ）。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @returns 行（無ければ undefined）
 */
function draftRow(ctx: CmsContext, draft: EventDraft): HTMLElement | undefined {
  const log = logger.fn('draftRow');
  if (draft.title.trim() === '' || viewOf(ctx).editingId !== undefined) return log.exit(undefined);
  return log.exit(h('li', { class: 'cms-item', attrs: { 'data-testid': 'cms-draft-row' } }, [
    badge('下書き', 'muted'),
    h('div', { class: 'cms-item__main' }, [h('span', { class: 'cms-item__title', text: draft.title }), h('span', { class: 'cms-muted', text: `${KIND_LABELS[draft.kind]}・${mdDate(draft.start)}〜${mdDate(draft.end)}` })]),
    h('div', { class: 'cms-item__actions' }, [
      h('button', { class: 'cms-textbtn', attrs: { type: 'button', 'data-testid': 'cms-draft-edit' }, text: '編集', on: { click: () => openEventForm(ctx, undefined, true) } }),
      h('button', { class: 'cms-textbtn', attrs: { type: 'button', 'data-testid': 'cms-draft-delete' }, text: '削除', on: { click: () => { ctx.discardDraft('event'); ctx.toast.show('削除しました'); ctx.update(ctx.info); } } }),
    ]),
  ]));
}

/**
 * 一覧を作る。
 * @param ctx 文脈
 * @returns パネル
 */
function renderList(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderList', { count: ctx.info.events.length });
  const view = viewOf(ctx);
  const live = ctx.info.events.filter((e) => e.status === 'active' || e.status === 'scheduled').sort((a, b) => (a.status === b.status ? a.start.localeCompare(b.start) : a.status === 'active' ? -1 : 1));
  const full = ctx.info.remainingSlots <= 0;
  const create = createButton({ label: '新規作成', variant: 'primary', testId: 'cms-event-new', disabled: full, onClick: () => openEventForm(ctx, undefined, true) });
  const aside = ctx.info.partner ? [previewButton(ctx), full && slotLimit(), create] : [previewButton(ctx)];
  const rows = [draftRow(ctx, draftOf(ctx)), ...live.map((e) => eventRow(ctx, e, e.id === view.flashId))].filter((r): r is HTMLElement => r !== undefined);
  view.flashId = undefined;
  const body = !ctx.info.partner
    ? h('p', { class: 'cms-muted', attrs: { 'data-testid': 'cms-not-partner' }, text: '協力店のみ掲載できます。運営者にご相談ください' })
    : rows.length > 0 ? h('ul', { class: 'cms-items', attrs: { 'data-testid': 'cms-event-list' } }, rows) : h('p', { class: 'cms-muted', text: 'まだありません' });
  return log.exit(h('div', { class: 'cms-panel', attrs: { 'data-testid': 'cms-screen-events' } }, [pageTitle('クーポン・イベント', aside), formSection(undefined, [body])]));
}

/**
 * 種類の切り替え（クーポン｜イベント）を作る。
 * @param draft 入力中の値
 * @param onChange 変わったときの処理
 * @returns 要素
 */
function kindSwitch(draft: EventDraft, onChange: () => void): HTMLElement {
  const log = logger.fn('kindSwitch', { kind: draft.kind });
  const kinds = ['coupon', 'event'] as const;
  const buttons = kinds.map((kind) => h('button', { class: 'cms-seg__item', attrs: { type: 'button', 'aria-pressed': draft.kind === kind ? 'true' : 'false', 'data-testid': `cms-kind-${kind}` }, text: KIND_LABELS[kind] }));
  buttons.forEach((button, i) => button.addEventListener('click', () => {
    draft.kind = kinds[i] ?? 'coupon';
    buttons.forEach((b, j) => b.setAttribute('aria-pressed', i === j ? 'true' : 'false'));
    onChange();
  }));
  return log.exit(h('div', { class: 'cms-seg', attrs: { role: 'group', 'aria-label': '種類' } }, buttons));
}

/**
 * 例文のチップを作る（押すと題名と説明を置き換える）。
 * @param draft 入力中の値
 * @param parts 入力の部品
 * @returns チップの並び
 */
function templateChips(draft: EventDraft, parts: Pick<FormParts, 'title' | 'description'>): HTMLElement {
  const log = logger.fn('templateChips', { kind: draft.kind });
  return log.exit(h('div', { class: 'cms-chips' }, EVENT_TEMPLATES[draft.kind].map((t) => h('button', {
    class: 'cms-chip', attrs: { type: 'button', 'data-testid': 'cms-template' }, text: t.label,
    on: { click: () => { parts.title.input.value = t.title; parts.description.input.value = t.description; parts.title.input.dispatchEvent(new Event('input')); parts.description.input.dispatchEvent(new Event('input')); } },
  }))));
}

/**
 * 期間の入力（チップ＋日付＋日数）を作る。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @param onChange 変わったときの処理
 * @returns 要素と部品
 */
function periodField(ctx: CmsContext, draft: EventDraft, onChange: () => void): { readonly element: HTMLElement; readonly setError: (m: string) => void; readonly days: HTMLElement; readonly presets: FormParts['presets'] } {
  const log = logger.fn('periodField', { start: draft.start, end: draft.end });
  /** 日付の入力欄を作る */
  const dateInput = (id: string, value: string, label: string): HTMLInputElement => h('input', { class: 'cms-input cms-input--date', attrs: { type: 'date', id, value, min: ctx.info.today, 'data-testid': id, 'aria-label': label } });
  const start = dateInput('cms-start', draft.start, '開始日');
  const end = dateInput('cms-end', draft.end, '終了日');
  const presets = PERIOD_PRESETS.map((p) => ({ id: p.id, el: h('button', { class: 'cms-chip', attrs: { type: 'button', 'data-testid': `cms-preset-${p.id}` }, text: p.label }) }));
  for (const { id, el } of presets) {
    el.addEventListener('click', () => {
      const period = periodOfPreset(id as Parameters<typeof periodOfPreset>[0], ctx.info.today);
      Object.assign(draft, { start: period.start, end: period.end, preset: id });
      start.value = period.start;
      end.value = period.end;
      onChange();
    });
  }
  for (const [input, key] of [[start, 'start'], [end, 'end']] as const) input.addEventListener('change', () => { draft[key] = input.value; draft.preset = undefined; onChange(); });
  const error = attachFieldError(end, 'cms-period-error');
  const days = h('span', { class: 'cms-muted', attrs: { 'data-testid': 'cms-period-days' } });
  return log.exit({
    element: h('div', { class: 'cms-field' }, [h('span', { class: 'cms-field__label', text: '期間' }), h('div', { class: 'cms-chips' }, presets.map((p) => p.el)), h('div', { class: 'cms-inline' }, [start, h('span', { class: 'cms-muted', text: '〜' }), end, days]), error.element]),
    setError: error.setError, days, presets,
  });
}

/**
 * 入力のたびに、見え方・日数・期間チップの選択・（押したあとは）誤りを更新する。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @param parts 入力の部品
 * @param repaint 見え方を描き直す関数
 * @sideEffect DOM を書き換える
 */
function refreshForm(ctx: CmsContext, draft: EventDraft, parts: FormParts, repaint: () => void): void {
  const log = logger.fn('refreshForm', { attempted: parts.attempted });
  const problems = problemsOf(draft, ctx.info.today);
  parts.days.textContent = periodDays(draft);
  for (const p of parts.presets) {
    const period = periodOfPreset(p.id as Parameters<typeof periodOfPreset>[0], ctx.info.today);
    p.el.setAttribute('aria-pressed', period.start === draft.start && period.end === draft.end ? 'true' : 'false');
  }
  showProblems(parts, parts.attempted ? problems : {});
  repaint();
  log.exit(undefined);
}

/**
 * 欄の下に誤りを出す（空なら消す）。
 * @param parts 入力の部品
 * @param problems 欄ごとの誤り
 * @sideEffect 誤りの文を書き換える
 */
function showProblems(parts: FormParts, problems: DraftProblems): void {
  const log = logger.fn('showProblems');
  parts.title.setError(problems.title ?? '');
  parts.description.setError(problems.description ?? '');
  parts.periodError(problems.period ?? '');
  log.exit(undefined);
}

/**
 * 掲載する（編集のときは取り下げてから掲載し直す）。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @param parts 入力の部品
 * @sideEffect 登録内容を保存し、一覧に戻る
 */
async function submit(ctx: CmsContext, draft: EventDraft, parts: FormParts): Promise<void> {
  const log = logger.fn('submit', { kind: draft.kind });
  const view = viewOf(ctx);
  parts.attempted = true;
  const problems = problemsOf(draft, ctx.info.today);
  showProblems(parts, problems);
  if (Object.keys(problems).length > 0) {
    const first = problems.title ? parts.title.input : problems.description ? parts.description.input : document.getElementById('cms-start');
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    first?.focus({ preventScroll: true });
    return log.exit(undefined, 'incomplete');
  }
  if (view.editingId !== undefined) {
    const withdrawn = await ctx.services.withdrawShopEvent.execute({ spotId: ctx.info.id, shopEventId: view.editingId, operationId: newOperationId() });
    if (!withdrawn.ok) return log.fail(ctx.toast.show('保存できませんでした', 'error'), withdrawn.error.code);
  }
  const editing = view.editingId !== undefined;
  const before = new Set(ctx.info.events.map((e) => e.id));
  const { kind, title, description, start, end } = draft;
  const result = await ctx.services.registerShopEvent.execute({ spotId: ctx.info.id, kind, title, description, start, end, operationId: newOperationId() });
  if (!result.ok) return log.fail(ctx.toast.show('掲載できませんでした', 'error'), result.error.code);
  ctx.discardDraft('event');
  Object.assign(view, { mode: 'list', editingId: undefined, flashId: result.value.events.find((e) => !before.has(e.id))?.id });
  ctx.toast.show(editing ? '保存しました' : '掲載しました');
  ctx.update(result.value);
  return log.exit(undefined);
}

/**
 * 入力を作る。
 * @param ctx 文脈
 * @param preview 見え方の列
 * @returns パネル
 */
function renderForm(ctx: CmsContext, preview: PreviewColumnHandle): HTMLElement {
  const log = logger.fn('renderForm');
  const view = viewOf(ctx);
  const draft = draftOf(ctx);
  let parts: FormParts | undefined;
  /** 見え方を描き直す */
  const repaint = (): void => paintPreview(ctx, preview, view, draft); // audit-ignore: fnlog-missing 入力のたびに呼ぶ中継
  /** 入力が変わるたびに部品を更新する */
  const onChange = (): void => { if (parts) refreshForm(ctx, draft, parts, repaint); }; // audit-ignore: fnlog-missing 入力のたびに呼ぶ中継
  const title = textField({ label: '題名', max: SHOP_EVENT_TITLE_MAX, value: draft.title, placeholder: PLACEHOLDERS.title.replace('例：', ''), testId: 'cms-event-title', onInput: (v) => { draft.title = v; onChange(); } });
  const description = textField({ label: '説明', max: SHOP_EVENT_DESCRIPTION_MAX, multiline: true, value: draft.description, placeholder: PLACEHOLDERS.description.replace('例：', ''), testId: 'cms-event-description', onInput: (v) => { draft.description = v; onChange(); } });
  const templates = h('div', {}, [templateChips(draft, { title, description })]);
  const period = periodField(ctx, draft, onChange);
  parts = { title, description, periodError: period.setError, days: period.days, presets: period.presets, attempted: false };
  const formParts = parts;
  const kinds = kindSwitch(draft, () => { templates.replaceChildren(templateChips(draft, { title, description })); onChange(); });
  const cancel = createButton({ label: 'キャンセル', variant: 'ghost', testId: 'cms-event-cancel', onClick: () => { if (view.editingId !== undefined) ctx.discardDraft('event'); Object.assign(view, { mode: 'list', editingId: undefined }); ctx.update(ctx.info); } });
  const submitButton = createButton({ label: view.editingId === undefined ? '掲載する' : '保存', variant: 'primary', testId: 'cms-event-register', onClick: () => submit(ctx, draft, formParts) });
  refreshForm(ctx, draft, parts, repaint);
  return log.exit(h('div', { class: 'cms-panel', attrs: { 'data-testid': 'cms-event-form' } }, [
    pageTitle(view.editingId === undefined ? '新規作成' : '編集', previewButton(ctx)),
    formSection(undefined, [
      h('div', { class: 'cms-field' }, [h('span', { class: 'cms-field__label', text: '種類' }), kinds]),
      h('div', { class: 'cms-field' }, [h('span', { class: 'cms-field__label', text: '例文' }), templates]),
      title.element, description.element, period.element,
    ]),
    actionBar(undefined, [cancel, submitButton]),
  ]));
}

/**
 * 編集を始める（同じ内容を入力に入れる。掲載中のものは開始日を今日にする）。
 * @param ctx 文脈
 * @param event クーポン・イベント
 * @sideEffect 下書きを書き換えて入力を開く
 */
function startEdit(ctx: CmsContext, event: CmsShopEventDto): void {
  const log = logger.fn('startEdit', { id: event.id });
  const start = parseLocalDate(event.start);
  const today = parseLocalDate(ctx.info.today);
  const from = start.ok && today.ok && compareLocalDate(start.value, today.value) < 0 ? ctx.info.today : event.start;
  Object.assign(draftOf(ctx), { kind: event.kind, title: event.title, description: event.description, start: from, end: event.end, preset: undefined });
  Object.assign(viewOf(ctx), { mode: 'form', editingId: event.id });
  ctx.update(ctx.info);
  log.exit(undefined);
}

/**
 * 取り下げの確認を出す（「取り下げる」は朱にせず、白地に誤りの色の文字）。
 * @param ctx 文脈
 * @param event クーポン・イベント
 * @sideEffect 確認のモーダルを開き、取り下げたら描き直す
 */
function confirmWithdraw(ctx: CmsContext, event: CmsShopEventDto): void {
  const log = logger.fn('confirmWithdraw', { id: event.id });
  const modal = openModal({
    title: '取り下げますか？', body: event.title, testId: 'cms-withdraw-modal',
    actions: [
      { label: 'やめる', variant: 'secondary', testId: 'cms-withdraw-cancel', onClick: (): void => undefined },
      {
        label: '取り下げる', variant: 'secondary', testId: 'cms-withdraw-confirm',
        onClick: (): void => {
          void ctx.services.withdrawShopEvent.execute({ spotId: ctx.info.id, shopEventId: event.id, operationId: newOperationId() }).then((result) => {
            if (!result.ok) return ctx.toast.show('取り下げられませんでした', 'error');
            ctx.toast.show('取り下げました');
            ctx.update(result.value);
          });
        },
      },
    ],
  });
  markDanger(modal, 'cms-withdraw-confirm');
  log.exit(undefined);
}

/**
 * クーポン・イベント画面を作る。
 * @param ctx 文脈
 * @returns 画面の要素
 */
export function renderCmsEventsScreen(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderCmsEventsScreen', { spotId: ctx.info.id });
  const view = viewOf(ctx);
  if (!ctx.info.partner || (view.mode === 'form' && view.editingId === undefined && ctx.info.remainingSlots <= 0)) view.mode = 'list';
  const draft = draftOf(ctx);
  const preview = createPreviewColumn(ctx.info, { withMap: true, onMode: (mode) => { view.previewMode = mode; paintPreview(ctx, preview, view, draft); } });
  preview.setMode(view.previewMode);
  // renderList の中で flashId が消えるので、先に「掲載・保存した直後か」を取っておく
  const justPosted = view.flashId !== undefined;
  const panel = view.mode === 'form' ? renderForm(ctx, preview) : renderList(ctx);
  if (view.mode === 'list') paintPreview(ctx, preview, view, draft, justPosted);
  return log.exit(twoColumn(preview.element, panel));
}
