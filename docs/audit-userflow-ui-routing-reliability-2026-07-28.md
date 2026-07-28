# Аудит пользовательских сценариев, UI, маршрутизации и надёжности

**Проект:** AIStart360 Client SuperSystem HyperApp

**Дата:** 28 июля 2026

**Ветка аудита:** `codex/audit-userflow-ui-routing-reliability-2026-07-28`

**Базовая ветка:** `origin/feat/userflow-routing-fixes`

**Формат работы:** аудит кода, локальные исправления, автоматические проверки, локальный production build, HTTP-smoke и ручная браузерная проверка

## 1. Executive summary

Проверена новая ветка приложения целиком с точки зрения пользовательских сценариев, интерактивности, маршрутов, восстановления после ошибок, обновления страницы и повторного открытия.

Инвентаризация:

- 61 пользовательский page-route;
- 81 API-route;
- 7 layout-файлов;
- 19 динамических сегментов маршрутов;
- 81 статически определяемый переход `href` / `push` / `replace` / `redirect`, неразрешённых целей — 0;
- 1 нативная кнопка без обработчика после исправлений — logout в Giga Panel, оставлен вне scope как часть auth;
- 63 намеренно изменённых или добавленных файла приложения, тестов и отчёта.

Главные устранённые риски:

1. Черновик onboarding терял шаг, мог перезаписать более свежие серверные ответы и иногда переходил дальше после неуспешного запроса.
2. Двухфазные операции продаж могли дублироваться после потерянного ответа или повторного клика.
3. Ошибки источника данных выглядели как реальные нули, пустые списки или сообщение «всё в норме».
4. На мобильных экранах owner/expert-порталы оставались без полноценной навигации.
5. После login терялись query-параметры и глубокая исходная ссылка.
6. Часть owner-ссылок вела в общий namespace вместо `/owner`.
7. Фильтры клиентов и мониторинга продаж не были воспроизводимы после refresh/back/forward.
8. Несколько активных на вид кнопок ничего не делали, а main/admin/owner/expert-дашборды показывали часть демонстрационных значений как реальные данные аккаунта.
9. Загрузка onboarding-документов скрывала ошибки списка, могла оставлять orphan-файл и не включала текущий год.

Текущий вывод: навигация, критические черновики и поведение при недоступной БД существенно надёжнее. Ветка проходит type-check, lint, unit tests и production build. Полная готовность к production пока не подтверждена: нужен доступный тестовый PostgreSQL/Supabase-контур, а загрузку отчётов необходимо перевести с эфемерной файловой системы Vercel на постоянное объектное хранилище.

Предыдущий файл `Documents/tool_audit_aistart360.md` является обзором инструментов и архитектурных рекомендаций. Он не содержит доказательств прохождения текущих пользовательских сценариев и не использовался как подтверждение их исправности.

### Границы scope

Проверялись UI-сценарии, маршруты, состояния loading/error/empty/stale, refresh/reopen, мобильная доступность и защита от повторной отправки.

Вне scope по исходному заданию: безопасность, RBAC, правила авторизации, политики доступа, секреты, защита API, распределение ролей и security-логика middleware. Такие пункты отмечены отдельно и намеренно не исправлялись.

## 2. Карта пользовательских сценариев

