# Деплой на своём железе

Архитектура: всё крутится в Docker Compose на вашей машине, ничего в облаке
арендовать не нужно. Бот получает обновления через long polling — публичный
адрес ему не нужен. Единственное, чему нужен публичный HTTPS-адрес — Mini App
(таково требование самого Telegram: клиент грузит Mini App по `https://`
напрямую, локальный сервер не подходит). Это закрывается постоянным Cloudflare
Tunnel — без покупки VPS, но с одним ручным шагом, который нельзя сделать
автоматически (вход в аккаунт Cloudflare через браузер).

Дашборд учителя тоже пробрасывается через тот же туннель — отдельным Public
Hostname на тот же tunnel token, поэтому второй `cloudflared`-контейнер не
нужен. Порт `8080` на самой машине (LAN/localhost) при этом остаётся —
удобно для доступа без интернета. Раз дашборд становится публичным, его
защищает только логин/пароль сотрудника (как и раньше) — этого достаточно
для типового случая, но если хочется второй слой, в Cloudflare Zero Trust
можно включить **Access** на этом Public Hostname (email-код или Google-вход
перед тем, как запрос вообще попадёт на дашборд) — необязательно, добавляется
в любой момент позже без изменений в коде.

## 1. Разовая настройка Cloudflare Tunnel

Это единственный шаг, который нужно сделать руками — требует входа в браузере.

Домен проекта: **biolog.com.uz** (регистратор ahost.uz).

1. Зарегистрируйте (если ещё нет) бесплатный аккаунт на https://dash.cloudflare.com
2. **Add a site** → `biolog.com.uz` → план **Free**. Cloudflare выдаст два
   своих nameserver'а вида `xxx.ns.cloudflare.com`.
3. В панели ahost.uz замените текущие NS домена на выданные Cloudflare.
   Сейчас домен делегирован на четыре сервера ahost'а:
   ```
   dns1.ahost.uz   dns2.ahost.uz   ns1.ahost.cloud   ns2.ahost.cloud
   ```
   Их нужно убрать и оставить только две записи Cloudflare. Делегирование в
   зоне `.com.uz` обновляется от 15 минут до нескольких часов; пока Cloudflare
   не покажет статус **Active**, туннель работать не будет.
4. В боковом меню откройте **Zero Trust → Networks → Tunnels → Create a
   tunnel** → тип **Cloudflared** → дайте имя, например `course-platform`.
5. На шаге установки коннектора выберите **Docker** — Cloudflare покажет
   команду вида `cloudflared tunnel run --token eyJhbG...`. Скопируйте именно
   токен (всё после `--token`).
6. На шаге **Public Hostname** укажите `app.biolog.com.uz` → Service:
   `HTTP` → `miniapp:80`.
7. Добавьте второй Public Hostname тому же туннелю (Zero Trust → Networks →
   Tunnels → ваш туннель → **Public Hostname → Add a public hostname**):
   `admin.biolog.com.uz` → Service: `HTTP` → `dashboard:80`.
8. Вставьте токен в `.env` в корне проекта:
   ```
   CLOUDFLARE_TUNNEL_TOKEN=eyJhbG...
   ```

HTTPS-сертификаты на оба поддомена Cloudflare выпускает сам — ни Let's
Encrypt, ни открытые порты на роутере не нужны (машина за NAT, входящих
соединений не принимает: туннель сам открывает исходящее соединение наружу).
Universal SSL выпускается не мгновенно: после активации зоны это заняло ~25
минут, по документации Cloudflare — до 24 часов. Пока сертификата нет,
HTTPS отдаёт обрыв соединения, хотя HTTP уже работает. Проверить состояние:
`./check-ssl.sh` в корне проекта либо **SSL/TLS → Edge Certificates** в
панели (статус должен стать **Active**).

Оба Caddyfile редиректят HTTP → HTTPS по заголовку `X-Forwarded-Proto` от
границы Cloudflare — иначе набранный руками `http://admin...` открывал бы
панель по незашифрованному соединению, и пароль сотрудника ушёл бы открытым
текстом.

