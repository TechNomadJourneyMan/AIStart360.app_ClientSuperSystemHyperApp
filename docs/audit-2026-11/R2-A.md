# R2-A — честный пейволл и одна система гейтов тарифа

Исполнитель: R2-A, Раунд 2. Ветка `claude/round2-paywall-experts`, worktree `multi-agent-portal-dev-8f4869`. **Не закоммичено, не запушено, ничего не применялось к staging/проду.** Тумблер `access_gates` в данных и его значение по умолчанию (`false`) не менялись.

Решение фаундера (подтверждено PO): Точка А, Точка Б, Рынок и полный GRI — только платным клиентам; Free вместо тупика получает честный пейволл с заявкой на доступ. Оплата остаётся намеренной заглушкой.

---

## 0. ВАЖНО перед выкаткой (прод)

По данным оркестратора, на проде `system_settings.access_gates = true`. Значит, **сразу после выкатки этого кода у всех Free-клиентов закроются Точка А, Рынок и полный GRI** (включая прежний бесплатный демо-проход GRI). Точка Б на проде для Free закрыта уже сейчас. Оплаты нет, Pro выдаётся только вручную, поэтому Free на проде может оказаться большинство клиентов, в том числе те, кто сейчас пользуется Точкой А.

До выкатки PO нужно выбрать одно из двух:
1. Проверить список клиентов с `profiles.tier = 'free'` и назначить Pro тем, кому доступ нужно сохранить (User 360 → Биллинг, `lib/payments/billing.ts`). Точечно можно открыть и через «Фичи» в User 360: там появились «Точка А» и «Рынок».
2. Или выключить `access_gates` на время перехода. Тогда открыто всё, как сейчас без гейтов.

Миграцию 144 применять вместе с выкаткой: код работает и без неё, она только закрывает гонку двух одновременных кликов.

---

## 1. Аудит: как было (Free, гейты ВКЛЮЧЕНЫ, как на проде)

Тариф: одно поле `profiles.tier` плюс per-user `feature_flags` (миграции 048 и 106; биллинг пишет tier одной транзакцией). Решений «платно/бесплатно» было несколько, и они расходились:
- серверный `gateFeature` (только `point_b`, `ai_chat`) и отдельный счётчик проходов в `gri/assessment`;
- клиентский `PointBAccessGate`;
- замки «Pro» в старом сайдбаре и MobileNav: `/point-b` по праву, `/market` и `/metrics` по tier, без серверного гейта;
- `UpgradeGate` со ссылкой «Посмотреть тарифы» на страницу биллинга, где оплаты нет;
- в меню кабинета (`lib/client-shell/nav.ts`) тариф не учитывался вообще.

| Функция | Страница | API | Итог для Free |
|---|---|---|---|
| **Точка А** | `/client/point-a`, `/point-a`, `/point-a/insights` — без гейта; на главной полная сводка Точки А | все 17 `/api/v1/point-a/*` и `diagnostics/current`, `ai-status`, `retry-ai` — без гейта; `diagnostics/recalculate` возвращал полную Точку А; PDF `export/report?type=point-a` и публичная ссылка `/api/share` — без гейта | Полностью доступна, вопреки решению |
| **Точка Б** | `/client/point-b`: клиентский гейт → скелетон → `PointBPaywall` («на тарифе Pro», кнопка «Узнать о Pro») | 402 на `diagnostics/point-b`, `ai-generate`, `point-b/*`, what-if. Без гейта: `diagnostics/point-b/ai-status` (отдавал `ai_strategy`), PDF `export/report?type=point-b`, `/api/share` | Закрыта, но данные утекали через ai-status, PDF и share |
| **Рынок** | `/market`, `/market/analysis` — без гейта; замок «Pro» только в старом сайдбаре (по tier), прямой URL открывал всё, и сессия кабинета передавалась в iframe Mark-analytics | прокси `/api/market/*`, `/api/v1/market-analysis` (+`generate`, платный ИИ) — без гейта | Замок в меню — фикция, по URL и API всё открыто |
| **Полный GRI** | `/gri` открыт; 1 демо-проход (`gri_free_runs`), потом `UpgradeGate` → «Посмотреть тарифы» → биллинг без оплаты (тупик) | 402 только на POST `gri/assessment` после лимита. GET результата, drafts, calc-sessions, plan-progress, reality-check и платные ИИ (`/api/gri/ai-strategy`, `financial-analyst`) — без гейта | Результат и платный ИИ открыты, повторный проход упирался в тупик |

**Заявка на доступ** (`POST /api/v1/upgrade-request`):
- дублей никто не отсекал: каждый клик — новая строка;
- запасной путь без Prisma вставлял строку без `id` и `"updatedAt"` (NOT NULL без default) и падал;
- **в ГИГА «Заявки» эти заявки не видны**: `GET /api/giga-admin/requests` сортирует `admin_requests` по `created_at`, а у Prisma-таблицы колонка `"createdAt"`. Чтение падает, и все строки `admin_requests` молча отбрасываются (остаются только «осиротевшие» профили).

Это установлено по коду и схеме локальной тест-БД, на проде не проверял.

**Что бесплатно и осталось бесплатным:** регистрация; анкета, включая экспресс-режим и «Снимок бизнеса»; мини-GRI `/gri-free`; сообщения; документы; профиль и настройки; Пульс; мини-CRM; цели в анкете; PDF и публичная ссылка по анкете (`type=survey`).

---

## 2. Что сделано: одна система

