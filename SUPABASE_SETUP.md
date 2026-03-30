# Supabase — Инструкция по настройке базы данных
## AIStart360 · Client Portal Onboarding System

> **Prisma остаётся** — используется для Pulse/GRI функционала.
> Supabase (прямой SQL) используется для нового Client Portal (модули 1–5).

---

## Оглавление

1. [Предварительные требования](#1-предварительные-требования)
2. [Создание проекта в Supabase](#2-создание-проекта-в-supabase)
3. [Переменные окружения](#3-переменные-окружения)
4. [Запуск SQL-миграции](#4-запуск-sql-миграции)
5. [Настройка RLS (Row Level Security)](#5-настройка-rls)
6. [Настройка Storage Bucket](#6-настройка-storage-bucket)
7. [Включение Realtime](#7-включение-realtime)
8. [Создание первого администратора](#8-создание-первого-администратора)
9. [Проверка — что должно быть создано](#9-проверка)
10. [Сброс и отладка](#10-сброс-и-отладка)

---

## 1. Предварительные требования

| Что нужно | Версия / Условие |
|-----------|-----------------|
| Аккаунт Supabase | [supabase.com](https://supabase.com) — Free или Pro |
| Node.js | v18+ |
| Supabase CLI (опционально) | `npm install -g supabase` |
| Доступ к Supabase Dashboard | SQL Editor, Storage, Auth |

---

## 2. Создание проекта в Supabase

### Шаг 1 — Создать новый проект

1. Войдите на [app.supabase.com](https://app.supabase.com)
2. Нажмите **New project**
3. Заполните:
   - **Name**: `aistart360-portal`
   - **Database Password**: сгенерируйте надёжный пароль, **сохраните его**
   - **Region**: ближайший к вашим пользователям (например, `Frankfurt (eu-central-1)`)
4. Нажмите **Create new project** — ждите ~2 минуты

### Шаг 2 — Получить ключи

Перейдите: **Settings → API**

Скопируйте:
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY`

---

## 3. Переменные окружения

Создайте файл `.env.local` в корне проекта:

```env
# ─── Supabase ─────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ─── Prisma (существующий — не трогать) ───────────────────────────────────────
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres"
DIRECT_URL="postgresql://postgres:[PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres"

# ─── n8n (для парсинга документов) ────────────────────────────────────────────
N8N_WEBHOOK_URL=https://your-n8n.domain.com/webhook/process-document
N8N_API_KEY=your_n8n_api_key

# ─── App ──────────────────────────────────────────────────────────────────────
NEXTAUTH_SECRET=generate_with: openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> ⚠️ **Никогда не коммитьте `.env.local`** — он уже в `.gitignore`.

---

## 4. Запуск SQL-миграции

Файл миграции находится по пути:
```
supabase/migrations/001_onboarding_system.sql
```

### Способ A — через Supabase Dashboard (рекомендуется)

1. Откройте ваш проект на [app.supabase.com](https://app.supabase.com)
2. Перейдите: **SQL Editor** (иконка терминала в левом меню)
3. Нажмите **New query**
4. Вставьте содержимое файла `001_onboarding_system.sql`
5. Нажмите **Run** (`Ctrl+Enter` / `Cmd+Enter`)
6. Убедитесь что внизу отображается: `Success. No rows returned`

### Способ B — через Supabase CLI

```bash
# Установить CLI (если не установлен)
npm install -g supabase

# Войти в аккаунт
supabase login

# Привязать проект (берите Project ID из Settings → General)
supabase link --project-ref xxxxxxxxxxxx

# Применить миграцию
supabase db push

# ИЛИ запустить конкретный SQL файл напрямую
supabase db reset --db-url "postgresql://postgres:[PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres"
```

### Способ C — через psql (прямое подключение)

```bash
# Connection string из: Settings → Database → Connection string → URI
psql "postgresql://postgres:[PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres" \
  -f supabase/migrations/001_onboarding_system.sql
```

---

## 5. Настройка RLS

RLS включается автоматически в SQL-миграции. Проверьте вручную:

1. Перейдите: **Table Editor** → выберите таблицу
2. Нажмите **RLS disabled** — должно быть **RLS enabled**
3. Нажмите **Policies** — убедитесь что политики созданы

### Таблицы и их политики:

| Таблица | RLS | Политики |
|---------|-----|----------|
| `profiles` | ✅ | select/update own + admin select/update |
| `companies` | ✅ | select/insert/update own + admin select |
| `survey_answers` | ✅ | select/insert/update own + admin select |
| `documents` | ✅ | select/insert/update own + admin select |
| `metrics` | ✅ | select/insert own (через company) + admin select |
| `diagnostics` | ✅ | select/insert own + admin select |

### Если RLS не применился — запустите вручную:

```sql
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_answers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostics     ENABLE ROW LEVEL SECURITY;
```

---

## 6. Настройка Storage Bucket

### Шаг 1 — Создать bucket

**Через Dashboard:**
1. Перейдите: **Storage** → **New bucket**
2. Имя: `client-documents`
3. **Public**: выключить (приватный)
4. Нажмите **Create bucket**

**Через SQL:**
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-documents', 'client-documents', false);
```

### Шаг 2 — Настроить RLS для Storage

Перейдите: **Storage** → **Policies** → **client-documents** → **New policy**

Выполните в SQL Editor:

```sql
-- Загрузка: пользователь может загружать только в свою папку /{user_id}/
CREATE POLICY "storage_insert_own"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'client-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Чтение: пользователь видит только свои файлы
CREATE POLICY "storage_select_own"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'client-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Удаление: пользователь удаляет только свои файлы
CREATE POLICY "storage_delete_own"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'client-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Администраторы читают все файлы
CREATE POLICY "storage_admin_select"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'client-documents' AND
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('super_admin', 'admin', 'manager')
  )
);
```

### Шаг 3 — Настроить размер файла

Перейдите: **Storage** → **Settings**
- **Max file upload size**: `52428800` (50 MB)

---

## 7. Включение Realtime

Realtime нужен для:
- Автоматического редиректа при смене статуса `pending_approval → approved`
- Live-уведомлений о статусе парсинга документов

### Через Dashboard:

1. Перейдите: **Database** → **Replication**
2. Найдите таблицу `profiles` → включите **INSERT**, **UPDATE**
3. Найдите таблицу `documents` → включите **UPDATE**
4. Найдите таблицу `diagnostics` → включите **INSERT**

### Через SQL:

```sql
-- Добавить таблицы в publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.diagnostics;
```

> ⚠️ Realtime передаёт данные в открытом виде всем подписчикам канала.
> Используйте `.filter('user_id=eq.' + userId)` при подписке на клиенте.

---

## 8. Создание первого администратора

### Шаг 1 — Зарегистрируйте аккаунт через приложение

Запустите приложение и зарегистрируйтесь по адресу `/register`:
- Email: `admin@aistart360.kz`
- Пароль: (надёжный пароль)

### Шаг 2 — Повысьте до администратора через SQL

В Supabase Dashboard → SQL Editor:

```sql
-- Дать роль admin и сразу одобрить
UPDATE public.profiles
SET
  role   = 'admin',
  status = 'approved'
WHERE email = 'admin@aistart360.kz';

-- Проверить
SELECT id, email, role, status FROM public.profiles WHERE email = 'admin@aistart360.kz';
```

---

## 9. Проверка — что должно быть создано

После выполнения миграции убедитесь что всё на месте:

```sql
-- Список созданных таблиц
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles', 'companies', 'survey_answers',
    'documents', 'metrics', 'diagnostics'
  )
ORDER BY table_name;
-- Должно вернуть 6 строк

-- Проверка триггеров
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table;
-- Ожидаемые: profiles_updated_at, companies_updated_at,
--            diagnostics_versioning, on_auth_user_created (на auth.users)

-- Проверка RLS
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles', 'companies', 'survey_answers',
    'documents', 'metrics', 'diagnostics'
  );
-- Все должны иметь rowsecurity = true

-- Проверка политик
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;

-- Проверка вьюх
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN ('v_pending_users', 'v_client_diagnostics');
-- Должно вернуть 2 строки
```

### Чеклист ✅

```
[ ] 6 таблиц созданы (profiles, companies, survey_answers, documents, metrics, diagnostics)
[ ] RLS включён на всех 6 таблицах
[ ] Политики созданы (select/insert/update own + admin)
[ ] Триггер on_auth_user_created активен на auth.users
[ ] Storage bucket "client-documents" создан (приватный)
[ ] Storage RLS политики созданы (4 политики)
[ ] Realtime включён для profiles, documents, diagnostics
[ ] Первый admin создан и статус = approved
[ ] .env.local заполнен (SUPABASE_URL + ANON_KEY + SERVICE_ROLE_KEY)
```

---

## 10. Сброс и отладка

### Сбросить статус пользователя

```sql
-- Вернуть в ожидание (для тестирования)
UPDATE public.profiles
SET status = 'pending_approval', approved_at = NULL, approved_by = NULL
WHERE email = 'test@company.kz';

-- Одобрить вручную
UPDATE public.profiles
SET
  status      = 'approved',
  approved_at = NOW(),
  approved_by = (SELECT id FROM public.profiles WHERE role = 'admin' LIMIT 1)
WHERE email = 'test@company.kz';
```

### Удалить данные онбординга (при тестировании)

```sql
-- Удалить ответы анкеты
DELETE FROM public.survey_answers
WHERE user_id = (SELECT id FROM public.profiles WHERE email = 'test@company.kz');

-- Удалить документы
DELETE FROM public.documents
WHERE user_id = (SELECT id FROM public.profiles WHERE email = 'test@company.kz');

-- Удалить диагностику
DELETE FROM public.diagnostics
WHERE user_id = (SELECT id FROM public.profiles WHERE email = 'test@company.kz');
```

### Пересчитать Point A вручную

```sql
-- Посмотреть текущий результат
SELECT overall_score, health_index, stage, calculated_at
FROM public.diagnostics
WHERE user_id = (SELECT id FROM public.profiles WHERE email = 'test@company.kz')
  AND is_current = TRUE;

-- Сбросить флаг is_current (следующий INSERT создаст новую версию)
UPDATE public.diagnostics
SET is_current = FALSE
WHERE user_id = (SELECT id FROM public.profiles WHERE email = 'test@company.kz');
```

### Проверить загруженные файлы

```sql
SELECT
  d.file_name,
  d.doc_type,
  d.period_year,
  d.period_quarter,
  d.parse_status,
  d.uploaded_at
FROM public.documents d
JOIN public.profiles p ON p.id = d.user_id
WHERE p.email = 'test@company.kz'
ORDER BY d.uploaded_at DESC;
```

### Ручной вызов n8n парсинга

```bash
curl -X POST https://your-n8n.domain.com/webhook/process-document \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_N8N_API_KEY" \
  -d '{
    "document_id": "uuid-here",
    "user_id":     "uuid-here",
    "file_url":    "https://xxxx.supabase.co/storage/v1/object/...",
    "doc_type":    "pl_report",
    "period":      { "year": 2024, "quarter": "Q4" }
  }'
```

### Частые ошибки

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `new row violates row-level security policy` | Запрос идёт через anon key, а не service role | Используйте `supabaseAdmin` (service role) в API routes |
| `relation "public.profiles" already exists` | Миграция уже была запущена | Ничего страшного — используйте `IF NOT EXISTS` |
| `auth.users referenced before ready` | Триггер создан до инициализации auth схемы | Запустите SQL после создания проекта (auth схема создаётся автоматически) |
| Realtime не приходит | Таблица не добавлена в publication | Добавьте через Dashboard → Replication |
| Storage upload 403 | Путь файла не совпадает с `{user_id}/...` | Убедитесь что uploadPath = `${userId}/${filename}` |

---

## Структура файлов

```
supabase/
└── migrations/
    └── 001_onboarding_system.sql   ← Весь SQL: таблицы + RLS + триггеры + вьюхи

SUPABASE_SETUP.md                   ← Этот файл — инструкция
.env.local                          ← Ключи (не коммитить!)
```

---

*AIStart360 · Supabase Setup Guide · v1.0*