| Сценарий | Вход | Успешный путь | Ошибка и восстановление | Refresh / reopen |
|---|---|---|---|---|
| Регистрация | `/register` | роль → данные → создание аккаунта → целевой кабинет | серверная ошибка остаётся в форме; повторная отправка доступна | введённые значения React-формы не обещаны как долговечный черновик |
| Login и deep link | защищённый URL или `/login?from=…` | login → безопасный внутренний `from` | опасный/внешний `from` отбрасывается; используется role-default | pathname и query сохраняются middleware |
| Восстановление пароля | `/forgot-password` → `/auth/reset-password` | запрос → токен → новый пароль | покрытие зависит от БД; auth-логика вне scope | серверный токен |
| Клиентский onboarding | `/client/onboarding` | загрузка server/local draft → шаги → сохранение → recalculate | видимая ошибка, шаг не продвигается, черновик не очищается | versioned local draft, ключ на пользователя, последний timestamp выигрывает |
| Документы onboarding | `/client/onboarding/documents` | выбор → метаданные → Storage → регистрация → список | retry bootstrap/list; orphan cleanup при сбое регистрации | список перезагружается с сервера, pending-файл остаётся только в текущей вкладке |
| Waiting room | `/client/waiting-room` | проверка реального статуса | ошибка не маскируется под `pending`; доступен retry, сохраняется last known | повторная проверка с сервера |
| Client dashboard | `/client/dashboard` | компания + current diagnostic → обзор и действия | loading/error/empty различаются, retry не уничтожает последнюю хорошую информацию | данные повторно запрашиваются |
| Client Point A | `/client/point-a` | current diagnostic → домены → recalculate | проверяется HTTP/envelope; старая информация остаётся видимой; есть retry | повторная загрузка сервера |
| Главный admin/owner dashboard | `/dashboard`, `/owner/dashboard` | реальные KPI/доступные источники → рабочие разделы | `—` и banner при outage; демонстрационные owner-метрики удалены/не выдаются за реальные | серверные данные перечитываются |
| Каталог клиентов | `/clients`, `/owner/clients` | search/status/industry/sort → строка → detail | loading/error/empty различаются; retry | фильтры сохраняются в URL |
| Продажи | `*/sales-monitoring` | контекст → организация → sale/expense → create → post | стабильный idempotency key, retry той же операции, ошибки не очищают форму | draft + durable operation в localStorage |
| Планирование/import | вкладки monitoring | план/import → подтверждение/commit | ошибки видимы; неподдерживаемые действия не имитируют успех | табы и фильтры в URL, draft локально там, где реализован |
| Reports/settings/profile | role-route | реальные данные или честный read-only | unavailable вместо fake success; профиль ведёт в рабочие настройки | серверный refresh; локальные неподтверждённые изменения не обещаны |
| Insights/intelligence/admin tabs | соответствующий route | выбор фильтра/таба → URL → выдача | источник недоступен — banner/empty различаются | URL воспроизводит состояние |
| Mobile owner/expert | любой role-route | нижние основные вкладки + drawer всех разделов | активный маршрут видим; drawer закрывается при переходе | маршрут остаётся источником истины |

## 3. Полная карта маршрутов

### 3.1 Page routes

