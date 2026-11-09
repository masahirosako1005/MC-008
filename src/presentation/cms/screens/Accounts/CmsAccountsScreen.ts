/**
 * @file 店舗CMS のアカウント管理（presentation/cms/screens/Accounts。docs/09 O07、CMS-A02・A04・A07）。運営者だけ
 * 一覧（名前・ID・区分・担当店舗・状態）と、追加・担当店舗の変更・パスワードの作り直し・停止と再開。
 * 新しいパスワードはこの画面で作り（暗号学的乱数＝SEC-12）、1回だけ表示して運営者が本人に渡す。保存も送信の記録もしない。
 * 権限の確認はサーバーが行う（SEC-03）。説明文は置かない。
 */
import '@/presentation/cms/cmsAuth.css';
import type { CmsAccountServices } from '@/application/CmsAuthServices';
import type { CmsAccountDto, CmsRole } from '@/application/dto/CmsAuthDto';
import type { CmsShopSummaryDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { openModal } from '@/Common/ui/Modal';
import { badge, formSection, markDanger, pageTitle, textField } from '@/presentation/cms/cmsUi';
import type { CmsContext } from '@/presentation/cms/cmsUi';

const logger = createLogger('presentation/cms/screens/Accounts/CmsAccountsScreen');

/** 作るパスワードの文字（見まちがえやすい 0 O 1 l I を除く） */
const PASSWORD_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 作るパスワードの長さ */
const GENERATED_PASSWORD_LENGTH = 12;
/** 区分の表示名 */
const ROLE_LABELS: Readonly<Record<CmsRole, string>> = { shopOwner: '店舗', operator: '運営者' };

/**
 * 新しいパスワードを作る（暗号学的乱数。偏りを避けるため、余りの出るバイトは捨てる）。
 * @param length 長さ
 * @returns パスワード
 */
export function generatePassword(length = GENERATED_PASSWORD_LENGTH): string {
  const log = logger.fn('generatePassword', { length });
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out += PASSWORD_ALPHABET.charAt(byte % PASSWORD_ALPHABET.length);
    }
  }
  return log.exit(out);
}

/**
 * 店舗を選ぶ欄（複数）を作る。
 * @param shops 店舗の一覧
 * @param selected 選んである店舗
 * @param testId テスト用 ID
 * @returns select
 */
function shopSelect(shops: readonly CmsShopSummaryDto[], selected: readonly string[], testId: string): HTMLSelectElement {
  const log = logger.fn('shopSelect', { shops: shops.length, selected: selected.length });
  return log.exit(h('select', { class: 'cms-select cms-select--multi', attrs: { multiple: true, 'aria-label': '担当する店舗', 'data-testid': testId } },
    shops.map((s) => h('option', { attrs: { value: s.id, selected: selected.includes(s.id) }, text: `${s.name}（${s.districtName}）` }))));
}

/**
 * select で選んだ値を返す。
 * @param select select
 * @returns 選んだ値
 */
function selectedValues(select: HTMLSelectElement): readonly string[] {
  return [...select.selectedOptions].map((o) => o.value);
}

/**
 * パスワードを1回だけ見せる（渡すためのモーダル）。
 * @param host モーダルを出す先
 * @param loginId ID
 * @param password 作ったパスワード
 * @sideEffect モーダルを開く
 */
function showHandover(host: HTMLElement, loginId: string, password: string): void {
  const log = logger.fn('showHandover');
  const body = h('div', { class: 'cms-handover' }, [
    h('div', { class: 'cms-secret' }, [h('span', { class: 'cms-account__key', text: 'ID' }), h('span', { class: 'cms-secret__value', attrs: { 'data-testid': 'cms-handover-id' }, text: loginId })]),
    h('div', { class: 'cms-secret' }, [h('span', { class: 'cms-account__key', text: 'パスワード' }), h('span', { class: 'cms-secret__value', attrs: { 'data-testid': 'cms-handover-password' }, text: password })]),
  ]);
  openModal({ title: '本人に渡してください', body, host, testId: 'cms-handover', actions: [{ label: '閉じる', variant: 'secondary', testId: 'cms-handover-close', onClick: (): void => undefined }] });
  log.exit(undefined);
}

/** 画面の部品と状態 */
interface AccountsView {
  readonly ctx: CmsContext;
  readonly accounts: CmsAccountServices;
  readonly host: HTMLElement;
  readonly list: HTMLElement;
  shops: readonly CmsShopSummaryDto[];
  /** 一覧を読み直して描く */
  reload(): Promise<void>;
}

/**
 * 担当店舗の編集（行の下に開く）を作る。
 * @param view 画面
 * @param account 対象
 * @returns 編集の要素
 */
