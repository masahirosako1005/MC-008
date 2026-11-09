import { describe, expect, it, vi } from 'vitest';
import { AppRouter } from '@/presentation/App/AppRouter';

/** テスト用: restart に必要なところだけを持つ window */
function fakeWindow(hash: string): { win: Window; replaceState: ReturnType<typeof vi.fn>; reload: ReturnType<typeof vi.fn> } {
  const replaceState = vi.fn();
  const reload = vi.fn();
  const win = { location: { hash, reload }, history: { replaceState }, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  return { win: win as unknown as Window, replaceState, reload };
}

describe('AppRouter.restart', () => {
  it('開く画面を履歴に積まずに置いてから、ページを読み込み直す（全データ削除の後）', () => {
    const fake = fakeWindow('#/settings');
    new AppRouter({ isDemo: true, win: fake.win }).restart('#/map');
    expect(fake.replaceState).toHaveBeenCalledWith(null, '', '#/map');
    expect(fake.reload).toHaveBeenCalledTimes(1);
  });

  it('不正な行き先は地図にして読み込み直す（SEC-16）', () => {
    const fake = fakeWindow('#/settings');
    new AppRouter({ isDemo: false, win: fake.win }).restart('#/spot/<x>');
    expect(fake.replaceState).toHaveBeenCalledWith(null, '', '#/map');
    expect(fake.reload).toHaveBeenCalledTimes(1);
  });
});