| № | Route | Назначение / переход | Результат аудита |
|---:|---|---|---|
| 1 | `/` | входная точка → `/dashboard` | redirect существует |
| 2 | `/login` | login; принимает безопасный `from` | исправлено сохранение deep link |
| 3 | `/register` | регистрация client/owner | responsive проверен |
| 4 | `/forgot-password` | запрос сброса пароля | route существует; DB-тест заблокирован окружением |
| 5 | `/auth/reset-password` | установка нового пароля | route существует; auth вне scope |
| 6 | `/dashboard` | основной admin dashboard | graceful degradation; fake hero/GRI/activity удалены |
| 7 | `/admin` | admin modules и clients | вкладки в URL, fake KPI удалены |
| 8 | `/ai-scanner` | AI scanner | route существует; доменная интеграция не менялась |
| 9 | `/analytics` | аналитика | error/empty различаются |
| 10 | `/clients` | каталог клиентов | URL-фильтры, loading/error/empty/retry |
| 11 | `/clients/[id]` | карточка клиента | fake summary/score удалены |
| 12 | `/competitors` | конкуренты | no-op controls отключены, DB outage не обрушает страницу |
| 13 | `/gri` | общий GRI | route существует; данные зависят от источника |
| 14 | `/insights` | инсайты | query-filter работает, outage видим |
| 15 | `/intelligence` | разведка | query-filter работает, outage видим |
| 16 | `/market` | рынок | fake TAM/SAM/SOM и сигналы удалены |
| 17 | `/market/monitoring` | исторический alias | redirect → `/market` |
| 18 | `/metrics` | метрики | route существует; persisted selection уже есть |
| 19 | `/notifications` | уведомления | DB outage не выдаётся за пустой inbox |
| 20 | `/point-a` | диагностическая Точка А | mock client/health/domains удалены |
| 21 | `/point-b` | целевая Точка Б | route существует |
| 22 | `/profile` | старый профиль | redirect → `/settings` |
| 23 | `/pulse` | рабочий pulse | fake calls/messages/save/target удалены; retry |
| 24 | `/reports` | отчёты | read/list outage видим; upload storage требует решения |
| 25 | `/sales-monitoring` | продажи/расходы/планы/import | durable operations и URL state |
| 26 | `/settings` | настройки | реальные значения; неподдерживаемое read-only |
| 27 | `/team` | команда | outage не выглядит пустым состоянием |
| 28 | `/users` | пользователи | route существует |
| 29 | `/owner/dashboard` | главный owner dashboard | misleading hardcoded GRI удаляется; только подтверждённые/честные состояния |
| 30 | `/owner/admin` | owner admin hub | owner prefix сохраняется, вкладки в URL |
| 31 | `/owner/analytics` | owner alias аналитики | re-export общего route |
| 32 | `/owner/clients` | owner каталог клиентов | owner-aware detail links |
| 33 | `/owner/clients/[id]` | owner client detail | error/not-found/offline различаются |
| 34 | `/owner/competitors` | owner alias конкурентов | re-export общего route |
| 35 | `/owner/gri` | owner GRI | демонстрационные результаты не выдаются за данные аккаунта |
| 36 | `/owner/insights` | owner alias инсайтов | re-export общего route |
| 37 | `/owner/intelligence` | owner alias разведки | re-export общего route |
| 38 | `/owner/market` | owner alias рынка | re-export общего route |
| 39 | `/owner/metrics` | owner alias метрик | re-export общего route |
| 40 | `/owner/notifications` | owner alias уведомлений | re-export, force-dynamic |
| 41 | `/owner/point-a` | owner alias Точки А | re-export общего route |
| 42 | `/owner/point-b` | owner alias Точки Б | re-export общего route |
| 43 | `/owner/profile` | owner profile | fake GRI fallback удалён |
| 44 | `/owner/reports` | owner alias отчётов | re-export, force-dynamic |
| 45 | `/owner/sales-monitoring` | owner sales workspace | общий надёжный workspace |
| 46 | `/owner/settings` | owner alias настроек | re-export общего route |
| 47 | `/owner/team` | owner alias команды | re-export, force-dynamic |
| 48 | `/owner/users` | owner alias пользователей | re-export общего route |
| 49 | `/expert/dashboard` | expert dashboard | demo KPI/tasks/activity не выдаются за реальные |
| 50 | `/expert/gri` | expert GRI | demo scores/history не выдаются за реальные |
| 51 | `/expert/insights` | expert insights | demo insight feed не выдаётся за реальные данные |
| 52 | `/expert/profile` | expert profile | реальные read-only данные, fake editing отключён |
| 53 | `/expert/reports` | expert reports | фиктивные upload/archive удалены, честный read-only |
| 54 | `/expert/sales-monitoring` | expert sales workspace | общий надёжный workspace |
| 55 | `/client/dashboard` | клиентский обзор | error/empty/score semantics исправлены |
| 56 | `/client/onboarding` | анкета | durable draft и conflict resolution |
| 57 | `/client/onboarding/documents` | документы | retry, cleanup, current year, accessible dropzone |
| 58 | `/client/point-a` | клиентская диагностика | stale/retry/error handling |
| 59 | `/client/waiting-room` | ожидание решения/статуса | real status, retry, last known |
| 60 | `/giga-login` | Giga auth | route существует; auth вне scope |
| 61 | `/admin-giga-panel` | super-admin panel | route существует; RBAC/logout вне scope |

### 3.2 API routes

Все 81 route-файла инвентаризированы. Полный список сгруппирован по пользовательской функции:

