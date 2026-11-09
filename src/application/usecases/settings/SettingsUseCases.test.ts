import { describe, expect, it } from 'vitest';
import { must } from '@/application/testing/fakes';
import { InMemorySettingsRepository } from '@/application/testing/InMemorySettingsRepository';
import { GetSettingsUseCase } from '@/application/usecases/settings/GetSettingsUseCase';
import { UpdateTextScaleUseCase } from '@/application/usecases/settings/UpdateTextScaleUseCase';
import { parseSettings, parseTextScaleSetting } from '@/application/usecases/settings/settingsValues';

describe('GetSettingsUseCase', () => {
  it('未保存なら既定値（標準）を返す', async () => {
    const settings = new InMemorySettingsRepository();
    expect(must(await new GetSettingsUseCase({ settings }).execute())).toEqual({ textScale: 'normal' });
  });

  it('保存済みの文字の大きさを返す', async () => {
    const settings = new InMemorySettingsRepository({ textScale: 'xlarge' });
    expect(must(await new GetSettingsUseCase({ settings }).execute())).toEqual({ textScale: 'xlarge' });
  });
});

describe('UpdateTextScaleUseCase', () => {
  it('大を保存すると、次の読込で大が返る', async () => {
    const settings = new InMemorySettingsRepository();
    expect(must(await new UpdateTextScaleUseCase({ settings }).execute({ textScale: 'large' }))).toEqual({ textScale: 'large' });
    expect(must(await new GetSettingsUseCase({ settings }).execute())).toEqual({ textScale: 'large' });
  });

  it('同じ値を何度送っても結果は同じ（冪等＝DI-07）', async () => {
    const settings = new InMemorySettingsRepository();
    const update = new UpdateTextScaleUseCase({ settings });
    must(await update.execute({ textScale: 'xlarge' }));
    expect(must(await update.execute({ textScale: 'xlarge' }))).toEqual({ textScale: 'xlarge' });
  });

  it('知らない値は INVALID_INPUT で、保存済みの値は変えない（SEC-16）', async () => {
    const settings = new InMemorySettingsRepository({ textScale: 'large' });
    const result = await new UpdateTextScaleUseCase({ settings }).execute({ textScale: '<script>' });
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    expect(must(await new GetSettingsUseCase({ settings }).execute())).toEqual({ textScale: 'large' });
  });

  it('保存に失敗したら STORAGE_FAILED を返す', async () => {
    const settings = new InMemorySettingsRepository();
    settings.failNextSave = true;
    const result = await new UpdateTextScaleUseCase({ settings }).execute({ textScale: 'large' });
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });
});

describe('settingsValues', () => {
  it('標準・大・特大だけを受け付ける', () => {
    expect(['normal', 'large', 'xlarge'].map((v) => parseTextScaleSetting(v).ok)).toEqual([true, true, true]);
    expect([undefined, '', 'NORMAL', 1, null].map((v) => parseTextScaleSetting(v).ok)).toEqual([false, false, false, false, false]);
  });

  it('知らない項目は捨て、形が違えば INVALID_INPUT', () => {
    expect(must(parseSettings({ textScale: 'large', extra: 1 }))).toEqual({ textScale: 'large' });
    expect(parseSettings('large').ok).toBe(false);
    expect(parseSettings({}).ok).toBe(false);
  });
});
