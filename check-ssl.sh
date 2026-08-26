#!/usr/bin/env bash
# Проверка, выпустил ли Cloudflare сертификат для домена проекта.
# Запуск: ./check-ssl.sh
for h in app.biolog.com.uz admin.biolog.com.uz; do
  code=$(timeout 15 curl -s -o /dev/null -w '%{http_code}' "https://$h/" 2>/dev/null)
  if [ "$code" = "200" ]; then
    exp=$(timeout 15 openssl s_client -connect "$h:443" -servername "$h" </dev/null 2>/dev/null \
          | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    printf '%-24s ✅ HTTPS работает   (сертификат до %s)\n' "$h" "$exp"
  else
    printf '%-24s ⏳ сертификата ещё нет (HTTP-код %s)\n' "$h" "${code:-нет ответа}"
  fi
done