function shopsEditor(view: AccountsView, account: CmsAccountDto): HTMLElement {
  const log = logger.fn('shopsEditor', { accountId: account.id });
  const select = shopSelect(view.shops, account.shopIds, 'cms-account-shops-select');
  const editor = h('div', { class: 'cms-accounts__editor', attrs: { 'data-testid': 'cms-account-shops-editor' } });
  const save = createButton({
    label: '保存', variant: 'primary', testId: 'cms-account-shops-save',
    onClick: async (): Promise<void> => {
      const result = await view.accounts.updateShops.execute({ accountId: account.id, shopIds: selectedValues(select) });
      if (!result.ok) {
        view.ctx.toast.show(result.error.message.slice(0, 12), 'error');
        return;
      }
      view.ctx.toast.show('保存しました');
      await view.reload();
    },
  });
  const cancel = createButton({ label: 'やめる', variant: 'ghost', testId: 'cms-account-shops-cancel', onClick: (): void => editor.remove() });
  editor.append(select, h('div', { class: 'cms-inline' }, [cancel, save]));
  return log.exit(editor);
}

/**
 * パスワードを作り直す（確認 → 作る → 1回だけ見せる）。
 * @param view 画面
 * @param account 対象
 * @sideEffect 確認のモーダルを開き、サーバーのパスワードを置き換える
 */
function resetPassword(view: AccountsView, account: CmsAccountDto): void {
  const log = logger.fn('resetPassword', { accountId: account.id });
  const modal = openModal({
    title: `${account.displayName} のパスワードを作り直しますか？`, body: '', host: view.host, testId: 'cms-reset-password-modal',
    actions: [
      { label: 'やめる', variant: 'secondary', testId: 'cms-reset-password-cancel', onClick: (): void => undefined },
      {
        label: '作り直す', variant: 'secondary', testId: 'cms-reset-password-confirm',
        onClick: (): void => {
          const password = generatePassword();
          void view.accounts.resetPassword.execute({ accountId: account.id, newPassword: password }).then((result) => {
            if (!result.ok) return view.ctx.toast.show('できませんでした', 'error');
            showHandover(view.host, account.loginId, password);
          });
        },
      },
    ],
  });
  markDanger(modal, 'cms-reset-password-confirm');
  log.exit(undefined);
}

/**
 * 停止・再開する。
 * @param view 画面
 * @param account 対象
 * @sideEffect サーバーの状態を変え、一覧を読み直す
 */
async function toggleStatus(view: AccountsView, account: CmsAccountDto): Promise<void> {
  const log = logger.fn('toggleStatus', { accountId: account.id, status: account.status });
  const result = await view.accounts.setStatus.execute({ accountId: account.id, status: account.status === 'active' ? 'suspended' : 'active' });
  if (!result.ok) {
    view.ctx.toast.show(result.error.message.slice(0, 12), 'error');
    return log.fail(undefined, result.error.code);
  }
  view.ctx.toast.show(result.value.status === 'suspended' ? '停止しました' : '再開しました');
  await view.reload();
  return log.exit(undefined);
}

/**
 * 行の右端の操作を作る。
 * @param view 画面
 * @param account 対象
 * @param row 行（担当店舗の編集を下に開く）
 * @returns 操作の要素
 */
function rowActions(view: AccountsView, account: CmsAccountDto, row: HTMLElement): HTMLElement {
  const log = logger.fn('rowActions', { accountId: account.id, demo: account.demo });
  const actions: HTMLElement[] = [];
  if (account.role === 'shopOwner') {
    actions.push(h('button', { class: 'cms-textbtn', attrs: { type: 'button', 'data-testid': 'cms-account-shops' }, text: '店舗', on: { click: () => { row.querySelector('.cms-accounts__editor')?.remove(); row.append(shopsEditor(view, account)); } } }));
  }
  if (!account.demo) {
    actions.push(h('button', { class: 'cms-textbtn', attrs: { type: 'button', 'data-testid': 'cms-account-password' }, text: 'パスワード', on: { click: () => resetPassword(view, account) } }));
  }
  actions.push(h('button', { class: 'cms-textbtn', attrs: { type: 'button', 'data-testid': 'cms-account-status' }, text: account.status === 'active' ? '停止' : '再開', on: { click: () => void toggleStatus(view, account) } }));
  return log.exit(h('div', { class: 'cms-item__actions' }, actions));
}

/**
 * 一覧の1行を作る。
 * @param view 画面
 * @param account アカウント
 * @returns li
 */
function accountRow(view: AccountsView, account: CmsAccountDto): HTMLElement {
  const log = logger.fn('accountRow', { accountId: account.id });
  const shops = account.role === 'operator' ? '全店舗' : `${account.shopIds.length}店`;
  const badges = [badge(ROLE_LABELS[account.role], account.role === 'operator' ? 'brand' : 'muted')];
  if (account.status === 'suspended') badges.push(badge('停止', 'warn'));
  if (account.locked) badges.push(badge('ロック', 'warn'));
  if (account.demo) badges.push(badge('デモ', 'muted'));
  const row = h('li', { class: 'cms-item', attrs: { 'data-testid': 'cms-account-row', 'data-account-id': account.id } });
  row.append(
    h('span', { class: 'cms-item__main' }, [h('span', { class: 'cms-item__title', text: account.displayName }), h('span', { class: 'cms-muted', text: `${account.loginId}・${shops}` })]),
    h('span', { class: 'cms-accounts__badges' }, badges),
    rowActions(view, account, row),
  );
  return log.exit(row);
}

