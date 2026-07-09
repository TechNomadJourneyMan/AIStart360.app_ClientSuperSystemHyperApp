# Фаза 4: Внешние каналы напоминаний + синк AmoCRM/Bitrix24 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Батчи выполнять СТРОГО последовательно (один исполнитель за раз).

**Goal:** Утренний CRM-дайджест уходит не только в колокольчик, но и на Email/Telegram по настройкам пользователя (+GRI-инсайт недели); синхронизация AmoCRM/Bitrix24 реально наполняет свою базу клиентов; WhatsApp/SMS заложены адаптерами за env-флагами (решение ПО: SMS отложен до ключей).

**Спека:** `2026-07-08-gri-pulse-crm-design.md` §3 (синк) + §5 (каналы) + решения ПО (§0 таблица) + довесок №9 (GRI-инсайт в дайджест).

## ПРОВЕРЕННЫЕ ФАКТЫ (разведка Фаз 1-2)
- Cron `/api/api/cron/crm-digest` уже собирает просроченные напоминания + спящих per user и пишет in-app (`createNotification`, категория `crm`); guard CRON_SECRET; vercel.json cron 04:00 UTC. Расширять — его.
- `lib/email.ts`: `sendUserEmail` (Resend, брендированный шаблон, видимые ошибки). `lib/notifications.ts`: `notifyUser` читает `profiles.telegram_chat_id` — **колонки НЕТ в миграциях** (select падает в catch → Telegram-канал молча мёртв); UI привязки chat_id не существует.
- `profiles.preferences.notifications.<category>.{in_app,email,telegram}` пишется настройками, но при отправке НЕ читается (только in_app для crm уже уважается в cron). Тумблера категории `crm` в SettingsClient нет (follow-up #3 ревью Блока D Фазы 2).
- Telegram-инфра: `TELEGRAM_BOT_TOKEN` env, api.telegram.org sendMessage хелперы есть (lib/notifications.ts, escalation-адаптеры). Входящего webhook НЕТ.
- CRM-клиенты REST: `lib/crm/bitrix24.ts` (webhook/OAuth-токен, crm.deal.list/contact.list, testConnection), `lib/crm/amocrm.ts` (API v4 Bearer), единые типы `lib/crm/types.ts`. РАБОЧИЕ.
- Мёртвый стек: Prisma `crm_integrations` + `lib/crm/auth.ts` (`requireCrmOrg` всегда null → все /api/crm 403); `CrmIntegrationTab` в pulse/page.tsx (вкладка «CRM») — UI готов, бэкенд 403.
- **Межарендная утечка**: `/api/pulse` и `/api/pulse/briefing` берут `prisma.crmIntegration.findFirst({isActive:true})` БЕЗ скоупа — первая подключённая CRM видна всем staff. Чинить в 4B.
- Наша база: `crm_clients` (уникальный телефон per user, source), `lib/crm/phone.ts` normalizePhone, импорт-паттерн батчами (см. clients/import). RLS own.
- Миграции: следующий номер **045**; `node scripts/apply-migration.js`; snake_case; RLS-шаблон 027/042; NOTIFY pgrst.
- WhatsApp Cloud API клиент есть (lib/assistant/escalation/whatsapp-adapter.ts), но исходящие клиентам вне 24ч-окна требуют approved-шаблонов Meta — только за флагом. SMS-провайдера нет — только интерфейс.

## Батч 4A — Email + Telegram дайджест (Tasks 1-4)

### Task 1: Миграция 045 — telegram-привязка
`supabase/migrations/045_profiles_telegram.sql`: `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT; ADD COLUMN IF NOT EXISTS telegram_link_code TEXT; CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_tg_link_code ON public.profiles(telegram_link_code) WHERE telegram_link_code IS NOT NULL;` (+ комментарии). Идемпотентно, NOTIFY. Применить локально. Commit.

### Task 2: Привязка Telegram (deep-link + webhook)
- `app/api/v1/settings/telegram/route.ts`: POST «сгенерировать код» (сессия → случайный код 12 hex → сохранить в profiles.telegram_link_code, вернуть `https://t.me/<BOT_USERNAME>?start=<code>`; BOT_USERNAME из env `TELEGRAM_BOT_USERNAME`); DELETE «отвязать» (telegram_chat_id=null). Проверять затронутые строки.
- `app/api/telegram/webhook/route.ts`: POST от Telegram (защита: секрет в пути или `X-Telegram-Bot-Api-Secret-Token` из env `TELEGRAM_WEBHOOK_SECRET`); на `/start <code>` — service-role найти профиль по link_code → записать chat_id, очистить код, отправить подтверждение в чат («Готово! Сюда будут приходить напоминания»). Незнакомый код → вежливый отказ.
- SettingsClient: кнопка «Привязать Telegram» (открывает t.me-ссылку) / статус «привязан» + «Отвязать» + **тумблер категории `crm`** (закрывает follow-up #3). Точечные правки, не перелопачивать настройки.

### Task 3: Мультиканальный дайджест + GRI-инсайт
Расширить `app/api/cron/crm-digest/route.ts`:
- Батч-читать профили (email, telegram_chat_id, preferences) — уже есть prefs-чтение, добавить поля.
- Каналы per user: in_app (как сейчас), email — если `preferences.notifications.crm.email !== false` и есть email (sendUserEmail, тема «Кому позвонить сегодня», список до 5 позиций + ссылка), telegram — если `.telegram !== false` и есть chat_id (sendMessage HTML).
- **GRI-инсайт недели** (довесок №9): если у пользователя есть текущая диагностика — самый слабый блок из section_avgs → одна строка «Слабый блок: X (N/10) — 1 действие» в тело дайджеста (по каналам). Дешёвый запрос батчем к gri_assessments (is_current, .in(user_id)).
- Fire-and-forget с per-user try/catch; счётчики {emailsSent, telegramSent} в ответ. Чанки по 25 как сейчас.

### Task 4: Тесты + ревью-верификация 4A
Юнит: чистые хелперы (сборка текста дайджеста, выбор каналов из prefs). Smoke: webhook отклоняет без секрета; settings/telegram 401 без сессии. Vitest весь зелёный. Commit-ы по задачам. Затем объединённое ревью батча (спек+качество) и фиксы.

## Батч 4B — Синк AmoCRM/Bitrix24 (Tasks 5-7)

### Task 5: Миграция 046 — crm_provider_connections
Таблица: id uuid pk, user_id FK auth.users CASCADE, provider TEXT CHECK ('bitrix24','amocrm'), base_url TEXT, access_token TEXT, connection_name TEXT, is_active bool default true, last_sync_at timestamptz, last_sync_status TEXT, synced_deals int, synced_contacts int, created_at/updated_at. UNIQUE(user_id, provider). RLS own CRUD (staff-read НЕ нужен — чужие креды никому). Идемпотентно, NOTIFY. Применить. Commit.
(Токены пока plaintext как в legacy — отметить в PR известным ограничением; шифрование — отдельная задача Фазы 6+.)

### Task 6: API подключений + реальный импорт
- `app/api/v1/crm/connections/route.ts`: GET (own список без токенов!), POST (validate provider/base_url/token → testConnection через lib/crm/bitrix24|amocrm → upsert по (user_id,provider)), DELETE `[id]` (own).
- `app/api/v1/crm/connections/[id]/sync/route.ts`: POST — own connection → fetch контакты+сделки (клиенты уже есть) → маппинг в ClientDraft (имя, телефон normalizePhone, email, avg_check из суммы сделки, source=provider) → upsert в `crm_clients` по (user_id, phone) чанками по 200 (паттерн import-роута) → обновить last_sync_* + вернуть {inserted, updated, skipped}. Лимит 500 записей за синк, таймауты клиентов уже стоят.
- **Фикс утечки**: `/api/pulse` и `/api/pulse/briefing` — убрать `prisma.crmIntegration.findFirst` полностью (todayClients уже с /api/v1/crm/today; briefing перевести на снимок own crm_clients). `lib/crm/auth.ts` + Prisma-пути пометить deprecated-комментарием (не удалять Prisma-модель — вне скоупа).

### Task 7: UI + ревью 4B
CrmIntegrationTab (вкладка «CRM» на /pulse): переподключить на /api/v1/crm/connections (+sync кнопка с прогрессом и тостом {inserted,updated,skipped}); формы уже есть. Верификация в превью (подключение с фейковым токеном → честная ошибка testConnection; UI не 403). Объединённое ревью батча + фиксы.

## Батч 4C — Флаговые адаптеры + верификация фазы (Tasks 8-9)

### Task 8: Каналы за флагами
`lib/crm/digest-channels.ts`: интерфейс `DigestChannel {isEnabled(user):boolean; send(user, digest):Promise<void>}`; реализации: whatsapp (reuse Cloud API клиент; enabled только при WHATSAPP_TOKEN+WHATSAPP_PHONE_NUMBER_ID+`CRM_DIGEST_WHATSAPP='1'` И телефоне пользователя в E.164; текст-шаблон с оговоркой про 24ч-окно в комменте), sms (интерфейс + заглушка `SmsProvider` c провайдером 'none' — честный no-op с console.warn once; ключей нет — решение ПО). Подключить в cron fan-out ПОСЛЕ email/telegram. Push НЕ делаем (отложен, задокументировать).

### Task 9: Верификация Фазы 4
Email-дайджест приходит (тест на свой ящик через Resend локально или мок), Telegram: полный цикл привязки на тестовом боте если токен есть локально, иначе smoke-тесты webhook; синк с реальным sandbox-CRM недоступен — верифицировать testConnection-ошибки и импорт-путь юнитами на маппинг. `npx vitest run && npm run lint` чисто. Финальный commit.

## Не делаем в Фазе 4
Web Push (VAPID) — отложен; шифрование токенов CRM; двусторонний синк (запись в CRM); OAuth-флоу Bitrix/Amo (только токен/webhook как в готовых клиентах); WhatsApp-шаблоны Meta (внешний процесс).
