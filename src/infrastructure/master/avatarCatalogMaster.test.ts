import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AVATAR_CATALOG } from '@/domain/avatar/AvatarCatalog';

describe('アバターの部品の一覧とマスタの対応', () => {
  it('「地区に通う」部品の地区ID は、マスタ public/master/districts.json の地区と一致する', () => {
    const master = JSON.parse(readFileSync('public/master/districts.json', 'utf8')) as { districts: { id: string }[] };
    const known = new Set(master.districts.map((d) => d.id));
    const used = AVATAR_CATALOG.flatMap((p) => (p.unlock.kind === 'districtVisits' ? [p.unlock.districtId] : []));
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(known.has(id)).toBe(true);
    for (const id of known) expect(used).toContain(id);
  });
});