### Один источник тарифа и одно решение
- `lib/access/entitlements.ts` — новые права `point_a` и `market`. У Free `point_a`, `point_b`, `market` и `gri_full` = false (демо-прохода GRI больше нет). `PAID_SECTIONS` — четыре платных раздела. Override `feature_flags` понимает новые ключи.
- **`lib/access/decision.ts`** — ОДНА функция решения. Порядок проверки:
  1. тумблер выключен → открыто;
  2. право по тарифу или override → открыто;
  3. персонал сессии (правило миграции 140: `staff_roles` или активный эксперт, второй фактор; `getSessionStaff`) → открыто;
  4. иначе → 402.

  При входе «от имени» сессия клиентская, поэтому гейт действует как для клиента. Персонал читается только на пути отказа; ошибка чтения закрывает доступ (fail closed). `decideFeature` и `decideSections` — чистые функции; `resolveFeature` и `resolveAccess` — серверные.
- `lib/access/gate.ts` — `gateFeature`, `gatePaidSection` (персонал всегда проходит) и `upgradeRequiredResponse`. Один ответ 402 для всех платных API: `{ ok:false, error:'upgrade_required', feature, message }`.
- `lib/access/request-access.ts` — одно решение на серверный рендер; его используют layout, главная и гейт страницы.
- `GET /api/v1/access/me` возвращает тот же ответ для UI: `sections{point_a,point_b,market,gri_full}` (решение), `staff`, `entitlements` (собственные права). `hooks/useEntitlements.ts` берёт `sections`. `isSectionLocked` в старом меню: `/point-a`, `/point-b`, `/market`, `/gri` — по решению сервера; `/metrics` — по tier, как было.

### Страница + API (данные не утекают)
- **Страницы** (серверный `components/access/FeatureGate.tsx`; закрыто → пейволл, код раздела не монтируется, данных не запрашивает):
  - `/client/point-a`, `/point-a`;
  - `/point-a/insights` и редирект `/client/point-a/insights` (через layout);
  - `/client/point-b` (layout; клиентский `PointBAccessGate` остался как запасной путь);
  - `/market`, `/market/analysis`, `/gri`. `/gri/methodology` оставлена открытой.
- **API → 402** (до любого чтения данных):
  - Точка А: все 17 роутов `/api/v1/point-a/*` (в benchmarks — только сравнение со своей Точкой А), `diagnostics/current`, `ai-status`, `retry-ai`;
  - Точка Б: добавлен `diagnostics/point-b/ai-status`;
  - Рынок: прокси `/api/market/*` (до запроса наверх), `market-analysis` GET/PATCH, `generate`;
  - полный GRI: `gri/assessment` GET/POST (лимит проходов теперь только у Free с индивидуально открытым GRI), `draft` (все методы), `calc-sessions`, `plan-progress`, `reality-check`, `/api/gri/ai-strategy`, `/api/gri/financial-analyst`;
  - публичные ссылки и PDF платных разделов: `POST /api/share` (`point_a`/`point_b`/`gri`) и `GET /api/export/report` (`point-a`/`point-b`/`gri`). Анкета (`survey`) не гейтится.
- **Экспресс-оценка осталась бесплатной.** `GET /api/v1/point-a/state?view=express` отдаёт Free только поля карточки «Снимок бизнеса» (`expressPointASlice` в `lib/survey/snapshot.ts`), без истории, целей, бенчмарков, метрик, проверок и заметок эксперта. `usePointAView` запрашивает именно этот вид.
- `diagnostics/recalculate` остался бесплатным (его запускают анкета и экспресс), но Free в ответе не получает цифр Точки А.

### Один пейволл
- **`components/access/Paywall.tsx`** и модель `components/access/paywall-model.ts`, варианты `page` и `compact`. Что показывает:
  - что раздел платный и что в него входит;
  - что остаётся бесплатно (со ссылками);
  - честная строка «Онлайн-оплата пока не подключена: доступ открывает менеджер после связи с вами»;
  - одну кнопку **«Оставить заявку на доступ»** → «Заявка отправлена, с вами свяжутся».

  Состояние заявки читается на сервере (без мигания) или один раз при монтировании.
- `PointBPaywall` и `UpgradeGate` (файлы сохранены) теперь рендерят этот же пейволл. Ссылка на биллинг без оплаты убрана.
- Вместо вечной загрузки и «Не удалось загрузить… Повторить»:
  - `usePointAState` отдаёт `locked` на 402 → `PointAV4Page` и `PointADashboardSummary` показывают пейволл;
  - `GriSection` на 402 показывает пейволл;
  - лента вопросов на `/dashboard` скрывается, потому что на странице уже есть карточка пейволла Точки А;
  - `DashboardKeyMetrics` уже падал в «платформенные карточки».
- Главная `/client/home`: сервер решает сам (`paidLocked`), карточки Точки А и GRI заменяются компактным пейволлом, их данные не запрашиваются. В плитках у балла Точки А и индекса GRI подпись «подробный разбор / полный GRI — в платном доступе».
- Меню кабинета: у закрытых Точки А, Точки Б и GRI значок замка (`ClientNav`, `buildClientNav({lockedKeys})`); пункт ведёт на страницу с пейволлом. Старые Sidebar и MobileNav: подписи «Точка А», «Полный GRI»; MobileNav больше не пишет «отправлено» при ошибке.

### Заявка на доступ — существующий механизм `admin_requests`
- **`lib/access/upgrade-requests.ts`**: `type='access'`, `source='paywall'`, `status='new'`, `payload{userId, featureKey, features[], name, email, company, subject, description}`. Колонки Prisma (`"createdAt"`/`"updatedAt"`, свой `id`) учтены.
  - **Одна открытая заявка на клиента.** Повтор не создаёт строку: раздел дописывается в `features` существующей заявки. Старая открытая `upgrade_modal` тоже считается открытой. После одобрения, отклонения или архива можно подать новую.
  - Гонку двух кликов закрывает индекс миграции 144: при 23505 код дописывает раздел в победившую заявку.
