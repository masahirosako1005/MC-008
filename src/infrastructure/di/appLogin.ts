/**
 * @file ログインの画面に出す提供元の読み込み（infrastructure/di 層。docs/12 §5）
 * 商用版（VITE_APP_BACKEND=server）でログインしていないとき、main がこれで提供元の一覧を取り、ログインの画面に渡す。
 * 応答は外部データなので、ID の書式と名前の長さを確かめる（DI-01）。移動先は自分のオリジンの決まった道筋だけ（外の URL を受け取らない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { isRecord } from '@/Common/utils/guards';
import { requestApi } from '@/infrastructure/api/requestApi';
import type { ApiClientDeps } from '@/infrastructure/api/requestApi';
import { APP_API } from '@/infrastructure/api/ServerPlayState';

const logger = createLogger('infrastructure/di/appLogin');

/** 提供元の ID の書式（サーバーの PROVIDER_ID_PATTERN と同じ） */
const PROVIDER_ID_PATTERN = /^[a-z]{2,16}$/;
/** 画面に出す名前の長さの上限 */
const MAX_LABEL_LENGTH = 24;

/** ログインの画面に出す提供元 */
export interface LoginOption {
  readonly id: string;
  /** ボタンに出す名前（'LINE'・'Google' など） */
  readonly label: string;
  /** ログインを始める道筋（同じオリジン） */
  readonly startPath: string;
}

/**
 * 使える提供元を読む。
 * @param api 呼び出しの依存（省略時は同じオリジン）
 * @returns 成功: 提供元（形の合わないものは除く）。失敗: NETWORK_FAILED / INVALID_RESPONSE
 * @sideEffect ネットワーク
 */
export async function loadLoginOptions(api: ApiClientDeps = {}): Promise<Result<readonly LoginOption[]>> {
  const log = logger.fn('loadLoginOptions');
  const response = await requestApi(api, { method: 'GET', path: APP_API.providers });
  if (!response.ok) return log.fail(response);
  const list: unknown = isRecord(response.value) ? response.value['providers'] : undefined;
  const items: readonly unknown[] = Array.isArray(list) ? list : [];
  const options = items.flatMap((item): LoginOption[] => {
    if (!isRecord(item)) return [];
    const { id, label } = item;
    if (typeof id !== 'string' || !PROVIDER_ID_PATTERN.test(id) || typeof label !== 'string' || label.length === 0 || label.length > MAX_LABEL_LENGTH) return [];
    return [{ id, label, startPath: APP_API.loginStart(id) }];
  });
  return log.exit(ok(options), `count=${options.length}`);
}
