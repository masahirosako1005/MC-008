/**
 * @file パスワードのハッシュ化と照合のテスト（SEC-19）
 */
import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, PASSWORD_MIN_LENGTH, UNUSABLE_PASSWORD_HASH, validateNewPassword, verifyPassword } from '@/infrastructure/server/auth/passwordHash';

describe('passwordHash', () => {
  it('ハッシュ化した文字列は scrypt の形で、同じパスワードだけが合う', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored.startsWith('scrypt$32768$8$3$')).toBe(true);
    expect(stored).not.toContain('correct');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterz', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('同じパスワードでも salt が違うので保存される文字列は毎回違う', async () => {
    const a = await hashPassword('same password 123');
    const b = await hashPassword('same password 123');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password 123', b)).toBe(true);
  });

  it('パスワードは NFC に正規化してから比べる（DI-17）', async () => {
    const stored = await hashPassword('パスワードパ゚');
    expect(await verifyPassword('パスワードパ゚'.normalize('NFC'), stored)).toBe(true);
  });

  it('パスワードでは入れないアカウント・壊れた保存値は常に合わない', async () => {
    expect(await verifyPassword('anything at all', UNUSABLE_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword('anything at all', 'scrypt$3$8$1$abc$def')).toBe(false);
    expect(await verifyPassword('anything at all', 'bcrypt$whatever')).toBe(false);
    expect(await verifyPassword('anything at all', '')).toBe(false);
  });

  it('新しいパスワードは 10〜128 文字で、制御文字・空白だけは断る', () => {
    expect(validateNewPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)).ok).toBe(false);
    expect(validateNewPassword('a'.repeat(PASSWORD_MIN_LENGTH)).ok).toBe(true);
    expect(validateNewPassword('a'.repeat(129)).ok).toBe(false);
    expect(validateNewPassword('short\u0000withcontrol').ok).toBe(false);
    expect(validateNewPassword('            ').ok).toBe(false);
    expect(validateNewPassword(12345678901).ok).toBe(false);
    const ok = validateNewPassword('ぱすわーど゙は十文字以上');
    expect(ok.ok && ok.value).toBe('ぱすわーど゙は十文字以上'.normalize('NFC'));
  });

  it('今の引数と違う保存値はかけ直しの対象になる', async () => {
    expect(needsRehash(await hashPassword('rehash check 1'))).toBe(false);
    expect(needsRehash('scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(needsRehash(UNUSABLE_PASSWORD_HASH)).toBe(false);
  });
});
