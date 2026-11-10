/**
 * @file エントリポイント。DI コンテナを作って App を起動するだけ（docs/02 §1）。
 * 想定外の例外はグローバルハンドラで捕まえてログに残し、画面には内部情報を出さない（docs/03 §5、SEC-26）。
 */
import { APP_BACKEND, isDemoBuild } from '@/Common/constants/env';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { loadLoginOptions } from '@/infrastructure/di/appLogin';
import { createContainer } from '@/infrastructure/di/container';
import { App } from '@/presentation/App/App';
import { renderLoginScreen } from '@/presentation/screens/Login/LoginScreen';

const logger = createLogger('main');

/**
 * 想定外の例外・未処理の Promise 拒否をログに残すハンドラを登録する。
 * スタックトレースや内部情報は画面に出さない（OWASP A10）。
 * @sideEffect window にイベントリスナを登録する
 */
function installGlobalErrorHandlers(): void {
  const log = logger.fn('installGlobalErrorHandlers');
  window.addEventListener('error', (event) => {
    log.error('想定外のエラー', { message: event.message });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    log.error('未処理の Promise 拒否', { message: reason instanceof Error ? reason.message : 'unknown' });
  });
  log.exit(undefined);
}

/**
 * 起動に失敗したときの案内を表示する（DOM API のみ。innerHTML は使わない）。
 * @param root 表示先
 * @param message 利用者向けの安全なメッセージ
 * @sideEffect root の中身を置き換える
 */
function renderStartupError(root: HTMLElement, message: string): void {
  const log = logger.fn('renderStartupError');
  root.replaceChildren(
    h('div', { class: 'startup-error', attrs: { role: 'alert', 'data-testid': 'startup-error' } }, [
      h('p', { text: 'アプリを起動できませんでした。' }),
      h('p', { text: message }),
    ]),
  );
  log.exit(undefined);
}

/**
 * アプリを起動する。
 * @sideEffect DI コンテナを作り（マスタ読込・旅人の用意）、#app に画面を描画する
 */
async function bootstrap(): Promise<void> {
  setCorrelationId();
  const log = logger.fn('bootstrap', { demo: isDemoBuild });
  installGlobalErrorHandlers();
  const root = document.getElementById('app');
  if (!root) return log.fail(undefined, '#app がありません');
  const services = await createContainer({ mode: isDemoBuild ? 'demo' : 'production' });
  if (!services.ok && APP_BACKEND === 'server' && services.error.code === 'UNAUTHENTICATED') {
    // 商用版でログインしていない：ログインの画面を出す（docs/12 §5）
    const options = await loadLoginOptions();
    renderLoginScreen(root, options.ok ? options.value : []);
    return log.exit(undefined, 'login');
  }
  if (!services.ok) {
    renderStartupError(root, services.error.message);
    return log.fail(undefined, services.error.code);
  }
  await new App(root, services.value).start();
  return log.exit(undefined);
}

void bootstrap();
