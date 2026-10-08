# 01 · Аудит пользовательской части (User Portal)

> Product discovery 2026-09-23. Аудит по коду; сервер, браузер и БД не использовались. Статусы: EXISTING / IMPROVEMENT / MISSING / UNCLEAR. То, что по коду подтвердить нельзя, помечено `UNKNOWN — NEEDS VERIFICATION`.
> Сверялся с `docs/AUDIT-2026-09-17-PLATFORM-REDESIGN.md`, `docs/product_ux_improvement_proposal.md`, `docs/TZ-settings-profile-notifications-activity.md`. Идеи здесь черновые; сводный backlog с ID — в [00-summary.md](00-summary.md).

## 1. Карта пользовательской части

### 1.1 Две «оболочки» кабинета — главная архитектурная проблема

| Оболочка | Маршруты | Навигация | Файл |
|---|---|---|---|
| **A. `/client/*`** — своя шапка на каждой странице, без сайдбара | `/client/home`, `/client/onboarding(+/documents)`, `/client/point-a`, `/client/point-b`, `/client/content(/[slug])`, `/client/journey`, `/client/welcome`, `/client/waiting-room`, `/client/scenarios`, `/client/dashboard-medical`, `/client/dashboard-ecommerce`, `/client/onboarding-medical`, `/client/onboarding-ecommerce` | только ссылки внутри страниц | `app/client/layout.tsx` (маскот, баннер, ActivityTracker; нет колокольчика и меню) |
| **B. `(dashboard)`** — сайдбар, шапка, MobileNav, колокольчик | `/dashboard`, `/gri`, `/pulse`, `/point-a`, `/point-a/insights`, `/point-b`, `/simulator`, `/metrics`, `/market`, `/profile`, `/profile/psych`, `/notifications`, `/settings`, `/activity` | `lib/navigation.ts`, `Sidebar.tsx`, `MobileNav.tsx`, `Header.tsx` | `app/(dashboard)/layout.tsx` |

Пользователь постоянно переходит между оболочками: «Кабинет» на `/client/home` ведёт в `/dashboard`, «Отчёты» в шапке портала — в `/client/point-a` (`Header.tsx:293`), а `/client/point-a` возвращает в `/dashboard` (`client/point-a/page.tsx:273`).

### 1.2 Алиасы и дубли

- Redirect: `/client/dashboard` → `/client/home`; `/client/my-data` → `/client/point-a#my-data`; `/client/point-a/insights` → `/point-a/insights`.
- **Точка А на трёх поверхностях:** `/dashboard` (`app/(dashboard)/dashboard/page.tsx:~320-450`), `/point-a` и `/client/point-a` (641 строка, отдельная реализация).
- **Точка Б на двух:** `/point-b` и `/client/point-b` — общий `PointBContainer`, но разные шапка и Pro-гейт.
- **AI Journey на двух:** `/journey` («эксперимент») и `/client/journey`.
- **Профиль на двух:** `/client/home` («Мой профиль») и `/profile`.

### 1.3 Таблицы

`profiles`, `companies`, `survey_answers` (174 ключа, 12 шагов), `survey_drafts`, `survey_answer_history`, `documents`, `diagnostics`, `gri_assessments`, `gri_assessment_drafts`, `gri_plan_progress`, `gri_pulse_responses`, `action_plans`, `app_notifications`, `activity_log`, `user_events`, `cms_pages`/`cms_blocks`, `platform_sections`, `ai_journey_*`, psych profile, `expert_comments`, expert cases.

## 2. Путь пользователя по шагам

