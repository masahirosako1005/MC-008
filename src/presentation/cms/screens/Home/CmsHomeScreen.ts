/**
 * @file 店舗CMS のホーム画面（presentation/cms/screens/Home。docs/09 C02）
 * 初めての人が「何から始めればいいか」で迷わないように、上から順に
 * 1) はじめにやること（3つ・進み具合つき） 2) アプリでのいまの表示 3) 期限が近いもの 4) デモ用の操作（たたんでおく）を出す。
 */
import type { CmsShopInfoDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { DEADLINE_NOTICE_DAYS } from '@/domain/revisit/constants';
import type { CmsPage } from '@/presentation/cms/cmsRoute';
import { appLink, cmsBadge, cmsSection, eventStatusText, pageHeader, shortDate } from '@/presentation/cms/cmsUi';
import type { CmsContext } from '@/presentation/cms/cmsUi';
import { amenityLabel } from '@/presentation/shared/labels';

const logger = createLogger('presentation/cms/screens/Home/CmsHomeScreen');

/** はじめにやることの1項目 */
export interface SetupStep {
  readonly title: string;
  readonly text: string;
  readonly done: boolean;
  /** できないとき（協力店でないなど）の説明 */
  readonly lockedReason?: string;
  readonly page: CmsPage;
  readonly action: string;
}

/**
 * はじめにやること（3つ）と、それぞれ済んだかを返す。
 * @param info 店の情報
 * @param seenData 来店データのページを開いたことがあるか
 * @returns 3つの項目
 */
export function setupSteps(info: CmsShopInfoDto, seenData: boolean): readonly SetupStep[] {
  const log = logger.fn('setupSteps', { spotId: info.id, seenData });
  const posted = info.events.some((e) => e.source === 'cms' && e.status !== 'withdrawn');
  return log.exit([
    { title: 'お店の情報を確かめる', text: '営業時間と「子連れOK」「雨の日OK」などの情報が合っているか確かめます。', done: info.edited, page: 'info', action: info.edited ? '見直す' : '確かめる' },
    {
      title: 'クーポンかイベントを出す', text: '期間限定の特典を出すと、アプリの地図に「期限カード」が出て、また来るきっかけになります。', done: posted, page: 'events',
      action: posted ? 'ほかにも出す' : '出してみる', ...(info.partner ? {} : { lockedReason: '協力店になると出せます。運営者に相談してください。' }),
    },
    { title: '来店の傾向を見る', text: 'どの曜日・時間帯にお客さんが多いかがわかります。クーポンを出す日を決める参考になります。', done: seenData, page: 'data', action: '見る' },
  ]);
}

/**
 * はじめにやることの1行を作る。
 * @param ctx 文脈
 * @param step 項目
 * @param index 番号（0始まり）
 * @returns li 要素
 */
function stepItem(ctx: CmsContext, step: SetupStep, index: number): HTMLElement {
  const log = logger.fn('stepItem', { page: step.page, done: step.done });
  const mark = h('span', { class: ['cms-check', step.done && 'cms-check--done'], attrs: { 'aria-hidden': 'true' }, text: step.done ? '✓' : String(index + 1) });
  const button = step.lockedReason === undefined
    ? createButton({ label: step.action, variant: step.done ? 'secondary' : 'primary', testId: `cms-step-${step.page}`, onClick: () => ctx.go(step.page) })
    : h('span', { class: 'cms-note', text: step.lockedReason });
  return log.exit(h('li', { class: ['cms-checklist__item', step.done && 'cms-checklist__item--done'], attrs: { 'data-testid': 'cms-setup-step', 'data-done': step.done ? '1' : '0' } }, [
    mark,
    h('div', { class: 'cms-checklist__text' }, [
      h('p', { class: 'cms-checklist__title' }, [step.title, step.done ? h('span', { class: 'cms-visually-hidden', text: '（済み）' }) : undefined]),
      h('p', { class: 'cms-checklist__desc', text: step.text }),
    ]),
    button,
  ]));
}

/**
 * はじめにやることの区画を作る（進み具合のバーつき）。
 * @param ctx 文脈
 * @returns 区画
 */
function renderSetup(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderSetup');
  const steps = setupSteps(ctx.info, ctx.hasSeen('data'));
  const doable = steps.filter((s) => s.lockedReason === undefined);
  const done = doable.filter((s) => s.done).length;
  const allDone = done === doable.length;
  const progress = h('div', { class: 'cms-progress', attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': doable.length, 'aria-valuenow': done, 'aria-label': 'はじめにやることの進み具合' } }, [
    h('span', { class: 'cms-progress__fill', style: { width: `${Math.round((done / Math.max(1, doable.length)) * 100)}%` } }),
  ]);
  const title = allDone ? 'はじめにやることは、すべて済みました' : `はじめにやること（${done} / ${doable.length}）`;
  const lead = allDone ? 'アプリでお客さんにどう見えるか、ときどき確かめてください。' : '上から順に進めると、10分ほどでお客さんに届く状態になります。';
  return log.exit(cmsSection(title, [progress, h('ol', { class: 'cms-checklist' }, steps.map((s, i) => stepItem(ctx, s, i)))], { lead, testId: 'cms-setup' }));
}

/**
 * アプリでのいまの表示（営業時間・便利情報・掲載中のもの）の区画を作る。
 * @param ctx 文脈
 * @returns 区画
 */
function renderCurrent(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderCurrent');
  const amenities = ctx.info.amenities.map((a) => amenityLabel(a) ?? a);
  const live = ctx.info.events.filter((e) => e.status === 'active' || e.status === 'scheduled');
  return log.exit(cmsSection('アプリでのいまの表示', [
    h('dl', { class: 'cms-readonly' }, [
      h('dt', { text: '営業時間' }), h('dd', { attrs: { 'data-testid': 'cms-home-hours' }, text: ctx.info.hoursText }),
      h('dt', { text: '便利情報' }), h('dd', { text: amenities.length > 0 ? amenities.join('・') : 'まだありません' }),
      h('dt', { text: '掲載中' }), h('dd', {}, live.length > 0 ? live.map((e) => h('span', { class: 'cms-inline-event' }, [cmsBadge(eventStatusText(e), e.status === 'active' ? 'deadline' : 'ink'), ` ${e.title}`])) : ['なし']),
    ]),
    h('p', { class: 'cms-card__meta' }, [ctx.info.partner ? cmsBadge('協力店（図鑑で★2 レア）', 'brand') : cmsBadge('協力店ではありません', 'muted'), ' ', appLink('アプリで見る', `#/spot/${ctx.info.id}`, 'cms-home-open-app')]),
  ], { lead: `${ctx.info.districtName}・${ctx.info.category}。アプリでお店を見つけた人には、こう表示されています。` }));
}

/**
 * 期限が近いもの（掲載中で残り DEADLINE_NOTICE_DAYS 日以内）の区画を作る。無ければ作らない。
 * @param ctx 文脈
 * @returns 区画（無ければ undefined）
 */
function renderDeadlines(ctx: CmsContext): HTMLElement | undefined {
  const log = logger.fn('renderDeadlines');
  const soon = ctx.info.events.filter((e) => e.status === 'active' && (e.daysLeft ?? 0) <= DEADLINE_NOTICE_DAYS);
  if (soon.length === 0) return log.exit(undefined);
  const items = soon.map((e) => h('li', { class: 'cms-list__item' }, [cmsBadge(eventStatusText(e), 'deadline'), ` ${e.title}（${shortDate(e.end)}まで）`]));
  return log.exit(cmsSection('まもなく終わるもの', [h('ul', { class: 'cms-list' }, items)], {
    lead: 'いまアプリの地図に「期限カード」として出ています。続けたいときは、終わったあとに新しく出してください。',
  }));
}

/**
 * デモ用の操作（登録内容を消す）を、たたんだ状態で作る。
 * @param ctx 文脈
 * @returns details 要素
 */
function renderDemoTools(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderDemoTools');
  const button = createButton({
    label: 'CMS で登録した内容をすべて消す', variant: 'secondary', testId: 'cms-reset',
    onClick: async () => {
      const result = await ctx.services.resetDemo.execute();
      if (!result.ok) return ctx.toast.show(result.error.message, { kind: 'error' });
      ctx.toast.show('登録内容を消して、最初の状態に戻しました', { kind: 'success' });
      const info = await ctx.services.shopInfo.execute({ spotId: ctx.info.id });
      if (info.ok) ctx.update(info.value);
    },
  });
  return log.exit(h('details', { class: 'cms-details' }, [
    h('summary', { text: 'デモ用の操作' }),
    h('p', { class: 'cms-note', text: '発表のリハーサル用です。全部のお店の登録内容を消し、アプリ同梱のデータに戻します。旅人の訪問記録やカードには触れません。' }),
    button,
  ]));
}

/**
 * ホーム画面を作る。
 * @param ctx 文脈
 * @returns 画面の要素
 */
export function renderCmsHomeScreen(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderCmsHomeScreen', { spotId: ctx.info.id });
  return log.exit(h('div', { class: 'cms-stack', attrs: { 'data-testid': 'cms-screen-home' } }, [
    pageHeader(`${ctx.info.name}`, 'ここで登録した営業時間やクーポンは、かよいまちアプリにすぐ表示されます。わからない言葉は右上の「使い方」で確かめられます。'),
    renderSetup(ctx),
    renderDeadlines(ctx),
    renderCurrent(ctx),
    renderDemoTools(ctx),
  ]));
}
