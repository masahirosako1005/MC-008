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

/** 次の行に落としてよい最後のまとまりの最小の文字数（これより短いまとまりは前から離さない＝1〜3文字だけの行を作らない） */
const MIN_TAIL = 4;

/** 部品のマスで、語の途中では分けない短い名前の最大の文字数（「金魚すくいの金魚」「天満切子のグラス」＝8字。「大」のマスなら1行に入る） */
const SHORT_NAME = 8;

/** この語の前では折らない（敬称・接尾語。「天神／さんの常連王」にしない） */
const NO_BREAK_BEFORE: readonly string[] = ['さん', 'ちゃん', 'くん', 'さま', 'たち'];

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
 * 1つにまとめた名前を、前の方の語の切れ目で2つに分ける（「金魚すくいの金魚」→「金魚／すくいの金魚」）。
 * 切れ目はブラウザの単語分割。両側が2文字以上の語で、後ろに MIN_TAIL 文字以上が残る所だけ。敬称の前（天神／さん）では切らない。
 * @param text 名前
 * @returns 2つに分けた結果（分けられる所が無ければ undefined）
 */
function splitAtHead(text: string): string[] | undefined { // audit-ignore: fnlog-missing 名前ごとに呼ぶ小さな分割（avoidShortTail がログを出す）
  if (typeof Intl.Segmenter !== 'function') return undefined;
  const words = [...new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)].map((s) => [...s.segment]);
  const total = words.reduce((sum, w) => sum + w.length, 0);
  let best: { readonly at: number; readonly gap: number } | undefined;
  let at = 0;
  for (let i = 0; i < words.length - 1; i += 1) {
    const prev = words[i] ?? [];
    const next = words[i + 1] ?? [];
    at += prev.length;
    const bothWords = [prev, next].every((w) => w.length >= 2 && w.every((ch) => kindOf(ch) !== 'other'));
    if (!bothWords || total - at < MIN_TAIL || NO_BREAK_BEFORE.some((s) => next.join('').startsWith(s))) continue;
    const gap = Math.abs(total - at * 2);
    if (best === undefined || gap < best.gap) best = { at, gap };
  }
  if (best === undefined) return undefined;
  const chars = words.flat();
  return [chars.slice(0, best.at).join(''), chars.slice(best.at).join('')];
}

/**
 * 最後のまとまりが短い（1〜3文字）ときに、そこでは折らないようにまとまりを組み直す（「金魚すくいの／金魚」と短い行を落とさない）。
 * 手前に別の区切りがあればそこで折り、無ければ前の方の語の切れ目を探す。どちらも無ければ元のまま返す。
 * @param pieces splitPhrases の結果
 * @returns 組み直したまとまり（つなげると元の名前に戻る）
 */
export function avoidShortTail(pieces: readonly string[]): string[] {
  const log = logger.fn('avoidShortTail', { count: pieces.length });
  const last = pieces[pieces.length - 1];
  const before = pieces[pieces.length - 2];
  if (last === undefined || before === undefined || [...last].length >= MIN_TAIL) return log.exit([...pieces], 'そのまま');
  const merged = [...pieces.slice(0, -2), before + last];
  if (merged.length > 1) return log.exit(merged, '手前の区切りで折る');
  return log.exit(splitAtHead(before + last) ?? [...pieces]);
}

/**
 * アバターの部品の名前を、折り返してよいまとまりに分ける（部品のマス用）。
 * 区切りが1つだけの短い名前（SHORT_NAME 字まで）は、その区切りのまま返す＝「金魚／すくいの金魚」「天満／切子のグラス」と一続きの言葉を割らない
 * （幅があれば1行、無ければ「金魚すくいの／金魚」）。それ以外は avoidShortTail と同じ。
 * @param text 部品の名前
 * @returns まとまりの並び（つなげると元の名前に戻る）
 */
export function partNamePhrases(text: string): string[] {
  const log = logger.fn('partNamePhrases', { length: text.length });
  const pieces = splitPhrases(text);
  if (pieces.length === 2 && [...text].length <= SHORT_NAME) return log.exit(pieces, '短い名前は元の区切り');
  return log.exit(avoidShortTail(pieces));
}

/**
 * アバターの部品の名前を、語の区切りにだけ折り返しの位置を入れた子要素の並びにする（部品のマス用。h() の children に渡す）。
 * @param text 部品の名前
 * @returns 文字列と wbr の並び
 */
export function partNameNodes(text: string): (string | HTMLElement)[] {
  const log = logger.fn('partNameNodes', { length: text.length });
  return log.exit(partNamePhrases(text).flatMap((piece, i) => (i === 0 ? [piece] : [h('wbr'), piece])));
}

/**
 * 名前を、語の区切りにだけ折り返しの位置を入れた子要素の並びにする（h() の children に渡す）。
 * @param text 名前
 * @returns 文字列と wbr の並び
 */
export function phraseNodes(text: string): (string | HTMLElement)[] {
  const log = logger.fn('phraseNodes', { length: text.length });
  return log.exit(avoidShortTail(splitPhrases(text)).flatMap((piece, i) => (i === 0 ? [piece] : [h('wbr'), piece])));
}

/**
 * 文の最後の MIN_TAIL 文字を折り返さないまとまりにする（「ランク「ベテラン冒険者」／になる」と短い行を落とさない）。
 * @param text 文（手に入れ方など）
 * @returns 文字列と、折り返さない末尾の要素（短い文はそのまま）
 */
export function tailKeptNodes(text: string): (string | HTMLElement)[] {
  const log = logger.fn('tailKeptNodes', { length: text.length });
  const chars = [...text];
  if (chars.length <= MIN_TAIL) return log.exit([text], '短い');
  return log.exit([chars.slice(0, -MIN_TAIL).join(''), h('span', { class: 'phrase-tail', text: chars.slice(-MIN_TAIL).join('') })]);
}

/**
 * 名前のいちばん長いまとまりの文字数（1行に入らない長い語があるかの判定に使う）。
 * @param text 名前
 * @returns 文字数
 */
export function longestPhrase(text: string): number {
  const log = logger.fn('longestPhrase', { length: text.length });
  return log.exit(Math.max(...avoidShortTail(splitPhrases(text)).map((piece) => [...piece].length)));
}
