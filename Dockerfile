# Stage 1: Build
FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Build with placeholder env vars (replaced at runtime by entrypoint)
ENV PUBLIC_RPC_URL=__PUBLIC_RPC_URL__
ENV PUBLIC_CHAIN_ID=__PUBLIC_CHAIN_ID__
ENV PUBLIC_POTENTIALS_ADDRESS=__PUBLIC_POTENTIALS_ADDRESS__
ENV PUBLIC_STAKING_ADDRESS=__PUBLIC_STAKING_ADDRESS__
ENV PUBLIC_GRAPHQL_ENDPOINT=__PUBLIC_GRAPHQL_ENDPOINT__

RUN pnpm build

# Stage 2: Serve
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
