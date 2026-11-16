# R3-AUDIT-C: реестр Раунда 0 и текущий код (P0–P2)

Дата: 2026-11-15. Аудитор R3-C, только чтение: код не менялся, коммитов нет, к базам и переменным Railway не подключался.

**База сверки.** Worktree стоит на `3142d8d6` (ветка `claude/self-hosted-inngest`). `git diff 3142d8d6 30df0055` пуст, поэтому дерево совпадает с main `30df0055` (PR #28). Сделанное в раундах — это `git log 1344cde1..30df0055`, 18 коммитов: `d8d6403c`, Раунд 1 (`38a34ce3`…`3f812f14`, PR #26), Раунд 2 (`4792f703`…`ebb148dd`, PR #27), свой Inngest (`3142d8d6`, PR #28). Изменено 744 файла, из них 213 тестов, и добавлены миграции 140–149.

**Метод.** Для каждой записи P0, P1 (вместе с «P1 ⛔») и P2 я открывал место из поля `where` и смотрел, что там сейчас. Затем искал маркеры `R-xxx`, `SR-xx`, `BI-xx` в коде и тестах и проверял, есть ли тест. Отчёты исполнителей служили только картой. Состояние прода (настройки ГИГА, видимость разделов, число экспертов) я в базе не проверял: эти сведения взяты из памяти проекта и помечены «по памяти». Точку А и Точку Б подробно разбирают R3-A и R3-B, поэтому их записи здесь оценены кратко.

## 1. Итог в цифрах

| Приоритет | Всего | Исправлено | Частично | Открыто | Неактуально |
|---|---|---|---|---|---|
| P0 | 3 | 2 | 1 | 0 | 0 |
| P1 (вместе с «P1 ⛔», их 6) | 43 | 22 | 12 | 8 | 1 |
| P2 | 83 | 13 | 9 | 61 | 0 |
| **Итого P0–P2** | **129** | **37** | **22** | **69** | **1** |

Главное:

- **Раунды 1–2 закрыли почти весь доступ и 2FA (K3) и честные числа Точки А и GRI (K1).** Исправлены R-002, R-003, R-005–R-008, R-030, R-032–R-036, R-047, R-048 и R-052. Почти все исправления закреплены тестами. Закрыты и дедлайны ИИ и Supabase-транспорта (R-014, R-016, R-017), лимиты Inngest (R-064, R-065), CSP (R-013) и `next build` в CI (R-127).
- **Остаток P1 (20 записей) почти весь упирается в инфраструктуру, процесс или решения PO, а не в код кабинета.** Это схема БД против прода (R-012), внешний мониторинг (R-018), защита main и деплой (R-019), e2e и RLS-тесты (R-044–R-046), одна оболочка и входы (R-028, R-029), видимость разделов и эксперты на проде (R-022, R-024), бэкап вне Railway (R-011), юридическая часть (R-043) и перенос моста и «Рынка» с ноутбука PO (R-021).
- **В P2 открыта 61 запись.** По кластерам:
  - K13, расчётные модели — 10; из них 6 относятся к Точкам А и Б и уходят к R3-A и R3-B;
  - K9, дизайн-система и доступность — 8 (ещё 1 частично);
  - K1, числа на экранах — 7 (ещё 1 частично);
  - K2, навигация — 6;
  - K16, скорость — 5;
  - K10, продукт — 5;
  - K6, схема и миграции — 4 (ещё 2 частично);
  - K12, легаси — 4.
- **Две P1 закрыты только «на бумаге»: в коде всё готово, но на проде они не действуют без шага PO.**
  - R-004: 2FA в RLS включается только при `staff_require_mfa` или если у сотрудника есть свой фактор. На проде настройка не задана, у персонала 2FA нет.
  - R-022: честный пейволл есть, но на проде в `platform_sections` Точка А/Б видны только сегменту tier_pro, а «Рынок» — только персоналу (staff_only). Поэтому Free не видит ни пунктов меню, ни пейволла.

## 2. Таблица статусов

Обозначения: «исправлено» — исправление есть в коде и, где указано, закреплено тестом; **частично** — что осталось, написано в последнем столбце; **открыто** — в коде ничего не менялось; «неактуально» — снято решением PO. Кл. — кластер первопричин из реестра.

### P0

| R-ID | P | Кл. | Суть | Статус | Доказательство | Что осталось |
|---|---|---|---|---|---|---|
| R-001 | P0 | K11 | Пароль облачной резервной БД лежит в публичном репозитории (проект `tpxw…`, пулер… | **частично** | `d8d6403c` — строка в `docs/audit-2026-07-07/02-security-auth-rls.md:21` замаскирована | Пароль остаётся в истории git; репозиторий **публичный** (GitHub API: visibility=public). Сменить пароль резервной БД `tpxw…`, решить судьбу проекта, filter-repo — PO |
| R-002 | P0 | K3 | RLS-функции `current_user_role()` и `is_platform_staff()` берут права из legacy-колонки… | исправлено | миграции `140_staff_rls_from_staff_roles.sql` (+`143`), на проде с 14.11; `tests/integration/db/staff-rls-scope.test.ts`; staff_roles=admin выдан (решение PO) | — |
| R-003 | P0 | K3 | Факторами 2FA можно управлять без step-up. (1) Новый passkey регистрируется без… | исправлено | `lib/mfa/factor-guard.ts` (guardFactorChange/lastFactorRefusal) во всех 6 маршрутах `app/api/v1/security/*`; первый фактор — `register/verify/route.ts:100-111`; `tests/unit/api/security-factor-stepup.test.ts` | Письма владельцу о смене фактора нет (есть только `logActivity` severity=critical) |

### P1

| R-ID | P | Кл. | Суть | Статус | Доказательство | Что осталось |
|---|---|---|---|---|---|---|
| R-004 | P1 | K3 | В RLS персонал читает все компании без скоупа и без 2FA. `can_read_company()` открывает… | **частично** | `140`: `staff_can_read_company()` по client_scope/user_assignments; `143`: `staff_session_ok()` (`143_staff_mfa_sessions.sql:90-135`); `staff-mfa-sessions.test.ts` | MFA-часть в RLS включается только при `staff_require_mfa` или личном факторе. На проде (по памяти 14.11) настройка не задана, у персонала 2FA нет → по паролю+anon-ключу персонал читает своих клиентов в PostgREST. Нужно: персонал подключает 2FA, PO включает `staff_require_mfa` |
| R-005 | P1 | K3 | Второй фактор проверяется только middleware страниц и staff-guard'ами. В `/api/v1/*`,… | исправлено | `lib/api-identity.ts:35-116` (getSessionRole/getSessionStaff/mayActOnUser → `lib/mfa/api-staff-gate.ts`); `tests/unit/api/api-identity-staff-stepup.test.ts` | Действует для персонала; для клиента с личной 2FA API шаг не требует (низкий риск). Эффект на проде — после включения 2FA (см. R-004) |
| R-006 | P1 | K3 | Правило «эксперт видит только назначенных клиентов» не соблюдается. Любой эксперт (даже… | исправлено | SR-03: `lib/expert-auth.ts:103-201` (approved + guardExpertClient), `app/api/expert/clients/route.ts:65-94` (только назначенные), `app/api/share/route.ts` (TTL `SHARE_DEFAULT_TTL_DAYS`), `lib/documents/file-access.ts:97-106`; `tests/unit/access/actor-scope-routes.test.ts` | — |
| R-007 | P1 | K3 | `PATCH /api/giga-admin/requests/:id`: если такого id нет в `admin_requests`, он считается… | исправлено | `lib/users/access-requests.ts:25-114` (допустимые переходы + canManageTarget), `lib/admin/request-decision.ts:46-59`; `tests/unit/giga-admin/request-decision-r007.test.ts` | — |
| R-008 | P1 | K3 | Ограничения impersonation (только просмотр, TTL, аудит) держатся на одном cookie… | исправлено | `app/api/v1/impersonation/exit/route.ts:10` (scope local), серверная привязка сессии `lib/impersonation/state-edge.ts:81-91`; тесты `sr06-*`, `sr07-*`, `giga-crm/impersonation-session.test.ts` | — |
| R-009 | P1 | K3 | Регистрация без подтверждения e-mail (`email_confirm: true`) и автоодобрение.… | **частично** | Приглашения — только по токену (`lib/admin/invites.ts:26-164`, SR-04), сброс пароля при принятии; `tests/unit/auth/sr04-*.test.ts` | Регистрация по-прежнему `email_confirm: true` без подтверждения почты (`app/api/auth/register/route.ts:63-67`) + автоодобрение (`:98-109`) |
| R-010 | P1 | K11 | Локальная разработка, тесты и dev-вход работают на облачной резервной копии, которую… | **частично** | `tests/helpers/env-setup.ts`, `test-env-guard.ts`, `network-guard.ts`, `scripts/test-db/setup.mjs:32-49` (только локальный хост); staging с обезличенной копией (`scripts/staging/*`, `docs/staging/README.md`); `tests/contracts/hermetic-test-env.test.ts` | `scripts/apply-migration.js` не менялся: берёт `DIRECT_URL` из `.env*` без печати хоста и `--yes` (`:43-66`). ПДн в облачной резервной копии — решение PO |
| R-011 | P1 | K8 | Бэкап — только ежедневный `pg_dump` в бакет у того же провайдера. Скрипта нет в… | **частично** | `scripts/backup/railway-db-backup.sh` (3 раза в сутки, Storage через rclone), `restore-drill.sh`, `142_ops_backup_runs.sql`, сторож `lib/ops/backup-freshness.ts` + `/api/cron/backup-freshness`; `tests/unit/ops/backup-freshness.test.ts`, `tests/integration/db/backup.test.ts` | Копии у другого провайдера нет (VPS в КЗ — PO арендует), PITR нет (тариф — PO), база `inngest` на Postgres-sfat не в бэкапе, регулярное учение восстановления не заведено |
| R-012 | P1 | K6 | Репозиторий не воспроизводит прод. Объекты создавались вне миграций (`companies` с TEXT… | **открыто** | `scripts/test-db/setup.mjs` изменён только в части локального хоста; adopt-миграций нет | Снять `pg_dump --schema-only` прода/staging и сделать diff; adopt-миграция для таблиц вне миграций; ежедневная проверка «таблица без RLS / грант anon» |
| R-013 | P1 ⛔ | K8 | В прод-CSP `connect-src` разрешён только `https://*.supabase.co`; своего… | исправлено | `lib/security/csp.mjs`, `next.config.mjs:64-122` (origin из `NEXT_PUBLIC_SUPABASE_URL` + wss, без `*.supabase.co`); `tests/unit/security/csp.test.ts`; `docs/deploy/csp.md` | Адрес «Рынка» в сборке — см. R-069 |
| R-014 | P1 | K4 | У Supabase-транспорта нет таймаута ни на попытку, ни на запрос целиком. Если внутренний… | исправлено | `lib/supabase/transport.ts:15-67,221-322` (таймаут попытки 15 с, дедлайн 25 с, переход на публичный путь); `tests/unit/supabase/transport.test.ts` | — |
| R-015 | P1 | K4 | `export const maxDuration` действует только на Vercel. На Railway (`next start`) у… | **частично** | `lib/runtime/deadline.ts` (withDeadline + фоновый дедлайн); обёрнуты 4 маршрута: `v1/assistant/analyze`, `v1/diagnostics/ai-analyze`, `v1/diagnostics/point-b/ai-generate`, `v1/documents`; `tests/unit/runtime/deadline.test.ts` | Ещё 14 маршрутов с maxDuration 120–300 без дедлайна: `cron/agents`, `cron/ai-discovery`, `giga-admin/agents/[key]/run`, `ai-providers/discover`, `inngest`, `internal/agents/kick`, `telegram/{admin,expert}`, `v1/onboarding/documents*`, `webhooks/{meta,telegram-inbox,whatsapp-web,whatsapp-web/drain}` |
| R-016 | P1 | K4 | У цепочки failover ИИ нет общего дедлайна: до 4 попыток по 45–60 с, то есть до 180–240 с… | исправлено | `lib/ai/providers/failover.ts:22-150` (один бюджет на цепочку), `gateway.ts:185` (фон), `openrouter.ts:233` (пользователь); `tests/unit/ai/failover-deadline.test.ts` | SSE только в ассистенте (не расширяли) |
| R-017 | P1 | K4 | `POST /api/internal/agents/kick` сразу запускает задачу в фоне, глобального семафора нет.… | исправлено | `lib/agents/run-slots.ts`, `lib/agents/queue.ts:93-207`; `tests/unit/agents/run-slots.test.ts` | — |
| R-018 | P1 ⛔ | K5 | Нет внешнего uptime-мониторинга, трекера ошибок и алерта «платформа лежит»: агент… | **открыто** | Изменений нет: `app/api/health*`, агент `monitoring` внутри платформы. Есть только алерт свежести бэкапа (R-011) | Внешний uptime-пинг + алерт, трекер ошибок, smoke после деплоя, ИИ-probe — нужен выбор сервисов PO |
| R-019 | P1 | K7 | main без branch protection, CI не обязателен. Railway собирает main независимо от CI.… | **частично** | `.github/workflows/ci.yml:51-74` — `next build` в CI | main без защиты (GitHub API: «Branch not protected»), репозиторий публичный, деплой — `railway up` с Mac, GitHub к Railway не подключён, runbook отката деплоя нет |
| R-020 | P1 | K8 | По памяти проекта `railway.json` перестанет работать 01.12.2026 | **частично** | `.railway/railway.ts`, `docs/deploy/railway-config.md`: сервис portal `railway.json` не читает (настройки в сервисе) → 01.12 для портала ничего не меняется; `tests/unit/infra/railway-iac.test.ts` | Проверить сервис `agents` (шаг 1 документа); `railway config apply` — по решению PO |
| R-021 | P1 | K8 | Мост WhatsApp (launchd), Mark-analytics, деплой и ручной дамп 05.11 живут на ноутбуке PO | **открыто** | Без изменений | Решение PO (Q19): перенос моста WhatsApp и Mark-analytics на Railway |
| R-022 | P1 ⛔ | K10 | В «Разделах и видимости» (данные прода в копии) Точка А и Точка Б с 20.10 видны только… | **частично** | R2-A: одно решение о доступе `lib/access/decision.ts`, `Paywall`/`FeatureGate`, 402 в API, заявки (144), RLS по тарифу (147, 148); `tests/unit/access/*` (25 файлов), `paid-sections-rls.test.ts` | На проде (по памяти 15.11) в `platform_sections` Точка А/Б видны только сегменту tier_pro, Рынок — staff_only: Free не видит ни пунктов, ни пейволла. Открыть видимость — действие PO |
| R-023 | P1 ⛔ | K10 | Режим техработ работает по принципу «всё или ничего»: пропускает только staff и «вход от… | неактуально | Решение PO 14.11: техработы сняты целиком, пилот-списка не нужно (`middleware.ts` по-прежнему «всё или ничего») | Вернуться, только если снова понадобятся техработы с пилотом |
| R-024 | P1 | K10 | Цепочка «ИИ предлагает — эксперт утверждает» построена, но людей и SLA нет. На 18.10… | **частично** | R2-B: `lib/expert-sla/*`, миграции 145/146/149, крон `/api/cron/expert-sla` */5 (`lib/cron/schedule.ts:43`), ГИГА «SLA экспертов»; `tests/unit/expert-sla/*`, `tests/integration/db/expert-sla.test.ts` | Одобренных экспертов на проде 0 (по памяти 15.11; люди — PO); в «Сообщениях» клиента нет карточки «кто и когда ответит»; текст Гри «48 ч» — ждёт «да» PO |
| R-025 | P1 ⛔ | K10 | Опубликованный экспертом отчёт (PDF, ссылка на версию) клиент в новом кабинете не видит.… | исправлено | `components/point-a-v4/PointAV4Page.tsx:131-132` (PublishedReports), `app/client/home/page.tsx:44,131` (ReportReadyCard); уведомление клиенту `lib/reports/review-flow.ts:373-404`; `tests/unit/components/ReportReadyCard.test.ts` | Кнопки «Поделиться» (ShareButtonAuto point_a) в v4 нет |
| R-026 | P1 | K10 | Напоминания (`/api/cron/reminders`) и дайджест (`client-digest`) не проверяют режим… | исправлено | `lib/automation/maintenance-gate.ts`, `reminders.ts:381`, `client-digest.ts:151`; `tests/unit/automation/maintenance-skip.test.ts` | — |
| R-027 | P1 ⛔ | K8 | Режимы анкеты (экспресс + блоки, беседа с ИИ) включает флаг сборки… | **открыто** | `lib/survey/modes.ts:67-86` — режимы всё ещё из флага сборки `NEXT_PUBLIC_SURVEY_MODES` | Перевести на серверную настройку ГИГА; от флага зависит и мастер Free → «Снимок бизнеса» (R2) |
| R-028 | P1 | K2 | Две клиентские оболочки. Пункты нового меню «Дашборд» и «GRI», «Настройки» в меню профиля… | **открыто** | `lib/client-shell/nav.ts:42,47`: «Дашборд» → `/dashboard`, «GRI» → `/gri` (старая оболочка) | Быстрый шаг (ClientNav в `(dashboard)/layout.tsx` для клиента), потом перенос в `/client/*` с редиректами (Q14) |
| R-029 | P1 | K2 | Нет единой точки приземления. После одобрения: waiting-room → `/client/welcome` → (строка… | **частично** | Вход формой — по роли: `components/auth-home/LoginForm.tsx:63` (postLoginPath), регистрация — `RegisterForm.tsx:43` | Остались `/dashboard`: `middleware.ts:641` (клиент на /login), `app/client/welcome/page.tsx:92,202`, `app/not-found.tsx:24`, `app/auth/verify/route.ts:21`, `app/auth/callback/route.ts:20`; `RouteError` → `/` (`components/common/RouteError.tsx:38`) |
| R-030 | P1 | K10 | Старые меню запирают Метрики, Рынок и Точку Б «PRO»: десктоп-сайдбар не учитывает… | исправлено | `hooks/useEntitlements.ts:53-91` (isSectionLocked с gatesEnabled), `Sidebar.tsx`, `MobileNav.tsx:90-149`; `tests/unit/layout/premium-locks.test.ts` | — |
| R-031 | P1 | K10 | Полная анкета: 12 шагов, 171 вопрос, ~84 мин (с поиском данных 2,5–4 ч). На шаге 8… | **открыто** | `app/client/onboarding/page.tsx` не менялся | Продуктовые решения (экспресс по умолчанию, разбивка «Ключевых метрик», сроки, «готовность к оценке N %») — к R3-A и PO |
| R-032 | P1 | K1 | После отправки полной анкеты общий балл, стадия и индекс здоровья считаются по любому… | исправлено | `lib/point-a/v4/engine.ts:176-204` (overallAllowed, пороги в `config.ts` — временные); `tests/unit/point-a-v4/r032-overall-rule.test.ts` | Пороги утверждает эксперт (подробно — R3-A) |
| R-033 | P1 | K1 | Когда у v4 нет общего балла, в `diagnostics` пишется v1, где неотвеченное = 0: блок без… | исправлено | `lib/point-a/official.ts` (getOfficialPointA, 28 файлов-читателей), фолбэка `?? calculatePointA` нет; `tests/unit/point-a/official-readers-golden.test.ts` | Подробно — R3-A |
| R-034 | P1 | K1 | Пайплайн агентов `scoreCompany` пересчитывает v1 уже при одном ответе и, если текущая… | исправлено | `lib/diagnostics/scoring.ts:4,82,192,241` (только через снимок); `tests/unit/diagnostics/scoring-official.test.ts` | — |
| R-035 | P1 | K1 | «Следующий шаг» берёт только блоки `weak` (30–49), а `critical` (<30) никогда. Без… | исправлено | `app/api/v1/nba/route.ts:125-139` (critical+weak, без данных — исключены); `tests/unit/api/nba-route-point-a.test.ts` | — |
| R-036 | P1 | K1 | Один индекс GRI показан в трёх шкалах. Лендинг и клиент — 0–10 (цель 8.5+ у клиента, ≥7… | исправлено | `lib/format/gri.ts` (одна шкала/зоны), `lib/gri/mini.ts:35`, `lib/analytics-data.ts:121-133`; `tests/unit/format/gri.test.ts`, `tests/unit/gri/official-golden.test.ts` | Два набора ориентиров — R-083 |
| R-037 | P1 | K13 | В Точке Б V2 (вкладка «Подробности», PDF, шаринг) годовой run-rate показан как «Выручка… | исправлено | `lib/point-b/engine.ts` (run-rate/12, квартал), `HorizonPlans.tsx`; `tests/unit/point-b/r037-horizon-units.test.ts` | Подробно — R3-B |
| R-038 | P1 | K13 | «Что если → Средний чек»: себестоимость = выручка × (1 − маржа) при постоянной марже,… | исправлено | `lib/point-b/model/cash.ts` (cogsPath), `whatif.ts`, `scenarios.ts`; `tests/unit/point-b/r038-whatif-price-cogs.test.ts` | Подробно — R3-B |
| R-039 | P1 | K13 | «Реалистичный» темп симулятора равен темпу, нужному для цели, с `confidence='high'`. При… | исправлено | `lib/simulator/core.ts`; `tests/unit/simulator/r039-honest-base.test.ts`, `r039-route-history.test.ts` | — |
| R-040 | P1 | K13 | Прогноз в окне метрики (включён по умолчанию, открывается из Точки А) строится по… | исправлено | `lib/metrics/*` (бизнес-периоды); `tests/unit/metrics/r040-forecast-business-periods.test.ts`, `tests/unit/api/metrics-forecast-status-r040.test.ts` | — |
| R-041 | P1 | K13 | revenue-audit подставляет любой клинике минимум 300 визитов/мес, чек по умолчанию 10 000,… | исправлено | `lib/revenue-audit.ts:8` (без пола 300); `tests/unit/medical/revenue-audit.test.ts` | Ставки no-show/upsell (`:117`) остаются константами-гипотезами |
| R-042 | P1 | K13 | RFM: `Date.parse` идёт раньше разбора ДД.ММ.ГГГГ, поэтому «03.04.2026» читается как 4… | исправлено | `lib/rfm-segmentation.ts:17` (parseDayFirstDate), `lib/data-quality.ts`; `tests/unit/medical/rfm-segmentation.test.ts`, `data-quality.test.ts` | — |
| R-043 | P1 | K11 | База и сервисы на Railway в Нидерландах (ams), ИИ — OpenRouter (зарубежный) и Alem. Закон… | **открыто** | Решение PO 14.11: ПДн пока в Амстердаме, KZ-сервер позже | Юридическая проверка до коммерческого запуска (Q16) — PO/юрист |
| R-044 | P1 | K7 | Нет ни одного e2e основного пути клиента, эксперта и админа. Существующие 3 spec (12… | **открыто** | `tests/e2e/*` не менялись (journey, giga-agents, giga-providers); в CI не запускаются | Набор E1–E10 на staging (staging уже есть — предпосылка выполнена) |
| R-045 | P1 | K7 | Для всех таблиц миграций 110–139 (pb_*, point_a_*, pa_*, metric_facts/overrides,… | **частично** | RLS на настоящей БД: `staff-rls-scope.test.ts`, `staff-mfa-sessions.test.ts`, `paid-sections-rls.test.ts`, `paid-access-one-rule.test.ts` (companies, diagnostics, documents, survey_answers, point_a_snapshots, action_items, report_versions…) | pb_*, pa_*, point_a_values/sources, metric_facts/overrides, data_discrepancies, ai_pending_actions, comm_*, kb_articles — по-прежнему только regex по SQL |
| R-046 | P1 | K7 | 181 из 434 API-маршрутов (41,7 %) не упоминаются ни в одном тесте: 2FA/WebAuthn, заявки и… | **частично** | `tests/contracts/route-auth-matrix.test.ts` + `route-auth.manifest.ts` (444 записи на 443 маршрута, 0 UNKNOWN; новый маршрут без записи валит CI) | Проверка статическая (есть ли вызов guard в файле); вызовов «без сессии → 401, client → 403» нет; контрактные тесты — лишь для части маршрутов |

### P2

| R-ID | P | Кл. | Суть | Статус | Доказательство | Что осталось |
|---|---|---|---|---|---|---|
| R-047 | P2 | K3 | В ГИГА скоуп «assigned» не соблюдается: `guardClientAccess` вызывается вручную и во… | исправлено | `lib/admin/client-scope.ts` (requireGigaCompany/requireGigaReport/scopedCompanyIds), `users/[id]/*`, `reports/*`, `requests/[id]/*` (authorizeUserDataRead), `lib/admin/bulk-users.ts:112-116`; `tests/unit/giga-admin/client-scope-routes.test.ts` | — |
| R-048 | P2 | K3 | Ранги RBAC (`forbidTarget`, `canManageTarget`) видят только `staff_roles`: эксперт по… | исправлено | `lib/admin/rbac.ts:195-245` (ранг цели по profiles.role, canImpersonate только клиента), `impersonation/route.ts:115`; `tests/unit/giga-crm/rbac-target-rank.test.ts` | — |
| R-049 | P2 | K15 | IP для rate-limit берётся из первого значения `X-Forwarded-For`, которое задаёт клиент; в… | **частично** | `lib/net/client-ip.ts` (доверенный hop, `TRUSTED_PROXY_HOPS`), `lib/rate-limit.ts:14`, `lib/admin/audit.ts:47`, `lib/activity/log.ts`; `tests/unit/net/client-ip.test.ts` | Лимитов по аккаунту/e-mail нет (`app/api/giga-admin/auth/route.ts:39` — только по IP); значение hops на проде не сверено с фактическим прокси Railway |
| R-050 | P2 | K3 | Публичный anon-ключ даёт прямой доступ к GoTrue и PostgREST self-hosted Supabase. Лимиты… | **открыто** | Конфига GoTrue/Kong в репозитории нет | `GOTRUE_DISABLE_SIGNUP`, `RATE_LIMIT_*`, закрыть `/pg` в Kong, Studio за паролем — настройки Railway (PO) |
| R-051 | P2 | K15 | Анонимный `POST /api/auth/demo-access` создаёт **одобренный** клиентский аккаунт (5 в… | **открыто** | `app/api/auth/demo-access/route.ts:47-118` без изменений (одобренный аккаунт, лимит только по IP); обход через XFF закрыт R-049 | Выключить на проде или CAPTCHA + глобальный лимит + нулевой ИИ-бюджет — решение PO |
| R-052 | P2 | K3 | Middleware не проверяет `pending_approval` клиента (только blocked/archived). Точка А и… | исправлено | `middleware.ts:153-161,708-721` (не одобренный клиент → зал ожидания); `tests/unit/auth/middleware-round1-security.test.ts` | — |
| R-053 | P2 | K15 | Массовое присваивание. (а) `client/register` пишет `profiles.email` из тела без сверки с… | **частично** | (а) `app/api/client/register/route.ts:69-85,180` (e-mail из auth, upsert, без тихого успеха), (б) `app/api/v1/onboarding/company/route.ts:13` (белый список); `tests/unit/api/client-register-r053.test.ts`, `onboarding-company-r053.test.ts` | (в) политика `companies_update_own` всё ещё даёт клиенту любые колонки (`partner_id`, status, цели) — колоночных грантов и триггера `updatedAt` нет |
| R-054 | P2 | K6 | `admin_purge_user` удаляет `survey_answer_history` до `DELETE profiles`, а AFTER-триггер… | **открыто** | `083_admin_purge_user.sql` не менялся | Перенос удаления истории после `DELETE auth.users`; чистка сирот — разрешение PO |
| R-055 | P2 | K6 | FK `profiles.approved_by` без `ON DELETE` (NO ACTION). `admin_purge_user` его не… | **открыто** | FK `profiles.approved_by` без ON DELETE (001:31) не менялся | Миграция `ON DELETE SET NULL NOT VALID` + VALIDATE |
| R-056 | P2 | K6 | Код запрашивает колонки, которых нет в схеме: `diagnostics.created_at` (есть… | **частично** | `app/api/giga-admin/clients/route.ts:48` (diagnostics без created_at), список заявок читает `"createdAt"` (`requests/route.ts:94`) | Мёртвый запрос `admin_requests ... order(created_at)` в `requests/route.ts:45-48`; `app/api/pulse/route.ts:306` выбирает `diagnostics.created_at`; колонки `companies` не сверены с продом; проверки «код ↔ схема» в CI нет |
| R-057 | P2 | K6 | `companies.id` — TEXT (есть не-UUID id), а `company_id` в `gri_pulse_responses`,… | **открыто** | Без изменений | Сверка `information_schema`/`pg_constraint` на staging (копия прода), затем ALTER TYPE + FK NOT VALID |
| R-058 | P2 | K6 | Процесс миграций небезопасен: 15 повторяющихся номеров (035, 036, 069×3, 070×3, 071–073,… | **частично** | Миграции 140–149 с `SET LOCAL lock_timeout/statement_timeout` и `rollback/*.down.sql`; `scripts/staging/apply-migration.sh:25` проверяет метку staging | `scripts/apply-migration.js` без печати цели, `--yes`, перезаписывает checksum; 15 повторяющихся номеров; нет `migrations-status` и CI-линта номеров |
| R-059 | P2 | K6 | `schema.prisma` описывает `companies` 7 полями (реально ~25), ~130 таблиц БД в Prisma… | **открыто** | `package.json` без guard для `prisma db push/migrate` | Guard-скрипты; удаление неиспользуемых моделей — разрешение PO |
| R-060 | P2 | K5 | Вебхуки WhatsApp-моста (8 маршрутов), Meta и Telegram-inbox возвращают 401/500/503 без… | **частично** | `lib/runtime/webhook-log.ts`; подключён в `webhooks/whatsapp-web/route.ts`, `meta`, `telegram-inbox/[connectionId]`, `kaspi`; `tests/unit/runtime/webhook-log.test.ts` | Нет в `whatsapp-web/drain`, `session`, `commands/{ack,claim}`, `outbound/{authorize,claim,result}` |
| R-061 | P2 | K5 | `fireAiFanOut` вызывает `/ai-analyze` и `/point-b/ai-generate` без таймаута, без… | исправлено | `lib/point-a/diagnostic-row.ts:84-212` (таймаут 150 с, trackBackground, лог `http_<status>`, перевод в failed); `tests/unit/point-a/fan-out.test.ts` | Проверки совпадения `INTERNAL_TOKEN_SECRET` при старте `agents` нет |
| R-062 | P2 | K5 | Inngest-функции с расписанием `*/5` и `*/15` (`comm-escalations`,… | исправлено | Причина: Inngest Cloud не вызывал портал. Свой Inngest (PR #28, `lib/inngest-target.ts`, `lib/functions/registry.ts:77-83`), SLA — на крон портала (`ebb148dd`); `tests/unit/functions/inngest-self-hosted.test.ts`; на проде 15.11 крон-функции Completed (память) | Алерта «функция не запускалась N часов» нет; ретенции строк в базе `inngest` и её бэкапа нет |
| R-063 | P2 | K5 | В ГИГА 12 из 12 агентов «включено», но запусков за 7 дней — 0, последний — 24 дня назад,… | **открыто** | Индикатора «не запускался N дней» нет (`components/giga-panel/agents/*` показывают только lastRunAt) | Проверить запуски агентов на проде после своего Inngest; индикатор + алерт; нулевые лимиты $0/день |
| R-064 | P2 | K4 | `concurrency: { limit: 1, key }` ограничивает 1 запуск на ключ, а по всем ключам… | исправлено | `lib/functions/point-a.ts:18`, `process-omnichannel-message.ts:977` (общий лимит + по ключу); `tests/unit/functions/inngest-limits.test.ts` | — |
| R-065 | P2 | K4 | Ни у одной из 18 функций нет `timeouts`; `maxDuration = 120` в… | исправлено | `timeouts` у всех 18 функций `lib/functions/*.ts`; `inngest-limits.test.ts` | — |
| R-066 | P2 | K4 | Если снимок `ai_*` не загрузился, роутер на 60 с кэширует пустой `EMPTY`, и все вызовы… | исправлено | `lib/ai/providers/router.ts:74-127` (lastGood, пустой не кэшируется); `tests/unit/ai/router-stale-while-error.test.ts` | — |
| R-067 | P2 | K12 | Фичи явно задают модели: Sonnet (narrative, extract, bind-fields, insights), Opus 4.8… | **открыто** | `lib/ai/openrouter.ts:46-54`, `lib/omnichannel/ai.ts:12` (`opus48` на все ответы омниканала), `lib/journey/orchestrator.ts:41` (`gpt-4o`) | Передавать tier вместо модели; противоречит решению PO «Claude → Alem/Qwen на всю платформу» |
| R-068 | P2 | K8 | Одна реплика Node на 8 vCPU: используется одно ядро. CPU-работа (PDF, xlsx, mammoth,… | **открыто** | `railway.json` / настройки сервиса: 1 реплика | Тариф и 2 реплики — PO (Q17); PDF/xlsx — в agents или worker_threads |
| R-069 | P2 | K8 | Раздел «Рынок» — iframe внешнего SPA Mark-analytics по `NEXT_PUBLIC_MARKET_APP_URL` (в… | **открыто** | В меню кабинета «Рынок» с замком (R2-C), на проде раздел staff_only; облачного Mark-analytics нет | Решение PO: деплой Mark-analytics на Railway или оставить скрытым |
| R-070 | P2 | K1 | Запасной путь `recalculate` (если снимок вернул null или нет компании) считает… | **частично** | `app/api/v1/diagnostics/recalculate/route.ts:100-123` (сбой снимка → 503, «занято» → 409, без компании — без балла) | Если компания есть, а снимок вернул не `written`/`busy` (напр. skipped по другой причине), всё ещё считается v1 с баллом и fan-out (`:126-160`) — к R3-A |
| R-071 | P2 | K1 | «Минимум для Точки А: X из N» не включает финансы (кроме безубыточности), продажи,… | **открыто** | `lib/survey/point-a-minimum.ts` не менялся | К R3-A |
| R-072 | P2 | K13 | Пороги проверок одинаковы для всех отраслей (маржа 15/8 %, сделок >50/год, цикл <30 дн. и… | **открыто** | `lib/point-a-engine.ts:395-567` не менялся | Пороги по отраслям — решение эксперта (Q5), к R3-A |
| R-073 | P2 | K13 | Год финансовых вопросов шага 9 зашит как 2024 (`SURVEY_KEY_YEAR`, `s9n_revenue_2024`); в… | **открыто** | `lib/data-layer/survey-periods.ts`, `lib/survey/questions.ts` не менялись (2024 зашит) | К R3-A |
| R-074 | P2 | K1 | На одной странице Точки Б два несовместимых вердикта: V2 оценивает по CAGR 3-летней цели… | **открыто** | V2 и модель по-прежнему с разными вердиктами (`lib/point-b/engine.ts`) | К R3-B; убрать V2-сценарии — разрешение PO |
| R-075 | P2 | K12 | Легаси-движок Точки Б (кабинет персонала `/clients/[id]/point-b`): цель = выручка ×… | **открыто** | Маршрут `app/api/clients/[id]/analysis/point-b/route.ts` теперь берёт официальную Точку А и скоуп эксперта, но считает легаси-движком `lib/point-b-engine.ts` | Перевести на `computeModel`; удаление движка — разрешение PO |
| R-076 | P2 | K13 | Декомпозиция роста по 4 рычагам — корень 4-й степени, хотя повторные продажи входят как… | **открыто** | `lib/point-b/engine.ts:673` — `Math.pow(mult, 1 / 4)` | К R3-B |
| R-077 | P2 | K13 | Если цель уже достигнута, а истории меньше 12 мес., вердикт — `no_data` («Пока нельзя… | исправлено | `lib/point-b/model/forecast.ts:86` (base ≥ target → reached до проверки истории); `tests/unit/point-b/bi26-bi28-verdict-margin.test.ts` | — |
| R-078 | P2 | K13 | Прогноз «при текущем ходе» стартует от годовой суммы, а не от run-rate: у растущих… | **открыто** | Старт прогноза от годовой суммы — не менялся | К R3-B |
| R-079 | P2 | K13 | Отрицательная или нулевая маржа отбрасывается как «нет значения»: клиенту пишут «не… | исправлено | `lib/point-b/model/inputs.ts` (≤0 ≠ «нет значения»); `bi26-bi28-verdict-margin.test.ts` | — |
| R-080 | P2 | K13 | Касса, сценарии и план-факт считаются без сезонности, даже при истории 24+ мес. (индексы… | **открыто** | `cash.ts`, `planfact/planned.ts` без сезонности | К R3-B |
| R-081 | P2 | K13 | Налог = ставка × max(0, EBITDA − проценты) помесячно; упрощёнка РК (налог с оборота)… | **открыто** | `lib/point-b/model/cash.ts:158`, `finmodel/keys.ts` не менялись | К R3-B |
| R-082 | P2 | K13 | Аномалии — z-score по уровню без тренда и сезонности, окно от 2 точек, при stddev=0… | **открыто** | `lib/metrics/anomalies.ts` не менялся | z-score по остаткам, окно ≥ 6 |
| R-083 | P2 | K1 | На `/gri` два несогласованных набора отраслевых ориентиров (калькулятор 7–9 из 10, «вы vs… | **открыто** | `lib/gri/benchmarks.ts:160-179` (`clamp01to10` пустого блока → you=0), два набора ориентиров | Один набор (утверждает эксперт), null для пустого блока |
| R-084 | P2 | K1 | `GRICalculator.syncFromServer` сливает частичные `section_avgs` с шаблонными… | **открыто** | `components/gri/calculator/GRICalculator.tsx:214-215,283-287` — частичные данные сливаются с DEFAULT_SCORES | Радар только при полном наборе |
| R-085 | P2 | K13 | «Ожидаемый эффект» решающей ставки = 25–50 % запаса **блока** /7, хотя ставка — один… | **открыто** | `lib/gri/decisive-bets.ts:138-149` — делится только на число блоков | effect / n_criteria / n_blocks |
| R-086 | P2 | K13 | В `/pulse` (доступен клиенту) «история» — синтетическая траектория `[20, 0.3p, 0.6p,… | **открыто** | `app/api/pulse/route.ts:219-235` — синтетическая траектория и churnProb | Убрать спарклайн или строить по событиям; «индекс риска» |
| R-087 | P2 | K13 | LTV = ARPU ÷ отток — по выручке, без валовой маржи; LTV/CAC завышен вдвойне (CAC — только… | **открыто** | `lib/metrics/formulas.ts:217-230` не менялся | LTV × валовая маржа, подпись |
| R-088 | P2 | K1 | Выводы без данных. Валидатор цели на 2-й минуте анкеты пишет «Слабые блоки: Финансы,… | **открыто** | Валидатор `/api/v1/assistant/validate` не менялся | «Недостаточно данных», локализация ключей |
| R-089 | P2 | K1 | Ни одна цифра прогресса не совпадает: главная «2/12 · 8 %», дашборд «8 %», «11 %», «17… | **открыто** | Разные метрики прогресса на `/client/home`, `/dashboard`, анкете | Одна метрика готовности |
| R-090 | P2 | K1 | Действия клиента в двух хранилищах: `action_items` (Точка Б) и `gri_plan_progress` (GRI);… | **открыто** | `app/api/v1/action-plan` менялся только по скоупу (V4) | Один экран «Мои задачи» |
| R-091 | P2 | K12 | Staff-страницы старой оболочки работают на мёртвых таблицах Prisma/NextAuth: `/team`… | **открыто** | `app/(dashboard)/team/page.tsx:10` (`prisma.user`), `dashboard/page.tsx:499-507` (Prisma CRM) | Перевести или редирект в ГИГА; удаление страниц — разрешение PO |
| R-092 | P2 | K12 | Кнопки без обработчиков: «Архив отчетов», «Запустить GRI», «Записаться на сессию»,… | **открыто** | Кнопки без обработчиков не трогали | Подключить или «скоро»; удаление — разрешение PO |
| R-093 | P2 | K2 | Быстрые действия шапки старой оболочки «Инсайты» (`/insights`) и «Отчёты» (`/reports`)… | исправлено | `components/layout/Header.tsx:28-74` (Инсайты/Отчёты только STAFF_SECTION_ROLES); `tests/unit/layout/header-quick-actions.test.ts` | — |
| R-094 | P2 | K2 | `/point-a` в старой оболочке рисует ту же Точку А v4 и клиента не перенаправляет (в… | **открыто** | `app/(dashboard)/point-a/page.tsx:13-16` рисует v4 без редиректа клиента | Редирект на `/client/point-a` |
| R-095 | P2 | K2 | «Мои документы» ведут на `/point-a#files`, а `id="files"` есть только в legacy; редирект… | исправлено | Якоря `id="my-data"` и `id="files"` в v4: `components/point-a-v4/SideCards.tsx:56,63` (`38a34ce3`) | Теста на якоря нет |
| R-096 | P2 | K2 | В новом кабинете нет колокольчика уведомлений, в старом нет `PopupLayer` (всплывающие… | **открыто** | `app/client/layout.tsx:58` — только PopupLayer, колокольчика нет; `(dashboard)/layout.tsx:58` — только колокольчик | Общий «слой кабинета» |
| R-097 | P2 | K2 | На 375 px верхнее меню `/client` — горизонтальная лента без индикатора: видны «Главная,… | **открыто** | ClientNav/MobileNav менялись только ради замков и выхода | Нижний таб-бар `/client` |
| R-098 | P2 | K2 | `FirstRunWizard` подключён только в старом `/dashboard`; новый вход `/client/home` его не… | **открыто** | `FirstRunWizard` по-прежнему только в `app/(dashboard)/dashboard/page.tsx` (R2 перевёл его на «Снимок бизнеса») | Сценарий «3 шага» на `/client/home` |
| R-099 | P2 | K10 | `/expert/gri` вызывает `GET /api/v1/gri/assessment`, который отдаёт GRI текущего… | **открыто** | `app/(expert)/expert/gri/page.tsx:58` — `/api/v1/gri/assessment` (свой GRI) | Агрегат по назначенным клиентам |
| R-100 | P2 | K2 | Раздел `cjm` «Путь клиента (CJM) — где клиенты теряются» ведёт на `/client/journey` —… | **открыто** | Без изменений | Переименовать/скрыть CJM-раздел — решение PO (Q13) |
| R-101 | P2 | K2 | У super_expert есть право `clients.review`, но в его меню нет «Точка Б — на одобрении»;… | **открыто** | `lib/admin/nav.ts` (SUPER_EXPERT_NAV) без «Точка Б — на одобрении» | Пункт меню по праву `clients.review` |
| R-102 | P2 | K5 | У `admin-giga-panel` и `super-expert` нет `error.tsx`: ошибка всплывает в корневой,… | **открыто** | `error.tsx` в `app/admin-giga-panel` и `app/super-expert` нет; `RouteError` → `/` | error.tsx с homeHref по сегменту |
| R-103 | P2 | K10 | GRI заново просит имя, e-mail, телефон, отрасль, оборот, сотрудников и главную боль… | **открыто** | Без изменений | Предзаполнение GRI и шага 1 анкеты |
| R-104 | P2 | K10 | После регистрации — «заявка будет рассмотрена в течение 1 рабочего дня», а лендинг… | **открыто** | `components/auth-home/RegisterForm.tsx:216` — «в течение 1 рабочего дня» | Решение PO: автоодобрение/текст |
| R-105 | P2 | K16 | Клик по многострочному полю открывает полноэкранный редактор, сохранение держит модалку… | **открыто** | Без изменений | Замер на проде, инлайн-ввод, дебаунс валидатора, N+1 в `comm/thread` |
| R-106 | P2 | K4 | Режим «Беседа с ИИ»: на первый же ответ через ~35 с — «Не успел ответить»; своё сообщение… | **открыто** | `app/api/v1/survey/chat/*`, `components/onboarding/chat/*` не менялись (общий ИИ-дедлайн 60 с из R-016 действует) | Оптимистичное сообщение, сохранение ответа при таймауте |
| R-107 | P2 | K14 | Непроверяемые и, вероятно, выдуманные заявления: «500+ диагностик», «92 % точность»,… | **частично** | Лендинг на `/` портала убран (`app/page.tsx`, решение PO), новая главная `components/auth-home/*` | На `/login` и `/register` остались «500+ диагностик», отзыв «Вортекс Лабс», «94 % NPS» (`app/(auth)/login/page.tsx:51,69`, `register/page.tsx:52-54`); основной лендинг aistart360.app — вне репо, Vercel заблокирован — решение PO |
| R-108 | P2 | K11 | В футере лендинга нет оферты, политики ПДн и реквизитов; `/privacy` не называет оператора… | **открыто** | `app/(public)/privacy/page.tsx` без оператора/БИН/обработчиков ИИ | Тексты — PO и юрист |
| R-109 | P2 | K14 | Цены в USD ($300/мес, $149 разово) для рынка KZ, на лендинге — в ₸ (разовый доступ… | **открыто** | `lib/payments/plans.ts:33-48` — USD | Валюта и цена (Q9, Q10) — PO; кнопка связи на заглушке |
| R-110 | P2 | K10 | Событие активации по умолчанию `GRI_COMPLETED`, хотя по решениям PO ценность — полная… | **открыто** | `lib/settings/registry.ts:165-168` — по умолчанию GRI_COMPLETED | Решение PO (Q6), отчёт пилота |
| R-111 | P2 | K10 | 14 провайдеров e-commerce и аналитики — у всех `verifiedLive: false`; CRM Bitrix24/amoCRM… | **открыто** | Без изменений | Живая проверка Kaspi/МойСклад/Bitrix24, метка «бета» |
| R-112 | P2 | K11 | В прод-данных вперемешку с реальными клиентами тестовые: 6× «PointA Aggregator Test Co»,… | **открыто** | Флага `is_test` нет нигде | Флаг + исключение из метрик; чистка тестовых записей — разрешение PO |
| R-113 | P2 | K16 | Каждая навигация делает 2 последовательных `getUser` к GoTrue (middleware и RSC-layout);… | **открыто** | `middleware.ts:543` (`x-user-role` никто не читает), layouts зовут getUser повторно | Передача проверенного user из middleware |
| R-114 | P2 | K16 | На каждой полной загрузке браузер повторно делает `getUser`, затем `profiles` и… | **открыто** | `stores/auth.store.ts:90-151` — повторные getUser/profiles/staff_roles из браузера | Начальное состояние стора с сервера |
| R-115 | P2 | K16 | Регион ams, пользователи в Казахстане: RTT ≈125 мс, новое соединение ≈360 мс. 58 из 139… | **открыто** | Без изменений | RSC + Suspense для тяжёлых страниц, preconnect, CDN |
| R-116 | P2 | K16 | Нет клиентского слоя данных: `useEffect`+`fetch` в 114 файлах против 22 с React Query;… | **открыто** | Без изменений (useEffect+fetch, опросы без visibility) | React Query, опрос только при visible |
| R-117 | P2 | K9 | Токены цвета — hex-литералы в `tailwind.config.ts`, а не CSS-переменные; `body` и… | **открыто** | `tailwind.config.ts` не менялся | Токены на CSS-переменных — при решении о редизайне |
| R-118 | P2 | K9 | Три визуальных языка: клиент — бирюзовый и Material Symbols, ГИГА и SuperExpert — slate,… | **открыто** | Без изменений | Один бренд — решение PO |
| R-119 | P2 | K9 | Три системы иконок (шрифт Material Symbols — 938 `<span>`, lucide в 116 файлах,… | **открыто** | Без изменений | Одна SVG-система иконок |
| R-120 | P2 | K9 | `components/ui/Button` используется в 7 файлах, «сырых» `<button>` — 779; у главной… | **открыто** | Без изменений | `Button` с вариантами |
| R-121 | P2 | K9 | Окна: 43 самодельных оверлея, 17 без `role="dialog"`, ни в одном нет ловушки и возврата… | **открыто** | Без изменений (`role="dialog"` в 22 местах) | Dialog/Sheet/Switch на Radix, шкала z-index |
| R-122 | P2 | K9 | Контраст приглушённого текста ниже AA: `/30` — 2,0:1 (114 мест), `/40` — 2,7:1, `/50` —… | **открыто** | Без изменений | Контраст ≥ 4,5:1 |
| R-123 | P2 | K9 | ~203 из 442 текстовых полей без программной подписи; на регистрации `<label>` не связаны… | **частично** | Форма регистрации: `<label htmlFor>` + `autoComplete` (`components/auth-home/RegisterForm.tsx:108-121`) | Остальные ~200 полей без подписи, нативные сообщения на английском |
| R-124 | P2 | K9 | Действия «Просмотр» и «Скачать» появляются только по hover (8 файлов) | **открыто** | 11 мест `opacity-0 group-hover` в `components`/`app` | Видимость на мобильных/фокусе |
| R-125 | P2 | K9 | Двойная шапка анкеты (ClientNav + своя со вторым логотипом, логотип ведёт через лишний… | **открыто** | `app/client/onboarding/page.tsx`, `SurveyProgressHeader.tsx` не менялись | Одна шапка, мобильный селектор шагов, скелетон |
| R-126 | P2 | K7 | 127 файлов мокают Supabase, минимум 8 самописных fake-клиентов принимают любые цепочки и… | **открыто** | Самописные fake-клиенты остались | Критичные мутации — дублировать db-интеграцией |
| R-127 | P2 | K7 | В CI нет `next build`: ошибки NEXT_PUBLIC-переменных, границ server/client и конфликтов… | исправлено | `.github/workflows/ci.yml:51-74` — `npm run build` в CI | — |
| R-128 | P2 | K7 | Нет DOM-окружения (jsdom, testing-library): 54 файла рендерят статическую разметку;… | **открыто** | `vitest.config.ts:12` — `environment: node`, jsdom нет | jsdom-проект или e2e (R-044) |
| R-129 | P2 | K7 | Тесты расчётов проверяют реализацию, а не решения PO: закрепляют R-032 как норму; нет… | **частично** | Новые тесты-свойства: r032-overall-rule, r037, r038, bi26-bi28, scoring-official, nba-route, rfm/revenue-audit/data-quality, gri official-golden | Нет: итоговый множитель рычагов (R-076), сезонность (R-080), `insights/ai-generator`, `gri/logic` |

## 3. Что требует решения или действия PO

Без PO исполнители это не сделают: здесь удаление данных, внешние сервисы, юридические тексты, пароли, настройки GitHub, Railway и прода. Пометки «(код готов)» и «(код — после «да»)» показывают, нужен ли вообще код.

### 3.1. Пароли, секреты, внешние аккаунты

1. **R-001.** Сменить пароль облачной резервной Supabase `tpxw…`. Он остаётся в истории git, а репозиторий **публичный**: GitHub API отвечает `visibility: public`. Ещё решить:
   - переписывать ли историю (`filter-repo`, force-push) или сделать репозиторий приватным;
   - судьбу облачного проекта: оставить, приостановить или удалить. По решению 14.11 уходим с supabase.com.
   - **R-010:** чистить ли ПДн в этой копии.
2. **R-018.** Выбрать и завести внешний uptime-мониторинг (Better Stack, UptimeRobot и т. п.) и трекер ошибок (Sentry). Нужны аккаунты PO; ключи кладутся в Railway. Smoke после деплоя можно сделать без внешних сервисов (пакет 2).
3. **R-011.** Арендовать VPS в КЗ: скрипт `scripts/backup/vps/` готов. Решить по тарифу Railway: PITR, копия у второго провайдера.
4. **R-009.** Подтверждение e-mail при регистрации. Это меняет путь клиента: письмо через Resend, а на staging SMTP нет. Нужно «да» на изменение регистрации.

### 3.2. Настройки прода, GitHub и Railway

5. **R-004 / R-005.** Чтобы 2FA персонала заработала на проде:
   - персонал подключает 2FA — оба super_admin и admin;
   - затем PO включает `staff_require_mfa` в ГИГА.

   Код готов. Без этого шага пароль персонала плюс публичный anon-ключ дают PostgREST-доступ к клиентам в его скоупе.
6. **R-022.** Открыть видимость Точки А/Б в `platform_sections` для всех. Рекомендация R2: «Рынок» оставить staff_only. Иначе пейволл Раунда 2 Free-клиенты не увидят. Код готов.
7. **R-019.** Защита main: обязательный чек CI, запрет force-push. Подключить GitHub → Railway с «Wait for CI» вместо `railway up` с Mac. Это настройки GitHub и Railway.
8. **R-020.** Применять ли `.railway/railway.ts` (`railway config apply`). Для портала дедлайн 01.12 не страшен. Сервис `agents` нужно проверить.
9. **R-050.** Настройки GoTrue и Kong на Railway:
   - `GOTRUE_DISABLE_SIGNUP` и лимиты GoTrue;
   - закрыть `/pg`;
   - Studio — за паролем.
10. **R-051.** Выключить `/api/auth/demo-access` на проде (`DEMO_ACCESS_ENABLED=false`) или оставить с CAPTCHA.
11. **R-068.** Тариф Railway и 2 реплики (Q17).
12. **R-069 / R-021.** «Рынок»: развернуть Mark-analytics на Railway или оставить скрытым. Перенести мост WhatsApp с ноутбука (Q19).
13. **R-027.** Какие режимы анкеты должны быть на проде. Флаг сборки на Railway мной не проверялся. Если перевести флаг на серверную настройку, решение будет в ГИГА.

### 3.3. Удаление и замена (по правилу PO — только с разрешения)

14. **R-054.** Разовая чистка сирот `survey_answer_history` после бэкапа.
15. **R-059.** Удаление неиспользуемых моделей Prisma. Guard-скрипты можно сделать без удаления.
16. **R-074 / R-075.** Убрать сценарии V2 Точки Б и легаси-движок `lib/point-b-engine.ts`. Перевод маршрута на модель — без удаления.
17. **R-091 / R-092.** Staff-страницы старой оболочки (`/team`, `/analytics`, `/insights`, `/reports`, `/clients/[id]`) и мёртвые кнопки. Варианты: редирект в ГИГА или «скоро», удаление — только по «да».
18. **R-107.** Убрать с `/login` и `/register` «500+ диагностик», отзыв «Вортекс Лабс» и «94 % NPS».
19. **R-112.** Флаг `is_test` и чистка тестовых компаний в проде («PointA Aggregator Test Co» ×6, «Демо · гость» ×12 и т. д.).

### 3.4. Продукт, контент, право

20. **R-024.** Кто эксперты: на проде одобренных 0 (по памяти). Текст Гри «эксперт ответит за 48 ч» ждёт отдельного «да».
21. **R-031.** Экспресс-анкета как вход по умолчанию и «готовность к оценке N %» (Q7). Пересекается с R3-A.
22. **R-032 / R-072 / R-083.** Эксперт утверждает пороги Точки А (сейчас временные, в `lib/point-a/v4/config.ts`), отраслевые пороги (Q5) и один набор ориентиров GRI.
23. **R-043 / R-108.** Юридическая проверка ПДн РК (Q16). Оператор, БИН, обработчики ИИ и трансграничная передача — в `/privacy` и `/terms`.
24. **R-104.** Политика одобрения и текст «в течение 1 рабочего дня» на регистрации.
25. **R-109.** Валюта и цены (Q9, Q10): сейчас USD.
26. **R-110.** Событие активации (Q6).
27. **R-100.** Раздел «CJM» ведёт в AI-workspace: переименовать или скрыть (Q13).
28. **R-118 / R-117.** Один бренд и редизайн. От этого зависит, когда делать пакет 9.
29. **R-028.** Полный перенос `/dashboard`, `/gri` и др. в `/client/*` со старыми путями-редиректами (Q14). Быстрый шаг — показывать ClientNav в старой оболочке — можно без решения.
30. **R-067.** ИИ-модели, зашитые в коде: Opus 4.8 на все ответы омниканала и `gpt-4o` в journey. Это противоречит решению PO «Claude → Alem/Qwen на всю платформу». Подтвердить, что переводим на маршруты ГИГА (стоимость и качество ответов изменятся).
31. **R-111.** Живая проверка интеграций (Kaspi Магазин, МойСклад, Bitrix24) на реальных аккаунтах пилотных клиентов. Остальным — метка «бета».

## 4. Находки вне реестра (выкатка Раундов 1–2, сведения по памяти проекта)

| Что | Риск | Кому |
|---|---|---|
| TCP-прокси прода Postgres-sfat (`…proxy.rlwy.net`) открыт без TLS. Удаление PO отклонил 14.11 | P1: пароль `supabase_admin` уходит по сети открытым текстом; доступ к базе из интернета | PO: повторно решить или включить TLS / IP-ограничения |
| База `inngest` на Postgres-sfat не входит в бэкап `db-backup`, старые строки Inngest сами не чистятся | P2: рост базы; при потере — история запусков | Пакет 2 + PO (добавить в бэкап) |
| Алерта «Inngest-функция не запускалась N часов» нет. Об отказе Inngest Cloud узнали случайно, через 48 ч | P2 | Пакет 2 |
| Основной лендинг aistart360.app — на заблокированной Vercel-команде (402) | Вне репо; R-107/R-108 касаются и его | PO |
| В ГИГА «Доступы» на проде 4 открытые заявки и 34 «новых» регистрации (14.11) | Операционное | PO / персонал |

## 5. Пакеты Раунда 3 (только открытые и частичные P1/P2)

Ограничения: машина 8 ГБ, одновременно не больше 2 исполнителей. Ничего не удаляем без разрешения. Сначала аудит, каждая правка — с тестом. Миграции проходят staging → бэкап → прод через `db-tools`.

Записи Точек А и Б не входят в эти пакеты: их распределят R3-A и R3-B. Это R-031, R-070–R-081 (кроме исправленных R-077 и R-079), R-089 и R-090. Пакеты R3-A/B не стоит ставить параллельно с пакетом 6: общие файлы `lib/point-a/*`, `lib/gri/*`, `/client/home`.

Оценка: S — до полудня работы одного исполнителя, M — около дня, L — 2–3 дня с ревью.

### Пакет 1. «Схема как в проде» (K6 и часть K11): P1 R-012; P2 R-055, R-056, R-057, R-058, R-059; остаток R-010. Оценка **L**

- **Сверка схемы.** Read-only diff схемы staging (копия прода от 12.11) с репозиторием и CI-зеркалом. Затем adopt-миграция `150_*` для таблиц, созданных вне миграций: `CREATE … IF NOT EXISTS`, RLS, `REVOKE anon`. Плюс ежедневная проверка «public-таблица без RLS / с грантом anon» по образцу `backup-freshness`, с алертом.
- **R-055.** FK `profiles.approved_by` → `ON DELETE SET NULL NOT VALID` + VALIDATE.
- **R-057.** Типы и FK `company_id` — по итогам diff.
- **R-056.**
  - убрать мёртвый запрос `admin_requests … created_at` (`app/api/giga-admin/requests/route.ts:45-48`);
  - убрать `diagnostics.created_at` в `app/api/pulse/route.ts:306`;
  - сверить колонки `companies`;
  - добавить тест «код ↔ схема» на зеркале.
- **R-058 / R-010.** `scripts/apply-migration.js`:
  - печать хоста и `--yes`;
  - `lock_timeout` и `statement_timeout`;
  - не перезаписывать checksum молча.

  Плюс `scripts/migrations-status.js` (read-only) и CI-линт уникальности номеров только для новых файлов (старые дубли 035–091 не трогаем).
- **R-059.** Guard против `prisma db push/migrate` к не-локальной базе. Модели не удаляем.
- **R-054.** Код функции purge исправить можно. Чистка сирот — только по «да» PO.
- **Риски.**
  - Adopt-миграция на проде не должна менять данные и права. Проверка — на staging, откат — `rollback/150_*.down.sql`.
  - Diff прода напрямую требует «да» PO на read-only подключение.
  - Правка зеркала (`DRIFT_RULES`) может уронить существующие тесты.

### Пакет 2. «Дедлайны и наблюдаемость» (K4, K5): P1 R-015, R-018 (кодовая часть); P2 R-060, R-061, R-062 (остаток), R-063. Оценка **M**

- **R-015.** `withDeadline` ещё на 14 маршрутах с maxDuration 120–300 с. Вебхуки (meta, telegram-inbox, whatsapp-web) должны отвечать быстро, а работу уводить в фон: иначе провайдер будет повторять доставку. `/api/inngest` не оборачивать (там свои `timeouts`). У `cron/agents` и `internal/agents/kick` есть свой бюджет — проверить согласованность.
- **R-018 без внешних сервисов:**
  - readiness `/api/health` с проверкой БД, GoTrue и Inngest;
  - скрипт smoke после деплоя `scripts/smoke/post-deploy.mjs`: health, `/login`, ИИ-probe на 1 токен, read-only;
  - запуск скрипта — в инструкции деплоя.

  Внешний пинг и Sentry — после решения PO.
- **R-062 / R-063.**
  - алерт «функция Inngest или агент не запускались дольше ожидаемого»;
  - индикатор в ГИГА;
  - проверка запусков агентов на проде;
  - ретенция строк базы `inngest` — с «да» PO.
- **R-060.** `logWebhookRejection` в `whatsapp-web/{drain,session,commands/*,outbound/*}`.
- **R-061.** Проверка `INTERNAL_TOKEN_SECRET` и `AUTH_SECRET` при старте сервиса `agents`.
- **R-011, кодовая часть:**
  - база `inngest` — в `scripts/backup/railway-db-backup.sh`; включение переменной на `db-backup` — с «да» PO;
  - ежемесячное учение `restore-drill.sh` — в расписание и в docs.
- **Риски.**
  - Дедлайн на вебхуке ведёт к повторным доставкам и дублям: нужны идемпотентность и тест.
  - Smoke не должен ничего писать на проде.

### Пакет 3. «Вход и одна оболочка клиента» (K2, K5, K10): P1 R-028 (быстрый шаг), R-029; P2 R-094, R-096, R-097, R-098, R-101, R-102; остаток R-025. Оценка **M** (без R-097 и R-098 — **S**)

- **R-029.** Заменить `/dashboard` на `roleLandingPath` и `postLoginPath` в:
  - `middleware.ts:641`;
  - `app/client/welcome/page.tsx:92,202`;
  - `app/not-found.tsx:24`;
  - `app/auth/verify/route.ts:21`;
  - `app/auth/callback/route.ts:20`.

  В `RouteError` добавить `homeHref` по сегменту.
- **R-102.** `error.tsx` в `app/admin-giga-panel` и `app/super-expert/(workspace)`.
- **R-094.** Редирект клиента с `/point-a` на `/client/point-a`, как уже сделано для `/point-b`.
- **R-101.** Пункт «Точка Б — на одобрении» в `SUPER_EXPERT_NAV`.
- **R-028, быстрый шаг.** Для клиента в `app/(dashboard)/layout.tsx` показывать `ClientNav`. Старые пути не удаляем.
- **R-096.** Общий слой кабинета: колокольчик и `PopupLayer` в обеих оболочках.
- **R-025.** Кнопка «Поделиться» `ShareButtonAuto type="point_a"` в v4.
- **R-097 и R-098 — вторым шагом:**
  - нижний таб-бар `/client`;
  - сценарий первого входа на `/client/home`.
- **Риски.**
  - Петли редиректов: у legacy super_admin без `staff_roles` раньше уже была петля. Нужны тесты middleware на каждую роль и статус.
  - jsdom нет, поэтому UI проверяется в браузере на staging.

### Пакет 4. «Остатки безопасности и входных API» (K3, K15): P1 R-009 (с «да» PO); P2 R-049, R-053(в); остатки R-003 и R-005. Оценка **M**

- **R-009.** Подтверждение e-mail при регистрации: `email_confirm: false` + письмо, понятный экран «подтвердите почту», запасной путь, если почтовый сервис недоступен.
- **R-049.** Лимиты по аккаунту (e-mail) на входе владельца (`app/api/giga-admin/auth`), в `auth/password` и `email-link`. Сверить `TRUSTED_PROXY_HOPS` с фактическим прокси Railway: только чтение заголовков на staging.
- **R-053(в).** Миграция с колоночными грантами UPDATE на `companies` для `authenticated` (только поля анкеты шага 1) и триггером `updatedAt`.
- **R-003.** Письмо владельцу о смене фактора 2FA.
- **R-005.** Step-up в `/api/v1/*` для клиента с личной 2FA. Низкий приоритет.
- **Риски.**
  - Колоночные гранты могут сломать запись клиента в `companies` из анкеты или кабинета. Сначала grep всех клиентских `.from('companies').update/upsert`, потом тест на БД.
  - Лимит по e-mail может запереть владельца: мягкий порог плюс сброс.

### Пакет 5. «Тесты: RLS, матрица прав, e2e, CI» (K7): P1 R-044, R-045, R-046, R-019 (документ); P2 R-126, R-128, R-129. Оценка **L**

- **R-045.** `tests/integration/db/rls-110-139.test.ts` на `asUser()`. Таблицы: pb_*, pa_*, point_a_values/sources, metric_facts/overrides, data_discrepancies, ai_pending_actions, comm_*, kb_articles. Сценарии: свой владелец видит, чужой — нет, anon — ноль, эксперт — только назначенных.
- **R-046.** Второй уровень матрицы: для каждого маршрута из манифеста вызвать обработчик без сессии и с ролью client и ждать 401/403 (кроме `public:*` и `cron`/подписи с отдельной проверкой).
- **R-044.** Playwright E1–E10 против staging: вход клиента, анкета, Точка А, пейволл, эксперт, админ. Только тестовые аккаунты staging. Прогон ночью и перед релизом.
- **R-128.** jsdom-проект Vitest: анкета (автосохранение), вход, загрузка документов.
- **R-129.** Тесты-свойства для рычагов и сезонности Точки Б — вместе с R3-B.
- **R-126.** Критичные мутации (решение по заявке, «Назначить Pro», тариф, purge) продублировать db-интеграцией вместо fake-клиента.
- **R-019.** Runbook отката деплоя в `docs/deploy/` (предыдущий деплой Railway, `rollback/*.down.sql`). Защита main — действие PO.
- **Риски.**
  - Playwright и `next` на 8 ГБ: этот пакет идёт **в одиночку** или в паре с лёгким документным пакетом.
  - e2e против staging нестабильны: нужны ретраи и сид-аккаунты через `scripts/staging`.

### Пакет 6. «Честные числа вне Точек А/Б» (K1, K13, K10): P2 R-082, R-083 (код), R-084, R-085, R-086, R-087, R-088, R-099. Оценка **M**

- **R-083 / R-084.**
  - пустой блок GRI → null вместо 0 (`computeGaps`);
  - калькулятор не смешивает частичные `section_avgs` с `DEFAULT_SCORES`;
  - радар — только при полном наборе;
  - один набор ориентиров, значения — от эксперта. До утверждения — подпись «ориентир не утверждён».
- **R-085.** Эффект решающей ставки = запас / число критериев / число блоков.
- **R-086.** Пульс: убрать синтетическую траекторию, «вероятность оттока» → «индекс риска».
- **R-087.** LTV × валовая маржа или подпись «по выручке».
- **R-082.** Аномалии: окно ≥ 6, без ±999.
- **R-088.** Валидатор при малой полноте: «недостаточно данных», русские названия блоков.
- **R-099.** `/expert/gri` — агрегат по назначенным клиентам, а не свой GRI.
- **Риски.** Меняются цифры, которые видят клиенты. Нужен тест на каждый пример из 05-business-intelligence и согласование с R3-A: общие `lib/gri/*` и `lib/format/gri.ts`.

### Пакет 7. «Легаси и ИИ-модели» (K12): P2 R-067, R-075, R-091, R-092. Оценка **M**, после решений PO (п. 16, 17, 30)

- **R-067.** Фичи передают `tier`, а не модель. Проверка ID в `ai-discovery`.
- **R-075.** `app/api/clients/[id]/analysis/point-b` → `computeModel`, движок не удаляется.
- **R-091 / R-092.** Редиректы в ГИГА или «скоро», без удаления.
- **Риск.** Меняются качество и стоимость ответов омниканала: проверить на staging с бюджетом ИИ.

### Пакет 8. «Скорость» (K16): P2 R-105, R-113, R-114, R-116 (R-115 позже). Оценка **M–L**

- **R-113.** Проверенные в middleware `user.id` и роль передаются в RSC через заголовки запроса. Входящие такие заголовки очищаются.
- **R-114.** Начальное состояние стора — из серверного layout.
- **R-116.** React Query для виджетов главной; опросы — только когда вкладка видима.
- **R-105.** Замер на проде (только чтение), дебаунс валидатора, N+1 в `comm/thread`.
- **Риск.** Подделка заголовка роли: нужен обязательный тест «входящий `x-user-*` отбрасывается».

### Пакет 9. «Дизайн-система и доступность» (K9): P2 R-117–R-125. Оценка **L**, только после решения PO о бренде и редизайне (п. 28)

- Быстрые и независимые от редизайна правки (**S**):
  - R-122 — минимальный контраст текста;
  - R-124 — действия видны без hover на мобильных и при фокусе;
  - R-123 — компонент `Field` с подписью для форм ГИГА.
- Остальное — в редизайне.

### Пакет 10. «Продуктовые настройки» (K8, K10): P1 R-027; P2 R-103, R-106; остаток R-024. Оценка **S–M**

- **R-027.** Режимы анкеты — серверная настройка ГИГА. По умолчанию — текущее значение флага, поведение не меняется.
- **R-103.** Предзаполнение GRI и шага 1 анкеты из профиля.
- **R-106.** Чат анкеты: сообщение клиента появляется сразу; при таймауте ИИ ответ сохраняется без разбора.
- **R-024.** Карточка «кто и когда ответит» в «Сообщениях» клиента — после «да» PO на текст.

### Порядок волн (не больше 2 исполнителей)

| Волна | Исполнитель 1 | Исполнитель 2 | Почему так |
|---|---|---|---|
| 1 | Пакет 1, схема (L) | Пакет 2, дедлайны и наблюдаемость (M) | Закрывают P1 R-012, R-015, R-018. Разные файлы; миграции только в пакете 1 |
| 2 | Пакет 3, вход и оболочка (M) | Пакет 4, остатки безопасности (M) | P1 R-028, R-029, R-009. Оба трогают `middleware` и auth-маршруты: договориться о порядке слияния, пакет 4 вторым |
| 3 | Пакет 5, тесты и e2e (L, **в одиночку** или с пакетом 10) | Пакет 10 (S–M) | P1 R-044–R-046. Playwright занимает почти всю память |
| 4 | Пакеты R3-A / R3-B (по их отчётам) | Пакет 6, числа (M) | Не параллельно с R3-A по `lib/gri`, `/client/home`. Если пересечение большое — последовательно |
| 5 | Пакет 7 / 8 | Пакет 9 (быстрые a11y) | После решений PO |

Перед каждой волной: «да» PO, бэкап, staging. После каждой волны: tsc 0, lint 0, `next build`, vitest. Миграции — на staging, потом на прод с откатом.

## 6. Ограничения сверки

- **Состояние прода не проверено.** Видимость разделов, `staff_require_mfa`, число экспертов, режимы анкеты в сборке и работа агентов взяты из памяти проекта на 14–15.11. Перед волной 1 это стоит проверить read-only запросом через `db-tools`, с «да» PO.
- **R-012, R-056, R-057 зависят от реальной схемы прода.** Без diff их объём оценён грубо.
- **Записи Точек А и Б оценены по коду и тестам кратко.** Детали и остатки — в отчётах R3-A и R3-B.
- **Тесты не запускались.** Это аудит без прогона; базовая линия по памяти — 8763 pass.
