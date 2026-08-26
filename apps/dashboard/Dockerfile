FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
RUN npm ci

COPY apps/dashboard apps/dashboard
# Relative path — Caddy proxies /api/v1/* on the same origin the SPA was
# loaded from, so one build works whether it's reached via LAN IP or the
# public tunnel hostname, no per-environment rebuild needed.
ENV VITE_API_BASE_URL=/api/v1
RUN npm run build --workspace=apps/dashboard

FROM caddy:2-alpine
COPY --from=build /app/apps/dashboard/dist /srv
COPY apps/dashboard/Caddyfile /etc/caddy/Caddyfile