| Группа | Routes |
|---|---|
| Auth | `/api/auth/register`, `/api/client/register`, `/api/dev/confirm-email`, `/api/dev/register`, `/auth/callback` |
| Admin | `/api/admin/analytics`, `/api/admin/audit`, `/api/admin/companies`, `/api/admin/companies/[id]`, `/api/admin/requests`, `/api/admin/requests/[id]`, `/api/admin/requests/[id]/approve`, `/assign`, `/comments`, `/reject`, `/request-info`, `/api/admin/requests/bulk`, `/api/admin/users`, `/api/admin/users/[id]`, `/block` |
| Giga admin | `/api/giga-admin/auth`, `/api/giga-admin/clients`, `/api/giga-admin/clients/[id]`, `/api/giga-admin/requests`, `/api/giga-admin/requests/[id]`, `/api/giga-admin/users`, `/api/giga-admin/users/[id]/block`, `/api/giga-admin/users/[id]/widgets` |
| Clients/GRI | `/api/clients`, `/api/clients/[id]`, `/api/clients/[id]/gri`, `/api/clients/[id]/gri/calculate`, `/api/dashboard/kpi`, `/api/diagnostics/trigger` |
| Notifications/Pulse/Reports | `/api/notifications`, `/api/notifications/read-all`, `/api/pulse`, `/api/reports/[id]`, `/api/reports/upload` |
| v1 Admin | `/api/v1/admin/approve-user`, `/api/v1/admin/clients`, `/api/v1/admin/pending-users`, `/api/v1/admin/users/[id]/approve`, `/api/v1/admin/users/[id]/reject` |
| Assistant/knowledge | `/api/v1/assistant/action-drafts`, `/api/v1/assistant/action-drafts/[id]/confirm`, `/api/v1/assistant/query`, `/api/v1/knowledge/documents` |
| Diagnostics/onboarding | `/api/v1/diagnostics/current`, `/api/v1/diagnostics/recalculate`, `/api/v1/onboarding/company`, `/api/v1/onboarding/documents`, `/api/v1/onboarding/survey` |
| Sales core | `/api/v1/sales`, `/api/v1/sales/[id]/post`, `/api/v1/sales/[id]/reverse`, `/api/v1/expenses`, `/api/v1/expenses/[id]/post`, `/api/v1/expenses/[id]/reverse`, `/api/v1/plans`, `/api/v1/plans/[id]/publish`, `/api/v1/products`, `/api/v1/cost-versions` |
| Sales context/analytics | `/api/v1/sales-monitoring/context`, `/api/v1/sales-analytics/dashboard`, `/api/v1/sales-analytics/cash-flow`, `/api/v1/sales-analytics/pnl` |
| Imports/approvals/requests | `/api/v1/imports`, `/api/v1/imports/[id]`, `/api/v1/imports/[id]/commit`, `/api/v1/operation-approvals/[id]/decision`, `/api/v1/product-requests`, `/api/v1/product-requests/[id]/resolve` |
| Metrics | `/api/v1/metrics`, `/api/v1/metrics/catalog`, `/api/v1/metrics/[id]/anomalies`, `/forecast`, `/goals`, `/timeseries` |
| Platform | `/api/health`, `/api/inngest` |

Сокращённые хвосты `/assign`, `/comments`, `/block`, `/forecast` и подобные в таблице относятся к полному префиксу маршрута, указанному перед ними.

## 4. Findings