- `POST /api/v1/upgrade-request`:
  - пользователь только из сессии; rate-limit (R-225) и валидация сохранены;
  - «от имени» → 403: заявку оставляет сам клиент;
  - ошибка записи → 500, а не «отправлено».
- `GET /api/v1/upgrade-request` возвращает `{requested, features}`.
- **ГИГА «Заявки» → «Доступы»**: в `GET /api/giga-admin/requests` добавлено отдельное корректное чтение заявок на платный доступ (`"createdAt"`, `"rejectionReason"`). Заявка тарифа больше не скрывает строку регистрации клиента. Бейдж «Pro» показывается и для `source='paywall'`.
- **Решение по заявке тарифа** (`lib/users/access-requests.ts`) только закрывает заявку. Оно не меняет `profiles.status` и не шлёт уведомление «клиент одобрен». Иначе «одобрить заявку на Pro» от ещё не одобренного клиента (GRI открыт до одобрения) одобрило бы его регистрацию. Тариф назначается в User 360 → Биллинг.

### Настройки
- `lib/settings/registry.ts`: обновлены только тексты подсказок `access_gates` и `gri_free_runs`, значения и default не трогал. `gri_free_runs` теперь действует лишь для Free с индивидуально открытым полным GRI.
- В User 360 «Фичи» добавлены «Точка А» и «Рынок».

### Миграция
- `supabase/migrations/144_access_request_dedup.sql` — уникальный частичный индекс `admin_requests_open_paywall_per_user` на `(payload->>'userId')` для `type='access' AND source='paywall'` и открытых статусов. Идемпотентна. Старые строки `upgrade_modal` не покрыты, поэтому индекс строится даже при старых дублях; данные не меняются.
- Откат: `supabase/migrations/rollback/144_access_request_dedup.down.sql` (DROP INDEX).
- Проверено **на локальной тест-БД** (127.0.0.1:54329): применение, повторное применение (skip), откат, повторное применение — всё ОК.
- R2-B взял номер 145, конфликта нет.

---

## 3. Тесты и результаты

Новые тесты:

| Файл | Что проверяет | Итог |
|---|---|---|
| `tests/unit/access/decision.test.ts` | Чистое решение по 4 разделам: тумблер, Free/Pro, override, персонал по правилу 140, «от имени» = клиент, ошибка роли → закрыто, персонал читается только на пути отказа, единая форма 402 | 15 ✓ |
| `tests/unit/access/paid-api-gates.test.ts` | **47 платных API** (Точка А, ai-status Точки Б, Рынок, полный GRI, share/export): Free → 402 `upgrade_required` с нужной `feature` и **ноль чтений из БД** (47 тестов); Pro, персонал и гейты выключены → не 402 (47 тестов); 401 остаётся 401; лимит проходов GRI для индивидуально открытого Free; Pro и персонал без лимита; share/PDF анкеты бесплатны. Мутационная проверка: снятый гейт в одном роуте валит тест | 98 ✓ |
| `tests/unit/access/paid-routes-coverage.test.ts` | Контракт: каждый `route.ts` в папках платных разделов вызывает гейт со своей фичей, либо внесён в список исключений с причиной | 54 ✓ |
| `tests/unit/access/point-a-express.test.ts` | Free: полная Точка А → 402; `?view=express` → только поля «Снимка» (проверено, что нет history, goals, benchmarks, checks, заметок); Pro / гейты выключены → полный ответ | 5 ✓ |
| `tests/unit/access/recalculate-redaction.test.ts` | Пересчёт бесплатен, но без цифр Точки А для Free; Pro, персонал и гейты выключены — полный ответ | 2 ✓ |
| `tests/unit/access/upgrade-requests.test.ts` | Создание заявки (тип, источник, статус, payload, честное описание); повтор без дубля; новый раздел дописывается; старая `upgrade_modal` считается открытой; закрытая не мешает; чужие заявки и регистрации не трогаются; гонка через 23505; ошибка записи → исключение; POST: дубль → `duplicate:true`, userId из тела игнорируется, «от имени» → 403, ошибка → 500; GET requested | 13 ✓ |
| `tests/unit/access/paid-access-request-decision.test.ts` | «Одобрить» заявку тарифа не меняет `profiles.status` (даже у ожидающего одобрения) и не шлёт уведомления; «отклонить» сохраняет причину; регистрация идёт старым путём; на свою заявку решение запрещено; ГИГА-список показывает заявку в «Доступы» и не прячет регистрацию | 5 ✓ |
| `tests/unit/access/paywall-ui.test.ts` | Пейволл каждого раздела: заголовок, «что входит», строка про оплату, кнопка активна, нет «Оплатить/Купить»; ссылки на бесплатное; «Заявка отправлена»; кнопка ждёт статус; компактный вариант; `UpgradeGate` без ссылки на биллинг; модель (send/read/402). `FeatureGate`: закрыто → пейволл без контента раздела, открыто → раздел, ошибка решения не ломает страницу. Меню: замки | 20 ✓ |
| `tests/unit/access/home-paywall.test.ts` | Главная Free: компактные пейволлы вместо сводки Точки А и GRI, их компоненты не монтируются; бесплатное остаётся | 2 ✓ |
| `tests/integration/db/access-request-dedup.test.ts` | Реальная схема тест-БД: индекс есть, вторая открытая paywall-заявка → 23505, закрытые не мешают, `upgrade_modal` и регистрации не ограничены. Мутационная проверка: после отката индекса 2 теста падают | 4 ✓ |