## 2. Переменные окружения

```bash
cp .env.example .env                                    # TELEGRAM_API_ID/HASH + токен туннеля
cp apps/api/.env.production.example apps/api/.env.production
```

Заполните `apps/api/.env.production`: `JWT_SECRET` (любая длинная случайная
строка), `OWNER_TELEGRAM_ID`, `TELEGRAM_BOT_TOKEN`. Остальное уже настроено
на адреса внутри docker-сети.

## 3. Сборка и запуск

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Применить миграции (один раз при первом запуске и после каждой новой
миграции):

```bash
docker compose -f docker-compose.prod.yml exec api npx tsx src/db/migrate.ts
```

## 4. Проверка

- Дашборд: `http://localhost:8080` (LAN) или `https://admin.biolog.com.uz`
  (публично, через туннель) — оба ведут в один и тот же контейнер
- API напрямую наружу не торчит — проверяется через дашборд/miniapp
- Mini App: откройте `https://app.biolog.com.uz` в браузере — должна
  открыться (авторизация через Telegram initData сработает только изнутри
  самого Telegram, это ожидаемо)
- Кнопка Mini App в боте ставится через Bot API, без BotFather:
  ```bash
  curl -s -X POST "https://api.telegram.org/bot<ТОКЕН>/setChatMenuButton" \
    -H 'Content-Type: application/json' \
    -d '{"menu_button":{"type":"web_app","text":"Открыть",
         "web_app":{"url":"https://app.biolog.com.uz/"}}}'
  ```
  В отличие от временного Quick Tunnel, этот адрес постоянный — повторять
  после каждого перезапуска больше не нужно.
- Откройте бота в Telegram, нажмите на кнопку Mini App — должна открыться и
  работать.

## 5. Автозапуск после перезагрузки

Стек поднимается сам при загрузке машины — настраивать ничего не нужно,
всё уже включено.

Работают два независимых механизма:

1. **`restart: unless-stopped`** у всех контейнеров — Docker сам поднимает их,
   когда стартует его демон. Покрывает обычную перезагрузку.
2. **systemd-юнит `course-platform.service`** — запускает
   `scripts/start-stack.sh`, который делает `compose up -d` и накатывает
   миграции. Покрывает то, чего не умеет пункт 1: стек был снят через
   `compose down`, изменился `docker-compose.prod.yml`, или вместе с
   обновлением кода приехала новая миграция.

Полезные команды:

```bash
systemctl status course-platform         # что со стеком
sudo systemctl restart course-platform   # поднять/перезапустить
sudo systemctl stop course-platform      # остановить (тома целы)
sudo journalctl -u course-platform -n 50 # лог последнего запуска
```

**Важно:** для ручного подъёма нужен именно `restart`, а не `start`. Юнит
объявлен как `Type=oneshot` с `RemainAfterExit=yes` — после первого запуска
systemd считает его активным, и `start` тихо ничего не делает, даже если
контейнеров уже нет. На саму загрузку это не влияет, там юнит стартует с нуля.

Миграции при загрузке применяются, но их провал **не роняет сайт**: стек уже
поднят и обслуживает запросы, а в журнале останется `WARNING: migrations
failed`. Проверить стоит через `journalctl`.

Отдельная оговорка про ноутбук: закрытие крышки по умолчанию усыпляет машину,
и сайт уходит в офлайн до пробуждения. Простой в неактивности отключён
(`sleep-inactive-ac-type = nothing`), а вот крышка — нет. Если машина работает
как сервер, поведение крышки нужно поменять в `/etc/systemd/logind.conf`
(`HandleLidSwitch=ignore`).

## Если домен появится и захочется webhook вместо polling

Не обязательно, но если понадобится: поставьте `BOT_UPDATES_MODE=webhook` в
`apps/api/.env.production`, перезапустите `api`, затем:

```bash
docker compose -f docker-compose.prod.yml exec api \
  npm run set-webhook --workspace=apps/api -- https://admin.biolog.com.uz/telegram/webhook
```
