import { describe, expect, it } from 'vitest';
import {
  parseDistrictId,
  parseEventId,
  parseItemId,
  parseOperationId,
  parseRivalId,
  parseShopEventId,
  parseSpotId,
  parseTravelerId,
  spotKindOfId,
  travelerIdFromUuid,
} from '@/Common/types/Id';

describe('parseSpotId', () => {
  it('名所（l_）と店舗（s_）の ID を受け付ける', () => {
    expect(parseSpotId('l_jo01').ok).toBe(true);
    expect(parseSpotId('s_hm15').ok).toBe(true);
  });
  it('本体の長さは 2〜16 文字（境界値）', () => {
    expect(parseSpotId('l_ab').ok).toBe(true);
    expect(parseSpotId('l_a').ok).toBe(false);
    expect(parseSpotId(`l_${'a'.repeat(16)}`).ok).toBe(true);
    expect(parseSpotId(`l_${'a'.repeat(17)}`).ok).toBe(false);
  });
  it('不正な値を INVALID_INPUT で拒否する', () => {
    for (const bad of ['d_joka', 'L_jo01', 'l_JO01', 'l-jo01', 'l_jo 01', 'l_jo01\n', '<script>', '', 1, null, undefined, {}]) {
      const r = parseSpotId(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
    }
  });
  it('失敗の details に値そのものを含めない', () => {
    const r = parseSpotId('l_SECRET');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.error.details)).not.toContain('SECRET');
  });
  it('ID から名所／店舗を判定する', () => {
    const l = parseSpotId('l_jo01');
    const s = parseSpotId('s_jo01');
    if (!l.ok || !s.ok) throw new Error('fixture');
    expect(spotKindOfId(l.value)).toBe('landmark');
    expect(spotKindOfId(s.value)).toBe('shop');
  });
});

describe('その他の ID', () => {
  it('各接頭辞の ID を受け付け、取り違えを拒否する', () => {
    expect(parseDistrictId('d_joka').ok).toBe(true);
    expect(parseDistrictId('l_joka').ok).toBe(false);
    expect(parseRivalId('r_taro').ok).toBe(true);
    expect(parseRivalId('t_taro').ok).toBe(false);
    expect(parseShopEventId('c_jo01').ok).toBe(true);
    expect(parseShopEventId('s_jo01').ok).toBe(false);
    expect(parseItemId('i_chochin').ok).toBe(true);
    expect(parseItemId('i_c').ok).toBe(false);
  });
  it('旅人ID は本体 2〜40 文字', () => {
    expect(parseTravelerId('t_ab').ok).toBe(true);
    expect(parseTravelerId(`t_${'a'.repeat(40)}`).ok).toBe(true);
    expect(parseTravelerId(`t_${'a'.repeat(41)}`).ok).toBe(false);
  });
  it('UUID から旅人ID を作る（ハイフン除去・小文字化）', () => {
    const r = travelerIdFromUuid('0F8FAD5B-D9CB-469F-A165-70867728950E');
    expect(r.ok ? r.value : undefined).toBe('t_0f8fad5bd9cb469fa16570867728950e');
  });
  it('操作ID は UUID 形式（小文字16進とハイフン、8〜64文字）', () => {
    expect(parseOperationId('0f8fad5b-d9cb-469f-a165-70867728950e').ok).toBe(true);
    expect(parseOperationId('0f8fad5').ok).toBe(false);
    expect(parseOperationId('0F8FAD5B-D9CB').ok).toBe(false);
    expect(parseOperationId('zzzzzzzz').ok).toBe(false);
  });
  it('イベントID は ev_ と 4〜64 文字', () => {
    expect(parseEventId('ev_abcd').ok).toBe(true);
    expect(parseEventId('ev_abc').ok).toBe(false);
    expect(parseEventId('ev-abcd').ok).toBe(false);
  });
});
