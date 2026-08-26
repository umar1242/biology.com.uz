# API — платформа курсов (биология/химия)

Дизайн поверх `db/schema.sql`. Один бэкенд, три потребителя:

- **Dashboard API** — сайт учителя/помощника (сессия по логину/паролю).
- **Mini App API** — Telegram Mini App ученика (сессия по Telegram initData).
- **Telegram-webhook** — единая точка входа для всех апдейтов от Telegram
  (сообщения, команды, deep-link'и). Через неё же проходит вся
  админ-активность владельца проекта — у владельца нет веб-логина, только
  Telegram (см. правку `staff_users` в схеме).

Бэкенд сам является Telegram-ботом (отправляет сообщения через Bot API/
локальный Bot API сервер) — отдельного "сервиса бота" нет, это одна и та же
кодовая база и БД. REST — `/api/v1/...`, JSON.

---

## 0. Важное допущение

Спецификация не говорит явно, как физически передаются **фото домашнего
задания** от ученика. По архитектуре видео уже решено: контент идёт через
прямой чат с ботом, а не через HTTP-загрузку с сайта/Mini App (раздел 9
идеи-документа). Я распространил этот же паттерн на фото ДЗ — ученик
отправляет фото **прямо в чат с ботом**, а не через file upload в Mini App.
Причина: так в системе остаётся один канал приёма медиа (чат с ботом), а не
два разных (чат для видео + HTTP-аплоад для фото), и все медиа единообразно
хранятся как Telegram `file_id`.

Если на самом деле подразумевался HTTP-аплоад из Mini App — это меняет
раздел 3.2 ниже (появляется `POST /api/v1/app/submissions` с multipart-телом
вместо текущего `submit-instructions` + прямой чат с ботом). Дайте знать,
если это неверное допущение.

Механизм корреляции "это сообщение в чате относится вот к этому уроку/ДЗ" —
таблица `bot_pending_actions` (добавлена в схему): ученик/учитель переходит
по deep-link'у из дашборда/Mini App, следующее медиа-сообщение от него в
течение TTL считается ответом на конкретное действие.

---

## 1. Аутентификация

### 1.1 Dashboard (учитель/помощник)

```
POST /api/v1/auth/login
  body: { username, password }
  → { access_token, role: "teacher"|"assistant", staff_id, teacher_id }

POST /api/v1/auth/logout

GET  /api/v1/auth/me
  → { staff_id, role, display_name,
      // если assistant:
      permissions: [{ course_id, can_review_homework, can_manage_access, can_manage_blacklist }] }
```

### 1.2 Mini App (ученик)

```
POST /api/v1/app/auth/telegram
  body: { init_data }   // сырой initData из Telegram.WebApp, проверяется по HMAC на бэкенде
  → { access_token, student_id }
```

Отдельного логина для владельца проекта нет — вся его активность идёт через
Telegram-команды боту (раздел 4).

Во всех остальных эндпоинтах `teacher_id`/`student_id` берётся из сессии
токена, **не** из URL/body — это и есть граница мульти-тенантной изоляции.
Помощник получает доступ к ресурсам конкретного `course_id` только если для
пары (assistant_id, course_id) есть строка в `assistant_course_permissions`
с нужным флагом — проверяется на каждом запросе, не только на логине.

---

## 2. Dashboard API (учитель / помощник)

### 2.1 Курсы

```
GET    /api/v1/courses                       список курсов текущего тенанта
POST   /api/v1/courses                       { title, description, subject }         [teacher]
GET    /api/v1/courses/:id
PATCH  /api/v1/courses/:id                   { title?, description? }                [teacher]
POST   /api/v1/courses/:id/archive                                                    [teacher]

GET    /api/v1/courses/:id/telegram-group    { linked, telegram_chat_id?, invite_link?, bot_is_member? }
POST   /api/v1/courses/:id/telegram-group/link-start
  → { deep_link }   // "Добавьте бота в группу курса и отправьте в ней /link_<token>"
                     // фактическая привязка происходит через вебхук (см. 4.2), не REST-вызовом
```

### 2.2 Модули и уроки

```
GET    /api/v1/courses/:courseId/modules
POST   /api/v1/courses/:courseId/modules              { title, description?, order_index }
PATCH  /api/v1/modules/:id
DELETE /api/v1/modules/:id
POST   /api/v1/courses/:courseId/modules/reorder      { module_ids: [...] }

GET    /api/v1/modules/:moduleId/lessons
POST   /api/v1/modules/:moduleId/lessons
  body: { title, description?, lesson_type: "live"|"recorded", scheduled_at,
          live_call_link? }              // только для lesson_type = "live"
GET    /api/v1/lessons/:id
PATCH  /api/v1/lessons/:id
DELETE /api/v1/lessons/:id
POST   /api/v1/lessons/:id/publish
POST   /api/v1/modules/:moduleId/lessons/reorder      { lesson_ids: [...] }

POST   /api/v1/lessons/:id/attach-video-start
  → { deep_link }
  // для recorded — заполнит recorded_video_file_id; для live — live_recording_file_id.
  // Если учитель не хочет оставлять запись live-урока — этот эндпоинт просто не вызывается,
  // поле остаётся NULL (раздел 4 идеи-документа).

GET    /api/v1/lessons/:id/materials
POST   /api/v1/lessons/:id/materials
  body: { material_type: "text", text_content, order_index }
  или:  { material_type: "video"|"file", order_index }  → { deep_link }  // приём файла через чат с ботом
DELETE /api/v1/lesson-materials/:id
```

### 2.3 Домашние задания и проверка

```
GET    /api/v1/lessons/:lessonId/homework
POST   /api/v1/lessons/:lessonId/homework      { instructions?, deadline_at }
PATCH  /api/v1/homework/:id                    { instructions?, deadline_at? }

GET    /api/v1/homework/:id/submissions?latest=true|false
GET    /api/v1/submissions/:id
POST   /api/v1/submissions/:id/review
  body: { status: "passed"|"needs_resubmission",
          comment_text? }                      // либо comment_text, либо голосовое —
                                                 // голосовой комментарий прикрепляется через
                                                 // POST /api/v1/submissions/:id/review/voice-start → deep_link

GET    /api/v1/review-queue?course_id=&is_late=&status=pending
  сквозная очередь непроверенных ДЗ по всем курсам, доступным учителю/помощнику
```

**Просмотр фото сдачи.** Фото ученик отправляет боту в личку (раздел 0) — это
чат ученика с ботом, учитель в нём не участвует и не может увидеть фото
никаким естественным способом. Поэтому проверка в дашборде без прокси-
эндпоинта физически не работает — это не вопрос удобства, а обязательная
часть флоу:

```
GET /api/v1/submissions/:id/photos
  → { photos: [{ index, url }] }
  // url = /api/v1/submissions/:id/photos/:index/raw

GET /api/v1/submissions/:id/photos/:index/raw
  → бинарный поток (image/jpeg), бэкенд на лету получает файл у Telegram
    (Bot API getFile + скачивание по file_id из photo_file_ids[index]) и
    отдаёт его — без постоянного хранения копии на своей стороне
```

Доступ — как и весь остальной раздел 2.3: учитель видит фото по своим
сдачам; помощник — только если `can_review_homework = true` на курсе этой
сдачи (проверяется через `homework_submissions.teacher_id`/`course_id`, не
через сам факт владения `id` сдачи — иначе можно было бы подсмотреть чужую
сдачу, зная её числовой ID).

Стоит на будущее (не блокирует MVP): недолгое кэширование скачанных байт на
бэкенде — Telegram даёт `file_path` из `getFile` с ограниченным сроком
жизни, при частом открытии одной и той же сдачи разумно не бить лишний раз
по Bot API.

Помощник видит `review-queue` и вызывает `POST .../review` только по курсам,
где у него `can_review_homework = true` (это право по умолчанию при создании
разрешения).

### 2.4 Ученики, доступ, дисциплина

```
GET    /api/v1/courses/:courseId/students
  роспись: { student_id, telegram_username, access_granted, expires_at, revoked,
             penalty_points, is_blacklisted, progress_summary }

GET    /api/v1/students/:id                    профиль ученика в рамках текущего тенанта

POST   /api/v1/courses/:courseId/students/:studentId/access
  body: { expires_at }                         выдать доступ
PATCH  /api/v1/courses/:courseId/students/:studentId/access
  body: { expires_at }                         продлить/изменить срок
POST   /api/v1/courses/:courseId/students/:studentId/access/revoke
                                                отзыв доступа + удаление из TG-группы курса

GET    /api/v1/access/expiring                 виджет дашборда: скоро истекает / истёк, ждёт решения

GET    /api/v1/courses/:courseId/students/:studentId/penalty
  → { current_points, is_blacklisted, events: [...] }
POST   /api/v1/courses/:courseId/students/:studentId/penalty/reset
POST   /api/v1/courses/:courseId/students/:studentId/blacklist        { reason }
POST   /api/v1/courses/:courseId/students/:studentId/blacklist/clear
```

`access/revoke`, `penalty/reset`, `blacklist`, `blacklist/clear` для помощника
требуют `can_manage_access` / `can_manage_blacklist = true` на этом курсе
(идея-документ §2.3, уточнено в grilling-сессии) — иначе 403.

### 2.5 Настройки, помощники, дашборд

```
GET    /api/v1/settings
PATCH  /api/v1/settings                        { penalty_point_threshold }             [teacher]

GET    /api/v1/assistants                                                              [teacher]
POST   /api/v1/assistants                      { username, password, display_name }    [teacher]
PATCH  /api/v1/assistants/:id                  { is_active? }                          [teacher]

GET    /api/v1/assistants/:id/permissions
PUT    /api/v1/assistants/:id/permissions/:courseId
  body: { can_review_homework, can_manage_access, can_manage_blacklist }               [teacher]
DELETE /api/v1/assistants/:id/permissions/:courseId                                    [teacher]

GET    /api/v1/dashboard/summary
  → { active_students, unreviewed_homework_count, upcoming_live_lessons,
      access_needing_attention_count, students_near_blacklist_threshold }
```

---

## 3. Mini App API (ученик)

Только курсы, где у ученика есть строка `course_access` с
`access_granted = true AND revoked = false AND` (нет активной блокировки в
`course_blacklist` по этому курсу).

### 3.1 Курсы и уроки

```
GET /api/v1/app/courses                        мои курсы с доступом
GET /api/v1/app/courses/:id/modules
GET /api/v1/app/modules/:id/lessons
GET /api/v1/app/lessons/:id
  → { title, lesson_type, scheduled_at, live_call_link?, has_recording, materials: [...] }
  // видео НЕ отдаётся прямой ссылкой — оно только через бота, см. ниже

POST /api/v1/app/lessons/:id/request-video
  → { status: "sent_to_chat" }
  // бэкенд шлёт студенту в личку сохранённый file_id (recorded_video_file_id
  // либо live_recording_file_id, если она есть; если записи нет — 404 с
  // понятным сообщением "запись не была оставлена учителем")
```

### 3.2 Домашние задания

```
GET  /api/v1/app/homework/:id
GET  /api/v1/app/homework/:id/submissions       история своих попыток

POST /api/v1/app/homework/:id/submit-start
  → { deep_link }
  // "Отправьте одно или несколько фото решения в чат с ботом"
  // is_late считается на бэкенде в момент фактической сдачи (первое фото
  // группы), относительно текущего homeworks.deadline_at
```

### 3.3 Профиль

```
GET /api/v1/app/profile
  → { telegram_username,
      courses: [{ course_id, title, access_status: "active"|"expired_pending"|"revoked",
                   penalty_points, is_blacklisted }] }
```

---

## 4. Telegram-вебхук (единая точка входа)

```
POST /telegram/webhook
```

Секретится заголовком `X-Telegram-Bot-Api-Secret-Token`. Дальше не REST-
ресурсы, а внутренняя маршрутизация апдейтов:

| Апдейт | Обработка |
|---|---|
| `/start course_<id>` от нового Telegram-пользователя | создать `students`, если нет; создать "ожидающую" запись `course_access` (`access_granted=false`) — появляется в дашборде учителя как кандидат на выдачу доступа |
| Фото(-альбом) от ученика, есть непросроченный `bot_pending_actions(action_type='submit_homework')` на его `telegram_id` | сгруппировать альбом (по `media_group_id`, короткое окно буферизации), создать `homework_submissions` с массивом `photo_file_ids`, пометить действие consumed |
| Видео/файл от учителя, есть непросроченный `bot_pending_actions(action_type='attach_lesson_recording')` | записать `file_id` в нужное поле урока, пометить consumed |
| Сообщение в группе курса с `/link_<token>`, есть соответствующий `link-start` | создать/обновить `course_telegram_groups` |
| Команда от Telegram ID, сконфигурированного как `owner` | создание/просмотр учителей (`staff_users`+`teachers`), т.е. админ-функции владельца — не имеют веб-аналога |
| Прочее (напоминания и т.п.) | инициируется не вебхуком, а шедулером бэкенда — тот вызывает Bot API на отправку напрямую, отдельного REST-эндпоинта для этого нет |

---

## 5. Сквозные правила

- **Ошибки**: `{ error: { code, message } }`, стандартные HTTP-статусы
  (401 — не аутентифицирован, 403 — не тот тенант/нет права, 404, 409 —
  конфликт уникальности, 422 — валидация).
- **Пагинация**: курсорная (`?cursor=&limit=`) на списках, которые могут расти
  без явного потолка — `submissions`, `disciplinary-events`,
  `notifications` (последний нигде не отдаётся напрямую клиентам в этой
  версии API, только используется бэкендом).
- **Идемпотентность мутирующих POST, инициирующих чат с ботом**
  (`attach-video-start`, `submit-start`, `telegram-group/link-start`) —
  повторный вызов должен переиспользовать непросроченную запись
  `bot_pending_actions`, а не плодить дубли.
- Deep-link'и — формат `https://t.me/<bot_username>?start=<action>_<id>_<token>`,
  `token` — случайная строка для защиты от подбора/повторного использования.