Обновлённые существующие тесты (ожидания под новое решение):
- `entitlements.test.ts` — Free без демо-прохода, новые права;
- `premium-locks.test.ts` — Рынок по праву, Точка А и GRI;
- `point-b-gate.test.ts` — новый текст пейволла и сообщения, персонал через `getSessionStaff`;
- `finmodel-ui.test.ts`, `whatif-ui.test.ts` — новый заголовок пейволла;
- `upgrade-request-hardening.test.ts` — R-225 на новом хранилище;
- `home-page-speed.test.ts` — главная передаёт решение;
- `route-auth.manifest.ts` — добавлен `GET` у upgrade-request.

**Итоги прогонов:**
- Набор R2-A (16 файлов, включая существующие `actor-scope-routes`, `point-b-gate`, `entitlements`, `premium-locks`, `home-page-speed`, `upgrade-request-hardening`): **365 / 365 ✓**.
- Полный прогон `~/.a360-test/vt.sh --reporter=dot`: **8527 passed, 2 failed, 14 skipped** (776 файлов). Оба падения — известные тесты моста WhatsApp (нет пакета baileys), не чинил. Прогон шёл вместе с незакоммиченными изменениями R2-B в том же worktree.
- **tsc** (`--max-old-space-size=5120`): **0 ошибок**.
- **lint**: **0 предупреждений и ошибок**.

**Не проверено руками в браузере**: `.env.local` смотрит в staging, а локального GoTrue/PostgREST нет. Поднимать dev-сервер против staging (и писать там заявки) по правилам нельзя. UI проверен рендер-тестами (`renderToStaticMarkup`), клики — через модель. `next build` не запускал (память; R2-B работает параллельно).

---

## 4. Изменённые файлы (R2-A)

**Новые:**
- `lib/access/decision.ts`, `lib/access/request-access.ts`, `lib/access/upgrade-requests.ts`;
- `components/access/Paywall.tsx`, `components/access/paywall-model.ts`, `components/access/FeatureGate.tsx`;
- `app/(dashboard)/point-a/insights/layout.tsx`, `app/client/point-b/layout.tsx`;
- `supabase/migrations/144_access_request_dedup.sql`, `supabase/migrations/rollback/144_access_request_dedup.down.sql`;
- тесты из раздела 3 и вспомогательный `tests/unit/access/fake-admin-requests.ts`.

**Изменённые — ядро:**
- `lib/access/entitlements.ts`, `lib/access/gate.ts`;
- `app/api/v1/access/me/route.ts`, `hooks/useEntitlements.ts`, `hooks/usePointAState.ts`.

**API:**
- Точка А: `app/api/v1/point-a/*` — aggregate, benchmarks, block/[key], config, filters, insights, insights/[id], insights/ai-generate, loss-map, narrative, overview, recalculate, retention-curve, segments, state, top-table, v3;
- diagnostics: `app/api/v1/diagnostics/{current,ai-status,retry-ai,recalculate,point-b/ai-status}`;
- Рынок: `app/api/market/[...path]`, `app/api/v1/market-analysis` (+`generate`);
- полный GRI: `app/api/v1/gri/{assessment,draft,calc-sessions,calc-sessions/[id],plan-progress,reality-check}`, `app/api/gri/{ai-strategy,financial-analyst}`;
- `app/api/share`, `app/api/export/report`;
- заявки: `app/api/v1/upgrade-request`, `app/api/giga-admin/requests`;
- `app/api/giga-admin/users/[id]/access` (только комментарий).

**Страницы и UI:**
- страницы: `app/client/point-a/page.tsx`, `app/(dashboard)/point-a/page.tsx`, `app/(dashboard)/market/page.tsx`, `app/(dashboard)/market/analysis/page.tsx`, `app/(dashboard)/gri/page.tsx`, `app/client/home/page.tsx`, `app/client/layout.tsx`;
- компоненты: `components/access/UpgradeGate.tsx`, `components/point-b/PointBPaywall.tsx`, `components/point-a-v4/PointAV4Page.tsx`, `components/dashboard/PointADashboardSummary.tsx`, `components/user-dashboard/{UserHome,GriSection}.tsx`, `components/point-a/v2/{InsightsFeed.tsx,useInsightsFeed.ts}`, `components/onboarding/express/usePointAView.ts`, `components/client/ClientNav.tsx`, `components/layout/{Sidebar,MobileNav}.tsx`, `components/giga-panel/{RequestsModule,UserDetailPanel}.tsx`;
- `lib/client-shell/{nav,server}.ts`, `lib/survey/snapshot.ts`, `lib/users/access-requests.ts`.

**Общие файлы:**
- `lib/settings/registry.ts` — только 2 строки help;
- `tests/contracts/route-auth.manifest.ts` — 1 строка.

`middleware.ts` и `lib/admin/rbac.ts` не трогал. Область R2-B (`lib/expert-review/*`, эскалации, кабинеты эксперта) не трогал. Ничего не удалено.

---

## 5. Что не сделано / ограничения (честно)

