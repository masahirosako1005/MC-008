/**
 * @file お店のアンケートの設問と回答の型（application/usecases/survey 層）
 * 設問・選択肢・字数はすべて（仮）。利用者アプリのスポット詳細（お店だけ）で答え、店舗CMS の「アンケート」で集計を見る。
 * 回答は匿名（旅人ID・位置を持たない＝PRV-03）。持つのは お店・答えた日時・選んだ項目・ひとこと だけ。
 * 入力は信用せず、ここの parseSurveyAnswers で検証する（SEC-16、DI-01）。保存データの読込みも同じ関数で確かめる。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { SpotId } from '@/Common/types/Id';
import type { Instant } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';

const logger = createLogger('application/usecases/survey/shopSurvey');

/** 満足度の下限（仮） */
export const SURVEY_SATISFACTION_MIN = 1;
/** 満足度の上限（仮） */
export const SURVEY_SATISFACTION_MAX = 5;
/** ひとことの文字数の上限（仮） */
export const SURVEY_COMMENT_MAX = 200;

/** 選択肢（key は保存する値、label は画面の文字） */
export interface SurveyChoice {
  readonly key: string;
  readonly label: string;
}

/** 来店のきっかけ（1つ選ぶ。仮） */
export const SURVEY_TRIGGERS: readonly SurveyChoice[] = [
  { key: 'app', label: 'アプリで見つけた' },
  { key: 'passing', label: '通りがかり' },
  { key: 'coupon', label: 'クーポン・イベント' },
  { key: 'regular', label: 'いつも来ている' },
  { key: 'referral', label: '人のすすめ' },
];

/** よかったところ（いくつでも。仮） */
export const SURVEY_GOODS: readonly SurveyChoice[] = [
  { key: 'quality', label: '品・味' },
  { key: 'service', label: '接客' },
  { key: 'mood', label: '雰囲気' },
  { key: 'price', label: '価格' },
  { key: 'entry', label: '入りやすさ' },
];

/** 気になったところ（いくつでも。選ばなければ「特になし」。仮） */
export const SURVEY_CONCERNS: readonly SurveyChoice[] = [
  { key: 'wait', label: '待ち時間' },
  { key: 'price', label: '価格' },
  { key: 'entry', label: '入りにくさ' },
  { key: 'info', label: '情報の少なさ' },
  { key: 'lineup', label: '品ぞろえ' },
  { key: 'hours', label: '営業時間' },
];

/** また来たいか（1つ選ぶ。仮） */
export const SURVEY_REVISITS: readonly SurveyChoice[] = [
  { key: 'yes', label: 'また来たい' },
  { key: 'maybe', label: 'たぶん' },
  { key: 'unsure', label: 'わからない' },
];

/** 「また来たい」と数える答え */
export const SURVEY_REVISIT_YES = 'yes';

/** アンケートの答え（検証済み） */
export interface SurveyAnswers {
  /** 満足度（1〜5 の整数） */
  readonly satisfaction: number;
  /** 来店のきっかけ（SURVEY_TRIGGERS の key） */
  readonly trigger: string;
  /** よかったところ（SURVEY_GOODS の key。重複なし） */
  readonly goods: readonly string[];
  /** 気になったところ（SURVEY_CONCERNS の key。重複なし） */
  readonly concerns: readonly string[];
  /** また来たいか（SURVEY_REVISITS の key） */
  readonly revisit: string;
  /** ひとこと（無ければ省略） */
  readonly comment?: string;
}

/** アンケートの送信の入力（画面から来る未検証の値） */
export interface SubmitShopSurveyInput extends SurveyAnswers {
  readonly operationId: string;
  readonly spotId: string;
}

/** 保存する回答1件 */
export interface SurveyResponse extends SurveyAnswers {
  /** 回答の ID（送信の操作ID。同じ送信の二重登録を防ぐ＝DI-07） */
  readonly id: string;
  readonly spotId: SpotId;
  readonly answeredAt: Instant;
}

/** ひとことから取り除く制御文字（改行・タブ以外） */
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/**
 * 答えが正しくないときの失敗を作る。
 * @param rule 破った規則
 * @returns INVALID_INPUT の失敗
 */
function invalid(rule: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', 'アンケートの内容が正しくありません', { rule }));
}

/**
 * 値が選択肢の key か判定する。
 * @param choices 選択肢
 * @param raw 未検証の値
 * @returns key なら true
 */
function isChoiceKey(choices: readonly SurveyChoice[], raw: unknown): raw is string { // audit-ignore: fnlog-missing 項目ごとに呼ぶ小さな判定（parseSurveyAnswers で記録する）
  return typeof raw === 'string' && choices.some((c) => c.key === raw);
}

/**
 * 複数選択の答えを検証する（選択肢にある key だけ・重複なし）。
 * @param choices 選択肢
 * @param raw 未検証の値
 * @returns 検証済みの key の一覧（選択肢の並び順）。不正なら undefined
 */
function parseChoiceKeys(choices: readonly SurveyChoice[], raw: unknown): readonly string[] | undefined { // audit-ignore: fnlog-missing 項目ごとに呼ぶ小さな判定（parseSurveyAnswers で記録する）
  if (!Array.isArray(raw) || raw.length > choices.length) return undefined;
  const items = raw as readonly unknown[];
  if (!items.every((item) => isChoiceKey(choices, item)) || new Set(items).size !== items.length) return undefined;
  return choices.filter((c) => items.includes(c.key)).map((c) => c.key);
}

/**
 * ひとことを整える（改行をそろえ、制御文字を除き、前後の空白を落とす）。
 * @param raw 入力のひとこと
 * @returns 整えたひとこと
 */
export function normalizeSurveyComment(raw: string): string {
  const log = logger.fn('normalizeSurveyComment', { length: raw.length });
  return log.exit(raw.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim(), 'normalized');
}

/**
 * アンケートの答えを検証する（画面の入力・保存データのどちらにも使う）。
 * @param raw 未検証の値
 * @returns 成功: 検証済みの答え（凍結済み）。失敗: INVALID_INPUT
 */
export function parseSurveyAnswers(raw: unknown): Result<SurveyAnswers> {
  const log = logger.fn('parseSurveyAnswers');
  if (!isRecord(raw)) return log.fail(invalid('shape'));
  const satisfaction = raw['satisfaction'];
  if (typeof satisfaction !== 'number' || !Number.isInteger(satisfaction) || satisfaction < SURVEY_SATISFACTION_MIN || satisfaction > SURVEY_SATISFACTION_MAX) return log.fail(invalid('satisfaction'));
  const trigger = raw['trigger'];
  if (!isChoiceKey(SURVEY_TRIGGERS, trigger)) return log.fail(invalid('trigger'));
  const goods = parseChoiceKeys(SURVEY_GOODS, raw['goods']);
  if (goods === undefined) return log.fail(invalid('goods'));
  const concerns = parseChoiceKeys(SURVEY_CONCERNS, raw['concerns']);
  if (concerns === undefined) return log.fail(invalid('concerns'));
  const revisit = raw['revisit'];
  if (!isChoiceKey(SURVEY_REVISITS, revisit)) return log.fail(invalid('revisit'));
  const rawComment = raw['comment'];
  if (rawComment !== undefined && typeof rawComment !== 'string') return log.fail(invalid('comment'));
  const comment = rawComment === undefined ? '' : normalizeSurveyComment(rawComment);
  if ([...comment].length > SURVEY_COMMENT_MAX) return log.fail(invalid('commentLength'));
  return log.exit(ok(Object.freeze({ satisfaction, trigger, goods, concerns, revisit, ...(comment === '' ? {} : { comment }) })));
}
