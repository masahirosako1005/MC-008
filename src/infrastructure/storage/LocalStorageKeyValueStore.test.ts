import { describe, expect, it } from 'vitest';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { isQuotaExceeded, LocalStorageKeyValueStore } from '@/infrastructure/storage/LocalStorageKeyValueStore';

/** テスト用: Map で動く Storage の偽物（setItem だけ失敗させられる） */
class FakeStorage implements Storage {
  private readonly items = new Map<string, string>();
  failOnSet: unknown = undefined;

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failOnSet !== undefined) throw this.failOnSet;
    this.items.set(key, value);
  }
}

describe('LocalStorageKeyValueStore', () => {
  it('書いた値を読め、未保存のキーは undefined', () => {
    const store = new LocalStorageKeyValueStore(() => new FakeStorage());
    expect(store.set('nnishi.a', '1').ok).toBe(true);
    expect(store.get('nnishi.a')).toEqual({ ok: true, value: '1' });
    expect(store.get('nnishi.none')).toEqual({ ok: true, value: undefined });
  });

  it('keys は接頭辞で絞り込んで昇順に返し、remove で消える', () => {
    const store = new LocalStorageKeyValueStore(() => new FakeStorage());
    store.set('nnishi.demo.b', 'x');
    store.set('nnishi.demo.a', 'x');
    store.set('nnishi.session', 'x');
    expect(store.keys('nnishi.demo.')).toEqual({ ok: true, value: ['nnishi.demo.a', 'nnishi.demo.b'] });
    store.remove('nnishi.demo.a');
    expect(store.keys('nnishi.demo.')).toEqual({ ok: true, value: ['nnishi.demo.b'] });
  });

  it('容量超過は STORAGE_FAILED（details.quota=true）で返し、例外を外へ出さない', () => {
    const fake = new FakeStorage();
    fake.failOnSet = new DOMException('full', 'QuotaExceededError');
    const store = new LocalStorageKeyValueStore(() => fake);
    const result = store.set('nnishi.big', 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_FAILED');
      expect(result.error.details).toMatchObject({ operation: 'set', quota: true });
    }
  });

  it('Storage を開けない環境（アクセス拒否・ブラウザ外）は STORAGE_FAILED', () => {
    const store = new LocalStorageKeyValueStore(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const result = store.get('nnishi.a');
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(store.keys('nnishi.').ok).toBe(false);
  });

  it('既定の window.localStorage が無い Node 環境でも例外にならない', () => {
    const store = new LocalStorageKeyValueStore();
    expect(store.get('nnishi.a').ok).toBe(false);
  });

  it('容量超過の判定は DOMException の名前で行う', () => {
    expect(isQuotaExceeded(new DOMException('x', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaExceeded(new DOMException('x', 'SecurityError'))).toBe(false);
    expect(isQuotaExceeded(new Error('x'))).toBe(false);
  });
});

describe('InMemoryKeyValueStore', () => {
  it('初期値を持ち、書込・削除・接頭辞の一覧ができる', () => {
    const store = new InMemoryKeyValueStore({ 'nnishi.b': '2' });
    store.set('nnishi.a', '1');
    store.set('other', '3');
    expect(store.keys('nnishi.')).toEqual({ ok: true, value: ['nnishi.a', 'nnishi.b'] });
    store.remove('nnishi.b');
    expect(store.get('nnishi.b')).toEqual({ ok: true, value: undefined });
    expect(store.snapshot()).toEqual({ 'nnishi.a': '1', other: '3' });
  });
});