1. **Прямое чтение через Supabase (RLS).** Free со своим JWT и публичным anon-ключом всё ещё может прочитать свои строки `point_a_snapshots`, `diagnostics`, `gri_assessments` напрямую через PostgREST. Пейволл закрывает страницы и API портала, но не уровень БД. Закрыть уровень данных можно RLS по тарифу, но это большая миграция, и она ломает бесплатный «Снимок» и главную. Это предложение, не делал.
2. **Mark-analytics.** Если Free откроет SPA Рынка напрямую (`NEXT_PUBLIC_MARKET_APP_URL`) и войдёт там, FastAPI-бэкенд проверяет только JWT, но не тариф. Нужна проверка `profiles.tier` и `feature_flags.market` на стороне сервиса. Это отдельный репозиторий/сервис.
3. **Публичные ссылки `/r/<token>`**, созданные до выкатки для Точки А/Б и GRI, продолжают открываться до истечения срока. Новые Free создать не может.
4. **Список «Заявки» в ГИГА.** Общее чтение `admin_requests` по-прежнему сортирует по несуществующему `created_at`, и все строки, кроме заявок тарифа, отбрасываются (в том числе заявки регистрации из `admin_requests`). Заявки тарифа я вывел отдельным корректным чтением. Полную починку не делал: она меняет поведение очереди одобрений (статусы `admin_requests` могут расходиться с `profiles.status`). Предложение: отдельная задача.
5. Старые дубли заявок `upgrade_modal` на проде не трогал (данные не удалял). Индекс 144 их не покрывает, а код считает их открытыми заявками.
6. Если когда-нибудь выполнить `prisma db push`, Prisma может удалить индекс 144 (она его не знает). Тогда его нужно переприменить; без индекса проверка в коде всё равно не даёт дублей вне окна гонки.
7. `/metrics` в старом меню по-прежнему закрыт по tier без серверного гейта: раздела нет в списке фаундера. PDF, AI-чат и бенчмарки — прежние правила. AI-чат по-прежнему без исключения для персонала, как было.
8. В ГИГА-настройках под `gri_free_runs` осталась старая пометка «Начнёт действовать после включения…» (`app/admin-giga-panel/settings/page.tsx`). Этот файл сейчас правит R2-B, поэтому я его не трогал; подсказка в реестре обновлена.
9. Задержка: у Free при включённых гейтах страницы кабинета делают +1 обращение к БД на проверку персонала (только на пути отказа, один раз на рендер).

---

## 6. Вопросы к PO

1. **Выкатка:** назначить Pro действующим клиентам до выкатки или временно выключить `access_gates`? См. раздел 0.
2. На главной Free видит **число** Точки А (уровень экспресс-оценки) и индекс GRI, если он был, с подписью «подробный разбор — в платном доступе». Оставить как «тизер» или скрыть число?
3. **Участники компании** (приглашённые в компанию Pro-клиента) сейчас ограничиваются своим тарифом, а не тарифом владельца. Нужно ли наследовать тариф компании?
4. `FirstRunWizard` на `/dashboard` ведёт третьим шагом в GRI. Для Free он упрётся в пейволл. Поменять третий шаг на мини-GRI или экспресс?
5. «Рынок» в меню кабинета (`/client/*`) отсутствует, он есть только в старом сайдбаре. Нужно ли добавить пункт с замком?
6. Убрать из ГИГА-настроек или переименовать `gri_free_runs` (теперь это лимит только для индивидуально открытого Free)?
7. Нужна ли кнопка «назначить Pro» прямо в карточке заявки «Доступы» (сейчас — через User 360 → Биллинг)?

---

## 7. Исправления по ревью (`R2-A-REVIEW.md`, после коммита 4792f703)

Не закоммичено. Staging, прод и Railway не трогал. Код маскота «Гри» (визуал и поведение) не менялся: меняются только данные, которые отдаёт сервер. M-4 и M-5 не менял — это вопросы PO (п. 7.3).

### 7.1 Пункт → изменение → тест → результат

