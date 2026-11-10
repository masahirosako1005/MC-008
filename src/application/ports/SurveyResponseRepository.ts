/**
 * @file お店のアンケートの回答の保存 IF（application 層のポート）
 * 利用者アプリが回答を足し、店舗CMS が読む。回答は匿名で、お店側に届いたデータとして扱う（利用者の「書き出し・全削除」の対象外）。
 * 実装は infrastructure/storage/LocalStorageSurveyResponseRepository（同じブラウザの利用者アプリと CMS が同じキーを読み書きする）。
 * 連携サーバーへ送る経路はまだ無い（docs/09 CMS-V07）。
 */
import type { Result } from '@/Common/result/Result';
import type { SurveyResponse } from '@/application/usecases/survey/shopSurvey';

/** 保存しておく回答の件数の上限（仮。超えたら古いものから落とす。保存先が localStorage のため） */
export const SURVEY_RESPONSE_LIMIT = 500;

/** アンケートの回答のリポジトリ */
export interface SurveyResponseRepository {
  /** 回答をすべて読む（古い → 新しい。未保存なら空） */
  list(): Promise<Result<readonly SurveyResponse[]>>;
  /** 回答を1件足す（同じ id がすでにあれば何もしない＝DI-07） */
  append(response: SurveyResponse): Promise<Result<void>>;
  /** 回答をすべて消す（デモのやり直し） */
  clear(): Promise<Result<void>>;
}
