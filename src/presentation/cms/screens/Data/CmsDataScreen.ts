/**
 * @file 店舗CMS の来店データ画面（presentation/cms/screens/Data。docs/09 C07、CMS-D02・D03・D05・D08）
 * グラフを読み慣れていない店主でも使えるように、上から
 * 1) ひとことで言うと（要点の文） 2) 直近30日の数字（それぞれの意味つき） 3) 曜日・時間帯・週ごとのグラフ（いちばん多い棒を強調）
 * 4) 次にやること（クーポンを出す）を出す。フェーズ1はダミーの集計で、画面の上に明示する。
 * 人数・回数が少ないもの（CMS_SMALL_COUNT_THRESHOLD 未満）は数値を出さず「少数」と表示する（個人を特定させない＝PRV-04）。
 * 棒グラフは h() の要素と CSS の幅で描く（外部ライブラリなし＝SEC-08）。
 */
import type { CmsCountDto, CmsVisitStatsDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { insightsOf, largest } from '@/presentation/cms/cmsInsights';
import { cmsSection, pageHeader, shortDate } from '@/presentation/cms/cmsUi';
import type { CmsContext } from '@/presentation/cms/cmsUi';

const logger = createLogger('presentation/cms/screens/Data/CmsDataScreen');

/**
 * 集計の値を文字にする（秘匿は「少数」）。
 * @param count 集計の1項目
 * @param unit 単位
 * @returns 表示する文字
 */
export function countText(count: CmsCountDto, unit: string): string {
  return count.suppressed || count.value === undefined ? '少数' : `${count.value}${unit}`;
}

/**
 * 横棒グラフを作る（いちばん多い棒を強調し、秘匿した項目は棒を出さない）。
 * @param title 見出し
 * @param counts 項目
 * @param unit 単位
 * @param lead 読み方の一言
 * @returns 区画
 */
function barChart(title: string, counts: readonly CmsCountDto[], unit: string, lead: string): HTMLElement {
  const log = logger.fn('barChart', { title, count: counts.length });
  const max = Math.max(1, ...counts.map((c) => c.value ?? 0));
  const top = largest(counts);
  const rows = counts.map((c) => h('div', { class: ['cms-bar', c === top && 'cms-bar--top'], attrs: { 'data-testid': 'cms-bar' } }, [
    h('span', { class: 'cms-bar__label', text: c.label }),
    h('span', { class: 'cms-bar__track' }, [c.suppressed ? undefined : h('span', { class: 'cms-bar__fill', style: { width: `${Math.round(((c.value ?? 0) / max) * 100)}%` } })]),
    h('span', { class: ['cms-bar__value', c.suppressed && 'cms-bar__value--suppressed'], text: countText(c, unit) }),
  ]));
  const summary = `${title}：${counts.map((c) => `${c.label} ${countText(c, unit)}`).join('、')}`;
  return log.exit(cmsSection(title, [h('div', { class: 'cms-bars', attrs: { role: 'img', 'aria-label': summary } }, rows)], { lead }));
}

/**
 * 数字のタイル（意味の説明つき）を作る。
 * @param label 名前
 * @param value 表示する文字
 * @param meaning 意味の一言
 * @returns タイルの要素
 */
function kpi(label: string, value: string, meaning: string): HTMLElement {
  return h('div', { class: 'cms-stat' }, [h('span', { class: 'cms-stat__label', text: label }), h('span', { class: 'cms-stat__value', text: value }), h('span', { class: 'cms-stat__meaning', text: meaning })]);
}

/**
 * 「ひとことで言うと」の区画を作る。
 * @param stats 来店データ
 * @returns 区画
 */
function renderInsights(stats: CmsVisitStatsDto): HTMLElement {
  const log = logger.fn('renderInsights');
  const lines = insightsOf(stats);
  return log.exit(h('section', { class: 'cms-insights', attrs: { 'data-testid': 'cms-insights' } }, [
    h('h2', { class: 'cms-card__title', text: 'ひとことで言うと' }),
    h('ul', { class: 'cms-insights__list' }, lines.map((line) => h('li', { class: line.startsWith('ヒント') ? 'cms-insights__hint' : undefined, text: line }))),
  ]));
}

/**
 * 集計を描く。
 * @param ctx 文脈
 * @param stats 来店データ
 * @returns 要素
 */
function renderStats(ctx: CmsContext, stats: CmsVisitStatsDto): HTMLElement {
  const log = logger.fn('renderStats', { today: stats.today });
  const next = ctx.info.partner
    ? createButton({ label: 'この傾向に合わせてクーポンを出す', variant: 'primary', testId: 'cms-data-to-events', onClick: () => ctx.go('events') })
    : h('p', { class: 'cms-note', text: '協力店になると、多い曜日・時間帯に合わせてクーポンやイベントを出せます。' });
  return log.exit(h('div', { class: 'cms-stack' }, [
    h('p', { class: 'cms-callout', attrs: { 'data-testid': 'cms-dummy-banner' }, text: 'いまはデモ用のダミーデータです。本番では、お客さんが同意して送った訪問記録（お店・日時・地区だけ）を集計します。' }),
    renderInsights(stats),
    cmsSection(`直近30日（${shortDate(stats.today)}まで）`, [h('div', { class: 'cms-stats' }, [
      kpi('来店', countText(stats.visits30d, '回'), 'アプリで「訪問」した回数'),
      kpi('来た人', countText(stats.visitors30d, '人'), '同じ人は1人と数えます'),
      kpi('また来た人', `${stats.revisitRatePct}%`, '来た人のうち、30日以内にもう一度来た人'),
      kpi('初めての人', `${stats.firstTimerPct}%`, '来た人のうち、このお店が初めての人'),
    ])], { lead: '人数が少ない集計は「少数」と出し、数字は見せません（お客さんを特定できないようにするため）。' }),
    barChart('曜日別の来店', stats.byWeekday, '回', 'いちばん多い曜日を濃い色で示しています。'),
    barChart('時間帯別の来店', stats.byTimeBand, '回', 'クーポンを出す時間帯を考えるときの目安になります。'),
    barChart('週ごとの来店', stats.weekly, '回', '上が古い週、いちばん下が今週です。'),
    barChart('アプリのしかけの効果', stats.effects, '人', 'アプリの図鑑・クーポン・おかえり（しばらくぶりの来店）から来た人の数です。'),
    cmsSection('次にやること', [next]),
  ]));
}

/**
 * 来店データ画面を作る（読み込みが終わったら中身を差し込む）。
 * @param ctx 文脈
 * @returns 画面の要素
 */
export function renderCmsDataScreen(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderCmsDataScreen', { spotId: ctx.info.id });
  const body = h('div', { attrs: { 'aria-busy': 'true' } }, [h('p', { class: 'cms-note', text: '読み込んでいます…' })]);
  void ctx.services.visitStats.execute({ spotId: ctx.info.id }).then((stats) => {
    body.removeAttribute('aria-busy');
    body.replaceChildren(stats.ok ? renderStats(ctx, stats.value) : h('p', { class: 'cms-error', text: `来店データを読み込めませんでした：${stats.error.message}` }));
  });
  return log.exit(h('div', { class: 'cms-stack', attrs: { 'data-testid': 'cms-screen-data' } }, [
    pageHeader('来店データ', 'お客さんがいつ来ているかを見て、クーポンやイベントを出す日を考えるのに使います。'),
    body,
  ]));
}
