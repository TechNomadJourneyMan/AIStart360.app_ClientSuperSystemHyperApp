# Journey Store — каноническая реализация

## Результат

`/client/journey/store` больше не является отдельной отчётной страницей. Маршрут
входит в существующий `JourneyWorkspace` с явным `context="store"` и использует
те же `ChatDock`, `JourneyExperience`, `JourneyCanvas`, `WidgetModule`,
`ModulesPanel` и mobile navigation, что основной AIStart360 Journey.

Удалён устаревший `StoreJourneyView`, который имитировал только цвета Journey и
строил длинный dashboard.

## Пользовательский сценарий

1. Server Component проверяет Supabase session, MFA step-up и trusted Store
   role/status до чтения данных.
2. `loadStoreOverview(user.id)` формирует owner-scoped агрегат, а чистый
   `buildStoreJourneyState` — schema-valid стартовую проекцию.
3. Поскольку Точка A уже подтверждена, а измеримой цели нет, Journey открывается
   на канонической conversation-first стадии `goal`.
4. В диалоге компактно и без обрезанной строки расположены ключевые показатели
   Store; факты помечены `Store live · read-only`.
5. Владелец задаёт метрику, целевое значение и срок. Первый ответ сохраняется
   только как проверяемый черновик. После отдельного действия «Подтвердить Точку
   B» основным слоем становится интерактивная плоскость A → B с четырьмя
   одновременно раскрытыми Store-модулями.
6. На mobile сохраняются режимы `Путь / Спросить AI / Модули`.

## Поток состояния

### Browser

- `JourneyWorkspace` направляет Store-запросы в выделенные
  `/api/v1/journey/store/*`; context header остаётся только bounded client hint и
  не является security authority.
- Store context не читает и не пишет identity/state в `localStorage`.
- Production fallback в локальную demo-логику для Store запрещён.
- Загрузка документов в ChatDock скрыта; XLS/XLSX/CSV публикуются только через
  защищённый Store import.

### Server

- GET/PATCH/chat/documents повторно проверяют живую Supabase session, MFA и Store access;
  middleware не считается API-защитой.
- `StoreOverview` загружается только по `user.id` сессии.
- Перед каждым ответом и AI-turn сервер заново накладывает live Store projection.
- Любые Store facts из browser payload удаляются; Точка A состоит исключительно
  из server-owned фактов.
- Browser не может заменить компанию, financial facts или содержимое Store
  widgets; у виджетов сохраняется только пользовательская раскладка.
- Store PATCH является layout-only: цели, сообщения, roadmap и widget payload
  принимаются только из server-owned chat/confirmation flow.
- Первое измеримое сообщение создаёт draft без transformation roadmap. Только
  отдельная точная команда подтверждения переводит цель в `confirmed` и строит
  A → B.
- Обычные Journey endpoints и device-connect flow безусловно отклоняют reserved
  Store workspace, даже для guest/чужого actor.
- Документный endpoint после auth возвращает bounded `405
  STORE_JOURNEY_DOCUMENTS_DISABLED` до разбора multipart.
- Store responses имеют `Cache-Control: private, no-store`.

### Database persistence

Используется выделенный детерминированный owned workspace
`journey-store-user-${user.id}`. Он отделён от canonical workspace обычного
Journey, использует отдельную HttpOnly device cookie с узким path и никогда не
участвует в generic latest-owned/canonical bootstrap. Новый tenant, Auth user,
profile, company или Store database не создаются.

Перед `saveJourneyState` live Store projection редактируется:

- удаляются компания, описание и все Store facts;
- удаляются server-owned Store messages/roadmap/suggestions;
- Store widgets сохраняются только как metric-free layout shells;
- сохраняются цели владельца, сообщения, пользовательский roadmap и layout.
- очистка касается только человекочитаемых widget-полей и никогда не изменяет
  IDs, URL, ISO dates, enums или document references.

После чтения сервер снова накладывает актуальные Store агрегаты. Поэтому цели и
раскладка переживают refresh, но финансовые значения не попадают ни в Journey DB,
ни в browser storage.

## Инварианты точности

- `null` остаётся `unknown`, не превращается в `0`.
- Контрольные значения HONOR форматируются без float drift.
- Точка B остаётся черновиком до отдельного явного подтверждения владельца;
  roadmap до этого не создаётся.
- AI получает только schema-valid live Store facts, пользовательские
  goals/messages и server-owned limitations.
- Raw sales/inventory/price rows, customer PII и банковские данные не входят в
  Journey projection.

## Проверки релиза

Перед production обязательно пройти targeted/full Vitest, TypeScript, ESLint,
route audit, production build, desktop/mobile visual smoke и повторный anonymous
redirect smoke. Authenticated production E2E отмечается отдельно: его нельзя
заявлять без реальной браузерной сессии аккаунта магазина.
