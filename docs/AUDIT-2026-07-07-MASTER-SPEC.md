# AIStart360 — Полный аудит и техническое задание (Master Spec)

**Дата:** 2026-07-07
**Метод:** 10 специализированных суб-агентов, читавших реальный код (166 API-роутов, 81 страница, 180 компонентов, 39 миграций). Детальные отчёты по областям — в `docs/audit-2026-07-07/00…09*.md`. Этот файл — сводное ТЗ.
**Опора:** 5 прошлых аудитов (`docs/technical-audit.md`, `AUDIT-performance-2026-07-01.md`, `AUDIT-2026-07-02-buglist.md`, `SECURITY-AUDIT-AND-2FA-PLAN-2026-07-02.md`, `AUDIT-admin-panel-2026-07-04.md`). Статус их пунктов сверен с кодом и git.

---

## 1. Executive Summary

AIStart360 — премиальный SaaS бизнес-диагностики и роста выручки (продуктовая обёртка над консалтингом на 1.4M–54M ₸). Ядро — единый конвейер: **Регистрация → Опрос+файлы → Анализ рынка → Метрики (Точка А) → Диагностика GRI → Карта роста (Точка Б) → Дашборд**, с AI-инсайтами на каждом шаге, экспертом-валидатором и маскот-ассистентом «Гри». Стек: Next.js 14 App Router + Supabase (живой auth) + Prisma (мёртвый auth-путь, другие таблицы) + OpenRouter, на Vercel, UI 100% на русском.

**Главный вывод: платформа зрелая и в основном безопасная — но несёт три пласта долга.**

1. **Безопасность/админ — в основном закрыто** прошлыми аудитами (privilege-escalation, IDOR×3, SSRF, AI-DoS, giga-approve P0, 2FA-recovery, registration-toggle — подтверждено в коде). Осталось: ротировать утёкший пароль БД (SEC-01), убрать общий пароль giga-панели и включить RLS/REVOKE на Prisma-таблицах (SEC-03/04/05), починить аудит-трейл (SEC-02).
2. **Корректность данных — открыто и это дороже всего для продукта.** Точка А считает только старые ключи опроса `s2_*`; новые финансовые ответы `s9n_*` дают 0 (COR-01). GRI TOP-5 и 90-дневный план не вычисляются, страницы захардкожены (COR-02). Это подрывает главную ценность продукта — «честные числа».
3. **Архитектурный долг — открыт.** Мёртвый NextAuth/staff-cookie (источник багов CRM и потенциальной импersonation), дублирование (`dashboard`/`gri`/`profile` в 3 копиях, 4 Sidebar, 3 движка GRI), раздробленная таксономия ролей (два несовместимых `UserRole`), ~84 компонента мимо React Query.

**Мобилка** — визуал сильный, но эргономика хромает: `text-sm`-инпуты вызывают iOS-зум на всех формах (UX-01), страницы `app/client/*` (включая главный лендинг Точки А) без мобильной навигации (UX-02).

**«Гри»** — безопасен и хорошо инженерно сделан, но чат-LLM **не знает текущую страницу и прогресс** и не имеет рейла быстрых команд — то есть недоиспользован.

**Туториалы** — есть один добротный движок coachmark-туров на «Гри», но примонтирован в 2 из 5 групп (26 страниц owner/expert без онбординга) и ломается на мобильной клавиатуре.

**Кастомизация дашборда** — движок виджетов **уже написан** (`WidgetGrid.tsx`), но живёт только на admin-ветке, кормится пустыми массивами и персистит в localStorage. Клиенты кастомизации не получают.

**Рекомендованное направление:** Phase 1 — критические фиксы (ротация секрета, open-redirect, iOS-зум, unauth paid-AI, approve-0-rows, FK-индексы, корректность Точки А, мобильная навигация client). Затем UX/perf, апгрейд «Гри», расширение туториалов, кастомизация дашборда, и финальный QA/релиз-гейт. Детали — §14.

**Счётчик находок:** ~132 (Critical 3, High 27, Medium 48, Low/Info 54). Полный реестр — §5.

---

## 2. Предположения и недостающие входные данные

**Предположения (помечены):**
- Прод-auth = только Supabase; Prisma/NextAuth-путь считается мёртвым для аутентификации (подтверждено кодом, но окончательное «удалить целиком» требует решения владельца — §16 Q1).
- Канонический домен приложения — `aistart360.vercel.app`/`aistart360.app`; `aistart360.com` в mini-GRI-письме — под вопросом (§16 Q?, LNK-02).
- Платёжный стаб — намеренный (по memory), НЕ баг-блокер (BE-19).

**Недостающие входы (для более глубокого аудита нужно):**
1. Прод-сборка + typecheck + smoke-run — в worktree нет `.env.local`/`node_modules`, поэтому не выполнены `next build`/Lighthouse/bundle-analyzer/рантайм-профилирование. Все находки perf/UX — code-grounded; пункты «must measure» помечены.
2. Состояние прод-миграций: применён ли `040`? запушены ли FK-индексы? намеренно ли пропущена `011`?
3. Прод-логи / error-monitoring (тихие сбои email/telegram сейчас невидимы).
4. Продуктовая аналитика: drop-off онбординга, реальные 404, воронки.
5. Скриншоты ролевого опыта на десктопе и мобиле <1024px.
6. Нераспарсенный `AIStart360_Full_Audit_Report.pdf` (1.6MB) и `AIStart360.csv` (канонические 62 критерия GRI).
7. Текущая версия `next` в проде и лог продуктовых решений по спорным фичам.

**Как прислать, если что-то не читается:** большие PDF — разбить постранично или прислать текстовый экспорт; таблицы — CSV; скриншоты — PNG отдельными файлами. Логи — как `.txt`/`.json`. Если файл >~5–10MB, лучше zip или по частям.

---

## 3. Модель мульти-агентного исполнения