| # | Шаг | Экраны | Что не так |
|---|---|---|---|
| 0 | Лендинг или `/gri-free` | A/B `?v=1..4`, мини-GRI без регистрации | Ответы мини-GRI не переносятся в аккаунт (`MiniGriWizard.tsx:487` просто ссылается на `/register`) |
| 1 | `/register` | 5 полей + согласие | Цифры «500+ клиентов · 27 отраслей · 94% NPS» захардкожены (`register/page.tsx:111-115`) — `UNKNOWN — NEEDS VERIFICATION`. Имя, email и компания не подставляются в анкету |
| 2 | Одобрение | авто-одобрение по риск-скорингу, иначе `/client/waiting-room` (опрос каждые 30 с) | При «Требуется уточнение» комментарий админа уходит только в email (`approval.ts:93-99`). В waiting-room его не видно, ответить можно только через `mailto:` |
| 3 | `/client/welcome` | 2 экрана: вертикаль и путь | Обещано «~3-5 минут» (`welcome/page.tsx:166`) при 12 шагах и 174 ключах. При наличии компании уводит в `/dashboard`, а не в `/client/home` |
| 4 | Анкета `/client/onboarding` | 13 экранов, автосейв, beforeunload | Сделано хорошо. Но ошибка пересчёта Точки А молча проглатывается (`onboarding/page.tsx:305-314`, `catch {}`). В медицинской и e-commerce анкетах нет автосейва и beforeunload |
| 5 | `/client/home` | hero, 4 KPI, секции, GRI, материалы, «Что дальше» | Нет NBA, колокольчика и меню. «Анкета: заполнена <дата>» показывается и при частичном заполнении |
| 6 | GRI | 7 блоков, 67 критериев, ~15–20 мин | «Пройти заново» стирает черновик без подтверждения. Шкала GRI — /10, Точки А — /100 |
| 7 | Точка Б | из home → `/client/point-b`, из сайдбара → `/point-b` (Pro-замок) | Pro-гейт зависит от того, откуда пришёл пользователь |
| 8 | Дальнейшая работа | pulse, материалы, AI Journey, уведомления | Нет уведомлений о прогрессе и еженедельного дайджеста. Обычный клиент не видит комментарии эксперта |

**От регистрации до первого результата GRI — минимум ~20 экранов.**
**Три разных «главных» экрана:** после входа `/client/home` (`role-landing.ts:26`), при заходе залогиненного клиента на `/login` — `/dashboard` (`middleware.ts:370-374`), из welcome — `/dashboard`.
**Глубокие ссылки теряются:** `from` учитывается только для неизвестной роли (`login/page.tsx:39`).

## 3. Аудит по областям