| ID | Приоритет | Наблюдение / воспроизведение | Статус и исправление |
|---|---|---|---|
| F-01 | P0 | Onboarding мог восстановить устаревший local draft поверх более свежих server answers | Исправлено: `saved_at`, user-scoped key, version, deterministic conflict resolution |
| F-02 | P1 | Ошибка сохранения/recalculate могла не остановить переход шага или очистку черновика | Исправлено: проверка HTTP/envelope, visible error, очистка только после подтверждённого финала |
| F-03 | P0 | Повтор после потерянного ответа create/post продажи мог создать дубль | Исправлено: durable operation с exact payload, стабильными create/finalize idempotency keys и resource id |
| F-04 | P1 | Refresh очищал sale/expense/plan draft | Исправлено: versioned local draft и восстановление активной операции |
| F-05 | P1 | Sales filters не всегда влияли на выдачу и не переживали navigation | Исправлено: URL — источник истины для tab/org/date/region/channel; добавлена date validation |
| F-06 | P1 | Ошибка sales data выглядела как реальный ноль/пустая таблица | Исправлено: unavailable `—`, banner, retry и stale-data semantics |
| F-07 | P1 | Owner/expert на 360–768 px теряли боковую навигацию | Исправлено: `RoleMobileNav`, четыре вкладки + drawer, active state, body scroll lock, нижний padding |
| F-08 | P1 | Login redirect терял query и допускал ненадёжный `from` | Исправлено: middleware сохраняет pathname+search; login принимает только внутренний безопасный путь |
| F-09 | P1 | Owner client/admin links могли уйти в `/clients` или `/admin` без `/owner` | Исправлено: route-aware base path и owner-prefixed links |
| F-10 | P1 | Недоступная Prisma/Supabase приводила к crash или ложному empty/healthy | Исправлено для dashboard, market, analytics, insights, intelligence, Point A, notifications, team, reports, clients и owner detail |
| F-11 | P1 | Документы onboarding скрывали list/bootstrap errors, год заканчивался 2025, orphan-файл оставался после DB failure | Исправлено: retry/error states, динамический текущий год, compensating delete, input reset |
| F-12 | P1 | Waiting room показывал `pending` до подтверждённого ответа | Исправлено: начальный status `null`, timestamp только успешной проверки, last known + retry |
| F-13 | P1 | Client Point A скрывал ошибки recalculate/load | Исправлено: строгая проверка ответа, stale result сохраняется, ошибка и retry видимы |
| F-14 | P1 | Активные на вид no-op controls и fake success | Исправлено/отключено на settings, reports, market, Point A, client detail, pulse, competitors, admin и headers |
| F-15 | P1 | Admin/owner/expert dashboard, GRI и insights показывали зашитые KPI, задачи, события и выводы как данные аккаунта | Исправлено: demo-значения удалены или заменены честным unavailable/read-only с рабочими переходами |
| F-16 | P2 | React Query cache сам по себе не персистентен | Принято: критические формы не полагаются на cache; они имеют отдельный local/durable state |
| F-17 | P1 | Reports upload сохраняет файл в `public/uploads` эфемерной Vercel-функции | Не исправлено без продуктового решения; требуется object storage |
| F-18 | Blocked | Полные integration tests требуют `DATABASE_URL` и тестовую БД | Окружение отсутствует; зафиксировано без ложного зелёного статуса |
| F-19 | OOS | Giga Sidebar logout не имеет обработчика; два legacy RBAC expectation не совпадают с middleware | Не менялось: auth/RBAC/security исключены заданием |

## 5. Матрица хранения и восстановления состояния

| Состояние | Source of truth | Локальная копия | Refresh | Закрытие/повторное открытие | Конфликт / ошибка |
|---|---|---|---|---|---|
| Onboarding answers | Supabase survey | `localStorage`, version 2, ключ user id | восстанавливается | восстанавливается | более свежий `saved_at` выигрывает; конфликт сообщается |
| Onboarding step | server + local current step | тот же draft | сохраняется | сохраняется | нормализация 1–6 |
| Onboarding company id | server company | scoped draft, legacy fallback | восстанавливается | восстанавливается | invalid JSON игнорируется, затем server lookup |
| Pending onboarding file | browser `File` | нет | теряется | теряется | ожидаемо: браузер не может долговечно хранить выбранный файл |
| Uploaded documents | Supabase Storage + DB metadata | нет | перечитывается | перечитывается | DB failure запускает Storage cleanup |
| Sale/expense/plan form | пользовательский draft | versioned localStorage | восстанавливается | восстанавливается | не очищается при ошибке |
| Active create/post operation | server operation + local durable envelope | exact payload, stable keys, resource id | retry без нового key | retry без нового key | повтор завершает ту же операцию |
| Sales tab/org/date/region/channel | URL query | история браузера | сохраняется | ссылка воспроизводима | invalid dates дают явную validation error |
| Client search/status/industry/sort | URL query | история браузера | сохраняется | ссылка воспроизводима | unknown значения нормализуются |
| Insights/intelligence/admin tab | URL query | история браузера | сохраняется | ссылка воспроизводима | fallback к допустимому значению |
| Metrics selection | Zustand persisted store | localStorage | сохраняется | сохраняется | пользовательский scope зависит от store |
| Widget layout | UI store | localStorage, по user id при наличии | сохраняется | сохраняется | без user id используется общий fallback |
| Query data | server / React Query memory | память вкладки | refetch | не гарантируется | stale data остаётся в текущей сессии |
| Notifications | server query | UI store не является долговечным источником | refetch | refetch | outage не равен empty |
| Auth session | Supabase cookies | управляется Supabase | сохраняется | сохраняется по правилам session | вне scope |
| Reports file | сейчас local filesystem функции | нет надёжной копии | ненадёжно | ненадёжно | требует object storage |

