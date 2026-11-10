/**
 * @file QR コードの符号化のテスト（Common/qr）
 * 仕様の既知の値（データ容量・形式情報・版情報・位置合わせの座標・リード・ソロモンの例）に固定し、
 * テストの中だけの簡易デコーダ（形式情報を読む → マスクを外す → ジグザグに読む → ブロックを戻す → シンドロームが 0 → バイトモードを解く）で往復を確かめる。
 * デコーダは符号化側の関数を使わずに書いてある（同じ誤りを両側でしないように）。
 */
import { describe, expect, it } from 'vitest';
import {
  addEccAndInterleave,
  alignmentPositions,
  dataCodewordsOf,
  encodeQrText,
  formatBits,
  numDataCodewords,
  qrIsDark,
  rsDivisor,
  rsRemainder,
  versionBits,
} from '@/Common/qr/qrCode';
import type { QrEcc, QrMatrix } from '@/Common/qr/qrCode';

// ---------------------------------------------------------------------------
// テスト用の簡易デコーダ（符号化側とは独立に書く）
// ---------------------------------------------------------------------------

/** GF(2^8) の指数表・対数表（α=2、原始多項式 0x11D） */
const EXP: number[] = [];
const LOG: number[] = new Array<number>(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] ?? 0;
}

/** 表引きの掛け算 */
function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0;
}

/** コード語の列（高次から）を α^i で評価したシンドローム */
function syndromes(block: readonly number[], eccLen: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < eccLen; i++) {
    let s = 0;
    for (const c of block) s = mul(s, EXP[i] ?? 0) ^ c;
    out.push(s);
  }
  return out;
}

/** 仕様の表（テスト側で持つ。版1〜10の M と、いくつかの版の L/Q/H） */
const SPEC_BLOCKS: Readonly<Record<string, readonly [eccPerBlock: number, groups: readonly (readonly [count: number, dataLen: number])[]]>> = {
  '1M': [10, [[1, 16]]],
  '2M': [16, [[1, 28]]],
  '3M': [26, [[1, 44]]],
  '4M': [18, [[2, 32]]],
  '5M': [24, [[2, 43]]],
  '6M': [16, [[4, 27]]],
  '7M': [18, [[4, 31]]],
  '8M': [22, [[2, 38], [2, 39]]],
  '9M': [22, [[3, 36], [2, 37]]],
  '10M': [26, [[4, 43], [1, 44]]],
  '5Q': [18, [[2, 15], [2, 16]]],
  '7H': [26, [[4, 13], [1, 14]]],
  '2L': [10, [[1, 34]]],
};

/** マスクの式（仕様の表をそのまま。符号化側の maskBit は使わない） */
const MASKS: readonly ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

/** 機能パターンの場所（テスト側で独立に作る。i=行, j=列） */
function reservedOf(version: number): boolean[][] {
  const n = version * 4 + 17;
  const r = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const mark = (i: number, j: number): void => {
    if (i >= 0 && j >= 0 && i < n && j < n) (r[i] as boolean[])[j] = true;
  };
  for (const [ci, cj] of [[0, 0], [0, n - 8], [n - 8, 0]] as const) for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) mark(ci + a, cj + b);
  for (let k = 0; k < n; k++) {
    mark(6, k);
    mark(k, 6);
  }
  for (let k = 0; k < 9; k++) {
    mark(8, k);
    mark(k, 8);
  }
  for (let k = 0; k < 8; k++) {
    mark(8, n - 1 - k);
    mark(n - 1 - k, 8);
  }
  const ALIGN: Readonly<Record<number, readonly number[]>> = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  const pos = ALIGN[version] ?? [];
  for (const ai of pos) {
    for (const aj of pos) {
      const corner = (ai === 6 && aj === 6) || (ai === 6 && aj === pos[pos.length - 1]) || (ai === pos[pos.length - 1] && aj === 6);
      if (corner) continue;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) mark(ai + a, aj + b);
    }
  }
  if (version >= 7) {
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 3; b++) {
        mark(a, n - 11 + b);
        mark(n - 11 + b, a);
      }
    }
  }
  return r;
}

/** 形式情報（左上の1つ目）を読み、誤り訂正とマスクを返す */
function readFormat(qr: QrMatrix): { ecc: QrEcc; mask: number } {
  const n = qr.size;
  const dark = (i: number, j: number): number => (qrIsDark(qr, j, i) ? 1 : 0);
  // 仕様の図: ビット14..0 を (8,0)…(8,5),(8,7),(8,8),(7,8),(5,8)…(0,8) に置く（i=行, j=列）
  const seq: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  let v = 0;
  for (const [i, j] of seq) v = (v << 1) | dark(i, j);
  // 2つ目のコピー（(n-1,8)…(n-7,8), (8,n-8)…(8,n-1)）とも一致すること
  const seq2: [number, number][] = [];
  for (let k = 0; k < 7; k++) seq2.push([n - 1 - k, 8]);
  for (let k = 0; k < 8; k++) seq2.push([8, n - 8 + k]);
  let v2 = 0;
  for (const [i, j] of seq2) v2 = (v2 << 1) | dark(i, j);
  expect(v2).toBe(v);
  expect(dark(n - 8, 8)).toBe(1);
  const raw = v ^ 0x5412;
  const eccBits = raw >>> 13;
  const ecc = (['M', 'L', 'H', 'Q'] as const)[eccBits] ?? 'M';
  return { ecc, mask: (raw >>> 10) & 7 };
}

