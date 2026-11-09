/**
 * @file 端末の設定（文字の大きさ）の保存 IF（application 層のポート）
 * 端末ごとに1件だけ持つ（旅人ごとではない。デモの旅人切替でも消えない）。キーは P+'settings'（docs/08 §5）。
 * 値の検証は usecases/settings/settingsValues の parseSettings で行う。実装は infrastructure/storage/LocalStorageSettingsRepository。
 */
import type { Result } from '@/Common/result/Result';
import type { SettingsDto } from '@/application/dto/SettingsDto';

/** 端末の設定のリポジトリ */
export interface SettingsRepository {
  /** 設定を読む（未保存なら undefined） */
  load(): Promise<Result<SettingsDto | undefined>>;
  /** 設定を保存する（上書き） */
  save(settings: SettingsDto): Promise<Result<void>>;
}