| Область | Статус | Факты | Проблема | Предложение |
|---|---|---|---|---|
| Регистрация | IMPROVEMENT | `register/page.tsx`, `api/auth/register` | Непроверенная социальная статистика; данные не переносятся в анкету | Префилл; подтвердить или убрать цифры |
| Одобрение, waiting-room | IMPROVEMENT | `waiting-room/page.tsx`, `approval.ts:93` | Нет причины уточнения и канала ответа | Показать причину, форма ответа |
| Гейт статуса | UNCLEAR | `middleware.ts:257` проверяет только blocked/archived | `pending_approval`/`rejected` по прямому URL открывают `/dashboard`, `/gri`, `/point-b` | Решение владельца |
| Онбординг, welcome | IMPROVEMENT | `welcome/page.tsx` | Неверная оценка времени, разные адреса | Честная оценка, одна точка входа |
| Анкета | EXISTING | `onboarding/page.tsx`, `lib/survey/*` | Молчаливая ошибка пересчёта; вертикальные анкеты отстают | Статус пересчёта; автосейв в вертикалях |
| `/client/home` | IMPROVEMENT | `UserHome.tsx` | Нет NBA, уведомлений, меню, задач | NBA, колокольчик, «Мои задачи» |
| `/dashboard` | IMPROVEMENT | `dashboard/page.tsx` | Дублирует Точку А | Слить с `/client/home` |
| `/profile` | IMPROVEMENT | `profile/page.tsx` | «{n}/6 шагов» при 12; «Последний вход» захардкожен «—»; только чтение | Объединить с home и settings |
| Навигация | IMPROVEMENT | `navigation.ts`, `Sidebar.tsx`, `MobileNav.tsx:12-17` | Две оболочки; на мобильном нет «Мой профиль»; `/profile` и `/settings` выпадают из drawer (фильтр `allowedNav`, `MobileNav.tsx:95`) | Единое меню |
| Поиск | MISSING (фактически) | `Header.tsx:193-199` → `/metrics?q=`, а `MetricsPageClient` не читает `q` | Поиск ничего не ищет, `/metrics` — Pro | Командная палитра |
| Фильтры | EXISTING / IMPROVEMENT | insights, content, scenarios | Не сохраняются; у материалов нет поиска | — |
| In-app уведомления | IMPROVEMENT | `NotificationsFeed.tsx`, `create.ts` | Нет событий о продукте: одобрение, GRI, эксперт, документ | `notifyUser` → `app_notifications` |
| Email | IMPROVEMENT | `lib/email/*` | Настройки пользователя игнорируются | Проверять `preferences` |
| Telegram | IMPROVEMENT | `TelegramLinkPanel` | Учитывается только CRM-дайджест; две привязки путают | Одна привязка |
| Настройки уведомлений | IMPROVEMENT | `SettingsClient.tsx:594-606` | Из 7 категорий работает только `crm` | Подключить или скрыть |
| Задачи | IMPROVEMENT (дубль) | `Plan90Checklist` и `ActionPlanBoard` | Два «90-дневных плана» | Одна сущность «Мои задачи» |
| Прогресс | IMPROVEMENT | анкета, GRI, динамика, стрик | Нет сводного «путь A→B в %» | Трекер |
| Связь с экспертом | IMPROVEMENT / сломано | `ExpertCommentsSection` только в `dashboard-medical`; `GriExpertNotesLoader` не импортируется | Обычный клиент не видит комментарии | «Сообщения эксперта» |
| История активности | IMPROVEMENT | `/activity` читает только `activity_log` | Не видно продуктовых событий | Лента «Что я сделал» |
| Достижения | MISSING | только `pulse-streak` | — | Вехи |
| NBA | IMPROVEMENT (дубль) | два движка | Возможны разные советы; на home NBA нет | Один движок |
| Контент | EXISTING | `/client/content` | Нет поиска и отметки «прочитано» | Прогресс чтения |
| Персонализация | IMPROVEMENT | `profiles.vertical`, психопрофиль | Вертикаль влияет только на первый вход | Учитывать в landing и меню |
| AI Journey | UNCLEAR | `lib/journey/*` не читает анкету, диагностику и GRI | Изолированный сценарий; карточка «Путь клиента (CJM)» ведёт не туда, куда обещает | Вопрос владельцу |
| Mobile UX | IMPROVEMENT | `MobileNav.tsx`, `/client/point-b` | Нет «Мой профиль» и GRI в нижней панели; шапка Точки Б на 375px, вероятно, переполняется — `UNKNOWN` | Новая нижняя панель |
| Empty / loading / error | EXISTING | `loading.tsx` почти везде, `client/error.tsx` | На вертикальных дашбордах вместо пустых состояний демо-данные | — |

## 4. UX-проблемы

| Workflow | Проблема | Факт | Серьёзность |
|---|---|---|---|
| Вход | Потеря deep-link | `login/page.tsx:39` | High |
| Вход | Три разных «главных» экрана | `role-landing.ts:26`, `middleware.ts:370`, `welcome/page.tsx:93` | Medium |
| Портал | Переходы между оболочками без меню | `Header.tsx:293`, `client/point-a/page.tsx:273` | High |
| Точка А | Три реализации одного экрана | `/dashboard`, `/point-a`, `/client/point-a` | High |
| GRI | «Пройти заново» стирает черновик без подтверждения и отмены | `GRIAssessment.tsx:448-455, 576, 1384` | High |
| Документы | Удаление файла без подтверждения | `FileArea.tsx:208-224` | Medium |
| Психопрофиль | Сброс без подтверждения | `PsychProfileClient.tsx:314` | Medium |
| Анкета | Ошибка пересчёта не видна | `onboarding/page.tsx:305-314` | Medium |
| Welcome | Неверная оценка времени | `welcome/page.tsx:166` | Medium |
| Профиль | Неверное число шагов, пустой «последний вход» | `profile/page.tsx` | Low |
| Поиск | Ничего не находит | `Header.tsx:193-199` | Medium |
| Мобильный upgrade | «Заявка отправлена» показывается даже при ошибке | `MobileNav.tsx` `handleUpgradeRequest` | Low |
| Уведомления | Настройки ни на что не влияют | `SettingsClient.tsx:594-606` | Medium |
| Waiting-room | Нет причины уточнения и канала ответа | `approval.ts:93-99` | Medium |
| Home | «Анкета заполнена» при частичном заполнении | `UserHome.tsx` | Low |
| Шкалы | GRI /10 и Точка А /100 рядом | `UserHome.tsx` | Medium |

