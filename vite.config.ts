/**
 * @file Vite / Vitest 設定（ビルド境界）
 * - `--mode demo` でデモビルド（isDemoBuild=true）。既定はプロダクション。
 * - `--mode cms` で店舗CMS だけの本番ビルド（cms.html だけ。連携サーバーにつなぐ＝VITE_CMS_BACKEND=server を強制。docs/09 §7.1 の別オリジン用）。
 * - preview サーバにセキュリティヘッダを付与（docs/05 SEC-04, SEC-29）。sourcemap は出さない（SEC-06）。
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/** プレビュー（本番相当）で付けるセキュリティヘッダ（SEC-04, SEC-29）。dev は HMR のため CSP を外す */
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
};

/**
 * ビルドに含める HTML を返す。
 * - production：利用者アプリ（index.html）だけ。店舗CMS は含めない（docs/09 §7.1、MUST-8、SEC-02）
 * - demo：利用者アプリと店舗CMS（cms.html）を同じオリジンに
 * - cms：店舗CMS だけ（本番で別オリジンに置く）
 * @param mode Vite のモード（'demo' / 'production' / 'cms' など）
 * @returns 入力名 → HTML の絶対パス
 */
function buildInputs(mode: string): Record<string, string> {
  const cms = fileURLToPath(new URL('./cms.html', import.meta.url));
  if (mode === 'cms') return { cms };
  const inputs: Record<string, string> = { main: fileURLToPath(new URL('./index.html', import.meta.url)) };
  if (mode === 'demo') inputs['cms'] = cms;
  return inputs;
}

/**
 * dev サーバの自動リロード（HMR・ページの読み込み直し）。既定はオフ。
 * 複数のセッションが同時に編集するため、オンだと保存のたびにページが読み込み直され、地図の表示やデモ位置が初期状態に戻る。
 * ファイルの監視は残すので、手動で再読み込み（F5）すれば最新のコードになる。`VITE_LIVE_RELOAD=1` で起動するとオンに戻る。
 */
const LIVE_RELOAD = process.env['VITE_LIVE_RELOAD'] === '1';

/**
 * 連携サーバー（店舗CMS とアプリをつなぐ。docs/09 §7.3）への中継先。`CMS_API_PROXY=http://127.0.0.1:8787` のときだけ
 * dev サーバの /api をそこへ中継する（scripts/dev/backend.mjs が付ける）。Host を書き換えない（サーバーが Origin と照らし合わせるため）。
 */
const CMS_API_PROXY = process.env['CMS_API_PROXY'];

export default defineConfig(({ mode }) => {
  // 店舗CMS だけのビルドは、連携サーバーにつなぐ版しかあり得ない（ブラウザだけの CMS はデモだけ）
  if (mode === 'cms') process.env['VITE_CMS_BACKEND'] = 'server';
  return {
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { sourcemap: false, target: 'es2022', rollupOptions: { input: buildInputs(mode) } },
  server: {
    port: 5173,
    strictPort: true,
    headers: { 'X-Content-Type-Options': 'nosniff' },
    ...(LIVE_RELOAD ? {} : { hmr: false, ws: false as const }),
    ...(CMS_API_PROXY ? { proxy: { '/api': { target: CMS_API_PROXY, changeOrigin: false } } } : {}),
  },
  preview: { port: 4173, strictPort: true, headers: SECURITY_HEADERS },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
  };
});
