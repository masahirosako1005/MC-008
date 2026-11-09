/**
 * @file 店舗CMS の来店データ（presentation/cms/screens/Data。docs/09 C07、CMS-D02・D05・D08）
 * 1列で、数字（来店数・来店者・再訪率・新規率）→ 要点1行（多い曜日に合わせて掲載へ）→ 縦棒グラフ（曜日別・時間帯別・週ごと）。
 * フェーズ1はダミーなので見出しに「サンプル」を付ける。説明文は置かない。
 * 人数が少ないもの（CMS_SMALL_COUNT_THRESHOLD 未満）は「少数」と出し、数値を出さない（PRV-04）。定休日は棒を出さず「休」。
 * 棒は h() の要素と CSS の高さで描く（外部ライブラリなし＝SEC-08）。値の数字は棒の子にして棒の上に出す（棒の高さの％が数字の高さに食われないように）。
 * 時間帯の軸は要点の行と同じ表（cmsInsights の BAND_RANGES）を使う。読み込み中は文字を出さず、高さだけを取っておく。
 */
import type { CmsCountDto, CmsVisitStatsDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { addDays, parseLocalDate } from '@/Common/utils/date';
import { h } from '@/Common/ui/dom';
import { BAND_RANGES, keyPointOf, largest } from '@/presentation/cms/cmsInsights';
import { nextDateOfWeekday } from '@/presentation/cms/cmsTemplates';
import { badge, icon, mdDate, pageTitle } from '@/presentation/cms/cmsUi';
import type { CmsContext } from '@/presentation/cms/cmsUi';
import { openEventForm } from '@/presentation/cms/screens/Events/CmsEventsScreen';

const logger = createLogger('presentation/cms/screens/Data/CmsDataScreen');

/** 集計の期間（日） */
const WINDOW_DAYS = 30;

/**
 * 集計の値を文字にする（定休日などの説明はそのまま、秘匿は「少数」）。
 * @param count 集計の1項目
 * @param unit 単位
 * @returns 表示する文字
 */
export function countText(count: CmsCountDto, unit: string): string {
  const log = logger.fn('countText', { label: count.label });
  if (count.note !== undefined) return log.exit(count.note);
  return log.exit(count.suppressed || count.value === undefined ? '少数' : `${count.value}${unit}`);
}

/**
 * 数字の1項目（ラベルと「数字＋小さな単位」。秘匿は「少数」だけ）を作る。ホームの直近30日と来店データで使う。
 * @param label ラベル（来店数など）
 * @param value 集計の1項目、または数値
 * @param unit 単位（回・人・%）
 * @returns 要素
 */
export function kpiItem(label: string, value: CmsCountDto | number, unit: string): HTMLElement {
  const log = logger.fn('kpiItem', { label });
  const hidden = typeof value !== 'number' && (value.suppressed || value.value === undefined);
  const num = typeof value === 'number' ? value : value.value;
  return log.exit(h('div', { class: 'cms-kpi' }, [
    h('span', { class: 'cms-kpi__label', text: label }),
    hidden
      ? h('span', { class: 'cms-kpi__value cms-kpi__value--hidden', text: '少数' })
      : h('span', { class: 'cms-kpi__value' }, [String(num ?? ''), h('small', { text: unit })]),
  ]));
}

/**
 * 数字の並び（白い面を縦線で4つに分ける）を作る。
 * @param stats 来店データ
 * @returns 要素
 */
function kpiStrip(stats: CmsVisitStatsDto): HTMLElement {
  const log = logger.fn('kpiStrip');
  const items: readonly [string, CmsCountDto | number, string][] = [['来店数', stats.visits30d, '回'], ['来店者', stats.visitors30d, '人'], ['再訪率', stats.revisitRatePct, '%'], ['新規率', stats.firstTimerPct, '%']];
  return log.exit(h('div', { class: 'cms-kpis', attrs: { 'data-testid': 'cms-kpis' } }, items.map(([label, value, unit]) => kpiItem(label, value, unit))));
}

/**
 * 縦棒グラフを作る（いちばん多い棒（週ごとは直近）を紺墨。ブランド色は使わない）。
 * 棒の高さは「いちばん多い値＝描く場所の高さの100%」に比例させ、値の数字は棒の子として棒の上に置く。棒の無い項目（休・少数）は下端に数字だけを置く。
 * @param title 見出し
 * @param counts 項目
 * @param opts 棒の下の名前の作り方・低いグラフにするか・直近を強調するか
 * @returns 要素
 */
function columnChart(title: string, counts: readonly CmsCountDto[], opts: { readonly label?: (c: CmsCountDto) => string; readonly short?: boolean; readonly latest?: boolean } = {}): HTMLElement {
  const log = logger.fn('columnChart', { title, count: counts.length });
  const max = Math.max(1, ...counts.map((c) => c.value ?? 0));
  const top = largest(counts);
  const cols = counts.map((c, i) => {
    const latest = opts.latest === true && i === counts.length - 1;
    const text = c.note !== undefined ? '休' : c.suppressed || c.value === undefined ? '少数' : String(c.value);
    const value = h('span', { class: ['cms-col__value', c.value === undefined && 'cms-col__value--muted'], text });
    const bar = c.value === undefined ? undefined : h('span', {
      class: ['cms-col__bar', c === top && opts.latest !== true && 'cms-col__bar--top', latest && 'cms-col__bar--latest'],
      style: { height: `${Math.max(2, (c.value / max) * 100).toFixed(2)}%` },
    }, [value]);
    return h('div', { class: 'cms-col', attrs: { 'data-testid': 'cms-bar' } }, [
      h('span', { class: 'cms-col__track' }, [bar ?? value]),
      h('span', { class: 'cms-col__label', text: opts.label?.(c) ?? c.label }),
    ]);
  });
  const summary = `${title}：${counts.map((c) => `${c.label} ${countText(c, '回')}`).join('、')}`;
  return log.exit(h('section', { class: 'cms-chart' }, [h('h2', { class: 'cms-section__title', text: title }), h('div', { class: ['cms-cols', opts.short === true && 'cms-cols--short'], attrs: { role: 'img', 'aria-label': summary } }, cols)]));
}

/**
 * 要点の行（いちばん多い曜日と時間帯。協力店はその曜日に掲載へ）を作る。
 * @param ctx 文脈
 * @param stats 来店データ
 * @returns 要素（作れなければ undefined）
 */
function keyPointRow(ctx: CmsContext, stats: CmsVisitStatsDto): HTMLElement | undefined {
  const log = logger.fn('keyPointRow');
  const point = keyPointOf(stats);
  if (point === undefined) return log.exit(undefined);
  const day = nextDateOfWeekday(ctx.info.today, point.weekday);
  const action = ctx.info.partner
    ? h('button', { class: 'cms-btn cms-btn--secondary', attrs: { type: 'button', 'data-testid': 'cms-data-to-events' }, on: { click: () => openEventForm(ctx, { start: day, end: day }) } }, [`${point.weekday}曜に掲載`, icon('chevronRight')])
    : undefined;
  return log.exit(h('div', { class: 'cms-keypoint', attrs: { 'data-testid': 'cms-keypoint' } }, [h('span', { class: 'cms-keypoint__text', text: point.text }), action]));
}

/**
 * 集計を描く。
 * @param ctx 文脈
 * @param stats 来店データ
 * @returns 要素
 */
function renderStats(ctx: CmsContext, stats: CmsVisitStatsDto): HTMLElement {
  const log = logger.fn('renderStats', { today: stats.today });
  return log.exit(h('div', { class: 'cms-data' }, [
    kpiStrip(stats),
    keyPointRow(ctx, stats),
    h('div', { class: 'cms-charts' }, [
      columnChart('曜日別', stats.byWeekday),
      columnChart('時間帯別', stats.byTimeBand, { label: (c) => BAND_RANGES[c.label] ?? c.label }),
    ]),
    columnChart(`直近${stats.weekly.length}週`, stats.weekly, { short: true, latest: true, label: (c) => (c.label === '直近7日' ? '直近' : c.label) }),
  ]));
}

/**
 * 集計の期間の文字（「直近30日 10/11〜11/9」）。
 * @param today 今日
 * @returns 文字
 */
function windowText(today: string): string {
  const log = logger.fn('windowText', { today });
  const date = parseLocalDate(today);
  return log.exit(date.ok ? `直近${WINDOW_DAYS}日 ${mdDate(addDays(date.value, -(WINDOW_DAYS - 1)))}〜${mdDate(today)}` : '');
}

/**
 * 来店データ画面を作る（読み込みが終わったら中身を差し込む。読み込み中は空のまま aria-busy で高さだけ取る）。
 * @param ctx 文脈
 * @returns 画面の要素
 */
export function renderCmsDataScreen(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderCmsDataScreen', { spotId: ctx.info.id });
  const body = h('div', { attrs: { 'aria-busy': 'true' } });
  void ctx.services.visitStats.execute({ spotId: ctx.info.id }).then((stats) => {
    body.removeAttribute('aria-busy');
    body.replaceChildren(stats.ok ? renderStats(ctx, stats.value) : h('p', { class: 'cms-error', text: '読み込めませんでした' }));
  });
  return log.exit(h('div', { class: 'cms-onecol', attrs: { 'data-testid': 'cms-screen-data' } }, [
    pageTitle('来店データ', [badge('サンプル', 'muted'), h('span', { class: 'cms-muted', text: windowText(ctx.info.today) })]),
    body,
  ]));
}