| № | Что было (обход) | Изменение | Тест (падал бы до исправления) | Итог |
|---|---|---|---|---|
| **H-1** | `POST /api/checkout {planKey:'pilot'}` давал Free Pro на 30 дней | Новая настройка `pilot_self_service` (реестр + тумблер в ГИГА → Настройки → Регистрация, подтверждение при переключении). **По умолчанию ВЫКЛ.** Выкл → тариф не выдаётся, создаётся та же заявка на доступ, что у кнопки пейволла (раздел `pilot`, без дублей). Ответ `202 {requested, message: «Пробный период включает менеджер…»}`. Если настройку не удалось прочитать — считается выключенной. «От имени» → 403. Вкл → прежнее поведение. Платные тарифы (заглушка эквайринга) не затронуты | `tests/unit/payments/checkout-trial.test.ts`: при выкл не вызывается `billing_set_plan`, `tier` остаётся free, заявка создаётся, повтор без дубля, ошибка чтения = выкл, «от имени» → 403, сбой записи → 503. Прежние 4 теста идут с вкл | 9/9 ✓ |
| **H-2** | Маскот (7.5–7.9), `/ai/chat`, `/assistant/insight`, `/assistant/analyze`, `/assistant/context`, NBA, личный Telegram и единый чат отдавали Free баллы Точки А/Б и GRI | **Одно место:** `buildAssistantContext()` в конце применяет `scrubAssistantContext()` по решению `resolveAccess` (при ошибке закрыто всё). Что убирается — см. список под таблицей. В снимке появляется `paidLocked`. Отдельные правки — см. список под таблицей | `tests/unit/access/assistant-paid-context.test.ts`: фильтр (платные маркеры ревьюера исчезают, бесплатное остаётся); маскот 7.5/7.6/7.7/7.9 → пейволл, 7.1 → без «Недостаточно данных»; Pro — с цифрами; промпт `/ai/chat` без платных данных и с пометкой «ПЛАТНЫЙ ДОСТУП»; инструменты единого чата | 12/12 ✓ |
| **H-3** | `/metrics` отдавал полный GRI (`select=*`, вместе с планом на 90 дней) | Страница решает через `getRequestAccess` (ошибка → закрыто). При закрытом `gri_full` строка GRI не читается, вкладка GRI — компактный пейволл, страница открывается на «Цели роста». Вместо `select=*` — явные колонки (`GRI_PAGE_COLUMNS`) | `review-routes.test.ts` (H-3): при закрытом разделе `gri_assessments` не запрашивается; при открытом — без `select=*` и без `action_plan_90d`; страница решает одним решением | ✓ |
| **M-1** | `/api/v1/action-plan` отдавал план GRI на 90 дней и задачи Точки Б | GET (клиент сам о себе): задачи из плана GRI — только при открытом `gri_full`, задачи `source='point_b'` — при открытом `point_b`, иначе 402. Материализация из GRI — только при открытом `gri_full`. PATCH `/action-plan/[id]` и `/tasks/[id]` для владельца — гейт по разделу задачи. Персонал через `?userId` + `mayActOnUser` — как раньше | `review-routes.test.ts` (M-1): Free → 402 без материализации; только Точка Б → только её задачи, GRI не читается; Pro → все; персонал → как раньше; PATCH закрытой задачи → 402 без записи | ✓ |
| **M-2** | Ошибка чтения `access_gates` открывала платные разделы | `getAccessGatesEnabled`: строки нет → false (как раньше). Ошибка → последнее успешно прочитанное значение (не старше 5 минут), иначе **true — гейты считаются включёнными** (fail closed), с `console.error`. Персонал проходит по своему праву. **Тесты:** `tests/helpers/setup.ts` фиксирует в тест-окружении `access_gates = false` (по умолчанию). Файл, который мокает модуль сам, перекрывает это. Реальный ридер тестируется через `vi.unmock`. `popups/routes.test.ts` управляет тумблером через фейковую таблицу, поэтому делает `vi.unmock`. Это закрыло 35 падений у R2-B | `tests/unit/access/access-gates-fail-closed.test.ts` (реальный ридер и решение): ошибка → закрыто; ошибка после успешного чтения → последнее значение; Free при сбое закрыт, персонал проходит | 6/6 ✓ |
| **M-3** | Для Free запускался платный ИИ-разбор Точки А, ИИ Точки Б падал с 402 и помечался `failed` | `paidFanOutPaths(owner)` — платные вызовы по правам **владельца**. Snapshot и `recalculate`: статус `processing` только если разбор реально запустится, иначе `none`; fan-out только по разрешённым путям. Для Free — ни вызовов, ни `failed`. Прямой (не внутренний) путь `ai-analyze` → `gatePaidSection(point_a)`. После перехода на Pro — `catchUpPaidAi(userId)` в фоне: из `setPlan` (билинг дал Pro) и из GIGA (индивидуально открыты Точка А/Б). Запускает пропущенный разбор (только если официальная Точка А посчитана и разбор ещё не прошёл) и ИИ Точки Б | `tests/unit/access/paid-ai-fanout.test.ts`: пути по правам; `fireAiFanOut` уважает пути; snapshot для Free — `aiStatus 'none'`, без путей, для Pro — как раньше; догоняющий запуск (и когда он не нужен); подключение в билинге и GIGA; `ai-analyze` напрямую от Free → 402 (`review-routes`) | ✓ |
| **L-1** | Пульс, каталог метрик и NBA отдавали полный GRI | Пульс: `baseline: null`, и `gri_assessments` не читается без `gri_full`. Каталог: оверлей блоков GRI только с разделом. NBA: без главного ограничения GRI, без «переснять GRI», без задач закрытых разделов, без красных зон Точки А | `review-routes.test.ts` (L-1): Пульс Free → baseline null и чтения нет, Pro → baseline; NBA без платных строк и без чтения GRI | ✓ |
| **L-2** | Экспресс-срез отдавал тексты `top_issues` и баллы скрытых блоков | Срез отдаёт только **число** находок (`issues_count`) — его и показывает бесплатная карточка («1 находка»). У скрытого блока нет балла, но остаются статус, покрытие и вес, чтобы рекомендации блоков анкеты не изменились | `point-a-express.test.ts` (нет текста находок, есть `issues_count`); `free-notices.test.ts` (счётчик находок работает по `issues_count`) | ✓ |
| **L-3** | Бот «Сообщений» называл Free балл и 3 слабых блока | `loadUserFacts`: при закрытой Точке А пишет только «рассчитана; балл и разбор — в платном доступе… Не называй баллы» (или «ещё не рассчитана»). SLA-часть R2-B в `lib/comm/bot.ts` сохранена | `review-routes.test.ts` (L-3): у Free нет «61» и «Продажи — 31», у Pro — «61/100» | ✓ |
| **L-4** | Один статус «отправлено» на все пейволлы; гонка при дописывании | GET отдаёт `features`; пейволл пишет «отправлено» только если **этот** раздел уже в заявке, иначе «Добавить раздел к заявке». Дописывание атомарное: compare-and-swap по `"updatedAt"` и условию «заявка открыта», при 0 затронутых строк — повторное чтение (до 4 попыток). Если заявку закрыли — создаётся новая | `upgrade-requests.test.ts`: одновременный клик по другому разделу (ничего не теряется); заявку закрыли между чтением и записью (раздел уходит в новую). `paywall-ui.test.ts`: «Добавить раздел…», `requestStateFor`, `FeatureGate` для чужого раздела | ✓ |
| **L-5** | В `featureKey` можно было записать произвольный текст | API принимает только известные ключи (`isKnownRequestFeature`), иначе 400 | `upgrade-requests.test.ts` (L-5) | ✓ |
| **L-6** | Ошибки вместо пейволла; ссылки в пейволл | `/dashboard`: «Поделиться»/«PDF» Точки А только с разделом. `ShareButton`: 402 → «в платном доступе». Пейволл «от имени» — пояснение вместо кнопки (сервер передаёт `impersonating`, клиент распознаёт 403). Уведомления «Точка А пересчитана», «Анкета принята» и запись в ленте: для Free без балла и со ссылкой на `/client/onboarding/snapshot`. «1 действие сейчас»: при закрытом GRI — честное «Полная диагностика — в платном доступе» вместо «Пройдите GRI-диагностику». В «Снимке» ссылка: «Полный разбор Точки А — в платном доступе →». На главной у Free индекс GRI не показывается | `free-notices.test.ts` (8), `paywall-ui.test.ts` («от имени»), `home-page-speed.test.ts` (индекс GRI) | ✓ |
| **п.7** | Контракт смотрел только папки разделов | `paid-routes-coverage.test.ts` → новый блок: **любой** `route.ts`, `page.tsx` или `layout.tsx`, который читает платные таблицы или их загрузчики, обязан идти через решение. Таблицы: `diagnostics`, `ai_analysis`, `point_a_*`, `pb_*`, `point_b_*`, `market_*`, `gri_*`, `action_items`. Загрузчики: `loadPointAState`, `getOfficialPointA`, `loadPointAOverview`, `loadMetricsPageData`, `loadPointBInputs`, `loadOfficialSnapshot`. Иначе файл должен быть в явном списке исключений с обоснованием (6 файлов) или в префиксе персонала с причиной. Отдельная проверка: `buildAssistantContext` фильтрует внутри, переопределение `sections` — только в ГИГА | Мутационная проверка: снятое решение в `/metrics` и в `/api/pulse` валит контракт | 58/58 ✓ |
| **H-4** | Free своим JWT читал платные строки через PostgREST | Миграция **147** — подробно в 7.2 | `tests/integration/db/paid-sections-rls.test.ts` на реальной схеме тест-БД. Free не видит ни одной платной строки, бесплатное (анкета, документы, компания) видит. Pro видит всё. Override открывает один раздел, явный `false` закрывает у Pro. Гейты выключены или строки нет → всё открыто. Service role читает. Персонал и эксперт проходят. Free не может сам поднять себе `tier`. Мутационная проверка: без 147 падают 4 из 7 | 7/7 ✓ |

