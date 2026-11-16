# R2-C — решения PO по пейволлу: отчёт эксперта, ссылки, тариф компании, «Назначить Pro», мастер, «Рынок» в меню

Исполнитель: R2-C, Раунд 2. Ветка `claude/round2-paywall-experts`, worktree `multi-agent-portal-dev-8f4869`.
**Не закоммичено, не запушено. Staging, прод и Railway не трогал.** Миграция 148 применена только к локальной тест-БД (127.0.0.1:54329).
Файлы R2-B (`lib/expert-sla/*`, `lib/settings/registry.ts`, миграция 149, `ExpertSlaPage`) не трогал. Код маскота «Гри» не трогал. Заглушку оплаты не трогал. Q2 и Q6 не менял.

---

## 1. По пунктам: было → изменение → тест → результат

### 1.1 M-4. Отчёт эксперта — часть Точки А (право `point_a`), персонал без ограничений

**Было.** `GET /api/v1/reports`, `reports/[id]`, `reports/[id]/pdf`, `POST reports/[id]/link`, `GET /api/v1/expert-comments` отдавали отчёт и комментарии эксперта Free-клиенту. Публичная `/r/v/<token>` открывалась всегда. Карточка «Ваш отчёт готов» на главной: «Открыть» вела в пейволл, а «PDF» отдавал полный снимок. В БД `report_versions` и связанные таблицы были открыты Free своей сессией.

**Изменение.**
- **API → 402 `upgrade_required` до любого чтения** (тот же `gatePaidSection(..., 'point_a')`, персонал проходит): `reports`, `reports/[id]`, `reports/[id]/pdf`, `reports/[id]/link`, `expert-comments`.
  - **Дополнительно** закрыт `GET /api/v1/expert-review`. Он отдаёт те же строки `expert_comments` (и разборы `expert_reviews`), иначе закрытие `expert-comments` ничего бы не дало.
  - На главной Free блок «Разбор эксперта» не монтируется. Сам `ExpertMessages` на 402 показывает компактный пейволл, а не «Не удалось загрузить».
- **`/r/v/<token>` и `/r/v/<token>/pdf`** проверяют ТЕКУЩЕЕ право ВЛАДЕЛЬЦА компании отчёта (`companies.user_id`), новый `lib/access/owner-access.ts`.
  - Решение то же, что в кабинете (тумблер, тариф, override, наследование от компании); персонал не учитывается; любая ошибка → закрыто.
  - Закрыто → страница «Ссылка недоступна» (`components/share/LinkUnavailable.tsx`) без данных: без компании, цифр и дат. PDF → 403 `link_unavailable`, файл не рендерится. Ссылки не удаляются.
- **Главная** (`app/client/home/page.tsx`): метаданные последней опубликованной версии (id, номер, заголовок, даты, без содержимого) читаются service role по СВОЕЙ компании клиента — миграция 148 прячет `report_versions` от Free-сессии.
  - При закрытой Точке А `ReportReadyCard locked`: «Отчёт эксперта готов», дата, «Отчёт входит в Точку А — она в платном доступе» и компактный пейволл с кнопкой «Оставить заявку на доступ». Нет «Открыть», PDF, ссылки и id отчёта в разметке.
- **Эксперт публикует, как раньше.** Уведомление клиенту после «Подтвердить и опубликовать» (`lib/reports/review-flow.ts`):
  - для клиента с закрытой Точкой А: «Отчёт эксперта готов», текст про платный доступ, ссылка на `/client/home` (вместо `/r/v/…`, которая открыла бы «Ссылка недоступна»);
  - для остальных — как было.
- **Кабинет эксперта** `/expert/reports` (очередь «На проверке»):
  - на карточке клиента с закрытой Точкой А — пометка «Клиент на бесплатном тарифе: после публикации он увидит только уведомление о готовности отчёта — сам отчёт входит в платный доступ (Точка А)»;
  - после публикации — соответствующий текст;
  - решение — по владельцу компании, один раз на компанию.
- **БД (миграция 148):** RESTRICTIVE `… _paid_section` SELECT-политики `has_paid_section('point_a')` на `report_versions`, `expert_reviews`, `expert_comments`, `diagnostic_findings`, `diagnostic_recommendations`.
  - Находки и рекомендации — содержимое отчёта, клиент видит их своей сессией (`visible_to_client`).

**Эксперт, ГИГА, review-flow.**
- Персонал сессии проходит `has_paid_section`: `current_staff_role()` / `is_active_expert()`.
- Review-flow, PDF и боты читают через Prisma или service role (RLS не действует).
- `/api/v1/reports/:id/pdf` из кабинета и бота экспертов проходит гейт как персонал (`getSessionStaff`).

**Тесты (падали бы до изменения):**
- `paid-api-gates.test.ts`: +6 роутов (Free → 402 без чтений; Pro, персонал, гейты выкл → не 402). Мутация: снятый гейт в `reports/[id]/pdf` и `expert-review` → 5 падений (в т.ч. контракт).
- `paid-routes-coverage.test.ts`: роуты отчёта в EXTRA. Контракт «любой читатель» расширен на `report_versions`, `expert_reviews`, `expert_comments`, `diagnostic_findings`, `diagnostic_recommendations`, `publishedReportForCaller`, `resolveVersionLink`, `load{PointA,PointB,Gri}View`. Решение по владельцу (`ownerSectionOpen` / `companyOwnerSectionOpen`) считается решением.
- `public-links-owner.test.ts` (9): `/r/v` закрыто → «Ссылка недоступна» без названия компании и содержимого; открыто → как было; PDF закрыто → 403 и `versionPdf` не вызван. Мутация: на коде HEAD падают 6 из 9.
- `owner-access.test.ts` (4): соответствие типов, решение по владельцу, нет владельца → открыто только при выключенных гейтах, ошибка → закрыто.
- `r2c-ui.test.ts`:
  - карточка `locked` — пейволл, нет `/api/v1/reports`, «Открыть отчёт» и id;
  - открытая карточка как была;
  - пометка в очереди эксперта только у Free-клиента, «Подтвердить и опубликовать» у обоих.
- `home-page-speed.test.ts`: Free → карточка `locked`; `report_versions` читается service role, не сессией.
- `home-paywall.test.ts`: у Free блок «Разбор эксперта» не монтируется, у Pro монтируется.
- `report-review.test.ts` (интеграционный, реальная БД): эксперт публикует отчёт клиенту без Точки А, версия `published`, клиенту — «Отчёт эксперта готов», ссылка `/client/home`, не `/r/v/`. Прежний тест публикации (ссылка `/r/v/` для открытого клиента) зелёный.
- `paid-sections-rls.test.ts`:
  - Free не читает свой опубликованный отчёт, разбор, комментарии и находки; override `point_a`, Pro и выключенные гейты читают;
  - админ и назначенный эксперт читают отчёт, находки и комментарии Free-клиента; service role читает;
  - участник Pro-компании читает отчёт компании.

**Результат:** ✓.

### 1.2 Старые публичные ссылки `/r/<token>` (share Точки А/Б/GRI)

**Было.** Ссылка, созданная до выкатки, показывала данные до истечения срока, независимо от тарифа владельца.

