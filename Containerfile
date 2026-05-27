FROM docker.io/oven/bun:1.2 AS deps
WORKDIR /app
COPY package.json ./
RUN bun install

FROM deps AS build
WORKDIR /app
COPY . .
RUN bun run build

FROM docker.io/oven/bun:1.2-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV SQLITE_PATH=/data/judged-by-ai.sqlite

COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db
COPY --from=build /app/server ./server

RUN mkdir -p /data

VOLUME ["/data"]
EXPOSE 3000

CMD ["sh", "-c", "bun run migrate && bun run start"]