**H-2 подробнее.** Что убирает фильтр для закрытого раздела:
- Точка А: баллы, блоки, риски, quick wins (пробелы анкеты остаются);
- Точка Б: разрыв, реализм, рычаги, ограничения (свои цели клиента остаются);
- GRI: индекс и топ-5;
- `llm_analysis`.

Отдельные правки:
- маскот: на вопрос целиком о закрытом разделе — ответ-пейволл со ссылкой; в смешанном ответе — пометка вместо «Недостаточно данных»;
- промпт LLM: строка «ПЛАТНЫЙ ДОСТУП: разделы … закрыты — скажи, что подробности в платном доступе»;
- единый чат (`ai/assistant`): инструменты закрытых разделов (`get_point_a`, `explain_block`, `list_discrepancies`, `get_gri`, `get_point_b`) не предлагаются модели;
- ГИГА «качество» получает полный снимок;
- личный Telegram и эскалация идут по правилам клиента;
- `/api/pulse`: строка клиента, собранная из его Точки А, не строится без раздела.

### 7.2 H-4: RLS по тарифу — сделано, миграция 147

**Решение — безопасно, сделал.** Бесплатное читает Точку А через service role после проверки сессии: экспресс-«Снимок» (`?view=express` → `loadPointAState` под service), плитка главной (`point_a_snapshots` и `diagnostics` под service, только свои id), `current-revenue` (только `company_id`). `/dashboard` уже читал через service, бот — через service, materialize — через service. В браузере прямых чтений платных таблиц нет, только Realtime-подписки на gated-страницах.

**`public.has_paid_section(section)`** — то же правило, что `decideFeature`:
- персонал этой сессии (`current_staff_role()` или `is_active_expert()`, с сессионным гейтом 143) → да;
- `access_gates` не включён → да;
- override `feature_flags` → его значение;
- иначе `tier = 'pro'`.

Функция `SECURITY DEFINER`, `EXECUTE` выдан только `authenticated` и `service_role`.

**Политики.** На 23 таблицы — `RESTRICTIVE` `FOR SELECT TO authenticated USING ((SELECT has_paid_section(...)))`. Скаляр в подзапросе вычисляется один раз на запрос, а не на каждую строку. Политика может только отнять доступ, расширить его не может.
- Точка А: `diagnostics`, `point_a_snapshots`, `point_a_insights`, `point_a_comments`, `point_a_hypothesis_reviews`;
- Точка Б: `point_b_analysis`, `point_b_versions`, 9 таблиц `pb_*`;
- полный GRI: `gri_assessments`, `gri_assessment_drafts`, `gri_calc_sessions`, `gri_plan_progress`;
- Рынок: `market_analysis_answers`, `market_snapshots`;
- `action_items` — по полю `source`.

Не покрыты намеренно: Пульс, `data_discrepancies` (поток документов), `report_versions` (M-4).

**Проверка на тест-БД.** Идемпотентна: повторное применение не меняет ничего, отсутствующие таблицы пропускаются. Перед DDL стоит `lock_timeout 5s`. На тест-БД: применил, применил повторно, откатил, применил снова. Откат: `supabase/migrations/rollback/147_paid_sections_rls.down.sql`.

**Остаточные риски (для PO):**
- если где-то есть чтение платной таблицы под сессией Free, которое я не нашёл, Free увидит там пусто (никакой утечки, только пустое место). Контракт п.7 ловит такие чтения в роутах и страницах;
- участник компании ограничен **своим** тарифом и в БД — так же, как в приложении (вопрос PO №3 остаётся);
- **применять 147 только вместе с выкаткой кода**, иначе старая главная и старый экспресс-вид у Free станут пустыми.

### 7.3 M-4 и M-5 — не менял, варианты для PO

**M-4. Отчёт эксперта и его комментарии для Free.** Сейчас: карточка «Ваш отчёт готов», PDF отчёта, ссылка `/r/v/…` и `expert-comments` доступны Free; кнопка «Открыть» ведёт в пейволл.
- **(а) Отчёт — осознанное исключение.** Эксперт сделал работу, клиент её получает. Карточка ведёт на отдельную страницу отчёта без Точки А. Нужна страница и решение, что входит в отчёт.
- **(б) Отчёт — часть Точки А.** `reports*` и `expert-comments` закрываются правом `point_a` (персонал без ограничений); на главной вместо карточки компактный пейволл. Минус: эксперт может публиковать отчёт клиенту, который его не увидит.
- **(в) Промежуточный.** Карточка показывает, что отчёт готов, а PDF и ссылка — в платном доступе.

