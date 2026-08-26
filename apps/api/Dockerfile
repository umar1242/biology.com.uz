FROM node:20-alpine

WORKDIR /app

# npm workspaces share one lockfile — `npm ci` needs every workspace's
# package.json present up front or it refuses (lockfile/package.json
# mismatch), even though only apps/api's dependencies actually run here.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
RUN npm ci

COPY apps/api apps/api
RUN npm run build --workspace=apps/api

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
