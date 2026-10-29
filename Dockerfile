# One image: builds the React app and the Node server; the server serves both (same origin → simple cookies + WSS).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace=server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/drizzle server/drizzle
COPY --from=build /app/web/dist web/dist
ENV WEB_DIR=/app/web/dist
# Writable directory for the development-only local storage driver (production should use STORAGE_DRIVER=s3).
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 8787
# Migrations run automatically on boot (RUN_MIGRATIONS=false to disable).
CMD ["node", "server/dist/index.js"]
