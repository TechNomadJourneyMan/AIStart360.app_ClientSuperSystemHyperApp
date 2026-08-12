# Store Control Center Research

## Overview

AIStart360 уже принимает публичный каталог и подписанные обезличенные заказы MyHonor, но собственного операционного раздела магазина нет. Наиболее ценный первый продукт — защищённый управленческий экран поверх существующих e-commerce данных и нового слоя цен, остатков и строковых продаж.

## Problem Statement

Управление магазином сейчас распределено между несколькими версиями Excel, статическими HTML-дашбордами, ручными фотографиями учёта и финансовыми документами. Формулы и итоги конфликтуют, а остатки, скидки и прибыль не соединены в один проверяемый поток. Это создаёт риск двойного учёта, позднего обнаружения дефицита и решений по акциям без контроля валовой прибыли.

## User Stories / Use Cases

- Как владелец, я вижу выручку, валовую прибыль, маржу и скидки за последний опубликованный период.
- Как руководитель магазина, я вижу остатки и месяцы покрытия по каждому складу.
- Как финансовый менеджер, я понимаю источник и свежесть каждого показателя.
- Как администратор данных, я публикую только проверенную версию импорта и не создаю дубли.
- Как AI-консультант, система не выдумывает цену или наличие, если опубликованного факта нет.

## Technical Research

### Existing foundation

- `ecommerce_products` хранит безопасно синхронизированный каталог MyHonor.
- `ecommerce_orders` и `ecommerce_order_items` хранят подписанные заказы без исходных PII.
- Supabase SSR client и RLS уже являются стандартным owner-scoped путём чтения.
- Dashboard group, sidebar, mobile drawer и middleware имеют единые role-aware шаблоны.
- Vitest уже проверяет чистые агрегаторы, API handlers и текст миграций.

### Approach Options

1. Встроить существующие HTML-дашборды. Быстро, но данные захардкожены, нет RLS, импорта и единого источника истины. Отклонено.
2. Расширить текущие `ecommerce_*` всеми полями склада и управленческого учёта. Ухудшит специальный безопасный контракт MyHonor и смешает каталог, заказы и бухгалтерские снимки. Отклонено.
3. Оставить `ecommerce_*` live-источником и добавить отдельный operational layer с унифицированным read model. Выбрано: минимальный риск, совместимость и поэтапное внедрение.

### Recommended Approach

Добавить append-only снимки цен, остатков и строковых продаж, а UI кормить единым агрегатором. Если operational layer недоступен или пуст, загрузчик использует текущие MyHonor товары/заказы и явно маркирует ограниченную полноту. Расчёты отделяются от Supabase-запросов и покрываются unit-тестами.

Publication boundary должна оставаться server-owned. Preview возвращает полный normalized digest, но publish не доверяет ему как данным: сервер повторно разбирает тот же файл, сверяет raw SHA-256, normalized digest, schema version, тип и количества строк, затем самостоятельно строит manifest и payload. Пользователь и компания выводятся из сессии. Для price/inventory подтверждённая дата обязательна; scope также вычисляется сервером.

Поскольку dashboard middleware намеренно пропускает `/api/*`, каждый Store handler повторяет доверенную role/status проверку. Если в JWT включён TOTP или passkey, handler до любого parse/DB/RPC проверяет signed step-up cookie, её срок и привязку к session user ID.

Запись выполняется одной `SECURITY DEFINER` RPC-транзакцией. Advisory lock сериализует конкурирующие публикации одного scope; idempotency key и manifest различают безопасный повтор и конфликт; новая версия supersede предыдущую. Прямой DML к импортным таблицам не является публичным API. Inventory loader выбирает последнюю опубликованную версию каждого warehouse scope и объединяет склады, не теряя их независимую свежесть.

### Required Technologies

- Next.js 14 App Router, Server Components и Route Handlers;
- Supabase Postgres, RLS и server-side auth;
- TypeScript и Zod на входных границах следующих фаз;
- Vitest для агрегаторов, маршрута, миграции и навигации;
- Vercel Functions без зависимости от локальной файловой системы.

### Data Requirements

- Версионный импорт с raw SHA-256, normalized digest, manifest SHA-256, idempotency key, scope, периодом и статусом публикации;
- мастер вариантов товара и складов;
- временные снимки закупочной/отпускных цен и остатков;
- signed quantities для продажи и возврата;
- list revenue, net revenue, cost и discount для воспроизводимой маржи;
- provenance: source, import run и freshness.

### Implemented Phase 2 Trust Contract