**Изменение.** `app/r/[token]/page.tsx`:
- после проверки токена и компании — решение по текущему праву владельца компании на раздел ссылки: `point_a` → Точка А, `point_b` → Точка Б, `gri` → полный GRI;
- анкета (`survey`) бесплатна и не проверяется;
- закрыто → та же «Ссылка недоступна»: данные раздела не загружаются, просмотр не засчитывается;
- OG-карточка GRI (`generateMetadata`) при закрытом разделе не строится, цифры не попадают в превью;
- ссылки не удаляются.

**Тест:** `public-links-owner.test.ts` — по каждому из трёх типов: закрыто → страница без данных, `load*View` не вызваны, `views` = 0, решение спрошено для владельца и нужного раздела. Открыто → как было. Анкета без проверки. OG без цифр. Мутация (HEAD) → падает.

**Результат:** ✓.

### 1.3 Q3. Участники компании наследуют тариф компании

**Было.** Участник `company_members` ограничен своим тарифом и в приложении, и в БД (147).

**Правило (одно для приложения и БД).** Порядок как в `has_paid_section`:
1. персонал сессии;
2. тумблер выключен;
3. СОБСТВЕННЫЙ override участника (явный `false` закрывает раздел даже в Pro-компании);
4. собственный tier `pro`;
5. активное членство (`status='active'`, роль owner / admin / member / viewer) в компании, у основного владельца которой (`companies.user_id`, не сам пользователь) есть это право — его override, иначе tier `pro`;
6. иначе закрыто.

`invited` / `removed` ничего не дают. Партнёры (`partner_members`) — не участники.

**Изменение.**
- **Миграция 148.** Функция `paid_right_of(tier, flags, feature)` (override, иначе pro).
  - `company_inherited_rights(p_user)` — SECURITY DEFINER: возвращает права по 7 фичам + `gri_full_unlimited`. Под сессией отвечает только о самом пользователе, service role — о любом, чужой — «нет прав», `anon` — 42501.
  - `has_paid_section` — CREATE OR REPLACE с шагом 5. Гранты сохранены и переустановлены.
- **Приложение.** `lib/access/server.ts readEntitlements`: если собственный тариф что-то закрывает (не явным override), один RPC `company_inherited_rights` (та же SQL-функция, что в RLS) и `withCompanyRights` (`lib/access/entitlements.ts`).
  - У Pro без явных запретов RPC не делается.
  - Ошибка / нет миграции → без наследования (закрыто).
  - Унаследованные фичи помечаются `viaCompany`; `tier` остаётся собственным.
  - Лимит полного GRI: от Pro-владельца — без лимита, от Free-владельца с индивидуальным доступом — бесплатный лимит.
  - Решение (`decideFeature`), гейты API, страницы, меню, `/api/v1/access/me` берут это автоматически.

**Тесты:**
- `company-inheritance.test.ts` (11): чистая модель, собственный `false`, override владельца по разделу, разбор ответа, «Pro не спрашивает компанию», ошибка RPC → закрыто, клиент без `.rpc`. Мутация: убрать наследование из `readEntitlements` → 8 падений (вместе с интеграционным).
- `paid-sections-rls.test.ts` (Q3): Free-участник Pro-компании (admin / member / viewer / owner-строка) — все 4 раздела, читает строки компании; участник Free-компании, `invited`, `removed` — ничего; собственный `false`; override владельца по разделу; `false` владельца не наследуется; `company_inherited_rights` — только о себе, service role о любом, anon 42501.
- **`paid-access-one-rule.test.ts`** (13, реальная БД): матрица из 12 случаев (свой тариф и override × тариф и override владельца × статус и роль членства). Решение приложения (`readEntitlements` через сессию человека + `decideFeature`) == `has_paid_section` по каждому из 4 разделов. Плюс проверка, что матрица не тривиальна.
- Мутация БД: откат 148 → 5 из 14 тестов RLS падают; повторное применение → 14/14.

**Результат:** ✓.

### 1.4 M-5 + Q7. «Назначить Pro» прямо из заявки и автозакрытие из Биллинга

**Было.** «Принять» на заявке тарифа только закрывала её: Pro не назначался, клиенту ничего не приходило. Назначение Pro в Биллинге оставляло заявку открытой.

**Изменение.**
- **`POST /api/giga-admin/requests/[id]/assign-pro`** `{ months 1..36 | periodEnd, note }`:
  - те же права, что у User 360 → Биллинг: `users.manage`, область клиентов сотрудника (`guardClientAccess`), `forbidTarget`; своя заявка → 403;
  - только ОТКРЫТАЯ заявка на платный доступ (`paywall`, включая раздел «pilot», и старая `upgrade_modal`); регистрация / неизвестная → 404, закрытая → 409;
  - назначение через `setPlan` (source `admin`, журнал ДО записи, `meta.via='access_request'`, `request_id`); примечание по умолчанию «По заявке на доступ: …»; не применилось → 409, заявка остаётся открытой;
  - разбор срока общий с Биллингом: новый `lib/payments/plan-period.ts`, Биллинг переведён на него без изменения поведения.
- **Один выход для обоих путей** — `lib/access/paid-access-grant.ts completePaidAccessGrant`:
  - все открытые заявки клиента на платный доступ закрываются как `approved`, по каждой аудит `request.approved` (`kind: paid_access`, `via`);
  - чужие заявки и регистрации не трогаются;
  - клиенту ОДНО уведомление «Доступ открыт» в ленте (`notifyPaidAccessOpened`, категория `security`, только in-app; новых каналов нет) — если доступ реально открылся (был Free) или закрыта его заявка;
  - из заявки ключ идемпотентности — id заявки, повтор по той же заявке ничего не шлёт;
  - назначение тарифа никогда не откатывается из-за ошибки закрытия или уведомления.
- **`PATCH /api/giga-admin/users/[id]/billing`** после применённого `setPlan` вызывает тот же `completePaidAccessGrant`. Ответ дополнен `closedRequests`, `notified`; в User 360 → Биллинг сообщение об этом.
- **«Отклонить» с причиной и «Архив» остаются.** Голое «approve» по заявке тарифа (одиночное, массовое, бот) теперь отказывается 409 «одобряется назначением тарифа» — иначе M-5 воспроизводился бы через массовое «Принять все».
  - В UI «Принять все» скрывается, если среди выбранных есть заявка тарифа.
  - Регистрационные заявки работают по-старому.
- **UI «Заявки → Доступы»** (`components/giga-panel/RequestsModule.tsx`):
  - на заявке тарифа вместо «Принять» кнопка «Назначить Pro» → диалог: срок (N месяцев / до даты / бессрочно), примечание, пояснение, что заявка закроется и клиент получит уведомление;
  - без права `users.manage` кнопка неактивна с причиной;
  - после действия — сверка с БД и тост («Pro назначен, заявка закрыта как одобренная, клиент получил уведомление»).
  - Модель без DOM: `components/giga-panel/assign-pro-model.ts`.

**Тесты:**
- `assign-pro.test.ts` (9):
  - назначение через `setPlan` (тариф, срок около 3 мес., примечание, `meta`); закрыты `req-1`, `pilot`, `upgrade_modal`; чужая заявка, регистрация и уже отклонённая не тронуты; 3 аудита; одно уведомление с ключом заявки;
  - RBAC: analyst, support, super_expert, content_manager → 403 без изменений, crm_manager → 200;
  - вне области / защищённая цель / своя заявка → 403; 404, 409, 422; `setPlan` не применён → 409, заявка открыта;
  - Биллинг: Pro Free-клиенту закрывает его заявки и уведомляет один раз; из заявки, затем правка в Биллинге и продление → всё равно ОДНО уведомление; Free без заявок → уведомление; перевод на Free ничего не закрывает.
