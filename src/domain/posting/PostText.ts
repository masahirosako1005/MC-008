/**
 * @file 投稿本文の値オブジェクト（domain/posting 層）
 * 「ここが良かった」などの投稿本文を、検証済みの文字列としてだけ保持する（docs/01 §2 投稿コンテキスト、docs/06 DI-17）。
 * PostText.of でしか作れない。改行・タブは空白に、その他の制御文字と双方向テキスト制御文字は除去し、
 * NFC 正規化・前後の空白除去のあと、1〜200文字（コードポイント単位。絵文字1つ＝1文字）であることを保証する。
 * 本文は個人情報を含みうるため、ログ・エラーには長さだけを出す。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { Brand } from '@/Common/types/Brand';
import { codePointLength } from '@/Common/utils/guards';
import { POST_TEXT_MAX_LENGTH, POST_TEXT_MAX_RAW_LENGTH, POST_TEXT_MIN_LENGTH } from '@/domain/posting/constants';

const logger = createLogger('domain/posting/PostText');

/** 検証済みの投稿本文 */
export type PostText = Brand<string, 'PostText'>;

/** 不正の種類（AppError.details.reason に入れる） */
export type PostTextRejection = 'notString' | 'malformed' | 'empty' | 'tooLong';

/** 改行・タブ類（空白1つに置き換える。CRLF は1つの改行として扱う） */
const LINE_BREAKS = /\r\n|[\r\n\t\v\f\u0085\u2028\u2029]/g;
/** 残りの制御文字（C0・DEL・C1） */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
/** 双方向テキストの埋め込み・上書き・分離の制御文字（表示のなりすましに使われるため除去） */
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/g;
/** 対になっていないサロゲート（壊れた UTF-16） */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * 不正な投稿本文の失敗値を作る（本文そのものは入れない）。
 * @param reason 不正の種類
 * @param length 正規化後の文字数（分かる場合のみ）
 * @returns INVALID_INPUT の失敗 Result
 */
function reject(reason: PostTextRejection, length?: number): Result<never> {
  const log = logger.fn('reject', { reason, length });
  const messages: Readonly<Record<PostTextRejection, string>> = {
    notString: '投稿の本文が正しくありません',
    malformed: '投稿の本文に使えない文字が含まれています',
    empty: '投稿の本文を入力してください',
    tooLong: `投稿の本文は${POST_TEXT_MAX_LENGTH}文字以内で入力してください`,
  };
  const details = { kind: 'PostText', reason, maxLength: POST_TEXT_MAX_LENGTH, ...(length === undefined ? {} : { length }) };
  return log.exit(fail(AppError.of('INVALID_INPUT', messages[reason], details)));
}

/**
 * 本文を整える（改行・タブ → 空白、制御文字と双方向制御文字を除去、NFC 正規化、前後の空白を除去）。
 * 除去で基底文字と結合文字が隣り合うことがあるため、NFC は除去の後に行う。
 * @param text 文字列（壊れたサロゲートを含まないこと）
 * @returns 整えた文字列
 */
export function sanitizePostText(text: string): string {
  const log = logger.fn('sanitizePostText', { length: text.length });
  const cleaned = text.replace(LINE_BREAKS, ' ').replace(CONTROL_CHARS, '').replace(BIDI_CONTROLS, '');
  return log.exit(cleaned.normalize('NFC').trim());
}

/**
 * 未検証の入力から投稿本文を作る（DI-17）。
 * @param raw 未検証の値（利用者の入力）
 * @returns 成功: PostText（整えた後の文字列）。失敗: INVALID_INPUT（details.reason: notString / malformed / empty / tooLong）
 * @see docs/06 DI-17, docs/08 §3.8
 */
function ofPostText(raw: unknown): Result<PostText> {
  const log = logger.fn('PostText.of', { type: typeof raw, rawLength: typeof raw === 'string' ? raw.length : undefined });
  if (typeof raw !== 'string') return log.fail(reject('notString'));
  if (raw.length > POST_TEXT_MAX_RAW_LENGTH) return log.fail(reject('tooLong'));
  if (LONE_SURROGATE.test(raw)) return log.fail(reject('malformed'));
  const text = sanitizePostText(raw);
  const length = codePointLength(text);
  if (length < POST_TEXT_MIN_LENGTH) return log.fail(reject('empty', length));
  if (length > POST_TEXT_MAX_LENGTH) return log.fail(reject('tooLong', length));
  return log.exit(ok(text as PostText), `length=${length}`);
}

/** 投稿本文のファクトリ（型と同名の値。`PostText.of(...)` と書ける） */
export const PostText = Object.freeze({ of: ofPostText });
