# Фаза 2: GRI Pulse CRM — лёгкая CRM в портале — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Превратить нижний CRM-монитор на /pulse в простой рабочий инструмент по работе с клиентами: своя база клиентов, экран «Кому звонить сегодня», статусы/воронка, напоминания, реальные действия (звонок/сообщение с логом касаний) — без замены AmoCRM/Bitrix24.

**Architecture:** Новые Supabase-таблицы `crm_clients / crm_interactions / crm_reminders` (RLS own, префикс `crm_` — имя `clients` занято мёртвой Prisma-моделью). REST API `app/api/v1/crm/*` (конверт `{ok,data|error}`, сессионный клиент → RLS). Фронт переиспользует существующие `RiskBadge/RiskBar/MiniSparkline/ClientCard` и риск-скоринг из `/api/pulse`, но данные берёт из своей базы. Ползунки «Пульс недели» опускаются вниз; порядок на /pulse: CRM сверху, пульс ниже. Пункт бокового меню «Клиенты» ведёт на /pulse (вкладка «Сегодня»). Напоминания пишутся в существующую ленту `app_notifications` (`createNotification`) + утренний cron-дайджест.

**Tech Stack:** Next.js 14, Supabase (RLS, миграции через `node scripts/apply-migration.js`), Prisma НЕ используется, recharts, framer-motion, sonner, react-query (`hooks/usePulse` как образец). Следующий свободный номер миграции — **044**.

**Спека:** `docs/superpowers/specs/2026-07-08-gri-pulse-crm-design.md` §3 + решения ПО в `2026-07-08-ux-ideas-competitors.md` §5 (довески №23 quick-add из буфера, №28 mini-GRI-лиды → CRM).

**Конвенции:** русский UI, primary `#6effc0`, snake_case-колонки, RLS-шаблон 027/042, `NOTIFY pgrst`, проверка затронутых строк после UPDATE (урок аудита 2026-07-04), FK на `auth.users(id)`/`profiles(id)` (companies.id — TEXT, прямой FK нельзя). Тесты `npx vitest run <path>`, линт `npm run lint`. Коммит после каждой задачи.

---

## Блок A — Данные (миграция 044)

### Task 1: Миграция 044 — crm_clients / crm_interactions / crm_reminders

**Files:** Create `supabase/migrations/044_crm_clients.sql`

- [ ] **Step 1:** написать миграцию (идемпотентно, RLS own CRUD + staff-read, только snake_case). Статусы клиента — CHECK-константа: `new|in_progress|waiting|customer|sleeping|lost`. Напоминания: `open|done|dismissed`. Взаимодействия: `call|message|meeting|note|status_change`.