- `paid-access-request-decision.test.ts` (обновлён по решению PO): голое approve → `assign_plan_required`, без записей и без смены `profiles.status`; archive закрывает; reject с причиной; регистрация по-старому; на свою заявку нельзя.
- `r2c-ui.test.ts`: «Назначить Pro» вместо «Принять» на `paywall` / `upgrade_modal`, на регистрации «Принять»; без права — кнопка `disabled` с причиной; модель диалога (тело, сроки, тосты); текст Биллинга.
- `user-billing-routes.test.ts` (существующий) — зелёный.

**Результат:** ✓.

### 1.5 Q4. FirstRunWizard

**Было.** Третий шаг всегда вёл в `/gri`; у Free — пейволл.

**Изменение.**
- `FirstRunWizard({ griLocked })`: при закрытом `gri_full` третий шаг — «Пройдите мини-GRI», `/gri-free` (бесплатный мини-GRI, `app/(public)/gri-free`), с пометкой, что полный GRI в платном доступе.
- `/dashboard` передаёт `griLocked` из того же серверного решения (`getRequestAccess`, ошибка → закрыто).
- Открыт — как было.

**Тест:** `r2c-ui.test.ts` — закрыт → `href="/gri-free"`, нет `href="/gri"`; открыт / не указан → `/gri`; `/dashboard` берёт `gri_full` из решения.

**Результат:** ✓.

### 1.6 Q5. «Рынок» в меню кабинета

**Было.** В меню кабинета (`ClientNav`, одно и то же на телефоне и десктопе) «Рынка» не было; был только в старом сайдбаре и `MobileNav` (там замок уже есть, R2-A).

**Изменение.** `lib/client-shell/nav.ts`:
- пункт «Рынок» (`/market`, иконка `public`) после GRI — только после одобрения доступа и если раздел не выключен в ГИГА (`platform_sections`, путь `/market`);
- эксперту не показывается: `/market` в `ADMIN_PATHS`, добавлен в `EXPERT_BLOCKED_HREFS`;
- `PAID_NAV_KEYS.market`, новый `lockedNavKeysFor(sections)` — его использует `app/client/layout.tsx`;
- `market` закрыт → значок замка и «платный доступ» для скринридера; ведёт на `/market`, где пейволл (R2-A).

**Тесты:**
- `nav-model.test.ts` обновлён: порядок; `/market` — реальная страница; скрытие разделом платформы; эксперт.
- `r2c-ui.test.ts`: замок по решению; рендер — у «Рынка» замок только при закрытом разделе; нет до одобрения и у эксперта.

**Результат:** ✓.

### 1.7 Q2, Q6 — не менял (по заданию).

---

## 2. Файлы (R2-C)

**Новые:**
- `supabase/migrations/148_paid_access_company_and_reports.sql`, `supabase/migrations/rollback/148_paid_access_company_and_reports.down.sql`;
- `lib/access/owner-access.ts`, `lib/access/paid-access-grant.ts`, `lib/payments/plan-period.ts`;
- `app/api/giga-admin/requests/[id]/assign-pro/route.ts`;
- `components/share/LinkUnavailable.tsx`, `components/giga-panel/assign-pro-model.ts`;
- тесты: `tests/unit/access/{company-inheritance,owner-access,public-links-owner,assign-pro,r2c-ui}.test.ts`, `tests/integration/db/paid-access-one-rule.test.ts`.

**Изменённые:**
- доступ: `lib/access/entitlements.ts`, `lib/access/server.ts`;
- отчёт эксперта: `app/api/v1/reports/{route,[id]/route,[id]/pdf/route,[id]/link/route}.ts`, `app/api/v1/expert-comments/route.ts`, `app/api/v1/expert-review/route.ts`, `lib/reports/review-flow.ts`, `components/reports/ReportReadyCard.tsx`, `components/client/ExpertMessages.tsx`, `components/user-dashboard/UserHome.tsx`, `app/client/home/page.tsx`, `app/(expert)/expert/reports/page.tsx`, `components/expert/ExpertReviewQueue.tsx`;
- публичные ссылки: `app/r/[token]/page.tsx`, `app/r/v/[token]/page.tsx`, `app/r/v/[token]/pdf/route.ts`;
- «Назначить Pro»: `app/api/giga-admin/users/[id]/billing/route.ts`, `lib/users/access-requests.ts`, `lib/admin/request-decision.ts`, `lib/notifications/product.ts`, `components/giga-panel/RequestsModule.tsx`, `components/giga-panel/BillingControls.tsx`;
- мастер и меню: `components/dashboard/FirstRunWizard.tsx`, `app/(dashboard)/dashboard/page.tsx`, `lib/client-shell/nav.ts`, `app/client/layout.tsx`;
- тесты: `tests/contracts/route-auth.manifest.ts` (+1 строка), `tests/integration/db/{paid-sections-rls,report-review}.test.ts`, `tests/unit/access/{paid-api-gates,paid-routes-coverage,paid-access-request-decision,home-paywall}.test.ts`, `tests/unit/client-shell/{home-page-speed,nav-model}.test.ts`.

`middleware.ts`, `lib/admin/rbac.ts`, файлы R2-B, маскот — не трогал. Ничего не удалено.

---

## 3. Миграция 148: порядок применения

1. **После 147** (на staging уже применена; её файл не менялся). 148 заменяет `has_paid_section` (CREATE OR REPLACE) и добавляет функции и политики.
2. Применять **вместе с выкаткой кода R2-C**:
   - без кода главная Free-клиента читала бы `report_versions` сессией и потеряла бы карточку «Отчёт эксперта готов»;
   - код без 148: наследование тарифа в приложении не работает (RPC нет → закрыто), отчёт закрыт только на уровне API.
3. На прод — в той же выкатке, что 144 и 147 (R2-A): `144 → 147 → 148`. Номер 149 — у R2-B, конфликта нет.
4. Команда: `node scripts/apply-migration.js supabase/migrations/148_paid_access_company_and_reports.sql`. Идемпотентна: CREATE OR REPLACE, DROP POLICY IF EXISTS, отсутствующие таблицы пропускаются с NOTICE, `lock_timeout 5s`.
5. Откат: `supabase/migrations/rollback/148_paid_access_company_and_reports.down.sql` — возвращает `has_paid_section` ровно как в 147, снимает 5 политик и 2 функции, данные не меняет.
6. Проверено на тест-БД:
   - применение → повторное применение (без ошибок);
   - откат: 0 функций, 23 политики (как после 147), 5 тестов падают;
   - повторное применение: 28 политик, 14/14.
   - В журнал `schema_migrations` тест-БД запись не оставлял (там пусто, как и было).

---

## 4. Итоги прогонов

- **Набор R2-C** (16 файлов + `tests/contracts`, включая интеграционные `paid-sections-rls`, `paid-access-one-rule`, `report-review` на тест-БД): **334 / 334 ✓** (два прогона подряд).
  - Один предыдущий прогон, шедший одновременно с `tsc`, дал 1 падение; имя теста я не зафиксировал. Повторы чистые. Отдельно `user-billing-routes` проходит за 16 мс.
