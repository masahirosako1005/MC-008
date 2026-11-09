/**
 * @file 店舗CMS のログイン画面（presentation/cms/screens/Login。docs/09 C01、CMS-A04）
 * ID とパスワードだけ。説明文は置かない。失敗の文はサーバーの文をそのまま出す（ID の有無で変わらない同じ文＝SEC-19）。
 * 連携サーバーにつなぐ版で、セッションが無いときに CmsApp が出す。デモでは出ない（自動で運営者としてデモのログイン）。
 * パスワードは入力欄から送るだけで、どこにも保存せず、ログにも出さない（SEC-25）。
 */
import '@/presentation/cms/cmsAuth.css';
import type { CmsAuthServices } from '@/application/CmsAuthServices';
import type { CmsPrincipalDto } from '@/application/dto/CmsAuthDto';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import type { AppError } from '@/Common/result/Result';
import { h } from '@/Common/ui/dom';

const logger = createLogger('presentation/cms/screens/Login/CmsLoginScreen');

/** ログイン画面の設定 */
export interface CmsLoginScreenOptions {
  readonly auth: CmsAuthServices;
  /** ログインできたとき */
  readonly onLoggedIn: (me: CmsPrincipalDto) => void;
}

/**
 * 失敗を画面の文にする（サーバーの文は利用者向けの日本語。つながらないときだけ言い換える）。
 * @param error 失敗
 * @returns 文
 */
export function loginErrorText(error: AppError): string {
  const log = logger.fn('loginErrorText', { code: error.code });
  if (error.code === 'NETWORK_FAILED' || error.code === 'INVALID_RESPONSE') return log.exit('サーバーにつながりません');
  if (error.code === 'INVALID_INPUT') return log.exit('ID とパスワードを入力してください');
  return log.exit(error.message);
}

/**
 * ラベルつきの入力欄を作る。
 * @param label ラベル
 * @param input 入力要素（id を持つこと）
 * @returns 入力欄
 */
function field(label: string, input: HTMLInputElement): HTMLElement {
  return h('div', { class: 'cms-field' }, [h('label', { class: 'cms-field__label', attrs: { for: input.id }, text: label }), input]);
}

/**
 * ログイン画面を作る。
 * @param opts ログインの入口と、できたときの処理
 * @returns 画面の要素
 */
export function renderCmsLoginScreen(opts: CmsLoginScreenOptions): HTMLElement {
  const log = logger.fn('renderCmsLoginScreen');
  const id = h('input', { class: 'cms-input', attrs: { type: 'text', id: 'cms-login-id', 'data-testid': 'cms-login-id', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: 64 } });
  const password = h('input', { class: 'cms-input', attrs: { type: 'password', id: 'cms-login-password', 'data-testid': 'cms-login-password', autocomplete: 'current-password', maxlength: 128 } });
  const error = h('p', { class: 'cms-login__error', attrs: { role: 'alert', 'data-testid': 'cms-login-error' } });
  const button = h('button', { class: 'btn btn--primary', attrs: { type: 'submit', 'data-testid': 'cms-login-submit' } }, [h('span', { class: 'btn__label', text: 'ログイン' })]);
  /** 送る（二重送信はボタンの無効化で防ぐ） */
  const submit = async (): Promise<void> => {
    setCorrelationId();
    const submitLog = logger.fn('submit');
    if (button.disabled) return submitLog.exit(undefined, 'busy');
    error.textContent = '';
    button.disabled = true;
    const result = await opts.auth.login.execute({ loginId: id.value, password: password.value });
    button.disabled = false;
    if (!result.ok) {
      error.textContent = loginErrorText(result.error);
      password.value = '';
      password.focus();
      return submitLog.fail(undefined, result.error.code);
    }
    password.value = '';
    opts.onLoggedIn(result.value);
    return submitLog.exit(undefined);
  };
  const form = h('form', { class: 'cms-login__form', attrs: { novalidate: true, 'data-testid': 'cms-login-form' }, on: { submit: (event) => { event.preventDefault(); void submit(); } } }, [
    field('ID', id), field('パスワード', password), error, button,
  ]);
  const screen = h('div', { class: 'cms-login', attrs: { 'data-testid': 'cms-login' } }, [h('div', { class: 'cms-login__panel' }, [h('p', { class: 'cms-login__logo', text: 'かよいまち お店管理' }), form])]);
  requestAnimationFrame(() => id.focus());
  return log.exit(screen);
}
