/**
 * @file デモメニューの操作の共通部品（presentation/screens/Demo 層）
 * 各パネルに渡す依存（DemoPanelDeps）と、メニュー全体で1つずつしか操作を走らせない実行役（二重押し防止）。
 * 失敗はトーストで知らせる（AppError.message は利用者向けの日本語）。
 */
import type { DemoServices } from '@/application/AppServices';
import { createLogger } from '@/Common/logging/logger';
import type { AppError } from '@/Common/result/Result';
import type { ToastHost } from '@/Common/ui/Toast';
import type { AppContext } from '@/presentation/App/AppContext';

const logger = createLogger('presentation/screens/Demo/demoAction');

/** 各パネルに渡す依存 */
export interface DemoPanelDeps {
  readonly ctx: AppContext;
  /** デモ専用ユースケース（存在を確認済み） */
  readonly demo: DemoServices;
  /** 二重押し防止つきの実行役 */
  readonly runner: DemoActionRunner;
  /** メニュー内の日付・旅人の表示を最新にする */
  readonly onStatusChanged: () => Promise<void>;
}

/** メニュー全体で操作を1つずつ実行する（実行中の他の操作は無視して知らせる） */
export class DemoActionRunner {
  private readonly toast: ToastHost;
  private busy = false;

  /**
   * 実行役を作る。
   * @param toast 処理中・失敗を知らせるトースト
   */
  constructor(toast: ToastHost) {
    this.toast = toast;
  }

  /**
   * 操作を実行する。別の操作が実行中なら何もしない。想定外の例外は記録して失敗を知らせる。
   * @param name 操作名（ログ用）
   * @param action 実行する処理
   * @sideEffect action を呼ぶ。実行中・失敗時はトーストを出す
   */
  async run(name: string, action: () => Promise<void>): Promise<void> {
    const log = logger.fn('run', { name, busy: this.busy });
    if (this.busy) {
      this.toast.show('前の操作を処理しています', { kind: 'info' });
      return log.exit(undefined, '実行中のため無視');
    }
    this.busy = true;
    try {
      await action();
    } catch (error) {
      // 画面の境界：想定外の例外でメニューが固まらないよう、記録して知らせる
      log.error('デモ操作で想定外の例外が起きました', { name, error });
      this.toast.show('操作に失敗しました。もう一度お試しください', { kind: 'error' });
    } finally {
      this.busy = false;
    }
    log.exit(undefined);
  }
}

/**
 * ユースケースの失敗をトーストで知らせる。
 * @param ctx 画面コンテキスト
 * @param error 失敗（message は利用者向けの日本語）
 * @sideEffect エラーのトーストを出す
 */
export function showDemoError(ctx: AppContext, error: AppError): void {
  const log = logger.fn('showDemoError', { code: error.code });
  ctx.toast.show(error.message, { kind: 'error' });
  log.exit(undefined);
}
