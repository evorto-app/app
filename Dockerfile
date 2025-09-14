FROM node:22-alpine AS base
RUN corepack enable

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
COPY --chown=appuser:appuser package.json yarn.lock .yarnrc.yml ./
RUN --mount=type=secret,id=FONT_AWESOME_TOKEN,mode=0444 yarn config set npmScopes.fortawesome.npmAuthToken $(cat /run/secrets/FONT_AWESOME_TOKEN)
RUN yarn install --immutable
COPY --chown=appuser:appuser . .
RUN yarn build
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN,mode=0444,required=false \
    if [ -f /run/secrets/SENTRY_AUTH_TOKEN ]; then \
        export SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN)"; \
        if [ -n "$SENTRY_AUTH_TOKEN" ]; then \
            yarn sentry:sourcemaps; \
        fi; \
    fi

FROM base AS production-dependencies
RUN yarn add @sentry/node @sentry/profiling-node

FROM base AS production

COPY --from=production-dependencies --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appuser /app/dist ./dist
COPY --chown=appuser:appuser instrument.mjs ./

CMD ["node","--import","./instrument.mjs", "dist/evorto/server/server.mjs"]