## 5. Критические находки

1. **Выдуманные данные на e-commerce-дашборде.** В `dashboard-ecommerce/page.tsx:20-100` захардкожен объект `DATA` («Demo Shop», каналы, SKU, RFM, когорты и т.д.). Блоки `ChannelMix`, `MarketplacesStrip`, `SkuHealth`, `RFMHeatmap`, `CohortLTV`, `CartRecovery`, `Seasonality`, `GoalsStrip` (`:222-232`) **всегда показывают демо-цифры**. Метка «демо» есть только в Hero (`:293`). Реальный клиент попадает туда сразу после e-commerce-анкеты. Нарушение TR-2.
2. **Кнопки в ленте обсуждений Точки А ничего не делают.** «Создать вопрос» пишет только в state со статусом `pending_ai` (`point-a/insights/page.tsx:107-121`), после перезагрузки вопрос исчезает. Поле «Ответить…» и кнопка без обработчиков (`InsightItem.tsx:303-316`). «Подтвердить», «Редактировать» и другие вызывают необязательные колбэки, которые никто не передаёт (`:165-200`).
3. **Клиент не видит комментарии эксперта.** `ExpertCommentsSection` подключён только в `dashboard-medical`, `GriExpertNotesLoader` нигде не используется. Письмо «комментарий эксперта» ведёт на `/client/dashboard` → `/client/home`, где комментариев нет (`lib/notifications.ts:230-231`). `expert_case_updated` шлёт клиенту ссылку на `/expert/dashboard` (`:233-235`). `notifyUser` не пишет в `app_notifications`.
4. **Pro-гейт непоследователен.** Сайдбар ставит замок, не учитывая `gatesEnabled` (`Sidebar.tsx:49-52`); `MobileNav.tsx:98-100` ставит замок всем клиентам, даже Pro. При этом home ведёт в `/client/point-b` без замка, а поиск — прямо в `/metrics`. Серверной проверки тарифа в `/api/v1/diagnostics/point-b` и `/metrics` не найдено — `UNKNOWN — NEEDS VERIFICATION`.
5. **Статус заявки не проверяется на сервере.** Клиент в `pending_approval`/`rejected` получает весь портал по прямым URL (`middleware.ts:257`). Задумано ли так — решает владелец.
6. **Вертикальные дашборды недостижимы после первого визита.** На них не ссылаются ни меню, ни `roleLandingPath`, ни home. `dashboard-medical` при каждом открытии делает `POST /api/medical/audit/run` (`:75`); сколько это стоит — `UNKNOWN`.
7. **Настройки уведомлений не влияют на письма.** По умолчанию `gri.email=false`, но `sendGriCompletedEmail` уходит без проверки.
8. **Мёртвый NextAuth в клиентских страницах.** `auth()` NextAuth вызывается в `point-a/page.tsx:27` и `metrics/page.tsx`. REST идёт с `SERVICE_ROLE_KEY || ANON_KEY` (пункт 17 аудита 09-17 не закрыт).

## 6. Идеи (черновые, U1–U22)