- Inline XLS/XLSX/CSV ограничен 4 МБ; публикация использует повторный server parse, а не факты из браузера.
- Store API разрешает только approved client/admin/super_admin, fail-closed при ошибке `profiles` и требует signed MFA step-up для enrolled user.
- Session owner определяет единственную доступную компанию; неоднозначность fail-closed до появления company selector.
- Variant key — хеш полного нормализованного названия. Synthetic и supplier SKU остаются атрибутами источника и записываются в immutable mapping audit: реальные прайс и остатки используют разные коды для одного полного варианта.
- Price имеет scope `global`, inventory — отдельный `warehouse:<code>`, sales — календарный `month:YYYY-MM`.
- Audit history содержит технические метаданные версии и контрольные количества, но не raw rows, исходные документы или PII.
- Исходные банковские файлы и реквизиты исключены из Store Import; они относятся только к будущему отдельному reconciliation-контуру.

### Real-File Controls

- Июль HONOR: 1 200 строк, 1 324 ед., выручка 28 053 253 KZT, себестоимость 17 139 974,46 KZT, скидка 14 029 367 KZT.
- Прайс: 1 365 принятых строк.
- Четыре inventory-файла повторно проверены после ужесточения parser: Kaspi — 547 принятых / 2 карантин / 1 465 ед.; Усть-Каменогорск — 1 031 / 4 / 5 170 ед.; магазин Астана — 685 / 2 / 2 264 ед.; основной склад — 652 / 2 / 53 140 ед.

## UI/UX Considerations

- Главный экран отвечает на вопрос «что требует решения сегодня», а не просто показывает графики.
- Последний фактический период выбирается из данных; текущий пустой календарный месяц не должен скрывать последний импорт.
- Неполная экономика MyHonor не изображается как полная: без себестоимости нет маржи.
- Таблицы адаптируются к телефону; критические значения имеют не только цвет, но и текстовую метку.
- Пустое состояние ведёт к импорту, а не в тупик.
- Confirmation UI явно показывает дату/scope, warning/quarantine acknowledgement и variant identity до публикации.
- История показывает published/superseded версии, результат безопасного повтора и свежесть, но не раскрывает сырые строки.
- Поздняя корректировка старого месяца не откатывает дашборд: sales выбираются по новейшему фактическому периоду, а не по времени публикации.

## Integration Points

- `middleware.ts` и `lib/navigation.ts` — разрешение `/store` для клиентов и staff.
- `components/layout/MobileNav.tsx` — мобильная видимость.
- `lib/supabase/server.ts` — authenticated RLS read.
- `ecommerce_products`, `ecommerce_orders`, `ecommerce_order_items` — fallback и переходный live-источник.
- `/api/v1/store/imports/preview` и `/api/v1/store/imports/publish` — независимый parse и сверка manifest перед server-owned RPC.
- `store_import_runs` и snapshot-факты — audit/version layer с owner-scoped чтением.
- будущий direct private upload — staging для файлов свыше 4 МБ, а не исполнение формул или публичная ссылка.

## Risks and Challenges

- Конфликтующие Excel-версии: решается raw hash + normalized manifest + explicit approval протоколом.
- Несовпадающие SKU: детерминированный full-name variant key связывает источники, а каждый source SKU остаётся в mapping audit; master-data governance всё ещё нужен для переименований.
- Публично доступные банковские документы: доступ должен быть отозван; сырые данные не входят в первую фазу.
- Миграция может быть ещё не применена: загрузчик должен fail-soft и не раскрывать внутреннюю ошибку.
- Исторические MyHonor заказы не содержат себестоимость: fallback показывает выручку, но не придумывает прибыль.
- Multipart Function path имеет лимит 4 МБ: большие файлы требуют direct upload в закрытое object storage с retention policy.
- Пользователь с несколькими owner-компаниями сейчас блокируется fail-closed; нужен явный active-company selector.

## Open Questions

- Какая система станет главным владельцем SKU после запуска: 1C, MyHonor или AIStart360.
- Нужны ли отдельные юридические лица внутри одной компании в первой версии импорта.
- Какой UX и access policy использовать для выбора активной компании при нескольких owner-связях.
- Какой срок хранения и lifecycle применить к direct-upload staging объектам свыше 4 МБ.
- Срок хранения исходных финансовых файлов и банковских выписок.
- Кто утверждает импорт и изменение бонусного правила.

## References

- Локальные миграции `079_myhonor_ecommerce_analytics.sql` и `083_myhonor_server_owned_catalog_sweeps.sql`.
- Локальный загрузчик `lib/point-a/v3/ecommerce-orders-loader.ts`.
- Официальные паттерны Next.js Route Handlers и Supabase Row Level Security.
