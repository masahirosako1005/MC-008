/**
 * @file 設定画面の表示モデル（presentation/screens/Settings 層。純粋関数のみ）
 * 文字の大きさの選択肢・矢印キーでの移動・将来項目の文言・「このアプリについて」の行を決める（wireframes/10_settings）。
 * DOM を触らないのでテストしやすい。画面の組み立ては SettingsScreen.ts。
 */
import { APP_VERSION } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { TEXT_SCALE_LABELS, TEXT_SCALES } from '@/Common/ui/a11y/textScale';
import type { TextScale } from '@/Common/ui/a11y/textScale';

const logger = createLogger('presentation/screens/Settings/settingsModel');

/** 文字の大きさの選択肢 */
export interface TextScaleOption {
  readonly value: TextScale;
  /** ボタンの表示名（標準／大／特大） */
  readonly label: string;
  /** 読み上げ用の補足 */
  readonly description: string;
}

/** 選択肢ごとの読み上げ用の補足 */
const TEXT_SCALE_DESCRIPTIONS: Readonly<Record<TextScale, string>> = {
  normal: 'いつもの大きさ',
  large: '少し大きく',
  xlarge: 'いちばん大きく',
};

/** 文字の大きさの選択肢（並び順は標準→大→特大） */
export const TEXT_SCALE_OPTIONS: readonly TextScaleOption[] = TEXT_SCALES.map((value) => ({
  value,
  label: TEXT_SCALE_LABELS[value],
  description: TEXT_SCALE_DESCRIPTIONS[value],
}));

/** プレビューに出すスポットカード（地図下シートの「近くのスポット」と同じ部品・同じ文言の形。wireframes/10_settings 注記2） */
export const PREVIEW_SPOT = {
  name: '福まるどら焼き本舗',
  kindLabel: '店舗',
  meters: 62,
  subtitle: '訪問2回',
  chip: 'クーポン',
  districtId: 'd_minamimori',
} as const;

/** 将来の通知項目（今は操作できない。wireframes/10_settings 注記3） */
export const FUTURE_NOTIFICATIONS: readonly string[] = ['色あせのお知らせ（7日前）', 'クーポン・イベントの期限', '地区の主を奪われたとき'];

/** 見出しと値の1行 */
export interface SettingsRow {
  readonly label: string;
  readonly value: string;
}

/** アプリ名（CLAUDE.md 12 の仮称。index.html の title と合わせる） */
export const APP_DISPLAY_NAME = 'まちクエ';

/**
 * 文字の大きさの選択肢から、キー操作で次に選ぶものを返す（ラジオグループの矢印キー操作＝WAI-ARIA）。
 * 端では止まらず反対の端へ回る。Home/End は先頭・末尾。関係ないキーは undefined。
 * @param current 今の選択
 * @param key KeyboardEvent.key
 * @returns 次に選ぶ文字の大きさ（動かないキーなら undefined）
 */
export function nextScaleForKey(current: TextScale, key: string): TextScale | undefined {
  const log = logger.fn('nextScaleForKey', { current, key });
  const index = TEXT_SCALES.indexOf(current);
  const last = TEXT_SCALES.length - 1;
  const step: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (key === 'Home') return log.exit(TEXT_SCALES[0]);
  if (key === 'End') return log.exit(TEXT_SCALES[last]);
  const delta = step[key];
  if (delta === undefined || index < 0) return log.exit(undefined);
  return log.exit(TEXT_SCALES[(index + delta + TEXT_SCALES.length) % TEXT_SCALES.length]);
}

/**
 * 位置情報の行の値を返す（デモは地図タップで動くので、端末の位置情報を使わない）。
 * @param isDemo デモビルドなら true
 * @returns 位置情報の利用のしかた（1行に収まる短さ）
 */
export function locationUsageText(isDemo: boolean): string {
  return logger.fn('locationUsageText', { isDemo }).exit(isDemo ? '使いません（デモ版）' : 'アプリの使用中のみ');
}

