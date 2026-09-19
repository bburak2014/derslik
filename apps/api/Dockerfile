FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV CI=true
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json

FROM build AS test
USER node
CMD ["node", "apps/api/tests/run.mjs"]

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001
# Workspace symlinks resolve against this same layout. Do not prune the entire
# monorepo with pnpm prune: it does not support recursive workspace deployment.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/.api-build ./.api-build
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
USER node
EXPOSE 3001
CMD ["node", ".api-build/apps/api/src/main.js"]
