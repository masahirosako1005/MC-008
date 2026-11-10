/**
 * @file 短い名前を語の区切りで折るための分割（presentation/screens/Avatar 層）
 * 部品の名前・称号・図鑑のカード名は幅の狭い札に出すので、折り返すと「ふわふわパー／マ」「もこも／こアフロ」のように語の途中で割れる。
 * ここで名前を語のまとまりに分け、まとまりの間にだけ折り返しの位置（wbr）を入れる（CSS は word-break: keep-all で、ほかの位置では折らない）。
 * 区切りは文字の種類の変わり目（ひらがな→カタカナ・漢字 など）と助詞「の」の後ろ。漢字→ひらがな（送りがな・助詞）では切らない。
 * 長いカタカナの連なり（テーラードジャケット）だけはブラウザの単語分割（Intl.Segmenter）で分ける。1文字だけのまとまりは隣に付ける。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';

const logger = createLogger('presentation/screens/Avatar/phraseBreak');

/** 文字の種類 */
type CharKind = 'kanji' | 'hira' | 'kata' | 'other';

/** カタカナの連なりを単語分割にかける最小の長さ（これより短いものは1語として扱う） */
const LONG_KATAKANA = 6;

/**
 * 文字の種類を調べる（長音「ー」はカタカナ、「々」は漢字として扱う）。
 * @param ch 1文字
 * @returns 種類
 */
function kindOf(ch: string): CharKind { // audit-ignore: fnlog-missing 1文字ごとに呼ぶ小さな判定
  if (/[ぁ-ゟ]/.test(ch)) return 'hira';
  if (/[ァ-ヺー-ヿ]/.test(ch)) return 'kata';
  if (/[一-鿿々]/.test(ch)) return 'kanji';
  return 'other';
}

/**
 * i 文字目の前で折ってよいか（文字の種類の変わり目、または名詞に付いた「の」の後ろ）。
 * @param chars 名前の文字
 * @param i 位置（1 以上）
 * @returns 折ってよければ true
 */
function isBoundary(chars: readonly string[], i: number): boolean { // audit-ignore: fnlog-missing 1文字ごとに呼ぶ小さな判定
  const prev = kindOf(chars[i - 1] ?? '');
  const cur = kindOf(chars[i] ?? '');
  if (prev === 'other' || cur === 'other') return false;
  if (prev !== cur) return !(prev === 'kanji' && cur === 'hira');
  const before = kindOf(chars[i - 2] ?? '');
  return chars[i - 1] === 'の' && (before === 'kanji' || before === 'kata');
}

/**
 * 長いカタカナだけのまとまりを単語に分ける（短いもの・カタカナ以外・分割が使えない環境ではそのまま）。
 * @param piece まとまり
 * @returns 分けた結果
 */
function splitKatakana(piece: string): string[] { // audit-ignore: fnlog-missing まとまりごとに呼ぶ小さな分割（splitPhrases がログを出す）
  const chars = [...piece];
  if (chars.length < LONG_KATAKANA || chars.some((ch) => kindOf(ch) !== 'kata') || typeof Intl.Segmenter !== 'function') return [piece];
  return [...new Intl.Segmenter('ja', { granularity: 'word' }).segment(piece)].map((s) => s.segment);
}

/**
 * 1文字だけのまとまりを隣に付ける（先頭と「の」の直後は後ろへ＝「ご近所」、それ以外は前へ＝「クエ王」）。
 * @param pieces まとまり
 * @returns 付け直した結果
 */
function mergeShort(pieces: readonly string[]): string[] { // audit-ignore: fnlog-missing 名前ごとに呼ぶ小さな整形（splitPhrases がログを出す）
  const out: string[] = [];
  let carry = '';
  for (const piece of pieces) {
    const last = out[out.length - 1];
    if ([...piece].length > 1 || carry !== '') {
      out.push(carry + piece);
      carry = '';
    } else if (last === undefined || last.endsWith('の')) carry = piece;
    else out[out.length - 1] = last + piece;
  }
  // 後ろへ付ける相手がいないまま終わった1文字（「江戸の町」の「町」）は前に付ける
  const tail = out[out.length - 1];
  if (carry !== '' && tail !== undefined) out[out.length - 1] = tail + carry;
  else if (carry !== '') out.push(carry);
  return out;
}

/**
 * 名前を、折り返してよいまとまりに分ける（つなげると元の名前に戻る）。
 * @param text 名前
 * @returns まとまりの並び
 */
export function splitPhrases(text: string): string[] {
  const log = logger.fn('splitPhrases', { length: text.length });
  const chars = [...text];
  if (chars.length === 0) return log.exit([text], '空');
  const raw: string[] = [];
  let current = '';
  chars.forEach((ch, i) => {
    if (i > 0 && isBoundary(chars, i)) {
      raw.push(current);
      current = '';
    }
    current += ch;
  });
  raw.push(current);
  return log.exit(mergeShort(raw.flatMap(splitKatakana)));
}

/**
 * 名前を、語の区切りにだけ折り返しの位置を入れた子要素の並びにする（h() の children に渡す）。
 * @param text 名前
 * @returns 文字列と wbr の並び
 */
export function phraseNodes(text: string): (string | HTMLElement)[] {
  const log = logger.fn('phraseNodes', { length: text.length });
  return log.exit(splitPhrases(text).flatMap((piece, i) => (i === 0 ? [piece] : [h('wbr'), piece])));
}