/**
 * 位置情報のまとまりの補足を返す（CLAUDE.md 10 章：地区単位で集計し、移動の道すじは端末の中で扱う）。
 * @param isDemo デモビルドなら true（地図タップで動くことを添える）
 * @returns 補足の文
 */
export function locationNote(isDemo: boolean): string {
  const log = logger.fn('locationNote', { isDemo });
  const policy = '来訪の記録は地区ごとにまとめて扱い、あなたの移動の道すじは端末の中だけに置きます。';
  return log.exit(isDemo ? `デモ版は地図をタップして歩きます。${policy}` : policy);
}

/**
 * 文字の大きさのまとまりの補足を返す。
 * @param isDemo デモビルドなら true（発表向けのおすすめを添える）
 * @returns 補足の文
 */
export function textScaleNote(isDemo: boolean): string {
  const log = logger.fn('textScaleNote', { isDemo });
  const base = '地図のラベル・下シート・スポット詳細など、すべての画面に反映されます。';
  return log.exit(isDemo ? `${base}発表では「大」がおすすめです。` : base);
}

/**
 * 「このアプリについて」の行を返す。
 * @param isDemo デモビルドなら true（バージョンに「デモ版」と添える）
 * @returns 行の一覧
 */
export function aboutRows(isDemo: boolean): readonly SettingsRow[] {
  const log = logger.fn('aboutRows', { isDemo });
  return log.exit([
    { label: 'アプリ名', value: APP_DISPLAY_NAME },
    { label: 'バージョン', value: isDemo ? `${APP_VERSION}（デモ版）` : APP_VERSION },
  ]);
}

/** データのまとまりの文言（DI-21 書き出し・PRV-05 削除） */
export const DATA_TEXTS = {
  exportLead: '訪問の記録・ポイント・カード・着せ替え・設定を、JSON ファイルにして端末に保存します。',
  exportButton: 'データを書き出す',
  exported: (count: number): string => `データを書き出しました（${count}件）`,
  exportFailed: 'データを書き出せませんでした',
  deleteLead: 'この端末に保存したあなたのデータをすべて消します。元には戻せません。',
  deleteButton: 'すべてのデータを削除',
  confirmTitle: 'すべてのデータを削除しますか？',
  confirmCancel: 'やめる',
  confirmDelete: '削除する',
  deleteFailed: 'データを削除できませんでした。もう一度お試しください',
} as const;

/**
 * 削除の確認ダイアログの本文を返す。
 * @param isDemo デモビルドなら true（最初の状態からやり直すことを添える）
 * @returns 本文
 */
export function deleteConfirmText(isDemo: boolean): string {
  const log = logger.fn('deleteConfirmText', { isDemo });
  const base = '訪問の記録、ポイント、カード、アイテム、着せ替え、設定がこの端末から消え、アプリを最初から始め直します。元には戻せません。残しておきたいときは、先に「データを書き出す」で保存してください。';
  return log.exit(isDemo ? `${base}（デモ版は、最初のデモの状態に戻ります）` : base);
}

/**
 * データのまとまりの補足を返す。
 * @param isDemo デモビルドなら true
 * @returns 補足の文（お店側のデータは消えないことを示す）
 */
export function dataNote(isDemo: boolean): string {
  const log = logger.fn('dataNote', { isDemo });
  return log.exit(isDemo ? 'お店の CMS で登録した内容は、お店側のデータなので消えません。デモの日付も今日に戻ります。' : 'お店に渡すのは地区ごとの集計だけで、あなた個人のデータは渡しません。');
}

/**
 * 保存に失敗したときの案内文を返す。
 * @param kept 元に戻した文字の大きさ
 * @returns トーストの文言
 */
export function saveFailedMessage(kept: TextScale): string {
  return logger.fn('saveFailedMessage', { kept }).exit(`文字の大きさを保存できませんでした。「${TEXT_SCALE_LABELS[kept]}」のままにしています`);
}
