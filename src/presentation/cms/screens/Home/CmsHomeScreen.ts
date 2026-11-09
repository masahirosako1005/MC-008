/**
 * @file 店舗CMS のホーム（presentation/cms/screens/Home。docs/09 C02）
 * 左：お店のページの見え方（自動では動かさない）／右：はじめにやること（3つ済んだら消す）、クーポン・イベント、直近30日の数字。
 * 見出し（h1「ホーム」）は見せない（店名は上部のお店の切り替えと見え方に出ているため）。デモのリセットは上部の「デモ」のメニューにある。
 * 説明文は置かない。クーポン・イベントの行は一覧と同じ部品（eventRowButton）、数字は来店データと同じ部品（kpiItem）で作る。
 */
import type { CmsShopInfoDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { SHOP_EVENT_MAX_OPEN_PER_SPOT } from '@/domain/revisit/constants';
import { createPreviewColumn, liveEventsOf } from '@/presentation/cms/cmsPhonePreview';
import type { CmsPage } from '@/presentation/cms/cmsRoute';
import { badge, eventRowButton, formSection, icon, pageTitle, slotLimit, twoColumn } from '@/presentation/cms/cmsUi';
import type { CmsContext } from '@/presentation/cms/cmsUi';
import { kpiItem } from '@/presentation/cms/screens/Data/CmsDataScreen';
import { openEventForm } from '@/presentation/cms/screens/Events/CmsEventsScreen';

const logger = createLogger('presentation/cms/screens/Home/CmsHomeScreen');

/** はじめにやることの1項目 */
export interface SetupStep {
  readonly label: string;
  readonly done: boolean;
  /** 協力店でないなどで、できない */
  readonly locked: boolean;
  readonly page: CmsPage;
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
    { label: 'お店の情報を確認', done: info.edited, locked: false, page: 'info' },
    { label: 'クーポンを掲載', done: posted, locked: !info.partner, page: 'events' },
    { label: '来店データを見る', done: seenData, locked: false, page: 'data' },
  ]);
}

/**
 * はじめにやることの区切りを作る（全部済んだら作らない）。
 * @param ctx 文脈
 * @returns 区切り（無ければ undefined）
 */
function renderSetup(ctx: CmsContext): HTMLElement | undefined {
  const log = logger.fn('renderSetup');
  const steps = setupSteps(ctx.info, ctx.hasSeen('data'));
  const doable = steps.filter((s) => !s.locked);
  const done = doable.filter((s) => s.done).length;
  if (done === doable.length) return log.exit(undefined);
  const rows = steps.map((s) => {
    const mark = s.done ? icon('check', 'cms-step__check') : h('span', { class: 'cms-step__circle', attrs: { 'aria-hidden': 'true' } });
    const inner = [mark, h('span', { class: 'cms-step__label', text: s.label }), s.locked ? badge('協力店のみ', 'muted') : icon('chevronRight', 'cms-row__chevron')];
    return s.locked
      ? h('li', { class: 'cms-row cms-step cms-step--locked' }, inner)
      : h('li', {}, [h('button', { class: ['cms-row', 'cms-step', s.done && 'cms-step--done'], attrs: { type: 'button', 'data-testid': `cms-step-${s.page}`, 'data-done': s.done ? '1' : '0' }, on: { click: () => ctx.go(s.page) } }, inner)]);
  });
  const bar = h('div', { class: 'cms-progress', attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': doable.length, 'aria-valuenow': done, 'aria-label': 'はじめにやること' } }, [
    h('span', { class: 'cms-progress__fill', style: { width: `${Math.round((done / doable.length) * 100)}%` } }),
  ]);
  return log.exit(formSection('はじめにやること', [bar, h('ul', { class: 'cms-rows' }, rows)], { aside: h('span', { class: 'cms-muted', text: `${done}/${doable.length}` }), testId: 'cms-setup' }));
}

/**
 * クーポン・イベント（掲載中・予定）の区切りを作る（最大3行。行は一覧と同じ2段＝札・題名と期間・印）。
 * @param ctx 文脈
 * @returns 区切り
 */
function renderLive(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderLive');
  const live = ctx.info.events.filter((e) => e.status === 'active' || e.status === 'scheduled');
  const rows = live.slice(0, SHOP_EVENT_MAX_OPEN_PER_SPOT).map((e) => h('li', {}, [eventRowButton(e, () => ctx.go('events'), 'cms-home-event')]));
  const full = ctx.info.remainingSlots <= 0;
  const create = ctx.info.partner
    ? h('button', { class: 'cms-btn cms-btn--secondary', attrs: { type: 'button', 'data-testid': 'cms-home-new', disabled: full }, text: '新規作成', on: { click: () => openEventForm(ctx) } })
    : undefined;
  const body = rows.length > 0 ? h('ul', { class: 'cms-rows' }, rows) : h('p', { class: 'cms-muted', text: 'まだありません' });
  return log.exit(formSection('クーポン・イベント', [body], { aside: [ctx.info.partner && full && slotLimit(), create], testId: 'cms-home-live' }));
}

/**
 * 直近30日の数字の区切りを作る（読み込み中は空のまま高さだけ取り、届いたら来店データと同じ形で数字を入れる）。
 * @param ctx 文脈
 * @returns 区切り
 */
function renderNumbers(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderNumbers');
  const strip = h('div', { class: 'cms-kpis cms-kpis--inline' });
  void ctx.services.visitStats.execute({ spotId: ctx.info.id }).then((stats) => {
    if (!stats.ok) return strip.replaceChildren(h('span', { class: 'cms-muted', text: '読み込めませんでした' }));
    return strip.replaceChildren(kpiItem('来店数', stats.value.visits30d, '回'), kpiItem('来店者', stats.value.visitors30d, '人'), kpiItem('再訪率', stats.value.revisitRatePct, '%'));
  });
  const more = h('button', { class: 'cms-textbtn', attrs: { type: 'button', 'data-testid': 'cms-home-data' }, on: { click: () => ctx.go('data') } }, ['来店データ', icon('chevronRight')]);
  return log.exit(formSection('直近30日', [strip], { aside: more }));
}

/**
 * ホーム画面を作る。
 * @param ctx 文脈
 * @returns 画面の要素
 */
export function renderCmsHomeScreen(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderCmsHomeScreen', { spotId: ctx.info.id });
  const preview = createPreviewColumn(ctx.info);
  preview.update({ hours: ctx.info.hoursText, amenities: ctx.info.amenities, events: liveEventsOf(ctx.info.events) });
  const panel = h('div', { class: 'cms-panel', attrs: { 'data-testid': 'cms-screen-home' } }, [
    pageTitle('ホーム', undefined, { hidden: true }),
    renderSetup(ctx),
    renderLive(ctx),
    renderNumbers(ctx),
  ]);
  return log.exit(twoColumn(preview.element, panel));
}
