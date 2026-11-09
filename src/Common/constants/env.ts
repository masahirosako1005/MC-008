/**
 * @file ビルドモードと保存キー接頭辞の定数（Common 層）
 * `vite --mode demo` / `vite build --mode demo` でデモビルド（isDemoBuild=true）。vitest では MODE='test'。
 * import.meta.env はビルド時に定数へ置換されるので、デモ専用コードは本番ビルドから木構造ごと除外できる（SEC-02, DI-23）。
 */

/** Vite のビルドモード名（'production' / 'demo' / 'development' / 'test'） */
export const BUILD_MODE: string = import.meta.env.MODE;

/** デモビルドなら true。デモメニュー・DemoClock・デモ用ストレージ名前空間の切替に使う（CLAUDE.md 14 MUST-8） */
export const isDemoBuild: boolean = import.meta.env.MODE === 'demo';

/** Vitest 実行中なら true（ロガーの既定出力先を無音にするために使う） */
export const isTestMode: boolean = import.meta.env.MODE === 'test';

/** 本番ビルド（デモではない production ビルド）なら true。debug ログを常に無効にする（LG-04） */
export const isProductionBuild: boolean = import.meta.env.PROD && !isDemoBuild;

/** localStorage キーの接頭辞（SEC-07）。デモと本番で名前空間を分ける（DI-23） */
export const STORAGE_PREFIX: 'nnishi.demo.' | 'nnishi.' = isDemoBuild ? 'nnishi.demo.' : 'nnishi.';

/** 店舗CMS の登録内容の受け渡し方 */
export type CmsBackend = 'local' | 'server';

/**
 * 店舗CMS の登録内容の受け渡し方（docs/09 §7.3）。
 * 'local'（既定）：同じブラウザの localStorage（フェーズ1）／'server'：連携サーバー（/api。別の端末どうしでもつながる）。
 * ビルド時の環境変数 VITE_CMS_BACKEND=server で切り替える（scripts/dev/backend.mjs が付ける）。
 */
export const CMS_BACKEND: CmsBackend = import.meta.env['VITE_CMS_BACKEND'] === 'server' ? 'server' : 'local';

/** オリジンの書式（https://名前[:ポート]。末尾の / は無し） */
const ORIGIN_PATTERN = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;

/**
 * 店舗CMS から開く利用者アプリのオリジン（docs/09 §7.1。CMS を別オリジンに置くとき）。
 * ビルド時の環境変数 VITE_APP_ORIGIN（例 'https://app.example.jp'）。無い・書式が違うときは ''（同じオリジン＝デモ）。
 */
export const APP_ORIGIN: string = ORIGIN_PATTERN.test(String(import.meta.env['VITE_APP_ORIGIN'] ?? '')) ? String(import.meta.env['VITE_APP_ORIGIN']) : '';

/** アプリのバージョン（エクスポートデータ・ログに付ける） */
export const APP_VERSION = '0.1.0';

/** debug ログ有効化フラグの保存キー（docs/04 §2.4-7。値 '1' で有効） */
export const DEBUG_FLAG_STORAGE_KEY = 'nnishi.debug';

/** デモ日付進行のオフセット日数の保存キー（docs/08 §5、D13） */
export const DEMO_CLOCK_OFFSET_STORAGE_KEY = 'nnishi.demo.clockOffsetDays';
