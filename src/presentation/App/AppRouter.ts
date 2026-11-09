/**
 * @file hash ルーター（presentation/App 層）
 * 画面遷移はここ経由のみ（location.href 直書き禁止。hash の書き換えはこのファイルだけ＝docs/03 §7）。
 * パラメータは Id の parse 関数で検証し、不正なら #/map へ戻す（SEC-16）。#/demo はデモビルドのときだけ登録する（SEC-02）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId, parseSpotId } from '@/Common/types/Id';

const logger = createLogger('presentation/App/AppRouter');

/** ルート名（画面フォルダと対応＝docs/02 §2） */
export type RouteName = 'map' | 'spot' | 'zukan' | 'mytown' | 'ranking' | 'settings' | 'demo';

/** 解決済みのルート */
export interface RouteMatch {
  readonly name: RouteName;
  /** 検証済みのパラメータ（districtId・spotId） */
  readonly params: Readonly<Record<string, string>>;
  /** 正規化した hash（'#/spot/l_jo01' など） */
  readonly path: string;
}

/** 地図へ戻した理由 */
export type RedirectReason = 'empty' | 'unknown' | 'invalid-param' | 'demo-disabled' | 'too-long';

/** resolveRoute の結果 */
export interface RouteResolution {
  readonly match: RouteMatch;
  readonly redirected: boolean;
  readonly reason?: RedirectReason;
}

/** ルート定義 */
interface RouteDef {
  readonly name: RouteName;
  /** '/map/:districtId' の形 */
  readonly pattern: string;
  /** デモビルドのときだけ有効 */
  readonly demoOnly?: boolean;
}

/** ルート表（docs/02 §2.1 の画面遷移表・docs/08 §6 と同期させる） */
export const ROUTES: readonly RouteDef[] = [
  { name: 'map', pattern: '/map' },
  { name: 'map', pattern: '/map/:districtId' },
  { name: 'spot', pattern: '/spot/:spotId' },
  { name: 'zukan', pattern: '/zukan' },
  { name: 'zukan', pattern: '/zukan/:districtId' },
  { name: 'mytown', pattern: '/mytown' },
  { name: 'ranking', pattern: '/ranking' },
  { name: 'settings', pattern: '/settings' },
  { name: 'demo', pattern: '/demo', demoOnly: true },
];

/** 既定のルート（起動時・不正時の戻り先） */
export const DEFAULT_PATH = '#/map';

/** これより長い hash は検証せずに地図へ戻す */
export const MAX_HASH_LENGTH = 200;

/** パラメータ名ごとの検証関数（SEC-16） */
const PARAM_PARSERS: Readonly<Record<string, (raw: unknown) => Result<string>>> = {
  districtId: parseDistrictId,
  spotId: parseSpotId,
};

/** 既定ルートの解決結果 */
const DEFAULT_MATCH: RouteMatch = { name: 'map', params: {}, path: DEFAULT_PATH };

/**
 * 'map' や '/map' や '#/map?x' を '#/map' の形にそろえる（クエリ部分は捨てる）。
 * @param raw 入力のパスまたは hash
 * @returns '#/' で始まる正規化した hash（空なら ''）
 */
export function normalizeHashPath(raw: string): string {
  const log = logger.fn('normalizeHashPath', { length: raw.length });
  const withoutQuery = raw.split('?')[0] ?? '';
  const body = withoutQuery.replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  return log.exit(body.length === 0 ? '' : `#/${body}`);
}

/**
 * パターンと区切り済みの hash を照合し、パラメータを取り出す（検証はしない）。
 * @param pattern '/map/:districtId' の形
 * @param segments hash を '/' で区切ったもの
 * @returns 一致すればパラメータ、しなければ undefined
 */
function matchPattern(pattern: string, segments: readonly string[]): Record<string, string> | undefined {
  const log = logger.fn('matchPattern', { pattern });
  const parts = pattern.split('/').filter((p) => p.length > 0);
  if (parts.length !== segments.length) return log.exit(undefined);
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? '';
    const segment = segments[i] ?? '';
    if (part.startsWith(':')) params[part.slice(1)] = segment;
    else if (part !== segment) return log.exit(undefined);
  }
  return log.exit(params);
}

/**
 * パラメータをすべて検証する。
 * @param params 取り出したパラメータ
 * @returns すべて ID 形式を満たせば true（検証関数が無い名前は不正扱い）
 */
function areParamsValid(params: Readonly<Record<string, string>>): boolean {
  const log = logger.fn('areParamsValid', { keys: Object.keys(params) });
  for (const [key, value] of Object.entries(params)) {
    const parser = PARAM_PARSERS[key];
    if (parser === undefined || !parser(value).ok) return log.exit(false);
  }
  return log.exit(true);
}

/**
 * hash をルートに解決する（純粋関数）。不正・未知・デモ無効なら地図へ戻す結果を返す。
 * @param hash location.hash またはパス（'#/spot/l_jo01'、'/map' など）
 * @param isDemo デモビルドなら true（#/demo を有効にする）
 * @returns 解決結果（redirected=true なら match は地図）
 */
