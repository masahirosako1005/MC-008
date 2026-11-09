/**
 * @file デモ専用ユースケースの共通ガード（application 層）
 * isDemoBuild が false（本番ビルド）のときはデモ操作を DEMO_DISABLED で拒否する（SEC-02 の二重防御。container 側でも登録しない）。
 * デモ操作の呼び出しは成否にかかわらず warn ログで記録する（DI-20）。
 */
import { isDemoBuild } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';

const logger = createLogger('application/usecases/demo/demoGuard');

/** デモ専用ユースケースに共通の依存（テストでは enabled: true で有効化する） */
export interface DemoSwitch {
  /** デモ操作を許可するか（省略時は isDemoBuild。本番ビルドでは false＝SEC-02） */
  readonly enabled?: boolean;
}

/**
 * デモ操作を許可するかを決める（明示が無ければビルド種別 isDemoBuild に従う）。
 * @param deps デモ専用ユースケースの依存
 * @returns 許可するなら true
 */
export function isDemoEnabled(deps: DemoSwitch): boolean {
  return deps.enabled ?? isDemoBuild;
}

/**
 * デモ操作が無効なときの失敗値を作る。
 * @returns DEMO_DISABLED の失敗 Result
 * @see docs/05_security_checklist.md SEC-02
 */
export function demoDisabled(): Result<never, AppError<'DEMO_DISABLED'>> {
  const log = logger.fn('demoDisabled');
  return log.exit(fail(AppError.of('DEMO_DISABLED', 'この操作はデモ版でのみ使えます')));
}
