FROM node:22-alpine as base
RUN corepack enable
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
WORKDIR /app
COPY --chown=appuser:appuser package.json yarn.lock .yarnrc.yml ./

#FROM base as dependencies

FROM base as build
ENV PRERENDER=true
RUN yarn install --immutable
COPY --chown=appuser:appuser . .
RUN yarn build

FROM base as production
COPY --from=build --chown=appuser:appuser /app/dist ./dist
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN \
    SENTRY_AUTH_TOKEN=/run/secrets/SENTRY_AUTH_TOKEN \
    if [ -n "$SENTRY_AUTH_TOKEN" ]; then \
        yarn sentry:sourcemaps; \
    fi
CMD ["node", "dist/evorto/server/server.mjs"]