- **Полный прогон** `~/.a360-test/vt.sh --reporter=dot`: **8708 passed, 2 failed, 14 skipped** (788 файлов, 3 файла skipped).
  - Оба падения — известные тесты моста WhatsApp (`whatsapp-web-bridge-pull-control`, `whatsapp-web-bridge-reliability`, нет пакета baileys), не чинил.
  - Прогон включает незакоммиченную работу R2-B (SLA, миграция 149).
- **`npx tsc --noEmit`** (`--max-old-space-size=5120`): **0 ошибок**.
- **`npm run lint`**: **0 предупреждений и ошибок**.
- **Мутационные проверки:**
  - снят гейт `reports/[id]/pdf` и `expert-review` → 5 падений;
  - страницы `/r/…` в версии HEAD → 6 падений;
  - наследование убрано из `readEntitlements` → 8 падений;
  - откат миграции 148 → 5 падений RLS.
- `next build` не запускал (по заданию).

---

## 5. Остаточные риски и что не сделано

1. **Партнёры** (`partner_members`) персоналом для `has_paid_section` не считаются (как и в 147 для `diagnostics`). Консультант партнёра Free-компании своей сессией не видит отчёт, находки и рекомендации. UI партнёров сейчас нет.
2. **Наследование тарифа** действует на права (разделы, PDF, AI-чат, бенчмарки). Но:
   - ИИ-бюджет (`lib/ai/budget.ts`) и замок `/metrics` в старом меню по-прежнему смотрят на СОБСТВЕННЫЙ `profiles.tier`;
   - `useEntitlements().tier` — собственный;
   - на экране GIGA «Тариф» участника показан его собственный.
3. **Участник (не владелец)** не видит на главной карточку отчёта (главная читает только СВОЮ компанию — как и раньше). Уведомление «Отчёт эксперта готов» для закрытого участника ведёт на `/client/home`, где карточки нет.
4. **Уже отправленные** до выкатки уведомления со ссылкой `/r/v/…` у Free-клиентов откроют «Ссылка недоступна». Это по правилу PO.
5. **Пометка «клиент на бесплатном тарифе»** есть только в кабинете эксперта `/expert/reports`. В Telegram/WhatsApp-проверке отчёта её нет. Она считается на каждой загрузке страницы, один раз на компанию: чтение `companies` + решение, до 100 версий в очереди.
6. **`GET /api/v1/expert-review`** закрыт сверх явного списка: те же данные, что `expert-comments`. Блок «Разбор эксперта» у Free на главной скрыт; на `/client/dashboard-medical` — компактный пейволл. Если PO хочет оставить разбор бесплатным — снять один гейт и политику на `expert_reviews` / `expert_comments`.
7. **`diagnostic_findings` / `diagnostic_recommendations`** закрыты в БД правом `point_a` (содержимое отчёта). Если где-то бесплатная поверхность читает их сессией клиента, у Free там будет пусто, без утечки. Контракт п.7 ловит такие чтения в роутах и страницах; в `lib/point-a/overview.ts` чтение под сессией только из гейтнутого API.
8. **Голое «Принять» по заявке тарифа** теперь 409 (по решению PO: одобряется назначением тарифа). Telegram-боты заявки тарифа не видят (ищут по колонке `"userId"`).
9. **Уведомление «Доступ открыт»** — только лента (категория `security`). Письмо не включал, чтобы не изобретать канал. Включить — убрать `email: false` в `notifyPaidAccessOpened`.
10. **Самостоятельный пилот** (`pilot_self_service`) и оплата Kaspi заявки не закрывают — по заданию только Биллинг и «Назначить Pro».
11. **Ручной проверки в браузере нет:** `.env.local` смотрит в staging, локального GoTrue/PostgREST нет. UI проверен рендер-тестами (`renderToStaticMarkup`). `next build` не запускал (по заданию).

---

## 6. Исправления по ревью (`R2-C-REVIEW-SEC.md`, `R2-C-REVIEW-PRODUCT.md`; поверх e8993464 и c59d1abb)

Не закоммичено. Staging, прод и Railway не трогал. Файлы 149 и SLA-тестов (c59d1abb) не трогал. Код маскота «Гри» (`components/assistant/mascot/*`) не менялся; DOM-маркеры мастера сохранены.

### 6.1 Находка → изменение → тест → результат

**SEC F1 / PRODUCT H-1 (High). Текст комментария эксперта уходил Free-клиенту в уведомлении и письме.**
Решение PO: разбор и комментарии эксперта — платные (Точка А).

Изменение:
- `lib/notifications.ts` `notifyUser`: для `expert_comment` / `expert_comment_edited` проверяется `pointAClosedFor(получатель)`. Ошибка решения → закрыто.
- Если Точка А закрыта:
  - нейтральный текст «Эксперт оставил комментарий к вашей Точке А — он доступен в платном доступе»;
  - без `preview`, блока и имени эксперта;
  - кнопка «Подробнее» → `/client/home#expert`.
- Этот путь общий для `POST /api/expert/comments` и ГИГА User 360 → комментарии.
- Разбор эксперта (`…/review/publish`):
  - письмо (`buildExpertReviewPublishedEmail({ paidLocked })`) без названия разбора и числа комментариев;
  - уведомление «Эксперт подготовил разбор» без блоков и числа.
- Якорь `#expert` у Free теперь ведёт на реальный блок. На главной (`UserHome`) у закрытой Точки А — ОДИН компактный пейволл Точки А в `<section id="expert">` с подписью «Отчёт, разбор и комментарии эксперта входят в Точку А».
  - Блок показывается и до первой диагностики (если раздел Точки А не выключен в ГИГА), поэтому ссылка из уведомления всегда куда-то ведёт.

Тесты:
- `expert-notices-paid.test.ts` (6). Реальное формирование текста; подменены только транспорт (лента, почта, Telegram, журнал) и решение о доступе.
  - Free: в ленте, письме и Telegram нет текста, блока и имени.
  - Реальное решение падает → текста нет.
  - Pro → как раньше.
  - Другие уведомления не затронуты.
  - Письмо о разборе — без названия и числа.
- `publish.test.ts` (+1, поведение маршрута): закрытая Точка А → `paidLocked` в письме, нейтральное уведомление, ссылка `#expert`; эксперт по-прежнему публикует.
- `home-paywall.test.ts` (+2): на главной Free с отчётом ровно один `data-paywall="point_a"` и один `id="expert"`; блок есть и без диагностики.

Результат: ✓.

**SEC F2 (High). `diagnostic_sessions.overview` (сводка Точки А) читалась Free-сессией.**

Изменение:
- В 148 добавлена RESTRICTIVE-политика `diagnostic_sessions_paid_section` (`point_a`). Откат снимает и её.
- Бесплатные поверхности таблицу сессией не читают. Под сессией её читает только `lib/point-a/overview.ts` (только `id`), внутри уже закрытого `/api/v1/point-a/overview`. Остальные читатели идут через Prisma / service role.

Тест: `paid-sections-rls.test.ts`.
- Free не видит `overview` своей компании; override `point_a`, Pro, гейты выкл, участник Pro-компании, админ и назначенный эксперт — видят.
- До переприменения 148 падали 4 теста.

Результат: ✓.

**PRODUCT M-1 (Medium). Мастер вёл Free на публичный `/gri-free`.**

