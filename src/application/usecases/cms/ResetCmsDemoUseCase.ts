/**
 * @file 店舗CMS の登録内容をすべて消すユースケース（application/usecases/cms 層・デモ専用）
 * 発表のリハーサルを何度でも同じ状態から始めるため。マスタ（アプリ同梱のデータ）は変わらない。
 * 利用者の訪問記録・カード・アイテムには触れない（失う体験を作らない）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { CmsDeps } from '@/application/usecases/cms/cmsShopView';

const logger = createLogger('application/usecases/cms/ResetCmsDemoUseCase');

/** CMS の登録内容をすべて消す */
export class ResetCmsDemoUseCase implements UseCase<void, void> {
  /**
   * 依存を受け取る。
   * @param deps 登録内容の保存先
   */
  constructor(private readonly deps: Pick<CmsDeps, 'cmsOverlay'>) {}

  /**
   * 登録内容を消す。
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect 登録内容の保存データを消す（利用者アプリはマスタだけの状態に戻る）
   */
  async execute(): Promise<Result<void>> {
    const log = logger.fn('execute');
    const cleared = await this.deps.cmsOverlay.clear();
    if (!cleared.ok) return log.fail(cleared);
    log.warn('CMS の登録内容をすべて消しました（デモ操作）');
    return log.exit(cleared);
  }
}