## 6. Изменённые файлы

Ниже перечислены намеренные изменения аудита. `pnpm-lock.yaml` и `pnpm-workspace.yaml` не относятся к функциональному результату и не должны включаться в будущий commit без отдельного решения.

| Файл | Изменение | Побочный эффект / проверка |
|---|---|---|
| `app/(auth)/login/page.tsx` | безопасное восстановление `from` | deep link после login |
| `app/(auth)/login/return-path.ts` | чистая функция валидации внутреннего пути | unit test |
| `middleware.ts` | pathname + query в login redirect | integration assertion добавлен |
| `tests/unit/login-redirect.test.ts` | safe/unsafe return-path cases | 8 unit checks в составе suite |
| `tests/integration/middleware.test.ts` | query-preservation cases | 2 старых RBAC test остаются OOS |
| `app/client/onboarding/page.tsx` | bootstrap, autosave, step, failures, conflict UI | type/lint/unit |
| `lib/onboarding-draft.ts` | version/key/step/conflict helpers | unit test |
| `app/api/v1/onboarding/survey/route.ts` | `saved_at` GET и refresh timestamp POST | conflict resolution |
| `tests/unit/onboarding-draft.test.ts` | step, scoped key, stale/new conflict | unit pass |
| `app/client/onboarding/documents/page.tsx` | bootstrap/list retry, cleanup, year, accessibility | scoped key first, legacy fallback |
| `app/client/dashboard/page.tsx` | error/empty/retry и честные отсутствующие score | type/lint |
| `app/client/point-a/page.tsx` | strict response, retry, stale result | no silent failure |
| `app/client/waiting-room/page.tsx` | null/last-known status и retry | no fake pending |
| `components/sales-monitoring/client.ts` | durable draft/operation/idempotency helpers | unit test |
| `components/sales-monitoring/SalePanel.tsx` | restore/retry/double-click guard | stable create/post |
| `components/sales-monitoring/OperationsPanel.tsx` | expense/plan/import draft semantics | error does not clear |
| `components/sales-monitoring/SalesMonitoringWorkspace.tsx` | URL state, working filters, unavailable state | browser history friendly |
| `types/sales-monitoring.ts` | region/channel fields | type-check |
| `lib/sales-monitoring/sales-service.ts` | mapping region/channel | type-check |
| `tests/unit/sales-monitoring-client-state.test.ts` | lost response and persistence cases | unit pass |
| `components/layout/RoleMobileNav.tsx` | mobile tabs + all-sections drawer | 360–768 source/viewport audit |
| `app/(owner)/layout.tsx` | owner mobile nav и content padding | avoids bottom overlap |
| `app/(expert)/layout.tsx` | expert mobile nav и content padding | avoids bottom overlap |
| `app/(dashboard)/layout.tsx` | mobile bottom padding | avoids fixed-nav overlap |
| `components/layout/OwnerHeader.tsx` | notification becomes a real link | static route scan |
| `components/layout/ExpertHeader.tsx` | unavailable notification disabled | no misleading click |
| `lib/navigation.ts` | duplicate market monitoring item removed | alias route retained |
| `app/(owner)/owner/dashboard/page.tsx` | hardcoded GRI/limits removed; honest data states | account data no longer invented |
| `app/(owner)/owner/gri/page.tsx` | hardcoded report/history/actions removed or labelled unavailable | account data no longer invented |
| `app/(expert)/expert/dashboard/page.tsx` | demo KPI/tasks/activity removed | honest expert landing |
| `app/(expert)/expert/gri/page.tsx` | demo score/history removed | honest unavailable/read-only |
| `app/(expert)/expert/insights/page.tsx` | demo insight feed removed | honest unavailable/read-only |
| `app/(dashboard)/dashboard/page.tsx` | DB outage, fake growth target/GRI/activity и false healthy удалены | local HTTP smoke |
| `components/dashboard/WidgetGrid.tsx` | fake client statistics removed; empty data sources labelled honestly | type/lint |
| `app/(dashboard)/analytics/page.tsx` | offline banner and unavailable values | local HTTP smoke |
| `app/(dashboard)/market/page.tsx` | fake market sizing/trends/signals removed | honest counters |
| `app/(dashboard)/insights/page.tsx` | DB catch + URL filter | retry/empty distinction |
| `app/(dashboard)/intelligence/page.tsx` | DB catch + URL filter | retry/empty distinction |
| `app/(dashboard)/notifications/page.tsx` | outage banner | no false empty |
| `app/(dashboard)/point-a/page.tsx` | mock domains/client/health removed | controls disabled honestly |
| `app/(dashboard)/pulse/page.tsx` | fake actions/save/target removed, API validation | error/empty/retry |
| `app/(dashboard)/reports/page.tsx` | DB failure handling and honest UI | upload storage unresolved |
| `app/(dashboard)/settings/page.tsx` | real values/read-only controls | no fake save |
| `app/(dashboard)/team/page.tsx` | DB failure handling | no false empty |
| `app/(dashboard)/competitors/page.tsx` | unused crashing queries removed, no-op disabled | offline render |
| `app/(dashboard)/clients/page.tsx` | robust load + URL filter/sort | unit helper |
| `app/(dashboard)/clients/[id]/page.tsx` | fake company/summary/scores removed | unsupported controls disabled |
| `components/clients/ClientFilters.tsx` | URL-backed filters | back/forward support |
| `components/clients/ClientsTable.tsx` | real loading/error/empty/sort | retry |
| `lib/client-directory.ts` | filter/sort normalization helper | unit test |
| `tests/unit/client-directory.test.ts` | client filter/sort cases | unit pass |
| `app/(owner)/owner/clients/page.tsx` | owner-aware scope | correct detail route |
| `app/(owner)/owner/clients/[id]/page.tsx` | DB catch/not-found/offline | local HTTP smoke |
| `app/(dashboard)/admin/page.tsx` | URL tabs, fake KPI/activity/insight removed | no-op disabled |
| `app/(owner)/owner/admin/page.tsx` | owner base path | links remain under `/owner` |
| `components/dashboard/admin/AdminClientsList.tsx` | basePath, strict fetch, retry/empty | no fake manager |
| `app/(dashboard)/profile/page.tsx` | redirect to settings | removes dead duplicate form |
| `app/(owner)/owner/profile/page.tsx` | fake role/GRI fallback removed | real profile only |
| `app/(expert)/expert/profile/page.tsx` | real read-only profile | fake editing/security disabled |
| `app/(expert)/expert/reports/page.tsx` | fake archive/upload removed | honest read-only |
| `components/dashboard/ActivityFeed.tsx` | narrow-width horizontal safety | responsive |
| `components/dashboard/AddMetricModal.tsx` | stable memoized Set | lint warning removed |
| `docs/audit-userflow-ui-routing-reliability-2026-07-28.md` | настоящий отчёт | этот файл |

