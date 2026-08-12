# Store Control Center Implementation Plan

## Overview

Строим защищённый операционный контур магазина рядом с существующей MyHonor-аналитикой. Каждая фаза даёт самостоятельную пользу и не требует переносить сырые клиентские документы в Git.

## Prerequisites

- Актуальная ветка проекта и рабочие тесты.
- Supabase migration pipeline.
- Закрытый production-доступ к исходным файлам вместо публичной Drive-папки.

## Phase 0: Отдельный business tenant

### Objective

Закрепить Интернет-магазин за отдельным Supabase account/company tenant, не за
компанией «Действуем», сохранив уже импортированные MyHonor catalog/orders.

### Tasks

- [x] Проверить production-связь Auth user → profile → company и наличие
  отдельного MyHonor tenant.
- [x] Подтвердить, что Store использует Supabase tenant, а не legacy Prisma
  `Organization`.
- [x] Заменить demo-label на `Интернет-магазин HONOR / MyHonor`, сохранив IDs.
- [x] Добавить идемпотентный service-role provisioning с dry-run, строгими
  preconditions и compensation для нового Auth user.
- [x] Исправить post-login переход `/login?from=/store`.
- [x] Проверить изоляцию от «Действуем», роль `client`, статус `approved`, одну
  компанию и сохранность MyHonor products/orders.

### Success Criteria

Один отдельный логин магазина открывает `/store`, overview показывает
`Интернет-магазин HONOR / MyHonor`, а user/company IDs и бизнес-данные не
пересекаются с tenant «Действуем».

## Phase Summary

1. Живой обзор и data foundation.
2. Проверяемый импорт прайсов, остатков и продаж.
3. Акции, маржа и бонусы.
4. Финансовая сверка и grounded AI.

---

## Phase 1: Живой операционный обзор

### Objective

Дать владельцу рабочий `/store` с owner-scoped данными, честной полнотой и безопасным fallback на MyHonor.

### Rationale

Это минимальный вертикальный срез, который проверяет модель данных, доступ, расчёты и UX до создания сложного importer workflow.

### Tasks

- [x] Добавить идемпотентную migration для operational layer.
- [x] Создать типы, чистый агрегатор и Supabase loader.
- [x] Добавить authenticated overview API.
- [x] Собрать responsive `/store` с KPI, источниками, каналами, складами и алертами.
- [x] Подключить desktop/mobile navigation и middleware.
- [x] Покрыть агрегатор, миграцию, API и навигацию тестами.

### Success Criteria

Страница работает на собственных данных пользователя, не падает без новой migration, не выдумывает маржу при MyHonor fallback и проходит тесты/type-check.

### Files Likely Affected

- `supabase/migrations/084_store_control_center.sql`
- `lib/store/*`
- `app/api/v1/store/overview/route.ts`
- `app/(dashboard)/store/page.tsx`
- `components/store/*`
- `middleware.ts`, `lib/navigation.ts`, `components/layout/MobileNav.tsx`
- `tests/unit/store/*`, `tests/unit/api/*`, `tests/unit/navigation.test.ts`

---

## Phase 2: Управляемый импорт

### Objective

Превратить XLS/XLSX/CSV в проверенные, дедуплицированные и опубликованные факты.

### Tasks

- [x] Реализовать authenticated preview upload с Vercel-safe лимитом 4 МБ и XLS/XLSX/CSV.
- [x] Добавить preview и распознавание price/inventory/sales schema.
- [x] Сверять строки, суммы, возвраты, наценку, формулы и дубли.
- [x] Повторно разбирать файл на publish-сервере и сверять raw SHA-256, normalized digest, schema version, тип и количества строк.
- [x] Определять компанию только из authenticated-сессии и отклонять отсутствующую или неоднозначную owner-company связь.
- [x] Повторить внутри каждого Store API role/status gate и signed MFA step-up, поскольку dashboard middleware не обрабатывает `/api/*`.
- [x] Требовать дату прайса/остатков и вычислять серверные scope: `global`, `warehouse:<code>`, `month:YYYY-MM`.
- [x] Связать variant identity полным нормализованным названием; сохранять каждый source SKU в immutable mapping audit без ложного разбиения варианта.
- [x] Публиковать через атомарную `SECURITY DEFINER` RPC с advisory lock, manifest idempotency и supersede предыдущей версии scope.
- [x] Закрыть прямой DML к импортным таблицам и оставить доверенный RPC-путь публикации.
- [x] Каскадно очищать Store-факты по точной owner/company паре перед удалением
  компании, несмотря на UUID/TEXT drift `companies.id`.
