/**
 * @file アンケートのまとめ（presentation/cms 層。docs/09 CMS-V04・V05）
 * 集計（CmsSurveyDto）から、お店が次に動くための2つの一覧を作る（純粋関数。DOM に触れない）。しきい値はすべて（仮）。
 * - 改善ポイント：「気になったところ」のうち声の多いもの（多い順に3つまで）と、CMS でできる手だて（お店の情報の編集／クーポン・イベントの掲載）
 * - 施策の打ち時：満足度の変化（下がり気味なら今すぐ）、満足度の低い曜日（次のその曜日までに）、高い曜日（その日に掲載）、また来たい人が多いとき（今）
 * 言葉は短い名詞句だけにする（説明文を足さない）。回答が少ないうち（SURVEY_INSIGHT_MIN 件未満）は何も出さない（数件の声で決めつけない）。
 * 掲載の手だては協力店だけに出す（クーポン・イベントは協力店だけが登録できる＝docs/09 CMS-E01）。
 */
import type { CmsSurveyDto, CmsSurveySlotDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { addDays, parseLocalDate } from '@/Common/utils/date';
import { nextDateOfWeekday } from '@/presentation/cms/cmsTemplates';

const logger = createLogger('presentation/cms/cmsSurveyInsights');

/** まとめを出すのに要る回答の数（仮） */
export const SURVEY_INSIGHT_MIN = 5;
/** 改善ポイントに挙げる声の割合の下限（%。仮） */
const CONCERN_MIN_PCT = 12;
/** 改善ポイントに挙げる声の数の下限（仮） */
const CONCERN_MIN_COUNT = 3;
/** 改善ポイントの数の上限 */
const IMPROVEMENT_LIMIT = 3;
/** 施策の打ち時の数の上限 */
const TIMING_LIMIT = 3;
/** 満足度が「変わった」とみなす差（直近14日とその前の14日。仮） */
const TREND_GAP = 0.3;
/** 曜日の満足度が「低い」とみなす、全体との差（仮） */
const WEAK_GAP = 0.3;
/** 曜日の満足度が「高い」とみなす、全体との差（仮） */
const BEST_GAP = 0.2;
/** 「また来たい人が多い」とみなす割合（%。仮） */
const REVISIT_HIGH_PCT = 70;
/** 再来店のクーポンの掲載期間（日。今日を含む。仮） */
const REVISIT_COUPON_DAYS = 14;

/** まとめから進める先 */
export interface SurveyAction {
  /** events: クーポン・イベントの作成／info: お店の情報の編集 */
  readonly page: 'events' | 'info';
  /** ボタンの文字 */
  readonly label: string;
  /** 掲載の期間の初期値（events のときだけ） */
  readonly period?: { readonly start: string; readonly end: string };
}

/** まとめの1行 */
export interface SurveyPoint {
  readonly key: string;
  /** 左の札（割合・日付・「今すぐ」） */
  readonly tag: string;
  /** 札の色合い（warn: 手を打つ／live: 好機／muted: 割合） */
  readonly tone: 'warn' | 'live' | 'muted';
  /** 見出し */
  readonly text: string;
  /** 補足（数字・手だて） */
  readonly sub: string;
  readonly action?: SurveyAction;
}

/** 気になったところごとの手だて */
const REMEDIES: Readonly<Record<string, { readonly sub: string; readonly page: SurveyAction['page'] }>> = {
  wait: { sub: '空いている時間のクーポンで分散', page: 'events' },
  price: { sub: 'クーポンでお得感を出す', page: 'events' },
  entry: { sub: '便利情報で入りやすさを伝える', page: 'info' },
  info: { sub: 'お店の情報を充実させる', page: 'info' },
  lineup: { sub: '新しい品をイベントで知らせる', page: 'events' },
  hours: { sub: '営業時間を見直す', page: 'info' },
};

/**
 * 手だてのボタンを作る（掲載は協力店だけ）。
 * @param page 進める先
 * @param partner 協力店か
 * @param opts 掲載の期間・ボタンの文字
 * @returns 進める先（出せなければ undefined）
 */
function actionOf(page: SurveyAction['page'], partner: boolean, opts: { readonly period?: SurveyAction['period']; readonly label?: string } = {}): SurveyAction | undefined { // audit-ignore: fnlog-missing 行ごとに呼ぶ小さな組み立て
  if (page === 'info') return { page, label: '編集' };
  if (!partner) return undefined;
  return { page, label: opts.label ?? '掲載する', ...(opts.period === undefined ? {} : { period: opts.period }) };
}

/**
 * 改善ポイント（声の多い「気になったところ」と手だて）を作る。
 * @param survey 集計
 * @param partner 協力店か
 * @returns 多い順に IMPROVEMENT_LIMIT 件まで（回答が少なければ空）
 */
export function improvementPoints(survey: CmsSurveyDto, partner: boolean): readonly SurveyPoint[] {
  const log = logger.fn('improvementPoints', { total: survey.total, partner });
  if (survey.total < SURVEY_INSIGHT_MIN) return log.exit([], 'few');
  const voiced = survey.concerns.filter((c) => c.count >= CONCERN_MIN_COUNT && c.pct >= CONCERN_MIN_PCT).sort((a, b) => b.count - a.count);
  return log.exit(voiced.slice(0, IMPROVEMENT_LIMIT).map((c): SurveyPoint => {
    const remedy = REMEDIES[c.key];
    const action = remedy === undefined ? undefined : actionOf(remedy.page, partner);
    return { key: c.key, tag: `${c.pct}%`, tone: 'muted', text: c.label, sub: remedy?.sub ?? '', ...(action === undefined ? {} : { action }) };
  }));
}

/**
 * 満足度の平均が出ている曜日のうち、いちばん低い（高い）ものを返す。
 * @param slots 曜日別
 * @param pick 'low' か 'high'
 * @returns 曜日（無ければ undefined）
 */
function extremeWeekday(slots: readonly CmsSurveySlotDto[], pick: 'low' | 'high'): CmsSurveySlotDto | undefined { // audit-ignore: fnlog-missing 小さな比較（timingPoints で記録する）
  const sign = pick === 'low' ? -1 : 1;
  return slots.filter((s) => s.avg !== undefined).reduce<CmsSurveySlotDto | undefined>((best, s) => (best === undefined || ((s.avg ?? 0) - (best.avg ?? 0)) * sign > 0 ? s : best), undefined);
}

/**
 * 'YYYY-MM-DD' を「11/14」にする（札に出す短い日付）。
 * @param date 日付
 * @returns 月/日
 */
function shortDate(date: string): string { // audit-ignore: fnlog-missing 文字の切り出しだけ
  const [, month, day] = date.split('-').map(Number);
  return `${month ?? ''}/${day ?? ''}`;
}

/**
 * 満足度の変化の行を作る（下がり気味なら「今すぐ」）。
 * @param survey 集計
 * @returns 行（変化が小さい・比べられないなら undefined）
 */
function trendPoint(survey: CmsSurveyDto): SurveyPoint | undefined { // audit-ignore: fnlog-missing 小さな組み立て（timingPoints で記録する）
  if (survey.recentAvg === undefined || survey.previousAvg === undefined || survey.previousAvg - survey.recentAvg < TREND_GAP) return undefined;
  return { key: 'trend', tag: '今すぐ', tone: 'warn', text: '満足度が下がり気味', sub: `${survey.previousAvg.toFixed(1)} → ${survey.recentAvg.toFixed(1)}` };
}

/**
 * 施策の打ち時（いつ・何をきっかけに動くか）を作る。
 * @param survey 集計
 * @param partner 協力店か
 * @returns 優先順に TIMING_LIMIT 件まで（回答が少なければ空）
 */
export function timingPoints(survey: CmsSurveyDto, partner: boolean): readonly SurveyPoint[] {
  const log = logger.fn('timingPoints', { total: survey.total, partner });
  const overall = survey.satisfactionAvg;
  if (survey.total < SURVEY_INSIGHT_MIN || overall === undefined) return log.exit([], 'few');
  const points: SurveyPoint[] = [];
  const trend = trendPoint(survey);
  if (trend !== undefined) points.push(trend);
  const weak = extremeWeekday(survey.byWeekday, 'low');
  if (weak?.avg !== undefined && overall - weak.avg >= WEAK_GAP) {
    points.push({ key: 'weak', tag: `${shortDate(nextDateOfWeekday(survey.today, weak.label))}まで`, tone: 'warn', text: `${weak.label}曜の満足度が低い`, sub: weak.topConcern === undefined ? weak.avg.toFixed(1) : `${weak.avg.toFixed(1)}・${weak.topConcern}` });
  }
  const best = extremeWeekday(survey.byWeekday, 'high');
  if (best?.avg !== undefined && best.label !== weak?.label && best.avg - overall >= BEST_GAP) {
    const day = nextDateOfWeekday(survey.today, best.label);
    const action = actionOf('events', partner, { period: { start: day, end: day }, label: `${best.label}曜に掲載` });
    points.push({ key: 'best', tag: shortDate(day), tone: 'live', text: `${best.label}曜は満足度が高い`, sub: best.avg.toFixed(1), ...(action === undefined ? {} : { action }) });
  }
  const today = parseLocalDate(survey.today);
  if (survey.revisitPct !== undefined && survey.revisitPct >= REVISIT_HIGH_PCT && today.ok) {
    const action = actionOf('events', partner, { period: { start: survey.today, end: addDays(today.value, REVISIT_COUPON_DAYS - 1) } });
    points.push({ key: 'revisit', tag: '今', tone: 'live', text: 'また来たい人が多い', sub: `${survey.revisitPct}%・再来店のクーポン`, ...(action === undefined ? {} : { action }) });
  }
  return log.exit(points.slice(0, TIMING_LIMIT), `count=${points.length}`);
}
