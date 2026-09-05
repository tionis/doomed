# Single-container build: client bundle + backend.
ARG VITE_BACKEND_URL=""
ARG VITE_OIDC_ISSUER=""
ARG VITE_OIDC_CLIENT_ID=""

FROM oven/bun:1.2 AS client-build
WORKDIR /build
COPY package.json bun.lock tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY scripts ./scripts
COPY client ./client
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL \
    VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID
RUN bun install --frozen-lockfile && bun run build

FROM oven/bun:1.2 AS server-deps
WORKDIR /app/server
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.2
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001
COPY server/package.json ./server/
COPY server/src ./server/src
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=client-build /build/dist ./dist
VOLUME ["/app/data"]
EXPOSE 3001
CMD ["bun", "server/src/index.ts"]
