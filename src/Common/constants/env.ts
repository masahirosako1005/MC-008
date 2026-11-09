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

/** アプリのバージョン（エクスポートデータ・ログに付ける） */
export const APP_VERSION = '0.1.0';

/** debug ログ有効化フラグの保存キー（docs/04 §2.4-7。値 '1' で有効） */
export const DEBUG_FLAG_STORAGE_KEY = 'nnishi.debug';

/** デモ日付進行のオフセット日数の保存キー（docs/08 §5、D13） */
export const DEMO_CLOCK_OFFSET_STORAGE_KEY = 'nnishi.demo.clockOffsetDays';
