/**
 * @file 店舗CMS のアンケート（presentation/cms/screens/Survey。docs/09 C09、CMS-V02〜V06）
 * 1列で、数字（回答・満足度・また来たい・アプリの回答）→ まとめ（改善ポイント／施策の打ち時）→ グラフ（満足度の分布・曜日別の満足度）
 * → 横棒（きっかけ・よかった・気になった）→ ひとこと。
 * 回答が集まるまではサンプルを足して見せるので、見出しに「サンプル」を付ける。説明文は置かない（まとめは短い名詞句と数字だけ）。
 * まとめの行は、札（割合・日付・「今すぐ」）＋見出し＋補足＋進める先のボタン（お店の情報の編集／クーポン・イベントの掲載）。
 * 棒は h() の要素と CSS の幅・高さで描く（外部ライブラリなし＝SEC-08）。縦棒は来店データの columnChart を使う。
 */
import type { CmsCountDto, CmsSurveyChoiceDto, CmsSurveyDto, CmsSurveySlotDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { addDays, parseLocalDate } from '@/Common/utils/date';
import { h } from '@/Common/ui/dom';
import { improvementPoints, timingPoints } from '@/presentation/cms/cmsSurveyInsights';
import type { SurveyPoint } from '@/presentation/cms/cmsSurveyInsights';
import { badge, icon, mdDate, pageTitle } from '@/presentation/cms/cmsUi';
import type { CmsContext } from '@/presentation/cms/cmsUi';
import { columnChart } from '@/presentation/cms/screens/Data/CmsDataScreen';
import { openEventForm } from '@/presentation/cms/screens/Events/CmsEventsScreen';

const logger = createLogger('presentation/cms/screens/Survey/CmsSurveyScreen');

/**
 * 数字の1項目（ラベルと「数字＋小さな単位」。値が無ければ「なし」）を作る。
 * @param label ラベル
 * @param value 値（無ければ undefined）
 * @param unit 単位
 * @returns 要素
 */
function kpi(label: string, value: string | undefined, unit: string): HTMLElement { // audit-ignore: fnlog-missing 項目ごとに呼ぶ小さな組み立て（kpiStrip で記録する）
  return h('div', { class: 'cms-kpi' }, [
    h('span', { class: 'cms-kpi__label', text: label }),
    value === undefined
      ? h('span', { class: 'cms-kpi__value cms-kpi__value--hidden', text: 'なし' })
      : h('span', { class: 'cms-kpi__value' }, [value, h('small', { text: unit })]),
  ]);
}

/**
 * 数字の並び（回答・満足度・また来たい・アプリの回答）を作る。
 * @param survey 集計
 * @returns 要素
 */
function kpiStrip(survey: CmsSurveyDto): HTMLElement {
  const log = logger.fn('kpiStrip', { total: survey.total });
  return log.exit(h('div', { class: 'cms-kpis', attrs: { 'data-testid': 'cms-survey-kpis' } }, [
    kpi('回答', String(survey.total), '件'),
    kpi('満足度', survey.satisfactionAvg?.toFixed(1), '/5'),
    kpi('また来たい', survey.revisitPct === undefined ? undefined : String(survey.revisitPct), '%'),
    kpi('アプリの回答', String(survey.total - survey.sampleCount), '件'),
  ]));
}

/**
 * まとめの1行（札・見出し・補足・進める先）を作る。
 * @param ctx 文脈
 * @param point まとめの1行
 * @returns li 要素
 */
function pointRow(ctx: CmsContext, point: SurveyPoint): HTMLElement {
  const log = logger.fn('pointRow', { key: point.key });
  const action = point.action;
  const button = action === undefined ? undefined : h('button', {
    class: 'cms-btn cms-btn--secondary',
    attrs: { type: 'button', 'data-testid': `cms-survey-act-${point.key}` },
    on: { click: () => (action.page === 'events' ? openEventForm(ctx, action.period) : ctx.go('info')) },
  }, [action.label, icon('chevronRight')]);
  return log.exit(h('li', { class: 'cms-point', attrs: { 'data-testid': `cms-survey-point-${point.key}` } }, [
    badge(point.tag, point.tone),
    h('span', { class: 'cms-point__body' }, [h('span', { class: 'cms-point__text', text: point.text }), h('span', { class: 'cms-point__sub', text: point.sub })]),
    button,
  ]));
}

/**
 * まとめの面（見出しと行の一覧。行が無ければ「なし」）を作る。
 * @param ctx 文脈
 * @param title 見出し
 * @param points 行
 * @param testId テスト用 ID
 * @returns 要素
 */
function pointCard(ctx: CmsContext, title: string, points: readonly SurveyPoint[], testId: string): HTMLElement {
  const log = logger.fn('pointCard', { title, count: points.length });
  const body = points.length === 0 ? h('p', { class: 'cms-muted', text: 'なし' }) : h('ul', { class: 'cms-points' }, points.map((p) => pointRow(ctx, p)));
  return log.exit(h('section', { class: 'cms-chart cms-chart--points', attrs: { 'data-testid': testId } }, [h('h2', { class: 'cms-section__title', text: title }), body]));
}

/**
 * 横棒の一覧（選択肢ごとの割合。多い順）を作る。
 * @param title 見出し
 * @param choices 選択肢ごとの数
 * @returns 要素
 */
function barList(title: string, choices: readonly CmsSurveyChoiceDto[]): HTMLElement {
  const log = logger.fn('barList', { title, count: choices.length });
  const sorted = [...choices].sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...sorted.map((c) => c.pct));
  const rows = sorted.map((c, i) => h('li', { class: 'cms-hbar' }, [
    h('span', { class: 'cms-hbar__label', text: c.label }),
    h('span', { class: 'cms-hbar__track', attrs: { 'aria-hidden': 'true' } }, [h('span', { class: ['cms-hbar__bar', i === 0 && c.count > 0 && 'cms-hbar__bar--top'], style: { width: `${((c.pct / max) * 100).toFixed(2)}%` } })]),
    h('span', { class: 'cms-hbar__value', text: `${c.pct}%` }),
  ]));
  return log.exit(h('section', { class: 'cms-chart' }, [h('h2', { class: 'cms-section__title', text: title }), h('ul', { class: 'cms-hbars' }, rows)]));
}