export function resolveRoute(hash: string, isDemo: boolean): RouteResolution {
  const log = logger.fn('resolveRoute', { length: hash.length, isDemo });
  if (hash.length > MAX_HASH_LENGTH) return log.exit({ match: DEFAULT_MATCH, redirected: true, reason: 'too-long' });
  const path = normalizeHashPath(hash);
  if (path === '') return log.exit({ match: DEFAULT_MATCH, redirected: true, reason: 'empty' });
  const segments = path.slice(2).split('/');
  for (const def of ROUTES) {
    const params = matchPattern(def.pattern, segments);
    if (params === undefined) continue;
    if (def.demoOnly === true && !isDemo) return log.exit({ match: DEFAULT_MATCH, redirected: true, reason: 'demo-disabled' });
    if (!areParamsValid(params)) return log.exit({ match: DEFAULT_MATCH, redirected: true, reason: 'invalid-param' });
    return log.exit({ match: { name: def.name, params, path }, redirected: false });
  }
  return log.exit({ match: DEFAULT_MATCH, redirected: true, reason: 'unknown' });
}

/** AppRouter のオプション */
export interface AppRouterOptions {
  readonly isDemo: boolean;
  /** テスト用に差し替え可能（省略時 window） */
  readonly win?: Window;
}

/** ルート変化の通知先 */
export type RouteListener = (route: RouteMatch) => void;

/** hash ルーター */
export class AppRouter {
  private readonly isDemo: boolean;
  private readonly win: Window;
  private readonly listeners = new Set<RouteListener>();
  private currentRoute: RouteMatch;
  /** navigate で積んだ履歴の深さ（back で戻れるか判定する） */
  private depth = 0;
  private started = false;

  /**
   * ルーターを作る（start するまで hashchange を監視しない）。
   * @param opts デモビルドか・window
   */
  constructor(opts: AppRouterOptions) {
    this.isDemo = opts.isDemo;
    this.win = opts.win ?? window;
    this.currentRoute = resolveRoute(this.win.location.hash, this.isDemo).match;
  }

  /**
   * hashchange の監視を始め、今の hash を解決して通知する（空・不正なら #/map に置き換える）。
   * @sideEffect hashchange リスナを登録し、必要なら履歴を置き換え、onChange の購読者を呼ぶ
   */
  start(): void {
    const log = logger.fn('start', { isDemo: this.isDemo });
    if (this.started) return log.exit(undefined);
    this.started = true;
    this.win.addEventListener('hashchange', this.onHashChange);
    this.sync();
    log.exit(undefined);
  }

  /**
   * 画面を移動する。検証で不正なら #/map へ。同じ hash なら何もしない。
   * @param path 移動先（'#/spot/l_jo01'、'/map' など）
   * @param opts replace=true なら履歴を積まずに置き換える
   * @sideEffect location.hash または履歴を変更し、onChange の購読者を呼ぶ
   */
  navigate(path: string, opts: { readonly replace?: boolean } = {}): void {
    const log = logger.fn('navigate', { path, replace: opts.replace === true });
    const resolution = resolveRoute(path, this.isDemo);
    if (resolution.redirected) log.warn('移動先が不正なため地図へ移動します（SEC-16）', { reason: resolution.reason });
    const target = resolution.match.path;
    if (target === this.win.location.hash) return log.exit(undefined, '同じ画面');
    if (opts.replace === true) {
      this.win.history.replaceState(null, '', target);
      this.sync();
    } else {
      this.depth += 1;
      this.win.location.hash = target;
    }
    log.exit(undefined);
  }

  /**
   * 前の画面へ戻る。アプリ内で積んだ履歴が無ければ地図へ。
   * @sideEffect 履歴を戻すか、#/map に置き換える
   */
  back(): void {
    const log = logger.fn('back', { depth: this.depth });
    if (this.depth > 0) {
      this.depth -= 1;
      this.win.history.back();
    } else {
      this.navigate(DEFAULT_PATH, { replace: true });
    }
    log.exit(undefined);
  }

  /**
   * 今のルートをもう一度通知する（同じ画面を作り直したいとき。旅人切替の後・エラーからの復帰など）。
   * @sideEffect onChange の購読者を呼ぶ
   */
  reload(): void {
    const log = logger.fn('reload', { name: this.currentRoute.name });
    this.sync();
    log.exit(undefined);
  }

  /**
   * 今のルートを返す。
   * @returns 解決済みのルート
   */
  current(): RouteMatch {
    return this.currentRoute;
  }

  /**
   * ルート変化を購読する。
   * @param listener 変化のたびに呼ばれる関数
   * @returns 購読解除する関数
   */
  onChange(listener: RouteListener): () => void {
    const log = logger.fn('onChange', { listeners: this.listeners.size });
    this.listeners.add(listener);
    return log.exit((): void => void this.listeners.delete(listener));
  }

  /**
   * 監視を止め、購読者を外す。
   * @sideEffect hashchange リスナを外す
   */
  destroy(): void {
    const log = logger.fn('destroy');
    this.win.removeEventListener('hashchange', this.onHashChange);
    this.listeners.clear();
    this.started = false;
    log.exit(undefined);
  }

  /**
   * hashchange（戻る・進む・navigate）を受けて解決し直す。
   */
  private readonly onHashChange = (): void => {
    this.sync();
  };

  /**
   * 今の hash を解決して currentRoute を更新し、購読者へ通知する。不正なら #/map に置き換える。
   * @sideEffect 履歴を置き換えることがある。onChange の購読者を呼ぶ
   */
  private sync(): void {
    const log = logger.fn('sync', { length: this.win.location.hash.length });
    const resolution = resolveRoute(this.win.location.hash, this.isDemo);
    if (resolution.redirected) {
      if (resolution.reason !== 'empty') log.warn('不正なルートのため地図へ戻します（SEC-16）', { reason: resolution.reason });
      this.win.history.replaceState(null, '', resolution.match.path);
    }
    this.currentRoute = resolution.match;
    log.info('画面遷移', { name: resolution.match.name, path: resolution.match.path });
    for (const listener of [...this.listeners]) listener(resolution.match);
    log.exit(undefined);
  }
}
