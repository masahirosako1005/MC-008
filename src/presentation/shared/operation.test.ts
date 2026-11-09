import { describe, expect, it } from 'vitest';
import { ID_PATTERNS } from '@/Common/types/Id';
import { newOperationId, uuidV4FromBytes } from '@/presentation/shared/operation';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newOperationId', () => {
  it('OperationId の形式（UUID）を満たす', () => {
    const id = newOperationId();
    expect(ID_PATTERNS.OperationId.test(id)).toBe(true);
    expect(id).toMatch(UUID_V4);
  });
  it('呼ぶたびに違う値を返す', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newOperationId()));
    expect(ids.size).toBe(100);
  });
});

describe('uuidV4FromBytes', () => {
  it('version 4 と variant のビットを設定した UUID 文字列にする', () => {
    expect(uuidV4FromBytes(new Uint8Array(16).fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(uuidV4FromBytes(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
  });
  it('16 バイトに満たない入力は 0 で埋める', () => {
    expect(uuidV4FromBytes(new Uint8Array([0xab]))).toMatch(UUID_V4);
  });
});
