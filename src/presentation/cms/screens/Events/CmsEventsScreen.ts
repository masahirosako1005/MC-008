/**
 * @file 店舗CMS のクーポン・イベント画面（presentation/cms/screens/Events。docs/09 C04・C05、CMS-E01・E03・E04・E09・E10）
 * 初めての人でも迷わないように、登録を 1 種類 → 2 内容 → 3 期間 → 4 見え方を確かめて掲載 の順に並べる。
 * - 文面の例・よく使う期間を選ぶだけで形になる（白紙から考えなくてよい）
 * - 掲載に必要なもの（題名・説明・期間）がそろっているかを、ボタンのそばに常に出す
 * - 掲載したら「アプリで見る」へ案内する。取り下げは確認してから行う
 * 入力中の値はページを移っても残る（ctx.draft）。登録すると、アプリの地図の期限カードとお店のページにすぐ出る。
 */
import type { CmsShopEventDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { createChip, setChipSelected } from '@/Common/ui/Chip';
import { h } from '@/Common/ui/dom';
import { openModal } from '@/Common/ui/Modal';
import { SHOP_EVENT_DESCRIPTION_MAX, SHOP_EVENT_MAX_DAYS, SHOP_EVENT_MAX_OPEN_PER_SPOT, SHOP_EVENT_TITLE_MAX } from '@/domain/revisit/constants';
import { EVENT_TEMPLATES, PERIOD_PRESETS, periodOfPreset } from '@/presentation/cms/cmsTemplates';
import { appLink, attachFieldError, cmsBadge, cmsErrorLine, cmsSection, cmsTextField, eventStatusText, pageHeader, shortDate } from '@/presentation/cms/cmsUi';
import type { CmsContext, CmsField } from '@/presentation/cms/cmsUi';
import { KIND_LABELS, periodSummary, problemsOf, renderEventPreview } from '@/presentation/cms/screens/Events/eventForm';
import type { DraftProblems, EventDraft } from '@/presentation/cms/screens/Events/eventForm';
import { newOperationId } from '@/presentation/shared/operation';

const logger = createLogger('presentation/cms/screens/Events/CmsEventsScreen');

/** 種別ごとの説明 */
const KIND_HINTS = { coupon: '値引き・1品サービスなど', event: '試食会・限定メニューなど' } as const;

/** 直前に掲載したもの（成功の案内に使う） */
interface PostedNote {
  last?: string;
}

/** フォームの部品（入力のたびに更新するもの） */
interface FormParts {
  readonly title: CmsField<HTMLInputElement | HTMLTextAreaElement>;
  readonly description: CmsField<HTMLInputElement | HTMLTextAreaElement>;
  readonly periodError: (message: string) => void;
  readonly periodText: HTMLElement;
  readonly previewHost: HTMLElement;
  readonly checklist: HTMLElement;
  /** 掲載を押したあとか（押す前は誤りを欄の下に出さない） */
  attempted: boolean;
}

/**
 * 掲載枠のメーター（●●○ あと1件）を作る。
 * @param remaining あと何件登録できるか
 * @returns 要素
 */
function slotMeter(remaining: number): HTMLElement {
  const log = logger.fn('slotMeter', { remaining });
  const used = SHOP_EVENT_MAX_OPEN_PER_SPOT - remaining;
  const dots = Array.from({ length: SHOP_EVENT_MAX_OPEN_PER_SPOT }, (_, i) => h('span', { class: ['cms-meter__dot', i < used && 'cms-meter__dot--used'] }));
  return log.exit(h('div', { class: 'cms-meter', attrs: { 'data-testid': 'cms-slots', 'aria-label': `同時に出せる${SHOP_EVENT_MAX_OPEN_PER_SPOT}件のうち${used}件を使用中` } }, [
    h('span', { class: 'cms-meter__dots', attrs: { 'aria-hidden': 'true' } }, dots),
    h('span', { class: 'cms-meter__text', text: remaining > 0 ? `あと${remaining}件出せます` : '上限まで出しています' }),
  ]));
}

/**
 * 種類（クーポン／イベント）の選択を作る。
 * @param draft 入力中の値
 * @param onChange 変わったときの処理
 * @returns 選択の要素
 */
function kindOptions(draft: EventDraft, onChange: () => void): HTMLElement {
  const log = logger.fn('kindOptions', { kind: draft.kind });
  const buttons = (['coupon', 'event'] as const).map((kind) => h('button', {
    class: 'cms-option', attrs: { type: 'button', 'aria-pressed': draft.kind === kind ? 'true' : 'false', 'data-testid': `cms-kind-${kind}` },
  }, [h('span', { class: 'cms-option__title', text: KIND_LABELS[kind] }), h('span', { class: 'cms-option__hint', text: KIND_HINTS[kind] })]));
  for (const [index, button] of buttons.entries()) {
    button.addEventListener('click', () => {
      draft.kind = index === 0 ? 'coupon' : 'event';
      for (const [i, other] of buttons.entries()) other.setAttribute('aria-pressed', i === index ? 'true' : 'false');
      onChange();
    });
  }
  return log.exit(h('div', { class: 'cms-options', attrs: { role: 'group', 'aria-label': '種類' } }, buttons));
}

/**
 * 文面の例のボタンを作る（押すと題名と説明に入る）。
 * @param draft 入力中の値
 * @param parts フォームの部品
 * @returns ボタンの並び
 */
function templateChips(draft: EventDraft, parts: Pick<FormParts, 'title' | 'description'>): HTMLElement {
  const log = logger.fn('templateChips', { kind: draft.kind });
  const chips = EVENT_TEMPLATES[draft.kind].map((template) => createButton({
    label: template.label, variant: 'secondary', testId: 'cms-template',
    onClick: () => {
      parts.title.input.value = template.title;
      parts.description.input.value = template.description;
      parts.title.input.dispatchEvent(new Event('input'));
      parts.description.input.dispatchEvent(new Event('input'));
      parts.title.input.focus();
    },
  }));
  return log.exit(h('div', { class: 'cms-templates' }, [h('span', { class: 'cms-field__label', text: '例から選ぶ（あとで書きかえられます）' }), h('div', { class: 'cms-chips' }, chips)]));
}

/**
 * 期間の入力（よく使う期間＋日付）を作る。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @param onChange 変わったときの処理
 * @returns 要素と、誤りを出す関数
 */
function periodInputs(ctx: CmsContext, draft: EventDraft, onChange: () => void): { readonly element: HTMLElement; readonly setError: (message: string) => void } {
  const log = logger.fn('periodInputs', { start: draft.start, end: draft.end });
  /** 日付の入力欄を作る（今日より前は選べない） */
  const dateInput = (id: string, value: string): HTMLInputElement => h('input', { class: 'cms-input cms-input--date', attrs: { type: 'date', id, value, min: ctx.info.today, 'data-testid': id } });
  const start = dateInput('cms-start', draft.start);
  const end = dateInput('cms-end', draft.end);
  const chips = PERIOD_PRESETS.map((preset) => ({ id: preset.id, chip: createChip({ label: preset.label, selected: draft.preset === preset.id, testId: `cms-preset-${preset.id}` }) }));
  for (const { id, chip } of chips) {
    chip.addEventListener('click', () => {
      const period = periodOfPreset(id, ctx.info.today);
      Object.assign(draft, { start: period.start, end: period.end, preset: id });
      start.value = period.start;
      end.value = period.end;
      for (const other of chips) setChipSelected(other.chip, other.id === id);
      onChange();
    });
  }
  for (const [input, key] of [[start, 'start'], [end, 'end']] as const) {
    input.addEventListener('change', () => {
      draft[key] = input.value;
      draft.preset = undefined;
      for (const other of chips) setChipSelected(other.chip, false);
      onChange();
    });
  }
  const error = attachFieldError(end, 'cms-period-error');
  /** 日付の入力欄にラベルを付ける */
  const label = (id: string, text: string): HTMLElement => h('label', { class: 'cms-field cms-field--inline' }, [h('span', { class: 'cms-field__label', text }), id === 'cms-start' ? start : end]);
  return log.exit({
    element: h('div', { class: 'cms-stack-s' }, [h('div', { class: 'cms-chips', attrs: { role: 'group', 'aria-label': 'よく使う期間' } }, chips.map((c) => c.chip)), h('div', { class: 'cms-row' }, [label('cms-start', '開始日'), h('span', { class: 'cms-row__sep', attrs: { 'aria-hidden': 'true' }, text: '〜' }), label('cms-end', '終了日')]), error.element]),
    setError: error.setError,
  });
}

/**
 * 掲載に必要なものの確認リスト（✓ 題名 ✓ 説明 ✓ 期間）を描く。
 * @param host 描く先
 * @param problems 欄ごとの誤り
 * @sideEffect host の中身を置き換える
 */
function renderChecklist(host: HTMLElement, problems: DraftProblems): void {
  const log = logger.fn('renderChecklist');
  const items = [['題名', problems.title], ['説明', problems.description], ['期間', problems.period]] as const;
  host.replaceChildren(...items.map(([name, problem]) => h('li', { class: ['cms-ready__item', problem === undefined && 'cms-ready__item--ok'] }, [
    h('span', { class: 'cms-ready__mark', attrs: { 'aria-hidden': 'true' }, text: problem === undefined ? '✓' : '・' }),
    problem === undefined ? `${name}` : `${name}：${problem}`,
  ])));
  log.exit(undefined);
}

/**
 * 入力のたびに、見え方・期間のまとめ・確認リスト・（押したあとは）欄の誤りを更新する。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @param parts フォームの部品
 * @sideEffect DOM を書き換え、保存していない入力の有無を CmsApp に知らせる
 */
function refreshForm(ctx: CmsContext, draft: EventDraft, parts: FormParts): void {
  const log = logger.fn('refreshForm', { attempted: parts.attempted });
  const problems = problemsOf(draft, ctx.info.today);
  parts.previewHost.replaceChildren(renderEventPreview(ctx.info, draft));
  parts.periodText.textContent = periodSummary(draft);
  renderChecklist(parts.checklist, problems);
  parts.title.setError(parts.attempted ? problems.title ?? '' : '');
  parts.description.setError(parts.attempted ? problems.description ?? '' : '');
  parts.periodError(parts.attempted || draft.preset === undefined ? problems.period ?? '' : '');
  ctx.setDirty('event', draft.title.trim() !== '' || draft.description.trim() !== '');
  log.exit(undefined);
}

/**
 * 掲載する（足りないものがあれば、その欄に移って知らせる）。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @param parts フォームの部品
 * @param showError 失敗の説明を出す関数
 * @sideEffect 店舗CMS の登録内容を保存し、利用者アプリに反映させる
 */
async function register(ctx: CmsContext, draft: EventDraft, parts: FormParts, showError: (message: string) => void): Promise<void> {
  const log = logger.fn('register', { spotId: ctx.info.id, kind: draft.kind });
  parts.attempted = true;
  refreshForm(ctx, draft, parts);
  const problems = problemsOf(draft, ctx.info.today);
  if (Object.keys(problems).length > 0) {
    showError('まだ入っていない項目があります。赤い説明のところを直してください');
    (problems.title ? parts.title.input : problems.description ? parts.description.input : document.getElementById('cms-end'))?.focus();
    return log.exit(undefined, 'incomplete');
  }
  const { kind, title, description, start, end } = draft;
  const result = await ctx.services.registerShopEvent.execute({ spotId: ctx.info.id, kind, title, description, start, end, operationId: newOperationId() });
  if (!result.ok) {
    showError(`掲載できませんでした：${result.error.message}`);
    return log.fail(undefined, result.error.code);
  }
  ctx.discardDraft('event');
  ctx.draft<PostedNote>('posted', () => ({})).last = title.trim();
  ctx.toast.show(`${KIND_LABELS[kind]}を掲載しました`, { kind: 'success' });
  ctx.update(result.value);
  return log.exit(undefined);
}

/**
 * 登録フォーム（1〜4の手順）を作る。
 * @param ctx 文脈
 * @returns 要素
 */
function renderForm(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderForm', { remaining: ctx.info.remainingSlots });
  const initial = periodOfPreset('week', ctx.info.today);
  const draft = ctx.draft<EventDraft>('event', () => ({ kind: 'coupon', title: '', description: '', start: initial.start, end: initial.end, preset: 'week' }));
  let parts: FormParts | undefined;
  /** 入力が変わるたびに部品を更新する */
  const onChange = (): void => { if (parts) refreshForm(ctx, draft, parts); }; // audit-ignore: fnlog-missing 入力のたびに呼ぶ中継（ログは refreshForm が出す）
  const title = cmsTextField({ label: '題名', hint: 'アプリで大きく出る一言です', max: SHOP_EVENT_TITLE_MAX, value: draft.title, placeholder: '例：メロンパン1個おまけ', testId: 'cms-event-title', onInput: (v) => { draft.title = v; onChange(); } });
  const description = cmsTextField({ label: '説明', hint: '使い方（例：レジで画面を見せる）も書くと親切です', max: SHOP_EVENT_DESCRIPTION_MAX, multiline: true, value: draft.description, placeholder: '例：お会計のときにアプリの画面を見せてください。1会計につき1回。', testId: 'cms-event-description', onInput: (v) => { draft.description = v; onChange(); } });
  const templateHost = h('div', {}, [templateChips(draft, { title, description })]);
  const period = periodInputs(ctx, draft, onChange);
  const error = cmsErrorLine();
  parts = { title, description, periodError: period.setError, periodText: h('p', { class: 'cms-period-summary', attrs: { 'data-testid': 'cms-period-summary' } }), previewHost: h('div'), checklist: h('ul', { class: 'cms-ready', attrs: { 'aria-label': '掲載に必要なもの' } }), attempted: false };
  const formParts = parts;
  const kinds = kindOptions(draft, () => { templateHost.replaceChildren(templateChips(draft, { title, description })); onChange(); });
  const button = createButton({ label: 'この内容で掲載する', variant: 'primary', size: 'large', testId: 'cms-event-register', onClick: () => register(ctx, draft, formParts, error.show) });
  refreshForm(ctx, draft, parts);
  return log.exit(h('div', { class: 'cms-stack', attrs: { 'data-testid': 'cms-event-form' } }, [
    cmsSection('種類を選ぶ', [kinds], { step: 1 }),
    cmsSection('内容を書く', [templateHost, title.element, description.element], { step: 2, lead: '景品表示法にそって、実際より得に見える書き方（「全品無料」など）はしないでください。' }),
    cmsSection('期間を決める', [period.element, parts.periodText], { step: 3, lead: `今日から選べます。長さは${SHOP_EVENT_MAX_DAYS}日まで。` }),
    cmsSection('アプリでの見え方を確かめて掲載する', [parts.previewHost, h('p', { class: 'cms-field__label', text: '掲載に必要なもの' }), parts.checklist, error.element, button], { step: 4 }),
  ]));
}

/**
 * 掲載したあとの案内を作る（直前に掲載したものがあるときだけ）。
 * @param ctx 文脈
 * @returns 要素（無ければ undefined）
 */
function renderPosted(ctx: CmsContext): HTMLElement | undefined {
  const log = logger.fn('renderPosted');
  const note = ctx.draft<PostedNote>('posted', () => ({}));
  if (note.last === undefined) return log.exit(undefined);
  const another = createButton({ label: '続けてもう1件出す', variant: 'secondary', testId: 'cms-post-another', onClick: () => { ctx.discardDraft('posted'); ctx.update(ctx.info); } });
  return log.exit(h('div', { class: 'cms-success', attrs: { role: 'status', 'data-testid': 'cms-posted' } }, [
    h('p', { class: 'cms-success__title', text: `✓「${note.last}」を掲載しました` }),
    h('p', { class: 'cms-note', text: 'アプリのお店のページにすぐ出ています。終わりの7日前からは、このお店を図鑑で見つけている人の地図にも「期限カード」として出ます。' }),
    h('div', { class: 'cms-actions' }, [appLink('アプリで見る', `#/spot/${ctx.info.id}`, 'cms-posted-open-app'), ctx.info.remainingSlots > 0 ? another : undefined]),
  ]));
}

/**
 * 取り下げの確認を出して、よければ取り下げる。
 * @param ctx 文脈
 * @param event クーポン・イベント
 * @sideEffect 確認のモーダルを開き、取り下げたら登録内容を保存する
 */
function confirmWithdraw(ctx: CmsContext, event: CmsShopEventDto): void {
  const log = logger.fn('confirmWithdraw', { id: event.id });
  openModal({
    title: `「${event.title}」を取り下げますか？`, testId: 'cms-withdraw-modal',
    body: 'アプリからすぐに消えます。期間中に来てくれたお客さんの記録やアイテムは消えません。取り下げたあとで、新しく出し直すこともできます。',
    actions: [
      { label: 'やめる', variant: 'secondary', testId: 'cms-withdraw-cancel', onClick: (): void => undefined },
      {
        label: '取り下げる', variant: 'primary', testId: 'cms-withdraw-confirm',
        onClick: (): void => {
          void ctx.services.withdrawShopEvent.execute({ spotId: ctx.info.id, shopEventId: event.id, operationId: newOperationId() }).then((result) => {
            if (!result.ok) return ctx.toast.show(`取り下げられませんでした：${result.error.message}`, { kind: 'error' });
            ctx.toast.show('取り下げました', { kind: 'success' });
            ctx.update(result.value);
          });
        },
      },
    ],
  });
  log.exit(undefined);
}

/**
 * 一覧の1行を作る。
 * @param ctx 文脈
 * @param event クーポン・イベント
 * @returns 行の要素
 */
function renderEventRow(ctx: CmsContext, event: CmsShopEventDto): HTMLElement {
  const log = logger.fn('renderEventRow', { id: event.id, status: event.status });
  const tone = event.status === 'active' ? 'deadline' : event.status === 'scheduled' ? 'ink' : 'muted';
  const withdraw = event.canWithdraw ? createButton({ label: '取り下げる', variant: 'ghost', testId: 'cms-event-withdraw', onClick: () => confirmWithdraw(ctx, event) }) : undefined;
  return log.exit(h('li', { class: ['cms-event', `cms-event--${event.status}`], attrs: { 'data-testid': 'cms-event-row', 'data-event-id': event.id } }, [
    h('div', { class: 'cms-event__head' }, [cmsBadge(KIND_LABELS[event.kind], 'brand'), cmsBadge(eventStatusText(event), tone), event.source === 'master' ? cmsBadge('最初から登録済み', 'muted') : undefined]),
    h('p', { class: 'cms-event__title', text: event.title }),
    h('p', { class: 'cms-event__desc', text: event.description }),
    h('p', { class: 'cms-event__period', text: `${shortDate(event.start)}〜${shortDate(event.end)}` }),
    withdraw,
  ]));
}

/**
 * 一覧（いま出しているもの・終わったもの）を作る。
 * @param ctx 文脈
 * @returns 区画
 */
function renderList(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderList', { count: ctx.info.events.length });
  const live = ctx.info.events.filter((e) => e.status === 'active' || e.status === 'scheduled');
  const past = ctx.info.events.filter((e) => e.status === 'ended' || e.status === 'withdrawn');
  const liveList = live.length > 0 ? h('ul', { class: 'cms-events' }, live.map((e) => renderEventRow(ctx, e))) : h('p', { class: 'cms-note', text: 'いま出しているものはありません。' });
  const pastList = past.length > 0 ? h('details', { class: 'cms-details' }, [h('summary', { text: `終わったもの（${past.length}件）` }), h('ul', { class: 'cms-events' }, past.map((e) => renderEventRow(ctx, e)))]) : undefined;
  return log.exit(cmsSection(`いま出しているもの（${live.length}件）`, [liveList, pastList], { testId: 'cms-event-list' }));
}

/**
 * クーポン・イベント画面を作る。
 * @param ctx 文脈
 * @returns 画面の要素
 */
export function renderCmsEventsScreen(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderCmsEventsScreen', { spotId: ctx.info.id, events: ctx.info.events.length });
  const header = pageHeader('クーポン・イベント', '期間限定の特典やイベントを出すと、アプリの地図に「期限カード」が出て、もう一度来てもらうきっかけになります。', ctx.info.partner ? slotMeter(ctx.info.remainingSlots) : undefined);
  const locked = cmsSection('協力店になると出せます', [h('p', { class: 'cms-note', text: 'クーポン・イベントは協力店だけが出せます。協力店になると、図鑑で「★2 レア」として目立って表示されます。運営者に相談してください。' })], { testId: 'cms-event-form' });
  const full = cmsSection('いまは新しく出せません', [h('p', { class: 'cms-note', text: `同時に出せるのは${SHOP_EVENT_MAX_OPEN_PER_SPOT}件までです。終わるのを待つか、下の一覧から取り下げると出せるようになります。` })], { testId: 'cms-event-form' });
  const body = !ctx.info.partner ? locked : ctx.info.remainingSlots <= 0 ? full : renderForm(ctx);
  return log.exit(h('div', { class: 'cms-stack', attrs: { 'data-testid': 'cms-screen-events' } }, [header, renderPosted(ctx), body, renderList(ctx)]));
}
