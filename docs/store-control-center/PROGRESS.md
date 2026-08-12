# Store Control Center Progress

## Status: Phase 1 + Phase 2 — Released

Release status: production display identity, миграции 084/085 и код `/store`
задеплоены 2026-08-13 из commit `3b7f017c`. Рабочий адрес:
`https://aistart360-store.vercel.app/store`. Inline publication покрывает
XLS/XLSX/CSV до 4 МБ; direct private upload больших файлов остаётся следующим
срезом.

## Quick Reference

- Prompt: `docs/store-control-center/PROMPT.md`
- Research: `docs/store-control-center/RESEARCH.md`
- Implementation: `docs/store-control-center/IMPLEMENTATION.md`

---

## Phase Progress

### Phase 0: Отдельный business tenant

**Status:** Complete; production display identity applied

#### Confirmed

- Store tenant определяется Supabase Auth UUID, `profiles` и одной
  `companies.user_id`; legacy Prisma Organization в этом пути не участвует.
- В production уже существует отдельный MyHonor account, не связанный с
  «Действуем»: approved client, одна собственная company, 121 товар, 367
  заказов и 417 строк заказов.
- Текущая проблема — этот отдельный tenant оформлен как `HONOR GROUP · demo
  client`; создание пустого дубля потеряло бы существующие связи и данные.

#### Decision

- Сохранить существующие user/company IDs и перевести этот tenant из demo в
  полноценный бизнес `Интернет-магазин HONOR / MyHonor`.
- Не изменять и не переиспользовать аккаунт/компанию «Действуем».
- Пароль остаётся secret; provisioning и отчёты никогда его не печатают.

#### Completed

- Guarded production-транзакция изменила только `profiles.full_name`,
  `profiles.organization` и `companies.name` на `Интернет-магазин HONOR /
  MyHonor`; user/company IDs, пароль, роль и факты не менялись.
- После транзакции подтверждены одна owner-company, `client/approved/ecommerce`
  и неизменные 121 товар, 367 заказов, 417 строк заказов.
- Добавлен `scripts/provision-store-account.js`: dry-run по умолчанию, точное
  apply-подтверждение, запрет неоднозначной multi-company связи, trusted
  app/profile metadata, отсутствие ротации пароля у существующего аккаунта и
  Auth compensation при сбое создания нового tenant.
- Устаревший `seed:myhonor` теперь безопасно делегирует provisioning и больше
  не меняет пароль существующего пользователя и не записывает demo survey.
- Admin client creation переведён на service role с approved admin + Origin +
  обязательным MFA enrollment/step-up + rate limit + строгой схемой и opaque
  errors.
- Post-login helper принимает `/store` только для approved
  client/admin/super_admin; owner/expert/pending сохраняют свои landing routes.

### Phase 1: Живой операционный обзор

**Status:** Complete

#### Tasks Completed

- Зафиксированы продуктовый контракт, ограничения безопасности и фазовый план.
- Подтверждена база: ветка `codex/latest-git-release`, commit `b99b7a75`.
- Проанализированы текущие MyHonor ingestion, dashboard layout, middleware, navigation и тестовые шаблоны.
- Добавлены RLS-таблицы, server-first `/store`, authenticated API, KPI, каналы, склады, каталог и пустые состояния.
- `/store` подключён к middleware, desktop/mobile navigation и MyHonor-виджету.

#### Decisions Made

- Новый раздел является back-office Store Control Center, а не публичной витриной.
- Существующие `ecommerce_*` остаются неизменным безопасным MyHonor-контрактом.
- Операционные факты добавляются отдельными append-only snapshot-таблицами.
- Fallback MyHonor не показывает себестоимость или маржу, если их нет в источнике.
- Сырые документы и банковские данные не попадают в Git.

#### Blockers

- Нет.

### Phase 2: Управляемый импорт

**Status:** Secure inline preview and publication complete in branch

#### Tasks Completed

- Реализован sync parser XLS/XLSX/CSV с SHA-256, лимитами строк/колонок/ZIP и карантином формул.
- Добавлен owner-scoped, rate-limited `POST /api/v1/store/imports/preview` без записи в БД.
- Добавлен responsive `/store/imports` с preview, totals, warnings, quarantine, обязательными подтверждениями и состояниями публикации/повтора/ошибки.
- Publish endpoint заново разбирает исходный файл на сервере и сверяет raw SHA-256, полный normalized digest, schema version, import kind и количества строк; preview-данные не становятся доверенным payload.
- Каждый Store API самостоятельно проверяет роль/статус из `profiles`; approved client, admin и super_admin разрешены, pending/rejected/blocked/archived и чужие роли fail-closed.
- Для пользователя с включённым TOTP/passkey API проверяет подписанный, непросроченный и привязанный к user ID MFA step-up до parse, company lookup и privileged RPC.
- Владелец и компания берутся только из authenticated-сессии. Нулевая или неоднозначная owner-company связь блокирует публикацию; браузер не выбирает `user_id`, `company_id`, факты, scope или период.
- Для price/inventory обязательна подтверждённая дата. Scope вычисляется сервером: price `global`, inventory `warehouse:<code>`, sales `month:YYYY-MM`.
- Variant identity унифицирован по полному нормализованному названию; отличающиеся source SKU сохраняются в mapping audit и не блокируют корректное cross-source сопоставление.
- Добавлена атомарная `SECURITY DEFINER` RPC с advisory lock, manifest idempotency, безопасным повтором и supersede предыдущей опубликованной версии того же scope; прямой DML закрыт.
- Добавлен owner/company cleanup trigger: удаление одной компании не оставляет
  Store orphan rows; удаление Auth user по-прежнему каскадирует штатными FK.
