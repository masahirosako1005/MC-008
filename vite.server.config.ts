/**
 * @file 連携サーバー（src/serverMain.ts）を Node 用の1ファイルにまとめる Vite 設定（docs/09 §7.3）
 * 利用者アプリと同じ src（domain・application・検証の関数）を、@/ の別名ごとそのまままとめる。
 * 実行時の依存は pg（利用者データの PostgreSQL。docs/12）だけで、これも1ファイルにまとめる。ほかは node:http・node:sqlite などの組み込み。sourcemap は出さない（SEC-06）。
 * 使い方：vite build -c vite.server.config.ts --mode demo（→ dist-server/serverMain.mjs）
 *   --mode demo でビルドすると店舗CMS の API を出す。モードを付けない（本番）と公開スナップショットを配るだけ。
 */
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  publicDir: false,
  build: {
    ssr: fileURLToPath(new URL('./src/serverMain.ts', import.meta.url)),
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: false,
    // PGlite（自分の PC 用の PostgreSQL。--pglite-dir）は WASM を持つ開発用の依存なので、まとめずに node_modules から読む（docs/12 §4.1）
    rollupOptions: { external: ['@electric-sql/pglite'], output: { entryFileNames: 'serverMain.mjs', format: 'es', inlineDynamicImports: true } },
  },
  ssr: { noExternal: true, target: 'node' },
});
