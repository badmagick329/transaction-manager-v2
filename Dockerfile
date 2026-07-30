FROM oven/bun:1.2 AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.2

WORKDIR /app
ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY bunfig.toml package.json ./
COPY drizzle ./drizzle
COPY src ./src
COPY styles ./styles

RUN mkdir -p /app/data

EXPOSE 3000
CMD ["bun", "start"]
