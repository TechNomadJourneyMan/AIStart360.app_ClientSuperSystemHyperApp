# Journey Store — исследование

## Что уже есть

- `/store` получает агрегированный `StoreOverview` из опубликованных `store_*` scope текущего пользователя.
- Store API уже содержит session, role/status и MFA step-up границы.
- Journey предоставляет строгую схему состояния и allowlisted отраслевые виджеты.
- Обычный Journey workspace сохраняет состояние в серверной БД и использует browser cache; поэтому копировать туда финансовые Store-факты в этой фазе нельзя.

## Выбранное решение

Server-first read-only маршрут `/client/journey/store`:

- повторно использует текущий Store loader;
- строит Journey state детерминированным серверным адаптером;
- не создаёт вторую компанию и не переносит fact rows;
- не использует клиентский data fetching или storage;
- сохраняет точность опубликованного Store и визуальный язык Journey.

## Отложено

- Grounded AI-диалог по live Store-данным потребует отдельного ephemeral context contract и защиты от сохранения финансовых агрегатов в browser cache.
- Запись целей/решений из этого экрана потребует явного owner-controlled persistence contract.
- Production deploy и authenticated E2E выполняются отдельной релизной операцией.
