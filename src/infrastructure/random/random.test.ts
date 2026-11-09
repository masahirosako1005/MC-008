import { describe, expect, it } from 'vitest';
import { ID_PATTERNS, travelerIdFromUuid } from '@/Common/types/Id';
import { CryptoIdGenerator, uuid } from '@/infrastructure/random/CryptoIdGenerator';
import { CryptoRandomSource } from '@/infrastructure/random/CryptoRandomSource';
import { SeededRandomSource } from '@/infrastructure/random/SeededRandomSource';

describe('CryptoIdGenerator', () => {
  it('接頭辞 + "_" + ハイフンを除いた小文字32桁を返し、EventId の正規表現を満たす', () => {
    const id = new CryptoIdGenerator().newId('ev');
    expect(id).toMatch(/^ev_[0-9a-f]{32}$/);
    expect(ID_PATTERNS.EventId.test(id)).toBe(true);
  });

  it('毎回違う ID を返す', () => {
    const generator = new CryptoIdGenerator();
    const ids = new Set(Array.from({ length: 50 }, () => generator.newId('ev')));
    expect(ids.size).toBe(50);
  });

  it('UUID 関数を差し替えると決まった ID になる', () => {
    const generator = new CryptoIdGenerator(() => '0F8FAD5B-D9CB-469F-A165-70867728950E');
    expect(generator.newId('t')).toBe('t_0f8fad5bd9cb469fa16570867728950e');
  });

  it('不正な接頭辞は呼び出し側のバグとして例外にする', () => {
    expect(() => new CryptoIdGenerator().newId('EV')).toThrow();
    expect(() => new CryptoIdGenerator().newId('')).toThrow();
  });

  it('uuid は操作ID・本番の旅人ID の元にできる', () => {
    const value = uuid();
    expect(ID_PATTERNS.OperationId.test(value)).toBe(true);
    expect(travelerIdFromUuid(value).ok).toBe(true);
  });
});

describe('CryptoRandomSource', () => {
  it('[0, 1) の数を返す', () => {
    const random = new CryptoRandomSource();
    for (let i = 0; i < 100; i += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('SeededRandomSource', () => {
  it('同じ種なら同じ数列、違う種なら違う数列を返す', () => {
    const a = new SeededRandomSource(42);
    const b = new SeededRandomSource(42);
    const c = new SeededRandomSource(43);
    const seqA = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(seqA);
    expect([c.next(), c.next(), c.next()]).not.toEqual(seqA);
  });

  it('[0, 1) の数を返す', () => {
    const random = new SeededRandomSource(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
