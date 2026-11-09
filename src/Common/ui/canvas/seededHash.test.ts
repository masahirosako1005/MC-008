import { describe, expect, it } from 'vitest';
import { createSeededRandom, hashString, seededRandomFor } from '@/Common/ui/canvas/seededHash';

describe('hashString', () => {
  it('同じ文字列なら同じ値、違う文字列なら（ほぼ）違う値になる', () => {
    expect(hashString('d_joka')).toBe(hashString('d_joka'));
    expect(hashString('d_joka')).not.toBe(hashString('d_minato'));
  });
  it('32bit の符号なし整数を返す', () => {
    for (const s of ['', 'a', 'l_jo01', 'あいう']) {
      const v = hashString(s);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });
});

describe('createSeededRandom', () => {
  it('同じシードなら同じ列を返す（決定論的）', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
  it('値は [0,1) に収まる', () => {
    const next = seededRandomFor('s_hm01');
    for (let i = 0; i < 1000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('ID ごとに違う列になる', () => {
    expect(seededRandomFor('d_joka')()).not.toBe(seededRandomFor('d_honmachi')());
  });
});