/**
 * 満足度の分布を、縦棒グラフの項目にする（5 → 1）。
 * @param survey 集計
 * @returns 項目
 */
function satisfactionCounts(survey: CmsSurveyDto): readonly CmsCountDto[] { // audit-ignore: fnlog-missing 形を写すだけ
  return survey.satisfaction.map((c) => ({ label: c.label, value: c.count, suppressed: false }));
}

/**
 * 曜日別の満足度を、縦棒グラフの項目にする（定休日は「休」、回答が少ない曜日は「少数」）。
 * @param slots 曜日別
 * @returns 項目
 */
function weekdayCounts(slots: readonly CmsSurveySlotDto[]): readonly CmsCountDto[] { // audit-ignore: fnlog-missing 形を写すだけ
  return slots.map((s): CmsCountDto => (s.note !== undefined ? { label: s.label, suppressed: false, note: s.note } : s.avg === undefined ? { label: s.label, suppressed: true } : { label: s.label, value: s.avg, suppressed: false }));
}

/**
 * ひとことの一覧を作る。
 * @param survey 集計
 * @returns 要素（ひとことが無ければ undefined）
 */
function commentList(survey: CmsSurveyDto): HTMLElement | undefined {
  const log = logger.fn('commentList', { count: survey.comments.length });
  if (survey.comments.length === 0) return log.exit(undefined);
  const rows = survey.comments.map((c) => h('li', { class: 'cms-voice' }, [
    h('span', { class: 'cms-voice__meta' }, [h('span', { class: 'cms-muted', text: mdDate(c.date) }), badge(`満足度 ${c.satisfaction}`, c.satisfaction <= 2 ? 'warn' : 'muted')]),
    h('span', { class: 'cms-voice__text', text: c.text }),
  ]));
  return log.exit(h('section', { class: 'cms-chart', attrs: { 'data-testid': 'cms-survey-comments' } }, [h('h2', { class: 'cms-section__title', text: 'ひとこと' }), h('ul', { class: 'cms-voices' }, rows)]));
}

/**
 * 集計を描く。
 * @param ctx 文脈
 * @param survey 集計
 * @returns 要素
 */
function renderSurvey(ctx: CmsContext, survey: CmsSurveyDto): HTMLElement {
  const log = logger.fn('renderSurvey', { today: survey.today, total: survey.total });
  return log.exit(h('div', { class: 'cms-data' }, [
    kpiStrip(survey),
    h('div', { class: 'cms-charts' }, [
      pointCard(ctx, '改善ポイント', improvementPoints(survey, ctx.info.partner), 'cms-survey-improvements'),
      pointCard(ctx, '施策の打ち時', timingPoints(survey, ctx.info.partner), 'cms-survey-timings'),
    ]),
    h('div', { class: 'cms-charts' }, [
      columnChart('満足度', satisfactionCounts(survey), { short: true, unit: '件' }),
      columnChart('曜日別の満足度', weekdayCounts(survey.byWeekday), { short: true, unit: '', format: (value) => value.toFixed(1) }),
    ]),
    h('div', { class: 'cms-charts cms-charts--three' }, [barList('きっかけ', survey.triggers), barList('よかった', survey.goods), barList('気になった', survey.concerns)]),
    commentList(survey),
  ]));
}

/**
 * 集計の期間の文字（「直近30日 10/12〜11/10」）。
 * @param survey 集計
 * @returns 文字
 */
function windowText(survey: CmsSurveyDto): string {
  const log = logger.fn('windowText', { today: survey.today });
  const date = parseLocalDate(survey.today);
  return log.exit(date.ok ? `直近${survey.windowDays}日 ${mdDate(addDays(date.value, -(survey.windowDays - 1)))}〜${mdDate(survey.today)}` : '');
}

/**
 * アンケート画面を作る（読み込みが終わったら中身を差し込む。読み込み中は空のまま aria-busy で高さだけ取る）。
 * @param ctx 文脈
 * @returns 画面の要素
 */
export function renderCmsSurveyScreen(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderCmsSurveyScreen', { spotId: ctx.info.id });
  const body = h('div', { attrs: { 'aria-busy': 'true' } });
  const aside = h('div', { class: 'cms-title__aside' });
  void ctx.services.survey.execute({ spotId: ctx.info.id }).then((survey) => {
    body.removeAttribute('aria-busy');
    if (!survey.ok) return body.replaceChildren(h('p', { class: 'cms-error', text: '読み込めませんでした' }));
    aside.replaceChildren(...(survey.value.sampleCount > 0 ? [badge('サンプル', 'muted')] : []), h('span', { class: 'cms-muted', text: windowText(survey.value) }));
    return body.replaceChildren(renderSurvey(ctx, survey.value));
  });
  return log.exit(h('div', { class: 'cms-onecol', attrs: { 'data-testid': 'cms-screen-survey' } }, [pageTitle('アンケート', aside), body]));
}
