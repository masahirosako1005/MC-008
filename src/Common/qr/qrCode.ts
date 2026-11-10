/**
 * @file QR コードの符号化（Common 層。純粋関数・依存パッケージなし）
 * 文字列（UTF-8）をバイトモードで QR コード（JIS X 0510 / ISO/IEC 18004、モデル2）の黒白のマス目にする。
 * 版は 1〜40 のすべてに対応する。
 * 誤り訂正は 4段階（既定は M）。マスクは仕様の失点（N1〜N4）が最小のものを選ぶ。リード・ソロモン符号は GF(2^8)（原始多項式 0x11D）。
 * 作りは Project Nayuki の QR Code generator（MIT）の手順に沿って書き起こした。描画は Common/ui/canvas/drawQr。
 * 使い道: チケットの QR（2026-11-10 ユーザー指示「自分が獲得したチケットをQRコードで表示して使えるように」）、将来の店頭QR（docs/09 Q10）。
 * 中身（文字列）はログに出さない（長さ・版・マスクだけ）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';

const logger = createLogger('Common/qr/qrCode');

/** 誤り訂正のレベル（L 約7%／M 約15%／Q 約25%／H 約30% の欠けを直せる） */
export type QrEcc = 'L' | 'M' | 'Q' | 'H';

/** 版の範囲 */
export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 40;

/** 既定の誤り訂正（画面に出して読み取ってもらう用途。汚れ・反射に少し強い M） */
export const QR_DEFAULT_ECC: QrEcc = 'M';

/** 符号化した QR コード */
export interface QrMatrix {
  readonly version: number;
  /** 一辺のマスの数（17 + 4×版） */
  readonly size: number;
  readonly ecc: QrEcc;
  /** 使ったマスク（0..7） */
  readonly mask: number;
  /** size×size のマス（行優先。1=黒） */
  readonly modules: Uint8Array;
}

/** 符号化のオプション */
export interface QrEncodeOptions {
  readonly ecc?: QrEcc;
  readonly minVersion?: number;
  readonly maxVersion?: number;
  /** マスクを固定する（0..7。テスト用。省略時は失点が最小のもの） */
  readonly mask?: number;
}

/** 形式情報に入れる誤り訂正の2ビット（L=01, M=00, Q=11, H=10） */
const ECC_FORMAT_BITS: Readonly<Record<QrEcc, number>> = { L: 1, M: 0, Q: 3, H: 2 };

/** 1ブロックあたりの誤り訂正コード語の数（版ごと。添字0は使わない） */
const ECC_CODEWORDS_PER_BLOCK: Readonly<Record<QrEcc, readonly number[]>> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** 誤り訂正のブロック数（版ごと。添字0は使わない） */
const NUM_ERROR_CORRECTION_BLOCKS: Readonly<Record<QrEcc, readonly number[]>> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // audit-ignore: magic-radius 仕様の表（ブロック数）で距離ではない
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** マスクの失点の重み（仕様の N1〜N4） */
const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/**
 * 1ブロックあたりの誤り訂正コード語の数。
 * @param ecc 誤り訂正
 * @param version 版
 * @returns コード語の数
 */
export function eccCodewordsPerBlock(ecc: QrEcc, version: number): number { // audit-ignore: fnlog-missing 符号化の内部で何度も呼ぶ表引き
  return ECC_CODEWORDS_PER_BLOCK[ecc][version] ?? 0;
}

/**
 * 誤り訂正のブロック数。
 * @param ecc 誤り訂正
 * @param version 版
 * @returns ブロック数
 */
export function numErrorCorrectionBlocks(ecc: QrEcc, version: number): number { // audit-ignore: fnlog-missing 符号化の内部で何度も呼ぶ表引き
  return NUM_ERROR_CORRECTION_BLOCKS[ecc][version] ?? 0;
}

/**
 * 機能パターン（位置合わせ・タイミング・形式・版の情報）を除いた、データを置けるマスの数。
 * @param version 版
 * @returns マスの数（残りのビットを含む）
 */
