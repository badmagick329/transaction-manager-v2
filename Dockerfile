FROM oven/bun:1.2 AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM dependencies AS build

COPY build.ts bunfig.toml package.json tsconfig.json ./
COPY src ./src
COPY styles ./styles
RUN bun run build

FROM oven/bun:1.2

WORKDIR /app
ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY bunfig.toml package.json ./
COPY drizzle ./drizzle
COPY src ./src

RUN mkdir -p /app/data

EXPOSE 3000
CMD ["bun", "start"]
