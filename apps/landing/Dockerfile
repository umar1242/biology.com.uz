# Витрина проекта — чистая статика, без сборки: нет ни зависимостей, ни
# шага npm, поэтому образ собирается за секунды и не тянет node_modules.
FROM caddy:2-alpine
COPY apps/landing/public /srv
COPY apps/landing/Caddyfile /etc/caddy/Caddyfile