/**
 * 追加のフォームを作る。
 * @param view 画面
 * @returns フォームの区切り（閉じる関数つき）
 */
function addForm(view: AccountsView): HTMLElement {
  const log = logger.fn('addForm');
  const draft = { displayName: '', loginId: '', role: 'shopOwner' as CmsRole, password: generatePassword() };
  const name = textField({ label: '名前', max: 30, testId: 'cms-new-name', onInput: (v) => { draft.displayName = v; } });
  const login = textField({ label: 'ID', max: 64, testId: 'cms-new-login', onInput: (v) => { draft.loginId = v; } });
  login.input.setAttribute('autocapitalize', 'none');
  const shops = shopSelect(view.shops, [], 'cms-new-shops');
  const role = h('select', { class: 'cms-select', attrs: { 'aria-label': '区分', 'data-testid': 'cms-new-role' } }, [h('option', { attrs: { value: 'shopOwner' }, text: '店舗' }), h('option', { attrs: { value: 'operator' }, text: '運営者' })]);
  role.addEventListener('change', () => { draft.role = role.value === 'operator' ? 'operator' : 'shopOwner'; shops.hidden = draft.role === 'operator'; });
  const secret = h('span', { class: 'cms-secret__value', attrs: { 'data-testid': 'cms-new-password' }, text: draft.password });
  const regenerate = h('button', { class: 'cms-textbtn cms-textbtn--small', attrs: { type: 'button', 'data-testid': 'cms-new-password-again' }, text: '作り直す', on: { click: () => { draft.password = generatePassword(); secret.textContent = draft.password; } } });
  const section = formSection('追加', [], { testId: 'cms-accounts-add' });
  const submit = createButton({
    label: '追加', variant: 'primary', testId: 'cms-new-submit',
    onClick: async (): Promise<void> => {
      name.setError('');
      login.setError('');
      const result = await view.accounts.create.execute({ ...draft, shopIds: draft.role === 'operator' ? [] : selectedValues(shops) });
      if (!result.ok) {
        const field = result.error.details?.['field'];
        (field === 'displayName' ? name : login).setError(result.error.code === 'INVALID_INPUT' || result.error.code === 'LOGIN_ID_TAKEN' ? result.error.message : 'できませんでした');
        return;
      }
      section.remove();
      view.ctx.toast.show('追加しました');
      showHandover(view.host, result.value.loginId, draft.password);
      await view.reload();
    },
  });
  const cancel = createButton({ label: 'やめる', variant: 'ghost', testId: 'cms-new-cancel', onClick: (): void => section.remove() });
  section.append(name.element, login.element, h('div', { class: 'cms-field' }, [h('span', { class: 'cms-field__label', text: '区分' }), role]), shops,
    h('div', { class: 'cms-field' }, [h('span', { class: 'cms-field__label', text: 'パスワード' }), h('div', { class: 'cms-secret' }, [secret, regenerate])]),
    h('div', { class: 'cms-inline' }, [cancel, submit]));
  return log.exit(section);
}

/**
 * アカウント管理の画面を作る。
 * @param ctx 文脈
 * @returns 画面の要素
 */
export function renderCmsAccountsScreen(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderCmsAccountsScreen');
  const list = h('ul', { class: 'cms-items', attrs: { 'data-testid': 'cms-accounts-list', 'aria-busy': 'true' } });
  const panel = h('div', { class: 'cms-panel' });
  const root = h('div', { class: 'cms-onecol', attrs: { 'data-testid': 'cms-screen-accounts' } }, [panel]);
  const accounts = ctx.services.auth?.accounts;
  if (accounts === undefined) {
    panel.append(pageTitle('アカウント'), h('p', { class: 'cms-error', text: '使えません' }));
    return log.exit(root, 'noAuth');
  }
  const view: AccountsView = {
    ctx, accounts, host: root, list, shops: [],
    reload: async (): Promise<void> => {
      const reloadLog = logger.fn('reload');
      const listed = await accounts.list.execute();
      list.removeAttribute('aria-busy');
      list.replaceChildren(...(listed.ok ? listed.value.map((a) => accountRow(view, a)) : [h('li', { class: 'cms-error', text: '読み込めませんでした' })]));
      reloadLog.exit(undefined, listed.ok ? `count=${listed.value.length}` : listed.error.code);
    },
  };
  const add = createButton({ label: '追加', variant: 'primary', testId: 'cms-accounts-new', onClick: (): void => { panel.querySelector('[data-testid="cms-accounts-add"]')?.remove(); panel.insertBefore(addForm(view), panel.children[1] ?? null); } });
  panel.append(pageTitle('アカウント', add), formSection(undefined, [list]));
  void ctx.services.shops.execute().then((shops) => { view.shops = shops.ok ? shops.value : []; });
  void view.reload();
  return log.exit(root);
}