export function numRawDataModules(version: number): number { // audit-ignore: fnlog-missing 符号化の内部で呼ぶ純粋な算術
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/**
 * データのコード語の数（誤り訂正を除く）。
 * @param version 版
 * @param ecc 誤り訂正
 * @returns コード語の数
 */
export function numDataCodewords(version: number, ecc: QrEcc): number { // audit-ignore: fnlog-missing 符号化の内部で呼ぶ純粋な算術
  return Math.floor(numRawDataModules(version) / 8) - eccCodewordsPerBlock(ecc, version) * numErrorCorrectionBlocks(ecc, version);
}

/**
 * 位置合わせパターンの中心の座標（行・列とも同じ並び。版1は無し）。
 * @param version 版
 * @returns 昇順の座標
 */
export function alignmentPositions(version: number): number[] { // audit-ignore: fnlog-missing 符号化の内部で呼ぶ純粋な算術
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = version * 4 + 17 - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/**
 * 形式情報の15ビット（誤り訂正2ビット＋マスク3ビット＋BCH 10ビット、0x5412 で XOR 済み）。
 * @param ecc 誤り訂正
 * @param mask マスク
 * @returns 15ビットの値
 */
export function formatBits(ecc: QrEcc, mask: number): number { // audit-ignore: fnlog-missing 符号化の内部で呼ぶ純粋な算術
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/**
 * 版情報の18ビット（版7以上。版6ビット＋BCH 12ビット）。
 * @param version 版
 * @returns 18ビットの値
 */
export function versionBits(version: number): number { // audit-ignore: fnlog-missing 符号化の内部で呼ぶ純粋な算術
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

/**
 * GF(2^8)（原始多項式 x^8+x^4+x^3+x^2+1）の掛け算。
 * @param x 0..255
 * @param y 0..255
 * @returns 積
 */
export function gfMultiply(x: number, y: number): number { // audit-ignore: fnlog-missing リード・ソロモンの内部で何千回も呼ぶ算術
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/**
 * リード・ソロモンの生成多項式（最高次の係数1を除く、高次から順の係数）。
 * @param degree 次数（誤り訂正コード語の数）
 * @returns 係数
 */
export function rsDivisor(degree: number): number[] { // audit-ignore: fnlog-missing 符号化の内部で呼ぶ純粋な算術
  const result: number[] = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j] ?? 0, root);
      if (j + 1 < result.length) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/**
 * データのコード語を生成多項式で割った余り（＝誤り訂正コード語）。
 * @param data データのコード語
 * @param divisor rsDivisor の結果
 * @returns 誤り訂正コード語
 */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] { // audit-ignore: fnlog-missing 符号化の内部で呼ぶ純粋な算術
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = (result[i] ?? 0) ^ gfMultiply(coef, factor);
    });
  }
  return result;
}

/**
 * バイト列をバイトモードのデータのコード語（モード・文字数・データ・終端・埋め草）にする。
 * @param bytes 中身
 * @param version 版
 * @param ecc 誤り訂正
 * @returns データのコード語
 */
export function dataCodewordsOf(bytes: Uint8Array, version: number, ecc: QrEcc): number[] { // audit-ignore: fnlog-missing encodeQrBytes でまとめてログ
  const bits: number[] = [];
  /**
   * 値の下位 n ビットを上から順に足す。
   * @param value 値
   * @param n ビット数
   * @sideEffect bits に足す
   */
  const push = (value: number, n: number): void => { // audit-ignore: fnlog-missing ビットごとの内部処理
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = numDataCodewords(version, ecc) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i + j] ?? 0);
    out.push(v);
  }
  return out;
}

/**
 * データのコード語をブロックに分けて誤り訂正を付け、仕様の順に並べ替える（インターリーブ）。
 * @param data データのコード語
 * @param version 版
 * @param ecc 誤り訂正
 * @returns 置く順のコード語（データ＋誤り訂正）
 */
