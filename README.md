# AIStart360 — клиентский портал

AIStart360 — платформа AI-диагностики бизнеса для клиентов, экспертов и админов.
Клиент проходит онбординг и опрос, движки считают «Точку А» (текущее состояние),
GRI-индекс и «Точку Б» (цели и план), а LLM через OpenRouter превращает цифры в
нарратив, инсайты и отчёты. Сверху — рабочие области экспертов, ГИГА-Панель
супер-админа, омниканальный инбокс (WhatsApp/Instagram/Telegram) и AI-first
пространство `/journey`.

Стек: Next.js 14 (App Router) + TypeScript 5, Supabase (Postgres + Auth + RLS),
Prisma 5, NextAuth v5, Tailwind + shadcn/ui, Zustand, Vitest + Playwright.
Деплой — Vercel. Требуется Node.js >= 20.

---

## ⚠️ Прочитайте до первого запуска

1. **`DATABASE_URL` по умолчанию смотрит в ПРОДАКШН.** Значения в `.env`,
   полученные через `vercel env pull`, указывают на боевой проект Supabase.
   Любой скрипт из `scripts/`, любой `prisma db push` и любая миграция,
   запущенные «просто проверить», уйдут в живую базу с реальными клиентами.
   Перед локальной работой заведите отдельный Supabase-проект и пропишите его
   строки подключения в `.env.local` — он читается раньше `.env`.

2. **`prisma/seed.ts` начинается с `deleteMany()`.** Первые строки сида чистят
   `pulseMetric`, `griReport`, `client`, `user`, `organization` — то есть
   `npx prisma db seed` на продовой строке подключения **безвозвратно удалит
   боевые данные**. Запускайте его только против одноразовой базы и только
   убедившись, какой `DATABASE_URL` реально подхватился.

3. **`vercel env pull` не скачивает sensitive-переменные.** Вместо значения он
   пишет литерал `[SENSITIVE]` (сейчас так помечены `SUPABASE_SERVICE_ROLE_KEY`,
   `GIGA_ADMIN_PASSWORD`, `GIGA_COOKIE_SECRET`, `CRON_SECRET` и другие).
   `lib/env.ts` считает такое значение отсутствующим и честно сообщает об этом —
   реальные значения нужно скопировать из панели Vercel вручную.

4. **Не коммитьте секреты в `.md`-файлы.** Google OAuth client secret уже один
   раз утёк через `collaborator_handoff.md` и остался в истории Git — подробности
   и список того, что нужно перевыпустить, там же.

---

## Переменные окружения

Полный список с комментариями — в `.env.example` (больше сотни переменных;
он же источник правды, этот раздел — только выжимка). Скопируйте его в
`.env.local` и заполните.

### Обязательный минимум (без них сервер нерабочий)

Эти пять валидируются в `lib/env.ts` (`CRITICAL_SERVER_ENV_VARS`) и попадают в
`/api/health`:

| Переменная | Назначение |
| :--- | :--- |
| `DATABASE_URL` | Пулер Supabase (порт 6543, `?pgbouncer=true`) — рантайм-запросы Prisma |
| `DIRECT_URL` | Прямое подключение (порт 5432) — миграции |
| `NEXT_PUBLIC_SUPABASE_URL` | URL проекта Supabase (уходит в браузер) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Публичный anon-ключ (уходит в браузер) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role ключ. **Только сервер** — обходит RLS, никогда не отдавать клиенту |

### Практически обязательные (без них модули падают или деградируют)

| Переменная | Что сломается без неё |
| :--- | :--- |
| `AUTH_SECRET` | Подпись сессий NextAuth. Генерируется `openssl rand -base64 32`, уникальный на окружение |
| `AUTH_URL` | Канонический URL приложения: редиректы, ссылки в письмах, HTTP-Referer для OpenRouter. Локально `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Вход через Google (`lib/auth.config.ts`) — приложение падает в рантайме, если не заданы |
| `OPENROUTER_API_KEY` | **Все** AI-функции: извлечение данных из документов, нарратив Точки А, инсайты, Pulse-брифинг, стратегия Точки Б, GRI AI. Все живые вызовы LLM идут через `lib/ai/openrouter.ts` |
| `GIGA_ADMIN_PASSWORD` | Вход в ГИГА-Панель супер-админа (`/api/giga-admin/auth`) |
| `JOURNEY_CONNECT_CODE_SECRET` | Одноразовые коды привязки устройств в `/journey`. Минимум 32 случайных байта; в продакшене коды не выдаются без него |
| `RESEND_API_KEY` | Транзакционная почта, в том числе восстановление пароля |

Остальное (`GIGA_COOKIE_SECRET`, Langfuse, Inngest, Upstash, Meta/WhatsApp/
Instagram, Telegram, Exa/Firecrawl, Kaspi, фиче-флаги) опционально —
соответствующие модули без ключей честно деградируют. Смотрите `.env.example`.

---

## Локальный запуск

```bash
# 1. Зависимости (postinstall сам выполнит prisma generate)
npm install

