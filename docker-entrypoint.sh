#!/bin/sh
set -e

# Replace placeholder env vars in built JS files with actual values
for file in $(find /usr/share/nginx/html -name '*.js' -o -name '*.html'); do
  sed -i "s|__PUBLIC_RPC_URL__|${PUBLIC_RPC_URL}|g" "$file"
  sed -i "s|__PUBLIC_CHAIN_ID__|${PUBLIC_CHAIN_ID}|g" "$file"
  sed -i "s|__PUBLIC_POTENTIALS_ADDRESS__|${PUBLIC_POTENTIALS_ADDRESS}|g" "$file"
  sed -i "s|__PUBLIC_STAKING_ADDRESS__|${PUBLIC_STAKING_ADDRESS}|g" "$file"
  sed -i "s|__PUBLIC_GRAPHQL_ENDPOINT__|${PUBLIC_GRAPHQL_ENDPOINT}|g" "$file"
done

exec nginx -g 'daemon off;'