Изменение: третий шаг `FirstRunWizard` у Free — «Получите экспресс-оценку» → «Снимок бизнеса» в кабинете (`/client/onboarding/snapshot`, бесплатная экспресс-оценка по своей анкете). Заголовок и подзаголовок — под это.

**Отклонение от формулировки Q4 «мини-GRI» (по решению оркестратора).** Публичный мини-GRI — лид-магнит для посетителей: «без регистрации», форма e-mail, «Зарегистрируйтесь», новый лид. Результат не привязывается к аккаунту. Клиенту кабинета это обещает то, чего нет.

На `/dashboard` (PRODUCT L-9) карточка «Следующий шаг» (`GrowthSnapshotHero`) у Free по тому же решению `gri_full` ведёт туда же, а «Пройти GRI-диагностику» на пейволл не показывается — один призыв.

Тест: `r2c-ui.test.ts`.
- Мастер: Free → `/client/onboarding/snapshot`, нет `/gri-free` и `/gri`; открыт → как было.
- Рендер `GrowthSnapshotHero`: закрыт → «Снимок бизнеса» без «Пройти GRI-диагностику», открыт → как было.
- `/dashboard` передаёт одно решение обоим компонентам.

Результат: ✓.

**PRODUCT M-2 (Medium). Массовая смена тарифа давала Pro в обход `setPlan` и не закрывала заявки.**

Изменение:
- Нашёл grep-ом всех писателей `profiles.tier`. В обход `setPlan` писал только `lib/admin/bulk-users.ts` (`set_tier`); checkout, Kaspi и Биллинг уже шли через `setPlan`.
- `set_tier` теперь идёт через `setPlan` (source `admin`, журнал до записи, `subscriptions`, догоняющий платный ИИ), затем `completePaidAccessGrant` (via `bulk`).
- `PATCH /api/giga-admin/users/:id/access` с `tier` после применённого `setPlan` тоже вызывает `completePaidAccessGrant` (via `access`).
- Уведомление одно — по тем же правилам без дублей.

Тесты:
- `admin-ops-bulk.test.ts` (+1): `setPlan` с source `admin`, по одному шагу «доступ открыт» на клиента, прямой записи `tier` в `profiles` нет. Прежние кейсы — частичный сбой, права.
- `user-access.test.ts` (+1): применён → шаг вызван один раз; не применён → нет.

Результат: ✓.

**PRODUCT M-4 (Medium). Пометка «клиент на бесплатном тарифе» была только в `/expert/reports`.**

Изменение:
- `GET /api/giga-admin/reports/review` (ГИГА → Отчёты и кабинет SuperExpert) помечает версии клиентов с закрытой Точкой А (`clientPaidLocked`, одно пакетное решение).
- `ReviewQueueList`: пометка на карточке, правдивый текст диалога и тоста.
- Подсказка статуса «Опубликован» стала: «клиент видит эту версию; клиент на бесплатном тарифе — только уведомление о готовности».
- Карточка версии (`/api/giga-admin/reports/:id` + `ReportsPage`): тот же флаг, правдивый диалог и тост публикации.
- Telegram-бот экспертов: после «Подтвердить и опубликовать» для Free — «Клиент на бесплатном тарифе получил только уведомление о готовности — сам отчёт входит в платный доступ».

Тест: `review-queues-free.test.ts` (8).
- API ставит флаг только версии Free-клиента, одним пакетным вызовом.
- Список показывает одну пометку.
- Тексты тоста и подсказки.
- Ответ бота (Free / Pro).
- Ошибка решения → флагов нет.

Результат: ✓.

**SEC F7 (Low). `/client/home` при сбое решения открывал карточку отчёта.**

Изменение: ошибка решения → разделы считаются закрытыми (fail closed): карточка отчёта `locked`, индекс GRI скрыт.

Тест: `home-page-speed.test.ts` (+1).

Результат: ✓.

**SEC F8 / PRODUCT L-11 (часть) (Low). `/expert/reports` делал до ~400 запросов на рендер.**

Изменение:
- В 148 правило вынесено в ОДНУ SQL-функцию `paid_section_of(user, section)` (правило клиента, без персонала). Её зовут `has_paid_section` (= персонал сессии ИЛИ `paid_section_of(auth.uid())`) и новая `paid_sections_for_owners(company_ids[], section)`: владельцы всех компаний одним вызовом, только service role.
- `company_inherited_rights` вызывает внутреннюю `company_rights_of`.
- Внутренние функции закрыты для `authenticated` / `anon` (42501).
- В приложении `companiesOwnerSectionOpen` / `companiesWithClosedSection` (`lib/access/owner-access.ts`) делают один RPC на всю очередь. Их используют `/expert/reports`, очередь ГИГА / SuperExpert, карточка версии и бот.

Тесты:
- `paid-sections-rls.test.ts` (+2): пакет == `has_paid_section` каждого владельца (Pro, Free, override, Pro-владелец с явным `false`, Free-владелец как участник Pro-компании, компания без владельца при гейтах вкл/выкл); клиенту функции недоступны (42501).
- `owner-access.test.ts` (+2): один вызов, дубли и пустые отброшены.
- `review-queues-free.test.ts`: один пакетный вызов на рендер `/expert/reports`.
- Матрица `paid-access-one-rule` (13) зелёная на новом теле функции.

Результат: ✓.

**PRODUCT L-1 (Low). Два одинаковых пейволла Точки А на главной.**

Изменение: в заблокированной карточке отчёта пейволла больше нет — кнопка «Как открыть доступ» ведёт к `#expert`, к единственному пейволлу страницы.

Тест: `home-paywall` (один `data-paywall="point_a"`, один `id="paywall-point_a-title"`); `r2c-ui` (в карточке нет `data-paywall`, есть `href="#expert"`).

Результат: ✓.

**PRODUCT L-2 (Low). «2026 г..».**

Изменение: новый `lib/format/ru-date.ts` (`ruLongDate` без хвостового «г.»). Используется в «Доступ открыт» и в карточке отчёта.

Тест: `r2c-ui` (карточка: «6 октября 2026.», нет «г..»).

Результат: ✓.

**PRODUCT L-3 (Low). Диалог «Назначить Pro».**

Изменение:
- Диалог вынесен в `AssignProDialog`.
- В `ConfirmDialog` (kit) добавлен `disabled`: при неполном сроке (пусто, дробное, нет даты) кнопка заблокирована, а в форме видна ошибка `role="alert"`.
- Тост «заявку закройте вручную» заменён: «заявка не закрылась — обновите список; если она осталась открытой, отправьте её в архив».
- Ошибки 422 «Назначить Pro» — по-русски.

Тест: `r2c-ui` (рендер диалога: три неполных срока → кнопка `disabled` и ошибка, полный → активна; текст тоста).

Результат: ✓.

**PRODUCT L-4 (Low). «Отклонить» / «Архив» из устаревшего списка перезаписывали решённую заявку.**

Изменение: тарифная заявка меняется только из ОТКРЫТОГО статуса (условный UPDATE `… IN (open) … RETURNING id`). 0 строк → `already_decided` → 409 «Заявка уже решена (например, коллега назначил тариф) — обновите список».

Открытыми считаю `new`, `in_review`, `waiting_for_info`, `escalated` (тот же набор, что везде в R2-A) — это все ещё не решённые. Отклонение от формулировки «только из new»: старые `upgrade_modal` бывают в `in_review`.