**M-5. «Одобрить» тарифную заявку ничего не открывает.** Сейчас кнопка только закрывает заявку, клиенту ничего не приходит.
- **(а)** Для категории «Доступы» вместо «Одобрить» — «Назначить Pro» (`setPlan` с аудитом, срок и примечание из диалога) плюс уведомление клиенту «Доступ открыт».
- **(б)** Оставить «Закрыть», но назначение Pro в Биллинге само закрывает открытую заявку клиента и уведомляет его.
- **(в)** Оба варианта вместе. Рекомендую (в): из заявки — быстрый путь, из Биллинга — автозакрытие.

### 7.4 Итоги прогонов (после исправлений)

- Точечно, набор R2-A: 24 файла, **467/467 ✓**. Включает интеграционные `paid-sections-rls`, `access-request-dedup`, `survey-route`.
- Полный `~/.a360-test/vt.sh --reporter=dot`: **8617 passed, 2 failed, 14 skipped** (782 файла). Оба падения — известные тесты моста WhatsApp (нет пакета baileys). Прогон включает незакоммиченную работу R2-B (SLA, миграция 146).
- **tsc** (`--max-old-space-size=5120`): **0 ошибок**. **lint**: **0**.
- Тест-БД (127.0.0.1:54329): применены 144 и 147 (вместе со 145 и 146 от R2-B). Пересборка тест-БД применит их из папки миграций.

### 7.5 Новые и изменённые файлы (ревью)

**Новые:**
- `lib/assistant/paid-context.ts`, `lib/access/recipient.ts`;
- `supabase/migrations/147_paid_sections_rls.sql` + `rollback/147_paid_sections_rls.down.sql`;
- тесты: `tests/unit/access/{access-gates-fail-closed,assistant-paid-context,review-routes,paid-ai-fanout,free-notices}.test.ts`, `tests/integration/db/paid-sections-rls.test.ts`.

**Изменённые:**
- checkout: `app/api/checkout/route.ts`;
- настройки: `lib/settings/registry.ts` (+`pilot_self_service`), `app/admin-giga-panel/settings/page.tsx`, `lib/settings/system-settings.ts`;
- ассистент и чаты: `lib/assistant/{context,answer,types}.ts`, `app/api/v1/assistant/{chat,context}/route.ts`, `app/api/v1/ai/assistant/route.ts`, `lib/chat/tools.ts`, `app/api/giga-admin/users/[id]/quality/route.ts`, `lib/comm/bot.ts` (только `loadUserFacts`);
- `/metrics`: `app/(dashboard)/metrics/page.tsx`, `lib/metrics/page-data.ts`, `components/metrics/MetricsPageClient.tsx`;
- план действий: `app/api/v1/action-plan/{route,[id]/route,tasks/[id]/route}.ts`, `lib/access/decision.ts` (`actionItemSection`);
- платный ИИ: `lib/point-a/{snapshot,diagnostic-row}.ts`, `app/api/v1/diagnostics/{recalculate,ai-analyze,point-b/current-revenue}/route.ts`, `lib/payments/billing.ts`, `app/api/giga-admin/users/[id]/access/route.ts`;
- Пульс, NBA, каталог: `app/api/v1/gri/pulse/route.ts`, `app/api/v1/metrics/catalog/route.ts`, `app/api/v1/nba/{route,event/route}.ts`, `app/api/v1/next-best-action/route.ts`, `lib/dashboard/next-best-action.ts`, `app/api/pulse/route.ts`;
- экспресс-срез: `lib/survey/snapshot.ts`, `lib/point-a/v4/primary.ts`, `components/onboarding/express/{usePointAView.ts,BusinessSnapshot.tsx}`;
- заявка и пейволл: `lib/access/upgrade-requests.ts`, `app/api/v1/upgrade-request/route.ts`, `components/access/{Paywall.tsx,paywall-model.ts,FeatureGate.tsx}`;
- уведомления: `lib/notifications/product.ts`, `lib/survey/completion-notice.ts`;
- UI: `app/(dashboard)/dashboard/page.tsx`, `components/share/ShareButton.tsx`, `app/client/home/page.tsx`, `app/api/v1/point-a/state/route.ts`;
- тесты: `tests/helpers/setup.ts`, `tests/unit/{payments/checkout-trial,popups/routes,client-shell/home-page-speed}.test.ts`, `tests/unit/access/{paid-routes-coverage,paywall-ui,point-a-express,upgrade-requests}.test.ts`, `fake-admin-requests.ts`.

### 7.6 Что не сделано / открыто

- **L-7.** Mark-analytics (SPA и FastAPI) проверяет только JWT. Проверка тарифа нужна на стороне сервиса Рынка: другой сервис, вне этого репозитория.
- **Ссылки `/r/<token>`**, созданные до выкатки, живут до истечения срока.
- **`/ai/chat`, `/assistant/insight`, `/assistant/analyze` не закрыты правом `ai_chat`** (`/ask` и `/converse` закрыты). Платных данных Free там больше нет: фильтр снимка, промпт с пометкой. Закрывать ли сам ИИ-чат для Free — вопрос PO: это ИИ-бюджет Free, `ai_daily_budget_usd_free` ограничивает.
- **Ручной проверки в браузере нет:** окружение смотрит в staging.
- Вопросы PO из раздела 6 остаются. Добавились M-4 и M-5 (7.3) и включение `pilot_self_service`.
