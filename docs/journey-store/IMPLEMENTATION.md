# Journey Store — реализация Phase 1

## Результат

Добавлено live read-only представление Store Control Center в визуальном языке AIStart360 Journey.

Маршрут: `/client/journey/store`.

## Поток данных

1. Server Component получает текущего пользователя через Supabase `getUser()`.
2. Проверяется Store MFA step-up.
3. Проверяются trusted `profiles.role/status` через общий Store access policy.
4. `loadStoreOverview` читает данные строго по `user.id` текущей сессии.
5. Чистый `buildStoreJourneyState` превращает агрегат в schema-valid allowlisted Journey state.
6. UI получает только агрегаты и отрисовывает их без browser storage, fetch и autosave.

## Интерфейс

- Шапка: компания, фактический период, версия публикации и дата актуальности.
- Путь: подтверждённая Точка A → ближайшее проверяемое действие → незаданная Точка B.
- Факты: только значения, реально присутствующие в StoreOverview.
- Модули:
  - экономика магазина;
  - ассортимент и остатки;
  - контур управленческих данных;
  - сигналы и ограничения.
- Переходы: `/store` ↔ `/client/journey/store`, а при пустом Store — `/store/imports`.

## Безопасность

- Не создаются Auth user, profile, company или новая БД.
- Не используются `/api/v1/journey`, `JourneyWorkspace`, `ai_journey_*` или localStorage.
- `user_id` и `company_id` не принимаются из браузера.
- `null` остаётся `unknown`, не становится нулём.
- Исходные строки, customer PII и банковские данные не входят в проекцию.
- Маршрут включён в Store role matrix middleware и повторно защищён на странице.

## Следующая фаза

Grounded AI-диалог по Store можно включать только через отдельный ephemeral context contract: модель получает минимально необходимые агрегаты, а финансовые значения не попадают в клиентский cache или обычное Journey autosave.