Тест: `paid-access-request-decision.test.ts` (+1): `approved` / `rejected` / `archived` → `already_decided`, записи нет.

Результат: ✓.

**PRODUCT L-5 (Low). «Назначить Pro на N мес.» мог укоротить оплаченный период.**

Изменение: `proAssignment` (`lib/payments/plan-period.ts`) по текущему плану (`getEffectivePlan`):
- при живом платном периоде месяцы добавляются к его концу (то есть от max(сегодня, конец периода));
- бессрочный остаётся бессрочным;
- Enterprise остаётся Enterprise;
- явная дата раньше конца периода → 422 «…новая дата его укоротила бы»;
- без живого платного плана — срок от сегодня.

Тест: `assign-pro.test.ts` (+4): пилот до X + 1 мес → X + 1 мес; бессрочный Enterprise; ранняя дата → 422 без изменений, поздняя → 200; истёкший план → от сегодня; русская 422.

Результат: ✓.

**PRODUCT L-6 (Low). «Ссылка недоступна» раскрывала тариф владельца.**

Изменение: нейтральный текст «Ссылка сейчас недоступна. Обратитесь к тому, кто ею поделился.» — одинаковый при закрытом праве и при сбое (оба → `false` → та же страница). PDF-ответ 403 — тот же текст.

Тест: `public-links-owner.test.ts` (+1: нет слов «владел…», «тариф», «платн…», «закрыт»).

Результат: ✓.

**PRODUCT L-7 (Low). Пометка эксперту появлялась при ошибке БД.**

Изменение: пакетное решение при сбое возвращает «неизвестно» (пустой результат) → пометок нет. Код и комментарий теперь совпадают.

Тест: поведенческий. `owner-access.test.ts`: сбой RPC → ни одной «закрытой» компании. `review-queues-free.test.ts`: сбой → нет пометки на `/expert/reports` и нет флагов в API ГИГА. Прежняя проверка исходника удалена.

Результат: ✓.

**PRODUCT L-8 (Low). Уведомление Free-участнику обещало то, чего нет на главной.**

Изменение: блок-пейволл `#expert` (см. F1) есть на главной у ЛЮБОГО аккаунта с закрытой Точкой А, в том числе у участника компании. Уведомление «Отчёт эксперта готов» ведёт на `/client/home#expert`, поэтому «на главной кабинета можно оставить заявку» теперь правда.

Тест: `report-review.test.ts` (интеграционный): владелец и Free-участник оба получают «Отчёт эксперта готов» со ссылкой `#expert`, без `/r/v/`.

Результат: ✓.

**PRODUCT L-11 (Low). Лишний запрос к БД у Free на каждый платный запрос.**

Изменение: решение (`lib/access/decision.ts`) сначала читает только собственные права (`readOwnEntitlements`). Компания (RPC) запрашивается только на пути отказа — параллельно с проверкой персонала.
- При выключенном тумблере и у Pro RPC нет вообще (раньше у Free он был и при выключенном тумблере).
- У Free с включёнными гейтами путь «профиль → RPC → персонал» (3 последовательных обращения) стал «профиль → (RPC ∥ персонал)» (2).

Убрать сам запрос у Free при включённых гейтах просто нельзя: без него неизвестно, состоит ли человек в Pro-компании. Число запросов то же, задержка на один шаг меньше.

`readEntitlements` (для прочих мест) не изменился по смыслу. 6 тестовых моков `@/lib/access/server` дополнены `readOwnEntitlements` / `readCompanyRights`.

Тест: `lazy-company.test.ts` (5):
- гейты выкл → нет RPC и проверки персонала;
- Pro → нет RPC;
- Free-участник: RPC и проверка персонала стартуют вместе, право наследуется;
- без компании → закрыто;
- явный `false` не открывается, персонал проходит.

Результат: ✓.

### 6.2 Не делал (по решению оркестратора) — остаточные риски и вопросы PO

- **SEC F3.** Наследование работает на уровне человека, а не компании: Free-участник Pro-компании получает платные разделы и для СВОЕЙ Free-компании, без лимита GRI и с платным ИИ.
- **SEC F4.** Бывший владелец (после смены `companies.user_id`) сохраняет `owner/active` и наследует. В коде портала смена владельца не делается.
- **SEC F9.** Заблокированный или архивный Pro-владелец «раздаёт» Pro участникам.
- **SEC F10.** Партнёры (`partner_members`) не видят отчёт, находки и сессии своих Free-компаний.
- **SEC F11.** `viewer` получает все платные права, включая платный ИИ.
- **PRODUCT, заявка участника.** «Назначить Pro» даёт тариф тому, кто подал заявку (участнику), а не владельцу компании.
- **PRODUCT M-3 / 4 (эскалации low 24 ч).** По данным оркестратора на проде значение не сохранено, два открытых low-кейса давно истекли — миграция не нужна.
- **SEC F5 / F6** — это 149 (R2-B / c59d1abb), не трогал.
- **PRODUCT L-10.** Текст «Доступ открыт» перечисляет все 4 раздела даже при явном `false` на раздел. Участнику, у которого доступ уже был через компанию, придёт «Менеджер открыл…» (`opened` считается по собственному тарифу). Не правил (не входило в список). Варианты: перечислять фактически открытые разделы по `readEntitlements` после назначения.
- **PRODUCT L-3, частично.** Сотруднику с областью `assigned` кнопка «Назначить Pro» активна и на неназначенных клиентах очереди; после формы — 403 «Клиент не назначен вам». Не правил.
- **H-1, частично.** Эксперт при КОММЕНТИРОВАНИИ (User 360 → комментарии) не видит, что клиент на Free: пометка есть только при публикации отчёта и в очередях. Не правил.
- **Пейволл Точки А на главной Free** теперь виден и до первой диагностики. Это нужно, чтобы якорь `#expert` из уведомлений всегда вёл на блок; раньше карточка показывалась только при наличии диагностики.

### 6.3 Миграция 148 — что изменилось и порядок

- Добавлено:
  - `diagnostic_sessions` в список RESTRICTIVE-политик (всего 6 таблиц отчёта);
  - внутренние `company_rights_of(uuid)` и `paid_section_of(uuid, text)` — закрыты для всех ролей, их вызывают только SECURITY DEFINER-функции;
  - `paid_sections_for_owners(text[], text)` — только `service_role`.
- `has_paid_section` теперь: персонал сессии → `paid_section_of(auth.uid())`. Правило прежнее, порядок прежний.
- Порядок применения прежний: после 147, вместе с кодом R2-C, на прод `144 → 147 → 148`. Файл идемпотентен, staging переприменяется тем же файлом.
- Откат снимает 6 политик и 5 функций и возвращает тело `has_paid_section` ровно как в 147: md5 тела после отката совпадает с md5 при применении 147 — `939e5e5f…`.
- Проверено на тест-БД:
  - откат: 0 функций, 23 политики, 8 тестов падают;
  - применение дважды: 29 политик;
  - 29 / 29 тестов RLS / one-rule.

### 6.4 Итоги прогонов (после исправлений)

