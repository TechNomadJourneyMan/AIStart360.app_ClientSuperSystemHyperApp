# Фаза 3: Туториал — welcome от Гри, экскурсия-чеклист, советы при проблемах — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Онбординг показывается один раз при первом входе (welcome от Гри → экскурсия-чеклист по ключевым страницам с короткими турами), повторно — только вручную из раздела «Обучение»; советы Гри появляются при обнаружении проблем и ведут на нужные страницы рабочими кнопками.

**Architecture:** Поверх существующей системы Гри: `MascotAssistant` (оркестратор, поллит /api/v1/assistant/context), `MascotCoachmarks` (spotlight-туры — геометрия и ожидание поздних таргетов уже починены в Фазе 1), `tours.ts` (каталог по экранам), настройки в `profiles.preferences.assistant` (персистенция починена в Фазе 1: проверка строк + union-merge). Экскурсия — новый слой: чеклист шагов «страница → тур», состояние в zustand persist-слайсе (переживает ремоунт между layout-группами), прогресс в настройках. Пер-страничный АВТОзапуск туров отключается (стал источником «туров постоянно» по ощущению ПО); авто — только welcome при первом входе.

**Tech Stack:** Next.js 14, zustand persist, framer-motion, существующие API /api/v1/assistant/{context,settings,insight}.

**Спека:** `docs/superpowers/specs/2026-07-08-gri-pulse-crm-design.md` §4 + UX-исследование туров (Chameleon: 3-5 шагов/тур, чеклист-«оглавление», launcher ~67% completion, welcome с выбором = 2-3× completion).

## ПРОВЕРЕННЫЕ ФАКТЫ (Фаза 1 разведка + свежие правки)

- `components/assistant/mascot/MascotAssistant.tsx`: автозапуск тура — effect ~строки 560-572 (условие: `tourForScreen(screen)` есть && screen не в `toursDone` && не в `tourSessionRef`); `closeTour` (592-606) помечает экран + PATCH; replay-событие `aistart:tutorial:replay` (575-583); меню-кнопка «Подсказки по странице» (`onPageTour`, 586-590); навигация из пузырей работает: `HintAction {kind:'navigate', href}` → router.push (~434).
- `MascotCoachmarks` теперь: поллинг таргета 250мс×12 → авто-скип шага; кламп в вьюпорт; ширина min(330, vw-24); Esc/Пропустить → onClose(false), Готово → onClose(true) — родитель помечает экран в ОБОИХ случаях.
- `lib/assistant/mascot/types.ts`: `MascotSettings` (toursDone: string[], dismissedHints, greeted?, behavior, character…), `DEFAULT_MASCOT_SETTINGS`. PATCH-схема в `app/api/v1/assistant/settings/route.ts` — zod `.strict()`: новые поля НАДО добавить в patchSchema + normalizeMascotSettings + типы, иначе 422. Лимит PATCH 10/мин — батчить.
- `lib/assistant/mascot/state.ts`: zustand persist 'aistart_mascot_v1'; setContext: server wins, union для toursDone/dismissedHints.
- `lib/assistant/mascot/server-hints.ts`: кандидаты fix_errors/finish_section/continue_diagnostic/run_analysis/results_ready из completion/validation. `lib/assistant/context.ts` buildAssistantContext: diagnostics (Point A critical=красные зоны), survey, gri_assessments (top_5_limits), companies, metrics — CRM НЕТ.
- `lib/assistant/mascot/triggers.ts`: pickHint, RULES (global 90с, per-screen 3мин, per-hint 24ч, ×-мьют 7дн, max 8/сессию).
- `lib/assistant/mascot/hints.ts`: каталог 11 подсказок, HintAction, normalizeScreen.
- НОВОЕ с Фазы 1-2 (туры должны покрыть): /gri — 5 вкладок (Диагностика/Калькулятор/Результат/Динамика/AI-аналитик, `?tab=`); /pulse — CRM сверху (вкладки «Кому звонить»/«База»/«В зоне риска»/«Карточка»/CRM-интеграции) + «Пульс недели» внизу свёрнут; пункт меню «Клиенты» → /pulse.
- CRM-таблицы: `crm_clients/crm_reminders` (RLS own) — для советов clients_at_risk/reminders_overdue читать ПОД СЕССИЕЙ пользователя (RLS сам скоупит; не повторить expert-no-scoping).
- `components/onboarding/FirstRunWizard*` существует (ON-1) — ПРОЧИТАТЬ и скоординировать: welcome Гри не должен наслаиваться на него в один момент (см. Батч A Task 2).
- Тесты: `tests/unit/assistant-mascot/` (8 файлов, 71 зелёный) — держать зелёными; vitest.

## Батч A — Настройки, welcome, ручной доступ (Tasks 1-3)

