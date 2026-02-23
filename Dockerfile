FROM oven/bun:1.3.7 AS base

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

FROM base AS build
ENV NG_BUILD_PARTIAL_SSR=1
ENV NG_BUILD_MAX_WORKERS=2
ARG FONT_AWESOME_TOKEN

COPY  package.json bun.lock bunfig.toml ./
COPY patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch
RUN --mount=type=secret,id=FONT_AWESOME_TOKEN,mode=0444,required=false \
    token="" && \
    if [ -f /run/secrets/FONT_AWESOME_TOKEN ]; then token="$(cat /run/secrets/FONT_AWESOME_TOKEN)"; fi && \
    if [ -z "$token" ]; then token="$FONT_AWESOME_TOKEN"; fi && \
    if [ -z "$token" ]; then echo "Missing FONT_AWESOME_TOKEN for bun install" >&2; exit 1; fi && \
    printf '@fortawesome:registry=https://npm.fontawesome.com/\n//npm.fontawesome.com/:_authToken=%s\nalways-auth=true\n' "$token" > "$HOME/.npmrc" && \
    bun install --frozen-lockfile && \
    rm -f "$HOME/.npmrc"
COPY . .
RUN bun run build:app
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN,mode=0444,required=false \
    if [ -f /run/secrets/SENTRY_AUTH_TOKEN ]; then \
        export SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN)"; \
        if [ -n "$SENTRY_AUTH_TOKEN" ]; then \
            bun run ops:sentry:sourcemaps; \
        fi; \
    fi

FROM base AS production-dependencies
ARG FONT_AWESOME_TOKEN
COPY package.json bun.lock bunfig.toml ./
COPY patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch patches/@material-material-color-utilities-npm-0.4.0-9d48ca70b8.patch
RUN --mount=type=secret,id=FONT_AWESOME_TOKEN,mode=0444,required=false \
    token="" && \
    if [ -f /run/secrets/FONT_AWESOME_TOKEN ]; then token="$(cat /run/secrets/FONT_AWESOME_TOKEN)"; fi && \
    if [ -z "$token" ]; then token="$FONT_AWESOME_TOKEN"; fi && \
    if [ -z "$token" ]; then echo "Missing FONT_AWESOME_TOKEN for bun install --production" >&2; exit 1; fi && \
    printf '@fortawesome:registry=https://npm.fontawesome.com/\n//npm.fontawesome.com/:_authToken=%s\nalways-auth=true\n' "$token" > "$HOME/.npmrc" && \
    bun install --frozen-lockfile --production && \
    rm -f "$HOME/.npmrc"

FROM base AS production

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY instrument.mjs ./

CMD ["bun", "--preload", "./instrument.mjs","dist/evorto/server/server.mjs"]
