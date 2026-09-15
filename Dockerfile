FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS node-runtime

FROM --platform=$BUILDPLATFORM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build-node-runtime

FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base

USER bun
WORKDIR /app

FROM gcr.io/distroless/base-nossl-debian13:nonroot@sha256:8c563c1fb5e120606f0d85733049775faed6192e2bd2223ef283a5393eec22b9 AS distroless-runtime

FROM base AS dependencies
ARG TARGETPLATFORM
USER root
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
USER bun
ENV NG_BUILD_PARTIAL_SSR=1
ENV NG_BUILD_MAX_WORKERS=2

COPY package.json bun.lock bunfig.toml ./
COPY patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch
COPY patches/heddendorp-effect-angular-query-0.1.4-angular22.patch patches/heddendorp-effect-angular-query-0.1.4-angular22.patch
COPY patches/heddendorp-effect-platform-angular-0.0.9-angular22.patch patches/heddendorp-effect-platform-angular-0.0.9-angular22.patch
COPY ops/scaleway/prime-bun-fontawesome-cache.mjs ops/scaleway/prime-bun-fontawesome-cache.mjs
RUN --mount=type=cache,id=bun-install-cache-${TARGETPLATFORM},target=/home/bun/.bun/install/cache,uid=1000,gid=1000,sharing=locked \
    --mount=type=secret,id=FONT_AWESOME_TOKEN,mode=0444,required=true \
    export FONT_AWESOME_TOKEN="$(cat /run/secrets/FONT_AWESOME_TOKEN)" \
    && node ops/scaleway/prime-bun-fontawesome-cache.mjs bun.lock /home/bun/.bun/install/cache \
    && bun install --frozen-lockfile --cache-dir /home/bun/.bun/install/cache

FROM --platform=$BUILDPLATFORM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS build-dependencies
ARG BUILDPLATFORM
USER root
COPY --from=build-node-runtime /usr/local/bin/node /usr/local/bin/node
USER bun
WORKDIR /app
ENV NG_BUILD_PARTIAL_SSR=1
ENV NG_BUILD_MAX_WORKERS=2

COPY package.json bun.lock bunfig.toml ./
COPY patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch
COPY patches/heddendorp-effect-angular-query-0.1.4-angular22.patch patches/heddendorp-effect-angular-query-0.1.4-angular22.patch
COPY patches/heddendorp-effect-platform-angular-0.0.9-angular22.patch patches/heddendorp-effect-platform-angular-0.0.9-angular22.patch
COPY ops/scaleway/prime-bun-fontawesome-cache.mjs ops/scaleway/prime-bun-fontawesome-cache.mjs
RUN --mount=type=cache,id=bun-build-install-cache-${BUILDPLATFORM},target=/home/bun/.bun/install/cache,uid=1000,gid=1000,sharing=locked \
    --mount=type=secret,id=FONT_AWESOME_TOKEN,mode=0444,required=true \
    export FONT_AWESOME_TOKEN="$(cat /run/secrets/FONT_AWESOME_TOKEN)" \
    && node ops/scaleway/prime-bun-fontawesome-cache.mjs bun.lock /home/bun/.bun/install/cache \
    && bun install --frozen-lockfile --cache-dir /home/bun/.bun/install/cache

FROM build-dependencies AS compile
COPY . .
RUN bun run build:app

FROM dependencies AS build
COPY . .
COPY --from=compile /app/dist ./dist

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
RUN --mount=type=cache,id=bun-install-cache-${TARGETPLATFORM},target=/home/bun/.bun/install/cache,uid=1000,gid=1000,sharing=locked \
    bun install --frozen-lockfile --production --offline --cache-dir /home/bun/.bun/install/cache

FROM production-dependencies AS runtime-dependencies
RUN rm -rf node_modules/@neondatabase \
    && find node_modules -type f -name '*.map' -delete \
    && test -z "$(find node_modules -type f -name '*.map' -print -quit)"

FROM distroless-runtime AS production

WORKDIR /app
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

COPY --from=base /usr/local/bin/bun /usr/local/bin/bun
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=runtime-artifacts /app/dist ./dist
COPY --from=runtime-artifacts /app/ops/drizzle.config.mjs ./ops/drizzle.config.mjs
COPY --from=runtime-artifacts /app/node_modules/drizzle-kit/bin.cjs ./ops/drizzle-kit.cjs

USER 65532:65532
ENTRYPOINT ["/usr/local/bin/bun"]
CMD ["dist/evorto/server/server.mjs"]