/** QR を読み、中身のバイト列に戻す（誤り訂正は検査だけ） */
function decode(qr: QrMatrix): Uint8Array {
  const version = (qr.size - 17) / 4;
  const { ecc, mask } = readFormat(qr);
  const reserved = reservedOf(version);
  const n = qr.size;
  const bits: number[] = [];
  let upward = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let k = 0; k < n; k++) {
      const i = upward ? n - 1 - k : k;
      for (const j of [col, col - 1]) {
        if ((reserved[i] as boolean[])[j]) continue;
        const bit = (qrIsDark(qr, j, i) ? 1 : 0) ^ ((MASKS[mask] as (i: number, j: number) => boolean)(i, j) ? 1 : 0);
        bits.push(bit);
      }
    }
    upward = !upward;
  }
  const codewords: number[] = [];
  for (let k = 0; k + 8 <= bits.length; k += 8) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | (bits[k + b] ?? 0);
    codewords.push(v);
  }
  const spec = SPEC_BLOCKS[`${version}${ecc}`];
  if (spec === undefined) throw new Error(`表に無い版 ${version}${ecc}`);
  const [eccLen, groups] = spec;
  const lens: number[] = [];
  for (const [count, len] of groups) for (let c = 0; c < count; c++) lens.push(len);
  const blocks: number[][] = lens.map(() => []);
  let p = 0;
  const maxLen = Math.max(...lens);
  for (let k = 0; k < maxLen; k++) for (let b = 0; b < lens.length; b++) if (k < (lens[b] ?? 0)) (blocks[b] as number[]).push(codewords[p++] ?? 0);
  for (let k = 0; k < eccLen; k++) for (let b = 0; b < lens.length; b++) (blocks[b] as number[]).push(codewords[p++] ?? 0);
  for (const block of blocks) expect(syndromes(block, eccLen).every((s) => s === 0)).toBe(true);
  const data = blocks.flatMap((block, b) => block.slice(0, lens[b]));
  let bp = 0;
  const read = (count: number): number => {
    let v = 0;
    for (let k = 0; k < count; k++, bp++) v = (v << 1) | (((data[bp >>> 3] ?? 0) >>> (7 - (bp & 7))) & 1);
    return v;
  };
  expect(read(4)).toBe(0b0100);
  const length = read(version < 10 ? 8 : 16);
  const out = new Uint8Array(length);
  for (let k = 0; k < length; k++) out[k] = read(8);
  return out;
}

// ---------------------------------------------------------------------------

describe('qrCode: 仕様の値', () => {
  it('データのコード語の数が仕様の表と一致する', () => {
    const table: readonly [number, number, number, number, number][] = [
      [1, 19, 16, 13, 9],
      [2, 34, 28, 22, 16],
      [3, 55, 44, 34, 26],
      [4, 80, 64, 48, 36],
      [5, 108, 86, 62, 46],
      [6, 136, 108, 76, 60],
      [7, 156, 124, 88, 66],
      [10, 274, 216, 154, 122],
      [40, 2956, 2334, 1666, 1276],
    ];
    for (const [v, l, m, q, h] of table) {
      expect([numDataCodewords(v, 'L'), numDataCodewords(v, 'M'), numDataCodewords(v, 'Q'), numDataCodewords(v, 'H')]).toEqual([l, m, q, h]);
    }
  });

  it('形式情報が仕様の表と一致する', () => {
    const m = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
    m.forEach((bits, mask) => expect(formatBits('M', mask)).toBe(Number.parseInt(bits, 2)));
    expect(formatBits('L', 0)).toBe(Number.parseInt('111011111000100', 2));
    expect(formatBits('Q', 0)).toBe(Number.parseInt('011010101011111', 2));
    expect(formatBits('H', 0)).toBe(Number.parseInt('001011010001001', 2));
  });

  it('版情報が仕様の表と一致する', () => {
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(8)).toBe(0x085bc);
    expect(versionBits(9)).toBe(0x09a99);
    expect(versionBits(10)).toBe(0x0a4d3);
  });

  it('位置合わせパターンの座標が仕様の表と一致する', () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(10)).toEqual([6, 28, 50]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });

  it('リード・ソロモン: 仕様書の例（"01234567" 1-M）の誤り訂正コード語', () => {
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });

  it('リード・ソロモン: "HELLO WORLD" 1-M の誤り訂正コード語', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('バイトモードのデータは モード・文字数・終端・埋め草（0xEC/0x11）の順', () => {
    const words = dataCodewordsOf(new TextEncoder().encode('AB'), 1, 'M');
    expect(words.slice(0, 4)).toEqual([0x40, 0x24, 0x14, 0x20]);
    expect(words.slice(4, 8)).toEqual([0xec, 0x11, 0xec, 0x11]);
    expect(words).toHaveLength(16);
  });

  it('インターリーブ後の長さは版の全コード語数', () => {
    for (const v of [1, 5, 8, 10]) {
      const data = dataCodewordsOf(new TextEncoder().encode('x'), v, 'M');
      const all = addEccAndInterleave(data, v, 'M');
      expect(all.length).toBe(Math.floor(((16 * v + 128) * v + 64 - (v >= 2 ? (25 * (Math.floor(v / 7) + 2) - 10) * (Math.floor(v / 7) + 2) - 55 : 0) - (v >= 7 ? 36 : 0)) / 8));
    }
  });
});

