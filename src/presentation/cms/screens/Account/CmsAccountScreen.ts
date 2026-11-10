/**
 * @file 店舗CMS の自分のアカウント（presentation/cms/screens/Account。docs/09 C08、CMS-A04）
 * 名前・ID・区分、パスワードの変更、ログアウト。上部バーのアカウントのメニューから開く（タブには出さない）。
 * デモのアカウント（デモの「店を選ぶ」で入ったもの）ではパスワードの変更とログアウトを出さない（出してもすぐ自動で入り直すため）。
 * 説明文は置かない。パスワードはどこにも保存せず、ログにも出さない（SEC-25）。
 */
import '@/presentation/cms/cmsAuth.css';
import type { CmsAuthServices } from '@/application/CmsAuthServices';
import type { CmsPrincipalDto } from '@/application/dto/CmsAuthDto';
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { attachFieldError, formSection, pageTitle } from '@/presentation/cms/cmsUi';
import type { CmsContext } from '@/presentation/cms/cmsUi';
import { loginErrorText } from '@/presentation/cms/screens/Login/CmsLoginScreen';

const logger = createLogger('presentation/cms/screens/Account/CmsAccountScreen');

/** ログアウトしたことをシェルへ知らせるイベント名（CmsApp が受けて画面を作り直す） */
export const CMS_LOGGED_OUT_EVENT = 'cms-logged-out';
/** 区分の表示名 */
const ROLE_LABELS: Readonly<Record<CmsPrincipalDto['role'], string>> = { shopOwner: '店舗', operator: '運営者' };

/**
 * 1行（項目名と値）を作る。
 * @param key 項目名
 * @param value 値
 * @param testId テスト用 ID
 * @returns 行
 */
function row(key: string, value: string, testId: string): HTMLElement {
  return h('div', { class: 'cms-account__row' }, [h('span', { class: 'cms-account__key', text: key }), h('span', { class: 'cms-account__value', attrs: { 'data-testid': testId }, text: value })]);
}

/**
 * パスワードの入力欄を作る。
 * @param label ラベル
 * @param testId テスト用 ID（id にも使う）
 * @param autocomplete ブラウザへのヒント
 * @returns 入力欄と、誤りを出す関数
 */
function passwordField(label: string, testId: string, autocomplete: 'current-password' | 'new-password'): { readonly element: HTMLElement; readonly input: HTMLInputElement; readonly setError: (m: string) => void } {
  const log = logger.fn('passwordField', { testId });
  const input = h('input', { class: 'cms-input', attrs: { type: 'password', id: testId, 'data-testid': testId, autocomplete, maxlength: 128 } });
  const error = attachFieldError(input, `${testId}-error`);
  const element = h('div', { class: 'cms-field' }, [h('label', { class: 'cms-field__label', attrs: { for: testId }, text: label }), input, error.element]);
  return log.exit({ element, input, setError: error.setError });
}

/**
 * パスワードの変更の区切りを作る。
 * @param ctx 文脈
 * @param auth ログインの入口
 * @returns 区切り
 */
function passwordSection(ctx: CmsContext, auth: CmsAuthServices): HTMLElement {
  const log = logger.fn('passwordSection');
  const current = passwordField('今のパスワード', 'cms-pw-current', 'current-password');
  const next = passwordField('新しいパスワード（10文字以上）', 'cms-pw-new', 'new-password');
  const button = createButton({
    label: '変更', variant: 'primary', testId: 'cms-pw-submit',
    onClick: async (): Promise<void> => {
      current.setError('');
      next.setError('');
      const result = await auth.changePassword.execute({ currentPassword: current.input.value, newPassword: next.input.value });
      if (!result.ok) {
        const field = result.error.details?.['field'];
        (field === 'currentPassword' || result.error.code === 'AUTH_FAILED' ? current : next).setError(loginErrorText(result.error));
        return;
      }
      current.input.value = '';
      next.input.value = '';
      ctx.toast.show('変更しました');
    },
  });
  return log.exit(formSection('パスワード', [current.element, next.element, h('div', { class: 'cms-inline' }, [button])], { testId: 'cms-account-password' }));
}

/**
 * ログアウトの区切りを作る。
 * @param ctx 文脈
 * @param auth ログインの入口
 * @param root 画面の要素（イベントを出す）
 * @returns 区切り
 */
function logoutSection(ctx: CmsContext, auth: CmsAuthServices, root: HTMLElement): HTMLElement {
  const log = logger.fn('logoutSection');
  const button = createButton({
    label: 'ログアウト', variant: 'secondary', testId: 'cms-logout',
    onClick: async (): Promise<void> => {
      const result = await auth.logout.execute();
      if (!result.ok && result.error.code !== 'UNAUTHENTICATED') {
        ctx.toast.show('ログアウトできませんでした', 'error');
        return;
      }
      root.dispatchEvent(new CustomEvent(CMS_LOGGED_OUT_EVENT, { bubbles: true }));
    },
  });
  return log.exit(formSection(undefined, [h('div', { class: 'cms-inline' }, [button])], { testId: 'cms-account-logout-section' }));
}

/**
 * 自分のアカウントの画面を作る（中身はログイン中の人を読んでから埋める）。
 * @param ctx 文脈
 * @returns 画面の要素
 */
export function renderCmsAccountScreen(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderCmsAccountScreen');
  const auth = ctx.services.auth;
  const body = h('div', { class: 'cms-account__rows', attrs: { 'data-testid': 'cms-account-rows', 'aria-busy': 'true' } });
  const panel = h('div', { class: 'cms-panel' }, [pageTitle('アカウント'), formSection(undefined, [body])]);
  const root = h('div', { class: 'cms-onecol', attrs: { 'data-testid': 'cms-screen-account' } }, [panel]);
  if (auth === undefined) {
    body.append(row('区分', 'デモ', 'cms-account-role'));
    body.removeAttribute('aria-busy');
    return log.exit(root, 'noAuth');
  }
  void auth.me.execute().then((me) => {
    body.removeAttribute('aria-busy');
    if (!me.ok) {
      body.append(h('p', { class: 'cms-error', text: '読み込めませんでした' }));
      return;
    }
    body.append(row('名前', me.value.displayName, 'cms-account-name'), row('ID', me.value.loginId, 'cms-account-login'), row('区分', ROLE_LABELS[me.value.role], 'cms-account-role'));
    if (me.value.demo) return;
    panel.append(passwordSection(ctx, auth), logoutSection(ctx, auth, root));
  });
  return log.exit(root);
}