export function addEccAndInterleave(data: readonly number[], version: number, ecc: QrEcc): number[] { // audit-ignore: fnlog-missing encodeQrBytes でまとめてログ
  const numBlocks = numErrorCorrectionBlocks(ecc, version);
  const blockEccLen = eccCodewordsPerBlock(ecc, version);
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const eccWords = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push([...dat, ...eccWords]);
  }
  const result: number[] = [];
  const len = blocks[0]?.length ?? 0;
  for (let i = 0; i < len; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i] ?? 0);
    });
  }
  return result;
}

/**
 * マスクの模様（その位置を反転するか）。
 * @param mask マスク 0..7
 * @param x 列
 * @param y 行
 * @returns 反転するなら true
 */
export function maskBit(mask: number, x: number, y: number): boolean { // audit-ignore: fnlog-missing マスごとに呼ぶ純粋な判定
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** マス目を組み立てる作業台（1回の符号化だけで使う） */
class QrGrid {
  readonly size: number;
  readonly modules: Uint8Array;
  /** 機能パターンのマス（マスクを掛けない） */
  readonly isFunction: Uint8Array;

  /**
   * 空のマス目を作る。
   * @param version 版
   * @param ecc 誤り訂正
   */
  constructor(
    readonly version: number,
    readonly ecc: QrEcc,
  ) {
    this.size = version * 4 + 17;
    this.modules = new Uint8Array(this.size * this.size);
    this.isFunction = new Uint8Array(this.size * this.size);
  }

  /**
   * 機能パターンのマスを置く。
   * @param x 列
   * @param y 行
   * @param dark 黒か
   * @sideEffect マス目を書き換える
   */
  setFunction(x: number, y: number, dark: boolean): void { // audit-ignore: fnlog-missing マスごとの内部処理
    const i = y * this.size + x;
    this.modules[i] = dark ? 1 : 0;
    this.isFunction[i] = 1;
  }

  /**
   * 位置検出・タイミング・位置合わせ・形式（仮）・版の情報を置く。
   * @sideEffect マス目を書き換える
   */
  drawFunctionPatterns(): void { // audit-ignore: fnlog-missing encodeQrBytes でまとめてログ
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const pos = alignmentPositions(this.version);
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignment(pos[i] ?? 0, pos[j] ?? 0);
      }
    }
    this.drawFormat(0);
    this.drawVersion();
  }

  /**
   * 位置検出パターン（7×7 と白い縁）を置く。
   * @param cx 中心の列
   * @param cy 中心の行
   * @sideEffect マス目を書き換える
   */
  private drawFinder(cx: number, cy: number): void { // audit-ignore: fnlog-missing 内部処理
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  /**
   * 位置合わせパターン（5×5）を置く。
   * @param cx 中心の列
   * @param cy 中心の行
   * @sideEffect マス目を書き換える
   */
  private drawAlignment(cx: number, cy: number): void { // audit-ignore: fnlog-missing 内部処理
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  /**
   * 形式情報（2か所）と黒の固定マスを置く。
   * @param mask マスク
   * @sideEffect マス目を書き換える
   */
  drawFormat(mask: number): void { // audit-ignore: fnlog-missing マスクの比較で8回呼ぶ内部処理
    const bits = formatBits(this.ecc, mask);
    /**
     * i 番目のビット。
     * @param i 0..14
     * @returns 1 なら true
     */
    const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0; // audit-ignore: fnlog-missing ビットの取り出し
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.setFunction(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFunction(8, this.size - 15 + i, bit(i));
    this.setFunction(8, this.size - 8, true);
  }

  /**
   * 版情報（版7以上。右上と左下の 6×3）を置く。
   * @sideEffect マス目を書き換える
   */
  private drawVersion(): void { // audit-ignore: fnlog-missing 内部処理
    if (this.version < 7) return;
    const bits = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  /**
   * コード語を右下から2列ずつジグザグに置く（機能パターンは飛ばす。余りのマスは白のまま）。
   * @param codewords 置く順のコード語
   * @sideEffect マス目を書き換える
   */
  drawCodewords(codewords: readonly number[]): void { // audit-ignore: fnlog-missing encodeQrBytes でまとめてログ
    let i = 0;
    const total = codewords.length * 8;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          const k = y * this.size + x;
          if (this.isFunction[k] === 1 || i >= total) continue;
          this.modules[k] = ((codewords[i >>> 3] ?? 0) >>> (7 - (i & 7))) & 1;
          i++;
        }
      }
    }
  }

  /**
   * マスクを掛ける（2回掛けると元に戻る）。
   * @param mask マスク
   * @sideEffect マス目を書き換える
   */
  applyMask(mask: number): void { // audit-ignore: fnlog-missing マスクの比較で16回呼ぶ内部処理
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const k = y * this.size + x;
        if (this.isFunction[k] === 0 && maskBit(mask, x, y)) this.modules[k] = (this.modules[k] ?? 0) ^ 1;
      }
    }
  }
}