### Task 1: Поля настроек экскурсии + «Обучение»
Files: `lib/assistant/mascot/types.ts`, `lib/assistant/mascot/settings-server.ts` (normalize), `app/api/v1/assistant/settings/route.ts` (patchSchema), тест.
- [ ] Добавить в MascotSettings: `tourGuide: { status: 'pending'|'active'|'done'|'dismissed'; stepIdx: number }` (default `{status:'pending', stepIdx:0}`) — статус экскурсии; `autoToursDisabled?: boolean` больше НЕ нужен (автозапуск убираем кодом). Нормализация + zod (числа капить 0..50). TDD-тест на normalize/patch (по образцу settings-server-write.test.ts).
- [ ] Commit `feat(mascot): настройки экскурсии tourGuide в profiles.preferences.assistant`.

### Task 2: Welcome-модалка при первом входе + отключение пер-страничного автозапуска
Files: `components/assistant/mascot/MascotAssistant.tsx`, новый `components/assistant/mascot/MascotWelcome.tsx`.
- [ ] Убрать эффект автозапуска пер-страничных туров (560-572) — заменить на welcome-гейт: если `!settings.greeted && tourGuide.status==='pending'` и контекст загружен → показать MascotWelcome (модалка от Гри: аватар, «Привет! Я Гри… Покажу главное? ~2 минуты», кнопки «Провести экскурсию» / «Разберусь сам»). Выбор: экскурсия → `tourGuide.status='active', stepIdx=0` + greeted=true (один PATCH) → старт экскурсии (Батч B); отказ → `status='dismissed'`, greeted=true. НИКОГДА не показывать повторно (greeted). ВАЖНО: прочитать FirstRunWizard — если он активен на этом экране/сессии, welcome Гри отложить (условие: не показывать, пока в DOM есть маркер визарда, напр. [data-first-run] — проверить реальный селектор/стор).
- [ ] «Подсказки по странице» (onPageTour) и replay-событие ОСТАВИТЬ — ручные пути работают как раньше.
- [ ] Commit `feat(mascot): welcome при первом входе вместо пер-страничного автозапуска туров`.

### Task 3: Раздел «Обучение» в меню Гри
Files: `components/assistant/mascot/MascotControls.tsx` (меню «⋯»), возможно `AssistantSettingsPanel`.
- [ ] В меню Гри добавить блок «Обучение»: «Экскурсия по порталу» (перезапуск: tourGuide={status:'active',stepIdx:0} + старт), «Подсказки по этой странице» (существующий onPageTour), список прочих туров текущей роли (по каталогу TOURS: название → запуск setTourSteps соответствующего экрана при переходе — упрощённо: пункт ведёт router.push на экран + фиксирует запрос тура через zustand `requestTourForScreen`, MascotAssistant при совпадении screen выполняет). Реализовать поле стора `requestedTourScreen: string|null`.
- [ ] Commit `feat(mascot): раздел «Обучение» — ручной запуск экскурсии и туров разделов`.

## Батч B — Экскурсия-чеклист (Tasks 4-5)

### Task 4: Движок экскурсии
Files: `lib/assistant/mascot/tour-guide.ts` (новый), `lib/assistant/mascot/state.ts` (слайс), `components/assistant/mascot/MascotAssistant.tsx` (интеграция), `components/assistant/mascot/TourChecklist.tsx` (новый UI).
- [ ] `tour-guide.ts`: описание маршрута per role. Клиент/владелец: `[{screen:'/dashboard', title:'Дашборд'}, {screen:'/client/onboarding'|'/onboarding'… определить по реальным роутам роли, title:'Анкета'}, {screen:'/gri', title:'GRI-диагностика'}, {screen:'/point-a'...}, {screen:'/point-b'...}, {screen:'/pulse', title:'Клиенты и пульс'}, {screen:'/metrics'...}, {screen:'/market'...}]` — фактические пути взять из lib/navigation.ts по ролям (владелец vs клиент — разные наборы; сузить до существующих в TOURS экранов).
- [ ] Zustand: `tourGuideActive: boolean` (persist НЕ нужен — статус в settings; но текущий transient-прогон держать в persist, чтобы пережить router.push/ремоунт). Логика шага: (1) если текущий screen ≠ шаг.screen → router.push; (2) дождаться контекста/маунта; (3) запустить тур экрана (setTourSteps из TOURS); (4) по closeTour(любой исход) → stepIdx+1, батч-PATCH tourGuide (не чаще 1 PATCH на шаг); (5) последний шаг → status='done' + поздравление-пузырь от Гри. «Пропустить экскурсию» доступен на каждом шаге (status='dismissed').
- [ ] `TourChecklist.tsx`: плавающая компактная карточка «Первые шаги · 3/8» (список шагов с галочками, текущий подсвечен, кнопки «Продолжить»/«Свернуть»/«Пропустить»), видна пока status='active'. Стиль Гри (тёмный, primary).
- [ ] Юнит-тесты движка прогресса (чистая логика next-step/complete в tour-guide.ts).
- [ ] Commit `feat(mascot): экскурсия-чеклист «Первые шаги» с переходами между страницами`.

