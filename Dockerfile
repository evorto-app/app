FROM oven/bun:1.3.7-alpine AS base

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

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
WORKDIR /app

FROM base AS build
ENV NG_BUILD_PARTIAL_SSR=1
COPY --chown=appuser:appuser package.json bun.lock .npmrc ./
COPY --chown=appuser:appuser patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch
RUN bun install --frozen-lockfile
COPY --chown=appuser:appuser . .
RUN bun run build
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN,mode=0444,required=false \
    if [ -f /run/secrets/SENTRY_AUTH_TOKEN ]; then \
        export SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN)"; \
        if [ -n "$SENTRY_AUTH_TOKEN" ]; then \
            bun run sentry:sourcemaps; \
        fi; \
    fi

FROM base AS production-dependencies
COPY --chown=appuser:appuser package.json bun.lock .npmrc ./
COPY --chown=appuser:appuser patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch
RUN bun install --frozen-lockfile --production

FROM base AS production

COPY --from=production-dependencies --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appuser /app/dist ./dist
COPY --chown=appuser:appuser instrument.mjs ./

CMD ["bun","--bun","--import","./instrument.mjs", "dist/evorto/server/server.mjs"]