/**
 * 黒白の連なりの履歴に1つ足す（位置検出パターンに似た並びの失点を数えるため。最初の白は外の白い縁ぶん長くする）。
 * @param length 連なりの長さ
 * @param history 直近7つの長さ（新しい順）
 * @param size 一辺
 * @sideEffect history を書き換える
 */
function addRunHistory(length: number, history: number[], size: number): void { // audit-ignore: fnlog-missing 失点計算の内部処理
  const len = history[0] === 0 ? length + size : length;
  history.pop();
  history.unshift(len);
}

/**
 * 履歴の中の「1:1:3:1:1」（前後に4の白）の数。
 * @param history 直近7つの長さ
 * @returns 0..2
 */
function countFinderLike(history: readonly number[]): number { // audit-ignore: fnlog-missing 失点計算の内部処理
  const n = history[1] ?? 0;
  const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  const h0 = history[0] ?? 0;
  const h6 = history[6] ?? 0;
  return (core && h0 >= n * 4 && h6 >= n ? 1 : 0) + (core && h6 >= n * 4 && h0 >= n ? 1 : 0);
}

/**
 * 1本の線（行か列）の失点（N1: 同色5つ以上の連なり、N3: 位置検出パターンに似た並び）。
 * @param read i 番目のマスが黒か
 * @param size 一辺
 * @returns 失点
 */
function lineScore(read: (i: number) => boolean, size: number): number { // audit-ignore: fnlog-missing 失点計算の内部処理
  let result = 0;
  let color = false;
  let run = 0;
  const history = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < size; i++) {
    const dark = read(i);
    if (dark === color) {
      run++;
      if (run === 5) result += PENALTY_N1;
      else if (run > 5) result++;
      continue;
    }
    addRunHistory(run, history, size);
    if (!color) result += countFinderLike(history) * PENALTY_N3;
    color = dark;
    run = 1;
  }
  if (color) {
    addRunHistory(run, history, size);
    run = 0;
  }
  addRunHistory(run + size, history, size);
  return result + countFinderLike(history) * PENALTY_N3;
}

/**
 * マス目の失点（仕様の N1〜N4 の合計。小さいほど読み取りやすい）。
 * @param modules マス（行優先。1=黒）
 * @param size 一辺
 * @returns 失点
 */
export function penaltyScore(modules: Uint8Array, size: number): number { // audit-ignore: fnlog-missing マスクの比較で8回呼ぶ内部処理
  let result = 0;
  for (let y = 0; y < size; y++) result += lineScore((x) => modules[y * size + x] === 1, size);
  for (let x = 0; x < size; x++) result += lineScore((y) => modules[y * size + x] === 1, size);
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = modules[y * size + x];
      if (c === 1) dark++;
      if (x < size - 1 && y < size - 1 && c === modules[y * size + x + 1] && c === modules[(y + 1) * size + x] && c === modules[(y + 1) * size + x + 1]) result += PENALTY_N2;
    }
  }
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return result + k * PENALTY_N4;
}

/**
 * オプションの版の範囲を確かめる。
 * @param opts オプション
 * @returns 範囲（不正なら undefined）
 */