- Добавлен атомарный release runner, который принимает только committed 084/085,
  записывает source commit и SHA-256 в закрытый ledger, выполняет оба файла в
  одной транзакции и проверяет RLS/grants/RPC до commit.
- Loader объединяет последние опубликованные inventory scope всех складов, берёт глобальный прайс и выбирает продажи по новейшему фактическому месяцу, а не по времени загрузки.
- Добавлена owner-scoped audit history опубликованных и superseded импортов без raw rows, исходных имён и PII.
- Контроль HONOR за июль: 1 200 строк, 1 324 ед., выручка 28 053 253 KZT, себестоимость 17 139 974,46 KZT, скидка 14 029 367 KZT.
- Контроль прайса: 1 365 принятых строк.
- Контроль четырёх остатков: Kaspi — 547 / 2 карантин / 1 465 ед.; Усть-Каменогорск — 1 031 / 4 / 5 170 ед.; магазин Астана — 685 / 2 / 2 264 ед.; основной склад — 652 / 2 / 53 140 ед.

#### Remaining Work

- Direct-to-private-storage upload для файлов свыше 4 МБ с retention policy.
- Явный выбор активной компании для пользователей с несколькими owner-компаниями; текущий безопасный режим требует ровно одну.
- Release migration/deploy и production smoke не выполнялись и требуют отдельного подтверждения.

### Phase 3: Акции и бонусы

**Status:** Not Started

### Phase 4: Сверка и AI

**Status:** Not Started

---

## Session Log

### 2026-08-12

- Начата реализация Phase 1 по результатам аудита файлов магазина.
- Phase 1 завершена; Phase 2 preview доведён до точной сверки с оригиналом.
- После Phase 2 прошли type-check, 1 982 теста (28 gated tests skipped без disposable env), lint и route audit; финальный production build повторён после security hardening.
- Phase 2 переведена из preview-only в server-owned inline publication с идемпотентностью, version history и multi-warehouse reading.
- Raw банковские документы, банковские реквизиты и иной PII исключены из импортируемого контура и Git.

### 2026-08-13

- Уточнено требование: Интернет-магазин — отдельный business tenant, а не режим
  аккаунта «Действуем».
- Существующий изолированный MyHonor tenant безопасно переведён из demo-label в
  `Интернет-магазин HONOR / MyHonor` без смены IDs/пароля и потери данных.
- Добавлены безопасный provisioning, hardened admin creation и прямой
  `/login?from=/store` landing в рабочую ветку.
- Commit `3b7f017c` отправлен в `origin/codex/latest-git-release`.
- `store-control-center-v1` атомарно применён к production PostgreSQL: 7/7
  таблиц, RLS, закрытый DML, service-only RPC и company cleanup trigger.
- Vercel deployment `dpl_BNoZkqHfXwSdyh98nnbaJk8zbGau` получил Ready и alias
  `https://aistart360-store.vercel.app`.
- Production smoke: `/store` → protected login, overview API → 401 anonymous,
  login → 200; rollback-only RPC опубликовал одну тестовую price row и оставил
  0 строк после rollback.
- Старый `portal.aistart360.app` не перепривязан: Vercel сообщил отсутствие
  доступа к domain owner. Для магазина используется проверенный выделенный
  Store alias.

## Files Changed

- `supabase/migrations/084_store_control_center.sql`
- `supabase/migrations/085_store_import_publication.sql`
- `lib/store/*`, `components/store/*`
- `app/(dashboard)/store/*`, `app/api/v1/store/*`
- `middleware.ts`, `lib/navigation.ts`, desktop/mobile navigation
- `tests/unit/store/*`, `tests/unit/api/store-*`, navigation/middleware/component tests
- `docs/store-control-center/*`
- `scripts/provision-store-account.js`, `scripts/seed-myhonor-client.js`
- `scripts/apply-store-control-release.js`
- `app/api/v1/admin/clients/route.ts`, `lib/role-landing.ts`, login page

## Architectural Decisions

- Owner-scoped RLS для всех новых таблиц.
- Server-owned publication: browser передаёт файл и подтверждения, но не владельца, компанию, scope, период или нормализованные факты.
- Preview digest привязан ко всему нормализованному результату; publish выполняет независимый parse и сравнение.
- Идемпотентность привязана к idempotency key и manifest SHA-256, а не только к raw source SHA-256, потому что тот же файл может иметь разную подтверждённую дату/scope.
- Advisory lock и атомарная RPC сериализуют запись и supersede в пределах владельца и компании.
- Variant key строится по полному нормализованному названию; каждый supplier SKU остаётся аудируемым атрибутом источника, но не используется как cross-source блокировка.
- Чистые функции расчёта отдельно от Supabase loader.
- Direct multipart preview ограничен 4 МБ из-за hard limit Vercel Function 4,5 МБ; большие файлы пойдут прямо в закрытое object storage.
- Raw-файл не сохраняется в operational facts; audit хранит безопасную техническую метку источника, хеши, scope, период и контрольные количества.

## Lessons Learned

- Исторические Excel-версии нельзя считать транзакционной системой.
- Отрицательные строки возвратов должны сохраняться до агрегации.
- Отрицательная «скидка» в HONOR-отчёте означает наценку и не является ошибкой.
- Реальный файл содержит повторный заголовок с опечаткой `Соимось`; parser покрывает это точечным regression-тестом.
- Финансовые значения перед записью должны быть детерминированно квантованы: деньги до 2 знаков, количество до 3, с симметричным округлением возвратов.
- Одного source SHA недостаточно для идемпотентности: подтверждённая дата и нормализованный manifest являются частью версии публикации.
