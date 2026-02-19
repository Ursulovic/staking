# Stage 1: Build
FROM node:23-alpine AS build

WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG PUBLIC_RPC_URL
ARG PUBLIC_CHAIN_ID
ARG PUBLIC_POTENTIALS_ADDRESS
ARG PUBLIC_STAKING_ADDRESS
ARG PUBLIC_GRAPHQL_ENDPOINT

ENV PUBLIC_RPC_URL=$PUBLIC_RPC_URL
ENV PUBLIC_CHAIN_ID=$PUBLIC_CHAIN_ID
ENV PUBLIC_POTENTIALS_ADDRESS=$PUBLIC_POTENTIALS_ADDRESS
ENV PUBLIC_STAKING_ADDRESS=$PUBLIC_STAKING_ADDRESS
ENV PUBLIC_GRAPHQL_ENDPOINT=$PUBLIC_GRAPHQL_ENDPOINT

RUN pnpm build && pnpm prune --prod

# Stage 2: Serve
FROM node:23-alpine AS runner

WORKDIR /app

# Copy only built artifacts and prod dependencies
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules

ENV HOST=0.0.0.0
ENV PORT=4321

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4321/ || exit 1

CMD ["node", "./dist/server/entry.mjs"]
