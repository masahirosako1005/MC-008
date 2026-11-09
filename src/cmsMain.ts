/**
 * @file 店舗CMS（cms.html）のエントリポイント（docs/09 §7.2 フェーズ1）
 * デモビルドだけで動く（MUST-8, SEC-02）。本番ビルドには cms.html 自体を含めない（vite.config.ts）うえ、
 * 万一読み込まれても isDemoBuild でなければ案内だけを出して何もしない（二重の防御）。
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
