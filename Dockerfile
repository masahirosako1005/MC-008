# 連携サーバー（本番の版）のコンテナ。docs/11_backend_operations.md §7
# 使い方：
#   docker build -t kayoimachi-backend --build-arg APP_ORIGIN=https://app.example.jp .
#   docker run -p 8787:8787 -p 8788:8788 -v kayoimachi-db:/data -e TRUST_PROXY=1 -e ALLOWED_HOSTS=app.example.jp,admin.example.jp kayoimachi-backend
# TLS は中継（nginx・Caddy・ロードバランサ）で終端する前提（TRUST_PROXY=1）。自前の TLS なら TLS_CERT/TLS_KEY のファイルをマウントする。

FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG APP_ORIGIN=
RUN node scripts/build/backend.mjs --skip-typecheck ${APP_ORIGIN:+--app-origin $APP_ORIGIN}

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
CMD ["node", "dist-server/serverMain.mjs"]
