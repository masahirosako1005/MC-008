/**
 * @file 設定画面の DTO（application 層）
 * 端末ごとの表示設定（文字の大きさ）と、データの書き出し・削除の入出力。プリミティブのみ（docs/08 §4.3）。
 * 文字の大きさは旅人ごとではなく端末ごとの設定なので、旅人を切り替えても変わらない。
 */

/** 文字の大きさ（標準／大／特大。Common/ui/a11y/textScale の TextScale と同じ値） */
export type TextScaleSetting = 'normal' | 'large' | 'xlarge';

/** 設定の中身 */
export interface SettingsDto {
  readonly textScale: TextScaleSetting;
}

/** 文字の大きさを変える入力（画面から来る値なので未検証の文字列） */
export interface UpdateTextScaleInput {
  readonly textScale: string;
}

/** 書き出したデータ（画面がこのままファイルとして保存する） */
export interface ExportDataDto {
  /** 保存するファイル名（'kayoimachi-data-2026-11-09.json' など） */
  readonly filename: string;
  /** ファイルの中身（JSON 文字列） */
  readonly content: string;
  /** 書き出した保存データの件数 */
  readonly entryCount: number;
}

/** すべてのデータを削除する入力（確認ダイアログで「削除する」を押したときだけ true を渡す） */
export interface DeleteAllDataInput {
  readonly confirmed: boolean;
}

/** すべてのデータを削除した結果 */
export interface DeleteAllDataOutput {
  /** 消した保存データの件数 */
  readonly removed: number;
}