- Набор исправлений: 42 файла — `tests/unit/access`, `client-shell`, `expert-review/publish`, `giga-crm/admin-ops-bulk`, `giga-admin/{user-access,user-billing-routes}`, `telegram/expert-review-bot`, `tests/contracts` и интеграционные `paid-sections-rls`, `paid-access-one-rule`, `report-review` на тест-БД. Результат: **786 / 786 ✓**.
- Полный прогон `~/.a360-test/vt.sh --reporter=dot`: **8743 passed, 2 failed, 14 skipped** (791 файл). Оба падения — известные тесты моста WhatsApp (нет baileys).
- **`npx tsc --noEmit`**: **0 ошибок**. **`npm run lint`**: **0**.

### 6.5 Файлы исправлений

**Новые:**
- `lib/format/ru-date.ts`;
- `tests/unit/access/{expert-notices-paid,lazy-company,review-queues-free}.test.ts`.

**Изменённые:**
- миграция: `supabase/migrations/148_…sql` и `rollback/148_…down.sql`;
- доступ: `lib/access/{decision,server,owner-access,paid-access-grant}.ts`;
- уведомления и письма: `lib/notifications.ts`, `lib/notifications/product.ts`, `lib/email/templates.ts`, `app/api/giga-admin/users/[id]/review/publish/route.ts`, `lib/reports/review-flow.ts`;
- главная: `components/user-dashboard/UserHome.tsx`, `components/reports/ReportReadyCard.tsx`, `app/client/home/page.tsx`;
- мастер и `/dashboard`: `components/dashboard/{FirstRunWizard,GrowthSnapshotHero}.tsx`, `app/(dashboard)/dashboard/page.tsx`;
- тариф и заявки: `lib/admin/bulk-users.ts`, `app/api/giga-admin/users/[id]/access/route.ts`, `app/api/giga-admin/requests/[id]/assign-pro/route.ts`, `lib/payments/plan-period.ts`, `lib/users/access-requests.ts`, `lib/admin/request-decision.ts`, `components/giga-panel/{RequestsModule.tsx,assign-pro-model.ts,kit/index.tsx}`;
- очереди отчётов: `app/(expert)/expert/reports/page.tsx`, `app/api/giga-admin/reports/{review/route.ts,[id]/route.ts}`, `components/giga-panel/reports/{ReviewQueue,ReportsPage}.tsx`, `components/giga-panel/reports/model.ts`, `lib/telegram/bots/expert/review.ts`;
- ссылки: `components/share/LinkUnavailable.tsx`, `app/r/v/[token]/pdf/route.ts`;
- тесты: `tests/integration/db/{paid-sections-rls,report-review}.test.ts`, `tests/unit/access/{assign-pro,decision,home-paywall,owner-access,paid-access-request-decision,paid-api-gates,point-a-express,point-b-gate,public-links-owner,r2c-ui,recalculate-redaction}.test.ts`, `tests/unit/client-shell/home-page-speed.test.ts`, `tests/unit/expert-review/publish.test.ts`, `tests/unit/giga-admin/user-access.test.ts`, `tests/unit/giga-crm/admin-ops-bulk.test.ts`, `tests/unit/point-b/invites.test.ts`.

---

## 7. Исправления по проверке (`R2-C-VERIFY.md`; поверх cf4c5d61)

Не закоммичено. Staging, прод и Railway не трогал. Код маскота «Гри» не менялся. `lib/point-a/diagnostic-row.ts` изменён только в одном месте: экспортирован тип `FanOutOpts`.

### 7.1 Находка → изменение → тест → результат

**1. Н-1 (Medium): мастер и «Следующий шаг» вели Free на `/client/onboarding/snapshot`, а это экран режима «Экспресс» под флагом.**

Значение флага на проде неизвестно, поэтому решение должно быть надёжным при любом значении.

Изменение:
- Новый `lib/client-shell/free-step.ts`, функция `freeNextStep(modes = enabledSurveyModes())`. Это тот же помощник `lib/survey/modes.ts`, что у остальной анкеты (`NEXT_PUBLIC_SURVEY_MODES`).
- «Снимок бизнеса» предлагается только при включённом `express`.
- Иначе шаг — анкета `/client/onboarding`. Тексты: «Дополните анкету», «Анкета — бесплатно…», «Открыть анкету»; про снимок ни слова.
- `/dashboard` считает шаг один раз и передаёт его и мастеру, и `GrowthSnapshotHero` — призыв по-прежнему один.

Тест `r2c-ui.test.ts`:
- `freeNextStep` даёт снимок только при `express` и совпадает с помощником анкеты;
- мастер: оба варианта (`express` вкл → снимок, выкл → анкета без слова «снимок»);
- hero: оба варианта плюс открытый GRI;
- `/dashboard` передаёт один шаг обоим.

Результат: ✓.

**2. PRODUCT H-1, остаток: тексты эксперта обещали «Клиент увидит комментарий…».**

Изменение:
- SQL `paid_sections_for_users(uuid[], section)` в 148 — правило `paid_section_of` для заданных клиентов, только service role. Откат её снимает.
- `usersWithClosedSection` в `lib/access/owner-access.ts`: один вызов; возвращаются только клиенты, про которых известно, что раздел закрыт. Сбой → пусто, то есть без ложной пометки.
- `GET /api/giga-admin/users/:id/comments` и `GET …/review` отдают `clientPaidLocked`.
- `CommentsTab` (подсказка формы, пустое состояние, тост) и `ReviewTab` (диалог публикации) берут тексты из `components/giga-panel/user360/free-client-copy.ts`. Для Free: «он получит только уведомление без текста комментария, а сам комментарий увидит после открытия доступа (Точка А)».

Тесты:
- `paid-sections-rls.test.ts` (+1): пакет == `has_paid_section` каждого клиента (Pro-владелец, Free, Free-участник Pro-компании, Free с override), неизвестный id отсутствует; клиенту функция недоступна (42501).
- `owner-access.test.ts` (+1): один вызов, только известные закрытые; сбой → пусто.
- `verify-fixes.test.ts`: оба маршрута отдают флаг по пакетному решению, «неизвестно» → `false`; тексты Free / Pro; вкладки используют эти тексты (проводка).

Результат: ✓.

**3. L-3: «Назначить Pro» у сотрудника с областью «свои клиенты».**

Изменение:
- `GET /api/giga-admin/requests` ставит заявкам тарифа `assignable` — клиент в области сотрудника (та же область, что у `guardClientAccess` в «Назначить Pro» и Биллинге). Очередь по-прежнему видна вся.
- `RequestCard`: кнопка неактивна, причина видна под карточкой и в подсказке: «Клиент не назначен вам — тариф назначает его ответственный или сотрудник с доступом ко всем клиентам». Логика в `assignProBlockedReason`.

Тесты:
- `paid-access-request-decision.test.ts` (+1): область «свои» → `assignable:false`; свой клиент → `true`; «все» → `true`.
- `r2c-ui.test.ts` (+1): кнопка `disabled`, видимая причина.

Результат: ✓.

**4. Н-2 (гонка L-5): продление могло сложиться дважды.**

Изменение:
- «Назначить Pro» сначала занимает заявку: закрывает её как одобренную одним условным `UPDATE … WHERE status IN (open) RETURNING id` (`claimAccessRequest`). Из двух одновременных нажатий выигрывает одно, второе получает 409 «Заявка уже закрыта». Повтор по закрытой заявке — тоже 409.
- Если тариф затем не назначился (не применён или ошибка), заявка возвращается в прежний статус (`releaseAccessRequest`).
- Продление живого оплаченного периода (`active` / `past_due`) на N месяцев идёт через существующий `setPlan({ extendMonths })`: месяцы прибавляет SQL `billing_set_plan` к концу живого периода под блокировкой строк.
- Пробный период (`trialing`) SQL-продление не учитывает. Для него — N месяцев от конца пробного; от двойного нажатия защищает захват заявки.
- `completePaidAccessGrant` принимает `claimed` (аудит и учёт в уведомлении).

