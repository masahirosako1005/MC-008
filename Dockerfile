# 連携サーバー（本番の版）のコンテナ。docs/11_backend_operations.md §7
# 使い方：
#   docker build -t kayoimachi-backend --build-arg APP_ORIGIN=https://app.example.jp [--build-arg APP_BACKEND=server] .
#   docker run --read-only --cap-drop ALL --restart unless-stopped -p 127.0.0.1:8787:8787 -p 127.0.0.1:8788:8788 -v kayoimachi-db:/data -e TRUST_PROXY=1 -e ALLOWED_HOSTS=app.example.jp,admin.example.jp kayoimachi-backend
# ポートは 127.0.0.1 にだけ出す（127.0.0.1 を付けないと全インターフェイスに平文で出て、X-Forwarded-For を偽って回数制限をすり抜けられる）。
# APP_BACKEND=server は、利用者データのサーバー（DATABASE_URL）を使うときに付ける（付けないとアプリの記録は端末が正のまま）。
# TLS は中継（nginx・Caddy・ロードバランサ）で終端する前提（TRUST_PROXY=1）。自前の TLS なら TLS_CERT/TLS_KEY のファイルをマウントする。

FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG APP_ORIGIN=
ARG APP_BACKEND=local
RUN node scripts/build/backend.mjs --skip-typecheck --app-backend "$APP_BACKEND" ${APP_ORIGIN:+--app-origin "$APP_ORIGIN"}

FROM node:24-alpine
WORKDIR /app
RUN addgroup -S kayoimachi && adduser -S kayoimachi -G kayoimachi && mkdir -p /data && chown kayoimachi:kayoimachi /data
COPY --from=build /src/dist-server ./dist-server
COPY --from=build /src/dist ./dist
COPY --from=build /src/dist-cms ./dist-cms
COPY --from=build /src/public/master ./public/master
USER kayoimachi
ENV HOST=0.0.0.0 PORT=8787 CMS_PORT=8788 STATIC_DIR=dist CMS_STATIC_DIR=dist-cms MASTER_DIR=public/master DB_PATH=/data/cms.sqlite
EXPOSE 8787 8788
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist-server/serverMain.mjs"]