| # | Idea | Problem | Solution | Cx | Impact | Dependencies | Existing? |
|---|---|---|---|---|---|---|---|
| U1 | Единая оболочка кабинета | две оболочки | `/client/*` под `(dashboard)`-layout, `/client/home` — главная | M | H | layout, middleware | Нет |
| U2 | Одна Точка А | три реализации | оставить `/point-a`, остальные — redirect | M | H | U1 | Частично |
| U3 | «Мой путь A→B» | нет сводного прогресса | прогресс-бар на home с % и следующим шагом | M | H | survey, gri, action-plan | Нет |
| U4 | Единый NBA на home | два движка | слить, карточка на home | S | H | — | Частично |
| U5 | «Мои задачи» | два плана | одна таблица задач | M | H | миграция | Частично |
| U6 | Центр сообщений с экспертом | комментарии не видны | вкладка «Эксперт» + ответ клиента | M | H | `expert_comments`, RLS | Частично |
| U7 | Единый `notify()` | три несвязанных канала | in-app + email/TG по `preferences` | M | H | `lib/notifications*`, `lib/email` | Частично |
| U8 | Еженедельный дайджест | нет причины вернуться | cron: GRI, задачи, материалы | M | H | U7 | Нет |
| U9 | Подтверждение и отмена опасных действий | GRI reset, удаление файла, психопрофиль | модалка + мягкое удаление с «Отменить» 10 с | S | M | sonner | Нет |
| U10 | Командная палитра ⌘K | поиск не работает | поиск по разделам, ответам, документам, материалам, задачам | M | M | — | только в GIGA |
| U11 | Deep-link после входа | `from` игнорируется | `safeInternalPath(from)` | S | M | — | Нет |
| U12 | Префилл из регистрации и мини-GRI | двойной ввод | подставлять данные, переносить мини-GRI | S | M | — | Нет |
| U13 | Честная оценка времени и «частями» | «3-5 минут» | время по `user_events`; обязательный минимум | S | M | аналитика | Нет |
| U14 | Экран уточнения заявки | причина только в email | reason в waiting-room + форма ответа | S | M | approval API | Нет |
| U15 | Достижения (вехи) | нет геймификации | 5–6 бейджей | M | M | `user_events` | только стрик |
| U16 | «Было / стало» GRI на home | динамика спрятана | дельта + спарклайн + поздравление | S | M | `GriDynamicsPanel` | Частично |
| U17 | Единая шкала индексов | /10 и /100 рядом | одна шкала или пояснение | S | M | решение владельца | Нет |
| U18 | Вертикальный кабинет | medical/e-commerce недостижимы и с демо-данными | landing и меню по `vertical`; убрать демо | M | H | U1 | Частично |
| U19 | Лента «История» | `/activity` только про настройки | `user_events` клиенту | S | L | RLS self-read | Нет |
| U20 | Лента инсайтов с реальными действиями | кнопки не работают | подключить к API или убрать | M | H | insights API | Нет |
| U21 | Мобильная нижняя панель | Метрики (Pro) вместо GRI | Главная · GRI · Точка А · Задачи · Ещё | S | M | U1 | Нет |
| U22 | AI Journey на данных клиента | Journey начинается с нуля | засевать из анкеты, диагностики, GRI | L | M | `lib/journey/*` | Нет |

## 7. Вопросы к владельцу

1. Должен ли клиент в `pending_approval`/`rejected` работать с GRI, Точкой Б и метриками?
2. Какие разделы платные? Нужна ли серверная проверка тарифа? Как вести себя при выключенных «гейтах»?
3. Главный экран клиента: `/client/home` или `/dashboard`? Сводим к одной оболочке с сайдбаром?
4. Вертикали medical и e-commerce живые? Что делать с демо-блоками e-commerce?
5. AI Journey — эксперимент или второй режим продукта? Что означает «Путь клиента (CJM)»?
6. Должен ли каждый клиент видеть и отвечать на комментарии эксперта? Есть ли SLA и закреплённый эксперт?
7. Какая шкала «официальная»: GRI 0–10 или Точка А 0–100?
8. Какие события обязательны для уведомлений? Нужен ли еженедельный дайджест, и в каком канале?
9. Главный план — «90 дней GRI» или «Карта роста» Точки Б?
10. Цифры на `/register` подтверждены?