- [x] Добавить provenance-bound release runner: committed SHA-256, ledger,
  advisory lock и единая транзакция `084 → 085` без временного окна DML.
- [x] Добавить confirmation/retry UX, audit history и состояния published/duplicate/error.
- [x] Загружать последние inventory snapshots всех опубликованных warehouse scope, не только одного склада.
- [ ] Добавить закрытый direct-to-storage upload для файлов свыше 4 МБ.
- [ ] Добавить явный выбор компании для пользователей с несколькими owner-компаниями.

### Success Criteria

Одинаковый manifest не удваивает данные; повтор с тем же idempotency key безопасен; конкурирующие публикации одного scope сериализуются; пользователь видит ошибки до записи; сервер не доверяет preview payload; контрольные итоги совпадают. Raw bank/PII не попадают в публикацию или audit history.

### Verified HONOR Controls

- Июльские продажи: 1 200 строк, 1 324 ед., выручка 28 053 253 KZT, себестоимость 17 139 974,46 KZT, скидка 14 029 367 KZT.
- Прайс: 1 365 принятых строк.
- Остатки Kaspi: 547 принятых, 2 в карантине, 1 465 единиц.
- Остатки Усть-Каменогорска: 1 031 принятая, 4 в карантине, 5 170 единиц.
- Магазин Астана: 685 принятых, 2 в карантине, 2 264 единицы.
- Основной склад: 652 принятых, 2 в карантине, 53 140 единиц.

---

## Phase 3: Акции и бонусы

### Objective

Не позволять скидке и бонусу незаметно уничтожать валовую прибыль.

### Tasks

- [ ] Версионные promotion и commission rules.
- [ ] Discount-aware bonus calculator.
- [ ] Симулятор маржи и точки безубыточности.
- [ ] Approval flow и история изменений.

### Success Criteria

Каждая выплата и акция воспроизводима по утверждённому правилу и источнику.

---

## Phase 4: Сверка и AI

### Objective

Связать продажи, кассу/Kaspi и банк; дать AI только проверенные факты.

### Tasks

- [ ] Приватный импорт выписок и retention policy.
- [ ] Reconciliation runs и очередь расхождений.
- [ ] Grounding ассистента по опубликованному каталогу, цене и остатку.
- [ ] Алерты и next-best actions.

### Success Criteria

Расхождения объяснимы, банковские PII не попадают в клиентский код, AI указывает источник и свежесть.

## Post-Implementation

- [x] Документация архитектуры импорта, доверенных границ и ролей.
- [ ] E2E smoke на desktop/mobile.
- [ ] Проверка производительности на 100 000 строк продаж.
- [x] Статический privacy/security review границы публикации, API, SQL/RLS и UI.
- [ ] Release migration/deploy и production smoke.

## Notes

Первый релиз намеренно не включает публичную корзину и checkout: текущая внешняя витрина уже выполняет эту роль, а наибольшая экономическая ценность сейчас находится в управлении запасами, скидками и прибылью. Реализация Phase 2 в рабочей ветке сама по себе не означает, что миграция применена или сайт задеплоен.

Миграции Store нельзя применять generic single-file командой. Единственный
release-путь — `npm run release:store-schema` из commit, содержащего неизменённые
084/085: runner фиксирует commit и оба SHA-256, применяет файлы под одним
transaction/advisory lock, проверяет RLS/grants/RPC/cleanup trigger и отказывается
повторять 084 поверх установленной 085.