## 7. Результаты проверок

| Проверка | Результат | Комментарий |
|---|---|---|
| `tsc --noEmit` | PASS | ошибок типов нет |
| ESLint | PASS | warnings/errors нет |
| Unit tests | PASS | 7 файлов, 43/43 теста |
| Full Vitest | PARTIAL / BLOCKED | 16 файлов: 8 passed, 8 failed; 59/72 теста passed |
| DB-dependent failures | BLOCKED | 11 failures из-за отсутствующего `DATABASE_URL`/test DB: analytics, auth, dashboard, password reset, pulse, reports, settings |
| Legacy middleware expectations | OOS | 2 failures относятся к RBAC/auth поведению, исключённому заданием |
| Production build | PASS | сборка завершена с placeholder env; сгенерировано 83 routes |
| Build warnings | WARN | `pdf-parse` dynamic dependency, большой webpack cache string, dynamic server usage для KPI, ожидаемые ошибки fake Supabase host |
| `git diff --check` | PASS | whitespace/conflict-marker проблем нет |
| Static route scan | PASS | 61 page routes, 81 статический переход, 0 unresolved |
| Native no-op button scan | PASS с OOS | 1 кандидат: Giga logout, auth вне scope |
| Local HTTP smoke | PASS | 19/19 route-запросов получили HTTP 200 с legacy test cookie |
| Offline UI assertions | PASS | 11/11 server-rendered состояний: dashboard, market, analytics, Point A, reports, team, notifications, owner invalid client, expert reports/GRI/insights |
| Fake-value negative assertions | PASS | 4/4: старые `$2M`, `4.59`, `TechStart KZ`, `₸28.4М` отсутствуют в соответствующих dashboard responses |
| Browser responsive — local auth pages | PASS | `/login` и `/register`: 360/375/768/1024/1440, горизонтального overflow нет |
| Browser responsive — authenticated Preview owner dashboard | BASELINE VERIFIED | overflow нет; на 360/375/768 подтверждено отсутствие боковой навигации в Preview |
| Local protected-page visual check | NOT EXECUTED | локальный браузер не имел authenticated session; auth не обходился |

