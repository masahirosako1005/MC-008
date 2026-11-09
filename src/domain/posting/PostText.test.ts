import { describe, expect, it } from 'vitest';
import { POST_TEXT_MAX_LENGTH, POST_TEXT_MAX_RAW_LENGTH } from '@/domain/posting/constants';
import { PostText, sanitizePostText } from '@/domain/posting/PostText';

/** テスト用: コードポイントから文字列を作る（ソース中に制御文字・結合文字を直接書かない） */
function cp(...codePoints: number[]): string {
  return String.fromCodePoint(...codePoints);
}

/** テスト用: 成功値を取り出す */
function valueOf(raw: unknown): string {
  const r = PostText.of(raw);
  if (!r.ok) throw new Error(`想定外の失敗: ${String(r.error.details?.['reason'])}`);
  return r.value;
}

/** テスト用: 失敗理由を取り出す */
function reasonOf(raw: unknown): unknown {
  const r = PostText.of(raw);
  if (r.ok) return 'ok';
  expect(r.error.code).toBe('INVALID_INPUT');
  return r.error.details?.['reason'];
}

const GRINNING = cp(0x1f600);
/** 家族の絵文字（ZWJ 結合列。コードポイントは5つ） */
const FAMILY = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);

describe('PostText.of（正常系）', () => {
  it('前後の空白（全角空白を含む）を除いた本文を返す', () => {
    expect(valueOf(`  ${cp(0x3000)}城跡の紅葉がきれいでした${cp(0x3000)} `)).toBe('城跡の紅葉がきれいでした');
  });

  it('改行・タブは空白1つに置き換える（CRLF も1つ）', () => {
    expect(valueOf('足湯\nよかった')).toBe('足湯 よかった');
    expect(valueOf('足湯\r\nよかった')).toBe('足湯 よかった');
    expect(valueOf('足湯\tよかった')).toBe('足湯 よかった');
    expect(valueOf(`足湯${cp(0x2028)}よかった`)).toBe('足湯 よかった');
  });

  it('制御文字（NUL・BEL・DEL・C1）を除去する', () => {
    expect(valueOf(`${cp(0x00)}魚${cp(0x07)}市${cp(0x7f)}場${cp(0x9f)}`)).toBe('魚市場');
  });

  it('双方向テキストの上書き・分離の制御文字を除去する（表示のなりすまし対策）', () => {
    expect(valueOf(`${cp(0x202e)}abc${cp(0x2066)}def${cp(0x2069)}`)).toBe('abcdef');
  });

  it('結合文字は NFC で1文字にまとめる（e + 結合アキュート、か + 濁点、ハングル字母）', () => {
    expect(valueOf(`caf${cp(0x65, 0x301)}`)).toBe(`caf${cp(0xe9)}`);
    expect(valueOf(cp(0x304b, 0x3099))).toBe(cp(0x304c));
    expect(valueOf(cp(0x1100, 0x1161))).toBe(cp(0xac00));
  });

  it('基底文字と結合文字の間の制御文字を除いてから NFC 正規化する', () => {
    expect(valueOf(cp(0x65, 0x00, 0x301))).toBe(cp(0xe9));
  });

  it('絵文字（サロゲートペア）は1文字と数え、200個ちょうどは受け付ける', () => {
    const text = GRINNING.repeat(POST_TEXT_MAX_LENGTH);
    expect(text.length).toBe(POST_TEXT_MAX_LENGTH * 2);
    expect(valueOf(text)).toBe(text);
  });

  it('ZWJ 結合列はコードポイント単位で数え、結合用の ZWJ は除去しない', () => {
    expect(valueOf(FAMILY)).toBe(FAMILY);
    expect(valueOf(FAMILY.repeat(40))).toBe(FAMILY.repeat(40));
    expect(reasonOf(`${FAMILY.repeat(40)}a`)).toBe('tooLong');
  });

  it('200文字ちょうどは受け付け、前後の空白は数えない', () => {
    expect(valueOf('あ'.repeat(POST_TEXT_MAX_LENGTH))).toHaveLength(POST_TEXT_MAX_LENGTH);
    expect(valueOf(`   ${'a'.repeat(POST_TEXT_MAX_LENGTH)}\n`)).toHaveLength(POST_TEXT_MAX_LENGTH);
    expect(valueOf('a')).toBe('a');
  });

  it('sanitizePostText は同じ入力に同じ結果を返す（冪等）', () => {
    const once = sanitizePostText(` a\r\nb${cp(0x00)} `);
    expect(sanitizePostText(once)).toBe(once);
  });
});

describe('PostText.of（不正値）', () => {
  it('201文字は拒否する（ASCII・絵文字とも）', () => {
    expect(reasonOf('a'.repeat(POST_TEXT_MAX_LENGTH + 1))).toBe('tooLong');
    expect(reasonOf(GRINNING.repeat(POST_TEXT_MAX_LENGTH + 1))).toBe('tooLong');
    const r = PostText.of('a'.repeat(POST_TEXT_MAX_LENGTH + 1));
    expect(!r.ok && r.error.details?.['length']).toBe(POST_TEXT_MAX_LENGTH + 1);
  });

  it('空・空白だけ・改行だけ・制御文字だけは拒否する', () => {
    for (const raw of ['', '   ', '\n\t\r\n', cp(0x3000), cp(0x00, 0x07, 0x1b), cp(0x202e)]) {
      expect(reasonOf(raw)).toBe('empty');
    }
  });

  it('文字列以外は拒否する', () => {
    for (const raw of [undefined, null, 123, {}, ['a'], true]) {
      expect(reasonOf(raw)).toBe('notString');
    }
  });

  it('対になっていないサロゲートは拒否する', () => {
    expect(reasonOf(`a${String.fromCharCode(0xd800)}b`)).toBe('malformed');
    expect(reasonOf(String.fromCharCode(0xdc00))).toBe('malformed');
  });

  it('正規化前の長さが上限を超える巨大な入力は処理前に拒否する', () => {
    expect(reasonOf(`${' '.repeat(POST_TEXT_MAX_RAW_LENGTH)}a`)).toBe('tooLong');
  });

  it('失敗の詳細に本文そのものを含めない', () => {
    const r = PostText.of('秘密の本文'.repeat(50));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(!r.ok && r.error)).not.toContain('秘密の本文');
  });
});