### Task 5: Возобновление и устойчивость
- [ ] При загрузке любой страницы: если settings.tourGuide.status==='active' → показать TourChecklist (свернутый), НЕ автозапускать шаг до клика «Продолжить» (не пугать при возврате). Гонки с welcome исключить (welcome только при status='pending').
- [ ] Проверка: прерваться на шаге 3, перезагрузить, продолжить; смена layout-группы не убивает экскурсию.
- [ ] Commit `feat(mascot): экскурсия переживает перезагрузку и продолжает с места`.

## Батч C — Каталог туров (Task 6)

### Task 6: Полное покрытие страниц турами
Files: `lib/assistant/mascot/tours.ts` (+ data-tour атрибуты в страницы, где нет стабильных селекторов).
- [ ] Обновить/дополнить туры (макс 5 шагов, интерактив где уместно): `/gri` — учесть вкладки (шаги: hero, таб-бар, «Диагностика» CTA, «Калькулятор», «Динамика»); `/pulse` — CRM-очередь, KPI, вкладка «База» (+добавление клиента), напоминания, свёрнутый пульс; `/dashboard` — освежить; `/metrics`, `/market`, `/point-a`, `/point-b`, `/reports`, `/notifications`, `/settings` — добавить недостающие; client-варианты (`/client/*`) по ролям. Селекторы: предпочитать `data-tour="..."` атрибуты (добавить в целевые страницы точечно — это единственные правки вне mascot-файлов; НЕ трогать логику страниц).
- [ ] MASCOT_STEP оставить финальным шагом каждого тура.
- [ ] Commit `feat(mascot): полный каталог туров по страницам и функциям (данные-tour селекторы)`.

## Батч D — Советы при проблемах + empty-states (Tasks 7-8)

### Task 7: Problem-советы с кнопками
Files: `lib/assistant/context.ts`, `lib/assistant/mascot/server-hints.ts`, `lib/assistant/mascot/hints.ts`, `lib/assistant/mascot/triggers.ts`, тесты.
- [ ] buildAssistantContext: добавить лёгкую CRM-сводку ПОД СЕССИЕЙ пользователя (count просроченных open-напоминаний, count клиентов red-давности) — 2 дешёвых запроса; и pulse-снят-ли-на-этой-неделе (gri_pulse_responses current_week).
- [ ] computeServerHints: новые кандидаты `empty_metrics` (metrics пустые/нулевые) → href /metrics; `red_zone` (гри-блок <5 или Point A critical) → /gri?tab=result; `clients_at_risk` (просроченные напоминания>0 или red>0) → /pulse; `pulse_missed` (чт-вс и не снят) → /pulse. hints.ts: тексты RU от Гри + HintAction navigate (механика уже работает).
- [ ] triggers.ts: класс `problem`-подсказок — per-hint кулдаун 24ч оставить, но global-кулдаун для них 30с и не считать в max 8/сессию более 2 раз. Тесты pickHint на новые правила.
- [ ] Commit `feat(mascot): советы при проблемах (метрики, красные зоны, клиенты в риске, пульс) с кнопками перехода`.

### Task 8: Empty-states с репликой Гри
Files: точечно: `components/crm/ClientsTable.tsx` (пустая база), `components/pulse/GriPulseWidget.tsx` (нет baseline — уже есть CTA, освежить текст), `app/(dashboard)/point-b` empty (если есть компонент), `components/gri/page/GriDynamicsPanel.tsx` («Пока нет замеров» — добавить CTA «Пройти диагностику»).
- [ ] Единый мини-компонент `components/assistant/mascot/MascotEmptyHint.tsx` (аватар Гри + реплика + CTA) и использовать в 3-4 местах. Не трогать логику страниц.
- [ ] Commit `feat(mascot): empty-states с репликой Гри и CTA`.

## Батч E — Верификация (Task 9)
- [ ] Новый пользователь (свежий тест-аккаунт): видит welcome ОДИН раз → экскурсия идёт по страницам с прогрессом → «Готово»; после перезагрузки ничего само не всплывает; «Обучение» в меню Гри работает; советы приходят при реальных проблемах и кнопки ведут куда надо; 375px без переполнения.
- [ ] `npx vitest run && npm run lint` чисто; mascot-тесты зелёные.
- [ ] Commit `feat(mascot): Фаза 3 завершена — верификация`.

## Не делаем
LLM-генерацию туров, туры для staff/admin ролей (обучены), video-туры, изменение FirstRunWizard (только координация показа).