| Агент | Ответственность | Входы | Выходы | Зависимости | Приоритет |
|---|---|---|---|---|---|
| A0 Baseline/Product | Бизнес-цели, роли, статус прошлых аудитов | docs/*, git, ТЗ, specs | `00-baseline-product.md` | — | done |
| A1 Backend/API | 166 роутов, валидация, ошибки, rate-limit, дубли admin | app/api, lib | `01-backend-api.md` | A0 | done |
| A2 Security/RLS | auth, giga, IDOR, SSRF, RLS, секреты, 2FA | lib/auth,supabase,migrations | `02-security-auth-rls.md` | A0,A1 | done |
| A3 Frontend | routing, state, компоненты, дубли | app, components, stores | `03-frontend-routing-state.md` | A0 | done |
| A4 Links/Redirects | все ссылки/редиректы, внешние домены | app, components, config | `04-links-redirects.md` | A2,A3 | done |
| A5 UI/UX/Mobile | визуал, тап-таргеты, отзывчивость, a11y | components, globals.css | `05-uiux-mobile-a11y.md` | A3 | done |
| A6 Performance | бандл, ре-рендеры, CWV, индексы | config, deps, migrations | `06-performance.md` | A1,A3 | done |
| A7 Assistant «Гри» | реализация, контекст, спека | components/assistant, lib/ai | `07-assistant-gri.md` | A0,A1 | done |
| A8 Tutorials | покрытие, баги оверлеев, план | components/onboarding, tours | `08-tutorials-onboarding.md` | A5,A7 | done |
| A9 Dashboard | виджеты, архитектура кастомизации | components/dashboard, lib | `09-dashboard-customization.md` | A3,A6 | done |

**Для фазы исполнения** роли переиспользуются как владельцы задач (колонка «Owner» в §5/§18). Проектные агенты: `aistart360-data-engineer` (RLS/миграции/метрики), `aistart360-ui-engineer` (UI/дизайн-система), `aistart360-ai-pipeline-engineer` («Гри»/документы), `aistart360-realtime-engineer` (realtime/аналитика).

---

## 4. Карта портала

**Route-группы (app/):** `(auth)` login/register/forgot-password · `(dashboard)` staff/admin (activity, admin, ai-scanner, analytics, clients, competitors, gri, insights, intelligence, market, metrics, notifications, point-a, point-b, profile, pulse, reports, settings, team, users, dashboard) · `(expert)/expert` · `(owner)/owner` · `(public)` gri-free, privacy, terms · `client/` (dashboard, dashboard-ecommerce, dashboard-medical, my-data, onboarding[, -ecommerce, -medical], point-a, point-b, scenarios, waiting-room, welcome) · `admin-giga-panel` · `giga-login` · `2fa` · `presentation` · `r/[token]` (публичный шеринг).

**API (app/api/, 166 route.ts):** admin, giga-admin, v1 (assistant, metrics, settings, admin…), auth, client, clients, crm, checkout, gri, market, medical, notifications, pulse, reports, share, public, dev, health, inngest, expert, export.

**Backend-сервисы (lib/):** auth/supabase-фабрики (server/service/admin-guard), rate-limit, rbac, metrics (resolver/materialize), point-a-engine, point-b-engine, gri*, market-analysis, documents (parse/extract/chunk/embed), assistant (context/mascot/gree-chat), notifications, payments, integrations, crypto/secrets, mfa, webauthn, audit.

**Данные:** Postgres общий для Prisma и Supabase (разные таблицы). Supabase-таблицы: profiles, companies, survey_answers, documents, metrics, diagnostics, insights, app_notifications, admin_requests(Prisma), audit_logs(Prisma), comments(Prisma), dashboard (widget_config/preferences в profiles). Realtime включён на metrics/diagnostics/documents (миграция 016, REPLICA IDENTITY FULL).

**Точки «Гри»:** маунт в `(dashboard)` и `client` layout; эндпоинты `api/v1/assistant/*`. **Точки туториалов:** `lib/assistant/mascot/tours.ts` (11 экранов) + FirstRunWizard на `/dashboard`. **Дашборд-области:** 4 поверхности (admin, client-redirect-stub, ecommerce, medical) + движок `WidgetGrid`. **Внешние ссылки:** 11 доменов (§6).

**Основные user-flows:** register → waiting-room (poll approval) → welcome/vertical → 12-step survey + upload → Точка А → GRI → Точка Б → dashboard. Роли: client / expert / owner→admin / super_admin (giga).

---

## 5. Полный реестр находок

> Severity: **Critical** (данные/безопасность/поломка ядра), **High**, **Medium**, **Low/Info**. Полные строки с `file:line` и acceptance criteria — в отдельных отчётах `docs/audit-2026-07-07/*`. Ниже — сводка; Critical/High даны с фиксом, Medium/Low — компактно.

### 5.1 Корректность данных / продукт (COR) — owner: data-engineer / ai-pipeline

| ID | Sev | Область | Проблема | Фикс | Acceptance |
|---|---|---|---|---|---|
| COR-01 | **Critical** | Точка А | Скоринг читает только старые ключи `s2_*`; новые финансовые ответы `s9n_*` → 0 (`lib/point-a*`, survey field-keys) | Свести канонический словарь ключей опроса; маппинг s9n_*→метрики | На тест-профиле с заполненными финансами Точка А ≠ 0; unit-тест на маппинг ключей |
| COR-02 | **High** | GRI | TOP-5 приоритетов и 90-дневный план не вычисляются; страницы показывают хардкод/демо (`GRIAssessment.tsx:151-152` demo radar; owner/expert хардкод) | Реализовать вычисление TOP-5 и плана из ответов; убрать демо за empty-state | Реальные баллы; sample-данные только при отсутствии данных |
| COR-03 | Medium | GRI-модель | Три движка оценки GRI (calculator/assessment/mini) + расхождение канона (62 критерия/7 блоков?) | Выбрать канонический движок/ядро (см. FE-09) | Один источник расчёта GRI |

### 5.2 Безопасность (SEC) — owner: data-engineer / backend

**Critical/High:**
- **SEC-01 (Critical):** живой пароль Supabase-БД в истории git (`scripts/init-db.js` до `a36e099`; рабочее дерево уже читает env). → **Ротировать пароль в Supabase немедленно**; опционально очистить историю. AC: старая строка не аутентифицирует.
- **SEC-02 (High):** giga `logAudit` тихо падает — `audit_logs.performedBy` FK→dead `users(id)`, giga шлёт строку `'giga:super_admin'` → нарушение констрейнта проглатывается; привилегированные действия giga **не аудируются** (`lib/audit.ts:41-53`; callers в giga-admin requests/impersonate/2fa-reset/block). → Сделать `performedBy` обычной строкой или писать в Supabase-audit; проверять, что строка записалась. AC: действие giga даёт персистентную запрашиваемую audit-строку.
- **SEC-03 (High):** у Prisma-таблиц `admin_requests`/`audit_logs`/`comments` **RLS выключен** на БД с публичным anon-ключом (`scripts/init-schema.sql:255,274,286`). → `REVOKE` anon/authenticated (server-only) или включить RLS. AC: прямой anon `/rest/v1/admin_requests` → 401.
- **SEC-04 (High):** `POST /api/client/register` неаутентифицирован, без rate-limit, берёт `userId`/`email` из тела, апсертит profiles + создаёт `admin_requests` → спам очереди (`client/register/route.ts:18-31,37,79,97`). → Требовать сессию с `user.id===body.userId`; rate-limit; или перенести в trigger. AC: unauth→401; несовпадение id→403; 429 после N.
- **SEC-05 (High):** giga-панель = единый общий пароль, без identity, обходит MFA-гейт (ранний return в middleware) (`giga-admin/auth/route.ts:48-63`; `middleware.ts:137-142`). → Привязать к реальной super_admin Supabase-сессии + MFA; сократить TTL cookie. AC: действия giga атрибутируемы; MFA включён. **Решение владельца — §16 Q1.**

**Medium/Low:** SEC-06 CRM-токены plaintext (крипто-хелпер есть, не используется); SEC-07 «block user» удаляет лишь мёртвые NextAuth-сессии, нет `blocked`-статуса и инвалидации Supabase; SEC-08 AI-инсайты видны клиенту сразу + staff может править чужой инсайт (IDOR, нет publish-гейта); SEC-09 два giga read-роута авторизуют, но читают anon-клиентом → RLS отдаёт 0 строк (панели survey/documents сломаны); SEC-10 auth-store дефолтит `status='approved'` (fail-open); SEC-11 `email_confirm:true` пропускает верификацию, пароль min 6; SEC-12 fallback на anon-key при отсутствии service-key; SEC-13 `x-user-role` на каждом ответе + 22 роута эхают `error.message`; SEC-14 `xlsx@0.18.5` (proto-pollution/ReDoS) парсит недоверенные загрузки.

### 5.3 Backend / API (BE) — owner: backend

**High:** BE-01 платный Claude без auth (`/api/gri/financial-analyst`, `/ai-strategy` — только IP rate-limit); BE-02 `/api/notifications*` на мёртвом NextAuth+`prisma.notification` (живой фид = Supabase `app_notifications`); BE-03 `/api/reports/upload,[id]` на мёртвом NextAuth+Prisma (сломано для Supabase-юзеров; также прод-риск загрузки — Supabase Storage); BE-04 `/api/clients/[id]/gri/calculate` + `/clients/*` на мёртвом NextAuth, у `gri/calculate` нет ownership-scoping (латентный IDOR); BE-05 admin approve возвращает 200 «approved» даже при 0 обновлённых строк (`approve/route.ts:100-109`); BE-06 три admin-бэкенда (`api/admin` vs `giga-admin` vs `v1/admin`) пишут разные таблицы/статусы; BE-07 `giga-admin/requests/[id]` PATCH использует camelCase-имена против snake_case-таблицы → тихий null + best-effort 200.

**Medium/Low:** BE-08 неатомарный medical delete+insert; BE-09 утечка `error.message` ~25 роутов; BE-10 несогласованный конверт ответа; BE-11 нет пагинации / full-table JS-joins; BE-12 неаутентиф. `/api/health` палит имена env + фейковый uptime; BE-13 нет rate-limit на `/escalate,/validate,/chat,materialize,client/register`; BE-14 `converse` без `maxDuration`; BE-15 Inngest signing key не задан; BE-16 безлимитный PDF/XLSX; BE-17 утечка ошибок в dev-роуте; BE-18 non-constant-time сравнение giga-пароля; **BE-19 платёжный стаб — намеренный, НЕ блокер**; BE-20 спуфится `x-forwarded-for` как ключ rate-limit.

### 5.4 Frontend (FE) — owner: ui-engineer / frontend

**High:** FE-01 два несовместимых `UserRole` (`SUPER_ADMIN|ADMIN|MANAGER|ANALYST|CLIENT` vs `admin|expert|owner|client|super_admin`; `MANAGER/ANALYST` недостижимы, `expert/owner` вне nav-union) — `types/index.ts:5`, `stores/auth.store.ts:13`, `lib/navigation.ts`; FE-02 хрупкий мост `(user?.role||'CLIENT').toUpperCase()` → пустая/неверная навигация при любом переименовании; FE-03 `dashboard/gri/profile` реализованы 3× копиями (не ре-экспортами), лейблы уже разошлись; FE-04 ~84 компонента с `useEffect`-fetch-водопадами против 7 RQ-хуков (persisted RQ есть, но используется 6 файлами).

**Medium/Low:** FE-05 два источника правды auth; FE-06 post-login redirect строен трижды и расходится; FE-07 hydration-mismatch `sidebarCollapsed`; FE-08 error.tsx только в 2/7 групп; FE-09 3 движка GRI + дублирующий shadcn-subtree + монолит 1764 строк; FE-10 4 Sidebar + 3 Header; FE-11 онбординг — нетипизированный `Record<string,unknown>` + prop-drilling, нет Zod на 12 шагах; FE-12 medical/ecommerce — copy-paste воронки; **FE-13 премиум-разблокировка постит промокод как пароль в `/api/giga-admin/auth`** (пересекается с безопасностью); FE-14 `Logo` зря `'use client'`; FE-15 Point-A v1+v2 оба в проде; FE-16 `V2/V3`-варианты карточек + 6 рендереров радара; FE-17 `GRIAssessment` хардкод демо-радара (=COR-02); FE-18 «дженерик»-примитивы зашивают RU-копирайт (блокирует i18n).

### 5.5 Ссылки и редиректы (LNK) — owner: frontend + владелец продукта. Полностью — §6.

**High:** LNK-01 open-redirect в OAuth-callback; LNK-02 несогласованность `aistart360.com` в mini-GRI-письме.
**Medium/Low:** LNK-03 `/login?from` без same-origin; LNK-04 `/2fa?from` без same-origin; LNK-05 impersonate `redirectTo` без валидации; LNK-06 market-iframe шлёт Supabase-токен cross-origin (проверить origin); LNK-07 `window.open` без noopener; LNK-08 notif `router.push(n.link)` из БД; LNK-09 checkout внешний переход; LNK-10 `client.website` href без санитизации схемы (`javascript:`); LNK-15 tidycal захардкожен ×8.

### 5.6 UI/UX / Mobile / A11y (UX) — owner: ui-engineer

**Critical/High:** UX-01 (**Critical**) `text-sm` (14px) инпуты → iOS-зум при фокусе на **всех формах**; UX-02 (High) `app/client/*` без Sidebar/Header/MobileNav → мобильные тупики; UX-03 (High) хедер Точки А — 5 переносящихся кнопок <44px; UX-04 (High) GRI 1–10 `grid-cols-10` ~29px; UX-05 (High) онбординг: двойной sticky + 12 пилюль выталкивают форму за фолд; UX-06 (High) market-iframe `minHeight:640` форсит десктоп на мобиле.

**Medium/Low:** UX-07 тосты перекрывают bottom-nav + `role=alert` навязчив; UX-08 Modal без focus-trap; UX-09 icon-кнопка ~32px; UX-10 в `(dashboard)` нет бургера (несогласованно с expert/owner); UX-11 поиск в хедере `text-xs` (зум) + reflow; UX-12 табы метрик переносятся в 2 ряда; UX-13 два источника шрифтов (Tailwind vs globals.css); UX-14 30+ raw-hex фонов против токенов; UX-15 GRI — raw-цвета статуса + эмодзи; UX-16 KpiBlock фейковый hover без button-роли; UX-17 uppercase 12px кириллица-лейблы; UX-18 expert-хедер 36px контролы; UX-19 disabled LinkedIn неотличим от активного Google; UX-20 тост без паузы на hover.

### 5.7 Производительность (PERF) — owner: performance / backend

**High:** PERF-01 31 FK `@@index` в схеме, но **ни одна миграция не создаёт их** в проде; PERF-02 auth резолвится ~2× в middleware + полный клиентский `auth.store.init()` на каждый маунт; PERF-03 5 Google-семейств + full-axis Material Symbols render-blocking, ноль `next/font`; PERF-04 84 сырых `useEffect`+`fetch` против 7 RQ (`onboarding/status`×6, `gri/assessment`×9, нет дедупа).

**Medium/Low:** PERF-05 170 `force-dynamic` против 2 кэшируемых; PERF-06 `/api/health` поллинг каждые 5с без in-flight-гарда; PERF-07 documents-поллинг 10с без терминального условия; PERF-08 огромные `'use client'`-модули (GRICalculator 1764, pulse 1288, PointBView 1008 — 0 мемоизации); PERF-09 две тост-системы; PERF-10 эмбеддинги вставляются по-чанково в цикле; PERF-11 raw `<img>`-логотипы; PERF-12 мёртвые recharts-листья; PERF-13 17 хардкод `'JetBrains Mono'` + 909 Material Symbols блокируют миграцию на next/font; PERF-14 нет bundle-analyzer/CI-бюджета.

**Подтверждённо применено из прошлого перф-аудита:** AI-таймауты, rate-limit `opts.max`, серверный `cache()` для auth, честный `/api/metrics` 500, recharts→dynamic на всех 6 графиках, фикс cross-user SW-кэша, lazy-маскот. Публичные ассеты чисты (0 файлов >200 КБ).

### 5.8 Ассистент «Гри» (GRI) — owner: ai-pipeline-engineer. Спека — §11.

**High:** GRI-01 чат-LLM page-blind (screen шлётся в теле, но не в промпт); GRI-02 progress-blind (completion в `/context`, не в снимке); GRI-03 `/converse`&`/insight` троттлятся по IP, не per-user; GRI-04 нет рейла быстрых команд (10 глаголов).
**Medium/Low:** GRI-05 нет feedback-петли (`/feedback` есть, чат не вызывает); GRI-06 нет retention-джоба для `assistant_events` (обещан миграцией 038); GRI-07 insight-снимок одинаков по экранам; GRI-08 ручной fallback хардкодит голос «Гри»; GRI-09 нет базы знаний платформы; GRI-10 `/escalate` без rate-limit; GRI-11 тред эфемерный; GRI-12 туры на одиночном `h1`; GRI-13 нет latency-бюджета на Sonnet; GRI-14 `/analyze` не используется чатом.

### 5.9 Туториалы / онбординг (TUT) — owner: ui-engineer + ai-pipeline. Спека — §12.

**High:** TUT-01 движок примонтирован в 2 из 5 групп → 26 страниц owner/expert без онбординга; TUT-02 маскот прячется при открытой клавиатуре → тур опроса не показывается на мобиле; TUT-03 фикс. `CARD_W=330` переполняет <360px; TUT-05 `h1`-якоря отсутствуют на `/gri`, `/client/dashboard` → тур вырождается, но всё равно ставит `toursDone`.
**Medium/Low:** TUT-06 documents наследует не тот тур; TUT-07 интеграции «покажи туториал» в чате нет; TUT-09 welcome/waiting-room без тура; TUT-10 хрупкий селектор market; TUT-11 мёртвый `tutorialDone`; TUT-12 a11y оверлея на мобиле; TUT-13 нет сквозного journey.

### 5.10 Кастомизация дашборда (DASH) — owner: ui-engineer + data-engineer. Спека — §13.

**High:** DASH-01 кастомизация теряется между устройствами (localStorage-only); DASH-02 движок примонтирован только на admin-ветке — клиенты без кастомизации; DASH-03 3 из 6 виджетов кормятся пустыми массивами; DASH-04 нет drag-and-drop (только move up/down).
**Medium/Low:** DASH-05 `widget_config` пишется, но не читается при рендере; + мобильная плотность (`grid-cols-12`), mock-данные ecommerce, нет единого контракта loading/empty/error, нет per-role дефолт-лейаута, общий localStorage-ключ, нет аналитики, a11y reorder.

---

## 6. Аудит ссылок и редиректов

**Инвентарь:** ~95 внутренних ссылок, ~15 внешних, **11 внешних доменов**. `next.config.mjs` — без `redirects()/rewrites()`, сильный CSP (`frame-ancestors 'none'`, `X-Frame-Options: DENY`). Все 14 `target="_blank"` имеют `rel="noopener noreferrer"`. Материальный класс риска — **инъекция цели редиректа**, не угон вкладки.

| ID | Sev | Источник | Элемент | Ссылка | Назначение | Int/Ext | Проблема | Рекомендация | Спросить владельца? |
|---|---|---|---|---|---|---|---|---|---|
| LNK-01 | High | `auth/callback/route.ts:10,13` | OAuth callback | `new URL(next, origin)` | произвольное (проверено: уходит с origin) | Ext-инъекция | open redirect на unauth-эндпоинте | пускать только `/`-пути, не `//` | **Да** |
| LNK-02 | High | `api/public/mini-gri/route.ts:162` | CTA лид-письма | `https://aistart360.com/register` | aistart360.com | Ext | неверный/возможно мёртвый домен | канонический домен из env | **Да** |
| LNK-03 | Med | `login/page.tsx:18,42` | post-login | `router.push(from)` | любое | Ext-инъекция | off-site nav | same-origin guard | **Да** |
| LNK-04 | Med | `2fa/page.tsx:11,71,103` | post-2FA | `router.replace(from)` | любое | Ext-инъекция | тот же `from` | same-origin guard | **Да** |
| LNK-05 | Med | `giga-admin/impersonate/route.ts:55` | impersonation | `origin+redirectTo` | Supabase magic-link | Ext | `redirectTo` не валидируется (super_admin) | валидировать `/`-путь | **Да** |
| LNK-06 | Med | `MarketAppEmbed.tsx:117,195` | iframe-мост | `postMessage({access_token})` | внешний Mark SPA | Ext | живой Supabase-токен cross-origin (сделано со scoped origin) | подтвердить доверенный origin; scoped token | **Да** |
| LNK-08 | Low | `NotificationsFeed.tsx:78` | клик уведомления | `router.push(n.link)` | значение из БД | Int | редирект если строка = абсолютный URL | assert `/`-путь | **Да** |
| LNK-09 | Low | `CheckoutButton.tsx:56` | checkout CTA | `location.href=checkoutUrl` | платёжный провайдер (стаб) | Ext | внешний переход при живом эквайринге | подтвердить разрешённые хосты | **Да** |
| LNK-10 | Low | `ClientsModule.tsx:223` | сайт клиента | `<a href={client.website}>` | произвольный URL | Ext | нет санитизации схемы (`javascript:`) | только `http(s)` | Нет |
| LNK-07 | Low | giga-panel `window.open` | «Открыть как юзер» | `window.open(url,'_blank')` | внутр. magic-link | Int | нет `noopener` | добавить `'noopener,noreferrer'` | Нет |
| LNK-15 | Info | 8 dashboard-компонентов | «Разобрать с экспертом» | `https://tidycal.com/istart/gtm` | TidyCal | Ext | корректный `rel`, но хардкод ×8 | подтвердить URL; централизовать | **Да** |

**11 внешних доменов:** `aistart360.com` (mini-GRI email + `from` — **HIGH, несогласовано**), `aistart360.app` (share/mailto/WebAuthn RP ID), `aistart360.vercel.app` (текущий деплой), `tidycal.com` (букинг, ×8), `*.supabase.co`, `openrouter.ai`, `api.telegram.org`, `graph.facebook.com` (WhatsApp), `cloud.langfuse.com`, `fonts.googleapis.com`/`gstatic.com`, `lh3.googleusercontent.com`. Плюс `dev.1c-bitrix.ru`, `www.amocrm.ru` (docs-инфо) и `NEXT_PUBLIC_MARKET_APP_URL`.

**Ссылки, требующие подтверждения владельца (сведено в §16):** LNK-01, LNK-02, LNK-03, LNK-04, LNK-05, LNK-06, LNK-08, LNK-09, LNK-15.

---

## 7. Backend — техническое задание

**Текущие риски:** мёртвый NextAuth/Prisma-путь = корень BE-02/03/04 и багов CRM; три admin-бэкенда с расходящейся семантикой approve/block; неаутентифицированные платные AI-роуты; отсутствие единого конверта/валидации/политики ошибок.

**Требуемые улучшения / задачи:**
1. **Ретировать NextAuth/Prisma-tenant-путь** (или мигрировать 9 «зомби»-роутов на Supabase): notifications→`app_notifications`, reports/upload→Supabase Storage, clients/*→Supabase с ownership-scoping, gri/calculate→scoping. AC: ни один прод-роут не читает `getServerSession`/Prisma-tenant-таблицы; CRM-страницы (Settings/Pulse) не отдают 401.
2. **Единый approval/block-сервис** `lib/users/approval.ts` (уже частично есть) — вызывается всеми admin-поверхностями; падать при `affected===0`. AC: approve/reject/block из любой панели пишут `profiles.status`, при 0 строк → ошибка, а не 200.
3. **Обязательный Zod** (сейчас валидируют 24/165 роутов) + общий конверт `{ok,data,error,meta}` + хелпер `fail(code,status)`, никогда не отдающий сырую драйвер-ошибку. AC: 100% мутационных роутов валидируют вход; ни один не эхает `error.message`.
4. **Политика rate-limit:** запретить unauth платные AI (BE-01); per-user ключи ≤6/мин на AI; per-IP ≤5/мин на публичные записи; single-flight `materialize`. Ключ не на спуфящемся `x-forwarded-for` (BE-20). AC: unauth AI→401; повторные вызовы→429.
5. **`/api/health`** — убрать утечку env-имён и фейковый uptime; закрыть или свести к минимальному пингу (BE-12). AC: ответ не содержит имён переменных.
6. **Атомарность medical** delete+insert в транзакцию (BE-08). **Пагинация** списков + перенос JS-join в SQL (BE-11). **Inngest signing key** задать (BE-15).

**Изменения модели данных:** консолидировать статусы на `profiles.status`; `audit_logs.performedBy` → строка или Supabase-audit-таблица (SEC-02); шифровать CRM-токены (SEC-06); lifecycle инсайтов `draft→pending_review→approved→published` + `visible_to_user` (SEC-08). Миграционные риски: изменение FK `performedBy` — проверить существующие строки; `REVOKE` на Prisma-таблицах — убедиться, что внешние инструменты не читают их anon-ключом (§16 Q2).

---

## 8. Frontend — техническое задание

**Наблюдения архитектуры:** App Router не злоупотреблён (46/81 — серверные компоненты), middleware-роутинг корректен. Два системных зла — **дублирование** и **несогласованность состояния**.

**Задачи:**
1. **Один канонический `UserRole`** (lowercase), переписать nav/permissions, удалить `MANAGER/ANALYST` (FE-01/02). AC: единый `UserRole` импортируется везде; нет `.toUpperCase()` для роли; тест role→nav.
2. **Схлопнуть 3× `dashboard/gri/profile`** в role-параметризованные общие вью; owner/expert — тонкие обёртки ≤~30 строк; лейблы GRI определены один раз (FE-03). AC: лейблы в одном месте; обёртки тонкие.
3. **State-стратегия:** server-first данные; клиентские чтения — только типизированные RQ-хуки (эталон `hooks/useMetrics.ts`); запрет новых `fetch`-в-`useEffect` (FE-04/05, PERF-04). AC: новые клиентские GET через RQ; 1 запрос на `queryKey`/загрузку.
4. **Один `roleLandingPath(role,status)`** для login/register/middleware (FE-06). **Один config-driven `<AppSidebar role>` + `<AppHeader role>`** (FE-10). **Одно ядро GRI** + удалить дубль shadcn (FE-09). AC: один Sidebar/Header; один GRI-движок.
5. **Error/empty/loading:** добавить `error.tsx` во все 7 групп (FE-08); общий `<ErrorState>`/`<EmptyState>`. **Формы:** RHF+Zod-стандарт, схема на шаг онбординга + типизированные ответы (FE-11). AC: у каждой группы error-boundary; шаги валидируются.
6. **Гидратация:** гейтить чтение persisted-store на `hasHydrated` (FE-07). **Убрать промо-как-giga-пароль** (FE-13) — отдельный promo-эндпоинт. **Довести Point-A v2**, удалить v1 (FE-15); консолидировать KPI-карточку + радар (FE-16); параметризовать вертикали (FE-12).

---

## 9. UI/UX и мобилка — техническое задание

**Сильная база (не трогать):** глобальный `prefers-reduced-motion`, `:focus-visible`-кольца, `touch-action: manipulation`, честные empty/down/error, брендовые 404/loading/error, токен-лестница. **Анимации не резать** — они лёгкие, jank не найден.

**Мобилка (по приоритету — топ-10):**
1. UX-01 — инпуты ≥16px на мобиле (убить iOS-зум) — эталон `components/ui/Input.tsx`, затрагивает **все формы**. AC: нет зума вьюпорта при фокусе.
2. UX-02 — дать `app/client/*` реальную мобильную навигацию (bottom-nav/меню). AC: Точка А/Б достижимы все секции с мобилы.
3. UX-05 — онбординг: одна прокручиваемая полоса шагов, убрать второй sticky. AC: первое поле видно на 667px.
4. UX-03 — хедер Точки А → overflow-меню, ≥40px. AC: один ряд на 375px.
5. UX-04 — GRI 1–10 → 5×2/скролл, ≥44px, токенизировать. AC: ≥44px на 360px.
6. UX-06 — market-iframe: не форсить 640px десктоп; мобильный гейт «открыть на десктопе». AC: нет вложенного горизонтального скролла.
7. UX-07 — тосты выше bottom-nav (`bottom-24 lg:bottom-6`), success→`role=status`. AC: тосты не перекрывают nav.
8. UX-12 — табы метрик: скролл, не перенос. 9. UX-09/UX-18 — icon/header-контролы ≥40px. 10. UX-11 — поиск: без зума и reflow.

**Визуал/дизайн-система:** UX-13 свести два источника шрифтов к одним CSS-переменным; UX-14 консолидировать 30+ raw-hex к токенам; UX-15 GRI-статусы — Material Symbols + токены (AA-контраст). **A11y:** UX-08 focus-trap в Modal + restore-focus + `aria-describedby`; UX-17 sentence-case лейблы; UX-16 честный affordance KpiBlock; UX-19 пометить disabled-соцкнопки «скоро»; UX-20 пауза тоста на hover, ошибки — персистентны. Каждое визуальное изменение имеет цель (см. отчёт §5 UX). **Правило:** без тяжёлых анимаций.

---

## 10. Производительность — план оптимизации

**Узкие места:** FK-индексы не в проде (PERF-01); двойной auth + клиентский init (PERF-02); render-blocking шрифты (PERF-03); 84 сырых fetch (PERF-04); 170 `force-dynamic` (PERF-05); агрессивный поллинг health/documents (PERF-06/07); тяжёлые немемоизированные client-модули (PERF-08).

**Задачи (высокий рычаг → низкий):**
1. `041_fk_indexes.sql` с `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, применить `scripts/apply-migration.js`. AC: `EXPLAIN` на clients-by-managerId/documents-by-clientId → Index Scan.
2. Seed Zustand из `x-user-role`-хедера; не звать `init()`, когда роль известна. AC: 0 клиентских `/auth/v1/user`+`profiles` на тёплой навигации.
3. Мигрировать на `next/font/google`; сабсет Material Symbols (разблокировать PERF-13). AC: нет `fonts.googleapis.com` в критическом пути; CLS<0.1.
4. Общие RQ-хуки `useOnboardingStatus()`/`useGriAssessment()`. AC: 1 запрос на `queryKey`/загрузку.
5. Детерминированные GET → `revalidate`/`unstable_cache` (PERF-05). Поллинг health→30с+in-flight+pause on hidden (PERF-06); documents-поллинг останавливать при отсутствии `queued/processing` (PERF-07). RSC-шелл + мемоизация горячих модулей (PERF-08). Одна тост-система (PERF-09). Bundle-analyzer + CI-бюджет (PERF-14).

**Целевые метрики:**

| Метрика | Цель | Как измерять |
|---|---|---|
| Mobile initial load (cold dashboard) | <3.5s TTI Fast 3G | Lighthouse mobile `/dashboard` |
| LCP (mobile) | <2.5s | Lighthouse + web-vitals |
| CLS | <0.1 | Lighthouse (риск font-swap) |
| INP | <200ms | web-vitals + React Profiler (PointBView/GRICalculator) |
| TTFB (тёплая нав) | <0.8s | Server-Timing после PERF-02 |
| First-Load JS (data-роуты) | baseline −150KB gz | `ANALYZE=true next build` |
| API-запросов/загрузку дашборда | −5+ дублей | Network до/после PERF-04 |
| `/api/health` нагрузка | ≤1 req/30с/таб | Network после PERF-06 |
| Image budget (public/) | нет >200KB | `find public -type f -size +200k` — **сейчас чисто** |

**Измерительный гейт:** одноразовый Lighthouse-mobile + bundle-analyzer baseline (нужен `npm install` + build) перед применением PERF-02/03/04, чтобы квантифицировать каждый фикс.

---

## 11. Ассистент «Гри» — техническое задание

**Улучшенная роль:** контекстный помощник, знающий текущий экран и прогресс пользователя, с рейлом быстрых команд, базой знаний платформы и петлёй обратной связи. **Сохранить:** границу фактов через единый RLS-снимок, защиту от инъекций + secret-filter + PII-маскинг, anti-annoyance-кулдауны, смену персоны только по character, feature kill-switch.

**Новая функциональность:**
1. **Рейл быстрых команд** (чипы над тредом, доступность по экрану): «Объясни эту страницу» · «Что делать дальше?» · «Покажи туториал» (→`tourForScreen`) · «Найди инструмент» (→KB nav) · «Итог прогресса» · «Помоги исправить ошибку» (→issues `runValidation`) · «Рекомендуй следующий шаг» (→`/analyze`) · «Поиск» (→KB) · «Объясни виджеты» (→tour/glossary) · «Проведи по настройке». AC: 10 команд, каждая grounded/запускает верный тур.
2. **Контекст экрана + прогресс:** добавить `progress{completionPct, completedSections, totalSections, nextSection, status}` в `AssistantContext`; протянуть `screen` в `converseWithGree`/`answerUserQuestion`; инжектить блок «ТЕКУЩИЙ ЭКРАН + ПРОГРЕСС» (GRI-01/02). AC: «что на этой странице?» и «мой прогресс» отвечают конкретикой (N/12, следующий раздел).
3. **Per-user троттлинг** `/converse`&`/insight` (GRI-03) + rate-limit `/escalate` (GRI-10). AC: два юзера/один IP держат свои квоты; ротация IP не обходит.
4. **База знаний** `lib/assistant/mascot/knowledge-base.ts` (ROUTES/WIDGET_GLOSSARY/HOWTO) — grounding навигации/how-to, никогда для чисел, без admin-роутов (GRI-09).
5. **Feedback-петля:** 👍/👎 на каждое сообщение → `/feedback` (GRI-05). **Retention-джоб** для `assistant_events` >90д (GRI-06). **Insight per-screen** foreground релевантного среза (GRI-07). **Latency-бюджет:** короткие/nav-интенты → Haiku; nudge >8с (GRI-13). Подключить `/analyze` к «Рекомендуй следующий шаг» (GRI-14).

**Промпт (конкретика RU):** «КОНТЕКСТ ЭКРАНА: если вопрос про „эту страницу/здесь/этот виджет“ — отвечай про текущий экран»; «ПРОГРЕСС: опирайся на реальный процент и следующий раздел, не выдумывай»; «навигация — используй ТОЛЬКО маршруты из базы знаний». Версионировать константой `GREE_PROMPT_VERSION`.

**Аналитика:** `quick_action_used`, `feedback` up/down→helpful-rate, `intent` в `answer_received`, `tour_started/completed`. KPI: helpful-rate, escalation-rate, quick-action CTR, p50/p95 latency, insufficient-data rate/экран. **UI/мобилка:** рейл поверх треда; панель — bottom-sheet на мобиле. **Интеграция с туториалами:** чип «Показать подсказки этой страницы» → `aistart:tutorial:start`.

---

## 12. Расширение туториалов — техническое задание

**Один движок, `data-tour`-якоря** (убирает класс багов с `h1`/дженерик-селекторами). Расширить `TourStep` полями `mobileText`, `placement:'sheet'`, `completeOn`.

**Задачи:**
1. **Покрытие:** примонтировать движок в `(owner)` и `(expert)` layout (TUT-01, 26 страниц). Добавить туры для `/client/welcome`, `/waiting-room`, `/insights`, `/owner/dashboard`, `/expert/dashboard`; починить `/gri`, `/client/dashboard`, documents. AC: тест на существование якорей; mount-coverage во всех группах.
2. **Мобилка:** ширина `min(330, vw-24)`, bottom-sheet placement, blur input перед шагами опроса, оверлей независим от клавиатуры/видимости маскота, tap-scrim skip (TUT-02/03/12). AC: карточка влезает на 360px; тур опроса показывается на телефоне.
3. **Отсутствие ложного `toursDone`** при отсутствующем якоре (TUT-05). AC: `toursDone` не ставится, если шаги не показаны.
4. **Интеграция с «Гри»:** чип «Показать подсказки этой страницы» + скриптовый интент → `aistart:tutorial:start` (TUT-07). **Journey (опция):** упорядоченный резюмируемый welcome→survey→docs→GRI c `journeyStep`, объединяющий прогресс FirstRunWizard (TUT-13). Убрать мёртвый `tutorialDone` (TUT-11).

**Per-page план** (для каждого ключевого экрана): триггер, целевые роли, шаги, подсвечиваемые элементы, текст шага (RU), поведение на мобиле, условие завершения, метод реплея — полностью в `docs/audit-2026-07-07/08-tutorials-onboarding.md`.

---

## 13. Кастомизируемый дашборд — техническое задание

**Ключевое:** движок кастомизации **уже есть** (`components/dashboard/WidgetGrid.tsx` — реестр, add/remove, reorder up/down, edit-mode, empty-state), но admin-only, с пустыми данными, persist в localStorage. Обобщить его.

**Архитектура:**
- **Реестр** `lib/dashboard/registry.ts`: `{id, title, category, size, roles, vertical, defaultEnabled, dataSource, component}`.
- **Единый `WidgetShell`** владеет loading/empty/error. Эволюционировать `DashboardGrid`.
- **Персистентность:** новая таблица `dashboard_layouts(user_id, surface, role, layout jsonb, updated_at, PK(user_id,surface))` со self-scoped RLS (набросок миграции — в отчёте DASH); альтернатива — `profiles.preferences.dashboard` через существующий deep-merge-эндпоинт `/api/v1/settings/preferences`.
- **Библиотека:** `@dnd-kit/core + /sortable` (~10–15KB gz, доступно, touch), lazy в edit-mode. `react-grid-layout` **отклонён** (тяжёлый, уже снят из репо).

**Флоу:** add (переиспользовать `AddWidgetDialog`), remove, reorder (DnD desktop + up/down mobile), resize (span-cycling), autosave, reset-to-role-default. Состояния: empty-dashboard, widget loading, widget error.

**12 seed-виджетов:** Progress overview, Recent activity, «Гри» suggestions, Tutorials to complete, Quick actions, Notifications, KPIs, Saved resources, Tasks, Next steps, Alerts, GRI (с флагами reuse-vs-net-new и per-role дефолтами).

**MVP:** клиентский `/dashboard`, reuse-виджеты + реальные данные (закрыть DASH-03), DB-персистентность (DASH-01), add/remove/reorder/reset, единые состояния, мобильный up/down, аналитика + a11y. **Later:** resize, long-press drag, вертикальные дашборды, решение по `widget_config`, tasks/saved-resources (модели данных нет). AC на каждую способность — в отчёте DASH.

---

## 14. Дорожная карта внедрения

### Phase 1 — Критические фиксы (безопасность, редиректы, корректность, мобильные блокеры)
**Цель:** снять всё, что бьёт по безопасности, данным и мобильному доступу.
**Задачи:** SEC-01 ротация пароля БД · SEC-03/04 REVOKE + гейт register · LNK-01 open-redirect · LNK-02 домен (после ответа владельца) · UX-01 iOS-зум инпутов · UX-02 мобильная навигация client · BE-01 unauth paid-AI · BE-05 approve-0-rows · PERF-01 FK-индексы · COR-01 field-keys Точки А · FE-06/LNK-03/04 `roleLandingPath` + same-origin guard · FE-13 промо≠giga-пароль · SEC-05 giga (по решению владельца).
**Owners:** data-engineer, backend, ui-engineer. **Зависимости:** ответы владельца (домен, giga, REVOKE). **Риски:** ротация секрета/`REVOKE`/индексы на общей проде — прогон в off-peak. **AC:** все Critical + перечисленные High закрыты и верифицированы.

### Phase 2 — Ядро UX и производительность
**Цель:** мобильная эргономика, скорость, чистка архитектуры.
**Задачи:** UX-03…UX-15 (мобилка+дизайн-система) · PERF-02/03/04/05/06/07/08/09 · FE-01/02/03/04/09/10 (роли/дедуп/рефактор) · BE-09/10/13 (конверт/валидация/утечки/rate-limit) · TUT-02/03 (мобильные баги туров) · COR-02 (GRI TOP-5/план).
**Owners:** ui-engineer, frontend, performance, backend. **Зависимости:** измерительный baseline (§10). **AC:** мобильный usability-чеклист (§15) зелёный; целевые метрики измерены/достигнуты.

### Phase 3 — Апгрейд «Гри»
**Задачи:** GRI-01…GRI-14, база знаний, рейл команд, feedback, per-user троттлинг, аналитика. **Owner:** ai-pipeline-engineer. **Зависимости:** Phase 2 (прогресс/контекст-снимок). **AC:** §11 acceptance per capability.

### Phase 4 — Система туториалов
**Задачи:** TUT-01…TUT-13, `data-tour`-якоря, покрытие owner/expert, интеграция с чатом. **Owner:** ui-engineer + ai-pipeline. **Зависимости:** Phase 3 (интент «покажи туториал»). **AC:** §12 acceptance.

### Phase 5 — Кастомизация дашборда
**Задачи:** DASH-01…DASH-13, `dashboard_layouts`, `@dnd-kit`, реестр, MVP-виджеты. **Owner:** ui-engineer + data-engineer. **Зависимости:** Phase 2 (единые состояния/данные). **AC:** §13 MVP acceptance.

### Phase 6 — QA, регресс, релиз, мониторинг
**Задачи:** прогон §15, регресс, релиз-чеклист, аналитика/мониторинг, rollback-план. **Owner:** QA. **AC:** §17 DoD.

---

## 15. План QA и тестирования

| Test ID | Область | Сценарий | Шаги | Ожидаемо | Приоритет | Кандидат на автотест |
|---|---|---|---|---|---|---|
| T-SEC-01 | Security | Ротация пароля БД | старой строкой подключиться к БД | отказ аутентификации | Crit | нет |
| T-SEC-03 | Security | RLS/REVOKE | anon GET `/rest/v1/admin_requests` | 401 | Crit | да |
| T-SEC-04 | Security | Спам register | unauth POST `/api/client/register` + чужой userId | 401/403; 429 после N | High | да |
| T-LNK-01 | Links | Open redirect | `/auth/callback?next=https://evil.com` | не уходит с origin | Crit | да |
| T-BE-01 | Backend | Unauth AI | unauth POST `/api/gri/financial-analyst` | 401 | High | да |
| T-BE-05 | Backend | Approve 0 rows | approve несуществующего профиля | ошибка, не 200 | High | да |
| T-COR-01 | Данные | Точка А field-keys | профиль с `s9n_*` финансами | Точка А ≠ 0 | Crit | да |
| T-UX-01 | Mobile | iOS-зум | фокус в инпут на iOS Safari | нет зума вьюпорта | Crit | ручной/девайс |
| T-UX-02 | Mobile | Навигация client | с `/client/point-a` дойти до всех секций на 375px | без тупиков | High | ручной |
| T-PERF-01 | DB | Индексы | `EXPLAIN` clients-by-managerId | Index Scan | High | да |
| T-PERF-02 | Perf | Auth-дедуп | тёплая навигация, Network | 0 клиентских user/profiles | High | ручной |
| T-GRI-01 | Ассистент | Контекст экрана | «что на этой странице?» на 4 экранах | ответ про текущий экран | High | да (eval) |
| T-GRI-03 | Ассистент | Per-user throttle | 2 юзера/1 IP | свои квоты | High | да |
| T-TUT-01 | Туториалы | Mount coverage | зайти owner/expert-страницы | тур доступен | High | да |
| T-TUT-05 | Туториалы | Ложный toursDone | экран без якоря | `toursDone` не ставится | High | да |
| T-DASH-01 | Дашборд | Кросс-девайс layout | изменить layout, зайти с другого устройства | сохранён | High | да |
| T-DASH-04 | Дашборд | DnD reorder | перетащить виджет (desktop) + up/down (mobile) | порядок сохранён | Med | да |
| T-REG-* | Регресс | Полный флоу | register→approve→survey→ТочкаА→GRI→ТочкаБ→dashboard | без ошибок/401 | Crit | частично |

**Дополнительно:** a11y-прогон (focus-trap Modal, тап-таргеты ≥44px, контраст AA), кросс-браузер (iOS Safari, Android Chrome), офлайн/SW (нет cross-user-утечки — подтверждено), rate-limit-стресс.

---

## 16. Вопросы владельцу продукта

**Ссылки/редиректы (нужно до Phase 1):**
1. **Какой домен канонический и живой** — `.com`, `.app` или `.vercel.app`? (LNK-02: mini-GRI лид-письмо и `from` используют `.com`.)
2. Одобрить ограничение OAuth `next` только внутренними путями (LNK-01).
3. Одобрить same-origin guard на `/login?from=` и `/2fa?from=` (LNK-03/04).
4. Одобрить валидацию `redirectTo` в impersonate (LNK-05).
5. Доверен ли origin market-SPA для приёма живого Supabase-токена (LNK-06)?
6. Подтвердить, что все продюсеры уведомлений хранят только внутренние пути (LNK-08).
7. Разрешённые платёжные домены до запуска эквайринга (LNK-09).
8. Верен ли `tidycal.com/istart/gtm` (захардкожен в 8 компонентах) (LNK-15)?

**Безопасность/архитектура:**
9. Ретировать giga-панель на общем пароле и консолидировать на `(dashboard)/admin` — или привязать giga к реальному super_admin Supabase-логину + MFA (SEC-05)?
10. Можно ли `REVOKE` anon/authenticated на `admin_requests`/`audit_logs`/`comments` (server-only) — читает ли их какой-то внешний инструмент anon-ключом (SEC-03)?
11. Подтвердить ротацию утёкшего пароля БД (и чистить ли историю git — это перепишет хэши) (SEC-01).
12. Требовать ли approve staff перед тем, как клиент видит AI-инсайт (SEC-08)?
13. Включить реальную email-верификацию и поднять min пароля (сейчас 6, `email_confirm` пропущен) (SEC-11)?
14. «Block» должен ставить `profiles.status='blocked'` и рвать живую Supabase-сессию (SEC-07)?
15. Можно ли удалить мёртвый стек NextAuth/Prisma/bcrypt/staff-cookie целиком (блокирует CRM + включает impersonation; `specs/001-sprint1-completion` устарел)?

**Продукт/данные:**
16. Подтвердить канонические ключи опроса (`s9n_*`) и источник completion — чинит «Точка А = 0» разом (COR-01).
17. GRI канонически 62 критерия / 7 блоков? Считать ли TOP-5 + 90-дневный план сейчас (COR-02)?
18. Insights/Intelligence/Competitors — ядро-деливери или остаток портфельного вью (подключить реальные данные vs удалить)?
19. Вертикали medical/ecommerce — постоянные (config-driven) или эксперименты на удаление (FE-12)?
20. i18n на роадмапе или русский навсегда (FE-18)?
21. `KpiBlock` — кликабельные drill-down (нужна button-семантика) или display-only (UX-16)?
22. Headline-шрифт — Bricolage Grotesque (globals) или Space Grotesk (Tailwind) (UX-13)?

**«Гри»/туториалы/дашборд:**
23. Память чата — эфемерная или opt-in PII-маскированный rolling summary (GRI-11)?
24. Финален ли список из 10 команд «Гри» или добавить доменные («Объясни мой GRI», «Сравни с рынком») (GRI-04)?
25. Полноценный маскот для owner/expert или «тихий» режим tours-only (TUT-01)?
26. Сквозной резюмируемый first-run journey vs независимые per-screen туры (TUT-13)?
27. Приоритет кастомизации дашборда: клиент или staff первым? Persist — новая таблица или `preferences`-мешок? Resize в MVP? (DASH §16.)

---

## 17. Definition of Done (для всего проекта)

- Все Critical-баги закрыты и верифицированы (SEC-01, UX-01, COR-01 + подтверждённые High Phase 1).
- Не осталось нежелательных редиректов; open-redirect (LNK-01) закрыт; `?from` валидируются.
- Все спорные/внешние ссылки просмотрены владельцем (§16); домен канонизирован.
- Мобильный UI проходит usability-чеклист (§15): нет iOS-зума, нет навигационных тупиков, тап-таргеты ≥44px, тосты не перекрывают nav.
- Целевые метрики (§10) измерены и достигнуты или зафиксированы с планом.
- «Гри» знает экран и прогресс, имеет рейл команд, feedback-петлю и per-user троттлинг.
- Туториалы покрывают все ключевые страницы (вкл. owner/expert), корректны на мобиле, не ставят ложный `toursDone`.
- Кастомизация дашборда работает для клиентов (add/remove/reorder/reset, DB-персистентность, реальные данные, единые состояния).
- QA-план (§15) выполнен; регресс пройден; релиз-чеклист закрыт; rollback-план готов; аналитика/мониторинг включены.

---

## 18. Финальный приоритизированный бэклог

| Приоритет | Задача | Область | Owner | Зависимости | Acceptance |
|---|---|---|---|---|---|
| P0 | SEC-01 ротация пароля БД | Security | data-eng | — | старая строка не аутентифицирует |
| P0 | COR-01 field-keys Точки А | Данные | data-eng/ai | Q16 | Точка А ≠ 0 на финансовом профиле |
| P0 | UX-01 iOS-зум инпутов | Mobile | ui-eng | — | нет зума при фокусе |
| P0 | LNK-01 open-redirect callback | Links | frontend | Q2 | не уходит с origin |
| P0 | SEC-03/04 REVOKE + гейт register | Security | data-eng/backend | Q10 | anon→401; register→401/403/429 |
| P0 | BE-01 unauth paid-AI | Backend | backend | — | unauth→401 |
| P0 | BE-05 approve-0-rows | Backend | backend | — | 0 строк→ошибка |
| P0 | PERF-01 FK-индексы | DB | data-eng | Q10 | Index Scan |
| P0 | UX-02 мобильная навигация client | Mobile | ui-eng | Q(UX-02) | нет тупиков |
| P1 | SEC-05 giga identity+MFA | Security | data-eng | Q9 | атрибуция + MFA |
| P1 | SEC-02 рабочий audit-трейл | Security | backend | — | запрашиваемая audit-строка |
| P1 | FE-01/02 канонический UserRole | Frontend | frontend | Q(роли) | единый enum |
| P1 | FE-03/09/10 схлопнуть дубли | Frontend | ui-eng | — | один Sidebar/Header/GRI |
| P1 | FE-04/PERF-04 RQ-дедуп | Perf/FE | frontend | baseline | 1 запрос/queryKey |
| P1 | PERF-02/03 auth+шрифты | Perf | performance | baseline | 0 клиент-auth; CLS<0.1 |
| P1 | UX-03..15 мобилка/дизайн | Mobile/UX | ui-eng | — | usability-чеклист |
| P1 | COR-02 GRI TOP-5/план | Данные | data-eng/ai | Q17 | реальные баллы/план |
| P1 | BE-09/10/13 backend-гигиена | Backend | backend | — | конверт+валидация+rate-limit |
| P1 | TUT-01/02/03/05 туры (mount+mobile+якоря) | Туториалы | ui-eng | — | покрытие+мобилка |
| P2 | GRI-01..04 контекст+команды | Ассистент | ai-pipeline | Phase 2 | §11 AC |
| P2 | GRI-05..14 остальное «Гри» | Ассистент | ai-pipeline | — | §11 AC |
| P2 | TUT-06..13 расширение | Туториалы | ui-eng/ai | Phase 3 | §12 AC |
| P2 | DASH-01..13 кастомизация | Дашборд | ui-eng/data | Phase 2, Q27 | §13 MVP AC |
| P3 | SEC-06/07/08/11 + BE-08/11/15 | Security/Backend | backend | Q12/13/14 | по каждому AC |
| P3 | FE-11/12/15/16, UX-16..20, PERF-05..14 | Разное | mixed | — | по каждому AC |
| P3 | Идеи-фичи (§19) — по выбору владельца | Продукт | mixed | Q | по выбору |

---

## 19. Идеи для улучшения UX (мини-функции, тренажёры, доп-услуги)

Гипотезы для повышения ценности и вовлечения (каждую — валидировать с владельцем перед реализацией):

- **«Тренажёр Точки Б»** — интерактивный what-if: слайдеры по драйверам роста → пересчёт прогноза выручки в реальном времени (переиспользует point-b-engine).
- **GRI-симулятор** — «если поднять блок X с 4 до 7, GRI вырастет на N» — учебный режим поверх диагностики.
- **Еженедельный дайджест «Гри»** — email/telegram с прогрессом, следующим шагом и одним инсайтом (переиспользует `/analyze` + существующие каналы).
- **Чек-лист онбординга с наградами** — прогресс-бар «до первого инсайта», микро-достижения (снижает drop-off).
- **Библиотека мини-GRI по нишам** — быстрые бесплатные экспресс-диагностики как lead-magnet (расширение `/gri-free`).
- **«Сравнить с рынком»** — виджет-бенчмарк на данных Mark-analytics (уже интегрирован) как быстрая команда «Гри».
- **Сценарии Точки Б (уже есть `client/scenarios`)** — довести до полноценного сравнения 2–3 стратегий бок о бок.
- **Экспорт-центр** — единая страница выгрузок (PDF-отчёт, XLSX call-list, презентация) вместо разрозненных кнопок.
- **Напоминания-нуджи** — «вы остановились на шаге 7/12» через уведомления (переиспользует `app_notifications`).
- **Doctor-mode для экспертов** — панель «что проверить у клиента» с быстрыми действиями валидации AI-инсайтов.
- **Публичные шаринг-карточки** — красивые OG-превью для `/r/[token]` (рост виральности), с учётом приватности.

> Приоритет и объём этих идей — за владельцем продукта; они не входят в Phase 1–2 (сначала баги/безопасность/мобилка, затем полировка).

---

*Детальные пофайловые отчёты: `docs/audit-2026-07-07/00-baseline-product.md` … `09-dashboard-customization.md`.*
