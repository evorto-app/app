FROM node:26.5.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS node-runtime

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base

USER root
RUN apt-get update \
    && apt-get upgrade --yes --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Canvas dependencies removed - not currently used in production
# RUN apk add --no-cache \
#     build-base \
#     cairo-dev \
#     jpeg-dev \
#     pango-dev \
#     musl-dev \
#     giflib-dev \
#     pixman-dev \
#     pangomm-dev \
#     libjpeg-turbo-dev \
#     freetype-dev

# RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER bun
WORKDIR /app

FROM base AS dependencies
USER root
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
USER bun
ENV NG_BUILD_PARTIAL_SSR=1
ENV NG_BUILD_MAX_WORKERS=2

COPY package.json bun.lock bunfig.toml ./
COPY patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch
COPY ops/scaleway/prime-bun-fontawesome-cache.mjs ops/scaleway/prime-bun-fontawesome-cache.mjs
RUN --mount=type=cache,id=bun-install-cache,target=/home/bun/.bun/install/cache,uid=1000,gid=1000,sharing=locked \
    --mount=type=secret,id=FONT_AWESOME_TOKEN,mode=0444,required=true \
    export FONT_AWESOME_TOKEN="$(cat /run/secrets/FONT_AWESOME_TOKEN)" \
    && node ops/scaleway/prime-bun-fontawesome-cache.mjs bun.lock /home/bun/.bun/install/cache \
    && bun install --frozen-lockfile --cache-dir /home/bun/.bun/install/cache

FROM dependencies AS build
COPY . .
RUN bun run build:app

FROM build AS source-map-archive
RUN find dist -type f -name '*.map' -print0 \
    | tar --null --files-from=- --create --gzip --file=/tmp/source-maps.tar.gz

FROM scratch AS source-maps
COPY --from=source-map-archive /tmp/source-maps.tar.gz /source-maps.tar.gz

FROM build AS runtime-artifacts
RUN find dist -type f -name '*.map' -delete \
    && test -z "$(find dist -type f -name '*.map' -print -quit)"

FROM dependencies AS production-dependencies
RUN rm -rf node_modules
RUN --mount=type=cache,id=bun-install-cache,target=/home/bun/.bun/install/cache,uid=1000,gid=1000,sharing=locked \
    bun install --frozen-lockfile --production --offline --cache-dir /home/bun/.bun/install/cache

FROM production-dependencies AS runtime-dependencies
COPY --from=runtime-artifacts /app/node_modules/ajv ./node_modules/ajv
COPY --from=runtime-artifacts /app/node_modules/ajv-formats ./node_modules/ajv-formats
RUN rm -rf node_modules/@neondatabase \
    && find node_modules -type f -name '*.map' -delete \
    && test -z "$(find node_modules -type f -name '*.map' -print -quit)"

FROM base AS production

COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=runtime-artifacts /app/dist ./dist
COPY --from=runtime-artifacts /app/ops/drizzle.config.mjs ./ops/drizzle.config.mjs
COPY --from=runtime-artifacts /app/node_modules/drizzle-kit/bin.cjs ./ops/drizzle-kit.cjs

CMD ["bun", "dist/evorto/server/server.mjs"]
