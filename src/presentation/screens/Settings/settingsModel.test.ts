import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '@/Common/constants/env';
import {
  APP_DISPLAY_NAME,
  DATA_TEXTS,
  FUTURE_NOTIFICATIONS,
  TEXT_SCALE_OPTIONS,
  aboutRows,
  deleteConfirmText,
  locationUsageText,
  nextScaleForKey,
  saveFailedMessage,
} from '@/presentation/screens/Settings/settingsModel';

describe('TEXT_SCALE_OPTIONS', () => {
  it('標準→大→特大の3択（CLAUDE.md 6.1）', () => {
    expect(TEXT_SCALE_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ['normal', '標準'],
      ['large', '大'],
      ['xlarge', '特大'],
    ]);
  });
});

describe('nextScaleForKey', () => {
  it('右・下で次へ、左・上で前へ。端では反対の端へ回る', () => {
    expect(nextScaleForKey('normal', 'ArrowRight')).toBe('large');
    expect(nextScaleForKey('large', 'ArrowDown')).toBe('xlarge');
    expect(nextScaleForKey('xlarge', 'ArrowRight')).toBe('normal');
    expect(nextScaleForKey('normal', 'ArrowLeft')).toBe('xlarge');
    expect(nextScaleForKey('large', 'ArrowUp')).toBe('normal');
  });

  it('Home は標準、End は特大', () => {
    expect(nextScaleForKey('large', 'Home')).toBe('normal');
    expect(nextScaleForKey('normal', 'End')).toBe('xlarge');
  });

  it('関係ないキーでは動かない', () => {
    expect(nextScaleForKey('large', 'Enter')).toBeUndefined();
    expect(nextScaleForKey('large', 'a')).toBeUndefined();
  });
});

describe('設定画面の文言', () => {
  it('通知は将来項目として3つ並べる（色あせ・期限・取り返し）', () => {
    expect(FUTURE_NOTIFICATIONS).toHaveLength(3);
  });

  it('通知の呼び方は CLAUDE.md 11.1（領主）。括弧書きの補足は付けない', () => {
    expect(FUTURE_NOTIFICATIONS).toContain('領主を奪われたとき');
    expect(FUTURE_NOTIFICATIONS.join('')).not.toMatch(/[（(]/);
  });

  it('位置情報はデモではオフ、本番は使用中のみ（括弧書き・開発向けの言葉は出さない）', () => {
    expect(locationUsageText(true)).toBe('オフ');
    expect(locationUsageText(false)).toBe('使用中のみ');
  });

  it('このアプリについて：アプリ名とバージョン（デモでも括弧書きを付けない）', () => {
    expect(aboutRows(true)).toEqual([
      { label: 'アプリ名', value: APP_DISPLAY_NAME },
      { label: 'バージョン', value: APP_VERSION },
    ]);
    expect(aboutRows(false)[1]?.value).toBe(APP_VERSION);
  });

  it('削除の確認文は元に戻せないことを短く伝える（開発向けの言葉・括弧書きなし）', () => {
    expect(deleteConfirmText(false)).toContain('元には戻せません');
    expect(deleteConfirmText(true)).toBe(deleteConfirmText(false));
    expect(deleteConfirmText(true)).not.toMatch(/デモ|[（(]/);
  });

  it('ボタンは 2〜6 字、書き出しの結果は件数を添える', () => {
    expect(DATA_TEXTS.exportButton).toBe('書き出す');
    expect(DATA_TEXTS.deleteButton).toBe('全削除');
    expect(DATA_TEXTS.exported(7)).toBe('7件を書き出しました');
  });

  it('保存に失敗したら、戻した大きさの名前を添えて知らせる', () => {
    expect(saveFailedMessage('large')).toBe('文字の大きさを保存できませんでした。「大」のままにしています');
  });
});