# 2. Конфиг: заполните .env.local — он имеет приоритет над .env
#    (-n, чтобы не затереть уже существующий локальный конфиг)
cp -n .env.example .env.local

# 3. Проверьте, что смотрите НЕ в прод
grep -E '^(DATABASE_URL|DIRECT_URL)' .env.local

# 4. Дев-сервер на http://localhost:3000
npm run dev
```

Проверить конфигурацию, не открывая UI: `GET /api/health` — эндпоинт возвращает
поле `missingEnv` со списком незаполненных критичных переменных.

### Прочие команды

```bash
npm run type-check   # tsc --noEmit
npm run lint         # next lint
npm test             # vitest run (юнит + интеграционные)
npm run test:e2e     # playwright
npm run build        # прод-сборка
```

---

## Миграции

Схема базы живёт в `supabase/migrations/*.sql` (72 файла, нумерация от `001` до
`075` — с пропусками). CLI `supabase` в репозитории не используется: миграции
применяются одноразовым скриптом, который прогоняет файл целиком через
simple-query протокол, чтобы блоки `DO $$ ... $$` не разваливались:

```bash
node scripts/apply-migration.js supabase/migrations/075_ai_journey_device_sync.sql
```

Скрипт читает `.env.local`, затем `.env`, и подключается по `DIRECT_URL`
(с фолбэком на `DATABASE_URL`). Он печатает строку подключения с замаскированным
паролем — **сверьте хост перед тем, как нажать Enter**: скрипт не спрашивает
подтверждения и не откатывает изменения.

Применять по одному файлу в порядке возрастания номера. Часть миграций имеет
скрипты-верификаторы рядом: `scripts/verify-migration-016.js`, `-018`, `-021`, `-023`.

`prisma/schema.prisma` описывает подмножество тех же таблиц для Prisma Client;
`prisma migrate` в этом проекте источником правды не является.

---

## Тестовые данные

### Рекомендуемый способ — `scripts/seed-test-data.js`

Идемпотентный сид поверх Supabase Admin API. Создаёт три аккаунта в домене
`@aistart360.test` (client / expert / admin, пароль `Test1234!`), компанию,
заполненный опрос, актуальную диагностику Точки А и GRI-оценку — достаточно,
чтобы все вкладки портала показывали реальные данные.

```bash
node scripts/seed-test-data.js
```

Требует `NEXT_PUBLIC_SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` (не `[SENSITIVE]`).
Ничего не удаляет — повторный запуск переиспользует существующие записи.

### `prisma/seed.ts` — деструктивный, по умолчанию не запускать

```bash
npx prisma db seed   # ⚠️ первым делом делает deleteMany() по пяти таблицам
```

Годится только для чистой одноразовой базы. См. предупреждение №2 выше.

---

## Структура

```text
app/                    # Next.js App Router: (auth) (dashboard) (expert) (owner)
                        # (public), client/, journey/, admin-giga-panel/, api/
components/             # UI, в том числе components/giga-panel/
lib/                    # Домен: ai/, gri/, point-a-engine, auth, env, rbac, audit
prisma/                 # schema.prisma + seed.ts (деструктивный)
supabase/migrations/    # SQL-миграции — источник правды по схеме
scripts/                # Операционные скрипты (пишут в БД — см. предупреждения)
services/               # whatsapp-web-bridge и прочие сайдкары
tests/                  # unit/ integration/ e2e/ helpers/
```

Дополнительно: `SUPABASE_SETUP.md` — настройка проекта Supabase с нуля,
`IMPLEMENTATION.md` — устройство админ-панели, `CHANGELOG.md` — история изменений.