describe('qrCode: 符号化して読み戻す', () => {
  it('チケットの中身（英数字と記号）を往復できる', () => {
    const text = 'MACHIQUEST:TICKET:1:c_mm02:MQ-7F3K-92QD';
    const qr = encodeQrText(text);
    expect(qr.ok).toBe(true);
    if (!qr.ok) return;
    expect(qr.value.ecc).toBe('M');
    expect(qr.value.size).toBe(qr.value.version * 4 + 17);
    expect(new TextDecoder().decode(decode(qr.value))).toBe(text);
  });

  it('日本語（UTF-8）を往復できる', () => {
    const text = 'まちクエ・天満の串かつ1本サービス';
    const qr = encodeQrText(text);
    expect(qr.ok).toBe(true);
    if (qr.ok) expect(new TextDecoder().decode(decode(qr.value))).toBe(text);
  });

  it('すべてのマスクで往復できる（固定したマスクが形式情報に入る）', () => {
    for (let mask = 0; mask < 8; mask++) {
      const qr = encodeQrText('https://example.com/ticket?id=42', { mask });
      expect(qr.ok).toBe(true);
      if (!qr.ok) continue;
      expect(qr.value.mask).toBe(mask);
      expect(new TextDecoder().decode(decode(qr.value))).toBe('https://example.com/ticket?id=42');
    }
  });

  it('版1〜10（2ブロックの群や版情報を含む）で往復できる', () => {
    for (let v = 1; v <= 10; v++) {
      const capacity = numDataCodewords(v, 'M') - (v < 10 ? 2 : 3);
      const text = 'Q'.repeat(capacity);
      const qr = encodeQrText(text, { minVersion: v, maxVersion: v });
      expect(qr.ok).toBe(true);
      if (!qr.ok) continue;
      expect(qr.value.version).toBe(v);
      expect(new TextDecoder().decode(decode(qr.value))).toBe(text);
    }
  });

  it('ほかの誤り訂正（L・Q・H）でも往復できる', () => {
    const cases: readonly [QrEcc, number][] = [['L', 2], ['Q', 5], ['H', 7]];
    for (const [ecc, v] of cases) {
      const qr = encodeQrText('ticket', { ecc, minVersion: v, maxVersion: v });
      expect(qr.ok).toBe(true);
      if (qr.ok) expect(new TextDecoder().decode(decode(qr.value))).toBe('ticket');
    }
  });

  it('位置検出パターン（3隅）と暗いマスの固定位置がある', () => {
    const qr = encodeQrText('x');
    expect(qr.ok).toBe(true);
    if (!qr.ok) return;
    const n = qr.value.size;
    for (const [x0, y0] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
      for (let d = 0; d < 7; d++) {
        expect(qrIsDark(qr.value, x0 + d, y0)).toBe(true);
        expect(qrIsDark(qr.value, x0, y0 + d)).toBe(true);
      }
      expect(qrIsDark(qr.value, x0 + 1, y0 + 1)).toBe(false);
      expect(qrIsDark(qr.value, x0 + 3, y0 + 3)).toBe(true);
    }
  });

  it('同じ中身なら同じ模様（決定論的）', () => {
    const a = encodeQrText('MQ-AAAA-BBBB');
    const b = encodeQrText('MQ-AAAA-BBBB');
    expect(a.ok && b.ok && Array.from(a.value.modules).join('') === Array.from(b.value.modules).join('')).toBe(true);
  });

  it('入りきらない・設定が不正なら失敗する', () => {
    expect(encodeQrText('x'.repeat(30), { maxVersion: 1 }).ok).toBe(false);
    expect(encodeQrText('x', { minVersion: 0 }).ok).toBe(false);
    expect(encodeQrText('x', { mask: 8 }).ok).toBe(false);
  });
});
