FROM node:22-alpine AS base
RUN corepack enable
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
WORKDIR /app

FROM base AS build
ENV PRERENDER=true
COPY --chown=appuser:appuser package.json yarn.lock .yarnrc.yml ./
RUN --mount=type=secret,id=FONT_AWESOME_TOKEN \
    export FONT_AWESOME_TOKEN=$(cat /run/secrets/FONT_AWESOME_TOKEN) && \
    yarn config set npmScopes.fortawesome.npmAuthToken \${FONT_AWESOME_TOKEN}
RUN --mount=type=secret,id=FONT_AWESOME_TOKEN \
    export FONT_AWESOME_TOKEN=$(cat /run/secrets/FONT_AWESOME_TOKEN) && \
    yarn install --immutable
COPY --chown=appuser:appuser . .
RUN --mount=type=secret,id=FONT_AWESOME_TOKEN \
    export FONT_AWESOME_TOKEN=$(cat /run/secrets/FONT_AWESOME_TOKEN) && \
    yarn build
USER root
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN --mount=type=secret,id=FONT_AWESOME_TOKEN \
    export SENTRY_AUTH_TOKEN=$(cat /run/secrets/SENTRY_AUTH_TOKEN) && \
    export FONT_AWESOME_TOKEN=$(cat /run/secrets/FONT_AWESOME_TOKEN) && \
    if [ -n "$SENTRY_AUTH_TOKEN" ]; then \
        yarn sentry:sourcemaps; \
    fi
USER appuser

FROM base AS production-dependencies
RUN yarn add @sentry/node @sentry/profiling-node

FROM base AS production
COPY --from=production-dependencies --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appuser /app/dist ./dist
COPY --chown=appuser:appuser instrument.mjs ./

CMD ["node","--import","./instrument.mjs", "dist/evorto/server/server.mjs"]