Локальная production-сборка проверялась с заведомо недоступным DB endpoint. Это подтвердило компиляцию и graceful UI degradation, но не заменяет интеграционный прогон с реальной staging БД.

## 8. Продуктовые вопросы и рекомендации

### Q1. Где постоянно хранить загруженные отчёты?

Сейчас `app/actions/reports.ts` пишет в `public/uploads`. Для Vercel это эфемерная файловая система: файл может исчезнуть после нового instance/deploy.

**Рекомендация:** Supabase Storage, потому что он уже используется onboarding-документами. Хранить в БД storage path и metadata, выдавать signed URL, при ошибке DB выполнять compensating delete. Альтернатива — Vercel Blob, если команда хочет единый Vercel billing/operations.

### Q2. Что должен показывать owner dashboard: диагностику одной компании или портфель?

В коде одновременно присутствовали персональный GRI owner и admin-подобная портфельная сводка.

**Рекомендация:** для роли owner закрепить одну организацию и её current diagnostic; портфельные KPI оставить admin. Пока модель не утверждена, показывать честный unavailable/empty и рабочие переходы, а не demo score.

### Q3. Откуда expert получает GRI, задачи, activity и insights?

API-контракт для expert dashboard не определён, поэтому старый UI содержал статические KPI и события.

**Рекомендация:** сначала read-only агрегатор назначенных организаций с явным `updated_at`; задачи — отдельный server resource. До этого не показывать демонстрационные значения без видимого режима Demo.

### Q4. Нужен ли официальный Demo Mode?

Несколько экранов использовали презентационные цифры без маркировки.

**Рекомендация:** если demo нужен для продаж, сделать явный переключатель/отдельный tenant с постоянным badge «Демо-данные». В production-tenant любые неподтверждённые метрики показывать как `—`.

### Q5. Какой контур использовать для integration tests?

**Рекомендация:** отдельный disposable PostgreSQL/Supabase проект в CI, миграции перед suite, transaction rollback после каждого теста. Не запускать эти тесты против production.

### Q6. Должна ли expert reports быть полноценным workflow?

Сейчас страница честно read-only, потому что archive/upload не имели устойчивого backend-контракта.

**Рекомендация:** на первом этапе подключить общий Reports Hub с role-aware read-only выдачей; mutation workflow добавлять только вместе с постоянным storage и серверными статусами.

## Итоговая готовность

**Навигация и критические пользовательские черновики:** готовы к staging-проверке.

**Поведение при недоступной БД:** существенно улучшено и локально подтверждено.

**Production release:** условно не готов до решения reports storage и зелёного integration suite на staging/test DB.

**Auth/RBAC/security:** не оценивались и не должны считаться подтверждёнными этим аудитом.
