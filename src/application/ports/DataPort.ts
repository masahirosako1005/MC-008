/**
 * @file 端末に保存した利用者のデータ全体の読み出し・削除 IF（application 層のポート）
 * 設定画面の「データを書き出す」（DI-21）と「すべてのデータを削除」（PRV-05・DI-22 物理削除）で使う。
 * 範囲はこのビルドの保存名前空間（P）にある利用者のデータすべて（旅人・台帳・地区の主・ライバル行動・装い・設定・地図の好み・退避データ・デモの日付）。
 * 店舗CMS の登録内容（お店側のデータ）と、別の名前空間（本番から見たデモ）・開発用の debug フラグは含めない。
 * 実装は infrastructure/storage/LocalStorageDataPort。
 */
import type { Result } from '@/Common/result/Result';

/** 保存データの1件 */
export interface UserDataEntry {
  /** 接頭辞（P）を除いたキー（'traveler.t_xxx' など） */
  readonly key: string;
  /** 保存している値（JSON として読めればその値、読めなければ元の文字列） */
  readonly value: unknown;
}

/** 利用者のデータ全体のポート */
export interface DataPort {
  /** 範囲内のデータをキーの昇順ですべて読む */
  readAll(): Promise<Result<readonly UserDataEntry[]>>;
  /** 範囲内のデータをすべて消す（物理削除）。消した件数を返す */
  deleteAll(): Promise<Result<{ readonly removed: number }>>;
}
