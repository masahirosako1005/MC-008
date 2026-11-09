/**
 * @file 店舗CMS（cms.html）のエントリポイント（docs/09 §7.2・§7.3）
 * - デモビルド：ブラウザだけ（localStorage）か、連携サーバーにつなぐ（VITE_CMS_BACKEND=server）
 * - 本番（--mode cms）：連携サーバーにつなぐ版だけ。ログインが要る（CmsApp が出す）。利用者アプリの本番ビルドには cms.html を含めない（vite.config.ts）
 * 本番ビルドでブラウザだけの版が読み込まれても、cmsContainer が DEMO_DISABLED を返して案内だけを出す（MUST-8, SEC-02 の二重の防御）。
 */
import { isDemoBuild } from '@/Common/constants/env';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createCmsContainer } from '@/infrastructure/di/cmsContainer';
import { CmsApp } from '@/presentation/cms/CmsApp';

const logger = createLogger('cmsMain');

/**
 * 起動できないときの案内を出す。
 * @param root 表示先
 * @param message 利用者向けの安全なメッセージ
 * @sideEffect root の中身を置き換える
 */
function renderStartupError(root: HTMLElement, message: string): void {
  const log = logger.fn('renderStartupError');
  root.replaceChildren(h('div', { class: 'startup-error', attrs: { role: 'alert' } }, [h('p', { text: '店舗CMS を起動できませんでした。' }), h('p', { text: message })]));
  log.exit(undefined);
}

/**
 * 店舗CMS を起動する。
 * @sideEffect マスタを読み、#cms に画面を描く
 */
async function bootstrap(): Promise<void> {
  setCorrelationId();
  const log = logger.fn('bootstrap', { demo: isDemoBuild });
  const root = document.getElementById('cms');
  if (!root) return log.fail(undefined, '#cms がありません');
  const services = await createCmsContainer({ mode: isDemoBuild ? 'demo' : 'production' });
  if (!services.ok) {
    renderStartupError(root, services.error.message);
    return log.fail(undefined, services.error.code);
  }
  await new CmsApp(root, services.value).start();
  return log.exit(undefined);
}

void bootstrap();
