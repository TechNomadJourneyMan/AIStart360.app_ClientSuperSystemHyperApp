# Архив: старая CRM на Prisma

**В архиве с 2026-11-18.** Решение PO: старую CRM «в архив». Ничего не удалено: код лежит здесь, таблица перенесена в схему `archive` базы.

## Что это было

Первая версия интеграции с Bitrix24 и amoCRM — стек NextAuth/Prisma, всё по организации (`orgId`):

- `/api/crm` (GET / POST / DELETE подключений) и `/api/crm/sync`;
- `lib/crm/auth.ts` (`requireCrmOrg`);
- модель Prisma `CrmIntegration` (таблица `crm_integrations`);
- ветка CRM-сделок в `GET /api/pulse`;
- хук `usePulse`;
- модальное окно `CRMConnectModal`.

К моменту архивации стек был мёртв:

- `requireCrmOrg` всегда возвращал `null` — у пользователей Supabase нет организации Prisma, поэтому `/api/crm*` отвечали 403;
- в `/api/pulse` поиск подключения был заменён на `null` после утечки между арендаторами (Фаза 4B);
- `usePulse` и `CRMConnectModal` нигде не подключались.

Живая CRM владельца — другая. Это таблицы `crm_clients`, `crm_interactions`, `crm_reminders` и `crm_provider_connections` (миграции 044 и 046), API `/api/v1/crm/*` и раздел «Клиенты (CRM)» на `/pulse`.

## Где что лежит

| Было | Теперь |
|---|---|
| `app/api/crm/route.ts` | `archive/legacy-prisma-crm/app/api/crm/route.ts` |
| `app/api/crm/sync/route.ts` | `archive/legacy-prisma-crm/app/api/crm/sync/route.ts` |
| `lib/crm/auth.ts` | `archive/legacy-prisma-crm/lib/crm/auth.ts` |
| `components/dashboard/CRMConnectModal.tsx` | `archive/legacy-prisma-crm/components/dashboard/CRMConnectModal.tsx` |
| `hooks/usePulse.ts` | `archive/legacy-prisma-crm/hooks/usePulse.ts` |
| модель `CrmIntegration` в `prisma/schema.prisma` | `archive/legacy-prisma-crm/prisma/CrmIntegration.prisma` |
| `app/api/pulse/route.ts` с веткой CRM-сделок | `archive/legacy-prisma-crm/app/api/pulse/route.with-crm-branch.ts` (файл целиком, версия main `1273ec0d`) |
| таблица `public.crm_integrations` | `archive.crm_integrations` (миграция 156) |

Хелперы `syncAll()` в `lib/crm/bitrix24.ts` и `lib/crm/amocrm.ts` нужны были только этим маршрутам. Их прежний вид — в истории git, например `git show 1273ec0d:lib/crm/bitrix24.ts`.

Папка `archive/` не участвует в сборке: она исключена в `tsconfig.json`, `next lint` её не проверяет, vitest её не запускает. Импорты в архивных файлах указывают на старые пути и сейчас не собираются. Это снимок, а не рабочий код.

## База

Миграция `supabase/migrations/156_archive_legacy_crm_integrations.sql` переносит `public.crm_integrations` в схему `archive` вместе со строками, индексами и ключами (`ALTER TABLE … SET SCHEMA`).

Схема `archive` закрыта:

- PostgREST её не отдаёт;
- у `anon` и `authenticated` нет `USAGE`;
- читать её можно только через SQL от владельца базы или `service_role`.

На проде на 2026-11-18 там одна строка: подключение Bitrix24 от 2026-04-10, последняя синхронизация 2026-05-19 со статусом `partial`, 0 сделок. **Токен и адрес входящего вебхука хранятся открытым текстом.** Отозвать вебхук может только администратор портала Bitrix24: в Bitrix24 → Разработчикам → Входящие вебхуки.

Загрузка staging восстанавливает только схемы `public` и `market`, поэтому архивная таблица в staging не попадает. Скрипты `scripts/staging/*.sql` работают с таблицей и без неё.

## Как вернуть

1. База: `psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/156_archive_legacy_crm_integrations.down.sql`. Таблица вернётся в `public`, по-прежнему закрытая от API.
2. Код: перенести файлы из таблицы выше обратно по прежним путям (`git mv`), вернуть модель в `prisma/schema.prisma` вместе с обратной связью `crmIntegrations CrmIntegration[]` в `Organization` и строки `/api/crm`, `/api/crm/sync` в `tests/contracts/route-auth.manifest.ts`.

Работать после возврата он всё равно не будет: у пользователей Supabase нет организации Prisma.
