/**
 * @file ログインの画面（presentation 層。商用版＝利用者データのサーバーにつなぐ版だけで出る。docs/12 §5）
 * 文字は最小限（アプリ名と、提供元の名前のボタンだけ。説明文は足さない）。ボタンは同じオリジンの決まった道筋へのリンクで、
 * 押すと提供元（LINE・Google など）の同意の画面へ移動する。判断基準 A（初回に迷わせない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import '@/Common/ui/styles/tokens.css';
import '@/Common/ui/styles/base.css';
import '@/presentation/screens/Login/Login.css';

const logger = createLogger('presentation/screens/Login/LoginScreen');

/** ボタン1つ分 */
export interface LoginButton {
  /** ボタンに出す名前 */
  readonly label: string;
  /** 移動先（同じオリジンの道筋） */
  readonly startPath: string;
}

/**
 * ログインの画面を描く。
 * @param root 表示先
 * @param buttons 提供元ごとのボタン（空なら「ただいま利用できません」だけを出す）
 * @sideEffect root の中身を置き換える
 */
export function renderLoginScreen(root: HTMLElement, buttons: readonly LoginButton[]): void {
  const log = logger.fn('renderLoginScreen', { buttons: buttons.length });
  const links = buttons.map((button) =>
    h('a', { class: 'login__button', attrs: { href: button.startPath, 'data-testid': 'login-button' }, text: `${button.label}でログイン` }));
  root.replaceChildren(
    h('main', { class: 'login', attrs: { 'data-testid': 'login-screen' } }, [
      h('h1', { class: 'login__title', text: 'まちクエ' }),
      ...(links.length > 0 ? [h('div', { class: 'login__buttons' }, links)] : [h('p', { class: 'login__empty', attrs: { role: 'alert' }, text: 'ただいま利用できません' })]),
    ]),
  );
  log.exit(undefined);
}
