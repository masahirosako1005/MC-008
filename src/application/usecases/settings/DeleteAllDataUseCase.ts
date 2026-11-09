/**
 * @file 端末に保存した利用者のデータをすべて消すユースケース（application 層・書込系。PRV-05、DI-22 物理削除）
 * 設定画面の「すべてのデータを削除」→ 確認ダイアログの「削除する」で使う。confirmed が true でなければ何も消さない（誤操作の守り）。
 * これはゲームの仕組みで進み具合を減らす操作ではなく、利用者が自分の意思で端末から個人データを消す手段（CLAUDE.md 5 章の例外。PRV-05）。
 * 消した後は画面側がアプリを読み込み直し、起動時の EnsureTravelerUseCase が新しい旅人を用意する。
 * 監査のため、消したこと（件数のみ）を warn で残す（DI-20）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { DeleteAllDataInput, DeleteAllDataOutput } from '@/application/dto/SettingsDto';
import type { DataPort } from '@/application/ports/DataPort';

const logger = createLogger('application/usecases/settings/DeleteAllDataUseCase');

/** DeleteAllDataUseCase の依存 */
export interface DeleteAllDataDeps {
  readonly userData: DataPort;
}

/** 利用者のデータをすべて消す */
export class DeleteAllDataUseCase implements UseCase<DeleteAllDataInput, DeleteAllDataOutput> {
  /**
   * 依存を受け取る。
   * @param deps データ全体のポート
   */
  constructor(private readonly deps: DeleteAllDataDeps) {}

  /**
   * 確認済みなら、保存データをすべて消す。
   * @param input 確認済みか
   * @returns 成功: 消した件数。失敗: INVALID_INPUT（未確認）／STORAGE_FAILED（一部を消せなかった）
   * @sideEffect 保存データを物理削除する
   */
  async execute(input: DeleteAllDataInput): Promise<Result<DeleteAllDataOutput>> {
    const log = logger.fn('execute', { confirmed: input.confirmed });
    if (input.confirmed !== true) {
      return log.fail(fail(AppError.of('INVALID_INPUT', '削除の確認が済んでいません', { field: 'confirmed' })), '未確認');
    }
    const deleted = await this.deps.userData.deleteAll();
    if (!deleted.ok) return log.fail(deleted);
    log.warn('利用者の操作で、端末の保存データをすべて削除しました（PRV-05）', { removed: deleted.value.removed });
    return log.exit(ok({ removed: deleted.value.removed }));
  }
}