function versionRangeOf(opts: QrEncodeOptions): { min: number; max: number } | undefined { // audit-ignore: fnlog-missing encodeQrBytes でまとめてログ
  const min = opts.minVersion ?? QR_MIN_VERSION;
  const max = opts.maxVersion ?? QR_MAX_VERSION;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < QR_MIN_VERSION || max > QR_MAX_VERSION || min > max) return undefined;
  if (opts.mask !== undefined && (!Number.isInteger(opts.mask) || opts.mask < 0 || opts.mask > 7)) return undefined;
  return { min, max };
}

/**
 * 入る最小の版を選ぶ。
 * @param length バイト数
 * @param ecc 誤り訂正
 * @param range 版の範囲
 * @returns 版（入らなければ undefined）
 */
function pickVersion(length: number, ecc: QrEcc, range: { min: number; max: number }): number | undefined { // audit-ignore: fnlog-missing encodeQrBytes でまとめてログ
  for (let v = range.min; v <= range.max; v++) {
    if (4 + (v < 10 ? 8 : 16) + length * 8 <= numDataCodewords(v, ecc) * 8 && length < (v < 10 ? 256 : 65536)) return v;
  }
  return undefined;
}

/**
 * バイト列を QR コードにする。
 * @param bytes 中身
 * @param opts 誤り訂正・版の範囲・マスク
 * @returns 成功: マス目。失敗: INVALID_INPUT（オプションが不正・版の範囲に入りきらない）
 */
export function encodeQrBytes(bytes: Uint8Array, opts: QrEncodeOptions = {}): Result<QrMatrix> {
  const ecc = opts.ecc ?? QR_DEFAULT_ECC;
  const log = logger.fn('encodeQrBytes', { length: bytes.length, ecc });
  const range = versionRangeOf(opts);
  if (range === undefined) return log.fail(fail(AppError.of('INVALID_INPUT', 'QR コードの設定が正しくありません')));
  const version = pickVersion(bytes.length, ecc, range);
  if (version === undefined) return log.fail(fail(AppError.of('INVALID_INPUT', 'QR コードに入りきりません', { length: bytes.length })));
  const grid = new QrGrid(version, ecc);
  grid.drawFunctionPatterns();
  grid.drawCodewords(addEccAndInterleave(dataCodewordsOf(bytes, version, ecc), version, ecc));
  let mask = opts.mask ?? -1;
  if (mask < 0) {
    let best = Number.POSITIVE_INFINITY;
    for (let m = 0; m < 8; m++) {
      grid.applyMask(m);
      grid.drawFormat(m);
      const score = penaltyScore(grid.modules, grid.size);
      if (score < best) {
        best = score;
        mask = m;
      }
      grid.applyMask(m);
    }
  }
  grid.applyMask(mask);
  grid.drawFormat(mask);
  return log.exit(ok(Object.freeze({ version, size: grid.size, ecc, mask, modules: grid.modules })), `版${version}・マスク${mask}`);
}

/**
 * 文字列（UTF-8）を QR コードにする。
 * @param text 中身
 * @param opts 誤り訂正・版の範囲・マスク
 * @returns 成功: マス目。失敗: INVALID_INPUT
 */
export function encodeQrText(text: string, opts: QrEncodeOptions = {}): Result<QrMatrix> {
  const log = logger.fn('encodeQrText', { length: text.length });
  const result = encodeQrBytes(new TextEncoder().encode(text), opts);
  return result.ok ? log.exit(result) : log.fail(result);
}

/**
 * マスが黒か（範囲外は白）。
 * @param qr QR コード
 * @param x 列
 * @param y 行
 * @returns 黒なら true
 */
export function qrIsDark(qr: QrMatrix, x: number, y: number): boolean { // audit-ignore: fnlog-missing 描画でマスごとに呼ぶ
  if (x < 0 || y < 0 || x >= qr.size || y >= qr.size) return false;
  return qr.modules[y * qr.size + x] === 1;
}
