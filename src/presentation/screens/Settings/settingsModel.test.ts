import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '@/Common/constants/env';
import {
  APP_DISPLAY_NAME,
  DATA_TEXTS,
  FUTURE_NOTIFICATIONS,
  TEXT_SCALE_OPTIONS,
  aboutRows,
  dataNote,
  deleteConfirmText,
  locationNote,
  locationUsageText,
  nextScaleForKey,
  saveFailedMessage,
  textScaleNote,
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

  it('位置情報はデモでは使わないと示し、本番は使用中のみ。補足は地区単位の集計方針（CLAUDE.md 10 章）', () => {
    expect(locationUsageText(true)).toBe('使いません（デモ版）');
    expect(locationUsageText(false)).toBe('アプリの使用中のみ');
    expect(locationNote(true)).toContain('地図をタップ');
    expect(locationNote(false)).not.toContain('デモ');
    expect(locationNote(false)).toContain('地区ごと');
  });

  it('「発表では大がおすすめ」はデモ版だけに出す', () => {
    expect(textScaleNote(true)).toContain('発表では「大」');
    expect(textScaleNote(false)).not.toContain('発表');
  });

  it('このアプリについて：アプリ名とバージョン（デモ版と添える）', () => {
    expect(aboutRows(true)).toEqual([
      { label: 'アプリ名', value: APP_DISPLAY_NAME },
      { label: 'バージョン', value: `${APP_VERSION}（デモ版）` },
    ]);
    expect(aboutRows(false)[1]?.value).toBe(APP_VERSION);
  });

  it('削除の確認文は元に戻せないことと、先に書き出せることを伝える。デモは最初のデモの状態に戻ると添える', () => {
    expect(deleteConfirmText(false)).toContain('元には戻せません');
    expect(deleteConfirmText(false)).toContain('データを書き出す');
    expect(deleteConfirmText(false)).not.toContain('デモ');
    expect(deleteConfirmText(true)).toContain('最初のデモの状態');
  });

  it('データの補足：デモはお店の CMS の内容が消えないこと、本番はお店に個人のデータを渡さないこと（PRV-04）', () => {
    expect(dataNote(true)).toContain('CMS');
    expect(dataNote(false)).toContain('地区ごとの集計');
    expect(DATA_TEXTS.exported(7)).toBe('データを書き出しました（7件）');
  });

  it('保存に失敗したら、戻した大きさの名前を添えて知らせる', () => {
    expect(saveFailedMessage('large')).toBe('文字の大きさを保存できませんでした。「大」のままにしています');
  });
});