```sql
-- 044_crm_clients.sql — лёгкая CRM владельца (см. Фаза 2 плана).
-- Применение: node scripts/apply-migration.js supabase/migrations/044_crm_clients.sql

CREATE TABLE IF NOT EXISTS public.crm_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,                       -- нормализованный E.164, nullable
  phone_raw TEXT,                   -- как ввёл пользователь
  email TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_progress','waiting','customer','sleeping','lost')),
  source TEXT,                      -- 'manual'|'csv'|'mini_gri'|'bitrix24'|'amocrm'|...
  avg_check NUMERIC,                -- средний чек / сумма сделки (для «выручка под риском»)
  note TEXT,
  next_contact_at TIMESTAMPTZ,
  last_contact_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_clients_user_status ON public.crm_clients (user_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_clients_user_next ON public.crm_clients (user_id, next_contact_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_clients_user_phone
  ON public.crm_clients (user_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crm_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.crm_clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('call','message','meeting','note','status_change')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_client ON public.crm_interactions (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.crm_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.crm_clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_crm_reminders_user_due ON public.crm_reminders (user_id, status, due_at);

-- RLS: own CRUD + staff read — на все три таблицы (шаблон 027/042).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_clients','crm_interactions','crm_reminders'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_sel_own ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_sel_own ON public.%I FOR SELECT USING (auth.uid() = user_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_ins_own ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_ins_own ON public.%I FOR INSERT WITH CHECK (auth.uid() = user_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_upd_own ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_upd_own ON public.%I FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_del_own ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_del_own ON public.%I FOR DELETE USING (auth.uid() = user_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_sel_staff ON public.%I', t, t);
    EXECUTE format($f$CREATE POLICY %I_sel_staff ON public.%I FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('super_admin','admin','manager','analyst')))$f$, t, t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2:** применить `node scripts/apply-migration.js supabase/migrations/044_crm_clients.sql` — успех. (На prod накатить отдельно — отметить в PR.)
- [ ] **Step 3:** commit `feat(crm): миграция 044 — crm_clients/interactions/reminders (RLS own + staff-read)`.

## Блок B — Утилиты и API

### Task 2: Нормализация телефона (E.164, KZ-осведомлённая) + тесты

**Files:** Create `lib/crm/phone.ts`, `tests/unit/crm/phone.test.ts`

- [ ] TDD. `normalizePhone(raw: string): { e164: string | null; raw: string }`. Правила: убрать пробелы/скобки/дефисы; `8XXXXXXXXXX` (11 цифр, каз/рос) → `+7XXXXXXXXXX`; `7XXXXXXXXXX` → `+7…`; уже `+…` с 11-15 цифрами → как есть; иначе `e164=null` (телефон опционален). Тесты: `+7 701 000 00 01`, `8(727)300-55-00`, `77010000001`, мусор → null, пусто → null.
- [ ] Реализация, PASS, commit `feat(crm): нормализация телефона в E.164`.

### Task 3: Валидатор клиента + CSV-парсер + тесты

**Files:** Create `lib/crm/client-validate.ts`, `lib/crm/csv-import.ts`, `tests/unit/crm/client-validate.test.ts`, `tests/unit/crm/csv-import.test.ts`

- [ ] `validateClient(body): {ok,value}|{ok:false,error}` — name обязателен (trim, ≤120, не пустой); phone через normalizePhone; status ∈ набора (default 'new'); avg_check — конечное число ≥0 или null; email/source/note — строки с капами; next_contact_at — ISO или null.
- [ ] `parseClientsCsv(text): {rows: ClientDraft[]; skipped: number}` — распознаёт русские заголовки (Имя/Name, Телефон/Phone, Email, Комментарий/Заметка, Сумма/Чек), дедуп внутри файла по нормализованному телефону, строки без имени пропускаются (считать skipped).
- [ ] Тесты на оба; PASS; commit `feat(crm): валидатор клиента + CSV-импорт с русскими заголовками`.

### Task 4: API клиентов — `app/api/v1/crm/clients`

**Files:** Create `app/api/v1/crm/clients/route.ts`, `app/api/v1/crm/clients/[id]/route.ts`

- [ ] GET (список own, фильтр `?status=`, сортировка по `next_contact_at` NULLS LAST затем created_at desc, лимит 500); POST (validateClient → insert user_id из сессии, дедуп по uq-индексу → 409 при конфликте телефона с понятной ошибкой). Паттерн auth/envelope — из `app/api/v1/gri/calc-sessions/route.ts`.
- [ ] `[id]`: PATCH (частичное обновление own; при смене status — писать `crm_interactions` kind=status_change; **проверять число затронутых строк**), DELETE (own; UUID-guard как в calc-sessions/[id]).
- [ ] Линт + smoke (401 без сессии); commit `feat(crm): API v1/crm/clients (CRUD, дедуп по телефону)`.

### Task 5: API взаимодействий и напоминаний

**Files:** Create `app/api/v1/crm/clients/[id]/interactions/route.ts`, `app/api/v1/crm/clients/[id]/reminders/route.ts`, `app/api/v1/crm/reminders/[id]/route.ts`

- [ ] interactions: GET (таймлайн клиента, own), POST (kind+comment; обновляет `last_contact_at=now()` у клиента). reminders (клиентские): GET (open по клиенту), POST (due_at+note). `reminders/[id]`: PATCH (status done/dismissed; done → пишет interaction «выполнено» + предлагает next_contact_at). Все — own, проверка строк.
- [ ] Линт + smoke; commit `feat(crm): API взаимодействий и напоминаний`.

### Task 6: API «Сегодня» и импорт

**Files:** Create `app/api/v1/crm/today/route.ts`, `app/api/v1/crm/clients/import/route.ts`, `lib/crm/risk.ts`

- [ ] `lib/crm/risk.ts` — вынести детерминированный риск-скоринг (перенести формулу из `app/api/pulse/route.ts`: staleness от last_contact_at, отклонение avg_check от среднего → riskScore 0-100, churnLevel high/medium/low, action call/message/monitor, comment). Чистая функция + мини-тест.
- [ ] `today`: GET — собрать очередь own-клиентов: (1) просроченные reminders, (2) на сегодня, (3) без next_contact_at и статус активный, (4) «спят» (last_contact_at > 30д, статус customer/sleeping); вернуть с риск-полями + KPI (всего, в риске, выручка под риском = сумма avg_check красных, обработано сегодня). Форма ответа совместима с текущим `usePulse` контрактом `{stats, todayClients, aiBriefing}` где возможно (переиспользовать фронт).
- [ ] `import`: POST multipart (CSV/XLSX через parseDocument для xlsx→text? — для CSV `file.text()`; для XLSX использовать lib/documents/parse.ts) → parseClientsCsv → upsert по (user_id, phone), вернуть `{inserted, updated, skipped}`.
- [ ] Тесты risk.ts; линт; commit `feat(crm): API «Сегодня» (очередь+KPI) и импорт клиентов`.

## Блок C — Фронт

### Task 7: Хук данных CRM

**Files:** Create `hooks/useCrm.ts` (react-query), при необходимости расширить `hooks/usePulse.ts`

- [ ] `useCrmToday()` → GET /api/v1/crm/today; `useCrmClients(status?)`; мутации add/update/delete/logInteraction/addReminder/completeReminder с инвалидацией ключей. queryKey `['crm', ...]`.
- [ ] commit `feat(crm): react-query хук useCrm`.

### Task 8: Экран «Сегодня» + KPI-строка

**Files:** Modify `app/(dashboard)/pulse/page.tsx` (CrmMonitorSection), возможно вынести в `components/crm/*`

- [ ] Первая вкладка CRM — очередь «Кому звонить сегодня» из `useCrmToday`: карточки (переиспользовать `ClientCard`, `RiskBadge`, `RiskBar`, `MiniSparkline`), сортировка просроченные→сегодня→без плана→спят. KPI-строка сверху (всего/в риске/выручка под риском/обработано). Кнопки на карточке — реальные `tel:`/`wa.me/<phone>`.
- [ ] Нижний блок карточек существующего вида НЕ менять сильно (требование ПО) — только источник данных на свою базу.
- [ ] Верификация в превью; commit `feat(crm): экран «Кому звонить сегодня» на своей базе + KPI`.

### Task 9: База клиентов + воронка + инлайн-добавление + quick-add из буфера

**Files:** Create `components/crm/ClientsTable.tsx`, `components/crm/FunnelBar.tsx`, `components/crm/AddClientInline.tsx`

- [ ] Таблица клиентов (`useCrmClients`): поиск, фильтр по статусу, индикатор давности (зелёный<7д/жёлтый7-30/красный>30 по last_contact_at), смена статуса селектом в строке. Воронка-бар над таблицей: сегменты-статусы с count+сумма avg_check, клик = фильтр.
- [ ] Инлайн-добавление (имя+телефон, 5 сек) + **quick-add из буфера** (№23): кнопка «Вставить из буфера» парсит «Имя +7 777…» (regex) → префилл формы.
- [ ] Верификация; commit `feat(crm): база клиентов, воронка-бар, инлайн- и quick-add`.

### Task 10: Карточка клиента (drawer) + таймлайн + напоминания + CSV-импорт

**Files:** Create `components/crm/ClientDrawer.tsx`, `components/crm/CsvImportDialog.tsx`; заменить заглушки CallModal/MessageModal

- [ ] Drawer: поля клиента (редактируемые), таймлайн касаний (`interactions`), список/создание напоминаний, кнопка «выполнено» пишет interaction. Кнопка «История» в существующем ClientCard открывает этот drawer.
- [ ] CallModal/MessageModal: реальный телефон клиента, «Зафиксировать» пишет interaction (убрать ложные надписи), MessageModal открывает `wa.me`/`tel:` и логирует касание.
- [ ] CSV-импорт диалог: загрузка → предпросмотр маппинга → импорт (/api/v1/crm/clients/import), тост с `{inserted, updated, skipped}`.
- [ ] Верификация; commit `feat(crm): карточка клиента с таймлайном, реальные действия, CSV-импорт`.

### Task 11: Ползунки «Пульс недели» вниз + пункт меню «Клиенты»

**Files:** Modify `app/(dashboard)/pulse/page.tsx` (PulsePage порядок), навигация (`lib/navigation`/Sidebar), `components/pulse/GriPulseWidget.tsx` (компактность)

- [ ] Порядок /pulse: CRM-блок сверху, «Пульс недели» ниже (сворачиваемая секция; ползунки — снизу страницы, как просил ПО). Нижний блок пульса не менять по существу.
- [ ] Пункт бокового меню «Клиенты» → `/pulse` (или `/pulse#today`); синхронно проверить middleware/роли.
- [ ] Верификация; commit `feat(crm): ползунки пульса вниз + пункт меню «Клиенты»`.

## Блок D — Напоминания в портале

### Task 12: In-app напоминания + утренний cron-дайджест

**Files:** Create `app/api/cron/crm-digest/route.ts`; использовать `lib/notifications/create.ts` (createNotification)

- [ ] При наступлении due напоминания / наличии просроченных — писать в `app_notifications` (категория `crm`, link `/pulse`) через service role. Cron-роут (защита `CRON_SECRET`, время утро Asia/Almaty через vercel.json crons) по каждому пользователю собирает просроченные+сегодня+спящих и постит одно сводное уведомление; учитывать `profiles.preferences.notifications` (если выключено — не слать).
- [ ] Внешние каналы (Email/Telegram/WhatsApp/SMS/Push) — Фаза 4, здесь только in-app + каркас cron.
- [ ] Верификация (колокольчик получает уведомление); commit `feat(crm): напоминания в ленту уведомлений + утренний cron-дайджест`.

## Блок E — Интеграция mini-GRI → CRM (довесок №28) + верификация

### Task 13: mini-GRI лиды попадают в CRM владельца

**Files:** Modify `app/api/public/mini-gri/route.ts` (или связанный обработчик)

- [ ] При capture лида mini-GRI — если есть привязка к владельцу портала, создавать `crm_clients` (source='mini_gri', name/email/phone из формы, note со score). Без владельца — не создавать (лид остаётся в mini_gri_leads). Идемпотентно (дедуп по телефону/email).
- [ ] commit `feat(crm): лиды mini-GRI попадают в базу клиентов (source=mini_gri)`.

### Task 14: Финальная верификация Фазы 2

- [ ] `npx vitest run && npm run lint` — чисто.
- [ ] skill verify в превью: добавить клиента (имя+телефон) за 5 сек → появляется в базе и в «Сегодня»; сменить статус → пишется в таймлайн; «позвонить» → лог касания + next_contact_at; создать напоминание с прошедшим due → приходит в колокольчик; CSV-импорт 3 строк с дублем → корректные inserted/updated/skipped; пульс недели внизу работает как раньше.
- [ ] Мобильный проход (375px): таблица/воронка/drawer без горизонтального переполнения.
- [ ] commit `feat(crm): Фаза 2 — верификация; миграцию 044 накатить на prod`.

## Definition of Done (Фаза 2)
- Клиент добавляется за 5 секунд (имя+телефон); своя база, не демо.
- «Кому звонить сегодня» сортирует просроченных вверх и показывает реальные `tel:`/`wa.me`.
- Смена статуса и звонок/сообщение оседают в таймлайне; напоминание приходит в колокольчик.
- Воронка-бар и KPI считаются по своей базе; CSV-импорт с дедупом по телефону.
- «Пульс недели» — внизу /pulse, работает как раньше; пункт меню «Клиенты» ведёт в CRM.
- Тесты и линт зелёные; миграция 044 применена локально (+prod-заметка).

## Не делаем в Фазе 2 (Фаза 4/бэклог)
Синк AmoCRM/Bitrix24 в базу; Email/Telegram/WhatsApp/SMS/Push-дайджесты; канбан-вид; конструктор воронок; AI-скоринг лидов.