Тест `assign-pro.test.ts` (+3, 1 обновлён):
- живой период + N мес → `setPlan` с `extendMonths`, без даты из JS;
- два одновременных нажатия → `[200, 409]`, `setPlan` один раз; повтор → 409;
- тариф не назначился → заявка снова в `in_review`.

Результат: ✓.

**5. Н-3 (нагрузка): массовое «Сменить тариф → Pro» запускало платный ИИ на каждого клиента без ограничения.**

Изменение:
- `setPlan` получил `catchUpAi` (по умолчанию `true`). Массовое действие передаёт `false`.
- После прохода массовое действие запускает ОДНУ фоновую пачку `catchUpPaidAiBatch` (`lib/point-a/catch-up-batch.ts`) через `runInBackground`. Ответ её не ждёт.
- В пачке не больше 2 клиентов одновременно (`CATCH_UP_CONCURRENCY`; больше задать нельзя).
- Место клиента занято, пока его ИИ-вызовы не завершатся (`catchUpPaidAiAwaited` ждёт свои вызовы; у каждого вызова свой тайм-аут `fanOutTimeoutMs`). Ошибка одного не останавливает остальных; без ключа ИИ ничего не запускается.

Тесты:
- `verify-fixes.test.ts`: пик одновременности ровно 2, даже если попросить 5; все обработаны, несмотря на ошибку; место держится до завершения ИИ-вызовов; без ключа ничего; `setPlan` по умолчанию даёт одну фоновую задачу, с `catchUpAi:false` — ни одной.
- `admin-ops-bulk.test.ts` (+2): у каждого `setPlan` `catchUpAi:false`; одна фоновая `paid-ai-catch-up-bulk` с `[C1, C2]` и `concurrency 2`; ответ пришёл, хотя пачка не завершается; для Free пачки нет.

Результат: ✓.

Остаток: общее время пачки растёт с числом клиентов (200 клиентов по 2 одновременно — это минуты). Работа идёт в фоне после ответа. При редеплое SIGTERM-обработчик ждёт фоновые задачи только до своего срока, поэтому хвост пачки может не выполниться. Для таких клиентов ИИ догонит следующий пересчёт.

**6. Н-4 (Low): диалог массового «Сменить тариф» молчал о последствиях.**

Изменение:
- `bulkTierNote` (`lib/admin/bulk-users-shared.ts`) выводится в диалоге `UsersBulkBar`:
  - Free: «Платные подписки выбранных клиентов будут отменены, в том числе оплаченные через Kaspi; платные разделы закроются. Пробные периоды тоже завершатся.»;
  - Pro: бессрочно, заявки закроются, «Доступ открыт», ИИ в фоне.
- Ошибки тарифа (`BillingError`) в отчёте массового действия — по-русски.

Тесты: `verify-fixes.test.ts` (тексты и проводка), `admin-ops-bulk.test.ts` (русская ошибка).

Результат: ✓.

**7. Н-7 и Н-8 (Info).**

Изменение:
- «Ссылка недоступна» + «Обратитесь к тому, кто ею поделился.» — «недоступна» один раз. JSON-ответ PDF: «Ссылка недоступна. Обратитесь к тому, кто ею поделился.»
- При уже бессрочном платном тарифе «Назначить Pro» ничего не назначает (`setPlan` не вызывается), закрывает заявку и отвечает `unchanged`. Тост: «Тариф уже Pro без срока — назначать нечего; заявка закрыта как одобренная…» (без ложного «Pro назначен»). Дата в 422 — в формате ДД.ММ.ГГГГ.

Тесты:
- `public-links-owner.test.ts`: «недоступна» встречается один раз, точный текст PDF.
- `assign-pro.test.ts`: Enterprise без срока → `unchanged`, `setPlan` не вызван, заявка закрыта.
- `r2c-ui.test.ts`: тост `unchanged`.

Результат: ✓.

### 7.2 Миграция 148

- Добавлена `paid_sections_for_users(uuid[], text)` (только `service_role`). Откат снимает 6 политик и 6 функций.
- Тело `has_paid_section` после отката совпадает с 147: md5 `939e5e5f…`.
- Проверено на тест-БД:
  - откат: 0 функций, 23 политики, 9 тестов падают;
  - применение дважды: 29 политик;
  - RLS, one-rule и report-review — 41/41.
- Порядок прежний: после 147, вместе с кодом.

### 7.3 Итоги прогонов

- Набор исправлений (57 файлов: `tests/unit/{access,giga-admin,expert-review,client-shell}`, `giga-crm/admin-ops-bulk`, `telegram/expert-review-bot`, `tests/contracts` и интеграционные на тест-БД): **905 / 905 ✓**.
- Полный прогон `~/.a360-test/vt.sh --reporter=dot`: **8762 passed, 2 failed, 14 skipped** (792 файла). Оба падения — известные тесты моста WhatsApp.
- **`npx tsc --noEmit`**: **0**. **`npm run lint`**: **0**.

### 7.4 Файлы

**Новые:**
- `lib/client-shell/free-step.ts`, `lib/point-a/catch-up-batch.ts`, `components/giga-panel/user360/free-client-copy.ts`;
- `tests/unit/access/verify-fixes.test.ts`.

**Изменённые:**
- миграция: `supabase/migrations/148_…sql`, `rollback/148_…down.sql`;
- доступ: `lib/access/{owner-access,paid-access-grant}.ts`;
- биллинг и массовые действия: `lib/payments/{billing,plan-period}.ts`, `lib/admin/{bulk-users,bulk-users-shared}.ts`, `lib/point-a/diagnostic-row.ts` (экспорт типа);
- маршруты: `app/api/giga-admin/requests/{route.ts,[id]/assign-pro/route.ts}`, `app/api/giga-admin/users/[id]/{comments,review}/route.ts`;
- `/dashboard`: `app/(dashboard)/dashboard/page.tsx`, `components/dashboard/{FirstRunWizard,GrowthSnapshotHero}.tsx`;
- ГИГА: `components/giga-panel/{RequestsModule.tsx,assign-pro-model.ts,UsersBulkBar.tsx}`, `components/giga-panel/user360/{CommentsTab.tsx,review/ReviewTab.tsx}`, `stores/gigaPanel.store.ts`;
- ссылки: `components/share/LinkUnavailable.tsx`;
- тесты: `tests/integration/db/paid-sections-rls.test.ts`, `tests/unit/access/{assign-pro,owner-access,paid-access-request-decision,public-links-owner,r2c-ui}.test.ts`, `tests/unit/giga-crm/admin-ops-bulk.test.ts`.

### 7.5 Что осталось (без изменений)

Вопросы PO из 6.2: F3, F4, F9, F10, F11, заявка участника, L-10. Сюда же из проверки:

- **Н-6.** Если раздел Точки А скрыт в ГИГА, якоря `#expert` нет.
- **Н-9.** `/api/v1/access/me` в крайнем случае показывает собственные права без унаследованных; серверный гейт решает верно.
- **Н-10.** Индивидуальный override заявки не закрывает.
