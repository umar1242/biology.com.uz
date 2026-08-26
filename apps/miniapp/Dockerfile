FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
RUN npm ci

COPY apps/miniapp apps/miniapp
ENV VITE_API_BASE_URL=/api/v1
RUN npm run build --workspace=apps/miniapp

FROM caddy:2-alpine
COPY --from=build /app/apps/miniapp/dist /srv
COPY apps/miniapp/Caddyfile /etc/caddy/Caddyfile
