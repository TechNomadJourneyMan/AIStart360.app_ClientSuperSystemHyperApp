# Journey Store — исследование и коррекция интерфейса

## Что было неверно

Первая версия использовала отдельный `StoreJourneyView`: статичную шапку,
три карточки A/action/B и длинную сетку модулей. Она переиспользовала только
`WidgetRenderer` и визуальные токены, но обходила настоящие `JourneyWorkspace`,
`ChatDock`, `JourneyExperience`, `JourneyCanvas`, `WidgetModule` и mobile modes.

Это была архитектурная ошибка реализации и исходного промпта. Пользователь
справедливо ожидал ранее спроектированный Journey, а не ещё один dashboard.

## Канонический источник истины

История Journey и текущие E2E фиксируют:

- conversation-led первые минуты;
- стадии `describe → confirm → goal → ready`;
- центрированный AI-диалог, пока A/B ещё формируются;
- интерактивную A → B доску после подтверждённой измеримой цели;
- ChatDock, который всегда доступен;
- allowlisted draggable/collapsible widgets;
- mobile tabs `Путь / Спросить AI / Модули`.

Поэтому Store с подтверждёнными фактами и без цели должен начинаться на стадии
`goal`, а не насильно показывать готовую доску или выдуманную Точку B.

## Почему нельзя было просто передать initialState

Обычный `JourneyWorkspace`:

- сам bootstrap'ится через `/api/v1/journey`;
- переключает signed-in пользователя на canonical workspace;
- сохраняет state в browser localStorage;
- принимает PATCH/chat state от клиента.

Простая замена компонента либо потеряла бы Store seed при bootstrap, либо
скопировала бы финансовые факты в browser cache/обычное autosave. Client header
также нельзя использовать как security authority. Поэтому введены выделенные
Store endpoints, отдельный owned workspace, server-side re-grounding и redaction.

## Выбранное решение

- Отдельный детерминированный owned Store workspace того же пользователя; без
  нового tenant/Auth/company и без связи с generic canonical mapping.
- Live Point A заново строится из `StoreOverview` на GET/PATCH/chat.
- Browser payload не является источником Store фактов.
- В БД сохраняется только user-owned overlay и metric-free layout shells.
- В Store context полностью отключён browser persistence и demo fallback.
- Отдельная document mutation boundary закрыта.
- Store PATCH является layout-only; цель и roadmap изменяет только server chat.
- Generic Journey и device-connect не могут открыть reserved Store workspace.

Так сохраняется исходный Journey UX, не создаётся второй бизнес и не возникает
второй источник истины для Store financial data.

## Осознанные ограничения

- Файлы нельзя прикреплять из Store Journey: импорт выполняется в `/store/imports`.
- Без authenticated browser session невозможно честно выполнить production E2E
  с реальными данными; anonymous redirects и API 401/403 не заменяют его.
- Пользовательские goals/messages/layout живут в отдельном Store overlay
  workspace. Визуально это тот же canonical Journey, но обычный Journey state не
  перезаписывается и не становится обходом Store MFA/role boundary.
