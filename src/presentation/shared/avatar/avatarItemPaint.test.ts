/**
 * @file 部品だけの絵（drawAvatarItem）のテスト。ランキングの報酬はアバターを描かずに部品だけで見せる（2026-11-10 ユーザー指示）。
 */
import { describe, expect, it } from 'vitest';
import { AVATAR_CATALOG } from '@/domain/avatar/AvatarCatalog';
import { splitPartId } from '@/presentation/shared/avatar/avatarLook';
import { drawAvatarItem, isAvatarItemSlot } from '@/presentation/shared/avatar/avatarPaint';

/** 描いた回数と save の深さを数える偽の 2D コンテキスト */
function fakeCtx(): { ctx: CanvasRenderingContext2D; paints: () => number; depth: () => number } {
  let paints = 0;
  let depth = 0;
  const gradient = { addColorStop: (): void => undefined };
  const target: Record<string, unknown> = {
    save: (): void => { depth += 1; },
    restore: (): void => { depth -= 1; },
    fill: (): void => { paints += 1; },
    stroke: (): void => { paints += 1; },
    fillRect: (): void => { paints += 1; },
    fillText: (): void => { paints += 1; },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    measureText: () => ({ width: 10 }),
  };
  const ctx = new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : () => undefined),
    set: (t, key: string, value: unknown) => { t[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, paints: () => paints, depth: () => depth };
}

/** 部品だけで描く枠の部品 */
const ITEM_PARTS = AVATAR_CATALOG.flatMap((p) => {
  const part = splitPartId(p.id);
  return part !== undefined && isAvatarItemSlot(part.slot) ? [{ id: p.id, slot: part.slot, style: part.style }] : [];
});

describe('drawAvatarItem（部品だけの絵）', () => {
  it('帽子・アクセサリー・持ち物・相棒の部品はすべて、体を描かずに部品だけ描け、save/restore が釣り合う', () => {
    expect(ITEM_PARTS.length).toBeGreaterThan(0);
    for (const part of ITEM_PARTS) {
      const fake = fakeCtx();
      expect(drawAvatarItem(fake.ctx, part.slot, part.style, 1), part.id).toBe(true);
      expect(fake.paints(), part.id).toBeGreaterThan(0);
      expect(fake.depth(), part.id).toBe(0);
    }
  });

  it('知らない種類は何も描かずに false', () => {
    const fake = fakeCtx();
    expect(drawAvatarItem(fake.ctx, 'hat', 'nope', 1)).toBe(false);
    expect(drawAvatarItem(fake.ctx, 'pet', 'toString', 1)).toBe(false);
    expect(fake.paints()).toBe(0);
    expect(fake.depth()).toBe(0);
  });

  it('部品だけで描く枠は帽子・アクセサリー・持ち物・相棒', () => {
    expect(['hat', 'accessory', 'held', 'pet'].every(isAvatarItemSlot)).toBe(true);
    expect(['hair', 'top', 'title', 'object', 'background'].some(isAvatarItemSlot)).toBe(false);
  });

  it('月間リーグの報酬は、部品だけの絵・置くもの・称号のどれかで見せられる（アバターに着せた絵にならない）', () => {
    const league = AVATAR_CATALOG.filter((p) => p.unlock.kind === 'league');
    expect(league.length).toBeGreaterThan(0);
    for (const p of league) expect(isAvatarItemSlot(p.slot) || p.slot === 'object' || p.slot === 'background' || p.slot === 'title', p.id).toBe(true);
  });
});
