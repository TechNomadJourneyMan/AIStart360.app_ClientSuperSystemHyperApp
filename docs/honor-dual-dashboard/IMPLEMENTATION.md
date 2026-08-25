# HONOR Store + Journey 52.10 — реализация

## Что реализовано

Один server-first `StoreOverview.analytics` обслуживает два представления:

- `/store` — операционный dashboard владельца;
- `/client/journey/store` — канонический Journey/Miro-like workspace.

Store показывает отдельные окна `Сегодня`, `Этот месяц`, `Последний
опубликованный`, `YTD` и предыдущий год. Отсутствующий август 2026 остаётся
`not_covered`, а последним подтверждённым периодом является июль 2026.
Месячная история содержит выручку и валовую прибыль, таблица является доступной
альтернативой графику, отрицательные значения рисуются ниже нулевой линии.

P&L хранит каноническую валовую прибыль `revenue - cost` и отдельно сообщённую
прибыль отчёта с reconciliation delta. Бонусы и списания выводятся как
детализация расходов и не вычитаются из EBITDA второй раз. Источник, scope,
период, publication date и примечание сверки видимы в UI.

Journey использует существующие `JourneyWorkspace`, `JourneyCanvas`,
`ChatDock` и `WidgetModule`. Владелец может открыть read-only доску до
подтверждения Точки B. На mobile доступны `Доска · Чат · Модули`; источники
фактов и метрик раскрываются отдельным touch-friendly блоком. Опубликованные
Store-факты повторно загружаются с сервера и не сохраняются в `localStorage`.

## Данные и защита правды

Импорт `management_period` нормализует ровно 19 месяцев — январь 2025 через
июль 2026. Только сентябрь и октябрь 2025 имеют `partial`; P&L присутствует
только для мая–июля 2026. Publisher требует одновременно:

- SHA-256 workbook
  `5bd0ebc23f04eca040663fa907adf2cea78c45039544366eefe0759de4ea0e16`;
- размер `22 717` байт;
- semantic manifest
  `9c46f740df0334e0b4f8e0296f8335dc9f782588bc476e17791c84ddee03be13`;
- `warningCount=3`, `quarantine=0` и все контрольные суммы;
- immutable owner/company binding из `MYHONOR_ANALYTICS_USER_ID` и
  `MYHONOR_ANALYTICS_COMPANY_ID`;
- confirmation, включающий хэш source и target binding;
- точный Git commit publisher/parser/migration/CA;
- точный ledger установленной финансовой миграции.

Банковские выписки, клиенты, телефоны и иная PII из публичной Drive-папки не
используются, не нормализуются и не сохраняются. После приёмки публичный доступ
к исходной папке следует закрыть.

## PostgreSQL release

Миграция создаёт owner-scoped `store_financial_imports` и
`store_financial_periods`, включает RLS, отзывает прямой DML и оставляет запись
только через service-only `publish_store_financial_import`.

RPC проверяет форму JSON, денежную точность, месяцы без разрывов, P&L-инварианты,
row fingerprint, полный retry envelope и текущий статус duplicate. Публикации
сериализуются advisory lock. Строка компании удерживается `FOR SHARE`; удаление
компании согласовано тем же lock и удаляет periods перед imports. Смена owner/id
запрещена при существующей финансовой истории. Superseded manifest не может
выдаваться за current.

Release scripts принимают только direct-host конкретного Supabase-проекта или
официальный pooler с точным project-ref user. Raw connection string не
передаётся `pg.Client`; host/port/user/database собираются из проверенного URL,
опасные query parameters запрещены. TLS проверяется pinned Supabase Root 2021
CA и его SHA-256 fingerprint.

## Проверки до commit

- 54 test files / 302 tests — passed;
- TypeScript — passed;
- ESLint touched files — passed;
- `git diff --check` — passed;
- production build — passed до финальных release-hardening правок и повторяется
  перед deploy;
- desktop 1440×900 и mobile 390×844 — без document overflow;
- PostgreSQL migration/RPC выполнены в production-схеме внутри транзакции:
  cross-tenant отклонён, publish/duplicate/supersede/conflict подтверждены,
  затем выполнен `ROLLBACK`; таблицы после preflight отсутствуют.

Точный release/deployment SHA и public smoke записываются только после commit,
применения ledger, публикации 19 месяцев и проверки production URL.
